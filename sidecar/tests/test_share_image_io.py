"""The two share-backed image routes must not block the event loop on SMB.

/api/live_preview/image and /api/last_stack/image each checked
`cache.path.is_file()` inline before serving. `path` is on the scope's SMB
share, and a stat there can hang for as long as Windows' SMB client cares to
wait — with the whole sidecar (every other route, every poll) frozen behind
it, since it ran on the event loop. The metadata routes already bound their
scans with to_thread + wait_for (discover_frame_within_timeout); these now do
the same, and a timeout reads as "share unreachable".
"""
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar import routes
from seestar_sidecar.last_stack import LastStack
from seestar_sidecar.live_preview import LiveFrame
from seestar_sidecar.main import create_app

HANG_SECONDS = 2.0


class HangingPath(type(Path())):
    """A path whose stat hangs, like one on an SMB share that went quiet."""

    def is_file(self):
        time.sleep(HANG_SECONDS)
        return True


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setattr(routes, "SHARE_SCAN_TIMEOUT_SECONDS", 0.2)
    return create_app(
        archive_dir=tmp_path / "no-archive",
        catalog_path=tmp_path / "no-catalog.json",
        aliases_path=tmp_path / "no-aliases.json",
        live_share_dir=tmp_path / "share",
    )


def _now():
    return datetime.now(tz=timezone.utc)


def _timed_get(client, url):
    """Time the REQUEST, inside a `with TestClient(...)` block.

    A bare TestClient runs each request on a fresh event loop and, closing it,
    waits for the default executor — i.e. for the abandoned stat thread to
    finish sleeping — so it would time the teardown rather than the route. A
    real server's loop outlives the request; so does this one's.
    """
    started = time.monotonic()
    response = client.get(url)
    return response, time.monotonic() - started


def test_live_preview_image_gives_up_on_a_hanging_share(app, tmp_path):
    app.state.live_preview_cache = LiveFrame(
        path=HangingPath(tmp_path / "share" / "x_thn.jpg"), source="sub", target="M27", captured_at=_now()
    )

    with TestClient(app) as client:  # one loop throughout; see _timed_get
        response, elapsed = _timed_get(client, "/api/live_preview/image")

    assert elapsed < HANG_SECONDS - 1, f"blocked for {elapsed:.1f}s on the share"
    assert response.status_code == 503
    assert response.json() == {"ok": False, "error": "live share unreachable"}


def test_last_stack_image_gives_up_on_a_hanging_share(app, tmp_path):
    app.state.last_stack_cache = LastStack(
        path=HangingPath(tmp_path / "share" / "Stacked.jpg"), target="M27", frame_count=10, captured_at=_now()
    )

    with TestClient(app) as client:
        response, elapsed = _timed_get(client, "/api/last_stack/image")

    assert elapsed < HANG_SECONDS - 1, f"blocked for {elapsed:.1f}s on the share"
    assert response.status_code == 503
    assert response.json() == {"ok": False, "error": "live share unreachable"}


def test_a_reachable_file_is_still_served(app, tmp_path):
    image = tmp_path / "share" / "M27-sub" / "Light_M27_thn.jpg"
    image.parent.mkdir(parents=True)
    image.write_bytes(b"jpeg")
    app.state.live_preview_cache = LiveFrame(path=image, source="sub", target="M27", captured_at=_now())

    response = TestClient(app).get("/api/live_preview/image")

    assert response.status_code == 200
    assert response.content == b"jpeg"


def test_a_vanished_file_is_still_an_honest_404(app, tmp_path):
    app.state.last_stack_cache = LastStack(
        path=tmp_path / "share" / "gone.jpg", target="M27", frame_count=1, captured_at=_now()
    )

    response = TestClient(app).get("/api/last_stack/image")

    assert response.status_code == 404
