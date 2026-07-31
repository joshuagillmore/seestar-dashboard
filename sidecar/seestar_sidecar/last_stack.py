"""Last completed stack discovery for the Live screen's second panel — a
sibling of live_preview.py, same share, same target-scoping discipline, same
timeout/no-retry rule, but answering a different question: not "what's the
newest thing anywhere" but "what did the LAST completed session leave for the
ACTIVE target".

## This is never live, and that is load-bearing

Established against real hardware, twice, on the same session (at 37 and 141
stacked frames — see live_preview.py's discover_frame() docstring, which
records the same finding independently): **the scope writes the stacked
master once, at session end.** There is no intermediate stacked image on the
share during a session. So this panel always shows a PREVIOUS session's
result for the active target, and must never be presented as live — it is
useful precisely as a "here's what this target looked like last time"
comparison next to the live sub, not as a second live feed.

## Which file gets served — the mirror image of live_preview.py's choice

Measured on the share for a completed NGC 7380 session:

    Stacked_178_NGC7380_10.0s_LP_20260712-040704.fit       12,158 KB  never
    Stacked_178_NGC7380_10.0s_LP_20260712-040704.jpg          730 KB  this one
    Stacked_178_NGC7380_10.0s_LP_20260712-040704_thn.jpg       25 KB  not this

live_preview.py deliberately serves ONLY the `_thn` thumbnail, because it is
polled on an interval and 476 KB (its own measured full-res size) on a
polling path would be exactly the offload that feature was built to avoid.
This route is the opposite case: a one-off fetch triggered by a target
change, not a poll, so 730 KB once is fine and a 25 KB thumbnail would look
poor in a panel sized for a real image. So `_STACKED_FULL` below requires the
`.jpg` extension immediately after the timestamp, with no `_thn` in between —
matching archive.py's scan_stacked_images() full-resolution preference,
not live_preview.py's thumbnail-only one. The `.fit` sibling is never even a
candidate: glob only ever looks at `Stacked_*.jpg`.

## Frame count

The leading number after "Stacked_" is the frame count the stack was built
from ("178" above == 178 frames) — parsed straight from the filename, never
computed: this module only ever scans a directory and reads a name, the same
read-only discipline as the rest of this file.

## Scoping — never optional here

"A stack for a different object is not what the user asked for." Unlike
live_preview.discover_frame(), which still supports an unscoped scan (kept
for its own pre-existing reasons — see that function's docstring), there is
no legitimate case here where this route should consider any target other
than the one the scope is currently on, so `target` is a required argument,
not an optional one.

## Path safety / performance

Same rules as live_preview.py: no path from the client ever reaches a lookup
— the only path either route can serve is whatever this module's own scan of
SEESTAR_LIVE_SHARE_DIR found. `_newest_by_filename()` (imported from
live_preview.py, not reimplemented) picks the newest file by the filename's
own date/time tokens rather than stat-ing every candidate — see that
function's docstring for the 4.73s-over-235-files measurement stat-per-file
cost this avoids. The stacked directory this scans holds a handful of files
per target (one per completed session), so the saving matters less here than
it did for live_preview's per-sub thumbnails, but reusing the same helper
keeps the "don't stat every candidate" rule in one place rather than two, so
nobody has to rediscover it independently the next time a share gets large.
"""
import asyncio
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from seestar_sidecar.archive import _SUB_DIR_SUFFIX, normalize_target_id
from seestar_sidecar.live_preview import (
    SHARE_SCAN_TIMEOUT_SECONDS,
    ShareUnreachableError,
    _newest_by_filename,
)

#: `reason` token for GET /api/last_stack when the active target's directory
#: either doesn't exist on the share yet, or exists but holds no
#: `Stacked_*.jpg` — a target that has never finished a session, or whose
#: only session is still running (see the module docstring: no intermediate
#: stacked image exists mid-session either way).
#:
#: The other three reasons this route can report — not configured, bridge
#: down, scope idle — are exactly the conditions live_preview.py already
#: defined tokens for (REASON_NOT_CONFIGURED, REASON_BRIDGE_DOWN,
#: REASON_IDLE), and routes.py reuses those directly rather than duplicating
#: them here: they mean the same thing regardless of which panel is asking
#: (SEESTAR_LIVE_SHARE_DIR never set; the MCP call itself failing; the scope
#: answering "idle"). REASON_SHARE_UNREACHABLE is reused the same way, for
#: the same failure — a directory scan of this same share raising or running
#: past SHARE_SCAN_TIMEOUT_SECONDS. This one token is new because none of
#: those describe "reached the share fine, scoped correctly, and there is
#: genuinely nothing there yet" for a completed stack specifically.
REASON_NO_STACK = "no_stack"

