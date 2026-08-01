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
from seestar_sidecar.projects_union import attach_integration_goals, combine_projects


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
            "nights": [],
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
            "nights": [{"night": "2024-01-01", "frames": 1303, "minutes": 217.2}],
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


# --- nights (per-night archive records — see docs/slice-2-backlog.md's
# "Fix in the sidecar: expose per-night archive records") ------------------


def test_nights_excludes_a_night_the_store_already_has_and_keeps_the_rest():
    """Same fixture as test_overlapping_night_is_not_double_counted, but
    asserting the `nights` field itself rather than only the aggregate
    `archive_minutes` it must stay consistent with — the M31 stopgap this
    field replaces (SessionHistory.tsx) needs the itemised list, not just
    the total.
    """
    store = [_store_project("TEST", "Test Target", 30.0, ["2024-01-04"])]
    archive = {
        "TEST": ArchiveTarget(
            target_id="TEST",
            display_name="TEST",
            minutes=100.0,
            nights=[
                ArchiveNight(night="2024-01-04", subs=600, minutes=100.0),  # excluded
                ArchiveNight(night="2024-01-05", subs=60, minutes=10.0),  # kept
            ],
        )
    }

    result = combine_projects(store, archive)

    entry = result[0]
    assert entry["nights"] == [{"night": "2024-01-05", "frames": 60, "minutes": 10.0}]
    # The invariant that must hold by construction: nights and archive_minutes
    # are computed from the same filtered list, never independently.
    assert sum(n["minutes"] for n in entry["nights"]) == entry["archive_minutes"]


def test_mutation_nights_reappearing_for_a_known_night_would_be_caught():
    """Proves the previous test is not vacuous: a `nights` field built from
    the archive's raw, unfiltered night list (i.e. skipping the same
    de-duplication archive_minutes applies) would include the 2024-01-04
    night the store already covers.
    """
    store = [_store_project("TEST", "Test Target", 30.0, ["2024-01-04"])]
    archive = {
        "TEST": ArchiveTarget(
            target_id="TEST",
            display_name="TEST",
            minutes=110.0,
            nights=[
                ArchiveNight(night="2024-01-04", subs=600, minutes=100.0),
                ArchiveNight(night="2024-01-05", subs=60, minutes=10.0),
            ],
        )
    }

    result = combine_projects(store, archive)

    nights_seen = {n["night"] for n in result[0]["nights"]}
    assert "2024-01-04" not in nights_seen


def test_nights_is_empty_for_a_store_only_target():
    store = [_store_project("M101", "Pinwheel Galaxy", 22.0, ["2026-07-12"])]

    result = combine_projects(store, {})

    assert result[0]["nights"] == []


def test_nights_carries_every_archive_night_for_an_archive_only_target():
    archive = {
        "IC405": ArchiveTarget(
            target_id="IC405",
            display_name="IC 405",
            minutes=227.0,
            nights=[
                ArchiveNight(night="2024-01-01", subs=1303, minutes=217.2),
                ArchiveNight(night="2024-01-19", subs=59, minutes=9.8),
            ],
        )
    }

    result = combine_projects([], archive)

    assert result[0]["nights"] == [
        {"night": "2024-01-01", "frames": 1303, "minutes": 217.2},
        {"night": "2024-01-19", "frames": 59, "minutes": 9.8},
    ]


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


