"""Read-only scan of the Seestar photo archive on disk.

The archive at SEESTAR_ARCHIVE_DIR holds one directory pair per target:
`<name>/` (stacked results — the master JPEG/FITS pairs `scan_stacked_images()`
reads for imagery) and `<name>-sub/` (seen once as `<name>_sub/`) holding one
`Light_*.fit` per captured sub-frame, read by `scan_archive()`. Exposure is
fixed at 10.0s across the whole archive — confirmed by the user, and every
filename encodes it — so integration is `count(Light_*.fit) x
EXPOSURE_SECONDS`. No per-file exposure parsing; this module only checks the
filename's exposure token agrees with that constant and reports when it does
not (see `ArchiveScan.warnings`).

No cache, no database: this is a per-request scan (measured ~0.04s for the
archive's 7,500+ frames). A cache here would be a third source of truth
beside the projects store and the filesystem itself — see
docs/slice-2-backlog.md. `scan_stacked_images()` follows the same no-cache
rule — it's a local disk read, not the network fetch imagery.py caches.

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

from seestar_sidecar import env as _env  # noqa: F401 — loads .env before the os.environ.get() below; see env.py

logger = logging.getLogger(__name__)

#: Configurable so this repo's tests and other machines are not stuck with
#: one person's OneDrive path. `None` when SEESTAR_ARCHIVE_DIR is unset —
#: there is no cross-platform convention for "where does a Seestar archive
#: live" to guess at (unlike web/dist, which always lives at one fixed
#: place relative to this checkout — see frontend.py), so an unset var means
#: "not configured yet", never a guessed personal path. Read once at import
#: time, matching main.py's SEESTAR_AI_DIR: both name "where does this
#: sidecar's one external, personal data source live" for the whole process.
#: See docs/configuration.md.
_env_archive_dir = os.environ.get("SEESTAR_ARCHIVE_DIR")
DEFAULT_ARCHIVE_DIR: Path | None = Path(_env_archive_dir) if _env_archive_dir else None

#: Confirmed by the user: every sub-frame in the archive is a 10.0s exposure,
#: The Seestar writes a small JPEG beside every captured sub, named
#: `<stem>_thn.jpg`. Verified across the whole archive: 7,533 subs, 7,533
#: thumbnails, none missing. It is what lets the Review & QA table show a sub
#: without decoding FITS or handing a path to the OS to open.
SUB_THUMBNAIL_SUFFIX = "_thn.jpg"

#: and every filename encodes it (`Light_<target>_<exposure>s_<filter>_<stamp>.fit`).
EXPOSURE_SECONDS = 10.0

_SUB_DIR_SUFFIX = re.compile(r"(-sub|_sub)$")
_LIGHT_FILENAME = re.compile(
    r"^Light_.+_(?P<exposure>\d+(?:\.\d+)?)s_.+_(?P<date>\d{8})-(?P<time>\d{6})\.fit$"
)
#: A stacked master JPEG, same shape as `_LIGHT_FILENAME` but "Stacked_" and
#: an optional `_thn` thumbnail marker before the extension — see
#: `scan_stacked_images()`. Deliberately `.jpg` only: no FITS decoding here.
_STACKED_JPEG = re.compile(
    r"^Stacked_.+_(?P<exposure>\d+(?:\.\d+)?)s_.+_(?P<date>\d{8})-(?P<time>\d{6})"
    r"(?P<thumb>_thn)?\.jpg$"
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
    if not tokens:
        return raw_name
    # Only drop the trailing words when the FIRST one is itself a designation
    # — "M27 Dumbbell Nebula" -> "M27". A leading word carrying no digits is
    # not an id, and taking it anyway threw away the only distinguishing part:
    # "Veil Nebula East" and "Veil Nebula West" both folded to "Veil".
    #
    # That mattered beyond a cosmetic label. Both the live preview's share
    # scan and the archive join key run through here, and the scan compares a
    # normalised directory name against a normalised target — so two mosaic
    # panels of one nebula shared an id and the screen could show the East
    # panel's frame while imaging West. Verified against the real archive:
    # every existing folder keeps the id it had, because all 24 lead with a
    # designation and are handled above or by the digit check here.
    if any(ch.isdigit() for ch in tokens[0]):
        return tokens[0]
    return "".join(tokens)


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
    #: Every `Light_*.fit` this scan found in the target's `-sub`/`_sub`
    #: directory, unfiltered — including a file whose name didn't parse
    #: cleanly (see `_parse_light_filename`'s `warning` case). qa_analysis.py
    #: is the only consumer: it resolves a target to the FITS paths qa_tier2
    #: needs from THIS scan (see docs/superpowers/specs/
    #: 2026-07-31-slice-4-review-qa.md §1's "reuse archive.py's existing
    #: scan, not a second walk of the same tree") rather than re-globbing the
    #: tree itself. Deliberately NOT surfaced through projects_combined or
    #: any other JSON response: combine_projects() (projects_union.py) only
    #: ever reads `.nights`/`.display_name` off an ArchiveTarget by name, and
    #: nothing in this app calls `asdict()` on one whole — see routes.py's
    #: `asdict(scan.status)`, which serialises ArchiveStatus, never
    #: ArchiveTarget. Adding this field must not change that: a local
    #: filesystem path has no business leaving this process over HTTP.
    sub_paths: list[Path] = field(default_factory=list)


@dataclass
class ArchiveStatus:
    """Distinguishes *why* a scan found nothing — the state a screen needs
    to render "set SEESTAR_ARCHIVE_DIR" instead of a misleading "0 minutes
    logged" when nobody has pointed the sidecar at an archive yet.

    Four fields carry three real states, not two:

    - `configured=False` — nobody set SEESTAR_ARCHIVE_DIR at all
      (DEFAULT_ARCHIVE_DIR is `None`). `path`/`exists`/`target_count` are
      `None`/`False`/`0`, respectively, since there is nothing to report on.
    - `configured=True, exists=False` — it's set, but that path isn't there
      (a typo, an unmounted drive). Worth surfacing differently from
      "empty", since the user DID try to configure something and it's wrong.
    - `configured=True, exists=True` — the normal case. `target_count`
      distinguishes "genuinely empty" (0 — a real, reachable directory with
      no target subdirectories in it yet) from a working archive, without
      the caller having to cross-reference `ArchiveScan.targets`' length
      itself — the caller of `/api/projects_combined` only ever sees this
      status and the store+archive *union*, which can be non-empty from the
      store alone even when the archive side is empty.
    """

    configured: bool
    path: str | None  # None only when configured is False
    exists: bool  # always False when configured is False
    target_count: int  # always 0 unless configured and exists are both True


@dataclass
class ArchiveScan:
    targets: dict[str, ArchiveTarget]
    #: Filenames that disagreed with the fixed exposure assumption, or that
    #: didn't match the expected naming shape at all. Never raises: a scan
    #: keeps going and the caller decides how loudly to surface this.
    warnings: list[str]
    status: ArchiveStatus


@dataclass
class StackedImage:
    """One target's chosen stacked-master JPEG — see `scan_stacked_images()`.

    `captured_at` is the stack's own filename timestamp, used only to compare
    several stacks for the same target and keep the most recent — it is not
    a freshness signal for whatever serves this over HTTP.
    """

    path: Path
    is_thumbnail: bool  # True when only the `_thn` sibling exists, no full-res .jpg
    captured_at: datetime
    #: The `_thn.jpg` sibling when one exists, whether or not a full-res JPEG
    #: does. Carried rather than discarded so a caller that wants a small
    #: image can have the small file: the full masters are 400-840 KB each and
    #: the Projects grid draws 32 of them at ~90 px, which was 6.1 MB of
    #: decode to paint postage stamps. The scope writes these itself, so this
    #: needs no resizing and no cache. `None` when only a full-res JPEG
    #: exists, in which case `path` is the only option.
    thumbnail_path: "Path | None" = None


def scan_archive(root: Path | None, local_tz: timezone | None = None) -> ArchiveScan:
    """Scan every `<target>-sub` / `<target>_sub` directory under `root`.

    `root=None` — SEESTAR_ARCHIVE_DIR was never set (see DEFAULT_ARCHIVE_DIR)
    — and a `root` that doesn't exist on disk are both normal, non-error
    states: this keeps going and returns an empty scan so the sidecar keeps
    serving the store's data alone either way. They are NOT the same state
    though — see `ArchiveStatus` — so this reports which one occurred rather
    than collapsing both into one silent "nothing found".

    `local_tz` is exposed only for tests — see `_local_capture_instant_utc`.
    Every real caller leaves it `None` and gets the system's local timezone.
    """
    if root is None:
        return ArchiveScan(
            targets={},
            warnings=[],
            status=ArchiveStatus(configured=False, path=None, exists=False, target_count=0),
        )
    if not root.is_dir():
        return ArchiveScan(
            targets={},
            warnings=[],
            status=ArchiveStatus(configured=True, path=str(root), exists=False, target_count=0),
        )

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
        sub_paths: list[Path] = []
        for fit in sorted(entry.glob("Light_*.fit")):
            sub_paths.append(fit)
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
            sub_paths=sub_paths,
        )

    if warnings:
        logger.warning(
            "archive scan: %d file(s) disagreed with the fixed %.1fs exposure "
            "assumption or naming shape: %s",
            len(warnings),
            EXPOSURE_SECONDS,
            "; ".join(warnings[:5]),
        )
    return ArchiveScan(
        targets=targets,
        warnings=warnings,
        status=ArchiveStatus(
            configured=True, path=str(root), exists=True, target_count=len(targets)
        ),
    )


def scan_stacked_images(
    root: Path | None, local_tz: timezone | None = None
) -> dict[str, StackedImage]:
    """The most recent stacked-master JPEG per target, full resolution
    preferred over its `_thn` thumbnail sibling — the imagery counterpart to
    `scan_archive()`, reading the *other* half of each target's directory
    pair (the plain `<name>/` directory, not `<name>-sub/`).

    One capture session writes a `.fit`, and usually (not always — an early
    IC 405 stack has only the thumbnail) a full-resolution `.jpg` alongside
    its `_thn.jpg`, all three sharing one filename timestamp. Grouping by
    that timestamp is what lets "prefer full-res" apply per stack rather than
    comparing one stack's thumbnail against a different stack's full JPEG.
    "Most recent" is by that same timestamp — an arbitrary but explainable
    rule; there is no way to know which stack is "best".

    `root=None` (unconfigured) or a missing directory both degrade to an
    empty dict, same as `scan_archive()` — no archive configured, or one
    configured but not found, is a normal state, not an error; this function
    has no imagery to attach either way, so unlike `scan_archive()` it has no
    need to distinguish the two beyond that (see `ArchiveStatus` for the
    caller that does). `local_tz` is test-only, exactly as in
    `scan_archive()`; production leaves it `None` and reads the system's own
    timezone (see `_local_capture_instant_utc`).
    """
    if root is None or not root.is_dir():
        return {}

    latest: dict[str, StackedImage] = {}
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        if _SUB_DIR_SUFFIX.search(entry.name):
            continue  # the "-sub"/"_sub" sibling holds individual frames, not stacks
        target_id = normalize_target_id(entry.name)

        by_stamp: dict[tuple[str, str], dict[str, Path]] = {}
        for jpg in entry.glob("Stacked_*.jpg"):
            match = _STACKED_JPEG.match(jpg.name)
            if not match:
                continue
            key = (match["date"], match["time"])
            kind = "thumbnail" if match["thumb"] else "full"
            by_stamp.setdefault(key, {})[kind] = jpg

        for (date_str, time_str), files in by_stamp.items():
            path = files.get("full") or files.get("thumbnail")
            if path is None:
                continue  # unreachable in practice — by_stamp is only ever seeded with one of the two
            candidate = StackedImage(
                path=path,
                is_thumbnail="full" not in files,
                captured_at=_local_capture_instant_utc(date_str, time_str, local_tz),
                thumbnail_path=files.get("thumbnail"),
            )
            current = latest.get(target_id)
            if current is None or candidate.captured_at > current.captured_at:
                latest[target_id] = candidate
    return latest


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
