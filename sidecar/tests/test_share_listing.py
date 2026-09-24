"""share_listing.list_matching(): one pattern-filtered listing of a share
folder, with each entry's type (and, on Windows, its mtime) taken from the
listing itself rather than a stat per entry.

Synthetic temp trees only; the real-share timings that motivated the module
are in its docstring.
"""
import os
import sys

import pytest

from seestar_sidecar import share_listing

windows_only = pytest.mark.skipif(sys.platform != "win32", reason="FindFirstFileExW is Windows-only")

IMPLEMENTATIONS = [pytest.param(share_listing._list_portable, id="portable")]
if sys.platform == "win32":
    IMPLEMENTATIONS.append(pytest.param(share_listing._list_windows, id="windows"))


def _touch(path, mtime=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


@pytest.fixture
def sub_folder(tmp_path):
    """A sub folder as the scope writes it: a .fit, a .jpg and a _thn.jpg per sub."""
    folder = tmp_path / "M1_sub"
    for i in range(50):
        stem = f"Light_M1_10.0s_LP_20260924-01{i // 60:02d}{i % 60:02d}"
        for suffix in (".fit", ".jpg", "_thn.jpg"):
            _touch(folder / f"{stem}{suffix}", mtime=1_800_000_000 + i)
    return folder


@pytest.mark.parametrize("list_dir", IMPLEMENTATIONS)
def test_returns_only_names_matching_the_pattern(sub_folder, list_dir):
    entries = list_dir(sub_folder, "Light_*_thn.jpg")

    assert len(entries) == 50
    assert all(e.path.name.endswith("_thn.jpg") for e in entries)
    assert all(e.path.parent == sub_folder for e in entries)
    assert not any(e.is_dir for e in entries)


@pytest.mark.parametrize("list_dir", IMPLEMENTATIONS)
def test_the_star_pattern_lists_everything_but_dot_entries(tmp_path, list_dir):
    _touch(tmp_path / "root" / "M1" / "a.jpg")
    _touch(tmp_path / "root" / "M1_sub" / "b.jpg")
    _touch(tmp_path / "root" / "notes.txt")

    entries = {e.path.name: e.is_dir for e in list_dir(tmp_path / "root", "*")}

    assert entries == {"M1": True, "M1_sub": True, "notes.txt": False}


@pytest.mark.parametrize("list_dir", IMPLEMENTATIONS)
def test_an_existing_folder_with_no_match_is_empty_not_an_error(sub_folder, list_dir):
    assert list_dir(sub_folder, "Stacked_*_thn.jpg") == []


@pytest.mark.parametrize("list_dir", IMPLEMENTATIONS)
def test_a_missing_folder_raises_oserror(tmp_path, list_dir):
    """"Nothing there" and "could not look" must stay distinct: the second is
    what the preview reports as an unreachable share."""
    with pytest.raises(OSError):
        list_dir(tmp_path / "gone", "*")


@pytest.mark.parametrize("list_dir", IMPLEMENTATIONS)
def test_entry_mtime_matches_the_files_own_mtime(sub_folder, list_dir):
    newest = max(list_dir(sub_folder, "Light_*_thn.jpg"), key=lambda e: e.path.name)

    assert share_listing.entry_mtime(newest) == pytest.approx(os.stat(newest.path).st_mtime, abs=1e-6)
    assert share_listing.entry_mtime(newest) == 1_800_000_049


@windows_only
def test_on_windows_the_mtime_comes_from_the_listing_itself(sub_folder, monkeypatch):
    """No stat per entry, and none for the winner either: the find data
    already carries the last-write time."""
    entries = share_listing._list_windows(sub_folder, "Light_*_thn.jpg")

    def no_stat(*args, **kwargs):
        raise AssertionError("stat() called although the listing carried the mtime")

    monkeypatch.setattr(os, "stat", no_stat)
    assert all(e.mtime is not None for e in entries)
    assert share_listing.entry_mtime(entries[0]) == entries[0].mtime


@windows_only
def test_list_matching_uses_the_windows_listing_on_windows(sub_folder, monkeypatch):
    calls = []
    real = share_listing._list_windows

    def spy(directory, pattern):
        calls.append(pattern)
        return real(directory, pattern)

    monkeypatch.setattr(share_listing, "_list_windows", spy)

    share_listing.list_matching(sub_folder, "Light_*_thn.jpg")

    assert calls == ["Light_*_thn.jpg"]


def test_both_implementations_agree_at_scale(tmp_path):
    """2,000 subs, 6,000 entries: the size a long night leaves behind."""
    folder = tmp_path / "M1_sub"
    folder.mkdir()
    for i in range(2000):
        stem = f"Light_M1_10.0s_LP_20260924-{i // 3600:02d}{i // 60 % 60:02d}{i % 60:02d}"
        for suffix in (".fit", ".jpg", "_thn.jpg"):
            (folder / f"{stem}{suffix}").write_bytes(b"")

    portable = sorted(e.path.name for e in share_listing._list_portable(folder, "Light_*_thn.jpg"))
    assert len(portable) == 2000
    if sys.platform == "win32":
        native = sorted(e.path.name for e in share_listing._list_windows(folder, "Light_*_thn.jpg"))
        assert native == portable
