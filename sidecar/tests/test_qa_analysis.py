"""qa_analysis.py: signature computation, the on-disk cache, the in-memory
job registry, and start_analysis()/resolve_status()'s combined view.

Every `call_qa_tier2` stub here is a plain async function this module hands
straight to start_analysis() — no FastAPI, no MCP connection, no subprocess.
qa_tier2 itself is NEVER invoked for real: see the module docstring's own
"NEVER triggers analysis" discipline, which this suite proves rather than
assumes. Payload shapes below are lifted from a real qa_tier2 response
recorded against the live seestar-mcp server (5 real M74 subs, then
`paths: []` for the shape-only fixture) — not invented, per this repo's own
"a fixture nobody captured from a device records what someone believed, not
what the hardware does".
"""
import asyncio

import pytest

from seestar_sidecar.qa_analysis import (
    STATUS_COMPLETE,
    STATUS_FAILED,
    STATUS_NOT_ANALYSED,
    STATUS_RUNNING,
    STATUS_STALE,
    QaJobRegistry,
    compute_signature,
    load_cached_report,
    resolve_status,
    start_analysis,
    write_cached_report,
)

#: A real qa_tier2 payload's shape, verified against the live server over 5
#: real M74 subs (2026-07-31) — see the sidecar report for the recording
#: command. Trimmed to 2 subs here; the REJECT sub carries a metrics.error
#: analogue for the "unanalysable sub" case, which never occurred in the
#: real 5-sub sample, so that one row is adapted rather than lifted verbatim
#: — clearly marked below.
REAL_REPORT = {
    "ok": True,
    "summary": {
        "target": None,
        "total": 5,
        "kept": 3,
        "wfwhm": 2.2231448729520977,
        "medians": {
            "fwhm": 2.179026005309225,
            "fwhm_sigma": 0.08682085669198542,
            "snr": 40.008737952122154,
            "star_count": 6.0,
            "hfr": 1.3806087069909387,
            "eccentricity": 0.5278405652128294,
            "scattered_light": None,
            "scattered_light_sigma": None,
            "n_analyzed": 5,
        },
        "dominant_reject_cause": "eccentricity",
        "subs": [
            {
                "name": "Light_M 74_10.0s_IRCUT_20240102-172326",
                "verdict": "REJECT",
                "reasons": ["REJECT: eccentricity 0.61 >= 0.575 cutoff"],
                "metrics": {
                    "star_count": 6,
                    "fwhm": 2.1386,
                    "hfr": 1.44,
                    "eccentricity": 0.6059,
                    "snr": 36.511,
                    "background": 3964.0,
                    "scattered_light": None,
                    "error": None,
                },
            },
            {
                "name": "Light_M 74_10.0s_IRCUT_20240102-172349",
                "verdict": "PASS",
                "reasons": ["PASS: all metrics within session norms"],
                "metrics": {
                    "star_count": 7,
                    "fwhm": 2.1608,
                    "hfr": 1.1689,
                    "eccentricity": 0.4103,
                    "snr": 37.4859,
                    "background": 3820.0,
                    "scattered_light": None,
                    "error": None,
                },
            },
            # Adapted, not recorded live: qa_tier2's own docstring guarantees
            # "every metric is nullable... a sub that could not be analyzed
            # still appears, with metrics.error set" (server.py _compact_
            # report) — this row exercises that documented contract, which
            # the 5-sub live sample happened not to hit.
            {
                "name": "Light_M 74_10.0s_IRCUT_20240102-172509",
                "verdict": "REJECT",
                "reasons": ["REJECT: could not analyze sub"],
                "metrics": {
                    "star_count": None,
                    "fwhm": None,
                    "hfr": None,
                    "eccentricity": None,
                    "snr": None,
                    "background": None,
                    "scattered_light": None,
                    "error": "corrupt FITS header",
                },
            },
        ],
    },
    "keep_list": [
        "Light_M 74_10.0s_IRCUT_20240102-172338",
        "Light_M 74_10.0s_IRCUT_20240102-172349",
        "Light_M 74_10.0s_IRCUT_20240102-172400",
    ],
}


