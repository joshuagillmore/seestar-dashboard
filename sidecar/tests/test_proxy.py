import sys
from pathlib import Path

import pytest

from seestar_sidecar.mcp_proxy import McpConnection, ProxyTransportError

STUB = str(Path(__file__).parent / "stub_mcp_server.py")


@pytest.fixture
async def connection():
    conn = McpConnection(command=sys.executable, args=[STUB])
    await conn.start()
    yield conn
    await conn.aclose()


async def test_call_returns_the_tools_dict_verbatim(connection):
    from tests.stub_mcp_server import CANNED_PROFILE

    assert await connection.call("get_site_profile", {}) == CANNED_PROFILE


async def test_unreachable_subprocess_raises_transport_error():
    conn = McpConnection(command=sys.executable, args=["/nonexistent/path.py"])
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


async def test_session_recovers_after_a_failed_call(connection):
    with pytest.raises(ProxyTransportError):
        await connection.call("failing_tool", {})
    from tests.stub_mcp_server import CANNED_PROFILE

    assert await connection.call("get_site_profile", {}) == CANNED_PROFILE
