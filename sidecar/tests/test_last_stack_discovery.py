"""Pure discovery-logic tests for last_stack.py, at the same level
test_live_preview_discovery.py exercises live_preview.py: small synthetic
trees under `tmp_path`, no HTTP, no MCP connection, no real share.

Fixtures below are built from the real filenames the team-lead's task quoted
(measured against real hardware for a completed NGC 7380 session:
`Stacked_178_NGC7380_10.0s_LP_20260712-040704.{fit,jpg}` and its `_thn.jpg`
sibling) rather than an invented shape — the fourth standing check in
docs/slice-2-backlog.md plus tonight's addition: a fixture nobody captured
from a device is a record of what someone believed, not what the hardware
does.
"""
from datetime import timezone

import pytest

from seestar_sidecar import last_stack


def _touch(path, content=b"x", mtime=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    if mtime is not None:
        import os

        os.utime(path, (mtime, mtime))
    return path


@pytest.fixture
def share_root(tmp_path):
    return tmp_path / "share"


# --- discover_last_stack(): missing / empty root ----------------------------


def test_missing_root_raises_oserror(tmp_path):
    with pytest.raises(OSError):
        last_stack.discover_last_stack(tmp_path / "does-not-exist", "NGC7380")


def test_empty_but_present_root_returns_none(share_root):
    share_root.mkdir()
    assert last_stack.discover_last_stack(share_root, "NGC7380") is None


def test_targets_own_directory_present_but_no_stacked_file_returns_none(share_root):
    """The directory exists (e.g. only sub-frames were ever captured, no
    session finished) but holds no Stacked_*.jpg at all."""
    _touch(share_root / "NGC7380-sub" / "Light_NGC7380_10.0s_LP_20260712-030000_thn.jpg")

    assert last_stack.discover_last_stack(share_root, "NGC7380") is None


# --- serving the full-res .jpg, never the thumbnail or the .fit ------------


def test_serves_the_full_resolution_jpg(share_root):
    jpg = _touch(
        share_root / "NGC7380" / "Stacked_178_NGC7380_10.0s_LP_20260712-040704.jpg",
        mtime=1000,
    )

    frame = last_stack.discover_last_stack(share_root, "NGC7380")

    assert frame is not None
    assert frame.path == jpg


def test_never_selects_the_thumbnail_even_when_it_is_the_only_jpg_shaped_match(share_root):
    """The `_thn.jpg` sibling also matches a bare `Stacked_*.jpg` glob — this
    proves the regex, not just the glob, is what excludes it."""
    _touch(
        share_root / "NGC7380" / "Stacked_178_NGC7380_10.0s_LP_20260712-040704_thn.jpg",
        mtime=1000,
    )

    assert last_stack.discover_last_stack(share_root, "NGC7380") is None


def test_thumbnail_never_beats_the_full_res_even_when_newer(share_root):
    full = _touch(
        share_root / "NGC7380" / "Stacked_178_NGC7380_10.0s_LP_20260712-040704.jpg",
        mtime=1000,
    )
    _touch(
        share_root / "NGC7380" / "Stacked_178_NGC7380_10.0s_LP_20260712-040704_thn.jpg",
        mtime=9999,  # newer, must still lose
    )

    frame = last_stack.discover_last_stack(share_root, "NGC7380")

    assert frame is not None
    assert frame.path == full


def test_never_selects_the_raw_fits(share_root):
    """The FITS sibling (measured 12,158 KB) must never be chosen even
    though it exists and is newer than the .jpg."""
    full = _touch(
        share_root / "NGC7380" / "Stacked_178_NGC7380_10.0s_LP_20260712-040704.jpg",
        mtime=1000,
    )
    _touch(
        share_root / "NGC7380" / "Stacked_178_NGC7380_10.0s_LP_20260712-040704.fit",
        mtime=9999,
    )

    frame = last_stack.discover_last_stack(share_root, "NGC7380")

    assert frame is not None
    assert frame.path == full
    assert frame.path.suffix == ".jpg"


# --- frame_count parsed from the filename -----------------------------------


def test_frame_count_parsed_from_the_filename(share_root):
    _touch(
        share_root / "NGC7380" / "Stacked_178_NGC7380_10.0s_LP_20260712-040704.jpg",
        mtime=1000,
    )

    frame = last_stack.discover_last_stack(share_root, "NGC7380")

    assert frame is not None
    assert frame.frame_count == 178


# --- several stacks for one target: return the newest -----------------------


def test_returns_the_newest_of_several_stacks_for_the_same_target(share_root):
    """M27 has 3 stacks from different sessions in the real archive — this
    reproduces that shape with 3 for a single target directory."""
    _touch(share_root / "M27" / "Stacked_40_M27_10.0s_LP_20260601-010000.jpg", mtime=1000)
    newest = _touch(
        share_root / "M27" / "Stacked_210_M27_10.0s_LP_20260715-030000.jpg", mtime=9000
    )
    _touch(share_root / "M27" / "Stacked_97_M27_10.0s_LP_20260610-020000.jpg", mtime=5000)

    frame = last_stack.discover_last_stack(share_root, "M27")

    assert frame is not None
    assert frame.path == newest
    assert frame.frame_count == 210


# --- scoped to the requested target ------------------------------------------


def test_a_stack_for_a_different_target_is_never_returned(share_root):
    """Even when the OTHER target's stack is much newer, it must not be
    returned for a request scoped to a different target — 'a stack for a
    different object is not what the user asked for'."""
    _touch(share_root / "M27" / "Stacked_40_M27_10.0s_LP_20260601-010000.jpg", mtime=1000)
    _touch(
        share_root / "NGC7380" / "Stacked_178_NGC7380_10.0s_LP_20260712-040704.jpg",
        mtime=9999,
    )

    frame = last_stack.discover_last_stack(share_root, "M27")

    assert frame is not None
    assert frame.target == "M27"
    assert frame.path.name.startswith("Stacked_40_M27")


def test_no_directory_matching_the_target_returns_none(share_root):
    _touch(
        share_root / "M27" / "Stacked_40_M27_10.0s_LP_20260601-010000.jpg",
        mtime=1000,
    )

    assert last_stack.discover_last_stack(share_root, "NGC7380") is None


def test_captured_at_reflects_the_files_own_mtime_in_utc(share_root):
    mtime = 1_800_000_000  # an arbitrary, known POSIX timestamp
    _touch(
        share_root / "NGC7380" / "Stacked_178_NGC7380_10.0s_LP_20260712-040704.jpg",
        mtime=mtime,
    )

    frame = last_stack.discover_last_stack(share_root, "NGC7380")

    assert frame is not None
    assert frame.captured_at.tzinfo == timezone.utc
    assert frame.captured_at.timestamp() == mtime


def test_result_target_is_the_normalized_id_not_the_raw_directory_name(share_root):
    _touch(
        share_root / "M 27" / "Stacked_40_M27_10.0s_LP_20260601-010000.jpg",
        mtime=1000,
    )

    frame = last_stack.discover_last_stack(share_root, "M27")

    assert frame is not None
    assert frame.target == "M27"


# --- discover_last_stack_within_timeout() -----------------------------------


async def test_discover_last_stack_within_timeout_wraps_a_missing_root_as_share_unreachable(
    tmp_path,
):
    with pytest.raises(last_stack.ShareUnreachableError):
        await last_stack.discover_last_stack_within_timeout(tmp_path / "gone", "NGC7380")


async def test_discover_last_stack_within_timeout_raises_share_unreachable_on_real_timeout(
    share_root, monkeypatch
):
    """A share that hangs mid-scan must fail fast, not hang the request —
    same proof as live_preview's equivalent test: a stand-in for
    discover_last_stack that never returns within the tiny timeout given
    proves asyncio.wait_for's ceiling actually fires."""
    share_root.mkdir()

    def hangs_forever(root, target, answered=None):
        import time

        time.sleep(0.5)
        return None

    monkeypatch.setattr(last_stack, "discover_last_stack", hangs_forever)

    with pytest.raises(last_stack.ShareUnreachableError):
        await last_stack.discover_last_stack_within_timeout(
            share_root, "NGC7380", timeout_s=0.05
        )


async def test_discover_last_stack_within_timeout_returns_the_frame_on_success(share_root):
    _touch(
        share_root / "NGC7380" / "Stacked_178_NGC7380_10.0s_LP_20260712-040704.jpg",
        mtime=1000,
    )
    frame = await last_stack.discover_last_stack_within_timeout(share_root, "NGC7380")
    assert frame is not None
    assert frame.frame_count == 178


async def test_discover_last_stack_within_timeout_returns_none_when_nothing_matches(
    share_root,
):
    share_root.mkdir()
    frame = await last_stack.discover_last_stack_within_timeout(share_root, "NGC7380")
    assert frame is None


# --- the same cheap listing, and the same slow-is-not-unreachable rule as the
# --- live preview (see test_live_preview_scale.py)


def _many_targets(share_root):
    for i in range(20):
        _touch(share_root / f"NGC{7000 + i}" / f"Stacked_50_NGC{7000 + i}_10.0s_LP_20260701-010000.jpg")
        _touch(share_root / f"NGC{7000 + i}_sub" / f"Light_NGC{7000 + i}_10.0s_LP_20260701-010000.fit")
    return _touch(share_root / "M1" / "Stacked_1003_M1_10.0s_LP_20260924-110824.jpg", mtime=1000)


def test_the_root_is_listed_once_and_only_the_targets_folder_after_it(share_root, monkeypatch):
    stack = _many_targets(share_root)
    listed = []
    real = last_stack.list_matching

    def spy(directory, pattern="*"):
        listed.append(directory.name)
        return real(directory, pattern)

    monkeypatch.setattr(last_stack, "list_matching", spy)

    frame = last_stack.discover_last_stack(share_root, "M1")

    assert frame is not None and frame.path == stack
    assert listed == ["share", "M1"]


def test_no_root_entry_is_stat_ed(share_root, monkeypatch):
    """The old scan called is_dir() on every root entry: one SMB round trip
    per object ever imaged. At most the winner is stat-ed."""
    import os

    _many_targets(share_root)
    stats = []
    real = os.stat

    def spy(path, *args, **kwargs):
        stats.append(os.fspath(path))
        return real(path, *args, **kwargs)

    monkeypatch.setattr(os, "stat", spy)

    last_stack.discover_last_stack(share_root, "M1")

    assert len(stats) <= 1, stats


async def test_a_scan_that_runs_long_after_the_root_answered_is_slow_not_unreachable(
    share_root, monkeypatch
):
    import time

    _many_targets(share_root)
    real = last_stack.list_matching

    def target_folder_is_slow(directory, pattern="*"):
        if directory.name == "M1":
            time.sleep(0.5)
        return real(directory, pattern)

    monkeypatch.setattr(last_stack, "list_matching", target_folder_is_slow)

    with pytest.raises(last_stack.ShareScanSlowError):
        await last_stack.discover_last_stack_within_timeout(share_root, "M1", timeout_s=0.2)


async def test_a_root_that_does_not_answer_in_time_is_unreachable(share_root, monkeypatch):
    import time

    _many_targets(share_root)
    real = last_stack.list_matching

    def root_hangs(directory, pattern="*"):
        if directory == share_root:
            time.sleep(0.5)
        return real(directory, pattern)

    monkeypatch.setattr(last_stack, "list_matching", root_hangs)

    with pytest.raises(last_stack.ShareUnreachableError):
        await last_stack.discover_last_stack_within_timeout(share_root, "M1", timeout_s=0.2)
