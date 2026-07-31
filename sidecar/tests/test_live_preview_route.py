"""HTTP-level tests for GET /api/live_preview and GET /api/live_preview/image
— the sidecar-computed views (see allowlist.SIDECAR_ROUTES) that compose one
already-allowlisted tool call (get_view_state) with a local, read-only
directory scan of SEESTAR_LIVE_SHARE_DIR. Discovery-logic unit tests live in
test_live_preview_discovery.py; this file proves the ROUTE wires it all
together correctly — the idle/bridge-down/unreachable/not-configured/no-frame
state machine, the stale-cache fallback, and that the image route always
serves whatever the metadata route most recently found.

No test here starts a real MCP subprocess or touches a real network share:
`routes.call_tool` is monkeypatched directly (live mode, not replay — replay
fixtures are keyed only by tool name and can't vary get_view_state's `ok`
per test case) the same way test_replay.py's
test_transport_failure_uses_the_same_error_shape already does, and every
"share" is a synthetic tmp_path tree.
"""
import os
import time

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar import main, routes
from seestar_sidecar.live_preview import ShareUnreachableError
from seestar_sidecar.main import create_app
from seestar_sidecar.mcp_proxy import ProxyTransportError

OBSERVING_VIEW_STATE = {
    "ok": True,
    "view_state": {"result": {"View": {"stage": "Stack", "Stack": {"stacked_frame": 97}}}},
}
IDLE_VIEW_STATE = {"ok": False, "error": "Error: Exceeded allotted wait time for result"}


#: Fixture mtimes must be RECENT. They used to be epoch-relative (1000, 2000 —
#: i.e. 1970), which was fine while `stale` only meant "fell back to cache",
#: but `stale` now also means "this frame is too old to be current"
#: (live_preview.STALE_AFTER_SECONDS). A 1970 frame is legitimately stale, so
#: the old constants made the not-stale assertions test the opposite of their
#: intent. Relative offsets keep the ordering these tests actually care about.
_NOW = time.time()


def _ago(seconds: float) -> float:
    """An mtime `seconds` in the past — recent enough to count as current."""
    return _NOW - seconds


def _touch(path, mtime=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"jpeg-bytes-" + path.name.encode())
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


@pytest.fixture(autouse=True)
def live_mode(monkeypatch):
    """Every test in this file exercises the live (not replay) call_tool
    path, so get_view_state's `ok` can vary per test — see the module
    docstring for why replay fixtures can't do that.
    """
    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)


def _client(tmp_path, share_dir=None, view_state=OBSERVING_VIEW_STATE, monkeypatch=None):
    async def fake_call_tool(request, tool, arguments):
        assert tool == "get_view_state"
        if isinstance(view_state, Exception):
            raise view_state
        return view_state

    monkeypatch.setattr(routes, "call_tool", fake_call_tool)
    return TestClient(
        create_app(
            archive_dir=tmp_path / "no-archive",
            catalog_path=tmp_path / "no-catalog.json",
            aliases_path=tmp_path / "no-aliases.json",
            live_share_dir=share_dir,
        )
    )


def _must_not_be_called(*args, **kwargs):
    raise AssertionError("discover_frame_within_timeout must not be called in this state")


# --- bridge down / idle: the share must never even be touched ---------------


