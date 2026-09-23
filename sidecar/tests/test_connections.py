"""The app runs two MCP connections — two server processes — and routes each
tool to the right one.

qa_tier2 takes minutes and blocks its server's event loop for the whole run
(upstream analyze_session() is synchronous). On the one shared connection it
held the call lock for minutes, so every live poll — get_view_state,
get_status — queued behind a QA analysis. It now has a connection of its own.
"""
import pytest
from fastapi.testclient import TestClient

from seestar_sidecar import main, routes
from seestar_sidecar.allowlist import ALLOWED_TOOLS
from seestar_sidecar.mcp_proxy import (
    DEFAULT_CALL_TIMEOUT_SECONDS,
    LONG_RUNNING_TOOLS,
    QA_CALL_TIMEOUT_SECONDS,
)


class FakeConnection:
    instances: list["FakeConnection"] = []

    def __init__(self, command, args, **kwargs):
        self.command = command
        self.args = args
        self.kwargs = kwargs
        self.calls: list[str] = []
        self.closed = False
        self.raise_on_close = False
        FakeConnection.instances.append(self)

    async def call(self, tool, arguments):
        self.calls.append(tool)
        return {"ok": True, "from": id(self)}

    async def aclose(self):
        self.closed = True
        if self.raise_on_close:
            raise RuntimeError("teardown blew up")


@pytest.fixture
def live_app(monkeypatch):
    FakeConnection.instances = []
    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)
    monkeypatch.setattr(main, "SEESTAR_AI_DIR", "/somewhere/seestar-mcp")
    monkeypatch.setattr(main, "McpConnection", FakeConnection)
    return main.create_app()


def test_the_lifespan_builds_a_shared_connection_and_a_qa_one(live_app):
    with TestClient(live_app):
        shared = live_app.state.connection
        qa = live_app.state.qa_connection

    assert shared is not qa
    assert len(FakeConnection.instances) == 2
    # Each connection accepts only the tools it exists for, so a mistake in
    # routing is a refusal, not a minutes-long call on the wrong process.
    assert shared.kwargs["allowed_tools"] == ALLOWED_TOOLS - LONG_RUNNING_TOOLS
    assert qa.kwargs["allowed_tools"] == LONG_RUNNING_TOOLS
    assert shared.kwargs.get("call_timeout_s", DEFAULT_CALL_TIMEOUT_SECONDS) <= 60
    assert qa.kwargs["call_timeout_s"] == QA_CALL_TIMEOUT_SECONDS


def test_shutdown_closes_both_connections(live_app):
    with TestClient(live_app):
        shared = live_app.state.connection
        qa = live_app.state.qa_connection

    assert shared.closed and qa.closed
    assert live_app.state.connection is None
    assert live_app.state.qa_connection is None


def test_a_failing_close_does_not_leave_the_other_server_running(live_app):
    with pytest.raises(RuntimeError):
        with TestClient(live_app):
            live_app.state.connection.raise_on_close = True
            qa = live_app.state.qa_connection

    assert qa.closed


def test_qa_tier2_goes_to_the_qa_connection_and_everything_else_does_not(live_app):
    import asyncio

    with TestClient(live_app) as client:
        shared = live_app.state.connection
        qa = live_app.state.qa_connection

        client.get("/api/get_status")
        asyncio.run(routes._call_tool_on_app(live_app, "qa_tier2", {"paths": []}))

    assert shared.calls == ["get_status"]
    assert qa.calls == ["qa_tier2"]


def test_long_running_tools_are_allowlisted():
    assert LONG_RUNNING_TOOLS <= ALLOWED_TOOLS
