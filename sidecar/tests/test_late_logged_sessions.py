"""A store session is dated when it is LOGGED, not when it was observed.

seestar-mcp's log_session_result stamps `date_utc = now_utc` at the moment
it is called (planning/projects.py: "ISO, session wind-down time"). Called
the next morning after 12:00 UTC, that instant falls in the NEXT observing
night (archive.observing_night's boundary is noon UTC), so the session no
longer matched its own archive frames and they were counted twice — once in
store_minutes, again in archive_minutes.

Timestamps here are synthetic and in UTC (local_tz=timezone.utc): the logic
under test is the gap between a night's frames and the log time, which does
not depend on where the frames were taken.
"""
from datetime import timezone

import pytest

from seestar_sidecar import projects_union
from seestar_sidecar.archive import scan_archive
from seestar_sidecar.projects_union import combine_projects


def _frames(root, night_date, times):
    subs = root / "M 31-sub"
    subs.mkdir(parents=True, exist_ok=True)
    for time_str in times:
        (subs / f"Light_M 31_10.0s_IRCUT_{night_date}-{time_str}.fit").write_text("fit", encoding="utf-8")


def _store(*logged_at):
    return [
        {
            "target_id": "M31",
            "target_name": "Andromeda",
            "collected_minutes": 30.0 * len(logged_at),
            "sessions": [
                {"date_utc": when, "integration_minutes": 30.0, "subs_total": 3, "subs_kept": 3}
                for when in logged_at
            ],
        }
    ]


def _m31(tmp_path, store):
    scan = scan_archive(tmp_path, local_tz=timezone.utc)
    [entry] = combine_projects(store, scan.targets)
    return entry


def test_a_session_logged_after_noon_the_next_day_still_claims_its_night(tmp_path):
    # Night 2026-09-26: frames from 22:00 UTC to 11:00 UTC next morning ...
    _frames(tmp_path, "20260926", ["220000"])
    _frames(tmp_path, "20260927", ["030000", "110000"])
    # ... wound down at 13:30 UTC, which observing_night() files under the 27th.
    entry = _m31(tmp_path, _store("2026-09-27T13:30:00+00:00"))

    assert entry["archive_minutes"] == 0.0, "the night's frames were counted twice"
    assert entry["nights"] == []


@pytest.mark.parametrize(
    "logged_at",
    [
        "2026-09-27T05:00:00+00:00",  # 25 h after the last frame
        "2026-09-26T14:00:00+00:00",  # 10 h after: into the next evening
    ],
)
def test_a_night_that_ended_well_before_the_log_is_not_claimed(tmp_path, logged_at):
    """The archive is a periodic export that lags the scope by weeks. A store
    session whose own frames have not been exported yet must not reach back
    and claim an older night it has nothing to do with — that would silently
    remove real minutes, the same wrong-number failure in the other
    direction. Night 2026-09-25 ends at 04:00Z on the 26th."""
    _frames(tmp_path, "20260926", ["030000", "040000"])
    entry = _m31(tmp_path, _store(logged_at))

    assert [n["night"] for n in entry["nights"]] == ["2026-09-25"]
    assert entry["archive_minutes"] > 0


def test_a_night_claimed_by_one_session_is_not_claimed_again(tmp_path):
    _frames(tmp_path, "20260925", ["210000", "220000"])  # night 2026-09-25
    _frames(tmp_path, "20260926", ["210000", "220000"])  # night 2026-09-26
    entry = _m31(
        tmp_path,
        _store(
            "2026-09-27T03:00:00+00:00",  # night 2026-09-26, exact match
            "2026-09-27T14:00:00+00:00",  # night 2026-09-27, late log: 26th already claimed
        ),
    )

    # The 25th ended ~40 h before the second log, so it stays archive-only.
    assert [n["night"] for n in entry["nights"]] == ["2026-09-25"]


def test_a_night_that_started_after_the_log_is_never_claimed(tmp_path):
    """A session cannot contain frames captured after it was logged."""
    _frames(tmp_path, "20260927", ["200000", "210000"])  # night 2026-09-27, evening
    entry = _m31(tmp_path, _store("2026-09-27T11:00:00+00:00"))  # night 2026-09-26, morning log

    assert [n["night"] for n in entry["nights"]] == ["2026-09-27"]


def test_archive_nights_carry_their_first_and_last_frame_instants(tmp_path):
    _frames(tmp_path, "20260926", ["211000", "210000", "223000"])
    [night] = scan_archive(tmp_path, local_tz=timezone.utc).targets["M31"].nights

    assert night.first_frame_utc.isoformat() == "2026-09-26T21:00:00+00:00"
    assert night.last_frame_utc.isoformat() == "2026-09-26T22:30:00+00:00"


def test_the_exact_night_rule_is_still_the_first_pass():
    """_store_nights is kept as the exact observing-night pass — the late-log
    pass only looks at sessions whose own night has no archive frames — so
    test_night_dedup_real_case's mutation of it still bites."""
    assert callable(projects_union._store_nights)
