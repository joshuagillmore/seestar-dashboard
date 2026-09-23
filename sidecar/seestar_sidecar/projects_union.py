"""Union of the projects store (`list_projects`) with the archive scan.

Neither source is complete alone — see docs/slice-2-backlog.md, "time on
target is currently unknowable". This module is pure and side-effect free
(no filesystem, no MCP) so it is unit-testable on its own; routes.py wires
it to the live store payload and `archive.scan_archive()`.
"""
from datetime import datetime, timedelta

from seestar_sidecar.archive import ArchiveNight, ArchiveTarget, observing_night
from seestar_sidecar.catalog import resolve as resolve_catalog_entry
from seestar_sidecar.integration_goal import suggest_integration_goal


def _store_nights(sessions: list[dict]) -> set[str]:
    """The observing nights (see `archive.observing_night()`) a store
    project has session records for, so the two sources compare night-for-
    night rather than only target-for-target.

    `date_utc` is an aware UTC instant, not a local one, so it must go
    through the same `observing_night()` archive.py's per-frame timestamps
    do — keying on its raw calendar date (`date_utc[:10]`) is a different,
    incompatible frame of reference and was the bug this module shipped
    with: a session that runs past local midnight is recorded at a UTC
    instant on the *next* calendar day, which a plain date slice reads as a
    different night than the archive frames from the same evening.
    """
    nights: set[str] = set()
    for instant in _logged_at(sessions):
        nights.add(observing_night(instant).isoformat())
    return nights


def _logged_at(sessions: list[dict]) -> list[datetime]:
    instants = []
    for session in sessions:
        date_utc = session.get("date_utc") or ""
        try:
            instants.append(datetime.fromisoformat(date_utc.replace("Z", "+00:00")))
        except ValueError:
            continue
    return instants


#: How long after a night's last frame a session may be logged and still be
#: matched to that night by `_late_logged_nights`. The case this exists for
#: is a dawn wind-down that crosses 12:00 UTC (a winter dawn in the Americas
#: does), minutes to a couple of hours after the last frame. Six hours after
#: a night's last frame is still daylight, so no LATER night's session can
#: have both run and been logged inside the window. Longer would reach into
#: the next evening, where a short session logged early could claim the
#: night before it.
LATE_LOG_WINDOW = timedelta(hours=6)


def _late_logged_nights(
    sessions: list[dict], archive_nights: list[ArchiveNight], claimed: set[str]
) -> set[str]:
    """Archive nights claimed by sessions that were logged the day after.

    seestar-mcp stamps a session's `date_utc` when log_session_result is
    CALLED (its wind-down time), not when it was observed. Logged after 12:00
    UTC the next morning, that instant falls in the next observing night, so
    `_store_nights` keys it one night late: it matched none of its own frames,
    and they were counted twice — store_minutes and archive_minutes both.

    For a session whose own night has no archive frames, this claims the
    latest earlier night that no session has claimed yet — but ONLY if the
    session was logged between that night's first frame and LATE_LOG_WINDOW
    after its last. The bound is the point. The archive is a periodic export
    that lags the scope by weeks, so "latest night on or before" alone would
    let a recent session whose frames are not exported yet claim an older
    night it has nothing to do with, silently removing real minutes. A
    session cannot contain frames captured after it was logged, and outside
    the window this falls back to the old behaviour — possibly counting a
    night twice, never dropping one.

    Remains a heuristic: the robust fix is a session-START (or observing
    night) field on seestar-mcp's SessionRecord — a hand-back item, since
    `date_utc` alone cannot say which night a session observed.
    """
    by_night = {n.night: n for n in archive_nights}
    claimed = set(claimed)
    extra: set[str] = set()
    for instant in sorted(_logged_at(sessions)):
        if observing_night(instant).isoformat() in by_night:
            continue  # its own night has frames: the exact pass handles it
        candidates = [
            n
            for n in archive_nights
            if n.night not in claimed
            and n.first_frame_utc is not None
            and n.last_frame_utc is not None
            and n.first_frame_utc <= instant <= n.last_frame_utc + LATE_LOG_WINDOW
        ]
        if candidates:
            night = max(candidates, key=lambda n: n.night).night
            claimed.add(night)
            extra.add(night)
    return extra


