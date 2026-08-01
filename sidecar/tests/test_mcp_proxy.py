"""The spawned MCP server must be told who is calling it.

The dashboard and the agent both append to one seestar-mcp provenance log. That
log grew a `client` field at our request (hand-back item 10) precisely so the two
can be told apart — but it defaults to `anon-<random>` unless the spawning
process sets `SEESTAR_CLIENT_ID`. Asking for the field and then not setting it
leaves the log exactly as ambiguous as before, which is what our records showed:
`client: "anon-ad89d2d7"`.

These drive the real `McpConnection.start()` with the transport stubbed. An
earlier version of this file constructed `StdioServerParameters` by hand and
asserted on what it had just built — which proves only that the test author can
build a dict.
"""

import asyncio
import os
from contextlib import asynccontextmanager

from seestar_sidecar import mcp_proxy


def _run_start(monkeypatch) -> dict:
    """Run `McpConnection.start()` with the transport stubbed; return the
    kwargs `StdioServerParameters` was actually constructed with."""
    captured: dict = {}

    class FakeParams:
        def __init__(self, command, args, env=None):
            captured.update(command=command, args=args, env=env)

    @asynccontextmanager
    async def fake_stdio_client(params):
        yield ("read", "write")

    class FakeSession:
        def __init__(self, read, write):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def initialize(self):
            return None

    monkeypatch.setattr(mcp_proxy, "StdioServerParameters", FakeParams)
    monkeypatch.setattr(mcp_proxy, "stdio_client", fake_stdio_client)
    monkeypatch.setattr(mcp_proxy, "ClientSession", FakeSession)

    conn = mcp_proxy.McpConnection("uv", ["run", "server"])
    asyncio.run(conn.start())
    return captured


def test_start_names_this_process_console_in_the_provenance_log(monkeypatch):
    monkeypatch.delenv("SEESTAR_CLIENT_ID", raising=False)

    captured = _run_start(monkeypatch)

    assert captured["env"]["SEESTAR_CLIENT_ID"] == "console"


def test_an_operator_set_client_id_is_not_overwritten(monkeypatch):
    # Someone running two consoles deserves to be able to tell them apart.
    monkeypatch.setenv("SEESTAR_CLIENT_ID", "console-laptop")

    captured = _run_start(monkeypatch)

    assert captured["env"]["SEESTAR_CLIENT_ID"] == "console-laptop"


def test_the_rest_of_the_environment_is_inherited(monkeypatch):
    # The server needs the ambient environment to run at all — PATH, plus the
    # SEESTAR_* settings the operator configured. Passing a bare dict carrying
    # only our own key would break the spawn in production while every unit
    # test still passed.
    monkeypatch.delenv("SEESTAR_CLIENT_ID", raising=False)
    monkeypatch.setenv("SEESTAR_SENTINEL_FOR_TEST", "inherited")

    captured = _run_start(monkeypatch)

    assert captured["env"]["SEESTAR_SENTINEL_FOR_TEST"] == "inherited"
    assert any(k.upper() == "PATH" for k in captured["env"])


def test_the_parent_environment_is_not_mutated(monkeypatch):
    # setdefault on os.environ itself would leak the id into this process and
    # everything else it spawns.
    monkeypatch.delenv("SEESTAR_CLIENT_ID", raising=False)

    _run_start(monkeypatch)

    assert "SEESTAR_CLIENT_ID" not in os.environ
