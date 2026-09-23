"""The archive scan never touches the real ~19,600-file OneDrive archive —
every test here builds a small synthetic tree under tmp_path with a known
frame count, per the slice-2 spec.
"""
from datetime import date, datetime, timedelta, timezone

import pytest

from seestar_sidecar.archive import (
    EXPOSURE_SECONDS,
    ArchiveStatus,
    _local_capture_instant_utc,
    normalize_target_id,
    observing_night,
    scan_archive,
    scan_stacked_images,
)

#: A fixed offset, not a tzdata zone: no DST-table dependency, and it
#: matches the real archive's actual local zone (verified against a live
#: file's mtime — see archive.py). Passed explicitly to every scan_archive()
#: call below so this suite's result does not depend on the timezone of
#: whatever machine happens to run it; production leaves local_tz=None and
#: gets the system's own zone (see _local_capture_instant_utc's docstring).
EDT = timezone(timedelta(hours=-4))

# --- normalize_target_id --------------------------------------------------
#
# Real directory names seen in the live archive, not invented shapes: a
# spaced catalog id ("M 31"), a compact id immediately followed by the
# object's common name ("M27 Dumbbell Nebula"), a spaced id followed by a
# multi-word common name ("NGC 2244 Satellite Cluster"), an id with no space
# anywhere ("SH2-142"), and the one non-catalog directory ("Unknown").


@pytest.mark.parametrize(
    "raw_name, expected_id",
    [
        ("M 31", "M31"),
        ("NGC 281", "NGC281"),
        ("IC 405", "IC405"),
        ("LDN 1625", "LDN1625"),
        ("C 33", "C33"),
        ("M 106", "M106"),
        ("M27 Dumbbell Nebula", "M27"),
        ("M57 Ring Nebula", "M57"),
        ("NGC 2244 Satellite Cluster", "NGC2244"),
        ("SH2-142", "SH2-142"),
        ("Unknown", "Unknown"),
    ],
)
def test_normalize_target_id_matches_the_live_archive(raw_name, expected_id):
    assert normalize_target_id(raw_name) == expected_id


# --- observing_night ---------------------------------------------------
#
# Pure function, already-aware UTC in and out: no filesystem, no timezone
# assumption, so these are fully deterministic regardless of the machine.


def test_observing_night_labels_a_post_midnight_instant_with_the_evening_before():
    # The real case that exposed the bug: a store session wound down at
    # 03:50 UTC (past local midnight) belongs to the night that started the
    # evening before, not the UTC calendar day it happens to fall on.
    instant = datetime(2026, 7, 16, 3, 50, 34, tzinfo=timezone.utc)
    assert observing_night(instant) == date(2026, 7, 15)


def test_observing_night_leaves_an_evening_instant_on_its_own_date():
    instant = datetime(2026, 7, 15, 20, 0, 0, tzinfo=timezone.utc)
    assert observing_night(instant) == date(2026, 7, 15)


def test_observing_night_boundary_is_exactly_twelve_hours():
    just_before_noon = datetime(2026, 7, 15, 11, 59, 59, tzinfo=timezone.utc)
    at_noon = datetime(2026, 7, 15, 12, 0, 0, tzinfo=timezone.utc)
    assert observing_night(just_before_noon) == date(2026, 7, 14)
    assert observing_night(at_noon) == date(2026, 7, 15)


# --- _local_capture_instant_utc -----------------------------------------


def test_local_capture_instant_utc_applies_the_given_offset():
    # 01:07:35 EDT (UTC-4) -> 05:07:35 UTC — the real M27 filename's stamp.
    instant = _local_capture_instant_utc("20260705", "010735", EDT)
    assert instant == datetime(2026, 7, 5, 5, 7, 35, tzinfo=timezone.utc)


# --- scan_archive ----------------------------------------------------------


