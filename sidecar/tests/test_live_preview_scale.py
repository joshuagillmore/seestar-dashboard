"""live_preview discovery on a share laid out like the real one after a long
night, with a filesystem that charges for what it lists.

The finding this file guards: after a 1003-sub night, /api/live_preview said
`share_unreachable` while the share answered in under a tenth of a second.
The scan stat-ed every root entry twice (once for the stacked pass, once for
the sub pass), then listed the whole sub folder. The last step's cost grows
with every sub, so the scan ran past SHARE_SCAN_TIMEOUT_SECONDS late in any
long session.

The layout is the real one: SEESTAR_LIVE_SHARE_DIR points AT the `MyWorks`
folder, which holds `<target>/` (stacked masters) and `<target>_sub/` (three
files per sub) for every object ever imaged.
"""
import os
import time

import pytest

from seestar_sidecar import live_preview

SUBS = 2000
#: The newest sub by name: 2,000 subs 10 s apart from 00:00:00.
NEWEST_SUB = "Light_M1_10.0s_LP_20260924-123310_thn.jpg"
STACK_THUMB = "Stacked_1003_M1_10.0s_LP_20260924-110824_thn.jpg"


def _write(path, mtime=None):
    path.write_bytes(b"jpeg-bytes-" + path.name.encode())
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


@pytest.fixture(scope="module")
def long_night(tmp_path_factory):
    """MyWorks/ with 40 other targets' folders, M1/ and a 2,000-sub M1_sub/."""
    root = tmp_path_factory.mktemp("share") / "MyWorks"
    for i in range(20):
        for folder in (f"NGC{7000 + i}", f"NGC{7000 + i}_sub"):
            (root / folder).mkdir(parents=True)
        _write(root / f"NGC{7000 + i}" / f"Stacked_50_NGC{7000 + i}_10.0s_LP_20260701-010000_thn.jpg")
        _write(root / f"NGC{7000 + i}_sub" / f"Light_NGC{7000 + i}_10.0s_LP_20260701-010000_thn.jpg")
    (root / "M1").mkdir()
    for suffix in ("_thn.jpg", ".jpg", ".fit"):
        _write(root / "M1" / STACK_THUMB.replace("_thn.jpg", suffix))
    subs = root / "M1_sub"
    subs.mkdir()
    for i in range(SUBS):
        t = 7 * 3600 + i * 10  # a 10 s cadence from 07:00:00
        stamp = f"20260924-{t // 3600:02d}{t // 60 % 60:02d}{t % 60:02d}"
        for suffix in ("_thn.jpg", ".jpg", ".fit"):
            (subs / f"Light_M1_10.0s_LP_{stamp}{suffix}").write_bytes(b"")
    return root


def _age(root, rel, seconds):
    """Set a file's mtime to `seconds` ago."""
    mtime = time.time() - seconds
    os.utime(root / rel, (mtime, mtime))


@pytest.fixture
def listings(monkeypatch):
    """Every folder discovery lists, in order, as (folder name, pattern)."""
    calls = []
    real = live_preview.list_matching

    def spy(directory, pattern="*"):
        calls.append((directory.name, pattern))
        return real(directory, pattern)

    monkeypatch.setattr(live_preview, "list_matching", spy)
    return calls


@pytest.fixture
def stats(monkeypatch):
    """Every os.stat() of a path, which over SMB is one round trip each."""
    calls = []
    real = os.stat

    def spy(path, *args, **kwargs):
        calls.append(os.fspath(path))
        return real(path, *args, **kwargs)

    monkeypatch.setattr(os, "stat", spy)
    return calls


def test_the_newest_sub_is_found_among_2000(long_night):
    _age(long_night, f"M1/{STACK_THUMB}", 6 * 3600)
    _age(long_night, f"M1_sub/{NEWEST_SUB}", 5)

    frame = live_preview.discover_frame(long_night, "M1")

    assert frame is not None
    assert (frame.source, frame.target, frame.path.name) == ("sub", "M1", NEWEST_SUB)
    assert not live_preview.is_frame_stale(frame)


def test_the_root_is_listed_once_and_only_the_targets_own_folders_after_it(long_night, listings):
    _age(long_night, f"M1/{STACK_THUMB}", 6 * 3600)
    _age(long_night, f"M1_sub/{NEWEST_SUB}", 5)

    live_preview.discover_frame(long_night, "M1")

    assert [folder for folder, _ in listings] == ["MyWorks", "M1", "M1_sub"]


def test_no_root_entry_is_stat_ed(long_night, stats):
    """The old scan called is_dir() on each of the 42 root entries, twice:
    84 round trips before it looked inside a single folder. The listing
    already says which entries are folders. At most the two winners are
    stat-ed, and on Windows not even those."""
    _age(long_night, f"M1/{STACK_THUMB}", 6 * 3600)
    _age(long_night, f"M1_sub/{NEWEST_SUB}", 5)
    stats.clear()

    live_preview.discover_frame(long_night, "M1")

    assert len(stats) <= 2, stats


def test_a_stack_written_within_a_poll_means_the_sub_folder_is_never_listed(long_night, listings):
    _age(long_night, f"M1/{STACK_THUMB}", 10)
    _age(long_night, f"M1_sub/{NEWEST_SUB}", 5)

    frame = live_preview.discover_frame(long_night, "M1")

    assert frame is not None
    assert (frame.source, frame.path.name) == ("stacked", STACK_THUMB)
    assert "M1_sub" not in [folder for folder, _ in listings]


def test_a_stack_older_than_a_poll_loses_to_a_newer_sub(long_night):
    _age(long_night, f"M1/{STACK_THUMB}", 120)
    _age(long_night, f"M1_sub/{NEWEST_SUB}", 5)

    frame = live_preview.discover_frame(long_night, "M1")

    assert frame is not None
    assert (frame.source, frame.path.name) == ("sub", NEWEST_SUB)


def test_a_stack_newer_than_every_sub_still_wins(long_night):
    """The parked M1 case: the final stack is written after the last sub."""
    _age(long_night, f"M1/{STACK_THUMB}", 3 * 3600)
    _age(long_night, f"M1_sub/{NEWEST_SUB}", 3 * 3600 + 60)

    frame = live_preview.discover_frame(long_night, "M1")

    assert frame is not None
    assert frame.source == "stacked"
    assert live_preview.is_frame_stale(frame)
