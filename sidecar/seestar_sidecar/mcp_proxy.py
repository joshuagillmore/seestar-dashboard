"""A long-lived MCP stdio session, exposed as a simple async call().

This module is deliberately thin: it moves JSON, and does not interpret it. If
you find yourself reshaping a payload here, it belongs in the server instead —
see docs/handback-to-seestar-ai.md.
"""
import asyncio
import json
import logging
import os
from contextlib import AsyncExitStack
from datetime import timedelta
from typing import Any

import httpx
from mcp import ClientSession, StdioServerParameters, types
from mcp.client.stdio import stdio_client
from mcp.shared.exceptions import McpError

from seestar_sidecar.allowlist import ALLOWED_TOOLS

logger = logging.getLogger(__name__)


class ProxyTransportError(RuntimeError):
    """The MCP subprocess could not be reached, started, or answered."""


#: What this process calls itself in seestar-mcp's provenance log, absent an
#: operator override. See effective_client_id() — read that, not this, when
#: you need the id records will actually carry.
CLIENT_ID = "console"

#: Ceiling on one ordinary tool call. Calls used to have none, and they all
#: queue on one lock, so a single hung call held every live poll behind it
#: forever.
#:
#: Why 35 and not lower: seestar-mcp's own HTTP timeout to the Alpaca bridge
#: and the weather API is 30 s (its `http_timeout_s`), and it turns that
#: timeout into a valid `{"ok": false}` — which is how an idle scope's native
#: calls report "idle" rather than "bridge down" (routes.live_preview tells
#: the two apart). A sidecar ceiling at or below 30 s would cut the server off
#: a few milliseconds before it could say so, and turn every "idle" into a
#: transport failure. Keep this above the server's own timeout.
DEFAULT_CALL_TIMEOUT_SECONDS = 35.0

#: Ceiling on one qa_tier2 analysis — see LONG_RUNNING_TOOLS. Real analyses
#: over 200-1400 subs take minutes; this is only here so a wedged one cannot
#: hold its connection forever.
QA_CALL_TIMEOUT_SECONDS = 3600.0

#: Spawn + `initialize`. Generous because the first `uv run` in a checkout may
#: have to build its environment, and the server imports astropy.
START_TIMEOUT_SECONDS = 120.0

#: After a call times out, how long a ping gets to prove the server is still
#: alive. A server that answers is healthy and keeps its session; one that
#: cannot is wedged and is restarted on the next call.
PING_TIMEOUT_SECONDS = 5.0

#: How long aclose() waits for an in-flight call before tearing down anyway.
CLOSE_GRACE_SECONDS = 5.0

#: Tools that run on their own connection — their own server process —
#: rather than the one every live poll shares.
#:
#: qa_tier2 takes minutes, and upstream's analyze_session() runs synchronously
#: inside an async tool, blocking that server's event loop for the whole run.
#: On the shared connection it held the call lock for minutes, and even
#: without our lock the server could not have answered anything else. A
#: second process is safe: seestar-mcp builds its controller lazily and holds
#: no exclusive resource — the Alpaca and data clients are plain HTTP clients,
#: and the provenance log is opened per append — while qa_tier2 itself only
#: reads FITS files.
LONG_RUNNING_TOOLS = frozenset({"qa_tier2"})


def effective_client_id() -> str:
    """The id the spawned seestar-mcp server will stamp on every record.

    One function so the value we PASS DOWN and the value session_activity.py
    MATCHES AGAINST cannot drift apart — a mismatch between those two would
    make the console fail to recognise its own traffic, silently, which is
    the exact bug the tag-matching classifier had.

    An operator-set value wins; someone running two consoles against one
    server deserves to tell them apart. An empty string does not count as
    set: `ProvenanceLog` treats a falsy client_id as absent and generates
    `anon-<hex>`, so honouring `SEESTAR_CLIENT_ID=""` would produce records
    neither side could attribute — a worse outcome than ignoring it.
    """
    return os.environ.get("SEESTAR_CLIENT_ID") or CLIENT_ID


def _describe(exc: BaseException) -> str:
    """`str(exc)`, or the exception's type when that is empty.

    anyio's ClosedResourceError — what the first call after an idle server
    death raises — stringifies to "", which rendered as `call to 'whoami'
    failed: ` with no reason at all.
    """
    return str(exc) or type(exc).__name__


