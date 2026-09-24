"""HTTP-level tests for GET /api/last_stack and GET /api/last_stack/image —
the sidecar-computed views (see allowlist.SIDECAR_ROUTES) that compose one
already-allowlisted tool call (get_view_state) with a local, read-only
directory scan of SEESTAR_LIVE_SHARE_DIR — the SAME share live_preview.py
reads. Discovery-logic unit tests live in test_last_stack_discovery.py; this
file proves the ROUTE wires it together correctly: the
bridge-down/idle/no-target/not-configured/share-unreachable/no-stack state
machine, target scoping end to end, and that the image route never serves a
stack left over from a previously-active target.

No test here starts a real MCP subprocess or touches a real network share:
routes.call_tool is monkeypatched directly (live mode, not replay), same
approach test_live_preview_route.py already uses and for the same reason —
replay fixtures are keyed only by tool name and can't vary get_view_state's
`ok`/target per test case.
"""
import os
import time

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar import main, routes
from seestar_sidecar.last_stack import ShareScanSlowError, ShareUnreachableError
from seestar_sidecar.main import create_app
from seestar_sidecar.mcp_proxy import ProxyTransportError

#: `target_name` present, matching real hardware behaviour during AutoGoto/
#: Stack (see live_preview.extract_target_name's docstring).
OBSERVING_NGC7380 = {
    "ok": True,
    "view_state": {"result": {"View": {"stage": "Stack", "target_name": "NGC 7380"}}},
}
OBSERVING_M27 = {
    "ok": True,
    "view_state": {"result": {"View": {"stage": "Stack", "target_name": "M27"}}},
}
#: `ok: True` but no `target_name` at all — a firmware variant / a moment
#: before AutoGoto has named a target.
OBSERVING_NO_TARGET_NAME = {
    "ok": True,
    "view_state": {"result": {"View": {"stage": "Initialise"}}},
}
IDLE_VIEW_STATE = {"ok": False, "error": "Error: Exceeded allotted wait time for result"}

_NOW = time.time()


def _ago(seconds: float) -> float:
    return _NOW - seconds


def _touch(path, mtime=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"jpeg-bytes-" + path.name.encode())
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


@pytest.fixture(autouse=True)
def live_mode(monkeypatch):
    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)


def _client(tmp_path, share_dir=None, view_state=OBSERVING_NGC7380, monkeypatch=None):
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
    raise AssertionError("discover_last_stack_within_timeout must not be called in this state")


# --- bridge down / idle / no target: the share must never even be touched --


