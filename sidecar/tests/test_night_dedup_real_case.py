"""Regression test for the exact real-world case that exposed the original
dedup bug: keying the store's session date on its raw UTC calendar date
(`date_utc[:10]`) while keying the archive's frames on their raw LOCAL
calendar date meant a session that runs past local midnight compared as a
different night from the archive frames captured the evening before, even
though they are the same observing night.

Built from fixtures/list_projects.json's actual M27 session
("2026-07-16T03:50:34+00:00", noted as a "Run 2026-07-15/16") and the archive's real M27 filename shape — not an
invented round number. A synthetic round-number fixture is exactly what let
the original bug ship undetected: test_projects_union.py's existing
overlapping-night tests all pass under both the correct and the broken
keying, because they use timestamps that don't straddle a UTC/local day
boundary. This one does, on purpose.
"""
from datetime import timedelta, timezone

from seestar_sidecar.archive import scan_archive
from seestar_sidecar.projects_union import combine_projects

EDT = timezone(timedelta(hours=-4))  # the real archive's local zone


def _write_light_fit(dir_path, target_display, date_str, time_str):
    stem = f"Light_{target_display}_10.0s_LP_{date_str}-{time_str}"
    (dir_path / f"{stem}.fit").write_text("fit", encoding="utf-8")


def _m27_store_project():
    return [
        {
            "target_id": "M27",
            "target_name": "Dumbbell Nebula",
            "collected_minutes": 35.2,
            "sessions": [
                {
                    "date_utc": "2026-07-16T03:50:34+00:00",
                    "integration_minutes": 35.2,
                    "subs_total": 211,
                    "subs_kept": 211,
                    "median_fwhm": None,
                    "notes": (
                        "Fresh 3PPA this run. Run 2026-07-15/16."
                    ),
                }
            ],
        }
    ]


def _m27_archive_frames(tmp_path):
    """Frames from the SAME physical night, local wall-clock time — 23:06
    EDT on the 15th, matching the session's own start time.
    """
    subs = tmp_path / "M27 Dumbbell Nebula_sub"
    subs.mkdir()
    for i in range(3):
        _write_light_fit(subs, "M27 Dumbbell Nebula", "20260715", f"230{6 + i}00")
    return tmp_path


def test_a_session_past_local_midnight_collides_with_the_evening_before(tmp_path):
    store = _m27_store_project()
    scan = scan_archive(_m27_archive_frames(tmp_path), local_tz=EDT)

    combined = combine_projects(store, scan.targets)

    assert len(combined) == 1
    m27 = combined[0]
    # The archive's 3 frames (0.5 min) must NOT be added on top of the
    # store's 35.2 min: they are the same observing night, already
    # represented by the store's session.
    assert m27["archive_minutes"] == 0.0
    assert m27["total_minutes"] == 35.2


def test_mutation_the_original_naive_keying_would_have_missed_this(tmp_path, monkeypatch):
    """Proves the previous test is not vacuous, but only reverts the store
    side of the original bug: this monkeypatches `_store_nights` back to
    `date_utc[:10]` (its pre-fix form) while leaving the archive side on its
    current dashed-ISO output. The mutated comparison therefore fails for
    two combined reasons — the date itself is genuinely one day off (the
    real bug), and the string format no longer matches the archive's
    (incidental, not the thing this test is about) — so this does not
    isolate which one is doing the work. It still proves the fixed code's
    dedup depends on `_store_nights` producing the correct value, which is
    what matters here.
    """
    from seestar_sidecar import projects_union

    def broken_store_nights(sessions):
        return {
            session["date_utc"][:10].replace("-", "")
            for session in sessions
            if session.get("date_utc")
        }

    monkeypatch.setattr(projects_union, "_store_nights", broken_store_nights)

    store = _m27_store_project()
    scan = scan_archive(_m27_archive_frames(tmp_path), local_tz=EDT)

    combined = projects_union.combine_projects(store, scan.targets)

    # Broken keying compares "20260716" (store, UTC, dash-stripped) against
    # the archive's actual dashed-ISO night — never equal, for either
    # reason above — so the archive's 0.5 min gets added on top instead of
    # excluded.
    assert combined[0]["archive_minutes"] != 0.0
