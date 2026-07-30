"""Union of the projects store (`list_projects`) with the archive scan.

Neither source is complete alone — see docs/slice-2-backlog.md, "time on
target is currently unknowable". This module is pure and side-effect free
(no filesystem, no MCP) so it is unit-testable on its own; routes.py wires
it to the live store payload and `archive.scan_archive()`.
"""
from datetime import datetime

from seestar_sidecar.archive import ArchiveTarget, observing_night


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
        }

    for target_id, archive_target in archive_targets.items():
        known_nights = store_nights_by_target.get(target_id, set())
        archive_minutes = round(
            sum(n.minutes for n in archive_target.nights if n.night not in known_nights),
            4,
        )
        if target_id in combined:
            combined[target_id]["archive_minutes"] = archive_minutes
            combined[target_id]["sources"].append("archive")
        else:
            combined[target_id] = {
                "target_id": target_id,
                "target_name": archive_target.display_name,
                "store_minutes": 0.0,
                "archive_minutes": archive_minutes,
                "sources": ["archive"],
            }

    projects = list(combined.values())
    for entry in projects:
        entry["total_minutes"] = round(entry["store_minutes"] + entry["archive_minutes"], 4)
    projects.sort(key=lambda p: p["total_minutes"], reverse=True)
    return projects