def combine_projects(
    store_projects: list[dict], archive_targets: dict[str, ArchiveTarget]
) -> list[dict]:
    """Union store projects with archive targets by normalised target_id.

    De-duplicates by observing night (see `archive.observing_night()`): a
    night the store already has a session record for is not also counted
    from the archive, even though the archive's raw frame count for that
    night is a different (unfiltered) number from the store's QA-aware
    `integration_minutes`. The store's own record wins for any night it
    knows about; the archive only contributes nights the store has never
    heard of. Today no target's store and archive nights actually coincide
    once both are read through observing_night() — checked directly against
    the four targets both sources currently know about (M31, M27, M57,
    NGC281) — so this is a no-op on live data. The path that matters is
    exercised with a synthetic overlapping fixture in
    test_projects_union.py, because live data cannot reach it.

    Each returned entry reports the total *and* the per-source split
    (`store_minutes`, `archive_minutes`, `sources`), so the UI can show
    provenance instead of a single unexplained number. A target present in
    only one source still appears, with the other source's minutes at 0.

    `nights` carries the archive's own per-night detail (see
    `archive.ArchiveNight`) as `{night, frames, minutes}` dicts — the
    Projects session table's itemisation the M31 stopgap note
    (SessionHistory.tsx) says doesn't exist yet: today it can only show the
    store's own sessions, so a target present in both sources reads lower
    on the table than its card total. Filtered through the exact same
    `known_nights` exclusion used for `archive_minutes` above, not
    recomputed independently, so the two can never disagree about which
    nights survived the union — `sum(n["minutes"] for n in nights) ==
    archive_minutes` always holds by construction, and a night the store
    already logged never reappears here just because the UI now has
    somewhere to put it. Store-only targets get `nights: []`: their detail
    is already fully available as `sessions` on the matching `list_projects`
    entry (joined client-side — see web/src/screens/projects/projects.ts),
    so there is nothing archive-side to add.
    """
    combined: dict[str, dict] = {}
    store_nights_by_target: dict[str, set[str]] = {}
    sessions_by_target: dict[str, list[dict]] = {}

    for project in store_projects:
        target_id = project["target_id"]
        # `sessions` ABSENT and `sessions` EMPTY mean opposite things here, and
        # the difference is not cosmetic: these nights are what archive nights
        # are de-duplicated against below. An absent key defaulted to [] gives
        # an empty `known_nights`, so every archive night survives the union
        # and `archive_minutes` / `total_minutes` silently inflate by whatever
        # the store already counted. Every field stays present and numeric, so
        # ProjectsCombinedEntrySchema parses it happily — a wrong number with
        # no error anywhere.
        #
        # seestar-mcp's `detail="summary"` (default since a66f2d3) omits the
        # key exactly as we asked it to, so this is now reachable rather than
        # theoretical: routes.py passes detail="full" at every call site, and
        # this is the assertion that the request actually took effect.
        if "sessions" not in project:
            raise ValueError(
                f"list_projects returned no `sessions` key for {target_id!r} — "
                "this is the detail='summary' payload. The union de-duplicates "
                "archive nights against store sessions, so proceeding would "
                "inflate archive_minutes silently. Pass detail='full'."
            )
        store_nights_by_target[target_id] = _store_nights(project["sessions"])
        sessions_by_target[target_id] = project["sessions"]
        combined[target_id] = {
            "target_id": target_id,
            "target_name": project.get("target_name") or target_id,
            "store_minutes": project.get("collected_minutes", 0.0),
            "archive_minutes": 0.0,
            "sources": ["store"],
            "nights": [],
        }

    for target_id, archive_target in archive_targets.items():
        known_nights = store_nights_by_target.get(target_id, set())
        known_nights = known_nights | _late_logged_nights(
            sessions_by_target.get(target_id, []), archive_target.nights, known_nights
        )
        included_nights = [n for n in archive_target.nights if n.night not in known_nights]
        archive_minutes = round(sum(n.minutes for n in included_nights), 4)
        nights_payload = [
            {"night": n.night, "frames": n.subs, "minutes": n.minutes} for n in included_nights
        ]
        if target_id in combined:
            combined[target_id]["archive_minutes"] = archive_minutes
            combined[target_id]["sources"].append("archive")
            combined[target_id]["nights"] = nights_payload
        else:
            combined[target_id] = {
                "target_id": target_id,
                "target_name": archive_target.display_name,
                "store_minutes": 0.0,
                "archive_minutes": archive_minutes,
                "sources": ["archive"],
                "nights": nights_payload,
            }

    projects = list(combined.values())
    for entry in projects:
        entry["total_minutes"] = round(entry["store_minutes"] + entry["archive_minutes"], 4)
    projects.sort(key=lambda p: p["total_minutes"], reverse=True)
    return projects


def attach_integration_goals(
    projects: list[dict],
    catalog: dict[str, dict],
    aliases: dict[str, str | None],
    bortle: int | None = None,
) -> list[dict]:
    """Add a `goal` field (see `integration_goal.suggest_integration_goal`)
    to each of `combine_projects()`'s entries, in place, and return the same
    list. `target_id` is resolved through the catalogue's alias index first
    (`catalog.resolve` — an id like "NGC2244" or "C33" is not itself a
    catalogue id, see `data/README.md`), so this must run after
    `combine_projects()` has already settled on one target_id per entry, not
    before.

    A target neither the catalogue nor the alias index can place (the
    archive's own "Unknown" bucket; a Caldwell id with no single canonical
    object, e.g. the Double Cluster) gets `goal: None`, not a missing key —
    the caller can treat that absence uniformly. Every *resolved* target
    gets a dict instead, even one with no bar to show (`goal["track"] ==
    "none"`) — see integration_goal.py's "The `reason` field": the UI needs
    to tell "no photometry at all" apart from "photometry present but not
    trusted" (IC405), and a bare `None` can't carry that distinction.
    """
    for project in projects:
        entry = resolve_catalog_entry(project["target_id"], catalog, aliases)
        project["goal"] = suggest_integration_goal(entry, bortle)
    return projects