def _light_fit(dir_path, target_display, date_str, time_str, seq, exposure="10.0"):
    """Write one Light_*.fit at the archive's real naming shape, plus the
    .jpg/_thn.jpg siblings a real capture leaves behind — present so a test
    that counted anything other than exactly the .fit files would fail.
    """
    stem = f"Light_{target_display}_{exposure}s_LP_{date_str}-{time_str}"
    (dir_path / f"{stem}.fit").write_text("fit", encoding="utf-8")
    (dir_path / f"{stem}.jpg").write_text("jpg", encoding="utf-8")
    (dir_path / f"{stem}_thn.jpg").write_text("thn", encoding="utf-8")
    del seq  # unused, kept for call-site readability of "the Nth frame"


def test_missing_root_returns_an_empty_scan_not_an_error(tmp_path):
    scan = scan_archive(tmp_path / "does-not-exist", local_tz=EDT)
    assert scan.targets == {}
    assert scan.warnings == []


# --- ArchiveStatus — "not configured" vs "configured but not found" vs
# "configured, present, genuinely empty" (see docs/configuration.md and the
# module docstring's portability note) -------------------------------------


def test_status_reports_unconfigured_when_root_is_none():
    # root=None is what DEFAULT_ARCHIVE_DIR resolves to when SEESTAR_ARCHIVE_DIR
    # is unset — nobody has told the sidecar where an archive lives at all,
    # distinct from a path that was given but isn't there (see below).
    scan = scan_archive(None, local_tz=EDT)
    assert scan.status == ArchiveStatus(configured=False, path=None, exists=False, target_count=0)


def test_status_reports_configured_but_missing_for_a_nonexistent_root(tmp_path):
    missing = tmp_path / "does-not-exist"
    scan = scan_archive(missing, local_tz=EDT)
    assert scan.status == ArchiveStatus(
        configured=True, path=str(missing), exists=False, target_count=0
    )


def test_status_reports_configured_and_present_for_a_genuinely_empty_directory(tmp_path):
    # A real, reachable directory with nothing in it yet — must read
    # differently from both "unconfigured" and "configured but not found":
    # the user pointed at a real place, it's just empty right now.
    scan = scan_archive(tmp_path, local_tz=EDT)
    assert scan.status == ArchiveStatus(
        configured=True, path=str(tmp_path), exists=True, target_count=0
    )
    assert scan.targets == {}


def test_status_target_count_matches_a_populated_scan(tmp_path):
    subs = tmp_path / "M 31-sub"
    subs.mkdir()
    _light_fit(subs, "M 31", "20240104", "200000", 0)

    scan = scan_archive(tmp_path, local_tz=EDT)

    assert scan.status == ArchiveStatus(
        configured=True, path=str(tmp_path), exists=True, target_count=1
    )


def test_counts_only_light_fit_files_in_the_sub_directory(tmp_path):
    root = tmp_path
    stacked = root / "M 31"
    stacked.mkdir()
    (stacked / "Stacked_M 31_10.0s_IRCUT_20240104-202236.fit").write_text("x", encoding="utf-8")
    subs = root / "M 31-sub"
    subs.mkdir()
    for i in range(3):
        _light_fit(subs, "M 31", "20240104", f"20014{i}", i)

    scan = scan_archive(root, local_tz=EDT)

    assert set(scan.targets) == {"M31"}
    target = scan.targets["M31"]
    assert target.display_name == "M 31"
    # 3 subs x 10.0s = 30s = 0.5 min. Not 6 (the 3 .fit + 3 .jpg + 3 _thn.jpg
    # files this fixture also wrote) and not 12 (those plus the stacked dir).
    assert target.minutes == pytest.approx(0.5)


def test_underscore_sub_suffix_is_recognised(tmp_path):
    # Two of the twenty-two live directories use "_sub" instead of "-sub"
    # ("M27 Dumbbell Nebula_sub", "M57 Ring Nebula_sub") — an archive scan
    # that only matched "-sub" would silently drop those targets.
    subs = tmp_path / "M27 Dumbbell Nebula_sub"
    subs.mkdir()
    _light_fit(subs, "M27 Dumbbell Nebula", "20260705", "010735", 0)

    scan = scan_archive(tmp_path, local_tz=EDT)

    assert "M27" in scan.targets
    assert scan.targets["M27"].display_name == "M27 Dumbbell Nebula"


