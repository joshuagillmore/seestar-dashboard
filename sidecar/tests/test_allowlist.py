"""The allowlist is the structural enforcement of read-only discipline.

A tool with side effects must have no route at all — not a 403, which would
still confirm the endpoint exists. These tests fail loudly if anyone adds one.
"""
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar.allowlist import ALLOWED_TOOLS, FORBIDDEN_TOOLS, SIDECAR_ROUTES
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


def test_sidecar_routes_are_disjoint_from_the_tool_lists():
    """SIDECAR_ROUTES names a sidecar-computed view, never a tool — if a name
    ever appeared in both ALLOWED_TOOLS and SIDECAR_ROUTES, the route-set
    invariant below would stop being an equality check on two disjoint ideas
    and start silently tolerating an overlap.
    """
    assert not (SIDECAR_ROUTES & ALLOWED_TOOLS)
    assert not (SIDECAR_ROUTES & FORBIDDEN_TOOLS)


def test_allowlist_is_exactly_the_expected_tools():
    assert ALLOWED_TOOLS == frozenset(
        {
            "assess_conditions",
            "plan_targets",
            "get_site_profile",
            "list_projects",
            "recommend_projects",
        }
    )


def test_registered_routes_are_exactly_health_plus_the_allowlist_plus_sidecar_routes():
    """The parametrised FORBIDDEN_TOOLS test above only fails for a listed
    tool. A route for a side-effecting tool nobody thought to list — the live
    server already has several ALLOWED_TOOLS and FORBIDDEN_TOOLS both miss
    (simulate_night, check_night_guardrails, suggest_horizon_mask, qa_tier1,
    qa_tier2) — sails straight through it. This does not enumerate tools at
    all: it demands the registered /api/* route set equal exactly what the
    allowlist permits, so ANY unlisted route fails it, named or not.

    SIDECAR_ROUTES is folded into the same equality rather than the
    invariant being loosened to "registered routes are a superset of the
    allowlist" — projects_combined is not a tool (see allowlist.py), but it
    is still part of this app's declared read surface, and an equality check
    that quietly ignored it would stop catching an undeclared third route
    the same way it already catches an undeclared tool route.
    """
    app = create_app()
    registered = {route.path for route in app.routes if route.path.startswith("/api")}
    expected = (
        {"/api/health"}
        | {f"/api/{tool}" for tool in ALLOWED_TOOLS}
        | {f"/api/{name}" for name in SIDECAR_ROUTES}
    )
    assert registered == expected


async def test_call_tool_refuses_a_non_allowlisted_tool_name():
    """The route-absence tests above only prove a forbidden tool has no URL
    to reach call_tool through. SIDECAR_ROUTES is the first route class where
    a handler's URL name and the tool it calls internally can differ (a
    hypothetical /api/session_wrapup calling qa_session_report, say) — a
    mistake there would sail past both the FORBIDDEN_TOOLS route-absence
    test and the route-set invariant, since neither inspects a handler's
    body. This is the guard that would still catch it.

    Passing `request=None` is deliberate: the check must fire before
    call_tool ever touches `request.app.state`, so this needs no app, no
    client, and no connection to prove it.
    """
    from seestar_sidecar import routes
    from seestar_sidecar.mcp_proxy import ProxyTransportError

    with pytest.raises(ProxyTransportError):
        await routes.call_tool(None, "qa_session_report", {})


def test_call_tool_guard_survives_python_dash_o():
    """The guard is a `raise`, not an `assert` (see call_tool's docstring),
    specifically because `python -O` / PYTHONOPTIMIZE=1 compiles assert
    statements out of the bytecode entirely — proven for real in this repo:
    `python -c "assert False"` raises, `python -O -c "assert False"` prints
    nothing and exits 0.

    -O is a compile-time flag on the whole interpreter process, not
    something an in-process monkeypatch can simulate, so this runs the real
    check in a real `-O` subprocess rather than asserting on -O's documented
    behaviour from the outside.
    """
    script = (
        "import asyncio\n"
        "from seestar_sidecar import routes\n"
        "from seestar_sidecar.mcp_proxy import ProxyTransportError\n"
        "try:\n"
        "    asyncio.run(routes.call_tool(None, 'qa_session_report', {}))\n"
        "except ProxyTransportError:\n"
        "    print('GUARD_HELD')\n"
    )
    result = subprocess.run(
        [sys.executable, "-O", "-c", script],
        capture_output=True,
        text=True,
        cwd=Path(__file__).resolve().parents[1],
    )
    assert result.returncode == 0, result.stderr
    assert "GUARD_HELD" in result.stdout, result.stderr
