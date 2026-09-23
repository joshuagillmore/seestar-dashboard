"""Every `list_projects` call must ask for `detail="full"`.

seestar-mcp made `detail="summary"` the DEFAULT (a66f2d3), which omits each
project's `sessions` history. Omitting rather than emptying was our own
request and is the right design — but it means the default is no longer the
payload this client parses, and neither call site was passing anything.

The two failure modes are different, and only one is loud:

  /api/list_projects     -> ProjectSchema requires `sessions`; zod rejects it.
                            Loud, immediate, obviously broken.
  /api/projects_combined -> combine_projects de-duplicates archive nights
                            against store sessions. No sessions, no
                            de-duplication, and archive_minutes inflates by
                            whatever the store already counted.
                            ProjectsCombinedEntrySchema has no `sessions`
                            field, so it parses cleanly. SILENT wrong number.

These assert on the arguments actually handed to the MCP layer, not on a
response shape a fixture could satisfy either way.
"""

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar import routes
from seestar_sidecar.main import create_app

_STORE_PROJECT = {
    "target_id": "M31",
    "target_name": "Andromeda",
    "goal_minutes": 0.0,
    "collected_minutes": 120.0,
    "status": "active",
    "created_utc": "2026-07-01T20:00:00+00:00",
    "updated_utc": "2026-07-02T20:00:00+00:00",
    "sessions": [],
    "notes": "",
}


@pytest.fixture
def captured(monkeypatch):
    """Run the routes live (not replay) with the MCP layer stubbed, recording
    every (tool, arguments) pair the route actually sends."""
    calls: list[tuple[str, dict]] = []

    async def fake_call_tool(request, tool, arguments):
        calls.append((tool, dict(arguments or {})))
        if tool == "list_projects":
            return {"ok": True, "projects": [dict(_STORE_PROJECT)], "count": 1}
        return {"ok": True}

    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)
    monkeypatch.setattr(routes, "call_tool", fake_call_tool)
    return calls


def _detail_for(calls: list[tuple[str, dict]]) -> str | None:
    for tool, args in calls:
        if tool == "list_projects":
            return args.get("detail")
    raise AssertionError(f"list_projects was never called; got {[t for t, _ in calls]}")


def test_the_list_projects_route_asks_for_full_detail(captured):
    with TestClient(create_app()) as client:
        client.get("/api/list_projects")

    assert _detail_for(captured) == "full", (
        "without detail='full' the server omits `sessions` and ProjectSchema rejects it"
    )


def test_projects_combined_asks_for_full_detail_too(captured):
    # This is the dangerous one: its failure is a wrong number, not an error.
    with TestClient(create_app()) as client:
        client.get("/api/projects_combined")

    assert _detail_for(captured) == "full", (
        "without detail='full' archive nights stop being de-duplicated and "
        "archive_minutes inflates silently"
    )


def test_recommend_projects_asks_for_full_detail_too(captured):
    """`recommend_projects` gained the same `detail` parameter in seestar-mcp
    fffa8b6, with the same `"summary"` default — which drops `sessions`, and
    RecommendProjectsSchema (= ListProjectsSchema) requires it. This test used
    to pin the opposite (that no `detail` was sent, because the tool had no
    such parameter then), which is exactly the gap that note predicted: the
    route broke against the live server with nothing here noticing.
    """
    with TestClient(create_app()) as client:
        client.get("/api/recommend_projects")

    sent = [args for tool, args in captured if tool == "recommend_projects"]
    assert sent, "recommend_projects was never called"
    assert sent[0].get("detail") == "full", (
        "without detail='full' the server omits `sessions` and the schema rejects it"
    )


def test_recommend_projects_still_forwards_its_limit(captured):
    with TestClient(create_app()) as client:
        client.get("/api/recommend_projects?limit=5")

    sent = [args for tool, args in captured if tool == "recommend_projects"]
    assert sent[0] == {"limit": 5, "detail": "full"}
