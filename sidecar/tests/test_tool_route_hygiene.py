"""Every tool-backed route: a secret in an upstream error never reaches the
client, and a non-finite number never turns a response into a bare 500.

Stubbed at the CONNECTION (app.state.connection / qa_connection), not at
routes.call_tool — the choke point these properties live in is between the
two, and a stub above it would bypass exactly what is under test.

Why redaction is structural now: plan_targets and projects_combined returned
`str(exc)` and raw `{ok: false}` payloads without redaction, and QA job
errors reached /api/qa_analysis_status the same way. Each route had to
remember; three forgot. Every tool payload and every tool-call failure is
now cleaned in routes._call_tool_on_app, which is the only way to reach a
connection, so a new route cannot forget.
"""
import math
import time

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar import routes
from seestar_sidecar.allowlist import ALLOWED_TOOLS, NO_DIRECT_ROUTE_TOOLS
from seestar_sidecar.main import create_app
from seestar_sidecar.mcp_proxy import ProxyTransportError

SECRET = "hunter2SECRETvalue"
#: Shaped like the real leak: httpx's HTTPStatusError embeds the whole URL.
LEAKY_ERROR = (
    "Client error '401 Unauthorized' for url "
    f"'https://my.meteoblue.com/packages/basic-1h?lat=51.4778&apikey={SECRET}'"
)

#: Query strings the routes need to be callable at all. A tool route missing
#: from here still gets exercised (with no params) — see _tool_routes().
_REQUIRED_PARAMS = {
    "check_night_guardrails": {"session_start_utc": "2026-01-01T00:00:00+00:00"},
    "get_target_observability": {"target": "M31"},
}

#: Sidecar routes that call a tool internally. Listed by hand because a route
#: name says nothing about what its handler calls — that is the gap this
#: whole file exists for.
_COMPOSITE_ROUTES = ["projects_combined", "live_preview", "last_stack"]


def _tool_routes() -> list[str]:
    direct = sorted(ALLOWED_TOOLS - NO_DIRECT_ROUTE_TOOLS)
    return direct + _COMPOSITE_ROUTES


class ScriptedConnection:
    def __init__(self, behaviour):
        self._behaviour = behaviour

    async def call(self, tool, arguments):
        return self._behaviour(tool)

    async def aclose(self):  # the lifespan closes whatever is on app.state
        pass


def _returns_ok_false(tool):
    return {"ok": False, "error": LEAKY_ERROR}


def _raises(tool):
    raise ProxyTransportError(f"call to {tool!r} failed: {LEAKY_ERROR}")


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)
    archive = tmp_path / "archive"
    subs = archive / "M 31-sub"
    subs.mkdir(parents=True)
    for i in range(3):
        (subs / f"Light_M 31_10.0s_IRCUT_20240102-17232{i}.fit").write_text("fit", encoding="utf-8")
    share = tmp_path / "share"
    share.mkdir()
    return create_app(
        archive_dir=archive,
        qa_cache_dir=tmp_path / "qa_cache",
        catalog_path=tmp_path / "no-catalog.json",
        aliases_path=tmp_path / "no-aliases.json",
        image_cache_dir=tmp_path / "images",
        live_share_dir=share,
        provenance_path=tmp_path / "provenance.jsonl",
    )


def _wire(app, behaviour):
    app.state.connection = ScriptedConnection(behaviour)
    app.state.qa_connection = ScriptedConnection(behaviour)


@pytest.mark.parametrize("behaviour", [_returns_ok_false, _raises], ids=["ok_false", "raises"])
@pytest.mark.parametrize("route", _tool_routes())
def test_a_secret_in_an_upstream_error_never_reaches_the_client(app, route, behaviour):
    _wire(app, behaviour)
    client = TestClient(app)

    response = client.get(f"/api/{route}", params=_REQUIRED_PARAMS.get(route, {}))

    assert SECRET not in response.text, f"/api/{route} leaked the secret: {response.text}"


