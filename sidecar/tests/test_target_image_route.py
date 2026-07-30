"""HTTP-level tests for GET /api/target_image/<target_id>: the byte-serving
route imagery.resolve_image_pointer's `url` field points at. Own-vs-survey
priority, caching, and the honest-absent-state contract are exercised at the
imagery.py unit level (test_imagery.py) and archive.py level
(test_archive.py); this file proves the route wires them together correctly,
including the two things only reachable through the route: the FastAPI
Query bounds on `size`, and the allowlist's path-constrained id check.

No test here touches the real network — every survey-path test monkeypatches
seestar_sidecar.imagery._live_get, the one call site fetch_survey_cutout uses
when it isn't given an explicit http_get.
"""
import json
from datetime import timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar import imagery
from seestar_sidecar.main import create_app

EDT = timezone(timedelta(hours=-4))


@pytest.fixture
def catalog_path(tmp_path):
    path = tmp_path / "catalog.json"
    path.write_text(
        json.dumps(
            [
                {
                    "id": "M42",
                    "name": "Orion Nebula",
                    "ra_deg": 83.822,
                    "dec_deg": -5.391,
                    "type": "emission_nebula",
                    "size_arcmin": 90.0,
                    "magnitude": 4.0,
                }
            ]
        ),
        encoding="utf-8",
    )
    return path


@pytest.fixture
def aliases_path(tmp_path):
    path = tmp_path / "aliases.json"
    path.write_text(json.dumps({}), encoding="utf-8")
    return path


@pytest.fixture
def archive_with_m31(tmp_path):
    root = tmp_path / "archive"
    root.mkdir()
    plain = root / "M 31"
    plain.mkdir()
    (plain / "Stacked_M 31_10.0s_IRCUT_20231222-221232_thn.jpg").write_bytes(b"m31-thumb")
    (plain / "Stacked_M 31_10.0s_IRCUT_20240104-230352.jpg").write_bytes(b"m31-newest-full")
    (plain / "Stacked_M 31_10.0s_IRCUT_20240104-230352_thn.jpg").write_bytes(b"m31-newest-thumb")
    return root


@pytest.fixture
def cache_dir(tmp_path):
    return tmp_path / "image-cache"


@pytest.fixture
def client(monkeypatch, archive_with_m31, catalog_path, aliases_path, cache_dir):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    return TestClient(
        create_app(
            archive_dir=archive_with_m31,
            local_tz=EDT,
            catalog_path=catalog_path,
            aliases_path=aliases_path,
            image_cache_dir=cache_dir,
        )
    )


# --- own image -----------------------------------------------------------


def test_own_image_is_served_with_the_full_resolution_bytes(client):
    response = client.get("/api/target_image/M31")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content == b"m31-newest-full"


# --- survey fallback -------------------------------------------------------


def test_survey_image_is_fetched_when_no_own_stack_exists(client, monkeypatch, cache_dir):
    calls = []

    async def fake_get(url, params):
        calls.append((url, params))
        return b"survey-bytes"

    monkeypatch.setattr(imagery, "_live_get", fake_get)

    response = client.get("/api/target_image/M42")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content == b"survey-bytes"
    assert len(calls) == 1
    url, params = calls[0]
    assert url == imagery.HIPS2FITS_URL
    assert params["hips"] == imagery.DEFAULT_HIPS_SURVEY
    assert params["ra"] == 83.822
    assert params["dec"] == -5.391
    assert params["format"] == "jpg"


def test_cache_hit_serves_without_reaching_the_network(client, monkeypatch, cache_dir):
    cache_dir.mkdir(parents=True)
    (cache_dir / f"M42_{imagery.DEFAULT_IMAGE_SIZE_PX}.jpg").write_bytes(b"already-cached")

    async def must_not_be_called(url, params):
        raise AssertionError("a pre-populated cache entry must not trigger a fetch")

    monkeypatch.setattr(imagery, "_live_get", must_not_be_called)

    response = client.get("/api/target_image/M42")

    assert response.status_code == 200
    assert response.content == b"already-cached"


