"""Share I/O runs on its own small, bounded set of threads.

A stat or directory walk on the scope's SMB share can hang for as long as the
OS's SMB client cares to wait, and a thread running one cannot be cancelled:
asyncio.wait_for gives up on it, the thread stays blocked. These calls used to
go through asyncio.to_thread, so every live poll against a hung share
stranded one more worker of the loop's DEFAULT executor — the pool DNS
(getaddrinfo) and the survey cache write also wait on. Now they run on
threads of their own, at most a fixed number at once, and once that many are
stuck a new call is refused immediately rather than queued behind them.
"""
import asyncio
import threading
import time

import pytest

from seestar_sidecar import last_stack, live_preview, share_io
from seestar_sidecar.share_io import ShareIoPool, ShareIoSaturatedError


async def _until_idle(pool: ShareIoPool) -> None:
    for _ in range(200):
        if pool.busy == 0:
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"{pool.busy} share thread(s) never finished")


async def test_share_io_runs_on_its_own_threads_not_the_default_executor():
    pool = ShareIoPool(max_threads=2)

    name = await pool.run(lambda: threading.current_thread().name)

    assert name.startswith(share_io.THREAD_NAME_PREFIX)


async def test_results_and_exceptions_come_back_to_the_caller():
    pool = ShareIoPool(max_threads=1)

    def raises():
        raise FileNotFoundError("gone")

    assert await pool.run(divmod, 7, 2) == (3, 1)
    with pytest.raises(FileNotFoundError, match="gone"):
        await pool.run(raises)
    await _until_idle(pool)


async def test_a_saturated_pool_refuses_at_once_instead_of_queueing():
    pool = ShareIoPool(max_threads=2)
    release = threading.Event()
    reached_share: list[int] = []

    def hang():
        reached_share.append(1)
        release.wait(10)
        return "done"

    stuck = [asyncio.create_task(pool.run(hang)) for _ in range(2)]
    await asyncio.sleep(0.1)

    started = time.monotonic()
    with pytest.raises(ShareIoSaturatedError):
        await pool.run(hang)
    assert time.monotonic() - started < 0.5
    assert len(reached_share) == 2, "the refused call still touched the share"

    release.set()
    assert await asyncio.gather(*stuck) == ["done", "done"]
    await _until_idle(pool)
    assert await pool.run(lambda: "free again") == "free again"


async def test_a_timed_out_call_holds_its_thread_until_the_share_answers():
    """wait_for abandons the call, not the thread: the thread is still stuck
    in the share, so it must go on counting against the limit."""
    pool = ShareIoPool(max_threads=1)
    release = threading.Event()

    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(pool.run(release.wait, 10), timeout=0.05)
    with pytest.raises(ShareIoSaturatedError):
        await pool.run(lambda: None)

    release.set()
    await _until_idle(pool)
    assert await pool.run(lambda: 42) == 42


def test_saturation_reads_as_unreachable_wherever_the_share_is_touched():
    """An OSError, so every call site's existing "OSError means the share is
    unreachable" handling covers it with no new branch."""
    assert issubclass(ShareIoSaturatedError, OSError)


@pytest.fixture
async def saturated(monkeypatch):
    """Swap in a one-thread pool and occupy its thread with a hung call."""
    pool = ShareIoPool(max_threads=1)
    monkeypatch.setattr(share_io, "pool", pool)
    release = threading.Event()
    stuck = asyncio.create_task(pool.run(release.wait, 10))
    await asyncio.sleep(0.05)
    assert pool.busy == 1
    yield pool
    release.set()
    await stuck


async def test_live_preview_discovery_answers_unreachable_at_once_when_saturated(
    saturated, tmp_path, monkeypatch
):
    def must_not_run(root, target=None):
        raise AssertionError("discover_frame ran on a saturated share pool")

    monkeypatch.setattr(live_preview, "discover_frame", must_not_run)

    with pytest.raises(live_preview.ShareUnreachableError):
        await live_preview.discover_frame_within_timeout(tmp_path, timeout_s=5)


async def test_last_stack_discovery_answers_unreachable_at_once_when_saturated(
    saturated, tmp_path, monkeypatch
):
    def must_not_run(root, target):
        raise AssertionError("discover_last_stack ran on a saturated share pool")

    monkeypatch.setattr(last_stack, "discover_last_stack", must_not_run)

    with pytest.raises(last_stack.ShareUnreachableError):
        await last_stack.discover_last_stack_within_timeout(tmp_path, "M27", timeout_s=5)
