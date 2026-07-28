"""Replay serves recorded fixtures unmodified.

The assertion compares parsed JSON, not raw bytes: JSONResponse emits compact
JSON while the fixtures on disk are pretty-printed, so byte parity was never
achievable and claiming it would be false. What it does prove is that no key is
renamed, dropped, added or retyped on the way out — the pass-through property
that actually matters.
"""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar.allowlist import ALLOWED_TOOLS
from seestar_sidecar.main import create_app

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    return TestClient(create_app())


@pytest.mark.parametrize("tool", sorted(ALLOWED_TOOLS))
def test_replay_returns_the_fixture_unmodified(client, tool):
    response = client.get(f"/api/{tool}")
    assert response.status_code == 200
    assert response.json() == json.loads((FIXTURES / f"{tool}.json").read_text())


def test_recorded_night_is_a_no_go(client):
    """Guards against someone quietly replacing the fixture with a rosier one."""
    assert client.get("/api/assess_conditions").json()["go"] is False


def test_transport_failure_uses_the_same_error_shape(monkeypatch):
    from seestar_sidecar import routes
    from seestar_sidecar.mcp_proxy import ProxyTransportError

    async def boom(request, tool, arguments):
        raise ProxyTransportError("subprocess died")

    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)
    monkeypatch.setattr(routes, "call_tool", boom)
    response = TestClient(create_app()).get("/api/get_site_profile")
    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert "subprocess died" in body["error"]


def test_missing_fixture_uses_the_standard_error_shape(monkeypatch):
    """A fixture that has not been recorded yet must stay diagnosable.

    load_fixture raises FileNotFoundError with a pointer to record.py. If that
    escapes _serve it becomes a generic 500 and the pointer is lost — on the one
    path built specifically for offline work. This bites the first time a tool is
    allowlisted before its fixture is recorded, which is what slice 2 does.
    """
    from seestar_sidecar import routes

    def missing(tool: str) -> dict:
        raise FileNotFoundError(f"no fixture for {tool!r} — run record.py")

    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    monkeypatch.setattr(routes, "load_fixture", missing)
    response = TestClient(create_app()).get("/api/get_site_profile")
    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert "record.py" in body["error"]


# --- lifespan ------------------------------------------------------------
#
# TestClient only emits ASGI startup/shutdown events inside a `with` block.
# Every test above constructs it bare, so none of them exercise the lifespan —
# these do. Without them the connection wiring ships with no coverage at all.


def test_lifespan_creates_a_connection_in_live_mode(monkeypatch):
    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)
    app = create_app()
    with TestClient(app):
        assert app.state.connection is not None
    assert app.state.connection is None  # closed and cleared on shutdown


def test_lifespan_creates_no_connection_in_replay(monkeypatch):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    app = create_app()
    with TestClient(app):
        assert app.state.connection is None


def test_each_app_owns_its_connection(monkeypatch):
    """Two apps in one process must not share connection state."""
    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)
    first, second = create_app(), create_app()
    with TestClient(first), TestClient(second):
        assert first.state.connection is not second.state.connection
