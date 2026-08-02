"""On-demand Tier-2 QA analysis: resolve a target's FITS paths from the
archive scan (see archive.ArchiveTarget.sub_paths), call `qa_tier2` in the
background, and cache the result to disk keyed by an input-set fingerprint.

This is Option A from docs/superpowers/specs/2026-07-31-slice-4-review-qa.md
§1 — chosen because there is no stored report to read (§1a), no read-only
getter for one (§1b — raised as a hand-back), and `qa_tier2` itself computes
from scratch and is "minutes of CPU, not a page-load fetch" over 200-1400
subs (§1c). Analysis is therefore NEVER triggered by a listing/status read —
only `start_analysis()` can ever call `call_qa_tier2`, and routes.py only
ever calls that from a route a deliberate user action reaches, never from a
page-load route. See routes.py's qa_targets/qa_analysis_start/
qa_analysis_status handlers for how this is wired to HTTP.

Two independent stores, deliberately:

- `QaJobRegistry` — in-memory, per app instance (same discipline as
  app.state.connection — two apps in one process must not share job state).
  Tracks at most one job per target for THIS process's lifetime: while it's
  running, and its outcome once it finishes, until superseded by a new job
  for that target. Lost on restart — that's fine, the disk cache survives.
- The on-disk cache (`write_cached_report`/`load_cached_report`) — the
  durable, cross-restart record of the last COMPLETED analysis for a target,
  one JSON file per target_id. This is what makes a re-request after a
  restart instant instead of re-running.

`compute_signature()` is the one thing standing in for "has the sub set
changed": name+size+mtime per file, never file contents — hashing 1400 subs
at ~4 MB each would itself be the network/CPU cost this whole module exists
to avoid triggering implicitly. It is cheap (a stat() per path, same order
of cost as archive.py's own scan) and changes whenever a sub is added,
removed, or modified, which is what makes a stale cache entry detectable
without re-running qa_tier2 speculatively to find out.
"""
import asyncio
import hashlib
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable

from seestar_sidecar import env as _env  # noqa: F401 — loads .env before the os.environ.get() below; see env.py

logger = logging.getLogger(__name__)

#: sidecar/seestar_sidecar/qa_analysis.py -> parents[1] is sidecar/. Gitignored
#: by the existing "sidecar/.cache/" rule (see .gitignore) — same convention
#: as imagery.DEFAULT_IMAGE_CACHE_DIR.
DEFAULT_QA_CACHE_DIR = Path(
    os.environ.get(
        "SEESTAR_QA_CACHE_DIR",
        str(Path(__file__).resolve().parents[1] / ".cache" / "qa_analysis"),
    )
)

#: Wire status values — short, stable, machine-readable, same discipline as
#: live_preview.py's REASON_* constants: the wording a user reads is the
#: UI's job, never this module's.
STATUS_NOT_ANALYSED = "not_analysed"  # never run for this target, no cache either
STATUS_RUNNING = "running"  # a job for the CURRENT sub set is in flight right now
STATUS_COMPLETE = "complete"  # a result exists (job or cache) matching the current sub set
STATUS_FAILED = "failed"  # the most recent job for the current sub set raised or returned ok:false
#: A cached result exists, but for a DIFFERENT sub set than the one on disk
#: right now — distinct from STATUS_NOT_ANALYSED (see spec §3/§4: don't
#: silently serve a stale report as current, and don't silently discard it
#: either). resolve_status() still attaches it when include_report=True, so
#: the caller can choose to show it clearly marked "stale" instead.
STATUS_STALE = "stale"


def compute_signature(paths: list[Path]) -> str:
    """A cheap fingerprint of an input FITS set — name+size+mtime per path,
    NOT file contents. Sorted first, so the same set of files discovered in
    a different filesystem order still hashes identically; a path that
    vanished between the archive scan and this call (a rare race, not an
    error) is recorded as "MISSING" rather than raising, since a signature
    is a best-effort identity check, not a read of the files themselves.
    """
    parts = []
    for path in sorted(paths, key=str):
        try:
            st = path.stat()
        except OSError:
            parts.append(f"{path}:MISSING")
            continue
        parts.append(f"{path}:{st.st_size}:{int(st.st_mtime)}")
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(instant: datetime | None) -> str | None:
    return instant.isoformat() if instant is not None else None


