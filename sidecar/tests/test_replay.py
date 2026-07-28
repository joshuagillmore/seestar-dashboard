"""Replay serves recorded fixtures byte-for-byte.

The byte-identity assertion is the point: it proves the sidecar is a pass-through
and does not reshape tool payloads on the way out.
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

    async def boom(tool, arguments):
        raise ProxyTransportError("subprocess died")

    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)
    monkeypatch.setattr(routes, "call_tool", boom)
    response = TestClient(create_app(), raise_server_exceptions=False).get(
        "/api/get_site_profile"
    )
    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert "subprocess died" in body["error"]