def _write_subs(tmp_path, names):
    paths = []
    for name in names:
        p = tmp_path / name
        p.write_bytes(b"fake-fits-bytes")
        paths.append(p)
    return paths


class _RaisingCall:
    """A call_qa_tier2 stub that fails the test the moment it's invoked —
    the "mutation-prove" tool for a cache/job hit: if start_analysis() ever
    calls this, the test fails loudly rather than merely passing by
    coincidence (e.g. because the stub happened to return the right thing).
    """

    async def __call__(self, paths):
        raise AssertionError(f"call_qa_tier2 must not be called again — got paths={paths!r}")


# --- compute_signature ------------------------------------------------------


def test_signature_is_stable_for_the_same_files(tmp_path):
    paths = _write_subs(tmp_path, ["a.fit", "b.fit"])
    assert compute_signature(paths) == compute_signature(paths)


def test_signature_does_not_depend_on_input_order(tmp_path):
    paths = _write_subs(tmp_path, ["a.fit", "b.fit"])
    assert compute_signature(paths) == compute_signature(list(reversed(paths)))


def test_signature_changes_when_a_file_is_added(tmp_path):
    paths = _write_subs(tmp_path, ["a.fit"])
    before = compute_signature(paths)
    paths = _write_subs(tmp_path, ["a.fit", "b.fit"])
    assert compute_signature(paths) != before


def test_signature_changes_when_a_file_is_modified(tmp_path):
    paths = _write_subs(tmp_path, ["a.fit"])
    before = compute_signature(paths)
    paths[0].write_bytes(b"different-bytes-different-size")
    assert compute_signature(paths) != before


def test_signature_tolerates_a_path_that_no_longer_exists(tmp_path):
    # A rare race (archive scan found it, then it vanished before the
    # signature was computed) — not an error this module should raise over;
    # see the docstring's "MISSING" sentinel.
    missing = tmp_path / "gone.fit"
    assert compute_signature([missing])  # does not raise


# --- disk cache --------------------------------------------------------------


def test_load_cached_report_is_none_when_never_written(tmp_path):
    assert load_cached_report(tmp_path, "M31") is None


def test_write_then_load_round_trips(tmp_path):
    write_cached_report(tmp_path, "M31", "sig-1", REAL_REPORT)
    cached = load_cached_report(tmp_path, "M31")
    assert cached["target_id"] == "M31"
    assert cached["signature"] == "sig-1"
    assert cached["result"] == REAL_REPORT
    assert cached["analysed_at"]  # an ISO timestamp was stamped


def test_corrupt_cache_file_degrades_to_none_not_a_raise(tmp_path):
    tmp_path.mkdir(exist_ok=True)
    (tmp_path / "M31.json").write_text("not json{{{", encoding="utf-8")
    assert load_cached_report(tmp_path, "M31") is None


# --- resolve_status: never triggers analysis, by construction (it takes no
# call_qa_tier2 argument at all) --------------------------------------------


def test_resolve_status_is_not_analysed_with_nothing_cached_or_running(tmp_path):
    registry = QaJobRegistry()
    status = resolve_status(registry, tmp_path, "M31", "sig-1")
    assert status == {"status": STATUS_NOT_ANALYSED}


def test_resolve_status_reads_a_matching_disk_cache_as_complete(tmp_path):
    write_cached_report(tmp_path, "M31", "sig-1", REAL_REPORT)
    registry = QaJobRegistry()

    status = resolve_status(registry, tmp_path, "M31", "sig-1", include_report=True)

    assert status["status"] == STATUS_COMPLETE
    assert status["report"] == REAL_REPORT
    assert "analysed_at" in status


def test_resolve_status_flags_a_stale_cache_when_the_sub_set_changed(tmp_path):
    write_cached_report(tmp_path, "M31", "sig-old", REAL_REPORT)
    registry = QaJobRegistry()

    status = resolve_status(registry, tmp_path, "M31", "sig-new", include_report=True)

    assert status["status"] == STATUS_STALE
    # Still attached — the caller (the UI) decides whether to show a stale
    # report clearly marked, rather than this module hiding it outright.
    assert status["report"] == REAL_REPORT