class TestAttachIntegrationGoals:
    """attach_integration_goals is a separate step from combine_projects
    (see projects_union.py) so every test above — including the exact
    whole-dict equality checks — keeps working unchanged with no `goal` key.
    These exercise the enrichment step on its own, with a tiny synthetic
    catalogue rather than the real 12,517-object file.
    """

    CATALOG = {
        "M31": {
            "id": "M31",
            "type": "galaxy",
            "magnitude": 3.4,
            "size_arcmin": 177.8,
        },
        "M45": {
            "id": "M45",
            "type": "open_cluster",
            "magnitude": 1.2,
            "size_arcmin": 150.0,
        },
    }
    ALIASES = {"ANDROMEDA": "M31"}

    def test_known_target_gets_a_photometric_goal(self):
        projects = combine_projects([_store_project("M31", "Andromeda Galaxy", 84.2, [])], {})

        result = attach_integration_goals(projects, self.CATALOG, self.ALIASES, bortle=8)

        assert result[0]["goal"]["track"] == "photometric"
        assert result[0]["goal"]["suggested_hours"] is not None

    def test_target_resolved_only_through_an_alias_still_gets_a_goal(self):
        """combine_projects reports whatever target_id the store/archive use
        ("ANDROMEDA" here, standing in for a real case like "NGC2244") —
        attach_integration_goals must resolve it through the alias index,
        not require it to already be a catalogue id.
        """
        projects = combine_projects([_store_project("ANDROMEDA", "Andromeda Galaxy", 10.0, [])], {})

        result = attach_integration_goals(projects, self.CATALOG, self.ALIASES, bortle=8)

        assert result[0]["goal"]["track"] == "photometric"

    def test_target_absent_from_catalog_and_aliases_gets_goal_none(self):
        projects = combine_projects([_store_project("Unknown", "Unknown", 89.2, [])], {})

        result = attach_integration_goals(projects, self.CATALOG, self.ALIASES, bortle=8)

        assert result[0]["goal"] is None

    def test_cluster_target_gets_the_flat_coarse_band(self):
        projects = combine_projects([_store_project("M45", "Pleiades", 74.5, [])], {})

        result = attach_integration_goals(projects, self.CATALOG, self.ALIASES, bortle=8)

        assert result[0]["goal"]["track"] == "cluster"
        assert result[0]["goal"]["coarse"] is True

    def test_every_entry_gets_a_goal_key_even_when_none(self):
        """Proves the "no missing key" guarantee, not just that one target
        happens to get None: a mutation that only set `goal` on a match and
        left it off entirely for a miss would still pass a test that checked
        only the matched target.
        """
        store = [
            _store_project("M31", "Andromeda Galaxy", 10.0, []),
            _store_project("Unknown", "Unknown", 5.0, []),
        ]

        result = attach_integration_goals(combine_projects(store, {}), self.CATALOG, self.ALIASES, bortle=8)

        assert all("goal" in entry for entry in result)


def test_a_summary_payload_is_rejected_rather_than_silently_inflating():
    """seestar-mcp's detail="summary" omits `sessions` — at our own request.

    Omitting rather than emptying was the right call and we argued for it: an
    empty list renders as "no sessions logged", a real and different state.
    But it makes the ABSENT case reachable here, and this module is where
    absence does the most damage — `sessions` is what archive nights are
    de-duplicated against, so defaulting it to [] means every archive night
    survives and the totals inflate by whatever the store already counted.

    Nothing downstream would catch it: ProjectsCombinedEntrySchema has no
    `sessions` field, so the wrong numbers parse cleanly all the way to the
    card. Loud here, or silent forever.
    """
    summary_shaped = {
        "target_id": "M31",
        "target_name": "Andromeda",
        "goal_minutes": 0.0,
        "collected_minutes": 120.0,
        "status": "active",
        "created_utc": "2026-07-01T20:00:00+00:00",
        "updated_utc": "2026-07-02T20:00:00+00:00",
        # what detail="summary" sends instead — no `sessions` key at all
        "sessions_count": 2,
        "last_session_utc": "2026-07-02T20:00:00+00:00",
        "notes": "",
    }

    try:
        combine_projects([summary_shaped], {})
    except ValueError as exc:
        assert "detail='full'" in str(exc), "the error must say how to fix it"
    else:
        raise AssertionError(
            "a summary payload was accepted; archive_minutes would inflate silently"
        )


def test_an_empty_sessions_list_is_still_accepted():
    """Present-and-empty is a legitimate state — a project with no logged
    sessions yet. Only ABSENCE is the contract violation."""
    project = _store_project("M42", "Orion", 0.0, [])
    project["sessions"] = []

    combined = combine_projects([project], {})

    assert combined[0]["target_id"] == "M42"
    assert combined[0]["store_minutes"] == 0.0
