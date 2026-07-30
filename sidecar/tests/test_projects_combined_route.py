"""HTTP-level tests for /api/projects_combined: the route wiring around
combine_projects (test_projects_union.py) and scan_archive (test_archive.py),
neither of which touches the real archive or a live MCP server here.
"""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar.main import create_app

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
REAL_LIST_PROJECTS = json.loads((FIXTURES / "list_projects.json").read_text(encoding="utf-8"))


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
    return TestClient(create_app(archive_dir=synthetic_archive))


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
    client = TestClient(create_app(archive_dir=tmp_path / "never-synced"))

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
    client = TestClient(create_app(archive_dir=synthetic_archive))

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
    client = TestClient(create_app(archive_dir=synthetic_archive))

    response = client.get("/api/projects_combined")

    assert response.status_code == 200
    assert response.json() == {"ok": False, "error": "corrupt store"}
