import asyncio
import sys
import time
from pathlib import Path

import pytest

from seestar_sidecar import mcp_proxy
from seestar_sidecar.allowlist import FORBIDDEN_TOOLS
from seestar_sidecar.mcp_proxy import McpConnection, ProxyTransportError
from tests.stub_mcp_server import CANNED_PROFILE

STUB = str(Path(__file__).parent / "stub_mcp_server.py")

#: The stub's tools are test fixtures, not seestar-mcp tools, so they are not
#: in ALLOWED_TOOLS — and McpConnection itself refuses anything outside the
#: set it was built with (see test_the_connection_itself_refuses_*). Tests
#: that drive the stub name its tools explicitly rather than widening the
#: production allowlist to fit them.
STUB_TOOLS = frozenset(
    {
        "get_site_profile",
        "whoami",
        "failing_tool",
        "crash_the_server",
        "slow_tool",
        "blocking_tool",
        "exit_soon",
    }
)


def _stub_connection(**overrides) -> McpConnection:
    kwargs = dict(allowed_tools=STUB_TOOLS)
    kwargs.update(overrides)
    return McpConnection(command=sys.executable, args=[STUB], **kwargs)


@pytest.fixture
async def connection():
    conn = _stub_connection()
    await conn.start()
    yield conn
    await conn.aclose()


async def test_call_returns_the_tools_dict_verbatim(connection):
    assert await connection.call("get_site_profile", {}) == CANNED_PROFILE


async def test_unreachable_subprocess_raises_transport_error():
    conn = McpConnection(
        command=sys.executable, args=["/nonexistent/path.py"], allowed_tools=STUB_TOOLS
    )
    with pytest.raises(ProxyTransportError):
        await conn.start()


async def test_repeated_calls_reuse_one_subprocess(connection):
    """Same pid twice proves one session.

    Comparing canned payloads would NOT prove it — a regressed call() that tore
    down and respawned the server on every invocation returns identical dicts
    and still leaves is_started true. The pid is what distinguishes reuse from
    the per-call spawn this design rules out.
    """
    first = await connection.call("whoami", {})
    second = await connection.call("whoami", {})
    assert first["pid"] == second["pid"]
    assert connection.is_started


async def test_tool_level_failure_surfaces_as_transport_error(connection):
    """A tool that RAISED must not be mistaken for a payload.

    Distinct from a tool that RETURNS {"ok": false, "error": ...} — that is a
    valid response the sidecar forwards untouched (see Task 4). This covers the
    tool raising, where the result carries a traceback rather than JSON.
    """
    with pytest.raises(ProxyTransportError):
        await connection.call("failing_tool", {})


async def test_a_raising_tool_leaves_the_session_intact(connection):
    """isError is not a transport failure — the subprocess is still healthy.

    Deliberately NOT named "recovers": nothing was reset, so there is nothing
    to recover from. Conflating this with the reset path is how the reset path
    went untested in the first place.
    """
    with pytest.raises(ProxyTransportError):
        await connection.call("failing_tool", {})
    assert connection.is_started
    assert await connection.call("get_site_profile", {}) == CANNED_PROFILE


async def test_transport_failure_mid_call_resets_the_session(connection):
    """The subprocess dies, so call_tool() itself raises.

    This is the ONLY path that reaches call()'s except branch and its
    _reset(). It is what recovers the connection when the MCP server dies
    mid-session — the failure a night-long polling dashboard will actually
    hit — so it must be covered.
    """
    with pytest.raises(ProxyTransportError):
        await connection.call("crash_the_server", {})
    assert not connection.is_started


async def test_session_restarts_after_a_transport_failure(connection):
    with pytest.raises(ProxyTransportError):
        await connection.call("crash_the_server", {})
    assert await connection.call("get_site_profile", {}) == CANNED_PROFILE
    assert connection.is_started


# --- the allowlist is enforced by the connection itself ----------------------
#
# routes.call_tool checks ALLOWED_TOOLS, but that guard only covers callers
# that go through it. McpConnection.call is the one place every call to the
# server passes, so a caller that reached the connection some other way — a
# new route, a background task, a script — still cannot send `park`.


@pytest.mark.parametrize("tool", sorted(FORBIDDEN_TOOLS))
async def test_the_connection_itself_refuses_a_forbidden_tool(tool):
    conn = McpConnection(command=sys.executable, args=[STUB])  # production default

    with pytest.raises(ProxyTransportError, match="allowlist"):
        await conn.call(tool, {})

    # Refused before anything was spawned, not after a round trip.
    assert not conn.is_started


async def test_the_default_allowlist_is_the_production_one():
    from seestar_sidecar.allowlist import ALLOWED_TOOLS

    conn = McpConnection(command=sys.executable, args=[STUB])
    assert conn.allowed_tools == ALLOWED_TOOLS


# --- timeouts ---------------------------------------------------------------
#
# Every call used to wait on one lock with no timeout: a hung call held it, and
# every live poll behind it, forever.


async def test_a_slow_call_times_out_without_resetting_a_healthy_session():
    """The server is still answering (it responds to a ping), so the session
    is kept: tearing down a healthy server because one call was slow would
    cost every other caller a respawn for nothing."""
    conn = _stub_connection(call_timeout_s=0.5, ping_timeout_s=2.0)
    try:
        pid = (await conn.call("whoami", {}))["pid"]
        started = time.monotonic()
        with pytest.raises(ProxyTransportError, match="timed out"):
            await conn.call("slow_tool", {"seconds": 10})
        assert time.monotonic() - started < 5, "the call was not bounded by the timeout"

        assert conn.is_started
        assert (await conn.call("whoami", {}))["pid"] == pid
    finally:
        await conn.aclose()