# --- ArchiveTarget.sub_paths — qa_analysis.py's one way to resolve a
# target to the FITS paths qa_tier2 needs (see docs/superpowers/specs/
# 2026-07-31-slice-4-review-qa.md §1: "reuse archive.py's existing scan, not
# a second walk of the same tree"). Both directory-naming conventions are
# tested independently, exactly as the sub-counting tests above already do,
# because a resolver that only walked "-sub" would silently see zero subs
# for the two live "_sub" targets.


def test_sub_paths_lists_every_light_fit_in_a_dash_sub_directory(tmp_path):
    subs = tmp_path / "M 31-sub"
    subs.mkdir()
    for i in range(3):
        _light_fit(subs, "M 31", "20240104", f"20014{i}", i)

    scan = scan_archive(tmp_path, local_tz=EDT)

    sub_paths = scan.targets["M31"].sub_paths
    assert len(sub_paths) == 3
    assert all(p.name.startswith("Light_M 31_") and p.suffix == ".fit" for p in sub_paths)
    # Every path is real and lives in the "-sub" directory, not its plain
    # stacked-master sibling.
    assert all(p.is_file() and p.parent == subs for p in sub_paths)


def test_sub_paths_recognises_the_underscore_sub_convention_too(tmp_path):
    subs = tmp_path / "M27 Dumbbell Nebula_sub"
    subs.mkdir()
    for i in range(2):
        _light_fit(subs, "M27 Dumbbell Nebula", "20260705", f"01073{i}", i)

    scan = scan_archive(tmp_path, local_tz=EDT)

    sub_paths = scan.targets["M27"].sub_paths
    assert len(sub_paths) == 2
    assert all(p.parent == subs for p in sub_paths)


def test_sub_paths_includes_a_file_whose_name_did_not_parse(tmp_path):
    # qa_tier2 doesn't care about a filename's shape — only the pixels — so
    # a sub whose name fails _parse_light_filename (see the "unparseable
    # filename" test elsewhere in this file) must still be a candidate for
    # analysis, even though it can't be attributed to any observing night.
    subs = tmp_path / "M 45-sub"
    subs.mkdir()
    (subs / "Light_totally_unexpected_shape.fit").write_text("x", encoding="utf-8")

    scan = scan_archive(tmp_path, local_tz=EDT)

    assert [p.name for p in scan.targets["M45"].sub_paths] == [
        "Light_totally_unexpected_shape.fit"
    ]


def test_sub_paths_is_empty_for_a_target_with_no_subs_captured_yet(tmp_path):
    subs = tmp_path / "NGC 281-sub"
    subs.mkdir()  # no Light_*.fit written at all

    scan = scan_archive(tmp_path, local_tz=EDT)

    assert scan.targets["NGC281"].sub_paths == []


def test_groups_by_night_and_sums_across_nights(tmp_path):
    subs = tmp_path / "NGC 281-sub"
    subs.mkdir()
    # 10:00 local: comfortably clear of the observing_night() boundary (noon
    # UTC = 08:00 EDT) in both directions, so each group stays on its own
    # filename date — this test is about grouping, not the boundary itself
    # (see the dedicated observing_night() boundary test above).
    for i in range(2):
        _light_fit(subs, "NGC 281", "20240104", f"10000{i}", i)
    for i in range(5):
        _light_fit(subs, "NGC 281", "20240116", f"10000{i}", i)

    scan = scan_archive(tmp_path, local_tz=EDT)

    target = scan.targets["NGC281"]
    nights = {n.night: n.subs for n in target.nights}
    assert nights == {"2024-01-04": 2, "2024-01-16": 5}
    # abs=1e-4: scan_archive rounds minutes to 4 decimal places for clean
    # JSON output, coarser than pytest.approx's default relative tolerance.
    assert target.minutes == pytest.approx((2 + 5) * EXPOSURE_SECONDS / 60, abs=1e-4)


