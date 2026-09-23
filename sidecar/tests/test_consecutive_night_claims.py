"""Late-logged sessions across CONSECUTIVE nights — the normal multi-night
project case, which the first late-log heuristic got wrong.

A session wound down after 12:00 UTC keys (via observing_night) to the NEXT
night. When the same target was imaged that next night too, the next night
has frames — all of them captured after the session was logged, so none of
them can be the session's. The heuristic used to treat "my key night has
frames" as "my key night is mine": it claimed the next night (dropping its
minutes) and left its own night unclaimed (counting it twice).

The invariant under test: every archive night is counted exactly once —
either by the store session that claims it, or from the archive — and a
night with frames and no claiming session is never dropped.

Nights are constructed directly (ArchiveNight with first/last frame
instants) so the timeline is explicit. Every instant is synthetic UTC.
"""
from datetime import datetime, timedelta, timezone
from itertools import product

import pytest

from seestar_sidecar.archive import ArchiveNight, ArchiveTarget
from seestar_sidecar.projects_union import combine_projects

MINUTES_PER_NIGHT = 10.0


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 9, day, tzinfo=timezone.utc) + timedelta(hours=hour, minutes=minute)


def _night(evening_day: int) -> ArchiveNight:
    """Frames from 22:00 UTC on `evening_day` to 10:00 UTC the next day —
    observing_night() files all of them under `evening_day`."""
    return ArchiveNight(
        night=f"2026-09-{evening_day:02d}",
        subs=60,
        minutes=MINUTES_PER_NIGHT,
        first_frame_utc=_at(evening_day, 22),
        last_frame_utc=_at(evening_day + 1, 10),
    )


def _exact_log(evening_day: int) -> str:
    """Wound down after the last frame, before noon UTC: keys to its own night."""
    return _at(evening_day + 1, 11).isoformat()


def _late_log(evening_day: int) -> str:
    """Wound down at 12:30 UTC the next day: keys to the NEXT night."""
    return _at(evening_day + 1, 12, 30).isoformat()


def _combine(nights: list[ArchiveNight], logged_at: list[str]) -> dict:
    store = [
        {
            "target_id": "M31",
            "target_name": "Andromeda",
            "collected_minutes": MINUTES_PER_NIGHT * len(logged_at),
            "sessions": [
                {
                    "date_utc": when,
                    "integration_minutes": MINUTES_PER_NIGHT,
                    "subs_total": 60,
                    "subs_kept": 60,
                }
                for when in logged_at
            ],
        }
    ]
    archive = {
        "M31": ArchiveTarget(
            target_id="M31",
            display_name="M 31",
            minutes=MINUTES_PER_NIGHT * len(nights),
            nights=nights,
        )
    }
    [entry] = combine_projects(store, archive)
    return entry


def _archive_nights(entry: dict) -> list[str]:
    return [n["night"] for n in entry["nights"]]


def test_two_consecutive_late_logged_nights_are_each_counted_once():
    """Reviewer case (a): both nights wound down at 12:30 UTC, store 20 min.
    Night 1's log time keys to night 2, whose frames all start that evening
    — after the log — so night 2 is not night 1's to claim."""
    entry = _combine([_night(25), _night(26)], [_late_log(25), _late_log(26)])

    assert _archive_nights(entry) == []
    assert entry["archive_minutes"] == 0.0
    assert entry["total_minutes"] == 20.0


def test_a_late_logged_night_does_not_swallow_the_next_night_it_has_no_session_for():
    """Reviewer case (b): night 1 logged late, night 2 imaged but never
    logged. Night 2's minutes exist only in the archive, so dropping them
    loses them outright."""
    entry = _combine([_night(25), _night(26)], [_late_log(25)])

    assert _archive_nights(entry) == ["2026-09-26"]
    assert entry["archive_minutes"] == MINUTES_PER_NIGHT
    assert entry["total_minutes"] == 20.0


def test_a_three_night_run_of_late_logs_is_counted_once_per_night():
    entry = _combine(
        [_night(25), _night(26), _night(27)],
        [_late_log(25), _late_log(26), _late_log(27)],
    )

    assert _archive_nights(entry) == []
    assert entry["total_minutes"] == 30.0


@pytest.mark.parametrize(
    "logging", list(product(["none", "exact", "late"], repeat=3)), ids="-".join
)
def test_every_night_is_counted_exactly_once_whatever_the_logging_pattern(logging):
    """Three consecutive imaged nights; each one has no store session, a
    session logged before noon UTC, or one logged at 12:30 UTC next day.
    Whatever the mix, the archive must contribute exactly the nights no
    session covers — no night dropped, none counted twice."""
    days = [25, 26, 27]
    logged_at = []
    for day, how in zip(days, logging, strict=True):
        if how == "exact":
            logged_at.append(_exact_log(day))
        elif how == "late":
            logged_at.append(_late_log(day))

    entry = _combine([_night(d) for d in days], logged_at)

    unlogged = [f"2026-09-{d:02d}" for d, how in zip(days, logging, strict=True) if how == "none"]
    assert _archive_nights(entry) == unlogged
    assert entry["total_minutes"] == MINUTES_PER_NIGHT * len(days)


def test_a_session_whose_key_night_started_after_it_and_has_no_window_night_claims_nothing():
    """Logged late, but its own frames are not exported yet (the archive lags
    the scope). Its key night has frames — captured after the log — and no
    earlier night lies inside the window. It must claim neither: keeping
    both the session and the archive night risks counting twice, claiming
    the later night drops minutes no session holds."""
    # Night 2026-09-20 ended long before; night 2026-09-26 started after the log.
    entry = _combine([_night(20), _night(26)], [_late_log(25)])

    assert _archive_nights(entry) == ["2026-09-20", "2026-09-26"]