def test_resolve_status_with_include_report_false_omits_the_payload(tmp_path):
    """qa_targets (the listing route) uses this so N targets' full ~412 KB
    reports are never embedded in one listing response.
    """
    write_cached_report(tmp_path, "M31", "sig-1", REAL_REPORT)
    registry = QaJobRegistry()

    status = resolve_status(registry, tmp_path, "M31", "sig-1", include_report=False)

    assert status["status"] == STATUS_COMPLETE
    assert "report" not in status


# --- start_analysis: the only function allowed to call call_qa_tier2 ------


async def test_start_analysis_never_calls_the_tool_synchronously_from_the_caller(tmp_path):
    """The call must run on a background task — start_analysis() itself
    must return "running" immediately, without awaiting the tool call, even
    when the tool call is slow. Proven by a stub that blocks on an event
    this test controls: if start_analysis() awaited it inline, this test
    would hang and time out; instead it must return right away.
    """
    started = asyncio.Event()
    release = asyncio.Event()

    async def slow_call(paths):
        started.set()
        await release.wait()
        return REAL_REPORT

    registry = QaJobRegistry()
    status = start_analysis(registry, tmp_path, "M31", [tmp_path / "a.fit"], slow_call)

    assert status["status"] == STATUS_RUNNING
    assert "started_at" in status

    release.set()  # let the background task finish so it doesn't leak past the test
    job = registry.get("M31")
    if job.task is not None:
        await job.task


async def test_progress_is_observable_while_running(tmp_path):
    """resolve_status() must report "running" (with an elapsed time) while
    the background task is still in flight — this is the "progress" the
    spec asks for: no percentage (qa_tier2 has none to give), but a real,
    live run-state and how long it's been going.
    """
    release = asyncio.Event()

    async def slow_call(paths):
        await release.wait()
        return REAL_REPORT

    registry = QaJobRegistry()
    paths = _write_subs(tmp_path, ["a.fit"])
    signature = compute_signature(paths)
    start_analysis(registry, tmp_path, "M31", paths, slow_call)

    status = resolve_status(registry, tmp_path, "M31", signature)
    assert status["status"] == STATUS_RUNNING
    assert status["elapsed_seconds"] >= 0

    release.set()
    await registry.get("M31").task


async def test_a_running_job_is_reported_running_even_if_the_signature_moved_on(tmp_path):
    """A job genuinely in flight for this target must never be hidden just
    because the archive grew a new sub mid-analysis — see resolve_status()'s
    own docstring for why this differs from the finished-job case below.
    """
    release = asyncio.Event()

    async def slow_call(paths):
        await release.wait()
        return REAL_REPORT

    registry = QaJobRegistry()
    start_analysis(registry, tmp_path, "M31", [tmp_path / "a.fit"], slow_call)

    status = resolve_status(registry, tmp_path, "M31", "a-completely-different-signature")
    assert status["status"] == STATUS_RUNNING

    release.set()
    await registry.get("M31").task


async def test_a_completed_job_becomes_visible_once_the_task_finishes(tmp_path):
    async def call(paths):
        return REAL_REPORT

    registry = QaJobRegistry()
    paths = _write_subs(tmp_path, ["a.fit"])
    signature = compute_signature(paths)
    start_analysis(registry, tmp_path, "M31", paths, call)

    await registry.get("M31").task  # let the background task run to completion

    status = resolve_status(registry, tmp_path, "M31", signature, include_report=True)
    assert status["status"] == STATUS_COMPLETE
    assert status["report"] == REAL_REPORT
    # Verdicts/reasons/metrics pass through byte-for-byte, including the
    # metrics.error sub — nothing here filters or recomputes anything.
    assert status["report"]["summary"]["subs"] == REAL_REPORT["summary"]["subs"]


async def test_a_completed_job_is_written_to_the_disk_cache(tmp_path):
    async def call(paths):
        return REAL_REPORT

    registry = QaJobRegistry()
    paths = _write_subs(tmp_path, ["a.fit"])
    start_analysis(registry, tmp_path, "M31", paths, call)
    await registry.get("M31").task

    cached = load_cached_report(tmp_path, "M31")
    assert cached is not None
    assert cached["result"] == REAL_REPORT