def test_post_midnight_capture_is_grouped_with_the_evening_before(tmp_path):
    """The real M27 shape: a frame timestamped 01:07 local on the 5th is
    the same observing night as one timestamped 23:50 local on the 4th, not
    a separate night — this is what observing_night() is for.
    """
    subs = tmp_path / "M 42-sub"
    subs.mkdir()
    _light_fit(subs, "M 42", "20260704", "235000", 0)
    _light_fit(subs, "M 42", "20260705", "010735", 1)

    scan = scan_archive(tmp_path, local_tz=EDT)

    target = scan.targets["M42"]
    assert len(target.nights) == 1
    assert target.nights[0].night == "2026-07-04"
    assert target.nights[0].subs == 2


def test_unknown_directory_is_surfaced_as_is(tmp_path):
    # Per the hand-back rule: report it, don't drop it or guess a target.
    subs = tmp_path / "Unknown-sub"
    subs.mkdir()
    _light_fit(subs, "Unknown", "20240101", "000000", 0)

    scan = scan_archive(tmp_path, local_tz=EDT)

    assert scan.targets["Unknown"].display_name == "Unknown"


def test_exposure_mismatch_is_reported_but_still_uses_the_fixed_constant(tmp_path):
    """The spec is explicit: don't parse per-file exposure, but do assert the
    10.0s assumption holds and report a disagreement. This proves both
    halves: the mismatched file produces a warning, AND its contribution to
    the target's minutes still uses EXPOSURE_SECONDS rather than the 5.0s the
    filename actually claims — the fixed-constant shortcut is deliberate, not
    silently abandoned the first time a file disagrees with it.
    """
    subs = tmp_path / "M 42-sub"
    subs.mkdir()
    _light_fit(subs, "M 42", "20240101", "000000", 0, exposure="5.0")

    scan = scan_archive(tmp_path, local_tz=EDT)

    assert len(scan.warnings) == 1
    assert "exposure" in scan.warnings[0]
    assert "5.0" in scan.warnings[0]
    # One frame at the fixed 10.0s assumption, not the claimed 5.0s.
    assert scan.targets["M42"].minutes == pytest.approx(EXPOSURE_SECONDS / 60, abs=1e-4)


def test_unparseable_filename_is_warned_and_not_counted(tmp_path):
    subs = tmp_path / "M 45-sub"
    subs.mkdir()
    (subs / "Light_totally_unexpected_shape.fit").write_text("x", encoding="utf-8")

    scan = scan_archive(tmp_path, local_tz=EDT)

    assert len(scan.warnings) == 1
    assert scan.targets["M45"].minutes == 0
    assert scan.targets["M45"].nights == []


def test_non_sub_directories_are_ignored(tmp_path):
    # Only "*-sub"/"*_sub" holds individual subs; the paired plain directory
    # holds stacked master files — scan_archive() doesn't read those (see
    # scan_stacked_images() below, which does).
    plain = tmp_path / "M 81"
    plain.mkdir()
    (plain / "Stacked_M 81_10.0s_IRCUT_20240101-000000.fit").write_text("x", encoding="utf-8")

    scan = scan_archive(tmp_path, local_tz=EDT)

    assert scan.targets == {}


# --- scan_stacked_images -----------------------------------------------


def _stacked_jpg(dir_path, target_display, date_str, time_str, content, thumbnail=False):
    """Write one stacked-master JPEG (or its `_thn` thumbnail sibling) with
    distinguishable `content` bytes, so a test can tell which file scan_
    stacked_images() actually picked rather than only that something was
    picked.
    """
    suffix = "_thn" if thumbnail else ""
    name = f"Stacked_{target_display}_10.0s_LP_{date_str}-{time_str}{suffix}.jpg"
    (dir_path / name).write_bytes(content)


def test_missing_root_returns_an_empty_dict_not_an_error(tmp_path):
    assert scan_stacked_images(tmp_path / "does-not-exist", local_tz=EDT) == {}