@pytest.mark.parametrize("behaviour", [_returns_ok_false, _raises], ids=["ok_false", "raises"])
def test_a_secret_in_a_qa_job_error_never_reaches_the_client(app, behaviour):
    with TestClient(app) as client:
        _wire(app, behaviour)
        start = client.post(
            "/api/qa_analysis_start", params={"target": "M31"}, headers={routes.CLIENT_HEADER: "t"}
        )
        assert SECRET not in start.text
        deadline = time.monotonic() + 10
        while True:
            status = client.get("/api/qa_analysis_status", params={"target": "M31"})
            if status.json()["status"] != "running" or time.monotonic() > deadline:
                break
            time.sleep(0.01)

    assert status.json()["status"] == "failed"
    assert SECRET not in status.text, status.text
    # Redacted, not emptied: the rest of the message is the diagnosis.
    assert "401 Unauthorized" in status.json()["error"]


def test_every_direct_tool_route_is_covered():
    """A new allowlisted tool gets a route, and so is swept in above
    automatically — this only checks the helper still derives from the
    allowlist rather than a hand-kept list that could drift."""
    assert set(ALLOWED_TOOLS - NO_DIRECT_ROUTE_TOOLS) <= set(_tool_routes())


# --- non-finite numbers -----------------------------------------------------
#
# JSON has no NaN or Infinity. Starlette's JSONResponse renders with
# allow_nan=False, so a tool payload carrying one raised ValueError inside
# the route and came back as a bare, non-JSON 500. Every metric in these
# payloads is already nullable, so a non-finite value becomes null.


def _payload_with_non_finite_numbers(tool):
    return {
        "ok": True,
        "value": math.nan,
        "nested": {"list": [1.5, math.inf, -math.inf], "fine": 2.0},
    }


@pytest.mark.parametrize("route", sorted(ALLOWED_TOOLS - NO_DIRECT_ROUTE_TOOLS))
def test_a_non_finite_number_becomes_null_not_a_500(app, route):
    _wire(app, _payload_with_non_finite_numbers)
    client = TestClient(app)

    response = client.get(f"/api/{route}", params=_REQUIRED_PARAMS.get(route, {}))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["value"] is None
    assert body["nested"] == {"list": [1.5, None, None], "fine": 2.0}


def test_a_qa_report_with_a_nan_metric_is_still_servable(app):
    def report(tool):
        return {
            "ok": True,
            "summary": {"subs": [{"name": "a", "verdict": "PASS", "metrics": {"fwhm": math.nan}}]},
            "keep_list": ["a"],
        }

    with TestClient(app) as client:
        _wire(app, report)
        client.post(
            "/api/qa_analysis_start", params={"target": "M31"}, headers={routes.CLIENT_HEADER: "t"}
        )
        deadline = time.monotonic() + 10
        while True:
            status = client.get("/api/qa_analysis_status", params={"target": "M31"})
            if status.status_code != 200 or status.json()["status"] != "running":
                break
            if time.monotonic() > deadline:
                break
            time.sleep(0.01)

    assert status.status_code == 200, status.text
    assert status.json()["report"]["summary"]["subs"][0]["metrics"]["fwhm"] is None


def test_a_cached_report_written_with_nan_before_this_fix_is_still_servable(app, tmp_path):
    """Cache files written by an older sidecar can hold a bare NaN (json.dump
    allows it by default). Loading one must not 500 every poll for ever."""
    import json

    from seestar_sidecar import qa_analysis

    cache_dir = tmp_path / "qa_cache"
    cache_dir.mkdir()
    subs = sorted((tmp_path / "archive" / "M 31-sub").glob("*.fit"))
    (cache_dir / "M31.json").write_text(
        json.dumps(
            {
                "target_id": "M31",
                "signature": qa_analysis.compute_signature(subs),
                "analysed_at": "2026-01-01T00:00:00+00:00",
                "result": {"ok": True, "summary": {"subs": [{"metrics": {"snr": float("nan")}}]}},
            }
        ),
        encoding="utf-8",
    )

    response = TestClient(app).get("/api/qa_analysis_status", params={"target": "M31"})

    assert response.status_code == 200, response.text
    assert response.json()["report"]["summary"]["subs"][0]["metrics"]["snr"] is None