async def test_a_raised_exception_is_recorded_as_failed_not_propagated(tmp_path):
    async def boom(paths):
        raise RuntimeError("subprocess died mid-analysis")

    registry = QaJobRegistry()
    paths = _write_subs(tmp_path, ["a.fit"])
    signature = compute_signature(paths)
    start_analysis(registry, tmp_path, "M31", paths, boom)
    await registry.get("M31").task

    status = resolve_status(registry, tmp_path, "M31", signature)
    assert status["status"] == STATUS_FAILED
    assert "subprocess died" in status["error"]
    # A failure must not be cached as if it were a real result.
    assert load_cached_report(tmp_path, "M31") is None


async def test_a_tool_level_ok_false_is_also_recorded_as_failed(tmp_path):
    """qa_tier2 never raises on its own failures (server-wide convention) —
    it returns {"ok": false, "error": ...}. That must be treated as a failed
    job too, not cached as a success.
    """

    async def not_ok(paths):
        return {"ok": False, "error": "no such directory"}

    registry = QaJobRegistry()
    paths = _write_subs(tmp_path, ["a.fit"])
    signature = compute_signature(paths)
    start_analysis(registry, tmp_path, "M31", paths, not_ok)
    await registry.get("M31").task

    status = resolve_status(registry, tmp_path, "M31", signature)
    assert status["status"] == STATUS_FAILED
    assert status["error"] == "no such directory"


# --- mutation-proof cache/job hits: call_qa_tier2 must NOT be called again -


async def test_start_analysis_does_not_recompute_an_in_memory_complete_hit(tmp_path):
    async def call(paths):
        return REAL_REPORT

    registry = QaJobRegistry()
    paths = _write_subs(tmp_path, ["a.fit"])
    start_analysis(registry, tmp_path, "M31", paths, call)
    await registry.get("M31").task  # first run actually completes

    # Second call for the SAME sub set must short-circuit on the in-memory
    # job — proven by a stub that fails the test if it's ever invoked.
    status = start_analysis(registry, tmp_path, "M31", paths, _RaisingCall())
    assert status["status"] == STATUS_COMPLETE


async def test_start_analysis_does_not_recompute_a_disk_cache_hit_after_a_fresh_registry(tmp_path):
    """Simulates a process restart: a brand-new, empty QaJobRegistry (no
    in-memory job at all) but the SAME cache_dir from a previous run. The
    disk cache alone must be enough to avoid recomputing.
    """
    paths = _write_subs(tmp_path, ["a.fit"])
    signature = compute_signature(paths)
    write_cached_report(tmp_path, "M31", signature, REAL_REPORT)

    fresh_registry = QaJobRegistry()
    status = start_analysis(fresh_registry, tmp_path, "M31", paths, _RaisingCall())

    assert status["status"] == STATUS_COMPLETE


async def test_start_analysis_never_starts_a_second_concurrent_job_for_the_same_target(tmp_path):
    """Two "start" calls in quick succession for the same target, while the
    first is still running, must not create two competing background tasks
    — the second must return the first job's own (running) status.
    """
    call_count = 0
    release = asyncio.Event()

    async def slow_call(paths):
        nonlocal call_count
        call_count += 1
        await release.wait()
        return REAL_REPORT

    registry = QaJobRegistry()
    paths = _write_subs(tmp_path, ["a.fit"])
    first = start_analysis(registry, tmp_path, "M31", paths, slow_call)
    # Give the event loop one tick so the first background task actually
    # starts running (asyncio.create_task only SCHEDULES it) and reaches
    # `await release.wait()` before the second start_analysis() call below —
    # otherwise call_count could read 0 regardless of whether dedup works.
    await asyncio.sleep(0)
    second = start_analysis(registry, tmp_path, "M31", paths, slow_call)

    assert first["status"] == STATUS_RUNNING
    assert second["status"] == STATUS_RUNNING
    assert call_count == 1  # the second start did NOT launch another call

    release.set()
    await registry.get("M31").task


# --- invalidation: a changed sub set must trigger a real recomputation ----


