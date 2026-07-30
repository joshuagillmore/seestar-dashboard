"""The archive scan never touches the real ~19,600-file OneDrive archive —
every test here builds a small synthetic tree under tmp_path with a known
frame count, per the slice-2 spec.
"""
from datetime import date, datetime, timedelta, timezone

import pytest

from seestar_sidecar.archive import (
    EXPOSURE_SECONDS,
    _local_capture_instant_utc,
    normalize_target_id,
    observing_night,
    scan_archive,
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
    seq  # unused, kept for call-site readability of "the Nth frame"


def test_missing_root_returns_an_empty_scan_not_an_error(tmp_path):
    scan = scan_archive(tmp_path / "does-not-exist", local_tz=EDT)
    assert scan.targets == {}
    assert scan.warnings == []


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
    # holds stacked master files this phase doesn't read.
    plain = tmp_path / "M 81"
    plain.mkdir()
    (plain / "Stacked_M 81_10.0s_IRCUT_20240101-000000.fit").write_text("x", encoding="utf-8")

    scan = scan_archive(tmp_path, local_tz=EDT)

    assert scan.targets == {}