@dataclass
class QaJob:
    """One target's most recent analysis attempt, tracked in-memory for this
    process's lifetime — see QaJobRegistry. `result` is qa_tier2's own
    payload verbatim (`{"ok": ..., "summary": {...}, "keep_list": [...]}`) —
    never reshaped; CLAUDE.md's "the UI renders verdicts, it never computes
    or re-derives them" applies just as much to this sidecar layer as to the
    client. `task` holds the asyncio.Task itself purely so it isn't garbage
    collected mid-flight (asyncio only keeps a weak reference otherwise) —
    it is never serialised and never inspected for its result directly; the
    task's own body updates `status`/`result`/`error`/`finished_at` on this
    same object when it completes.
    """

    target_id: str
    signature: str
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    error: str | None = None
    result: dict | None = None
    task: "asyncio.Task | None" = field(default=None, repr=False, compare=False)


class QaJobRegistry:
    """At most one job per target, held on app.state — one per app instance,
    same discipline as app.state.connection (two apps in a process must not
    share this). Not the cache: see the module docstring for why the two are
    separate stores.
    """

    def __init__(self) -> None:
        self._jobs: dict[str, QaJob] = {}

    def get(self, target_id: str) -> QaJob | None:
        return self._jobs.get(target_id)

    def set(self, job: QaJob) -> None:
        self._jobs[job.target_id] = job


def _cache_path(cache_dir: Path, target_id: str) -> Path:
    return cache_dir / f"{target_id}.json"


def load_cached_report(cache_dir: Path, target_id: str) -> dict | None:
    """`{"target_id", "signature", "analysed_at", "result"}` for the most
    recently CACHED (i.e. completed and written) analysis of `target_id`, or
    `None` if it was never analysed, or the cache file is unreadable.
    Deliberately does not compare `signature` against anything — that's the
    caller's job (see resolve_status()) — so a caller that wants the
    possibly-stale report anyway can still get it rather than this treating
    a mismatch as if nothing exists.
    """
    path = _cache_path(cache_dir, target_id)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.warning(
            "qa analysis cache for %s is unreadable, treating as not-yet-analysed",
            target_id,
            exc_info=True,
        )
        return None


def write_cached_report(cache_dir: Path, target_id: str, signature: str, result: dict) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "target_id": target_id,
        "signature": signature,
        "analysed_at": _iso(_now()),
        "result": result,
    }
    _cache_path(cache_dir, target_id).write_text(json.dumps(payload), encoding="utf-8")


def _job_view(job: QaJob, include_report: bool) -> dict:
    if job.status == STATUS_RUNNING:
        out = {"status": STATUS_RUNNING, "started_at": _iso(job.started_at)}
        out["elapsed_seconds"] = round((_now() - job.started_at).total_seconds(), 1)
        return out
    if job.status == STATUS_FAILED:
        return {"status": STATUS_FAILED, "error": job.error}
    out = {"status": STATUS_COMPLETE, "analysed_at": _iso(job.finished_at)}
    if include_report:
        out["report"] = job.result
    return out


def verdict_counts(result: dict | None) -> dict | None:
    """`{pass, marginal, reject, unknown, total}` from a qa_tier2 result, or
    `None` when there is no report to count.

    Exists so `qa_targets` can carry a target's quality mix without carrying
    the whole report — a listing that embedded 22 reports of up to ~430 KB is
    exactly the bloat `include_report=False` is there to avoid. This is five
    integers per target.

    Verdicts are COUNTED, never re-derived: the key is whatever string the
    server put on the sub, and anything outside the policy's three lands in
    `unknown` rather than being coerced into one of them. That mirrors the
    client's own `toneFor` and keeps a vocabulary change visible instead of
    silently folded into "pass".
    """
    if not result:
        return None
    subs = (result.get("summary") or {}).get("subs")
    if subs is None:
        return None
    counts = {"pass": 0, "marginal": 0, "reject": 0, "unknown": 0}
    for sub in subs:
        key = {"PASS": "pass", "MARGINAL": "marginal", "REJECT": "reject"}.get(
            sub.get("verdict"), "unknown"
        )
        counts[key] += 1
    counts["total"] = len(subs)
    return counts