async def test_a_changed_sub_set_invalidates_the_cache_and_recomputes(tmp_path):
    paths = _write_subs(tmp_path, ["a.fit"])
    old_signature = compute_signature(paths)
    write_cached_report(tmp_path, "M31", old_signature, REAL_REPORT)

    # A new sub lands — the archive scan would now return a different path
    # list, hence a different signature.
    new_paths = _write_subs(tmp_path, ["a.fit", "b.fit"])

    registry = QaJobRegistry()
    status_before = resolve_status(
        registry, tmp_path, "M31", compute_signature(new_paths), include_report=True
    )
    assert status_before["status"] == STATUS_STALE

    call_count = 0

    async def call(paths):
        nonlocal call_count
        call_count += 1
        return REAL_REPORT

    status = start_analysis(registry, tmp_path, "M31", new_paths, call)
    assert status["status"] == STATUS_RUNNING
    await registry.get("M31").task
    assert call_count == 1  # the stale cache did NOT short-circuit this run


def test_an_interrupted_job_reports_as_interrupted_not_as_never_run(tmp_path):
    """A running job lives only in memory and an asyncio task, so a restart
    used to lose it silently — the target read `not_analysed` again with
    nothing to say that twenty minutes of work had been thrown away.

    `not_analysed` was not a lie, but "nobody has run this" and "a run was
    killed under you" are different things to be told. Simulates the restart
    the only way that matters: a marker on disk and a FRESH registry, exactly
    what a new process sees.
    """
    from seestar_sidecar.qa_analysis import mark_inflight, resolve_status

    cache_dir = tmp_path / "qa"
    mark_inflight(cache_dir, "IC405", "sig-1")

    status = resolve_status(QaJobRegistry(), cache_dir, "IC405", "sig-1")

    assert status["status"] == STATUS_FAILED
    assert "interrupted" in status["error"]


def test_a_cleared_marker_reads_as_never_analysed(tmp_path):
    from seestar_sidecar.qa_analysis import clear_inflight, mark_inflight, resolve_status

    cache_dir = tmp_path / "qa"
    mark_inflight(cache_dir, "IC405", "sig-1")
    clear_inflight(cache_dir, "IC405")

    assert resolve_status(QaJobRegistry(), cache_dir, "IC405", "sig-1")["status"] == (
        STATUS_NOT_ANALYSED
    )


def test_a_completed_report_wins_over_a_stale_marker(tmp_path):
    """Belt and braces: a marker that somehow outlived its job must not mask
    a real cached report."""
    from seestar_sidecar.qa_analysis import mark_inflight, resolve_status, write_cached_report

    cache_dir = tmp_path / "qa"
    write_cached_report(cache_dir, "IC405", "sig-1", {"ok": True, "summary": {"subs": []}})
    mark_inflight(cache_dir, "IC405", "sig-1")

    assert resolve_status(QaJobRegistry(), cache_dir, "IC405", "sig-1")["status"] == STATUS_COMPLETE


def test_marking_in_flight_never_raises_on_an_unwritable_cache_dir(tmp_path):
    """Failing to write the marker must not stop the analysis — it only costs
    the nicer message on the unlucky path."""
    from seestar_sidecar.qa_analysis import mark_inflight

    blocker = tmp_path / "not-a-dir"
    blocker.write_text("x", encoding="utf-8")

    mark_inflight(blocker / "qa", "IC405", "sig-1")  # must not raise


