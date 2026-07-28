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


def test_registered_routes_are_exactly_health_plus_the_allowlist():
    """The parametrised FORBIDDEN_TOOLS test above only fails for a listed
    tool. A route for a side-effecting tool nobody thought to list — the live
    server already has several ALLOWED_TOOLS and FORBIDDEN_TOOLS both miss
    (simulate_night, check_night_guardrails, suggest_horizon_mask, qa_tier1,
    qa_tier2) — sails straight through it. This does not enumerate tools at
    all: it demands the registered /api/* route set equal exactly what the
    allowlist permits, so ANY unlisted route fails it, named or not.
    """
    app = create_app()
    registered = {route.path for route in app.routes if route.path.startswith("/api")}
    expected = {"/api/health"} | {f"/api/{tool}" for tool in ALLOWED_TOOLS}
    assert registered == expected
