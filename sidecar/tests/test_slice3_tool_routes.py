"""Proves the slice-3 tool routes forward their query parameters into the
actual tool-call arguments — a property the replay-mode tests in
test_replay.py CANNOT prove, because replay ignores arguments entirely
(`load_fixture(tool)` is keyed only by tool name — see routes._fetch). A
route that accepted `?session_start_utc=...` and silently dropped it before
calling the tool would still pass every replay test and still return 200; it
would only be caught here, where `routes.call_tool` is monkeypatched to
record exactly what it was called with (live mode, not replay).

This is the "field that was never wired" trap named in the slice-3 report
brief: a value supplied on the wire must be checked to actually reach the
tool call, not just that a response comes back.
"""
import pytest
from fastapi.testclient import TestClient

from seestar_sidecar import routes
from seestar_sidecar.main import create_app


@pytest.fixture(autouse=True)
def live_mode(monkeypatch):
    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)


@pytest.fixture
def client(tmp_path, monkeypatch):
    calls = []

    async def recording_call_tool(request, tool, arguments):
        calls.append((tool, arguments))
        return {"ok": True}

    monkeypatch.setattr(routes, "call_tool", recording_call_tool)
    app = create_app(
        archive_dir=tmp_path / "no-archive",
        catalog_path=tmp_path / "no-catalog.json",
        aliases_path=tmp_path / "no-aliases.json",
    )
    return TestClient(app), calls


def test_get_target_observability_forwards_target_and_omits_date_when_absent(client):
    test_client, calls = client
    response = test_client.get("/api/get_target_observability?target=M27")

    assert response.status_code == 200
    assert calls == [("get_target_observability", {"target": "M27", "date": None})]


def test_get_target_observability_forwards_an_explicit_date(client):
    test_client, calls = client
    test_client.get("/api/get_target_observability?target=M31&date=2026-08-01T00:00:00Z")

    assert calls == [
        ("get_target_observability", {"target": "M31", "date": "2026-08-01T00:00:00Z"})
    ]


def test_get_target_observability_without_a_target_is_a_422_not_a_tool_call(client):
    test_client, calls = client
    response = test_client.get("/api/get_target_observability")

    assert response.status_code == 422
    assert calls == []  # never reached call_tool at all


def test_check_night_guardrails_forwards_the_required_param_and_tool_defaults(client):
    test_client, calls = client
    test_client.get("/api/check_night_guardrails?session_start_utc=2026-07-30T02:00:00Z")

    assert calls == [
        (
            "check_night_guardrails",
            {
                "session_start_utc": "2026-07-30T02:00:00Z",
                "max_session_hours": 10.0,
                "battery_floor_pct": 20.0,
                "dawn_margin_min": 15.0,
            },
        )
    ]


def test_check_night_guardrails_forwards_explicit_overrides(client):
    test_client, calls = client
    test_client.get(
        "/api/check_night_guardrails"
        "?session_start_utc=2026-07-30T02:00:00Z"
        "&max_session_hours=6"
        "&battery_floor_pct=30"
        "&dawn_margin_min=20"
    )

    assert calls == [
        (
            "check_night_guardrails",
            {
                "session_start_utc": "2026-07-30T02:00:00Z",
                "max_session_hours": 6.0,
                "battery_floor_pct": 30.0,
                "dawn_margin_min": 20.0,
            },
        )
    ]


def test_check_night_guardrails_without_session_start_utc_is_a_422_not_a_tool_call(client):
    test_client, calls = client
    response = test_client.get("/api/check_night_guardrails")

    assert response.status_code == 422
    assert calls == []


@pytest.mark.parametrize(
    "path,tool",
    [
        ("/api/get_view_state", "get_view_state"),
        ("/api/get_status", "get_status"),
        ("/api/get_focuser_position", "get_focuser_position"),
        ("/api/qa_tier1", "qa_tier1"),
    ],
)
def test_no_arg_slice3_routes_call_the_expected_tool_with_no_arguments(client, path, tool):
    test_client, calls = client
    test_client.get(path)

    assert calls == [(tool, {})]
