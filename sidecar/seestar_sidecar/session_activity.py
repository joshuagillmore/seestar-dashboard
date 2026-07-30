"""Read-only tail of SeeStar-AI's provenance.jsonl for the operator panel's
activity feed — GET /api/session_activity (see routes.py). Not a tool: no
MCP tool by this name exists on the server, and the file is read directly
off disk, never through the MCP connection — see allowlist.SIDECAR_ROUTES.

## Read-only in the strict sense

The server OWNS this file and is appending to it live while we read it —
this module must never write, rotate, truncate or lock it, and a
partially-written final line (the writer mid-``handle.write()``) is normal,
not corruption. See `_tail_lines()`.

## The honesty constraint (hand-back item 10)

A provenance record carries no client field — the log cannot distinguish
this dashboard's own tool calls from the agent's. So every record is
classified into three states rather than guessed at:

- **agent** — the tag is not something any call this dashboard can make
  could ever produce. Necessarily someone else.
- **ambiguous** — the tag IS something our own traffic could produce.
  Could be either; never attributed further than that.
- **unknown** — the line didn't parse, or didn't carry a usable ``tool``
  field.

## Why "ambiguous" is NOT simply `ALLOWED_TOOLS`

A single allowlisted tool call can fan out into one or more DIFFERENTLY
NAMED log lines below the MCP tool boundary — verified by tracing
SeeStar-AI's own call graph (`alpaca_client.py`, `qa_tier1.py`) and cross-
checked against a real 691-line `provenance.jsonl`, not assumed from the
tool names alone:

- `assess_conditions` and `plan_targets` both reconcile live GPS
  (`_location_block` -> `_current_gps` -> `alpaca.method_sync("get_device_
  state")`), which logs the tag `"alpaca.put.action"` — NOT
  `"assess_conditions"` or `"plan_targets"`.
- `get_view_state`, `check_night_guardrails`, `qa_tier1` and
  `get_focuser_position` all call `alpaca.method_sync`/`method_async`
  internally for their own reasons, and EVERY one of them logs the exact
  same fixed tag `"alpaca.put.action"` regardless of which native method
  was invoked — `invoke_action()`'s own log call hardcodes that string, it
  is not `f"alpaca.put.{method}"`.
- `get_status` reads five separate ASCOM properties (connected/
  rightascension/declination/tracking/slewing), each logging its own
  `"alpaca.get.<verb>"` tag — `"get_status"` itself never appears.
- `qa_tier1`'s `poll()` ALSO logs its own `"qa_tier1.poll"` tag, in addition
  to the `"alpaca.put.action"` its two native calls produce.

So `get_view_state`'s, `get_status`'s and `get_focuser_position`'s own tool
names never appear in the log at all — only their native-layer side effects
do. A classifier that only checked literal `ALLOWED_TOOLS` membership would
misclassify a large fraction of this dashboard's OWN genuine traffic as
"agent" — the opposite of what this feature exists to prevent.

`_AMBIGUOUS_NATIVE_TAGS` below is the one piece of this module NOT
automatically kept in sync by adding a tool to `ALLOWED_TOOLS` — it encodes
SeeStar-AI's internal call graph, which lives in a different repo and can
change independently of this one. If a newly-allowlisted tool reaches the
native layer some other way, this constant needs a matching update,
verified the same way (trace the source, check a real tail) — not guessed.
This is a real, stated limitation, not an oversight: a purely mechanical
derivation from tool names alone cannot see through to what a tool's own
implementation calls underneath it.

## No prose in this file

Every record here is a bare `{ts, tool, args}` — there is no free-text
"assessment" field anywhere in provenance.jsonl. The design's Claude
sentences ("Dropped frames are up to 23, but eccentricity is flat…") are not
obtainable from this source; this route renders an activity feed of tool
calls, never a transcript or a summary.
"""
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

from seestar_sidecar import env as _env  # noqa: F401 — loads .env before the os.environ.get() below; see env.py

logger = logging.getLogger(__name__)

#: Explicit override, e.g. for a checkout where SeeStar-AI's data directory
#: isn't nested where expected, or for tests. Falls back to
#: `<SEESTAR_AI_DIR>/data/provenance.jsonl` — the real, verified path (see
#: main.py's SEESTAR_AI_DIR; duplicated here rather than imported for the
#: same reason record.py duplicates it — this module must stay importable
#: even when main.py's own module-level state hasn't been touched).
#: `None` when neither is set: "not configured" is a first-class state, the
#: same discipline every other machine-specific path in this app holds
#: itself to (see archive.DEFAULT_ARCHIVE_DIR).
_env_provenance_path = os.environ.get("SEESTAR_PROVENANCE_PATH")
if _env_provenance_path:
    DEFAULT_PROVENANCE_PATH: Path | None = Path(_env_provenance_path)
else:
    _seestar_ai_dir = os.environ.get("SEESTAR_AI_DIR")
    DEFAULT_PROVENANCE_PATH = (
        Path(_seestar_ai_dir) / "data" / "provenance.jsonl" if _seestar_ai_dir else None
    )

ORIGIN_AGENT = "agent"
ORIGIN_AMBIGUOUS = "ambiguous"
ORIGIN_UNKNOWN = "unknown"

#: See the module docstring's "Why 'ambiguous' is NOT simply ALLOWED_TOOLS".
_AMBIGUOUS_NATIVE_TAGS = frozenset(
    {
        "alpaca.put.action",
        "alpaca.get.connected",
        "alpaca.get.rightascension",
        "alpaca.get.declination",
        "alpaca.get.tracking",
        "alpaca.get.slewing",
        "qa_tier1.poll",
    }
)

