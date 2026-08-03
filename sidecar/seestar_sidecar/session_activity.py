"""Read-only tail of SeeStar-AI's provenance.jsonl for the operator panel's
activity feed — GET /api/session_activity (see routes.py). Not a tool: no
MCP tool by this name exists on the server, and the file is read directly
off disk, never through the MCP connection — see allowlist.SIDECAR_ROUTES.

## Read-only in the strict sense

The server OWNS this file and is appending to it live while we read it —
this module must never write, rotate, truncate or lock it, and a
partially-written final line (the writer mid-``handle.write()``) is normal,
not corruption. See `_tail_lines()`.

## Attribution: the `client` field, not the tool tag

Every record seestar-mcp writes carries `client` — unconditional in
`ProvenanceLog.log_call()`, sourced from `SEESTAR_CLIENT_ID`. This sidecar sets
that variable on the subprocess it spawns (`mcp_proxy.effective_client_id()`,
`"console"` unless an operator overrides it), so our own traffic is
identifiable by name. Four states:

- **console** — `client` equals ours. This dashboard's own call, positively
  identified, not inferred.
- **agent** — `client` is present and is somebody else's: the Claude agent, or
  a second console with its own id.
- **ambiguous** — the record parsed but carries no `client`. Only records
  predating the field, a shrinking tail of the log; never a live call.
- **unknown** — the line didn't parse, or carried no usable ``tool``.

## Why there is no tag heuristic here any more (hand-back item 10)

Worth knowing, because the deleted code looked careful and was wrong.

Records used to carry no client id, so this module inferred origin from the
tool tag, against a hardcoded mirror of seestar-mcp's internal call graph. That
mirror was needed because one allowlisted tool fans out into differently-named
lines below the MCP boundary: `invoke_action()` logged a fixed
`"alpaca.put.action"` whatever native method ran, `get_status` logged five
`"alpaca.get.<verb>"` tags and never its own name, and so on. A bare
`ALLOWED_TOOLS` membership test would therefore have called much of this
dashboard's own traffic "agent".

Two things then happened, and only the first was noticed at the time:

1. The client id landed, which made the inference unnecessary.
2. `invoke_action()` started naming the method (`seestar.get_view_state`,
   `seestar.get_device_state`, …) and stopped emitting `alpaca.put.action`
   entirely — last seen 2026-07-31. None of the new tags were in the mirror,
   and the fallback was `agent`, so the module spent that window reporting our
   own polling as the agent's. Exactly the failure it was built to prevent.

The lesson is about the shape, not the tags: **a mirror of another repo's
internals, maintained by hand, in a third place, fails silently and in the
direction that looks plausible.** If `client` ever needs supplementing, the
answer is a field on the record, asked for upstream — not a copy of their call
graph kept here.

## No prose in this file

Records are structured throughout — `{ts, client, tool, args}` always, plus
`request` / `client_txn_id` / `server_txn_id` / `response_code` / `note` /
`elapsed_ms` where they apply. (This section used to say "a bare
`{ts, tool, args}`"; that was the format at the time.) What matters here is
unchanged: there is no free-text "assessment" field anywhere in
provenance.jsonl. The design's Claude
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

#: This console's own traffic, identified by name rather than inferred.
ORIGIN_CONSOLE = "console"
#: Some other client — the agent, or a second console. Not us.
ORIGIN_AGENT = "agent"
#: Parsed fine, but predates the `client` field, so genuinely unattributable.
ORIGIN_AMBIGUOUS = "ambiguous"
#: The line did not parse, or carried no usable `tool`.
ORIGIN_UNKNOWN = "unknown"

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


def classify_origin(client: object, self_id: str) -> str:
    """Who wrote this record, from the record's own `client` field.

    `client` is whatever the raw record held — a string on any record written
    since seestar-mcp started stamping it, and absent on anything older. A
    non-string is treated as absent rather than coerced: a malformed value is
    not evidence of anything.

    `self_id` is passed in rather than read from the environment here so a
    test can exercise the match without touching `os.environ`, and so the
    caller has to have gone through `mcp_proxy.effective_client_id()` — the
    one place that knows what we actually told the server to call itself.

    Note what this deliberately does NOT do: infer anything from `tool`. The
    previous implementation matched tool tags against a hardcoded mirror of
    seestar-mcp's internal call graph, because records carried no client id
    when this module was written. That mirror went stale the moment
    `invoke_action()` stopped logging a fixed `alpaca.put.action` tag
    (2026-07-31), and because the fallback was `agent`, this console's own
    polling was being reported as the agent's — the precise misattribution the
    feature exists to prevent. A name beats an inference; there is no reason
    to keep the inference beside it.
    """
    if not isinstance(client, str) or not client:
        return ORIGIN_AMBIGUOUS
    return ORIGIN_CONSOLE if client == self_id else ORIGIN_AGENT


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


def _parse_record(line: str, self_id: str) -> ActivityRecord:
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
        origin=classify_origin(payload.get("client"), self_id),
    )


def read_recent_activity(path: Path, limit: int, self_id: str) -> tuple[list[ActivityRecord], bool]:
    """Newest-first `ActivityRecord`s, `limit`-bounded — the read-only tail
    plus per-record origin classification, composed for routes.py. A blank
    line (defensive; not expected in a well-formed log) is skipped rather
    than turned into a record.

    `self_id` is this console's client id — see `classify_origin`.
    """
    lines, truncated = _tail_lines(path, limit)
    records = [_parse_record(line, self_id) for line in lines if line.strip()]
    records.reverse()  # oldest-first on disk -> newest-first for the feed
    return records, truncated
