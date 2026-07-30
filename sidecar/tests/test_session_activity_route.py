"""HTTP-level tests for GET /api/session_activity — proves the route wires
session_activity.py's tail-reading and classification together correctly,
including through the REAL allowlist (not a synthetic one, unlike
test_session_activity.py's unit tests) so a real ALLOWED_TOOLS/SIDECAR_ROUTES
drift would actually be caught here.
"""
import json

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar.main import create_app


def _record(tool, ts="2026-07-30T00:00:00+00:00", **args):
    return json.dumps({"ts": ts, "tool": tool, "args": args})


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    return lambda provenance_path=None: TestClient(
        create_app(
            archive_dir=tmp_path / "no-archive",
            catalog_path=tmp_path / "no-catalog.json",
            aliases_path=tmp_path / "no-aliases.json",
            provenance_path=provenance_path,
        )
    )


def test_not_configured_reports_source_configured_false(client, monkeypatch):
    """`provenance_path=None` on its own means "use the module default", not
    "force unconfigured" (the same contract archive_dir/live_share_dir hold
    to) — and this dev machine's own `.env` sets a real SEESTAR_AI_DIR, so
    relying on that default would silently read this machine's real
    provenance.jsonl instead of exercising the unconfigured state. main.
    DEFAULT_PROVENANCE_PATH is monkeypatched directly, the same way
    test_replay.py's SEESTAR_AI_DIR tests force main.SEESTAR_AI_DIR rather
    than trusting the environment.
    """
    from seestar_sidecar import main

    monkeypatch.setattr(main, "DEFAULT_PROVENANCE_PATH", None)
    response = client(provenance_path=None).get("/api/session_activity")

    assert response.status_code == 200
    body = response.json()
    assert body == {"ok": True, "records": [], "truncated": False, "source_configured": False}


def test_configured_but_file_missing_is_a_normal_empty_degrade(client, tmp_path):
    response = client(tmp_path / "never-written.jsonl").get("/api/session_activity")

    body = response.json()
    assert body["source_configured"] is True
    assert body["records"] == []


def test_real_allowed_tools_classify_ambiguous_through_the_actual_route(client, tmp_path):
    """Uses the REAL ALLOWED_TOOLS import, not a synthetic stand-in — proves
    the route's own wiring, and would catch a real allowlist/classifier
    drift that a synthetic-allowlist unit test cannot.
    """
    path = tmp_path / "provenance.jsonl"
    path.write_text(
        "\n".join(
            [
                _record("list_projects"),  # a real ALLOWED_TOOLS member
                _record("alpaca.put.action"),  # a known native side-effect tag
                _record("goto_target"),  # a real FORBIDDEN_TOOLS member
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    body = client(path).get("/api/session_activity").json()

    by_tool = {r["tool"]: r["origin"] for r in body["records"]}
    assert by_tool["list_projects"] == "ambiguous"
    assert by_tool["alpaca.put.action"] == "ambiguous"
    assert by_tool["goto_target"] == "agent"


def test_records_are_newest_first_end_to_end(client, tmp_path):
    path = tmp_path / "provenance.jsonl"
    path.write_text(
        "\n".join([_record("list_projects", ts="t1"), _record("goto_target", ts="t2")]) + "\n",
        encoding="utf-8",
    )

    body = client(path).get("/api/session_activity").json()

    assert [r["ts"] for r in body["records"]] == ["t2", "t1"]


def test_limit_bounds_the_response_and_reports_truncated(client, tmp_path):
    path = tmp_path / "provenance.jsonl"
    lines = [_record("list_projects", ts=f"t{i}") for i in range(10)]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    body = client(path).get("/api/session_activity?limit=3").json()

    assert len(body["records"]) == 3
    assert body["truncated"] is True
    assert [r["ts"] for r in body["records"]] == ["t9", "t8", "t7"]


def test_a_malformed_line_becomes_an_unknown_record_not_a_500(client, tmp_path):
    path = tmp_path / "provenance.jsonl"
    path.write_text(
        _record("list_projects") + "\n" + "{this is not valid json" + "\n",
        encoding="utf-8",
    )

    response = client(path).get("/api/session_activity")

    assert response.status_code == 200
    origins = {r["origin"] for r in response.json()["records"]}
    assert "unknown" in origins


def test_args_are_forwarded_through_the_route(client, tmp_path):
    """A field must be checked end to end through the route, not only from
    the function that computes it — the args a real record carries must
    actually reach the JSON response, not just the ActivityRecord dataclass.
    """
    path = tmp_path / "provenance.jsonl"
    path.write_text(_record("get_target_observability", target="M27", date=None) + "\n", encoding="utf-8")

    body = client(path).get("/api/session_activity").json()

    assert body["records"][0]["args"] == {"target": "M27", "date": None}


def test_limit_query_param_bounds_are_enforced(client, tmp_path):
    path = tmp_path / "provenance.jsonl"
    path.write_text(_record("list_projects") + "\n", encoding="utf-8")
    test_client = client(path)

    assert test_client.get("/api/session_activity?limit=0").status_code == 422
    assert test_client.get("/api/session_activity?limit=501").status_code == 422
    assert test_client.get("/api/session_activity?limit=1").status_code == 200


def test_the_route_never_writes_to_the_provenance_file(client, tmp_path):
    """Read-only in the strict sense (see session_activity.py's module
    docstring) — proven here by checking the file's own bytes are bit-for-
    bit unchanged after being read through the route, not just asserting
    the route "looks read-only" by code inspection.
    """
    path = tmp_path / "provenance.jsonl"
    original = _record("list_projects") + "\n"
    path.write_bytes(original.encode("utf-8"))

    client(path).get("/api/session_activity")

    assert path.read_bytes() == original.encode("utf-8")
