"""Live preview discovery for the Live session screen's preview card.

Source strategy (see docs/superpowers/specs/2026-07-30-slice-3-live-session.md
§0/D2, "D2 resolved"): prefer a live stacked JPEG the scope's own stacking
process may write mid-session, else fall back to the newest per-sub thumbnail
landing roughly every 10s as each sub is captured. Whether the scope actually
writes an intermediate stacked JPEG mid-session is unknown — an archive export
taken afterwards can't tell you either way — so this resolves the question the
first time a real session runs, without blocking on it now.

Both live under SEESTAR_LIVE_SHARE_DIR — the scope's own SMB share — which is
a DISTINCT variable from SEESTAR_ARCHIVE_DIR (the OneDrive export; confirmed
empirically stale — newest file 24 days old, see archive.py/docs/
configuration.md). Reusing SEESTAR_ARCHIVE_DIR here would be wrong twice over:
it points at the wrong thing today, and even a correctly-configured live
mirror would still need this module's own thumbnail-only preference (below),
which the archive scan deliberately does not apply.

## Why this does NOT reuse archive.scan_stacked_images()

archive.py's scan_stacked_images() prefers a stacked target's FULL-resolution
JPEG over its `_thn` thumbnail sibling — correct for that module's job (the
one, best-quality image a browser explicitly requests once for a project
card). This module needs the OPPOSITE preference: measured sizes (see the
spec) put a stacked thumbnail at 14.7 KB and the full-resolution sibling at
476 KB, and the task's own constraint is explicit — "Never fetch a FITS or a
full stacked JPEG on the polling path. Thumbnails only." A route polled on an
interval must never be the one that silently starts shipping 476 KB frames
just because a session ran long enough to produce a full-res stack. So the
functions below match only `_thn` files for both the stacked and the sub-frame
case, and never even look at the full-resolution sibling.

This also does not reuse archive.py's filename-timestamp parsing
(`_local_capture_instant_utc`, which assumes the sidecar shares a timezone
with whatever wrote the file — necessary there because it reconciles against
the projects store's separately-timestamped UTC session log). A live share has
no second source to reconcile against: "most recently written" is exactly
what the filesystem's own mtime already answers, with no timezone conversion
to get wrong. Every timestamp in this module is `stat().st_mtime` (a UTC POSIX
timestamp) converted straight to an aware UTC datetime.

## Path safety

Neither /api/live_preview nor /api/live_preview/image accepts a path from the
client — contrast imagery.py's /api/target_image/<id>, which validates a
client-supplied id before it reaches a lookup. Here there is no id at all: the
only path either route can ever serve is whatever this module's own directory
scan of SEESTAR_LIVE_SHARE_DIR found. That scan can only widen (a new target
directory appears on the real share) never narrow to something a client
requested, so there is no equivalent of `is_plausible_target_id()` needed.

## Never touches the network/share while idle

discover_frame() and everything below it assume the caller has ALREADY
confirmed the scope is observing (via get_view_state — see routes.py's
live_preview handler). This module has no opinion on that itself; it is
purely "given a share root, what's the newest thumbnail on it" — the
idle/bridge-down decision, and the "don't even call this" consequence of it,
belongs to the route, the same separation of concerns imagery.py holds itself
to between resolve_image_pointer() (never touches the network) and
fetch_survey_cutout() (the one function that does).
"""
import asyncio
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from seestar_sidecar import env as _env  # noqa: F401 — loads .env before the os.environ.get() below; see env.py
from seestar_sidecar.archive import _SUB_DIR_SUFFIX, normalize_target_id

logger = logging.getLogger(__name__)

#: The scope's own SMB share (e.g. `\\Seestar\...` / `\\seestar.local\...` on
#: the LAN — see docs/seestar-mcp-design.md), a DISTINCT variable from
#: SEESTAR_ARCHIVE_DIR — see the module docstring. `None` when unset: there is
#: no personal-path default here either (same discipline as
#: archive.DEFAULT_ARCHIVE_DIR), and unlike the archive export, there is no
#: existing convention to guess at for where a Seestar's own share gets
#: mounted/reached from on someone else's LAN. See docs/configuration.md,
#: including the AllowInsecureGuestAuth prerequisite most guest SMB shares
#: need on a modern Windows client.
_env_live_share_dir = os.environ.get("SEESTAR_LIVE_SHARE_DIR")
DEFAULT_LIVE_SHARE_DIR: Path | None = Path(_env_live_share_dir) if _env_live_share_dir else None

