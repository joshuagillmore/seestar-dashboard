"""Union of the projects store (`list_projects`) with the archive scan.

Neither source is complete alone — see docs/slice-2-backlog.md, "time on
target is currently unknowable". This module is pure and side-effect free
(no filesystem, no MCP) so it is unit-testable on its own; routes.py wires
it to the live store payload and `archive.scan_archive()`.
"""
from datetime import datetime

from seestar_sidecar.archive import ArchiveTarget, observing_night
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
    for session in sessions:
        date_utc = session.get("date_utc") or ""
        try:
            instant = datetime.fromisoformat(date_utc.replace("Z", "+00:00"))
        except ValueError:
            continue
        nights.add(observing_night(instant).isoformat())
    return nights


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

    for project in store_projects:
        target_id = project["target_id"]
        store_nights_by_target[target_id] = _store_nights(project.get("sessions", []))
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