def test_unconfigured_root_returns_an_empty_dict_not_an_error():
    # root=None (SEESTAR_ARCHIVE_DIR unset) — same degrade as a missing
    # directory, since this function has no imagery to attach either way.
    assert scan_stacked_images(None, local_tz=EDT) == {}


def test_finds_the_stacked_image_in_the_plain_directory_not_the_sub_directory(tmp_path):
    plain = tmp_path / "M 31"
    plain.mkdir()
    _stacked_jpg(plain, "M 31", "20240104", "230352", b"full-res-bytes")
    subs = tmp_path / "M 31-sub"
    subs.mkdir()
    (subs / "Light_M 31_10.0s_IRCUT_20240104-213812.fit").write_text("x", encoding="utf-8")

    images = scan_stacked_images(tmp_path, local_tz=EDT)

    assert set(images) == {"M31"}
    assert images["M31"].path.read_bytes() == b"full-res-bytes"
    assert images["M31"].is_thumbnail is False


def test_underscore_sub_suffix_directory_is_not_mistaken_for_a_stack(tmp_path):
    # Mirrors test_underscore_sub_suffix_is_recognised above, from the
    # imagery side: "M27 Dumbbell Nebula_sub" must not itself be scanned for
    # stacked masters just because it doesn't end in "-sub".
    plain = tmp_path / "M27 Dumbbell Nebula"
    plain.mkdir()
    _stacked_jpg(plain, "M27 Dumbbell Nebula", "20260705", "010735", b"m27-full")
    subs = tmp_path / "M27 Dumbbell Nebula_sub"
    subs.mkdir()
    _stacked_jpg(subs, "M27 Dumbbell Nebula", "20260705", "010735", b"should-not-be-picked-up")

    images = scan_stacked_images(tmp_path, local_tz=EDT)

    assert set(images) == {"M27"}
    assert images["M27"].path.read_bytes() == b"m27-full"


def test_full_resolution_preferred_over_thumbnail_for_the_same_stack(tmp_path):
    plain = tmp_path / "IC 405"
    plain.mkdir()
    _stacked_jpg(plain, "IC 405", "20240206", "004006", b"thumb-bytes", thumbnail=True)
    _stacked_jpg(plain, "IC 405", "20240206", "004006", b"full-bytes", thumbnail=False)

    images = scan_stacked_images(tmp_path, local_tz=EDT)

    assert images["IC405"].path.read_bytes() == b"full-bytes"
    assert images["IC405"].is_thumbnail is False


def test_thumbnail_only_stack_is_still_served(tmp_path):
    # The real IC 405 case: its earliest stack (2024-01-19) only ever wrote a
    # _thn.jpg, no full-resolution sibling — must still resolve to something
    # rather than being skipped for lacking the preferred file.
    plain = tmp_path / "IC 405"
    plain.mkdir()
    _stacked_jpg(plain, "IC 405", "20240119", "191930", b"only-a-thumbnail", thumbnail=True)

    images = scan_stacked_images(tmp_path, local_tz=EDT)

    assert images["IC405"].path.read_bytes() == b"only-a-thumbnail"
    assert images["IC405"].is_thumbnail is True


def test_most_recent_stack_is_chosen_among_several(tmp_path):
    plain = tmp_path / "IC 405"
    plain.mkdir()
    _stacked_jpg(plain, "IC 405", "20240119", "191930", b"oldest")
    _stacked_jpg(plain, "IC 405", "20240301", "000138", b"newest")
    _stacked_jpg(plain, "IC 405", "20240229", "212739", b"middle")

    images = scan_stacked_images(tmp_path, local_tz=EDT)

    assert images["IC405"].path.read_bytes() == b"newest"


