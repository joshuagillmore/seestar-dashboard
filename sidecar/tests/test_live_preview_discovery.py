"""Pure discovery-logic tests for live_preview.py, at the same level
test_archive.py exercises archive.py: small synthetic trees under `tmp_path`,
no HTTP, no MCP connection, no real share.

The property that matters most here — proven repeatedly below, not just
asserted once — is that this module NEVER prefers a full-resolution image
over its `_thn` thumbnail sibling, the opposite of archive.py's own
scan_stacked_images() preference. See live_preview.py's module docstring for
why that's deliberate, not a bug: 476 KB (measured) on a polling path would
be exactly the offload this feature was built to avoid.
"""
import json
from datetime import timezone
from pathlib import Path

import time

import pytest

from seestar_sidecar import live_preview

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


@pytest.fixture
def share_root(tmp_path):
    return tmp_path / "share"


def _touch(path, content=b"x", mtime=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    if mtime is not None:
        import os

        os.utime(path, (mtime, mtime))
    return path


# --- discover_frame(): missing / empty root --------------------------------


def test_missing_root_raises_oserror(tmp_path):
    with pytest.raises(OSError):
        live_preview.discover_frame(tmp_path / "does-not-exist")


def test_empty_but_present_root_returns_none(share_root):
    share_root.mkdir()
    assert live_preview.discover_frame(share_root) is None


# --- stacked-thumbnail preference -------------------------------------------


def test_prefers_stacked_thumbnail_over_sub_thumbnail_when_BOTH_ARE_FRESH(share_root):
    """A stacked master is the better picture, so it wins — but only while it
    is actually current: written within STACK_FRESH_SECONDS, one Live poll.
    Fixtures must be recent: with the old epoch-relative mtimes both frames
    were stale and this asserted the wrong branch.
    """
    now = time.time()
    _touch(
        share_root / "M27" / "Stacked_M27_10.0s_IRCUT_20260730-030000_thn.jpg",
        mtime=now - 30,
    )
    _touch(
        share_root / "M27-sub" / "Light_M27_10.0s_IRCUT_20260730-030500_thn.jpg",
        mtime=now - 5,  # newer than the stacked thumbnail, but must still lose
    )

    frame = live_preview.discover_frame(share_root)

    assert frame is not None
    assert frame.source == "stacked"
    assert frame.path.name == "Stacked_M27_10.0s_IRCUT_20260730-030000_thn.jpg"


def test_a_stale_stacked_thumbnail_loses_to_a_fresh_sub(share_root):
    """The bug this rule exists for, reproduced from real hardware.

    Mid-session on NGC 7380 at 37 stacked frames, the target's only
    Stacked_*_thn.jpg was 18 days old — the scope writes the stacked master
    once, at session end, so there is no intermediate stacked preview — while
    its sub directory held thumbnails from seconds earlier. Preferring
    "stacked" unconditionally served a picture from a previous night as the
    live view of an active session.
    """
    now = time.time()
    _touch(
        share_root / "M27" / "Stacked_M27_10.0s_IRCUT_20260712-040704_thn.jpg",
        mtime=now - (18 * 24 * 3600),
    )
    fresh = _touch(
        share_root / "M27-sub" / "Light_M27_10.0s_IRCUT_20260730-233800_thn.jpg",
        mtime=now - 5,
    )

    frame = live_preview.discover_frame(share_root)

    assert frame is not None
    assert frame.source == "sub", "a fresh sub must beat an 18-day-old stack"
    assert frame.path == fresh
    assert not live_preview.is_frame_stale(frame)


def test_when_nothing_is_fresh_the_newer_frame_is_returned_not_nothing(share_root):
    """An old frame with an honest timestamp beats an empty panel — the route
    marks it stale rather than suppressing it."""
    now = time.time()
    _touch(share_root / "M27" / "Stacked_M27_10.0s_IRCUT_20260712-040704_thn.jpg", mtime=now - 9000)
    newer = _touch(
        share_root / "M27-sub" / "Light_M27_10.0s_IRCUT_20260730-233800_thn.jpg", mtime=now - 4000
    )

    frame = live_preview.discover_frame(share_root)

    assert frame is not None
    assert frame.path == newer
    assert live_preview.is_frame_stale(frame)


def test_falls_back_to_sub_thumbnail_when_no_stacked_thumbnail_exists(share_root):
    _touch(
        share_root / "M27-sub" / "Light_M27_10.0s_IRCUT_20260730-030500_thn.jpg",
        mtime=2000,
    )

    frame = live_preview.discover_frame(share_root)

    assert frame is not None
    assert frame.source == "sub"
    assert frame.target == "M27"


def test_never_selects_the_full_resolution_stacked_jpeg(share_root):
    """The full-res sibling (measured 476 KB) must never be chosen even
    though it exists and even though it's newer than the thumbnail — this
    module matches ONLY `_thn` stacked files, unlike archive.py's
    scan_stacked_images() which prefers the opposite.
    """
    _touch(
        share_root / "M27" / "Stacked_M27_10.0s_IRCUT_20260730-030000_thn.jpg",
        mtime=1000,
    )
    _touch(
        share_root / "M27" / "Stacked_M27_10.0s_IRCUT_20260730-030100.jpg",  # no _thn, newer
        mtime=5000,
    )

    frame = live_preview.discover_frame(share_root)

    assert frame is not None
    assert frame.path.name.endswith("_thn.jpg")


def test_never_selects_a_raw_fits_sub(share_root):
    """The FITS sibling (measured 4,056 KB) must never be chosen even though
    it exists and is newer than the thumbnail.
    """
    _touch(
        share_root / "M27-sub" / "Light_M27_10.0s_IRCUT_20260730-030500_thn.jpg",
        mtime=1000,
    )
    _touch(
        share_root / "M27-sub" / "Light_M27_10.0s_IRCUT_20260730-030600.fit",  # raw FITS, newer
        mtime=5000,
    )

    frame = live_preview.discover_frame(share_root)

    assert frame is not None
    assert frame.path.name.endswith("_thn.jpg")
    assert frame.path.suffix == ".jpg"


def test_sub_thumbnail_picks_the_newest_across_multiple_targets(share_root):
    _touch(
        share_root / "M27-sub" / "Light_M27_10.0s_IRCUT_20260730-030000_thn.jpg",
        mtime=1000,
    )
    _touch(
        share_root / "M31-sub" / "Light_M31_10.0s_IRCUT_20260730-030100_thn.jpg",
        mtime=2000,
    )

    frame = live_preview.discover_frame(share_root)

    assert frame is not None
    assert frame.target == "M31"


def test_captured_at_reflects_the_files_own_mtime_in_utc(share_root):
    mtime = 1_800_000_000  # an arbitrary, known POSIX timestamp
    _touch(
        share_root / "M27-sub" / "Light_M27_10.0s_IRCUT_20260730-030500_thn.jpg",
        mtime=mtime,
    )

    frame = live_preview.discover_frame(share_root)

    assert frame is not None
    assert frame.captured_at.tzinfo == timezone.utc
    assert frame.captured_at.timestamp() == mtime


# --- extract_stack_count() --------------------------------------------------


def test_extract_stack_count_reads_the_verified_nesting():
    payload = {
        "ok": True,
        "view_state": {"result": {"View": {"Stack": {"stacked_frame": 97}}}},
    }
    assert live_preview.extract_stack_count(payload) == 97


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"ok": False},
        {"ok": True, "view_state": {}},
        {"ok": True, "view_state": {"result": {}}},
        {"ok": True, "view_state": None},
        None,
    ],
)
def test_extract_stack_count_degrades_to_none_never_raises(payload):
    assert live_preview.extract_stack_count(payload) is None


