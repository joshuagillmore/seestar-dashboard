"""HTTP-level tests for the slice-4 Review & QA routes: /api/qa_targets,
/api/qa_analysis_start, /api/qa_analysis_status.

`routes._call_tool_on_app` is monkeypatched throughout — the real qa_tier2
is NEVER run here (it's minutes of photutils over real FITS; see
qa_analysis.py's module docstring). This proves the route wiring: that
qa_analysis_start forwards the right paths, that a background job actually
completes and becomes visible to a later poll, that metrics.error subs and
verdicts survive untouched end to end, and that a listing read alone can
never trigger analysis.

IMPORTANT, verified empirically against this FastAPI version: an
asyncio.create_task() started inside one request only survives to be polled
by a LATER request when the TestClient is used as a context manager
(`with TestClient(app) as client:`) — that keeps one persistent event loop
running across calls. A bare `TestClient(app)` (no `with`), used by several
older test files in this repo for routes with no background work, tears down
and re-creates the loop per request, silently orphaning any in-flight task.
Every test below that starts a job therefore uses the `with` form.
"""
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar import routes
from seestar_sidecar.main import create_app

#: Same real, verified qa_tier2 shape used in test_qa_analysis.py — see that
#: file's module docstring for provenance (recorded against 5 real M74 subs
#: plus a hand-adapted metrics.error row for the "unanalysable sub" case).
REAL_REPORT = {
    "ok": True,
    "summary": {
        "target": None,
        "total": 3,
        "kept": 2,
        "wfwhm": 2.2,
        "medians": {
            "fwhm": 2.18,
            "fwhm_sigma": 0.09,
            "snr": 40.0,
            "star_count": 6.0,
            "hfr": 1.38,
            "eccentricity": 0.53,
            "scattered_light": None,
            "scattered_light_sigma": None,
            "n_analyzed": 3,
        },
        "dominant_reject_cause": "eccentricity",
        "subs": [
            {
                "name": "Light_M 31_10.0s_IRCUT_20240102-172326",
                "verdict": "REJECT",
                "reasons": ["REJECT: eccentricity 0.61 >= 0.575 cutoff"],
                "metrics": {
                    "star_count": 6,
                    "fwhm": 2.14,
                    "hfr": 1.44,
                    "eccentricity": 0.6059,
                    "snr": 36.5,
                    "background": 3964.0,
                    "scattered_light": None,
                    "error": None,
                },
            },
            {
                "name": "Light_M 31_10.0s_IRCUT_20240102-172349",
                "verdict": "PASS",
                "reasons": ["PASS: all metrics within session norms"],
                "metrics": {
                    "star_count": 7,
                    "fwhm": 2.16,
                    "hfr": 1.17,
                    "eccentricity": 0.4103,
                    "snr": 37.5,
                    "background": 3820.0,
                    "scattered_light": None,
                    "error": None,
                },
            },
            {
                "name": "Light_M 31_10.0s_IRCUT_20240102-172509",
                "verdict": "REJECT",
                "reasons": ["REJECT: could not analyze sub"],
                "metrics": {
                    "star_count": None,
                    "fwhm": None,
                    "hfr": None,
                    "eccentricity": None,
                    "snr": None,
                    "background": None,
                    "scattered_light": None,
                    "error": "corrupt FITS header",
                },
            },
        ],
    },
    "keep_list": [
        "Light_M 31_10.0s_IRCUT_20240102-172349",
    ],
}


def _write_light_fit(dir_path: Path, target_display: str, night: str, time_str: str) -> None:
    stem = f"Light_{target_display}_10.0s_IRCUT_{night}-{time_str}"
    (dir_path / f"{stem}.fit").write_text("fit", encoding="utf-8")


@pytest.fixture
def synthetic_archive(tmp_path):
    root = tmp_path / "archive"
    root.mkdir()
    subs = root / "M 31-sub"
    subs.mkdir()
    for i in range(3):
        _write_light_fit(subs, "M 31", "20240102", f"17232{i}")
    return root


@pytest.fixture
def app_factory(tmp_path, synthetic_archive):
    def make(**overrides):
        kwargs = dict(
            archive_dir=synthetic_archive,
            qa_cache_dir=tmp_path / "qa_cache",
            catalog_path=tmp_path / "no-catalog.json",
            aliases_path=tmp_path / "no-aliases.json",
        )
        kwargs.update(overrides)
        return create_app(**kwargs)

    return make


def _wait_until_not_running(client, target="M31", timeout_s=2.0):
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        body = client.get(f"/api/qa_analysis_status?target={target}").json()
        if body["status"] != "running":
            return body
        time.sleep(0.01)
    raise AssertionError("job never left 'running' within the timeout")


# --- qa_targets: never triggers analysis ------------------------------------