def test_a_report_that_cannot_be_saved_is_reported_failed_not_complete(tmp_path, monkeypatch):
    """Publishing complete before the write meant a restart in that window
    lost the result AND the interruption marker, so the target read
    not_analysed with nothing to say work had happened.

    A result no restart can recover is not a success, and saying `complete`
    for one that exists only in this process's memory is the dishonest
    version.
    """
    import asyncio

    from seestar_sidecar import qa_analysis

    cache_dir = tmp_path / "qa"
    registry = QaJobRegistry()

    def boom(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(qa_analysis, "write_cached_report", boom)

    async def tier2(paths):
        return {"ok": True, "summary": {"subs": []}, "keep_list": []}

    async def run():
        qa_analysis.start_analysis(registry, cache_dir, "M31", [tmp_path / "a.fit"], tier2)
        for _ in range(200):
            await asyncio.sleep(0.01)
            job = registry.get("M31")
            if job and job.status != qa_analysis.STATUS_RUNNING:
                return job
        raise AssertionError("job never finished")

    job = asyncio.run(run())

    assert job.status == STATUS_FAILED
    assert "could not be saved" in job.error


def test_the_cache_write_is_atomic(tmp_path):
    """write_text truncated the file in place, so a crash mid-write destroyed
    the PREVIOUS good report as well as failing to store the new one."""
    from seestar_sidecar.qa_analysis import load_cached_report, write_cached_report

    cache_dir = tmp_path / "qa"
    write_cached_report(cache_dir, "M31", "sig-1", {"ok": True, "summary": {"subs": []}})
    write_cached_report(cache_dir, "M31", "sig-2", {"ok": True, "summary": {"subs": [1]}})

    cached = load_cached_report(cache_dir, "M31")
    assert cached["signature"] == "sig-2"
    # No temp file left behind for a reader to trip over.
    assert not list(cache_dir.glob("*.tmp"))


def test_a_third_concurrent_analysis_is_refused_rather_than_queued(tmp_path):
    """Per-target idempotency capped duplicates of ONE target and did nothing
    about twenty different ones. Each analysis is minutes of photutils on one
    CPU, so unbounded starts finish everything later than doing them in
    order."""
    import asyncio

    from seestar_sidecar import qa_analysis

    cache_dir = tmp_path / "qa"
    registry = QaJobRegistry()
    started = asyncio.Event()

    async def slow(paths):
        started.set()
        await asyncio.sleep(5)
        return {"ok": True, "summary": {"subs": []}, "keep_list": []}

    async def run():
        for name in ("A", "B"):
            qa_analysis.start_analysis(registry, cache_dir, name, [tmp_path / "a.fit"], slow)
        await asyncio.sleep(0.05)
        with pytest.raises(qa_analysis.TooManyAnalyses) as refused:
            qa_analysis.start_analysis(registry, cache_dir, "C", [tmp_path / "a.fit"], slow)
        return refused.value

    refusal = asyncio.run(run())

    # A refusal is not a job state: it raises rather than returning
    # status "failed", which the client could not tell from a job that ran
    # and failed — and which replaced whatever report it was showing.
    assert "already running" in str(refusal)
    assert registry.get("C") is None, "a refused start must not register a job"


# --- defence in depth: the cache never builds a path outside cache_dir -------


@pytest.mark.parametrize(
    "target_id",
    [
        "../outside",
        "..\\outside",
        "a/../../outside",
        "/etc/outside",
        "C:/outside",
        "C:outside",
        "//attacker.example/share/x",
        "\\\\attacker.example\\share\\x",
        "M31:stream",
        "",
        "NUL",
    ],
)
def test_cache_paths_refuse_anything_that_is_not_a_plain_name_inside_the_cache(
    tmp_path, target_id
):
    """routes.py validates target ids first; this is the second layer, so a
    future caller that forgets cannot turn a target id into a path outside the
    cache. Checked lexically: resolving a UNC path to test containment would
    itself open the SMB connection the check exists to prevent."""
    from seestar_sidecar import qa_analysis

    cache_dir = tmp_path / "cache"
    with pytest.raises(ValueError):
        qa_analysis._cache_path(cache_dir, target_id)
    with pytest.raises(ValueError):
        qa_analysis._inflight_path(cache_dir, target_id)

    # The public readers degrade to "nothing there" rather than raising into a
    # route, and the writer refuses.
    assert qa_analysis.load_cached_report(cache_dir, target_id) is None
    assert qa_analysis.load_inflight(cache_dir, target_id) is None
    with pytest.raises(ValueError):
        qa_analysis.write_cached_report(cache_dir, target_id, "sig", {"ok": True})


def test_ordinary_target_ids_still_map_into_the_cache(tmp_path):
    from seestar_sidecar import qa_analysis

    cache_dir = tmp_path / "cache"
    for target_id in ("M31", "NGC2244", "SH2-142", "IC405", "C_33", "Sh2+155", ".."):
        assert qa_analysis._cache_path(cache_dir, target_id) == cache_dir / f"{target_id}.json"
        assert (
            qa_analysis._inflight_path(cache_dir, target_id)
            == cache_dir / f"{target_id}.inflight.json"
        )
