"""The allowlist is the structural enforcement of read-only discipline.

A tool with side effects must have no route at all — not a 403, which would
still confirm the endpoint exists. These tests fail loudly if anyone adds one.
"""
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.routing import Route

from seestar_sidecar.allowlist import ALLOWED_TOOLS, FORBIDDEN_TOOLS, SIDECAR_ROUTES
from seestar_sidecar.main import create_app

#: FastAPI registers these itself (interactive docs + the OpenAPI schema) on
#: every app unless explicitly disabled, which this one isn't — not part of
#: our declared read surface, but real registered routes all the same, so
#: they belong in the expected set rather than being filtered out before the
#: comparison even starts (see _registered_routes' docstring below for why
#: that filtering was itself the gap).
_FASTAPI_DOC_ROUTES: dict[str, frozenset[str]] = {
    "/openapi.json": frozenset({"GET", "HEAD"}),
    "/docs": frozenset({"GET", "HEAD"}),
    "/docs/oauth2-redirect": frozenset({"GET", "HEAD"}),
    "/redoc": frozenset({"GET", "HEAD"}),
}


def _registered_routes(app) -> dict[str, frozenset[str]]:
    """path -> methods for every real Route in the app, at ANY prefix — not
    pre-filtered to paths already starting with "/api". The old version of
    this filtered first and compared paths second, which meant a route
    registered under a different prefix altogether was invisible to the
    check by construction, not merely unlisted by it. Mount (the frontend
    static-files mount at "/") is not a Route subclass and has no `.methods`,
    so it never appears here — see test_the_only_non_route_entry_is_the_
    frontend_mount for the check that covers it instead.
    """
    return {route.path: frozenset(route.methods) for route in app.routes if isinstance(route, Route)}


def _expected_routes() -> dict[str, frozenset[str]]:
    api_names = {"health"} | ALLOWED_TOOLS | SIDECAR_ROUTES
    expected = {f"/api/{name}": frozenset({"GET"}) for name in api_names}
    expected.update(_FASTAPI_DOC_ROUTES)
    return expected


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
    all: it demands the registered route set equal exactly what the
    allowlist permits, so ANY unlisted route fails it, named or not.

    SIDECAR_ROUTES is folded into the same equality rather than the
    invariant being loosened to "registered routes are a superset of the
    allowlist" — projects_combined is not a tool (see allowlist.py), but it
    is still part of this app's declared read surface, and an equality check
    that quietly ignored it would stop catching an undeclared third route
    the same way it already catches an undeclared tool route.

    Tightened (2026-07-30, see docs/slice-2-backlog.md's "Route invariant is
    path-only") to close two gaps the original, path-only version had:

    - **Method.** The old check built a set of paths and compared sets of
      paths — a POST handler added to an already-allowlisted path changed
      nothing about that set, so it passed silently. `_registered_routes()`
      compares path -> methods dicts instead, so a new method anywhere is a
      value change the equality catches. Proven by mutation in
      test_a_post_added_to_an_allowed_path_would_be_caught.
    - **Prefix.** The old check filtered `app.routes` down to paths already
      starting with "/api" *before* comparing anything, which made a route
      registered under any other prefix invisible to the check by
      construction, not merely unlisted by it — filtering out exactly the
      thing a foreign route would need to be caught. `_registered_routes()`
      inspects the whole `app.routes`, with FastAPI's own doc/schema routes
      named explicitly in `_expected_routes()` rather than filtered away, so
      there is no filter left for an unexpected prefix to hide behind. Proven
      by mutation in test_a_route_under_a_foreign_prefix_would_be_caught.
    """
    app = create_app()
    assert _registered_routes(app) == _expected_routes()


def test_the_only_non_route_entry_is_the_frontend_mount():
    """_registered_routes() above only inspects `Route` instances — a Mount
    (like the frontend's) has no `.methods` and isn't a Route subclass, so
    it's invisible to that check by the same kind of construction the
    path-only filter used to hide a foreign prefix behind. This closes that
    residual blind spot for mounts specifically: exactly one non-Route entry
    may exist in the whole app, and it must be the static-files frontend
    mount, not some new sub-application quietly mounted elsewhere.
    """
    app = create_app()
    non_routes = [route for route in app.routes if not isinstance(route, Route)]
    assert len(non_routes) == 1
    assert non_routes[0].name == "frontend"


def test_a_post_added_to_an_allowed_path_would_be_caught():
    """Proves the method comparison above is not vacuous — the exact gap the
    old path-only invariant had (see docs/slice-2-backlog.md's "Route
    invariant is path-only"): a POST handler added to /api/health, an
    already-allowlisted GET path, changes nothing about a *set of paths* but
    does change the path's own methods. Registers the extra route on the app
    directly rather than editing routes.py's source, so this is a permanent
    regression test rather than the one-off manual check the same mutation
    got during development (see this file's git history).
    """
    app = create_app()

    @app.post("/health")
    async def _extra_post_on_an_allowed_path() -> dict:
        return {"ok": True}

    assert _registered_routes(app) != _expected_routes()


def test_a_route_under_a_foreign_prefix_would_be_caught():
    """Proves the whole-app inspection above is not vacuous — the other gap
    the old path-only invariant had: a route registered under a prefix other
    than "/api" was invisible to a check that filtered `app.routes` down to
    "/api"-prefixed paths *before* comparing anything.
    """
    app = create_app()

    @app.get("/internal/debug")
    async def _route_under_a_foreign_prefix() -> dict:
        return {"ok": True}

    assert _registered_routes(app) != _expected_routes()


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
