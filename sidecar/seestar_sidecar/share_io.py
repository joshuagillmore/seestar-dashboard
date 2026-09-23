"""Blocking I/O against the scope's SMB share, on threads of its own.

A stat or a directory walk on a share that has gone quiet can block for as
long as the OS's SMB client cares to wait, and a thread running one cannot be
cancelled: `asyncio.wait_for` gives up on the CALL, and the thread stays stuck
in the share. These calls used to go through `asyncio.to_thread`, so every
timed-out poll left one more worker of the loop's DEFAULT executor blocked —
the pool `getaddrinfo` (every outbound HTTP connection) and imagery.py's
survey cache write also wait on. A hung share polled for a few minutes could
starve both.

So share I/O runs here instead: on daemon threads, at most MAX_THREADS at
once, counting a thread until its call actually returns — a timed-out call
included. Once that many are stuck, a new call is refused at once with
ShareIoSaturatedError rather than queued behind them. Daemon, because a
thread stuck in SMB must not hold up process exit either, which an executor's
worker would (ThreadPoolExecutor joins its threads at interpreter exit).

Callers keep their own `asyncio.wait_for` ceiling (SHARE_SCAN_TIMEOUT_SECONDS);
this module bounds how many threads the share can hold, not how long a caller
waits.
"""
import asyncio
import threading
from collections.abc import Callable
from typing import Any, TypeVar

T = TypeVar("T")

#: How many share calls may be in progress at once, stuck ones included. The
#: console touches the share from three routes (the live preview scan, its
#: image, the last-stack scan), so a couple of open tabs stay well inside
#: this on a healthy share, where each call returns in milliseconds; on a
#: hung one it is the most threads the share can ever strand.
MAX_THREADS = 8

#: Worker thread names start with this — how a test tells these threads from
#: the default executor's.
THREAD_NAME_PREFIX = "seestar-share-io"


class ShareIoSaturatedError(OSError):
    """Every share thread is still busy — almost always stuck on a share that
    stopped answering. An OSError so each call site's existing "OSError means
    the share is unreachable" handling covers it with no new branch."""


class ShareIoPool:
    """Runs blocking calls on at most `max_threads` daemon threads."""

    def __init__(self, max_threads: int = MAX_THREADS) -> None:
        self._max_threads = max_threads
        # Taken on the loop thread, released on a share thread.
        self._lock = threading.Lock()
        self._busy = 0
        self._started = 0

    @property
    def busy(self) -> int:
        """Threads currently running a call, including abandoned ones."""
        with self._lock:
            return self._busy

    async def run(self, fn: Callable[..., T], /, *args: Any) -> T:
        """`fn(*args)` on a share thread, or ShareIoSaturatedError at once."""
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        with self._lock:
            if self._busy >= self._max_threads:
                raise ShareIoSaturatedError(
                    f"all {self._max_threads} share I/O threads are busy; "
                    "the share is not answering"
                )
            self._busy += 1
            self._started += 1
            name = f"{THREAD_NAME_PREFIX}-{self._started}"

        def work() -> None:
            result: Any = None
            error: BaseException | None = None
            try:
                result = fn(*args)
            except BaseException as exc:  # noqa: BLE001 — handed to the caller
                error = exc
            finally:
                # Before the caller wakes, so a caller that goes straight on
                # to its next share call finds this thread already free.
                self._release()
            _settle_threadsafe(loop, future, result, error)

        try:
            threading.Thread(target=work, name=name, daemon=True).start()
        except BaseException:
            self._release()
            raise
        return await future

    def _release(self) -> None:
        with self._lock:
            self._busy -= 1


def _settle_threadsafe(
    loop: asyncio.AbstractEventLoop, future: asyncio.Future, result: Any, exc: BaseException | None
) -> None:
    def settle() -> None:
        if future.done():  # the caller gave up (wait_for timed out)
            return
        if exc is not None:
            future.set_exception(exc)
        else:
            future.set_result(result)

    try:
        loop.call_soon_threadsafe(settle)
    except RuntimeError:
        pass  # the loop closed while this thread was stuck; nobody is waiting


#: The process-wide pool. Looked up at call time (see run_share_io), so a test
#: can swap in its own.
pool = ShareIoPool()


async def run_share_io(fn: Callable[..., T], /, *args: Any) -> T:
    """`fn(*args)` on the share's own bounded threads. See the module docstring."""
    return await pool.run(fn, *args)