#: `reason` tokens for GET /api/live_preview when `source` is null — short,
#: stable, machine-readable wire values, same discipline as integration_goal.
#: py's REASON_* constants: the wording a user reads is the UI's job, never
#: this module's. Four distinct states, not two, because collapsing any pair
#: of these would misinform the UI about what's actually wrong (see each
#: docstring below).
#:
#: The scope could not be confirmed observing because get_view_state itself
#: returned `{"ok": false, ...}` — this IS the expected shape of "not
#: observing" (see docs/superpowers/specs/2026-07-30-slice-3-live-session.md
#: §4: "a timeout means 'not observing', not 'broken'"). Nothing on the share
#: is touched in this state.
REASON_IDLE = "idle"
#: The scope could not be confirmed observing because the MCP call itself
#: failed transport-level (ProxyTransportError/FileNotFoundError) — the
#: bridge/subprocess is down, a materially different problem from "the scope
#: answered and said it's idle". Kept distinct per CLAUDE.md's "bridge-down
#: and scope-idle are first-class UI states" — collapsing them would make an
#: actual outage read exactly like a quiet night.
REASON_BRIDGE_DOWN = "bridge_down"
#: SEESTAR_LIVE_SHARE_DIR was never set. Distinct from "unreachable" (below)
#: the same way SEESTAR_ARCHIVE_DIR's ArchiveStatus distinguishes "never
#: configured" from "configured but not there" — one is nothing to set up,
#: the other is something to fix.
REASON_NOT_CONFIGURED = "not_configured"
#: The share is configured, the scope is (as far as we can tell) observing,
#: but the directory scan raised or ran past SHARE_SCAN_TIMEOUT_SECONDS — the
#: hazard this whole feature was built around (see the spec's D2). If a
#: previously-discovered frame exists this degrades to that frame with
#: `stale: true` instead (see routes.py); this reason only fires when there
#: is nothing cached to fall back to yet.
REASON_SHARE_UNREACHABLE = "share_unreachable"
#: The share was reached fine and nothing raised, but no stacked-thumbnail or
#: sub-thumbnail file exists yet anywhere on it — e.g. a session that just
#: started and hasn't written its first sub. Deliberately NOT the same value
#: as REASON_SHARE_UNREACHABLE: that would tell the user to go check their
#: network for a state that is actually "give it a few seconds".
REASON_NO_FRAME = "no_frame"

#: A bounded ceiling on one discovery attempt, not a polling interval — the
#: client controls how often /api/live_preview is called at all (see the
#: route). This exists purely so a share that has gone quiet mid-request
#: (the scope rebooting, Wi-Fi dropping) fails FAST rather than hanging the
#: request indefinitely, which would be its own way of piling up load on a
#: starved link. Conservative for a LAN SMB directory listing; tests override
#: it to something much smaller rather than waiting out the real value.
SHARE_SCAN_TIMEOUT_SECONDS = 3.0

#: Per-sub thumbnail written roughly every ~10s as each sub lands (measured
#: 15.3 KB — see the spec). Deliberately requires the `_thn` suffix: the
#: sibling `.fit` (4,056 KB measured) must never even be considered a
#: candidate here, let alone served.
_SUB_THUMBNAIL = re.compile(
    r"^Light_.+_(?P<exposure>\d+(?:\.\d+)?)s_.+_(?P<date>\d{8})-(?P<time>\d{6})_thn\.jpg$"
)
#: A stacked-master thumbnail written to the plain `<target>/` directory —
#: same naming family as archive.py's `_STACKED_JPEG`, but this module only
#: ever matches the `_thn` variant (measured 14.7 KB vs. 476 KB full-res) and
#: never the bare `Stacked_....jpg` sibling — see the module docstring's "Why
#: this does NOT reuse archive.scan_stacked_images()".
_STACKED_THUMBNAIL = re.compile(
    r"^Stacked_.+_(?P<exposure>\d+(?:\.\d+)?)s_.+_(?P<date>\d{8})-(?P<time>\d{6})_thn\.jpg$"
)


def extract_stack_count(view_state_payload: dict) -> int | None:
    """Best-effort `View.Stack.stacked_frame` out of a get_view_state tool
    payload (hardware-verified nesting — see CLAUDE.md's telemetry-shapes
    note: "get_view_state nests everything under result.View"). This is
    display context for whichever frame discover_frame() found — it does not
    depend on, or change, which frame is shown. Never raises: any unexpected
    shape (a firmware variant, a malformed payload) degrades to `None` rather
    than failing a screen over a display-only count.
    """
    try:
        return view_state_payload["view_state"]["result"]["View"]["Stack"]["stacked_frame"]
    except (KeyError, TypeError):
        return None


class ShareUnreachableError(RuntimeError):
    """The share is configured but a scan of it raised or ran past
    SHARE_SCAN_TIMEOUT_SECONDS. Distinct from returning `None` (see
    discover_frame()'s docstring): this means "could not tell", not "told me
    there is nothing".
    """


@dataclass
class LiveFrame:
    """One discovered live preview frame — what both /api/live_preview and
    /api/live_preview/image key off. `captured_at` is the file's own mtime at
    DISCOVERY time, already converted to an aware UTC instant and stored as
    data — not re-derived by calling `.stat()` again later. That matters for
    the cached/stale path (see routes.py's live_preview handler): when the
    share has just been found unreachable, building the metadata response
    from the last-known frame must not itself call `.stat()` on a path that
    lives on that same unreachable share — this is exactly the blocking,
    unbounded network call discover_frame_within_timeout() exists to avoid,
    and re-deriving `captured_at` from the path at response time would sneak
    it back in through the cache-fallback branch. Only /api/live_preview/image
    (which needs the actual bytes, and IS the one route this app lets do that
    I/O) reads `path` again.
    """

    path: Path
    source: str  # "stacked" | "sub"
    target: str  # normalized target id, from the directory name
    captured_at: datetime  # aware UTC, captured once at discovery time