# --- discover_frame_within_timeout() ---------------------------------------


async def test_discover_frame_within_timeout_wraps_a_missing_root_as_share_unreachable(tmp_path):
    with pytest.raises(live_preview.ShareUnreachableError):
        await live_preview.discover_frame_within_timeout(tmp_path / "gone")


async def test_discover_frame_within_timeout_raises_share_unreachable_on_real_timeout(
    share_root, monkeypatch
):
    """A share that hangs mid-scan (the hazard this whole feature is built
    around) must fail fast, not hang the request. Simulated with a stand-in
    for `discover_frame` that never returns within the tiny timeout given —
    proves the asyncio.wait_for ceiling actually fires, not just that OSError
    is caught.
    """

    share_root.mkdir()

    def hangs_forever(root, target=None, named_stacks=(), answered=None):
        # A `to_thread` work item can't truly be cancelled once started — it
        # keeps the underlying thread busy for its full duration regardless
        # of asyncio.wait_for's timeout. Long enough to comfortably outlast
        # the 0.05s timeout below (proving the ceiling actually fires, not
        # just that the real call happened to finish first), short enough
        # not to tax every future run of this suite by several real seconds.
        import time

        time.sleep(0.5)
        return None

    monkeypatch.setattr(live_preview, "discover_frame", hangs_forever)

    with pytest.raises(live_preview.ShareUnreachableError):
        await live_preview.discover_frame_within_timeout(share_root, timeout_s=0.05)