def _is_timeout(exc: BaseException) -> bool:
    return isinstance(exc, McpError) and exc.error.code == httpx.codes.REQUEST_TIMEOUT


class McpConnection:
    """Owns one stdio session to an MCP server and serialises calls onto it.

    The session lives in a dedicated owner task (see `_own_session`). anyio
    requires a task group to be exited by the task that entered it, and the
    session holds two; entered in whichever request task happened to start
    the server and exited in whichever task later reset or closed it, teardown
    raised "Attempted to exit cancel scope in a different task" and stopped
    part way. The owner task enters and exits both, whoever asks.
    """

    def __init__(
        self,
        command: str,
        args: list[str],
        *,
        allowed_tools: frozenset[str] = ALLOWED_TOOLS,
        call_timeout_s: float = DEFAULT_CALL_TIMEOUT_SECONDS,
        start_timeout_s: float = START_TIMEOUT_SECONDS,
        ping_timeout_s: float = PING_TIMEOUT_SECONDS,
    ) -> None:
        self._command = command
        self._args = list(args)
        self._allowed_tools = frozenset(allowed_tools)
        self._call_timeout = timedelta(seconds=call_timeout_s)
        self._start_timeout_s = start_timeout_s
        self._ping_timeout = timedelta(seconds=ping_timeout_s)
        self._session: ClientSession | None = None
        self._owner: asyncio.Task | None = None
        self._stop: asyncio.Event | None = None
        self._lock = asyncio.Lock()

    @property
    def is_started(self) -> bool:
        return self._session is not None

    @property
    def allowed_tools(self) -> frozenset[str]:
        return self._allowed_tools

    @property
    def call_timeout_s(self) -> float:
        return self._call_timeout.total_seconds()

    async def start(self) -> None:
        """Spawn the server and initialise the session. Idempotent."""
        if self._session is not None:
            return
        ready: asyncio.Future = asyncio.get_running_loop().create_future()
        stop = asyncio.Event()
        owner = asyncio.create_task(self._own_session(ready, stop))
        try:
            session = await ready
        except asyncio.CancelledError:
            # Our caller went away mid-start. Stop the owner too, or it would
            # finish initialising a session nothing refers to.
            stop.set()
            owner.cancel()
            raise
        except Exception as exc:
            # The owner has already exited its contexts — the subprocess is
            # gone — before handing this failure over.
            raise ProxyTransportError(f"could not start MCP server: {_describe(exc)}") from exc
        self._session = session
        self._owner = owner
        self._stop = stop

    async def _own_session(self, ready: asyncio.Future, stop: asyncio.Event) -> None:
        """Enter the transport and the session, publish the session through
        `ready`, then hold both open until `stop` is set — and exit them here,
        in this task, whichever task asked for the shutdown."""
        try:
            async with AsyncExitStack() as stack:
                # Name ourselves in the shared provenance log. Both this dashboard
                # and the agent append to one seestar-mcp log; without this our
                # records read `client: "anon-<hex>"` and neither side can tell
                # whose traffic is whose. seestar-mcp's config.py documents
                # SEESTAR_CLIENT_ID for exactly this, and stamps it on every
                # record — which is what lets session_activity.py attribute a
                # record instead of guessing from its tool tag.
                env = {**os.environ}
                env["SEESTAR_CLIENT_ID"] = effective_client_id()
                params = StdioServerParameters(
                    command=self._command, args=self._args, env=env
                )
                read, write = await stack.enter_async_context(stdio_client(params))
                # The session-wide read timeout bounds `initialize` (and is the
                # fallback for any request that does not pass its own); every
                # tool call and ping passes an explicit one.
                session = await stack.enter_async_context(
                    ClientSession(
                        read, write, read_timeout_seconds=timedelta(seconds=self._start_timeout_s)
                    )
                )
                await session.initialize()
                ready.set_result(session)
                await stop.wait()
        except asyncio.CancelledError:
            if not ready.done():
                ready.cancel()
            raise
        except BaseException as exc:  # noqa: BLE001 — reported, never lost
            if not ready.done():
                ready.set_exception(exc if isinstance(exc, Exception) else RuntimeError(_describe(exc)))
                return
            logger.warning("MCP session teardown failed: %s", _describe(exc))
        finally:
            # The session this task owned is gone whether or not anyone asked;
            # a server that died on its own must not stay "started".
            if self._owner is asyncio.current_task():
                self._session = None

    async def call(self, tool: str, arguments: dict[str, Any]) -> dict:
        """Call a tool and return its payload.

        Refuses any tool outside `allowed_tools` before anything is sent —
        or spawned. routes.call_tool checks ALLOWED_TOOLS too, but only for
        callers that go through it; this is the one place every call to the
        server passes.

        A transport failure resets the session so the next call starts a
        fresh server. A timeout does NOT, by itself: the server is pinged, and
        only one that cannot answer is reset. A slow call on a healthy server
        costs that call, not every caller behind it a respawn.
        """
        if tool not in self._allowed_tools:
            raise ProxyTransportError(
                f"refusing to call {tool!r}: not in this connection's allowlist"
            )
        async with self._lock:
            if self._session is None:
                await self.start()
            session = self._session
            assert session is not None
            try:
                result = await session.call_tool(
                    tool, arguments or {}, read_timeout_seconds=self._call_timeout
                )
            except Exception as exc:
                if _is_timeout(exc):
                    seconds = self._call_timeout.total_seconds()
                    if await self._responds_to_ping(session):
                        raise ProxyTransportError(
                            f"call to {tool!r} timed out after {seconds:g}s "
                            "(the server is still responding)"
                        ) from exc
                    await self._reset()
                    raise ProxyTransportError(
                        f"call to {tool!r} timed out after {seconds:g}s and the server "
                        "stopped responding; it will be restarted on the next call"
                    ) from exc
                await self._reset()
                raise ProxyTransportError(f"call to {tool!r} failed: {_describe(exc)}") from exc
        return _extract_payload(result)

    async def _responds_to_ping(self, session: ClientSession) -> bool:
        try:
            await session.send_request(
                types.ClientRequest(types.PingRequest()),
                types.EmptyResult,
                request_read_timeout_seconds=self._ping_timeout,
            )
        except Exception:  # noqa: BLE001 — any failure to answer is the answer
            return False
        return True

    async def aclose(self) -> None:
        """Shut the server down.

        Waits briefly for an in-flight call to finish, but not indefinitely:
        with a qa_tier2 analysis running that could be an hour, and this is
        what FastAPI's lifespan shutdown awaits. Past the grace period the
        in-flight call is torn out from under — it fails with a transport
        error, which is the honest outcome of shutting down mid-call.
        """
        try:
            await asyncio.wait_for(self._lock.acquire(), CLOSE_GRACE_SECONDS)
        except asyncio.TimeoutError:
            logger.warning("closing the MCP session with a call still in flight")
            await self._reset()
            return
        try:
            await self._reset()
        finally:
            self._lock.release()

    async def _reset(self) -> None:
        owner, stop = self._owner, self._stop
        self._session = None
        self._owner = None
        self._stop = None
        if owner is None or stop is None:
            return
        stop.set()
        # The owner exits the session and the transport itself (see
        # _own_session); stdio_client bounds the subprocess shutdown, so this
        # wait is a backstop rather than the expected path.
        done, _ = await asyncio.wait({owner}, timeout=10.0)
        if not done:
            owner.cancel()


def _extract_payload(result: Any) -> dict:
    """Pull the tool's dict out of an MCP CallToolResult.

    A tool that RAISED is not a payload: the SDK flags it via isError and the
    text block holds a traceback, not JSON. That is a different thing from a
    tool that RETURNS {"ok": false, "error": ...} — the MCP server's never-raise
    contract makes that a valid response, and the sidecar forwards it untouched.
    """
    if getattr(result, "isError", False):
        detail = next(
            (getattr(b, "text", None) for b in getattr(result, "content", []) or []),
            None,
        )
        raise ProxyTransportError(f"tool reported an error: {detail or 'no detail'}")
    for block in getattr(result, "content", []) or []:
        text = getattr(block, "text", None)
        if text is not None:
            return json.loads(text)
    structured = getattr(result, "structuredContent", None)
    if isinstance(structured, dict):
        return structured
    raise ProxyTransportError("tool returned no readable content")