def _newest_stacked_thumbnail(root: Path) -> LiveFrame | None:
    """The single most recently written `Stacked_..._thn.jpg`, across every
    plain `<target>/` directory under `root` (never a `<target>-sub/` one —
    those hold individual FITS/thumbnails, not stacks). `None` if no target
    directory has ever written one.
    """
    newest: LiveFrame | None = None
    newest_mtime = float("-inf")
    for entry in sorted(root.iterdir()):
        if not entry.is_dir() or _SUB_DIR_SUFFIX.search(entry.name):
            continue
        target_id = normalize_target_id(entry.name)
        for jpg in entry.glob("Stacked_*_thn.jpg"):
            if not _STACKED_THUMBNAIL.match(jpg.name):
                continue
            mtime = jpg.stat().st_mtime
            if mtime > newest_mtime:
                newest_mtime = mtime
                newest = LiveFrame(
                    path=jpg,
                    source="stacked",
                    target=target_id,
                    captured_at=datetime.fromtimestamp(mtime, tz=timezone.utc),
                )
    return newest


def _newest_sub_thumbnail(root: Path) -> LiveFrame | None:
    """The single most recently written `Light_..._thn.jpg`, across every
    `<target>-sub/` directory under `root`. `None` if none exist yet.
    """
    newest: LiveFrame | None = None
    newest_mtime = float("-inf")
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        suffix_match = _SUB_DIR_SUFFIX.search(entry.name)
        if not suffix_match:
            continue
        target_id = normalize_target_id(entry.name[: suffix_match.start()])
        for jpg in entry.glob("Light_*_thn.jpg"):
            if not _SUB_THUMBNAIL.match(jpg.name):
                continue
            mtime = jpg.stat().st_mtime
            if mtime > newest_mtime:
                newest_mtime = mtime
                newest = LiveFrame(
                    path=jpg,
                    source="sub",
                    target=target_id,
                    captured_at=datetime.fromtimestamp(mtime, tz=timezone.utc),
                )
    return newest


def discover_frame(root: Path) -> LiveFrame | None:
    """A live stacked thumbnail if the share has one for ANY target, else the
    newest per-sub thumbnail, else `None` — "reachable, nothing there yet"
    (REASON_NO_FRAME at the route), not a failure. Raises OSError (a real
    filesystem/SMB fault — e.g. a dropped share) rather than degrading it
    itself; the caller (see discover_frame_within_timeout() below, and
    routes.py) decides how that becomes ShareUnreachableError / a cached
    fallback.

    A missing `root` (not `root.is_dir()`) is treated the same as OSError —
    both mean "could not confirm what's on the share right now" from this
    function's point of view, which is exactly what ShareUnreachableError
    means at the route. Whether that specific case should instead read as
    "not configured" is the ROUTE's call (it already knows whether
    SEESTAR_LIVE_SHARE_DIR was set at all, and doesn't call this function
    when it wasn't) — this module has no opinion on configuration, only on
    what a given root directory currently holds.
    """
    if not root.is_dir():
        raise OSError(f"live preview share root not found: {root}")
    stacked = _newest_stacked_thumbnail(root)
    if stacked is not None:
        return stacked
    return _newest_sub_thumbnail(root)


async def discover_frame_within_timeout(
    root: Path, timeout_s: float = SHARE_SCAN_TIMEOUT_SECONDS
) -> LiveFrame | None:
    """Async wrapper for callers on the event loop (routes.py): discover_frame()
    is a blocking Path.iterdir()/glob()/stat() walk, and over a live SMB share
    that must neither block the whole server while it runs nor be allowed to
    hang past SHARE_SCAN_TIMEOUT_SECONDS if the share has gone quiet mid-scan
    (a dropped session, the scope rebooting). `asyncio.to_thread` keeps the
    blocking walk off the event loop; `asyncio.wait_for` is the hard ceiling.

    Deliberately a single attempt, not a retry loop: "never retry
    aggressively" (see the spec's D2) means a failed/slow scan degrades
    (ShareUnreachableError, handled by the route — see routes.py's
    live_preview handler) and waits for the client's OWN next poll, rather
    than this function itself hammering a share that just showed signs of
    being starved.

    Raises ShareUnreachableError uniformly for a real OSError (share
    unreachable, or removed mid-session per the spec's "the scope sleeps
    after park and drops its SMB share") and for a timeout — the route only
    needs "could not tell", not which of the two happened.
    """
    try:
        return await asyncio.wait_for(asyncio.to_thread(discover_frame, root), timeout=timeout_s)
    except asyncio.TimeoutError as exc:
        raise ShareUnreachableError(f"scan of {root} exceeded {timeout_s}s") from exc
    except OSError as exc:
        raise ShareUnreachableError(str(exc)) from exc
