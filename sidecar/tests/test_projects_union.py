"""combine_projects is pure — no filesystem, no MCP — so these exercise the
union and its de-duplication-by-night logic directly against constructed
data. `ArchiveNight.night` values below are the ISO date strings
`archive.observing_night()` actually produces (see archive.py), not a raw
filename date — test_night_dedup_real_case.py covers the archive-side
timezone conversion that produces them from a real filename, plus the exact
UTC-past-local-midnight case that the naive `date_utc[:10]` keying this
module used to use would have missed silently.
"""
from seestar_sidecar.archive import ArchiveNight, ArchiveTarget
from seestar_sidecar.projects_union import combine_projects


def _store_project(target_id, name, minutes, session_dates):
    return {
        "target_id": target_id,
        "target_name": name,
        "goal_minutes": 0.0,
        "collected_minutes": minutes,
        "status": "active",
        "created_utc": session_dates[0] if session_dates else "",
        "updated_utc": session_dates[-1] if session_dates else "",
        "sessions": [
            {
                # 20:00 UTC: comfortably clear of observing_night()'s noon-UTC
                # boundary in both directions, so `date` round-trips through
                # the night-keying unchanged and these fixtures can reason in
                # plain calendar dates. The boundary itself is covered
                # directly in test_archive.py; a UTC-past-midnight collision
                # that a plain date slice would miss is covered in
                # test_night_dedup_real_case.py.
                "date_utc": f"{date}T20:00:00+00:00",
                "integration_minutes": minutes / max(len(session_dates), 1),
                "subs_total": 10,
                "subs_kept": 10,
                "median_fwhm": None,
                "notes": "",
            }
            for date in session_dates
        ],
        "notes": "",
    }


def test_store_only_target_appears_with_zero_archive_minutes():
    store = [_store_project("M101", "Pinwheel Galaxy", 22.0, ["2026-07-12"])]

    result = combine_projects(store, {})

    assert result == [
        {
            "target_id": "M101",
            "target_name": "Pinwheel Galaxy",
            "store_minutes": 22.0,
            "archive_minutes": 0.0,
            "sources": ["store"],
            "total_minutes": 22.0,
        }
    ]


def test_archive_only_target_appears_with_zero_store_minutes():
    archive = {
        "IC405": ArchiveTarget(
            target_id="IC405",
            display_name="IC 405",
            minutes=217.2,
            nights=[ArchiveNight(night="2024-01-01", subs=1303, minutes=217.2)],
        )
    }

    result = combine_projects([], archive)

    assert result == [
        {
            "target_id": "IC405",
            "target_name": "IC 405",
            "store_minutes": 0.0,
            "archive_minutes": 217.2,
            "sources": ["archive"],
            "total_minutes": 217.2,
        }
    ]


def test_overlapping_target_with_no_shared_night_sums_both_sources():
    """The live case today: M31 in the store (July 2026) and M31 in the
    archive (January 2024) never share a calendar night, so both
    contributions count in full.
    """
    store = [_store_project("M31", "Andromeda Galaxy", 84.2, ["2026-07-13"])]
    archive = {
        "M31": ArchiveTarget(
            target_id="M31",
            display_name="M 31",
            minutes=38.3333,
            nights=[ArchiveNight(night="2024-01-04", subs=230, minutes=38.3333)],
        )
    }

    result = combine_projects(store, archive)

    assert len(result) == 1
    entry = result[0]
    assert entry["sources"] == ["store", "archive"]
    assert entry["store_minutes"] == 84.2
    assert entry["archive_minutes"] == 38.3333
    assert entry["total_minutes"] == 122.5333


def test_overlapping_night_is_not_double_counted():
    """The path live data cannot reach: a night logged to BOTH sources for
    the same target. The archive's raw frame count for that night must be
    excluded from the total — only the store's own record for it counts —
    while a second, non-overlapping archive night still contributes.
    """
    store = [_store_project("TEST", "Test Target", 30.0, ["2024-01-04"])]
    archive = {
        "TEST": ArchiveTarget(
            target_id="TEST",
            display_name="TEST",
            minutes=100.0,
            nights=[
                # Same night as the store session above — must be dropped.
                ArchiveNight(night="2024-01-04", subs=600, minutes=100.0),
                # A different night — must still be counted.
                ArchiveNight(night="2024-01-05", subs=60, minutes=10.0),
            ],
        )
    }

    result = combine_projects(store, archive)

    assert len(result) == 1
    entry = result[0]
    # Not 30 + 100 + 10 = 140: the overlapping night's 100 is excluded.
    assert entry["archive_minutes"] == 10.0
    assert entry["total_minutes"] == 40.0


def test_mutation_double_counting_would_be_caught():
    """Proves the previous test is not vacuous: a combiner that summed every
    archive night unconditionally (i.e. skipped de-duplication entirely)
    would produce 140.0, not 40.0, for the same fixture.
    """
    store = [_store_project("TEST", "Test Target", 30.0, ["2024-01-04"])]
    archive_minutes_if_undeduped = 100.0 + 10.0
    archive = {
        "TEST": ArchiveTarget(
            target_id="TEST",
            display_name="TEST",
            minutes=archive_minutes_if_undeduped,
            nights=[
                ArchiveNight(night="2024-01-04", subs=600, minutes=100.0),
                ArchiveNight(night="2024-01-05", subs=60, minutes=10.0),
            ],
        )
    }

    result = combine_projects(store, archive)

    assert result[0]["total_minutes"] != 30.0 + archive_minutes_if_undeduped


def test_results_are_sorted_by_total_minutes_descending():
    store = [
        _store_project("SMALL", "Small", 5.0, []),
        _store_project("BIG", "Big", 90.0, []),
    ]
    archive = {
        "MEDIUM": ArchiveTarget(
            target_id="MEDIUM",
            display_name="Medium",
            minutes=40.0,
            nights=[ArchiveNight(night="2024-01-01", subs=1, minutes=40.0)],
        )
    }

    result = combine_projects(store, archive)

    assert [p["target_id"] for p in result] == ["BIG", "MEDIUM", "SMALL"]