def test_qa_targets_lists_the_archive_target_as_not_analysed(app_factory, monkeypatch):
    def boom(app, tool, arguments):
        raise AssertionError("qa_targets must never call a tool")

    monkeypatch.setattr(routes, "_call_tool_on_app", boom)
    app = app_factory()
    with TestClient(app) as client:
        response = client.get("/api/qa_targets")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    [entry] = [t for t in body["targets"] if t["target_id"] == "M31"]
    assert entry["status"] == "not_analysed"
    assert entry["sub_count"] == 3
    assert entry["display_name"] == "M 31"
    # The listing must never embed a full per-sub report — see
    # qa_analysis.resolve_status's include_report=False for this route.
    assert "report" not in entry


def test_qa_targets_never_calls_the_tool_even_when_one_is_wired(app_factory, monkeypatch):
    """Belt and suspenders on the property above: even with a real (non-
    raising) stub installed, hitting the listing route alone must leave zero
    calls recorded — this is what "analysis is never triggered implicitly"
    actually means, proven rather than assumed from qa_targets simply having
    no call_qa_tier2 parameter in its signature.
    """
    calls = []

    async def record(app, tool, arguments):
        calls.append((tool, arguments))
        return REAL_REPORT

    monkeypatch.setattr(routes, "_call_tool_on_app", record)
    app = app_factory()
    with TestClient(app) as client:
        client.get("/api/qa_targets")
        client.get("/api/qa_targets")  # a repeat read must not change anything either

    assert calls == []


# --- qa_analysis_start: the only route that can trigger analysis -----------


def test_qa_analysis_start_for_an_unknown_target_is_a_404_not_a_tool_call(app_factory, monkeypatch):
    def boom(app, tool, arguments):
        raise AssertionError("must not reach the tool for a target with no subs on disk")

    monkeypatch.setattr(routes, "_call_tool_on_app", boom)
    app = app_factory()
    with TestClient(app) as client:
        response = client.get("/api/qa_analysis_start?target=NOSUCHTARGET")

    assert response.status_code == 404
    assert response.json()["ok"] is False


def test_qa_analysis_start_returns_running_immediately_then_completes(app_factory, monkeypatch):
    calls = []

    async def record(app, tool, arguments):
        calls.append((tool, arguments))
        return REAL_REPORT

    monkeypatch.setattr(routes, "_call_tool_on_app", record)
    app = app_factory()
    with TestClient(app) as client:
        start = client.get("/api/qa_analysis_start?target=M31")
        assert start.status_code == 200
        start_body = start.json()
        assert start_body["ok"] is True
        assert start_body["status"] == "running"
        assert "report" not in start_body  # qa_analysis_start never embeds the report

        final = _wait_until_not_running(client)

    assert final["status"] == "complete"
    assert final["report"] == REAL_REPORT
    # The tool was actually called, with the archive's 3 real sub paths —
    # proves the path resolution wiring, not just that SOMETHING ran.
    assert len(calls) == 1
    tool, arguments = calls[0]
    assert tool == "qa_tier2"
    assert len(arguments["paths"]) == 3
    assert all("M 31-sub" in p for p in arguments["paths"])


def test_verdicts_and_reasons_pass_through_unmodified(app_factory, monkeypatch):
    """CLAUDE.md: the sidecar renders/forwards verdicts, it never recomputes
    or reshapes them. Proven by exact equality against the stub's payload,
    not merely "a verdict is present".
    """

    async def record(app, tool, arguments):
        return REAL_REPORT

    monkeypatch.setattr(routes, "_call_tool_on_app", record)
    app = app_factory()
    with TestClient(app) as client:
        client.get("/api/qa_analysis_start?target=M31")
        final = _wait_until_not_running(client)

    subs = final["report"]["summary"]["subs"]
    assert subs == REAL_REPORT["summary"]["subs"]
    assert [s["verdict"] for s in subs] == ["REJECT", "PASS", "REJECT"]
    assert final["report"]["keep_list"] == REAL_REPORT["keep_list"]


def test_a_sub_with_metrics_error_survives_unfiltered(app_factory, monkeypatch):
    """Every metric is nullable; a sub that could not be analysed still
    appears with metrics.error set, not dropped and not shown as a zero.
    """

    async def record(app, tool, arguments):
        return REAL_REPORT

    monkeypatch.setattr(routes, "_call_tool_on_app", record)
    app = app_factory()
    with TestClient(app) as client:
        client.get("/api/qa_analysis_start?target=M31")
        final = _wait_until_not_running(client)

    subs = final["report"]["summary"]["subs"]
    assert len(subs) == 3  # nothing filtered out
    error_sub = subs[2]
    assert error_sub["metrics"]["error"] == "corrupt FITS header"
    assert error_sub["metrics"]["fwhm"] is None
    assert error_sub["verdict"] == "REJECT"