def test_a_target_with_no_plain_directory_is_absent_from_the_result(tmp_path):
    # Only the "-sub" directory exists (e.g. captured but never stacked yet,
    # or a fixture that only wrote subs) — must not raise or invent an entry.
    subs = tmp_path / "M 45-sub"
    subs.mkdir()
    (subs / "Light_M 45_10.0s_LP_20240101-000000.fit").write_text("x", encoding="utf-8")

    images = scan_stacked_images(tmp_path, local_tz=EDT)

    assert images == {}


def test_non_stacked_files_in_the_plain_directory_are_ignored(tmp_path):
    plain = tmp_path / "M 45"
    plain.mkdir()
    (plain / "Stacked_M 45_10.0s_LP_20240101-000000.fit").write_bytes(b"not-a-jpeg")
    (plain / "notes.txt").write_text("hello", encoding="utf-8")

    images = scan_stacked_images(tmp_path, local_tz=EDT)

    assert images == {}


def test_mosaic_panels_do_not_collapse_to_the_same_id():
    """"Veil Nebula East" and "Veil Nebula West" both folded to "Veil".

    Not cosmetic: the live preview's share scan normalises a directory name
    and compares it against a normalised target, so two panels of one nebula
    shared an id and the screen could show the East panel's frame while
    imaging West. Mosaic panels of a large nebula are a normal observing
    pattern, not a contrived case.
    """
    assert normalize_target_id("Veil Nebula East") != normalize_target_id("Veil Nebula West")


def test_a_leading_word_is_only_dropped_when_it_is_itself_a_designation():
    # Kept: the first token carries digits, so it IS the id and the trailing
    # common name is noise.
    assert normalize_target_id("M27 Dumbbell Nebula") == "M27"
    assert normalize_target_id("M57 Ring Nebula") == "M57"
    assert normalize_target_id("SH2-142") == "SH2-142"
    # Spaced designations are handled before this branch.
    assert normalize_target_id("NGC 2244 Satellite Cluster") == "NGC2244"
    assert normalize_target_id("M 31") == "M31"
    # No designation anywhere: nothing may be discarded.
    assert normalize_target_id("Veil Nebula East") == "VeilNebulaEast"
    assert normalize_target_id("the fuzzy one near Cygnus") == "thefuzzyonenearCygnus"


def test_single_token_names_are_unchanged():
    # "Unknown" is the archive's own bucket for undetermined captures and is
    # surfaced as-is per the hand-back rule — report it, don't guess.
    assert normalize_target_id("Unknown") == "Unknown"
    assert normalize_target_id("M31") == "M31"
    assert normalize_target_id("") == ""


# --- two sub directories for one target -------------------------------------


def test_sub_directories_that_normalise_to_one_target_are_merged(tmp_path):
    """`M 31-sub` and `M 31_sub` both normalise to M31 (the archive has held
    both suffix spellings). The scan assigned targets[target_id] per
    directory, so the second one found silently replaced the first: 2 of
    these 3 subs vanished from every total and from QA's path list.
    last_stack.discover_last_stack already scans every directory that
    normalises to its target; this does the same."""
    first = tmp_path / "M 31-sub"
    second = tmp_path / "M 31_sub"
    first.mkdir()
    second.mkdir()
    (first / "Light_M 31_10.0s_IRCUT_20240102-220000.fit").write_text("fit", encoding="utf-8")
    (first / "Light_M 31_10.0s_IRCUT_20240103-220000.fit").write_text("fit", encoding="utf-8")
    (second / "Light_M 31_10.0s_IRCUT_20240102-221000.fit").write_text("fit", encoding="utf-8")

    scan = scan_archive(tmp_path, local_tz=EDT)

    assert list(scan.targets) == ["M31"]
    target = scan.targets["M31"]
    assert len(target.sub_paths) == 3
    assert {p.parent.name for p in target.sub_paths} == {"M 31-sub", "M 31_sub"}
    assert [(n.night, n.subs) for n in target.nights] == [("2024-01-02", 2), ("2024-01-03", 1)]
    assert target.minutes == round(3 * EXPOSURE_SECONDS / 60, 4)
    assert target.display_name == "M 31"
    assert scan.status.target_count == 1