async def test_discover_frame_within_timeout_returns_the_frame_on_success(share_root):
    _touch(
        share_root / "M27-sub" / "Light_M27_10.0s_IRCUT_20260730-030500_thn.jpg",
        mtime=1000,
    )
    frame = await live_preview.discover_frame_within_timeout(share_root)
    assert frame is not None
    assert frame.source == "sub"


# --- is_observing(): the View-state rule --------------------------------------
#
# Hardware, 2026-09-24: a parked scope keeps the ended session's View
# (`state: "cancel"`, `mode: "none"`), so "a View is present" is not
# "observing". Rule, per the seestar-mcp session: observing <=> View.state ==
# "working" and View.mode != "none", or the payload's own top-level
# `observing` bool when it has one.


def _view(**fields):
    return {"ok": True, "view_state": {"result": {"View": {"target_name": "M1", **fields}}}}


def test_the_july_working_fixture_is_observing():
    working = json.loads((FIXTURES / "get_view_state.json").read_text(encoding="utf-8"))

    assert live_preview.is_observing(working) is True


@pytest.mark.parametrize(
    "payload",
    [
        _view(state="cancel", mode="none"),  # ended or stopped; persists after a park
        _view(state="working", mode="none"),
        _view(state="complete", mode="star"),
        _view(state="fail", mode="star"),
        _view(mode="star"),  # no state at all
        {"ok": True, "view_state": {"result": {}}},  # a freshly booted scope
        {"ok": True, "view_state": {"result": {"View": None}}},
        {"ok": False},
        {},
        None,
    ],
)
def test_anything_but_a_working_view_is_not_observing(payload):
    assert live_preview.is_observing(payload) is False


def test_a_working_view_in_any_mode_but_none_is_observing():
    assert live_preview.is_observing(_view(state="working", mode="star")) is True
    assert live_preview.is_observing(_view(state="working")) is True


@pytest.mark.parametrize(
    ("view", "flag"),
    [(_view(state="cancel", mode="none"), True), (_view(state="working", mode="star"), False)],
)
def test_a_top_level_observing_bool_decides_when_present(view, flag):
    assert live_preview.is_observing({**view, "observing": flag}) is flag


@pytest.mark.parametrize(
    "payload",
    [
        {"observing": True},
        {"ok": True, "view_state": {"result": {}}, "observing": True},
        {"ok": True, "view_state": {"result": {"View": None}}, "observing": True},
    ],
)
def test_the_observing_flag_needs_a_view_to_vouch_for(payload):
    # Same order as the web's isObserving: no View is never observing, so a
    # stray flag cannot send the preview scanning every target's folders.
    assert live_preview.is_observing(payload) is False


def test_a_non_bool_observing_field_is_ignored():
    assert live_preview.is_observing({**_view(state="cancel", mode="none"), "observing": "yes"}) is False
