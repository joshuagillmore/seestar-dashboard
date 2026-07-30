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

Each frame's filename also encodes a LOCAL wall-clock timestamp (verified
against the file's own mtime — no offset applied), while the projects
store's `date_utc` is a UTC instant. `observing_night()` is the one place
that reconciles the two, so both sides of the union key on the same thing —
see its docstring and projects_union.py, which is its other caller.
"""
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
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
    r"^Light_.+_(?P<exposure>\d+(?:\.\d+)?)s_.+_(?P<date>\d{8})-(?P<time>\d{6})\.fit$"
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


def observing_night(instant_utc: datetime) -> date:
    """The astronomical observing night a UTC instant belongs to.

    A night runs from local evening to the following local morning, so
    labelling it by the wall-clock date of the instant itself is wrong for
    roughly half of it: a capture at 01:07 local is still "last night's"
    session, not the start of a new one. Shifting back 12 hours before
    taking the date moves the label boundary into the middle of the day,
    where nothing gets captured, instead of the middle of the night, where
    everything does — so any instant from evening through dawn resolves to
    the same date the evening started on.

    This is the ONE place both call sites key on: archive.py's per-frame
    local timestamps (converted to UTC first — see `_parse_light_filename`)
    and projects_union.py's store `date_utc` session timestamps. They used
    to derive keys independently (a UTC calendar date here, a naive local
    date there), which silently failed to detect a real collision — a store
    session logged at 03:50 UTC (past local midnight) and archive frames
    from the evening before both belong to one night but compared as two
    different calendar dates. Keying through this function is what makes
    the comparison meaningful again.

    A second, independent constraint (distinct from `_local_capture_instant_
    utc`'s same-machine assumption): the 12-hour boundary is anchored to
    UTC noon, not the observing site's local noon, so it only lands outside
    real observing hours for sites whose UTC offset keeps it there. At this
    site (Eastern, UTC-4/-5) the boundary falls at 07:00-08:00 local, well
    clear of any realistic capture. It would NOT hold for a site far enough
    east that local observing hours straddle UTC noon — e.g. UTC+9, where
    the boundary lands at 21:00 local, squarely inside a normal session, and
    a night would split in two. Fixing that needs the observing site's own
    UTC offset (from the site profile), which is server-side data this
    sidecar does not have — a hand-back, not something to patch here.
    """
    return (instant_utc - timedelta(hours=12)).date()


def _local_capture_instant_utc(
    date_str: str, time_str: str, local_tz: timezone | None = None
) -> datetime:
    """Parse a filename's `YYYYMMDD` + `HHMMSS` as a naive LOCAL timestamp
    and return the equivalent aware UTC instant.

    `local_tz=None` (the production default, used by every real call site)
    assumes the sidecar runs on the same machine — and therefore in the same
    timezone — that wrote the archive. Verified true today: a sample frame's
    filename timestamp matches its file's own mtime exactly, with no offset.
    This breaks if the archive is ever copied to, or read by, a machine in a
    different timezone: the naive datetime would then be localised to the
    WRONG zone, silently mis-keying every night by however many hours
    separate them.

    Tests pass an explicit `local_tz` instead of relying on `None` here, so
    the suite's result does not depend on the timezone of whatever machine
    happens to run it — that dependency is real for the production path (see
    above), not something a test should also inherit.
    """
    naive_local = datetime.strptime(f"{date_str}{time_str}", "%Y%m%d%H%M%S")
    if local_tz is not None:
        return naive_local.replace(tzinfo=local_tz).astimezone(timezone.utc)
    return naive_local.astimezone(timezone.utc)


@dataclass
class ArchiveNight:
    """One observing night's captures for one target (see observing_night()),
    not a raw filename calendar date.
    """

    night: str  # ISO date (YYYY-MM-DD), from observing_night()
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


def scan_archive(root: Path, local_tz: timezone | None = None) -> ArchiveScan:
    """Scan every `<target>-sub` / `<target>_sub` directory under `root`.

    A missing root is a normal state — no archive configured yet, or a
    machine without one synced — not an error: returns an empty scan so the
    sidecar keeps serving the store's data alone.

    `local_tz` is exposed only for tests — see `_local_capture_instant_utc`.
    Every real caller leaves it `None` and gets the system's local timezone.
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
            night, warning = _parse_light_filename(fit.name, local_tz)
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


def _parse_light_filename(
    name: str, local_tz: timezone | None = None
) -> tuple[str | None, str | None]:
    """Return `(night, warning)`, where `night` is the *observing* night
    (see `observing_night()`) — not the raw calendar date in the filename.

    `night` is `None` only when the filename doesn't match the expected
    shape at all, so its subs can't be counted toward any night. `warning`
    is set whenever something about the file disagrees with what this
    module assumes instead of parsing per-file — currently just the
    exposure — so a disagreement is reported rather than silently averaged
    away by the fixed-exposure shortcut.
    """
    match = _LIGHT_FILENAME.match(name)
    if not match:
        return None, "did not match Light_<target>_<exposure>s_<filter>_<date>-<time>.fit"
    instant = _local_capture_instant_utc(match["date"], match["time"], local_tz)
    night = observing_night(instant).isoformat()
    exposure = float(match["exposure"])
    if abs(exposure - EXPOSURE_SECONDS) > 1e-9:
        return night, f"exposure {exposure}s disagrees with the assumed {EXPOSURE_SECONDS}s"
    return night, None
