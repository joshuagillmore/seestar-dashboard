"""Read-only loader for the DSO catalogue (`data/dso_catalog_extended.json`)
and its alias index (`data/dso_aliases.json`) — see `data/README.md` for what
generates them and `data/ATTRIBUTION-OpenNGC.md` for their CC BY-SA 4.0
provenance. Both are static data checked into the repo, not fetched over
MCP, so reading them is local file I/O — same class of read as `archive.py`'s
filesystem scan, not a tool call, and never routed through the allowlist.

`resolve()` is the one thing `integration_goal.py`'s caller needs: turn a
`projects_union.py` target_id (already normalised from the archive's spaced
directory names — see `archive.normalize_target_id()` — or straight from the
store) into a catalogue record, going through the alias index when the id
itself isn't a catalogue id. Two real examples from the user's own archive:
"NGC2244" isn't a catalogue id (OpenNGC carries that object as a duplicate of
NGC2239) and "C33" is a Caldwell number, not an NGC/IC designation at all —
both resolve through `dso_aliases.json`. A target neither source can place —
the archive's own "Unknown" bucket, or a Caldwell id with no single canonical
object (C14, the Double Cluster, is genuinely two separate NGC objects and
the alias index maps it to `None` rather than picking one arbitrarily) —
resolves to `None` here, which is the correct input for
`integration_goal.suggest_integration_goal()` to also return `None` (Track 3:
no target, not a guessed one).
"""
import json
from pathlib import Path

DEFAULT_CATALOG_PATH = Path(__file__).resolve().parents[2] / "data" / "dso_catalog_extended.json"
DEFAULT_ALIASES_PATH = Path(__file__).resolve().parents[2] / "data" / "dso_aliases.json"


def load_catalog(path: Path | None = None) -> dict[str, dict]:
    """`id -> record` for every catalogue object. A missing file (a checkout
    that hasn't run `data/build_catalogue.py`, or a test pointed at a temp
    path) degrades to an empty catalogue rather than a crash — every target
    then resolves to `None` and falls to Track 3, the same safe default as a
    target genuinely missing photometry.
    """
    path = path or DEFAULT_CATALOG_PATH
    if not path.is_file():
        return {}
    records = json.loads(path.read_text(encoding="utf-8"))
    return {record["id"]: record for record in records}


def load_aliases(path: Path | None = None) -> dict[str, str | None]:
    """`alias -> canonical catalogue id`, or `alias -> None` for an alias
    with no single canonical object (see module docstring). Missing file
    degrades to an empty index, same reasoning as `load_catalog()`.
    """
    path = path or DEFAULT_ALIASES_PATH
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def resolve(
    target_id: str, catalog: dict[str, dict], aliases: dict[str, str | None]
) -> dict | None:
    """`target_id` itself first, then its alias's canonical id, else `None`.
    Never raises on an unknown id — most target_ids from the archive/store
    union will not be in the catalogue at all, and that is a normal, expected
    Track 3 input, not an error.
    """
    if target_id in catalog:
        return catalog[target_id]
    canonical_id = aliases.get(target_id)
    if canonical_id and canonical_id in catalog:
        return catalog[canonical_id]
    return None
