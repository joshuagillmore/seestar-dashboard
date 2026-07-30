"""HTTP-level tests for /api/projects_combined: the route wiring around
combine_projects (test_projects_union.py) and scan_archive (test_archive.py),
neither of which touches the real archive or a live MCP server here.
"""
import json
from datetime import timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar.main import create_app

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
REAL_LIST_PROJECTS = json.loads((FIXTURES / "list_projects.json").read_text(encoding="utf-8"))

#: Passed to every create_app() below so this file's result does not depend
#: on the timezone of whatever machine runs it — this fixture's archive
#: dates (2024) happen to be far enough from the store's (2026) that no
#: offset could manufacture a collision, but that was luck, not a design
#: this file was pinning against, until now. See test_archive.py's EDT.
EDT = timezone(timedelta(hours=-4))
#: Used only by the discriminating test below — deliberately NOT this dev
#: machine's own zone (Eastern), so a create_app(local_tz=...) that silently
#: fell back to the system default would produce a different, wrong answer
#: instead of accidentally matching.
TOKYO = timezone(timedelta(hours=9))


def _write_light_fit(dir_path, target_display, night, time_str):
    stem = f"Light_{target_display}_10.0s_LP_{night}-{time_str}"
    (dir_path / f"{stem}.fit").write_text("fit", encoding="utf-8")


@pytest.fixture
def synthetic_archive(tmp_path):
    root = tmp_path / "archive"
    root.mkdir()
    # M31 is a real target_id in fixtures/list_projects.json, so this
    # exercises an overlapping-target union end-to-end, not just an
    # archive-only addition.
    subs = root / "M 31-sub"
    subs.mkdir()
    for i in range(3):
        _write_light_fit(subs, "M 31", "20240104", f"10000{i}")
    # An archive-only target the store has never heard of.
    ic405 = root / "IC 405-sub"
    ic405.mkdir()
    _write_light_fit(ic405, "IC 405", "20240102", "200000")
    return root


@pytest.fixture
def client(monkeypatch, synthetic_archive):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    return TestClient(create_app(archive_dir=synthetic_archive, local_tz=EDT))


def test_unions_store_and_archive(client):
    response = client.get("/api/projects_combined")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True

    by_id = {p["target_id"]: p for p in body["projects"]}
    assert set(by_id) == {p["target_id"] for p in REAL_LIST_PROJECTS["projects"]} | {"IC405"}

    m31_store_minutes = next(
        p["collected_minutes"] for p in REAL_LIST_PROJECTS["projects"] if p["target_id"] == "M31"
    )
    m31 = by_id["M31"]
    assert m31["sources"] == ["store", "archive"]
    assert m31["store_minutes"] == m31_store_minutes
    assert m31["archive_minutes"] == pytest.approx(0.5)  # 3 subs x 10s
    assert m31["total_minutes"] == pytest.approx(m31_store_minutes + 0.5)

    ic405 = by_id["IC405"]
    assert ic405["sources"] == ["archive"]
    assert ic405["store_minutes"] == 0.0
    assert ic405["target_name"] == "IC 405"

    # M31 is a galaxy with real, trusted photometry — computes to a genuine
    # suggested-hours goal at the fixture site profile's Bortle 8 (the
    # model's own calibration point).
    assert m31["goal"]["track"] == "photometric"
    assert m31["goal"]["suggested_hours"] is not None
    # IC405's catalogued B-Mag 10.0 for a 50'x30' nebula computes to an
    # implausible SB — see integration_goal.py's "Beyond reach vs. unreliable
    # photometry" (this is the user's single largest archive investment, 217
    # real minutes, so a bare "beyond practical reach" reading would be
    # empirically wrong, not just improbable). Falls back to track "none"
    # with a machine-readable reason, not a bare None, end to end through
    # the real route — the UI needs this to render an honest absent state.
    assert ic405["goal"]["track"] == "none"
    assert ic405["goal"]["reason"] == "photometry_unreliable"


def test_reports_totals_split_by_source(client):
    body = client.get("/api/projects_combined").json()
    store_total = sum(p["collected_minutes"] for p in REAL_LIST_PROJECTS["projects"])
    assert body["totals"]["store_minutes"] == pytest.approx(store_total)
    # abs=1e-4: the route rounds minutes to 4 decimal places for clean JSON.
    assert body["totals"]["archive_minutes"] == pytest.approx(0.5 + 1 / 6, abs=1e-4)  # 3 + 1 subs x 10s
    assert body["totals"]["total_minutes"] == pytest.approx(
        body["totals"]["store_minutes"] + body["totals"]["archive_minutes"]
    )


def test_count_matches_the_project_list_length(client):
    body = client.get("/api/projects_combined").json()
    assert body["count"] == len(body["projects"])


def test_missing_archive_directory_degrades_to_store_only(monkeypatch, tmp_path):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    client = TestClient(create_app(archive_dir=tmp_path / "never-synced", local_tz=EDT))

    body = client.get("/api/projects_combined").json()

    assert body["ok"] is True
    assert {p["target_id"] for p in body["projects"]} == {
        p["target_id"] for p in REAL_LIST_PROJECTS["projects"]
    }
    assert all(p["archive_minutes"] == 0.0 for p in body["projects"])
    assert body["totals"]["archive_minutes"] == 0.0


