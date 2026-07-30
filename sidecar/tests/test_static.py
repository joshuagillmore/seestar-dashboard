"""The sidecar serves the built frontend from the same process as /api/*.

Route order is the whole trick — see frontend.py's module docstring — so
these prove behaviour (what a client actually receives) rather than just
the presence of a mount.
"""
import pytest
from fastapi.testclient import TestClient

from seestar_sidecar.frontend import MISSING_DIST_MESSAGE
from seestar_sidecar.main import create_app


@pytest.fixture
def built_dist(tmp_path):
    """A minimal, hermetic stand-in for `npm run build`'s output — no
    dependency on a real build having run, per the slice-2 spec.
    """
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>app-shell-stub</title>", encoding="utf-8")
    assets = dist / "assets"
    assets.mkdir()
    (assets / "app.js").write_text("console.log('asset-stub')", encoding="utf-8")
    fonts = dist / "fonts"
    fonts.mkdir()
    (fonts / "ibm-plex-sans.woff2").write_bytes(b"\x00\x01\x00\x00wOF2-stub")
    return dist


def test_serves_index_html_at_root_when_dist_exists(built_dist):
    client = TestClient(create_app(web_dist=built_dist))
    response = client.get("/")
    assert response.status_code == 200
    assert "app-shell-stub" in response.text


def test_unknown_path_falls_through_to_index_html(built_dist):
    # A client-side route like "/projects" is not a real file on disk.
    # StaticFiles(html=True) alone 404s on this (it only auto-serves
    # index.html for an actual directory match) — this proves the SPA
    # fallback in frontend.py, not just that "/" happens to be a directory.
    client = TestClient(create_app(web_dist=built_dist))
    response = client.get("/projects")
    assert response.status_code == 200
    assert "app-shell-stub" in response.text


def test_real_asset_is_served_verbatim_not_index_html(built_dist):
    client = TestClient(create_app(web_dist=built_dist))
    response = client.get("/assets/app.js")
    assert response.status_code == 200
    assert "asset-stub" in response.text
    assert "app-shell-stub" not in response.text


def test_fonts_are_served_with_a_font_mime_type_not_text_plain(built_dist):
    # Regression test: this machine's Windows mimetypes registry has no
    # .woff2 entry, which made Starlette's FileResponse guess `None` and
    # fall back to text/plain — found by curling the running server, not by
    # a test, until now. frontend.py registers the type at import time.
    client = TestClient(create_app(web_dist=built_dist))
    response = client.get("/fonts/ibm-plex-sans.woff2")
    assert response.status_code == 200
    assert response.headers["content-type"] == "font/woff2"


def test_api_health_still_routes_with_the_mount_present(built_dist, monkeypatch):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    client = TestClient(create_app(web_dist=built_dist))
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "replay": True}


def test_unregistered_api_path_still_404s_even_though_dist_exists(built_dist):
    # The dangerous failure mode: the SPA fallback rescuing an unmatched
    # /api/* path into a 200 index.html response, which would silently
    # defeat the allowlist's "a tool with side effects has no route at all"
    # guarantee (see test_allowlist.py). This must stay a 404, not become
    # the app shell just because dist exists.
    client = TestClient(create_app(web_dist=built_dist))
    response = client.get("/api/shutdown")
    assert response.status_code == 404
    assert "app-shell-stub" not in response.text


def test_missing_dist_serves_the_build_message_instead_of_crashing(tmp_path):
    never_built = tmp_path / "dist"  # deliberately never created
    client = TestClient(create_app(web_dist=never_built))
    response = client.get("/")
    assert "npm run build" in response.text
    assert response.text == MISSING_DIST_MESSAGE


def test_missing_dist_still_serves_the_api(tmp_path, monkeypatch):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    never_built = tmp_path / "dist"
    client = TestClient(create_app(web_dist=never_built))
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "replay": True}


def test_missing_dist_does_not_swallow_unregistered_api_paths(tmp_path):
    never_built = tmp_path / "dist"
    client = TestClient(create_app(web_dist=never_built))
    response = client.get("/api/shutdown")
    assert response.status_code == 404


def test_default_web_dist_points_at_the_sibling_web_dist_directory():
    # Proves DEFAULT_WEB_DIST resolves relative to the package, not the
    # process's current working directory — a launcher invoked from a
    # different directory must still find the same web/dist every time.
    from seestar_sidecar.frontend import DEFAULT_WEB_DIST

    assert DEFAULT_WEB_DIST.parent.name == "web"
    assert DEFAULT_WEB_DIST.name == "dist"
