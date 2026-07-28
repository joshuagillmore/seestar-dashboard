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


async def test_repeated_calls_reuse_one_session(connection):
    first = await connection.call("get_site_profile", {})
    second = await connection.call("get_site_profile", {})
    assert first == second
    assert connection.is_started