#: A stacked master JPEG, full resolution only — the mirror image of
#: live_preview.py's `_STACKED_THUMBNAIL`. Requires `.jpg` immediately after
#: the timestamp so a `_thn.jpg` sibling (which also matches the
#: `Stacked_*.jpg` glob) fails this pattern and is skipped by
#: `_newest_by_filename`, exactly as intended: this route must never serve a
#: thumbnail. The frame count is its own capture group — neither
#: live_preview.py's nor archive.py's stacked-file patterns capture it, since
#: neither of those needs it.
_STACKED_FULL = re.compile(
    r"^Stacked_(?P<frame_count>\d+)_.+_(?P<exposure>\d+(?:\.\d+)?)s_.+"
    r"_(?P<date>\d{8})-(?P<time>\d{6})\.jpg$"
)


@dataclass
class LastStack:
    """One target's most recently completed stack — what both /api/last_stack
    and /api/last_stack/image key off. `captured_at` is the file's own mtime
    at DISCOVERY time, already converted to an aware UTC instant and stored
    as data, matching live_preview.LiveFrame's own discipline and for the
    same reason: the metadata response is built from this stored value, never
    by re-`.stat()`-ing `path` at response time.
    """

    path: Path
    target: str  # normalized target id, from the directory name — always
    # the caller's requested `target`, since discover_last_stack() only ever
    # returns a match scoped to it.
    frame_count: int
    captured_at: datetime  # aware UTC, captured once at discovery time


def discover_last_stack(root: Path, target: str) -> LastStack | None:
    """The `target`'s most recently completed stack under `root`, or `None`
    if nothing matches — either no directory on the share normalizes to
    `target` at all, or one does but holds no `Stacked_*.jpg`.

    Scans every directory that normalizes to `target` (not just the first),
    matching live_preview._newest_stacked_thumbnail()'s robustness: two
    differently-named directories could in principle normalize to the same
    target id, and picking the overall newest across all of them is strictly
    more correct than assuming there is only ever one.

    Raises OSError for a missing/unreachable `root` — same discipline as
    live_preview.discover_frame(); the caller
    (discover_last_stack_within_timeout(), and routes.py above it) decides
    how that becomes ShareUnreachableError / REASON_SHARE_UNREACHABLE.
    """
    if not root.is_dir():
        raise OSError(f"last stack share root not found: {root}")
    newest: LastStack | None = None
    for entry in sorted(root.iterdir()):
        if not entry.is_dir() or _SUB_DIR_SUFFIX.search(entry.name):
            continue  # the "-sub"/"_sub" sibling holds individual frames, not stacks
        if normalize_target_id(entry.name) != target:
            continue
        jpg = _newest_by_filename(entry.glob("Stacked_*.jpg"), _STACKED_FULL)
        if jpg is None:
            continue
        match = _STACKED_FULL.match(jpg.name)
        mtime = jpg.stat().st_mtime
        if newest is None or mtime > newest.captured_at.timestamp():
            newest = LastStack(
                path=jpg,
                target=target,
                frame_count=int(match["frame_count"]),
                captured_at=datetime.fromtimestamp(mtime, tz=timezone.utc),
            )
    return newest


async def discover_last_stack_within_timeout(
    root: Path,
    target: str,
    timeout_s: float = SHARE_SCAN_TIMEOUT_SECONDS,
) -> LastStack | None:
    """Async wrapper for routes.py, same shape as live_preview.
    discover_frame_within_timeout(): discover_last_stack() is a blocking
    Path.iterdir()/glob()/stat() walk, and over a live SMB share that must
    neither block the event loop while it runs nor be allowed to hang past
    `timeout_s` if the share has gone quiet (a dropped session, the scope
    rebooting). `asyncio.to_thread` keeps the blocking walk off the event
    loop; `asyncio.wait_for` is the hard ceiling.

    Deliberately a single attempt, not a retry loop — same "never retry
    aggressively" rule live_preview.py's own version documents: a failed/slow
    scan degrades (ShareUnreachableError, handled by the route) and waits for
    the client's own next request rather than this function hammering a share
    that just showed signs of being starved.

    Raises ShareUnreachableError uniformly for a real OSError and for a
    timeout, reusing live_preview.py's exception class directly rather than a
    parallel one for the same condition over the same share.
    """
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(discover_last_stack, root, target), timeout=timeout_s
        )
    except asyncio.TimeoutError as exc:
        raise ShareUnreachableError(f"scan of {root} exceeded {timeout_s}s") from exc
    except OSError as exc:
        raise ShareUnreachableError(str(exc)) from exc