#: Read backward in chunks of this size rather than the whole file at once —
#: the log grows all night and this route is polled repeatedly. Small enough
#: that tests can override it to force a multi-chunk / mid-line-fragment
#: read path with a tiny synthetic file, rather than needing a genuinely
#: large one to exercise that path.
DEFAULT_READ_CHUNK_BYTES = 8192


@dataclass
class ActivityRecord:
    ts: str | None
    tool: str | None
    args: dict | None
    origin: str


def classify_origin(tool: object, allowed_tools: frozenset, sidecar_routes: frozenset) -> str:
    """`tool` is whatever a raw record's `tool` field held — may be
    non-`str` for a malformed record; `_parse_record()` handles that case
    before this is ever reached, so `tool in allowed_tools` here is always a
    real string membership test, never a type mismatch.

    `allowed_tools`/`sidecar_routes` are passed in rather than imported
    directly, so this can be exercised against a small synthetic allowlist
    in tests without monkeypatching the real one — and so a future caller
    building this against a differently-scoped allowlist (unlikely, but
    cheap to keep possible) isn't hardcoded to the module-level one.
    """
    if tool in allowed_tools or tool in sidecar_routes or tool in _AMBIGUOUS_NATIVE_TAGS:
        return ORIGIN_AMBIGUOUS
    return ORIGIN_AGENT


def _tail_lines(
    path: Path, count: int, chunk_bytes: int = DEFAULT_READ_CHUNK_BYTES
) -> tuple[list[str], bool]:
    """The last `count` COMPLETE lines of `path`, read from the end rather
    than the whole file. Returns `(lines, truncated)`.

    A trailing partial line — the server mid-``write()``, which is normal
    here, not corruption — is always dropped, never returned as a record.
    When the read window started mid-file (didn't reach byte 0), the FIRST
    decoded "line" is a fragment of a line that began earlier than our
    window and is dropped too, for the same reason.

    `truncated` is `started_mid_file OR more complete lines were found than
    `count`` — the first disjunct alone is not enough: at the exact
    boundary where a mid-file read captures exactly `count + 1` newlines,
    the two fragment/trailing drops can bring the surviving count down to
    exactly `count`, which would read as "nothing missing" by a length
    check alone even though a fragment was genuinely discarded just before
    our window. Either signal firing means there is real content not
    represented in what's returned.
    """
    with path.open("rb") as f:
        f.seek(0, os.SEEK_END)
        position = f.tell()
        newline_count = 0
        blocks: list[bytes] = []
        while position > 0 and newline_count <= count:
            read_size = min(chunk_bytes, position)
            position -= read_size
            f.seek(position)
            block = f.read(read_size)
            newline_count += block.count(b"\n")
            blocks.append(block)
        data = b"".join(reversed(blocks))

    started_mid_file = position > 0
    lines = data.decode("utf-8", errors="replace").split("\n")
    if started_mid_file and lines:
        lines = lines[1:]
    if lines:
        lines = lines[:-1]  # the file's trailing "\n", or a write in progress

    # HARDWARE-VERIFIED (2026-07-30, against the real provenance.jsonl):
    # SeeStar-AI writes via `open(path, "a", encoding="utf-8")` with no
    # `newline=` argument, so on Windows every line is terminated "\r\n", not
    # bare "\n" — confirmed byte-for-byte against the live file (691 "\n",
    # 691 "\r"). Splitting on "\n" alone (needed for the partial-line
    # detection above, which `str.splitlines()` cannot distinguish) leaves a
    # trailing "\r" on every surviving line; stripped here rather than left
    # for json.loads to silently tolerate as insignificant whitespace — a
    # raw "\r" cannot legitimately appear anywhere but a line terminator,
    # since json.dumps always escapes control characters inside a string.
    lines = [line.rstrip("\r") for line in lines]

    truncated = started_mid_file or len(lines) > count
    return lines[-count:], truncated


def _parse_record(
    line: str, allowed_tools: frozenset, sidecar_routes: frozenset
) -> ActivityRecord:
    """Never raises: a line that fails to parse, or parses to something
    that isn't a `{tool, args, ts}`-shaped dict, becomes an ORIGIN_UNKNOWN
    record — see the module docstring's "malformed or unrecognised record"
    state — rather than crashing the whole tail over one bad line.
    """
    try:
        payload = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return ActivityRecord(ts=None, tool=None, args=None, origin=ORIGIN_UNKNOWN)
    if not isinstance(payload, dict):
        return ActivityRecord(ts=None, tool=None, args=None, origin=ORIGIN_UNKNOWN)

    tool = payload.get("tool")
    if not isinstance(tool, str):
        return ActivityRecord(
            ts=payload.get("ts"), tool=None, args=payload.get("args"), origin=ORIGIN_UNKNOWN
        )

    return ActivityRecord(
        ts=payload.get("ts"),
        tool=tool,
        args=payload.get("args"),
        origin=classify_origin(tool, allowed_tools, sidecar_routes),
    )


def read_recent_activity(
    path: Path, limit: int, allowed_tools: frozenset, sidecar_routes: frozenset
) -> tuple[list[ActivityRecord], bool]:
    """Newest-first `ActivityRecord`s, `limit`-bounded — the read-only tail
    plus per-record origin classification, composed for routes.py. A blank
    line (defensive; not expected in a well-formed log) is skipped rather
    than turned into a record.
    """
    lines, truncated = _tail_lines(path, limit)
    records = [
        _parse_record(line, allowed_tools, sidecar_routes) for line in lines if line.strip()
    ]
    records.reverse()  # oldest-first on disk -> newest-first for the feed
    return records, truncated