def resolve_status(
    registry: QaJobRegistry,
    cache_dir: Path,
    target_id: str,
    signature: str,
    include_report: bool = True,
) -> dict:
    """The current truth for one target — a running job, a job/cache result
    for the CURRENT sub set, or a cache result for an older one (STALE) —
    without starting anything. Only `start_analysis()` may ever kick off a
    job; this function is safe to call on every page load and every poll.

    A running job is always reported as running regardless of its own
    signature: it is genuinely in flight against SOME sub set for this
    target right now, and hiding that (because the archive has since grown a
    new sub) would tell the user nothing is happening while it is.
    A finished (complete/failed) in-memory job is only trusted when its
    signature matches `signature` — otherwise it's stale relative to what's
    on disk right now, so this falls through to the durable disk cache
    instead, which start_analysis() itself will also have to reconcile
    against before deciding whether to start a new job.
    """
    job = registry.get(target_id)
    if job is not None and (job.status == STATUS_RUNNING or job.signature == signature):
        return _job_view(job, include_report)

    cached = load_cached_report(cache_dir, target_id)
    if cached is not None:
        status = STATUS_COMPLETE if cached["signature"] == signature else STATUS_STALE
        out = {"status": status, "analysed_at": cached["analysed_at"]}
        if include_report:
            out["report"] = cached["result"]
        return out

    return {"status": STATUS_NOT_ANALYSED}


def start_analysis(
    registry: QaJobRegistry,
    cache_dir: Path,
    target_id: str,
    paths: list[Path],
    call_qa_tier2: Callable[[list[str]], Awaitable[dict]],
    include_report: bool = False,
) -> dict:
    """Idempotently ensure an analysis is in flight or already done for
    `target_id`'s CURRENT sub set (`paths`), returning the same status shape
    `resolve_status()` would. NEVER blocks on `call_qa_tier2` — the actual
    call runs on an `asyncio.create_task` this function starts and returns
    from immediately, per the spec's "must not block a request".

    Mutation-proof against double-computation: `call_qa_tier2` is invoked
    only when neither an in-flight job nor a cache/job hit already answers
    for the CURRENT signature —

    - a job already RUNNING for this target (any signature — see
      resolve_status()) is left alone and its status returned as-is. This is
      also what stops two concurrent qa_tier2 calls for the same target from
      racing to overwrite each other's registry entry, and from each other
      queueing for minutes behind the single MCP stdio lock
      (mcp_proxy.McpConnection) for no benefit.
    - a finished in-memory job or a disk cache entry matching the current
      signature is returned directly, no new task created.

    Only once neither applies does this create a QaJob, register it, and
    hand the real call off to a background task — the ONLY path in this
    module that ever calls `call_qa_tier2`.
    """
    signature = compute_signature(paths)
    existing = registry.get(target_id)

    if existing is not None and existing.status == STATUS_RUNNING:
        return _job_view(existing, include_report)

    if existing is not None and existing.status == STATUS_COMPLETE and existing.signature == signature:
        return _job_view(existing, include_report)

    cached = load_cached_report(cache_dir, target_id)
    if cached is not None and cached["signature"] == signature:
        out = {"status": STATUS_COMPLETE, "analysed_at": cached["analysed_at"]}
        if include_report:
            out["report"] = cached["result"]
        return out

    job = QaJob(target_id=target_id, signature=signature, status=STATUS_RUNNING, started_at=_now())
    registry.set(job)

    async def _run() -> None:
        try:
            result = await call_qa_tier2([str(p) for p in paths])
        except Exception as exc:  # noqa: BLE001 — a job failure must degrade this job's own status, never crash the event loop or take down the server over one target's analysis
            job.status = STATUS_FAILED
            job.error = str(exc)
            job.finished_at = _now()
            logger.warning("qa_tier2 analysis failed for %s", target_id, exc_info=True)
            return
        if not result.get("ok", True):
            job.status = STATUS_FAILED
            job.error = result.get("error") or "qa_tier2 returned ok: false"
            job.finished_at = _now()
            return
        job.status = STATUS_COMPLETE
        job.result = result
        job.finished_at = _now()
        try:
            write_cached_report(cache_dir, target_id, signature, result)
        except OSError:
            logger.warning("failed to write qa analysis cache for %s", target_id, exc_info=True)

    job.task = asyncio.create_task(_run())
    return _job_view(job, include_report)