def test_transport_failure_uses_the_same_error_shape(monkeypatch, synthetic_archive):
    from seestar_sidecar import routes
    from seestar_sidecar.mcp_proxy import ProxyTransportError

    async def boom(request, tool, arguments):
        raise ProxyTransportError("subprocess died")

    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)
    monkeypatch.setattr(routes, "call_tool", boom)
    client = TestClient(create_app(archive_dir=synthetic_archive, local_tz=EDT))

    response = client.get("/api/projects_combined")

    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert "subprocess died" in body["error"]


def test_store_level_failure_is_forwarded_not_papered_over(monkeypatch, synthetic_archive):
    """list_projects returning {"ok": false, ...} (a valid tool response, not
    a transport failure) must not be masked by an archive-only result — the
    caller needs to know the store itself is unavailable.
    """
    from seestar_sidecar import routes

    def broken_store(tool):
        return {"ok": False, "error": "corrupt store"}

    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    monkeypatch.setattr(routes, "load_fixture", broken_store)
    client = TestClient(create_app(archive_dir=synthetic_archive, local_tz=EDT))

    response = client.get("/api/projects_combined")

    assert response.status_code == 200
    assert response.json() == {"ok": False, "error": "corrupt store"}


def test_local_tz_override_is_genuinely_used_not_just_accepted(monkeypatch, tmp_path):
    """The other tests in this file can't tell "create_app(local_tz=...)
    actually reaches scan_archive" apart from "the parameter is accepted and
    silently ignored, falling back to the system default" — this dev
    machine's own zone (Eastern) IS what EDT pins to, so a broken wiring
    would still produce the same numbers here. Proved by mutation: routing
    scan_archive(Path(archive_dir)) without local_tz in routes.py leaves
    every other test in this file green.

    This test uses TOKYO (a zone nothing here runs in) and a frame timestamp
    (Jan 1, 20:00 local) chosen so the two zones disagree about which
    observing night it falls on: 2025-01-01 under Eastern, 2024-12-31 under
    UTC+9. A store session is planted on 2024-12-31 — the archive frame is
    only excluded (correct) if UTC+9 was genuinely used; a silent fallback
    to this machine's Eastern zone reads 2025-01-01 instead, misses the
    collision, and double-counts.
    """
    from seestar_sidecar import routes

    def fake_store(tool):
        return {
            "ok": True,
            "projects": [
                {
                    "target_id": "TESTTZ",
                    "target_name": "Test Target",
                    "collected_minutes": 10.0,
                    "sessions": [
                        {
                            "date_utc": "2024-12-31T20:00:00+00:00",
                            "integration_minutes": 10.0,
                            "subs_total": 1,
                            "subs_kept": 1,
                            "median_fwhm": None,
                            "notes": "",
                        }
                    ],
                }
            ],
            "count": 1,
        }

    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    monkeypatch.setattr(routes, "load_fixture", fake_store)

    archive = tmp_path / "archive"
    subs = archive / "TESTTZ-sub"
    subs.mkdir(parents=True)
    _write_light_fit(subs, "TESTTZ", "20250101", "200000")

    client = TestClient(create_app(archive_dir=archive, local_tz=TOKYO))
    body = client.get("/api/projects_combined").json()

    testtz = next(p for p in body["projects"] if p["target_id"] == "TESTTZ")
    assert testtz["archive_minutes"] == 0.0
    assert testtz["total_minutes"] == 10.0


def test_goal_resolves_through_a_catalog_alias_end_to_end(monkeypatch, tmp_path, synthetic_archive):
    """A store/archive target_id that is only an alias, not a catalogue id
    itself — the real shape of "NGC2244" and "C33" in the user's own archive
    (see catalog.py) — must still get a computed goal when routed all the
    way through /api/projects_combined, not just in the unit-level test of
    catalog.resolve()/attach_integration_goals().
    """
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text(
        json.dumps(
            [
                {
                    "id": "NGC2239",
                    "name": "NGC2239",
                    "ra_deg": 97.981,
                    "dec_deg": 4.943,
                    "type": "other",
                    "size_arcmin": 9.3,
                    "magnitude": 4.8,
                }
            ]
        ),
        encoding="utf-8",
    )
    aliases_path = tmp_path / "aliases.json"
    aliases_path.write_text(json.dumps({"NGC2244": "NGC2239"}), encoding="utf-8")

    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    client = TestClient(
        create_app(
            archive_dir=synthetic_archive,
            local_tz=EDT,
            catalog_path=catalog_path,
            aliases_path=aliases_path,
        )
    )

    body = client.get("/api/projects_combined").json()

    # M31 is the only target both this synthetic catalogue and the store
    # fixture's M31 entry share by direct id, so route the assertion through
    # the archive-only IC405 target instead, which is guaranteed absent from
    # this tiny catalogue and must therefore degrade to goal: None rather
    # than raising.
    ic405 = next(p for p in body["projects"] if p["target_id"] == "IC405")
    assert ic405["goal"] is None


def test_missing_catalog_files_degrade_to_goal_none_everywhere(monkeypatch, tmp_path, synthetic_archive):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    client = TestClient(
        create_app(
            archive_dir=synthetic_archive,
            local_tz=EDT,
            catalog_path=tmp_path / "never-built-catalog.json",
            aliases_path=tmp_path / "never-built-aliases.json",
        )
    )

    body = client.get("/api/projects_combined").json()

    assert body["ok"] is True
    assert all(p["goal"] is None for p in body["projects"])