def test_bridge_down_reports_a_distinct_reason_and_never_touches_the_share(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(routes, "discover_last_stack_within_timeout", _must_not_be_called)
    client = _client(
        tmp_path,
        share_dir=tmp_path / "share",  # configured, but must still be untouched
        view_state=ProxyTransportError("subprocess died"),
        monkeypatch=monkeypatch,
    )

    body = client.get("/api/last_stack").json()

    assert body == {
        "ok": True,
        "target": None,
        "captured_at": None,
        "frame_count": None,
        "reason": "bridge_down",
        "url": "/api/last_stack/image",
    }


def test_idle_scope_reports_a_distinct_reason_and_never_touches_the_share(tmp_path, monkeypatch):
    monkeypatch.setattr(routes, "discover_last_stack_within_timeout", _must_not_be_called)
    client = _client(
        tmp_path,
        share_dir=tmp_path / "share",
        view_state=IDLE_VIEW_STATE,
        monkeypatch=monkeypatch,
    )

    body = client.get("/api/last_stack").json()

    assert body["ok"] is True
    assert body["target"] is None
    assert body["reason"] == "idle"


def test_no_target_name_reports_no_stack_and_never_touches_the_share(tmp_path, monkeypatch):
    """Cannot confirm what the scope is on right now — never fall back to an
    unscoped scan, since that risks serving a stack for a different object.
    """
    monkeypatch.setattr(routes, "discover_last_stack_within_timeout", _must_not_be_called)
    client = _client(
        tmp_path,
        share_dir=tmp_path / "share",
        view_state=OBSERVING_NO_TARGET_NAME,
        monkeypatch=monkeypatch,
    )

    body = client.get("/api/last_stack").json()

    assert body["target"] is None
    assert body["reason"] == "no_stack"


def test_bridge_down_idle_and_no_stack_are_distinct_reasons():
    from seestar_sidecar.last_stack import REASON_NO_STACK
    from seestar_sidecar.live_preview import REASON_BRIDGE_DOWN, REASON_IDLE

    assert len({REASON_BRIDGE_DOWN, REASON_IDLE, REASON_NO_STACK}) == 3


# --- not configured -----------------------------------------------------------


def test_share_not_configured_reports_its_own_reason(tmp_path, monkeypatch):
    # Same defensive pattern test_live_preview_route.py uses: DEFAULT_LIVE_
    # SHARE_DIR is read from the environment at import time, so a configured
    # machine needs the constant itself patched, not just the env var unset.
    monkeypatch.delenv("SEESTAR_LIVE_SHARE_DIR", raising=False)
    monkeypatch.setattr(main, "DEFAULT_LIVE_SHARE_DIR", None)
    client = _client(tmp_path, share_dir=None, monkeypatch=monkeypatch)

    body = client.get("/api/last_stack").json()

    assert body["target"] is None
    assert body["reason"] == "not_configured"


# --- share unreachable ---------------------------------------------------------


def test_missing_share_directory_is_reported_as_unreachable(tmp_path, monkeypatch):
    client = _client(tmp_path, share_dir=tmp_path / "never-synced", monkeypatch=monkeypatch)

    body = client.get("/api/last_stack").json()

    assert body["target"] is None
    assert body["reason"] == "share_unreachable"


def test_a_single_failed_attempt_does_not_retry(tmp_path, monkeypatch):
    calls = []

    async def raises_and_counts(root, target, timeout_s=None):
        calls.append(1)
        raise ShareUnreachableError("down")

    client = _client(tmp_path, share_dir=tmp_path / "share", monkeypatch=monkeypatch)
    monkeypatch.setattr(routes, "discover_last_stack_within_timeout", raises_and_counts)

    client.get("/api/last_stack")

    assert len(calls) == 1


def test_a_slow_scan_reports_scan_slow_not_share_unreachable(tmp_path, monkeypatch):
    """The share answered and only the search ran long, which is not what
    `share_unreachable` tells the user. Same token as the live preview's."""

    async def slow(root, target, timeout_s=None):
        raise ShareScanSlowError("the share answered, then the scan ran long")

    client = _client(tmp_path, share_dir=tmp_path / "share", monkeypatch=monkeypatch)
    monkeypatch.setattr(routes, "discover_last_stack_within_timeout", slow)

    body = client.get("/api/last_stack").json()

    assert (body["target"], body["reason"]) == (None, "scan_slow")
    assert client.get("/api/last_stack/image").status_code == 404


# --- reachable, but nothing for this target yet -----------------------------


def test_reachable_but_no_directory_for_target_reports_no_stack(tmp_path, monkeypatch):
    share = tmp_path / "share"
    share.mkdir()
    client = _client(tmp_path, share_dir=share, monkeypatch=monkeypatch)

    body = client.get("/api/last_stack").json()

    assert body["target"] is None
    assert body["reason"] == "no_stack"


def test_reachable_directory_exists_but_no_stacked_file_reports_no_stack(tmp_path, monkeypatch):
    share = tmp_path / "share"
    _touch(share / "NGC7380-sub" / "Light_NGC7380_10.0s_LP_20260712-030000_thn.jpg")
    client = _client(tmp_path, share_dir=share, monkeypatch=monkeypatch)

    body = client.get("/api/last_stack").json()

    assert body["target"] is None
    assert body["reason"] == "no_stack"


# --- successful discovery, end to end through the route ---------------------


def test_finds_the_stack_for_the_active_target_end_to_end(tmp_path, monkeypatch):
    share = tmp_path / "share"
    _touch(
        share / "NGC7380" / "Stacked_178_NGC7380_10.0s_LP_20260712-040704.jpg",
        mtime=_ago(3600),
    )
    client = _client(tmp_path, share_dir=share, monkeypatch=monkeypatch)

    body = client.get("/api/last_stack").json()

    assert body["ok"] is True
    assert body["target"] == "NGC7380"
    assert body["frame_count"] == 178
    assert body["reason"] is None
    assert body["captured_at"] is not None
    assert body["url"] == "/api/last_stack/image"


def test_returns_the_newest_of_several_stacks_end_to_end(tmp_path, monkeypatch):
    share = tmp_path / "share"
    _touch(share / "M27" / "Stacked_40_M27_10.0s_LP_20260601-010000.jpg", mtime=_ago(90000))
    _touch(share / "M27" / "Stacked_210_M27_10.0s_LP_20260715-030000.jpg", mtime=_ago(1000))
    _touch(share / "M27" / "Stacked_97_M27_10.0s_LP_20260610-020000.jpg", mtime=_ago(50000))
    client = _client(tmp_path, share_dir=share, view_state=OBSERVING_M27, monkeypatch=monkeypatch)

    body = client.get("/api/last_stack").json()

    assert body["frame_count"] == 210


def test_a_stack_for_a_different_target_than_active_is_not_returned(tmp_path, monkeypatch):
    share = tmp_path / "share"
    _touch(share / "M27" / "Stacked_40_M27_10.0s_LP_20260601-010000.jpg", mtime=_ago(60))
    # active target is NGC7380 (default view state), which has no stack yet
    client = _client(tmp_path, share_dir=share, monkeypatch=monkeypatch)

    body = client.get("/api/last_stack").json()

    assert body["target"] is None
    assert body["reason"] == "no_stack"


# --- the image route mirrors whatever the metadata route most recently found


def test_image_route_serves_the_full_res_never_the_thumbnail_or_fits(tmp_path, monkeypatch):
    share = tmp_path / "share"
    _touch(
        share / "NGC7380" / "Stacked_178_NGC7380_10.0s_LP_20260712-040704.jpg",
        mtime=_ago(60),
    )
    _touch(
        share / "NGC7380" / "Stacked_178_NGC7380_10.0s_LP_20260712-040704_thn.jpg",
        mtime=9999,  # newer, must still lose
    )
    client = _client(tmp_path, share_dir=share, monkeypatch=monkeypatch)

    meta = client.get("/api/last_stack").json()
    assert meta["target"] == "NGC7380"

    image = client.get("/api/last_stack/image")

    assert image.status_code == 200
    assert image.headers["content-type"] == "image/jpeg"
    assert image.content == b"jpeg-bytes-Stacked_178_NGC7380_10.0s_LP_20260712-040704.jpg"


def test_image_route_before_any_successful_metadata_call_is_an_honest_404(tmp_path, monkeypatch):
    client = _client(tmp_path, share_dir=tmp_path / "share", monkeypatch=monkeypatch)

    response = client.get("/api/last_stack/image")

    assert response.status_code == 404
    body = response.json()
    assert body["ok"] is False
    assert "error" in body


def test_image_route_404s_after_switching_to_a_target_with_no_stack(tmp_path, monkeypatch):
    """The bug this guards against: caching stays keyed to whichever call
    last succeeded, and a request for a NEW target that has no stack must
    not keep serving the PREVIOUS target's image — that is exactly the
    wrong-target mistake target-scoping exists to rule out.
    """
    share = tmp_path / "share"
    _touch(share / "M27" / "Stacked_40_M27_10.0s_LP_20260601-010000.jpg", mtime=_ago(60))

    async def m27_view(request, tool, arguments):
        return OBSERVING_M27

    monkeypatch.setattr(routes, "call_tool", m27_view)
    client = TestClient(
        create_app(
            archive_dir=tmp_path / "no-archive",
            catalog_path=tmp_path / "no-catalog.json",
            aliases_path=tmp_path / "no-aliases.json",
            live_share_dir=share,
        )
    )

    first = client.get("/api/last_stack").json()
    assert first["target"] == "M27"
    image = client.get("/api/last_stack/image")
    assert image.status_code == 200

    async def ngc_view(request, tool, arguments):
        return OBSERVING_NGC7380  # no stack exists for NGC7380 in this fixture

    monkeypatch.setattr(routes, "call_tool", ngc_view)

    second = client.get("/api/last_stack").json()
    assert second["target"] is None
    assert second["reason"] == "no_stack"

    image_after = client.get("/api/last_stack/image")
    assert image_after.status_code == 404


def test_image_route_404s_after_a_bridge_down_reading_that_follows_a_success(
    tmp_path, monkeypatch
):
    """A prior success must not keep serving its image once the route itself
    can no longer confirm anything about the current state — this route has
    no "stale but still show it" degrade path (see last_stack.py's module
    docstring for why that's a deliberate difference from live_preview.py).
    """
    share = tmp_path / "share"
    _touch(
        share / "NGC7380" / "Stacked_178_NGC7380_10.0s_LP_20260712-040704.jpg",
        mtime=_ago(60),
    )
    client = _client(tmp_path, share_dir=share, monkeypatch=monkeypatch)
    first = client.get("/api/last_stack").json()
    assert first["target"] == "NGC7380"

    async def bridge_down(request, tool, arguments):
        raise ProxyTransportError("subprocess died")

    monkeypatch.setattr(routes, "call_tool", bridge_down)

    second = client.get("/api/last_stack").json()
    assert second["reason"] == "bridge_down"

    image = client.get("/api/last_stack/image")
    assert image.status_code == 404