def test_a_repeat_request_after_a_live_fetch_hits_the_cache_not_the_network(client, monkeypatch):
    calls = []

    async def fake_get(url, params):
        calls.append(1)
        return b"survey-bytes"

    monkeypatch.setattr(imagery, "_live_get", fake_get)
    first = client.get("/api/target_image/M42")
    second = client.get("/api/target_image/M42")

    assert first.content == second.content == b"survey-bytes"
    assert len(calls) == 1


# --- honest absent states --------------------------------------------------


def test_network_failure_yields_404_with_a_json_body_not_a_500(client, monkeypatch):
    async def failing_get(url, params):
        return None

    monkeypatch.setattr(imagery, "_live_get", failing_get)

    response = client.get("/api/target_image/M42")

    assert response.status_code == 404
    body = response.json()
    assert body["ok"] is False
    assert "error" in body


def test_unresolvable_target_is_404_with_a_json_body(client):
    response = client.get("/api/target_image/Unknown")
    assert response.status_code == 404
    body = response.json()
    assert body == {"ok": False, "error": "no imagery available for 'Unknown'"}


def test_implausible_target_id_is_404_and_never_touches_the_archive_or_network(client, monkeypatch):
    """An id failing imagery.is_plausible_target_id() must be rejected before
    the route does anything else — proved here by making the very first
    thing a valid id would reach (the archive scan) blow up if called at all.
    """
    from seestar_sidecar import routes

    def must_not_be_called(*args, **kwargs):
        raise AssertionError("an implausible id must be rejected before any lookup")

    monkeypatch.setattr(routes, "scan_stacked_images", must_not_be_called)

    response = client.get("/api/target_image/" + "x" * 65)  # past is_plausible_target_id's cap

    assert response.status_code == 404
    assert response.json()["ok"] is False


# --- size query param -------------------------------------------------------


def test_default_size_is_used_when_not_specified(client, monkeypatch):
    seen = {}

    async def fake_get(url, params):
        seen["width"] = params["width"]
        seen["height"] = params["height"]
        return b"bytes"

    monkeypatch.setattr(imagery, "_live_get", fake_get)
    client.get("/api/target_image/M42")

    assert seen["width"] == seen["height"] == imagery.DEFAULT_IMAGE_SIZE_PX


def test_size_below_the_minimum_is_rejected_by_query_validation(client):
    response = client.get(f"/api/target_image/M42?size={imagery.MIN_IMAGE_SIZE_PX - 1}")
    assert response.status_code == 422


def test_size_above_the_maximum_is_rejected_by_query_validation(client):
    response = client.get(f"/api/target_image/M42?size={imagery.MAX_IMAGE_SIZE_PX + 1}")
    assert response.status_code == 422


def test_different_sizes_are_different_cache_entries(client, monkeypatch, cache_dir):
    calls = []

    async def fake_get(url, params):
        calls.append(params["width"])
        return f"bytes-{params['width']}".encode()

    monkeypatch.setattr(imagery, "_live_get", fake_get)

    small = client.get(f"/api/target_image/M42?size={imagery.MIN_IMAGE_SIZE_PX}")
    large = client.get(f"/api/target_image/M42?size={imagery.MAX_IMAGE_SIZE_PX}")

    assert small.content != large.content
    assert calls == [imagery.MIN_IMAGE_SIZE_PX, imagery.MAX_IMAGE_SIZE_PX]


# --- degrades honestly when the archive directory itself is absent --------


def test_missing_archive_directory_still_serves_the_survey_fallback(
    monkeypatch, tmp_path, catalog_path, aliases_path, cache_dir
):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    client = TestClient(
        create_app(
            archive_dir=tmp_path / "never-synced",
            local_tz=EDT,
            catalog_path=catalog_path,
            aliases_path=aliases_path,
            image_cache_dir=cache_dir,
        )
    )

    async def fake_get(url, params):
        return b"survey-bytes"

    monkeypatch.setattr(imagery, "_live_get", fake_get)

    response = client.get("/api/target_image/M42")

    assert response.status_code == 200
    assert response.content == b"survey-bytes"