async def test_a_call_that_hangs_the_server_resets_the_session():
    """A server that cannot answer a ping is not healthy: keeping it would
    leave every later call to time out against it in turn."""
    conn = _stub_connection(call_timeout_s=0.5, ping_timeout_s=0.5)
    try:
        pid = (await conn.call("whoami", {}))["pid"]
        with pytest.raises(ProxyTransportError, match="timed out"):
            await conn.call("blocking_tool", {"seconds": 10})
        assert not conn.is_started

        # And the next call gets a fresh server rather than the wedged one.
        assert (await conn.call("whoami", {}))["pid"] != pid
    finally:
        await conn.aclose()


async def test_a_timed_out_call_releases_the_lock_for_the_next_caller():
    conn = _stub_connection(call_timeout_s=0.5, ping_timeout_s=2.0)
    try:
        await conn.start()
        slow = asyncio.create_task(conn.call("slow_tool", {"seconds": 30}))
        await asyncio.sleep(0.05)
        started = time.monotonic()
        assert await conn.call("get_site_profile", {}) == CANNED_PROFILE
        assert time.monotonic() - started < 5
        with pytest.raises(ProxyTransportError):
            await slow
    finally:
        await conn.aclose()


async def test_a_server_that_never_initialises_fails_start_within_the_timeout():
    conn = McpConnection(
        command=sys.executable,
        args=["-c", "import time; time.sleep(60)"],
        allowed_tools=STUB_TOOLS,
        start_timeout_s=1.0,
    )
    started = time.monotonic()
    with pytest.raises(ProxyTransportError, match="could not start"):
        await conn.start()
    assert time.monotonic() - started < 15
    assert not conn.is_started


# --- teardown ---------------------------------------------------------------


async def test_closing_from_a_different_task_tears_down_cleanly(monkeypatch):
    """The session's anyio task groups were entered in whichever request task
    happened to start the server, and exited in whichever task later reset or
    closed it — the lifespan's, or another request's. anyio refuses that
    ("Attempted to exit cancel scope in a different task than it was entered
    in"), and _reset swallowed the error, so teardown silently stopped part
    way. Closing from a second task must now exit cleanly."""
    teardown_errors: list[BaseException] = []
    real_session = mcp_proxy.ClientSession

    class SpyingSession(real_session):
        async def __aexit__(self, *exc_info):
            try:
                return await super().__aexit__(*exc_info)
            except BaseException as exc:
                teardown_errors.append(exc)
                raise

    monkeypatch.setattr(mcp_proxy, "ClientSession", SpyingSession)
    conn = _stub_connection()

    async def start_in_one_task():
        await conn.start()
        await conn.call("whoami", {})

    await asyncio.create_task(start_in_one_task())
    await asyncio.create_task(conn.aclose())

    assert teardown_errors == []
    assert not conn.is_started


async def test_the_first_call_after_an_idle_death_names_what_failed():
    """A server that died between calls surfaces on the next call as an
    exception whose str() is empty (anyio's ClosedResourceError), which used to
    render as `call to 'whoami' failed: ` — a 502 with no reason at all."""
    conn = _stub_connection()
    try:
        await conn.call("exit_soon", {})
        await asyncio.sleep(1.0)
        with pytest.raises(ProxyTransportError) as raised:
            await conn.call("whoami", {})
        message = str(raised.value)
        reason = message.split("failed:", 1)[-1].strip()
        assert reason, f"empty failure reason: {message!r}"
    finally:
        await conn.aclose()


async def test_closing_past_the_grace_period_fails_the_in_flight_call_promptly(monkeypatch):
    """aclose() gives an in-flight call CLOSE_GRACE_SECONDS, then tears the
    session down. That used to leave the call waiting: ClientSession.__aexit__
    cancels the SDK's receive loop, whose `finally` (the part that tells
    pending requests the connection closed) then runs under that cancellation
    and delivers nothing. The call hung until its own read timeout — an hour,
    for qa_tier2. It must fail with a transport error at the grace period."""
    monkeypatch.setattr(mcp_proxy, "CLOSE_GRACE_SECONDS", 0.5)
    # Shaped like qa_tier2: a long read timeout, a server too busy to answer.
    conn = _stub_connection(call_timeout_s=60.0)
    await conn.start()
    in_flight = asyncio.create_task(conn.call("blocking_tool", {"seconds": 30}))
    await asyncio.sleep(0.3)
    assert not in_flight.done()

    started = time.monotonic()
    closing = asyncio.create_task(conn.aclose())
    try:
        with pytest.raises(ProxyTransportError, match="closed"):
            await asyncio.wait_for(in_flight, timeout=10)
        # Grace 0.5 s; the unfixed call waits out its 60 s read timeout.
        assert time.monotonic() - started < 5, "the call outlived the grace period"
    finally:
        await closing
    assert not conn.is_started


async def test_a_cancelled_caller_is_still_cancelled_not_turned_into_a_transport_error():
    """The scope aclose() cancels catches only its own cancellation. A caller
    that goes away (a client disconnect) must still see CancelledError."""
    conn = _stub_connection(call_timeout_s=60.0)
    try:
        await conn.start()
        call = asyncio.create_task(conn.call("slow_tool", {"seconds": 30}))
        await asyncio.sleep(0.3)
        call.cancel()
        with pytest.raises(asyncio.CancelledError):
            await call
    finally:
        await conn.aclose()