def test_qa_analysis_start_is_idempotent_for_an_already_running_job(app_factory, monkeypatch):
    calls = []

    async def record(app, tool, arguments):
        calls.append(arguments)
        return REAL_REPORT

    monkeypatch.setattr(routes, "_call_tool_on_app", record)
    app = app_factory()
    with TestClient(app) as client:
        first = client.get("/api/qa_analysis_start?target=M31").json()
        second = client.get("/api/qa_analysis_start?target=M31").json()
        _wait_until_not_running(client)

    assert first["status"] == "running"
    assert second["status"] in ("running", "complete")  # never a fresh "not_analysed"
    assert len(calls) == 1  # only ever ONE call to the tool for this target


def test_qa_analysis_start_does_not_recompute_after_completion(app_factory, monkeypatch):
    calls = []

    async def record(app, tool, arguments):
        calls.append(arguments)
        return REAL_REPORT

    monkeypatch.setattr(routes, "_call_tool_on_app", record)
    app = app_factory()
    with TestClient(app) as client:
        client.get("/api/qa_analysis_start?target=M31")
        _wait_until_not_running(client)

        # A second, fully independent "start" request after completion must
        # be a cache hit, not a second qa_tier2 call.
        again = client.get("/api/qa_analysis_start?target=M31").json()

    assert again["status"] == "complete"
    assert len(calls) == 1


def test_qa_analysis_status_for_a_never_started_target_is_not_analysed(app_factory):
    app = app_factory()
    with TestClient(app) as client:
        response = client.get("/api/qa_analysis_status?target=M31")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "not_analysed"
    assert body["sub_count"] == 3
    assert "report" not in body


def test_qa_analysis_status_for_an_unknown_target_degrades_honestly(app_factory):
    """Unlike qa_analysis_start, polling status for a target the archive has
    never heard of is not a 404 — it's a real (if empty) answer, since
    checking status is not an action that needs subs to exist right now.
    """
    app = app_factory()
    with TestClient(app) as client:
        response = client.get("/api/qa_analysis_status?target=NOSUCHTARGET")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "not_analysed"
    assert body["sub_count"] == 0


def test_a_failed_analysis_is_reported_not_silently_retried(app_factory, monkeypatch):
    calls = []

    async def boom(app, tool, arguments):
        calls.append(arguments)
        raise RuntimeError("MCP subprocess died mid-call")

    monkeypatch.setattr(routes, "_call_tool_on_app", boom)
    app = app_factory()
    with TestClient(app) as client:
        client.get("/api/qa_analysis_start?target=M31")
        final = _wait_until_not_running(client)

    assert final["status"] == "failed"
    assert "MCP subprocess died" in final["error"]
    assert len(calls) == 1  # never silently retried


def test_a_changed_sub_set_is_visible_as_stale_after_completion(app_factory, monkeypatch, tmp_path):
    async def record(app, tool, arguments):
        return REAL_REPORT

    monkeypatch.setattr(routes, "_call_tool_on_app", record)
    app = app_factory()
    with TestClient(app) as client:
        client.get("/api/qa_analysis_start?target=M31")
        _wait_until_not_running(client)

        # A new sub lands on disk after the analysis completed.
        subs_dir = tmp_path / "archive" / "M 31-sub"
        _write_light_fit(subs_dir, "M 31", "20240102", "180000")

        status = client.get("/api/qa_analysis_status?target=M31").json()

    assert status["status"] == "stale"
    assert status["sub_count"] == 4
    # The stale report is still attached, clearly marked, rather than hidden.
    assert status["report"] == REAL_REPORT


def test_start_and_status_return_the_same_identifying_fields(app_factory, monkeypatch):
    """A consumer polls these two interchangeably, so they must not differ by
    a field.

    They did: `qa_analysis_start` omitted `sub_count` while
    `qa_analysis_status` included it. One client schema could not describe
    both, so the browser rejected every start response and rendered a parse
    error while the job it had just launched ran to completion behind it.

    Found by clicking the button against a real archive. No test caught it
    because the client tests asserted the route was CALLED, never that its
    response parsed — and this suite only ever checked each route's own
    fields, never that the pair agreed.
    """
    async def fake_tier2(paths):
        return {"ok": True, "summary": {"subs": []}, "keep_list": []}

    monkeypatch.setattr(routes.qa_analysis, "call_qa_tier2", fake_tier2, raising=False)
    with TestClient(app_factory()) as client:
        started = client.get("/api/qa_analysis_start?target=M31").json()
        polled = client.get("/api/qa_analysis_status?target=M31").json()

    identifying = {"ok", "target_id", "sub_count"}
    assert identifying <= set(started), f"start is missing {identifying - set(started)}"
    assert identifying <= set(polled), f"status is missing {identifying - set(polled)}"
    assert started["sub_count"] == polled["sub_count"]
    assert started["target_id"] == polled["target_id"]
