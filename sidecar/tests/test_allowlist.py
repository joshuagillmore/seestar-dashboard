"""The allowlist is the structural enforcement of read-only discipline.

A tool with side effects must have no route at all — not a 403, which would
still confirm the endpoint exists. These tests fail loudly if anyone adds one.
"""
import pytest
from fastapi.testclient import TestClient

from seestar_sidecar.allowlist import ALLOWED_TOOLS, FORBIDDEN_TOOLS
from seestar_sidecar.main import create_app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    return TestClient(create_app())


def test_health_reports_replay_mode(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "replay": True}


@pytest.mark.parametrize("tool", sorted(FORBIDDEN_TOOLS))
def test_side_effecting_tools_have_no_route(client, tool):
    assert client.get(f"/api/{tool}").status_code == 404


def test_allowlist_and_forbidden_list_are_disjoint():
    assert not (ALLOWED_TOOLS & FORBIDDEN_TOOLS)


def test_slice_one_allowlist_is_exactly_three_tools():
    assert ALLOWED_TOOLS == frozenset(
        {"assess_conditions", "plan_targets", "get_site_profile"}
    )
