"""Read-only scan of the Seestar photo archive on disk.

The archive at SEESTAR_ARCHIVE_DIR holds one directory pair per target:
`<name>/` (stacked results — not read here, no imagery yet) and
`<name>-sub/` (seen once as `<name>_sub/`) holding one `Light_*.fit` per
captured sub-frame. Exposure is fixed at 10.0s across the whole archive —
confirmed by the user, and every filename encodes it — so integration is
`count(Light_*.fit) x EXPOSURE_SECONDS`. No per-file exposure parsing; this
module only checks the filename's exposure token agrees with that constant
and reports when it does not (see `ArchiveScan.warnings`).

No cache, no database: this is a per-request scan (measured ~0.04s for the
archive's 7,500+ frames). A cache here would be a third source of truth
beside the projects store and the filesystem itself — see
docs/slice-2-backlog.md.
"""
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

#: Configurable so this repo's tests and other machines are not stuck with
#: one person's OneDrive path. Read once at import time, matching main.py's
#: SEESTAR_AI_DIR: both name "where does this sidecar's one external, personal
#: data source live" for the whole process.
DEFAULT_ARCHIVE_DIR = Path(
    os.environ.get("SEESTAR_ARCHIVE_DIR", "C:/Users/<user>/OneDrive/Documents/SeeStar")
)

#: Confirmed by the user: every sub-frame in the archive is a 10.0s exposure,
#: and every filename encodes it (`Light_<target>_<exposure>s_<filter>_<stamp>.fit`).
EXPOSURE_SECONDS = 10.0

_SUB_DIR_SUFFIX = re.compile(r"(-sub|_sub)$")
_LIGHT_FILENAME = re.compile(
    r"^Light_.+_(?P<exposure>\d+(?:\.\d+)?)s_.+_(?P<night>\d{8})-\d{6}\.fit$"
)
#: A spaced catalog designator: letters, whitespace, then a numeric id —
#: "M 31", "NGC 281", "IC 405", "LDN 1625". Directories that instead lead
#: with a compact id ("M27 Dumbbell Nebula", "SH2-142") don't match this and
#: fall through to the first-token rule below.
_SPACED_CATALOG_ID = re.compile(r"^(?P<letters>[A-Za-z]+)\s+(?P<digits>\d+)\b")


def normalize_target_id(raw_name: str) -> str:
    """Fold an archive directory name to the unspaced catalog id the MCP
    tools use, so the two sources can be joined on target_id.

    "M 31" -> "M31", "NGC 2244 Satellite Cluster" -> "NGC2244" (a spaced id
    followed by the object's common name). Some directories already carry a
    compact id immediately followed by the common name instead of a spaced
    designator ("M27 Dumbbell Nebula" -> "M27", "M57 Ring Nebula" -> "M57");
    the leading whitespace-separated token is already the id there.
    "SH2-142" has no space at all and passes through unchanged either way.
    "Unknown" (undetermined captures) is not a catalog id — surfaced as-is
    per the hand-back rule: report it, don't guess.
    """
    raw_name = raw_name.strip()
    match = _SPACED_CATALOG_ID.match(raw_name)
    if match:
        return f"{match['letters']}{match['digits']}"
    tokens = raw_name.split()
    return tokens[0] if tokens else raw_name


@dataclass
class ArchiveNight:
    """One calendar night's captures for one target, from the filenames."""

    night: str  # YYYYMMDD
    subs: int
    minutes: float


@dataclass
class ArchiveTarget:
    target_id: str  # normalised — joins against the projects store
    display_name: str  # the raw directory name, spaces and all
    minutes: float
    nights: list[ArchiveNight] = field(default_factory=list)


@dataclass
class ArchiveScan:
    targets: dict[str, ArchiveTarget]
    #: Filenames that disagreed with the fixed exposure assumption, or that
    #: didn't match the expected naming shape at all. Never raises: a scan
    #: keeps going and the caller decides how loudly to surface this.
    warnings: list[str]


def scan_archive(root: Path) -> ArchiveScan:
    """Scan every `<target>-sub` / `<target>_sub` directory under `root`.

    A missing root is a normal state — no archive configured yet, or a
    machine without one synced — not an error: returns an empty scan so the
    sidecar keeps serving the store's data alone.
    """
    if not root.is_dir():
        return ArchiveScan(targets={}, warnings=[])

    targets: dict[str, ArchiveTarget] = {}
    warnings: list[str] = []

    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        suffix_match = _SUB_DIR_SUFFIX.search(entry.name)
        if not suffix_match:
            continue  # the paired non-"-sub" directory holds stacked results
        raw_name = entry.name[: suffix_match.start()]
        target_id = normalize_target_id(raw_name)

        nights: dict[str, int] = {}
        for fit in entry.glob("Light_*.fit"):
            night, warning = _parse_light_filename(fit.name)
            if warning is not None:
                warnings.append(f"{entry.name}/{fit.name}: {warning}")
            if night is not None:
                nights[night] = nights.get(night, 0) + 1

        night_records = [
            ArchiveNight(
                night=night,
                subs=count,
                minutes=round(count * EXPOSURE_SECONDS / 60, 4),
            )
            for night, count in sorted(nights.items())
        ]
        targets[target_id] = ArchiveTarget(
            target_id=target_id,
            display_name=raw_name,
            minutes=round(sum(n.minutes for n in night_records), 4),
            nights=night_records,
        )

    if warnings:
        logger.warning(
            "archive scan: %d file(s) disagreed with the fixed %.1fs exposure "
            "assumption or naming shape: %s",
            len(warnings),
            EXPOSURE_SECONDS,
            "; ".join(warnings[:5]),
        )
    return ArchiveScan(targets=targets, warnings=warnings)


def _parse_light_filename(name: str) -> tuple[str | None, str | None]:
    """Return `(night, warning)`.

    `night` is `None` only when the filename doesn't match the expected
    shape at all, so its subs can't be counted toward any night. `warning`
    is set whenever something about the file disagrees with what this
    module assumes instead of parsing per-file — currently just the
    exposure — so a disagreement is reported rather than silently averaged
    away by the fixed-exposure shortcut.
    """
    match = _LIGHT_FILENAME.match(name)
    if not match:
        return None, "did not match Light_<target>_<exposure>s_<filter>_<night>-<time>.fit"
    exposure = float(match["exposure"])
    if abs(exposure - EXPOSURE_SECONDS) > 1e-9:
        return match["night"], f"exposure {exposure}s disagrees with the assumed {EXPOSURE_SECONDS}s"
    return match["night"], None