def test_bridge_down_reports_a_distinct_reason_and_never_touches_the_share(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(routes, "discover_frame_within_timeout", _must_not_be_called)
    client = _client(
        tmp_path,
        share_dir=tmp_path / "share",  # configured, but must still be untouched
        view_state=ProxyTransportError("subprocess died"),
        monkeypatch=monkeypatch,
    )

    body = client.get("/api/live_preview").json()

    assert body == {
        "ok": True,
        "source": None,
        "captured_at": None,
        "stack_count": None,
        "target": None,
        "stale": False,
        "reason": "bridge_down",
        "url": "/api/live_preview/image",
    }


def test_idle_scope_reports_a_distinct_reason_and_never_touches_the_share(tmp_path, monkeypatch):
    monkeypatch.setattr(routes, "discover_frame_within_timeout", _must_not_be_called)
    client = _client(
        tmp_path,
        share_dir=tmp_path / "share",
        view_state=IDLE_VIEW_STATE,
        monkeypatch=monkeypatch,
    )

    body = client.get("/api/live_preview").json()

    assert body["ok"] is True
    assert body["source"] is None
    assert body["reason"] == "idle"
    assert body["stale"] is False


def test_bridge_down_and_idle_are_distinct_reasons():
    """Proves the two states above are not silently collapsed into one — a
    real, meaningful distinction per CLAUDE.md's "bridge-down and scope-idle
    are first-class UI states", not a single generic 'unavailable'.
    """
    from seestar_sidecar.live_preview import REASON_BRIDGE_DOWN, REASON_IDLE

    assert REASON_BRIDGE_DOWN != REASON_IDLE


# --- not configured ----------------------------------------------------------


def test_share_not_configured_reports_its_own_reason(tmp_path, monkeypatch):
    # Must be explicit: load_dotenv_once() puts a real SEESTAR_LIVE_SHARE_DIR
    # into the process environment on a configured machine, so passing
    # share_dir=None alone is not "unconfigured" — the route falls back to the
    # env var and scans the developer's actual scope. Exactly the hidden
    # coupling docs/configuration.md warns about.
    # delenv is not enough: DEFAULT_LIVE_SHARE_DIR is read from the environment
    # at import time, so on a configured machine the route falls back to it and
    # scans the developer's actual scope. Patch the constant, matching what
    # test_archive does for DEFAULT_ARCHIVE_DIR (the same pre-existing wart:
    # create_app(x=None) is indistinguishable from omitting x).
    monkeypatch.delenv("SEESTAR_LIVE_SHARE_DIR", raising=False)
    monkeypatch.setattr(main, "DEFAULT_LIVE_SHARE_DIR", None)
    client = _client(tmp_path, share_dir=None, monkeypatch=monkeypatch)

    body = client.get("/api/live_preview").json()

    assert body["source"] is None
    assert body["reason"] == "not_configured"


# --- successful discovery, end to end through the route --------------------


def test_prefers_stacked_thumbnail_over_sub_end_to_end_through_the_route(tmp_path, monkeypatch):
    share = tmp_path / "share"
    _touch(share / "M27" / "Stacked_M27_10.0s_IRCUT_20260730-030000_thn.jpg", mtime=_ago(60))
    _touch(share / "M27-sub" / "Light_M27_10.0s_IRCUT_20260730-030500_thn.jpg", mtime=_ago(30))
    client = _client(tmp_path, share_dir=share, monkeypatch=monkeypatch)

    body = client.get("/api/live_preview").json()

    assert body["source"] == "stacked"
    assert body["target"] == "M27"
    assert body["stack_count"] == 97  # from OBSERVING_VIEW_STATE, wired through end to end
    assert body["stale"] is False
    assert body["reason"] is None
    assert body["captured_at"] is not None


def test_falls_back_to_sub_thumbnail_end_to_end_through_the_route(tmp_path, monkeypatch):
    share = tmp_path / "share"
    _touch(share / "M27-sub" / "Light_M27_10.0s_IRCUT_20260730-030500_thn.jpg", mtime=_ago(30))
    client = _client(tmp_path, share_dir=share, monkeypatch=monkeypatch)

    body = client.get("/api/live_preview").json()

    assert body["source"] == "sub"
    assert body["target"] == "M27"


def test_reachable_but_empty_share_reports_no_frame(tmp_path, monkeypatch):
    share = tmp_path / "share"
    share.mkdir()
    client = _client(tmp_path, share_dir=share, monkeypatch=monkeypatch)

    body = client.get("/api/live_preview").json()

    assert body["source"] is None
    assert body["reason"] == "no_frame"


def test_missing_share_directory_is_reported_as_unreachable_not_not_configured(
    tmp_path, monkeypatch
):
    """Configured (a real value was set) but the path isn't there — distinct
    from REASON_NOT_CONFIGURED the same way ArchiveStatus distinguishes
    "never configured" from "configured but not there".
    """
    client = _client(tmp_path, share_dir=tmp_path / "never-synced", monkeypatch=monkeypatch)

    body = client.get("/api/live_preview").json()

    assert body["source"] is None
    assert body["reason"] == "share_unreachable"


# --- the image route always mirrors whatever the metadata route found ------


def test_image_route_serves_the_thumbnail_never_the_full_res_or_fits_sibling(
    tmp_path, monkeypatch
):
    share = tmp_path / "share"
    _touch(share / "M27" / "Stacked_M27_10.0s_IRCUT_20260730-030000_thn.jpg", mtime=_ago(60))
    _touch(share / "M27" / "Stacked_M27_10.0s_IRCUT_20260730-030100.jpg", mtime=9999)  # newer, full-res
    client = _client(tmp_path, share_dir=share, monkeypatch=monkeypatch)

    meta = client.get("/api/live_preview").json()
    assert meta["source"] == "stacked"

    image = client.get("/api/live_preview/image")

    assert image.status_code == 200
    assert image.headers["content-type"] == "image/jpeg"
    assert image.content == b"jpeg-bytes-Stacked_M27_10.0s_IRCUT_20260730-030000_thn.jpg"


def test_image_route_before_any_successful_metadata_call_is_an_honest_404(tmp_path, monkeypatch):
    client = _client(tmp_path, share_dir=tmp_path / "share", monkeypatch=monkeypatch)

    response = client.get("/api/live_preview/image")

    assert response.status_code == 404
    body = response.json()
    assert body["ok"] is False
    assert "error" in body


# --- degrade, never disrupt: stale cache fallback ---------------------------


def test_a_failed_scan_after_a_success_falls_back_to_the_cached_frame_marked_stale(
    tmp_path, monkeypatch
):
    share = tmp_path / "share"
    _touch(share / "M27-sub" / "Light_M27_10.0s_IRCUT_20260730-030500_thn.jpg", mtime=_ago(60))
    client = _client(tmp_path, share_dir=share, monkeypatch=monkeypatch)

    first = client.get("/api/live_preview").json()
    assert first["stale"] is False
    assert first["source"] == "sub"

    async def raises(root, timeout_s=None, target=None):
        raise ShareUnreachableError("share went quiet mid-session")

    monkeypatch.setattr(routes, "discover_frame_within_timeout", raises)

    second = client.get("/api/live_preview").json()

    assert second["source"] == "sub"  # the cached frame, not absent
    assert second["target"] == "M27"
    assert second["captured_at"] == first["captured_at"]
    assert second["stale"] is True
    assert second["reason"] is None


def test_image_route_still_serves_the_last_known_frame_while_stale(tmp_path, monkeypatch):
    share = tmp_path / "share"
    _touch(share / "M27-sub" / "Light_M27_10.0s_IRCUT_20260730-030500_thn.jpg", mtime=_ago(60))
    client = _client(tmp_path, share_dir=share, monkeypatch=monkeypatch)
    client.get("/api/live_preview")  # seeds the cache

    async def raises(root, timeout_s=None, target=None):
        raise ShareUnreachableError("share went quiet mid-session")

    monkeypatch.setattr(routes, "discover_frame_within_timeout", raises)
    client.get("/api/live_preview")  # now stale

    image = client.get("/api/live_preview/image")
    assert image.status_code == 200
    assert image.content == b"jpeg-bytes-Light_M27_10.0s_IRCUT_20260730-030500_thn.jpg"


def test_a_scan_failure_with_no_prior_cache_reports_share_unreachable_not_stale(
    tmp_path, monkeypatch
):
    async def raises(root, timeout_s=None, target=None):
        raise ShareUnreachableError("never reachable")

    client = _client(tmp_path, share_dir=tmp_path / "share", monkeypatch=monkeypatch)
    monkeypatch.setattr(routes, "discover_frame_within_timeout", raises)

    body = client.get("/api/live_preview").json()

    assert body["source"] is None
    assert body["reason"] == "share_unreachable"
    assert body["stale"] is False  # nothing exists yet to call stale


def test_a_single_failed_attempt_does_not_retry(tmp_path, monkeypatch):
    """'Never retry aggressively' (the spec's D2) — one HTTP request must
    result in exactly one discovery attempt, not an internal retry loop.
    """
    calls = []

    async def raises_and_counts(root, timeout_s=None, target=None):
        calls.append(1)
        raise ShareUnreachableError("down")

    client = _client(tmp_path, share_dir=tmp_path / "share", monkeypatch=monkeypatch)
    monkeypatch.setattr(routes, "discover_frame_within_timeout", raises_and_counts)

    client.get("/api/live_preview")

    assert len(calls) == 1


# --- stack_count is independent of the cached frame -------------------------


def test_stack_count_updates_on_every_call_even_when_the_frame_is_stale(tmp_path, monkeypatch):
    share = tmp_path / "share"
    _touch(share / "M27-sub" / "Light_M27_10.0s_IRCUT_20260730-030500_thn.jpg", mtime=_ago(60))
    client = _client(tmp_path, share_dir=share, monkeypatch=monkeypatch)
    first = client.get("/api/live_preview").json()
    assert first["stack_count"] == 97

    async def raises(root, timeout_s=None, target=None):
        raise ShareUnreachableError("down")

    monkeypatch.setattr(routes, "discover_frame_within_timeout", raises)

    async def later_view_state(request, tool, arguments):
        return {
            "ok": True,
            "view_state": {"result": {"View": {"Stack": {"stacked_frame": 150}}}},
        }

    monkeypatch.setattr(routes, "call_tool", later_view_state)

    second = client.get("/api/live_preview").json()
    assert second["stale"] is True
    assert second["stack_count"] == 150
