import { useEffect, useRef, useState } from 'react'
import {
  fetchFocuserPosition,
  fetchGuardrails,
  fetchLastStack,
  fetchLivePreview,
  fetchRunState,
  fetchSessionActivity,
  fetchStatus,
  fetchTargetObservability,
  fetchTier1,
  fetchViewState,
  NoAnswerError,
  SchemaError,
} from '../../api/client'
import type {
  FocuserPosition,
  Guardrails,
  LastStack,
  LivePreview,
  RunState,
  SessionActivity,
  TargetObservability,
  Tier1,
  ViewState,
} from '../../api/schemas'
import { appendTelemetryEntry, type TelemetryEntry } from './telemetryLog'
import { lastStackIsSettled, shouldFetchLastStack } from './lastStack'

/**
 * How often the screen re-checks scope/session state and re-polls the
 * preview and telemetry. Deliberately slow, per the slice-3 spec's own D2
 * ruling — "slow by default, and configurable". There is no settings UI
 * yet, so "configurable" today means "change this one constant."
 */
export const POLL_INTERVAL_MS = 60_000

/**
 * While `get_run_state` reports idle, do the device-touching check on every
 * Nth poll instead of every one. At the 60 s poll interval that is one check
 * every five minutes on a parked scope, down from one a minute.
 *
 * Not zero, on purpose — see this hook's doc comment: `run_state.json` only
 * exists for skill-driven runs, so `idle` cannot rule out a session started
 * by hand from the phone app.
 */
export const IDLE_DEVICE_CHECK_EVERY = 5

/**
 * Should this poll spend bridge requests on `get_status` + `get_view_state`?
 *
 * `idleTicks` is how many consecutive polls have reported idle, counting this
 * one — so 1 is the first idle poll and must still check, which is what makes
 * opening the screen mid-session immediate.
 *
 * Every non-idle answer, including a null from a failed or absent
 * `get_run_state`, checks the device. Failing open matters more than the
 * saving: the cost of an unnecessary check is six bridge requests, and the
 * cost of a wrongly-skipped one is a live session the screen never shows.
 */
export function shouldCheckDevice(
  runStateState: 'active' | 'idle' | 'unknown' | null,
  idleTicks: number,
): boolean {
  if (runStateState !== 'idle') return true
  return idleTicks <= 1 || (idleTicks - 1) % IDLE_DEVICE_CHECK_EVERY === 0
}

/** The activity column shows a compact recent tail, not the whole log —
 * matching the design's own scrolling operator panel rather than an
 * unbounded list. */
export const SESSION_ACTIVITY_LIMIT = 30

/**
 * How many polls in a row must get an explicit "no View" answer before the
 * session is forgotten. One is not enough: a single `result: {}` mid-session
 * would otherwise wipe the log and restart the guardrail clock. See
 * `endSession` in the hook below for the full list of what ends a session.
 */
export const IDLE_ANSWERS_TO_END = 2

/**
 * K: how many polls in a row may fail before a failed read stops being
 * treated as a blip. Three things turn on it (see endSession and poll in the
 * hook below):
 *
 * - a run of idle-looking polls that includes a relayed get_view_state
 *   failure (get_status answered; the documented idle signature) ends the
 *   session at K, where a run of explicit no-View answers alone ends it at
 *   IDLE_ANSWERS_TO_END;
 * - after K failed polls of any kind, the screen shows that failure rather
 *   than the held session marked "Not current". A failure that is not an
 *   idle sign (bridge down, an unreadable answer, a request that got no
 *   answer) still does not end the session: it resumes, with its true start,
 *   if the scope comes back;
 * - the device check is forced every poll only while a session is open AND
 *   fewer than K polls have failed. After that the ordinary back-off applies.
 *
 * At POLL_INTERVAL_MS that is five minutes of failures.
 */
export const FAILED_POLLS_LIMIT = 5

/**
 * A session with no View seen for this long is over, whatever the polls in
 * between said. Failed polls never end a session on their own, so without
 * this a tab left open while the scope was off all day (every poll
 * bridge-down) would carry yesterday's start into tonight's session on the
 * same target: the false `park_and_stop — Session duration 24.3h` the
 * end-of-session reset exists to prevent.
 *
 * Long enough that no in-session outage plausibly reaches it (a laptop that
 * slept, a sidecar restarted, a bridge that dropped for an hour), and short
 * enough that the day between two nights always does. Getting it wrong on
 * the short side understates elapsed time on a guardrail that governs a hard
 * stop, so it errs long.
 */
export const SESSION_GAP_MS = 6 * 60 * 60 * 1000

/**
 * How a `get_view_state` request failed, while `get_status` answered.
 *
 * - `relayed`: the sidecar answered with the tool's own failure (on this
 *   scope, usually its device timeout: the documented idle signature). The
 *   bridge answered; `detail` is the tool's message, verbatim.
 * - `no-answer`: the request got no answer from the sidecar at all (this
 *   client's timeout, or it never connected). That is not the scope
 *   reporting anything. `detail` is the client's `brief`, without the
 *   "make sure the sidecar is running" advice, which get_status answering
 *   has just disproved.
 */
export interface ViewFailure {
  kind: 'relayed' | 'no-answer'
  detail: string
}

export function viewFailure(cause: unknown): ViewFailure {
  if (cause instanceof NoAnswerError) return { kind: 'no-answer', detail: cause.brief }
  return { kind: 'relayed', detail: errorMessage(cause) }
}

/** The failure as a clause, worded true to its cause: "get_view_state
 * reported a failure (…)" or "get_view_state got no answer (…)". */
export function describeViewFailure(failure: ViewFailure): string {
  return failure.kind === 'relayed'
    ? `get_view_state reported a failure (${failure.detail})`
    : `get_view_state got no answer (${failure.detail})`
}

export type LiveSessionState =
  | { phase: 'loading' }
  | {
      phase: 'bridge-down'
      error: string
      /** Whether `get_run_state` — a file read on the server, which can
       * still answer while the scope link is down — reports an active run,
       * and on what. The screen must not contradict it, and without it
       * cannot say whether any session is running at all. */
      runActive: boolean
      runTarget: string | null
      sessionActivity: SessionActivity | null
    }
  | {
      phase: 'idle'
      /** How the scope said so. `null`: `get_view_state` answered and
       * reported no view session (`result: {}`, the commonest real idle).
       * Otherwise `get_view_state` failed while `get_status` still answered;
       * see ViewFailure for the two ways, which the screen must word
       * differently. */
      viewError: ViewFailure | null
      sessionActivity: SessionActivity | null
    }
  | {
      /** `get_view_state` answered, but in a shape the schema rejects. The
       * scope is talking; this client cannot read it, so it cannot say
       * whether a session is running — and must not guess "idle", which is
       * exactly the misreport this used to produce on hardware. */
      phase: 'unrecognised'
      /** The parse failure, verbatim, so the mismatch is diagnosable from
       * the screen. */
      detail: string
      sessionActivity: SessionActivity | null
    }
  | {
      /** `get_run_state` says a skill-driven run is active, but the scope
       * reports no view session (or `get_view_state` failed). Between
       * targets, or a view that stopped: either way not "idle", which is
       * the confident wrong answer run_state exists to prevent. */
      phase: 'run-without-view'
      /** `run.target` from run_state — the string passed to goto_target. */
      runTarget: string | null
      /** As on `idle`: `null` for "answered, no View", else the failure. */
      viewError: ViewFailure | null
      sessionActivity: SessionActivity | null
    }
  | {
      phase: 'active'
      /** `null` for a reading taken on this poll. Otherwise this poll could
       * not read the scope (a failed or unreadable `get_view_state`, or the
       * bridge down), and every field below is the last good reading, held
       * rather than thrown away: one bad poll does not end a session. The
       * string says what went wrong, for the screen to show. */
      stale: string | null
      /** When the reading below was taken, by this client's clock (ISO). */
      readAt: string
      viewState: ViewState
      /** Each is `null` independently on its own fetch failure — a session
       * being active is anchored on `viewState` alone, so a guardrails or
       * observability hiccup degrades only its own card, not the screen. */
      guardrails: Guardrails | null
      tier1: Tier1 | null
      focuser: FocuserPosition | null
      observability: TargetObservability | null
      preview: LivePreview | null
      /** The previous session's stacked master for the current target — see
       * LastStackCard's own doc comment for the whole honesty rule this
       * carries. Fetched only when `currentTarget` actually changes, never
       * on the ordinary 60 s poll cadence (see `shouldFetchLastStack` and
       * this hook's own doc comment on why: it is a ~730 KB full-resolution
       * JPEG, not a cheap telemetry field). `null` covers "no target
       * resolved yet" and "the fetch failed", same soft-fail convention as
       * `guardrails`/`tier1`/`focuser` above — a response with `target:
       * null` inside is the distinct, normal "nothing completed yet for
       * this target" state, not this. */
      lastStack: LastStack | null
      /** Not gated on `viewState`/`status` the way the rest of this state is
       * — `session_activity` reads a local file on the sidecar's own disk,
       * unrelated to whether the MCP bridge is up or the scope is
       * observing. It is fetched every poll regardless of phase (see
       * `poll()` below) and carried on `idle`/`bridge-down` too, at the
       * user's explicit request: most of the time this screen is open
       * nothing is running, and "what did the agent do while I wasn't
       * watching" is a real question worth answering even then. Its own
       * absent state (route not deployed yet, or a fetch hiccup) is
       * independent of everything else here. See SessionActivityCard. */
      sessionActivity: SessionActivity | null
      log: TelemetryEntry[]
      /** The scope's real session start — `get_run_state`'s
       * `run.session_start_utc` — and ONLY while that run is `active`.
       * `null` otherwise, including when the guardrail check is running on
       * the "since this tab first looked" fallback: that is not a start and
       * must not be displayed as one (see TargetHeader). */
      sessionStartUtc: string | null
      /** Every distinct `stage` value observed this mount, in order,
       * de-duplicating only consecutive repeats — "3PPA → AutoGoto → Stack"
       * (design README.md:460). A recorded history of what the server
       * already reported, not a derived state machine. */
      stageHistory: string[]
      /** The catalogue id (e.g. "M27") this client is currently treating as
       * "the target being imaged".
       *
       * Sourced from `get_view_state`'s own `View.target_name` first, and
       * only then from live_preview's `target`. That order matters and was
       * wrong until 2026-08-08: this used to read the preview ALONE, on the
       * stated premise that "get_view_state carries no target name at all".
       * That premise was false — `ViewSchema.target_name` has been in this
       * file's own schema the whole time, and the sidecar already reads it
       * (`live_preview.extract_target_name`) to scope the share scan.
       *
       * The consequence was live: when the SMB share dropped mid-session the
       * screen showed "Target unknown" while `get_view_state` — still
       * answering, still reporting 1075 stacked frames — knew perfectly well
       * it was on M13. The target name must not depend on a file share.
       *
       * view_state wins over the preview because it is the scope's own report
       * of what it is pointed at now, whereas the preview's target comes from
       * the newest file on the share, which lags and can name a previous
       * session's object. Still held sticky across a poll where both are
       * momentarily absent. `null` before either has ever named one. */
      currentTarget: string | null
    }

/**
 * The idle/bridge-down distinction is read from *which* call fails, not from
 * matching error text — `get_view_state` only answers during an active
 * session and is documented to time out otherwise (slice-3 spec §4: "native
 * state methods time out on an idle scope"), while `get_status` answers
 * whenever the link is up at all. This avoids parsing the server's error
 * prose to classify a failure, the same reason this project never parses
 * `reasons[]` to recover a value a tool declined to return as a field.
 *
 * ## Order matters, and it used to be the wrong way round
 *
 * `get_status` is **not cheap**: it fans out to five separate Alpaca property
 * reads (`connected`, `rightascension`, `declination`, `tracking`,
 * `slewing`), which seestar-mcp measured and we confirmed. `get_view_state`
 * is one.
 *
 * This hook used to call `get_status` first, every tick, and `get_view_state`
 * second. That is backwards. **Nothing in this client ever renders a
 * `get_status` field** — checked across every component; the payload was
 * fetched, stored on the active state, and read by nobody. Its only real job
 * is as a liveness probe: we use the fact that it *answered*.
 *
 * And on an active tick, `get_view_state` answering has already proved the
 * link is up. So the five-request check was pure redundancy on exactly the
 * ticks where the control link is most contended — the opposite of
 * seestar-mcp's own "ease off the device-touching tools while stacking".
 *
 * Inverted:
 *
 *   view_state OK, View present    → active. Bridge proved up; get_status
 *                                    never called.        1 request
 *   view_state OK, no View         → idle. Same proof;    1 request
 *                                    get_status skipped
 *   view_state unparseable         → unrecognised. The    1 request
 *                                    sidecar answered;
 *                                    never read as idle
 *   view_state fails, status OK    → idle                 6 requests
 *   view_state fails, status fails → bridge-down          6 requests
 *
 * Both "idle" rows become `run-without-view` instead when get_run_state says
 * a run is active: never "Scope idle" over a run that is on.
 *
 * And while a session is open and on screen, a failed row (unparseable,
 * view_state fails, bridge-down) keeps it there instead, as `active` with
 * `stale` set, for up to FAILED_POLLS_LIMIT - 1 failures in a row: one failed
 * read is not evidence the session ended. Only the "no View" row and a
 * relayed view_state failure count towards ending one — see endSession for
 * the full list.
 *
 * "Answered" is not "observing": a connected scope with no view session
 * returns `result: {}`, which parses. Treating any successful fetch as
 * active once put a green live dot over a parked scope.
 *
 * An active tick drops from 6 device requests to 1. The idle path is
 * unchanged in cost and already behind the back-off below, so it pays the
 * six only once every five polls.
 *
 * `status` is deliberately no longer carried on the active state. Keeping a
 * field nothing renders invites someone to render a stale one later, and on
 * the active path it is now never fetched at all — the honest shape is its
 * absence. If a screen ever needs pointing or tracking, fetch it then and
 * see the note below first.
 *
 * **Do not "optimise" this by substituting a native call for the fan-out.**
 * seestar-mcp verified against live hardware that it does not collapse:
 * pointing does (`scope_get_equ_coord` matches Alpaca to ~5 arcsec of
 * sidereal drift), but `tracking` does not — the Alpaca property and the
 * firmware's `mount.tracking` flag report *opposite* values on an
 * idle-but-tracking-enabled scope, and `connected` (link up) is not
 * `is_verified` (RSA auth passed). Three attempts at that collapse were
 * wrong; only the measurement settled it.
 *
 * ## `get_run_state`, and why the device calls are now conditional
 *
 * seestar-mcp shipped `get_run_state` (d555c4b) after we argued that
 * inferring "is a run in progress" from a `get_view_state` timeout produces a
 * confident wrong answer in the worst direction. It reads a JSON file and
 * makes **no Alpaca call**, so unlike everything else here it costs the
 * bridge nothing. Two things follow.
 *
 * **1. The session start is real now.** `run.session_start_utc` is the
 * scope's own start, not the moment this tab opened. See
 * `sessionStartedAtRef` below for what still happens when it is absent.
 *
 * **2. The idle path stops hammering a parked scope.** Our own measurement,
 * handed to seestar-mcp and still owed as a fix: this hook polled
 * `get_status` (5 bridge requests) + `get_view_state` (1) every 60 s against
 * a parked scope, indefinitely — ~6 requests a minute all night for a mount
 * that was doing nothing. The device calls are now gated on the free file
 * read.
 *
 * The gate is deliberately not "skip the device entirely while idle".
 * `run_state.json` is written by seestar-mcp's own skills during an
 * orchestrated run, so a scope driven by hand from the phone app produces no
 * file at all — `idle` means "no skill-driven run", which is not the same as
 * "nothing is happening". Reading it as the latter would reintroduce the
 * confident-wrong-answer in a new place. So:
 *
 *   state 'active'  → device check every poll (a run is definitely on)
 *   state 'unknown' → device check every poll (a stale stamp must never read
 *                     as free; the writer may have died mid-run)
 *   state 'idle'    → device check on the FIRST poll, then every
 *                     IDLE_DEVICE_CHECK_EVERY-th, so a hand-driven session is
 *                     still noticed within a few minutes — and every poll
 *                     while a session is open (from the first View until
 *                     the session ends, or FAILED_POLLS_LIMIT failures in a
 *                     row), since `idle` cannot see a hand-driven session
 *                     at all
 *   run_state fails → device check every poll (fail open — never let a
 *                     missing optimisation hide a live session)
 *
 * The first poll always checks, so opening the screen mid-session shows it
 * immediately; the back-off only accrues while nothing is happening.
 *
 * `check_night_guardrails` needs a `session_start_utc`. When `get_run_state`
 * gives one, that is the scope's real start. When it does not — an older
 * server, a hand-driven session, an unparseable file — this hook still falls
 * back to the moment IT first observed the session, which understates
 * elapsed time for a dashboard opened mid-session and overstates the
 * max-duration and dawn-margin figures the guardrail returns. Narrower than
 * it was, not gone.
 *
 * `session_activity` is kicked off once per poll, before the status/
 * view_state branching below, and awaited on whichever exit path the poll
 * actually takes — it is the one fetch in this hook that does not care what
 * phase the scope is in.
 */
export function useLiveSession(): LiveSessionState {
  const [state, setState] = useState<LiveSessionState>({ phase: 'loading' })
  // Persists across polls without forcing a re-render on its own — folded
  // into `state` only once a fresh poll actually arrives.
  const logRef = useRef<TelemetryEntry[]>([])
  const stageHistoryRef = useRef<string[]>([])
  const currentTargetRef = useRef<string | null>(null)
  const sessionStartedAtRef = useRef<string | null>(null)
  // Consecutive polls reporting idle, counting the current one. Reset by any
  // non-idle run_state answer AND by any poll where the device reports a
  // View, so a session (skill-driven or by hand) gets full cadence.
  const idleTicksRef = useRef(0)
  // Carries the last_stack result forward across polls where the target
  // hasn't changed, alongside which target it was actually fetched for —
  // see shouldFetchLastStack's own doc comment for why this is gated on the
  // target changing, not the poll interval.
  const lastStackRef = useRef<LastStack | null>(null)
  const lastStackTargetRef = useRef<string | null>(null)
  // What decides when a session ends — see endSession below.
  // The current run of idle-looking polls: explicit "no View" answers and
  // relayed get_view_state failures, and whether every one was explicit.
  // Other failures carry no answer either way, so they neither count nor
  // break the run; a View resets it.
  const idleRunRef = useRef({ length: 0, explicitOnly: true })
  // Consecutive polls that failed to read the scope, of any kind. Reset by
  // any answer from the device (a View, or an explicit no-View).
  const failStreakRef = useRef(0)
  // The last state get_run_state actually reported (a failed fetch is not
  // an answer), and whether it has gone from active to idle/unknown since
  // the device last showed a View.
  const lastRunStateRef = useRef<RunState['state'] | null>(null)
  const runEndedRef = useRef(false)
  // The target_name the session's own Views have reported. Only the View's
  // name, never the preview's: the share lags and can name a previous
  // session's object, which would end a session that never changed target.
  const sessionViewTargetRef = useRef<string | null>(null)
  // Date.now() of the last poll that saw a View; see SESSION_GAP_MS.
  const lastViewAtRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // Aborted on cleanup, so every request this effect started is cancelled
    // with it (see the cleanup below).
    const controller = new AbortController()
    const opts = { signal: controller.signal }

    /**
     * Forget everything this hook remembers about "the session". These refs
     * are sticky within a session on purpose; left uncleared, a tab open
     * into the next night measured check_night_guardrails' elapsed time from
     * yesterday's start (a false `park_and_stop — Session duration 24.3h`),
     * and carried yesterday's target, stage breadcrumb, telemetry log and
     * last-stack panel into tonight's session.
     *
     * But clearing them too eagerly is the worse error. This used to run on
     * the first poll that saw no View and on every bridge-down, so one
     * transient get_view_state failure restarted the guardrail clock from
     * "now" mid-session — understating elapsed time on a guardrail that
     * governs a hard stop. So a session ends only on evidence that it has:
     *
     *   - a run of idle-looking polls (while no skill-driven run is active):
     *     IDLE_ANSWERS_TO_END explicit "no View" answers, or
     *     FAILED_POLLS_LIMIT polls once any of them was a relayed
     *     get_view_state failure, the documented idle signature (see
     *     countIdleSign);
     *   - a View naming a different target from the session's own;
     *   - get_run_state going from active to idle/unknown, followed by an
     *     explicit no-View answer;
     *   - no View at all for SESSION_GAP_MS, whatever the polls said.
     *
     * Any other failed poll (the bridge down, a SchemaError, a request that
     * got no answer) never ends it by count: it is held and shown as stale,
     * and after FAILED_POLLS_LIMIT of them the failure itself is shown while
     * the session is still remembered, in case the scope comes back.
     */
    function endSession() {
      sessionStartedAtRef.current = null
      currentTargetRef.current = null
      stageHistoryRef.current = []
      logRef.current = []
      lastStackRef.current = null
      lastStackTargetRef.current = null
      idleRunRef.current = { length: 0, explicitOnly: true }
      runEndedRef.current = false
      sessionViewTargetRef.current = null
      lastViewAtRef.current = null
    }

    /** A session is open from the first View until endSession. */
    const sessionOpen = () => sessionStartedAtRef.current !== null

    /**
     * Whether the open session is still being held through failed reads:
     * shown as stale, with the device asked every poll. Only for the first
     * FAILED_POLLS_LIMIT - 1 failures in a row; past that, a failure is not
     * a blip, and holding it would keep a finished session on screen and the
     * back-off off for as long as the failures last.
     */
    const holdingSession = () => sessionOpen() && failStreakRef.current < FAILED_POLLS_LIMIT

    /**
     * This poll looked idle: an explicit no-View answer (`explicit`), or a
     * get_view_state failure relayed while get_status answered. One run
     * counts both, and ends the session at IDLE_ANSWERS_TO_END if every
     * poll in it was explicit, or at FAILED_POLLS_LIMIT once any was
     * relayed: a relayed failure is the documented idle signature, but also
     * what a bad moment on the device looks like, so it needs a longer run.
     * A run_state that has just gone from active to idle/unknown ends it on
     * the first explicit answer.
     */
    function countIdleSign(explicit: boolean) {
      const run = idleRunRef.current
      run.length += 1
      if (!explicit) run.explicitOnly = false
      const limit = run.explicitOnly ? IDLE_ANSWERS_TO_END : FAILED_POLLS_LIMIT
      if (run.length >= limit || (explicit && runEndedRef.current)) endSession()
    }

    /**
     * This poll could not read the scope. While the open session is being
     * held (see holdingSession) and on screen, keep showing it — marked
     * stale, with why — rather than a failure card that implies the session
     * is gone. Otherwise (no session, the screen already moved off it on an
     * idle answer, or too many failures in a row) show `fallback`. What
     * the session remembers is kept either way, until endSession.
     */
    function settleFailure(fallback: LiveSessionState, reason: string, sessionActivity: SessionActivity | null) {
      const hold = holdingSession()
      setState((prev) =>
        hold && prev.phase === 'active' ? { ...prev, stale: reason, sessionActivity } : fallback,
      )
    }

    /**
     * The bridge is up and the scope is not showing a view session. That is
     * idle — unless `get_run_state` says a skill-driven run is active, in
     * which case "Scope idle — not observing" would be the confident wrong
     * answer: the run may be between targets, or its view may have stopped.
     */
    function withoutView(
      runState: RunState | null,
      viewError: ViewFailure | null,
      sessionActivity: SessionActivity | null,
    ): LiveSessionState {
      if (runState?.state === 'active') {
        return {
          phase: 'run-without-view',
          runTarget: runState.run?.target ?? null,
          viewError,
          sessionActivity,
        }
      }
      return { phase: 'idle', viewError, sessionActivity }
    }

    async function poll() {
      // Kicked off immediately, independent of everything below — see this
      // hook's own doc comment.
      const sessionActivityPromise = fetchSessionActivity(SESSION_ACTIVITY_LIMIT, opts).catch(() => null)

      // Free — a file read server-side, no Alpaca call — so this runs every
      // poll regardless of phase and is what gates the expensive ones below.
      // Failure is not fatal and must not suppress the device check: a
      // missing optimisation is better than a hidden session.
      const runState = await fetchRunState(opts).catch(() => null)
      // After EVERY await, before any ref is touched: a poll whose effect
      // was cleaned up must leave no trace. StrictMode (main.tsx) mounts,
      // cleans up and re-mounts in dev, and the orphaned first poll used to
      // count its idle answer too — the real poll then saw idleTicks 2,
      // skipped the device, and the screen sat on its skeleton for ~5
      // minutes. The same orphan could stamp sessionStartedAtRef and
      // lastStackTargetRef for the live poll that follows.
      if (cancelled) return
      if (runState?.state === 'idle') {
        idleTicksRef.current += 1
      } else {
        idleTicksRef.current = 0
      }
      if (runState) {
        if (lastRunStateRef.current === 'active' && runState.state !== 'active') runEndedRef.current = true
        if (runState.state === 'active') runEndedRef.current = false
        lastRunStateRef.current = runState.state
      }
      if (lastViewAtRef.current !== null && Date.now() - lastViewAtRef.current > SESSION_GAP_MS) {
        endSession()
      }
      // While a session is being held the device is asked every poll,
      // whatever run_state says: a hand-driven session reads `idle` there
      // throughout, and the back-off would otherwise hold a stale reading, or
      // the answer that confirms the end, for up to five minutes. Once
      // FAILED_POLLS_LIMIT polls in a row have failed, the ordinary back-off
      // applies again (see holdingSession).
      if (!holdingSession() && !shouldCheckDevice(runState?.state ?? null, idleTicksRef.current)) {
        const sessionActivity = await sessionActivityPromise
        // Deliberately keeps the previous phase rather than asserting 'idle':
        // this branch did not ask the scope anything, so it has learned
        // nothing new about it. Claiming idle here would be inventing an
        // observation we skipped making.
        if (!cancelled && sessionActivity) {
          setState((prev) => (prev.phase === 'idle' ? { ...prev, sessionActivity } : prev))
        }
        return
      }

      // `get_view_state` FIRST, and `get_status` only if it fails — see this
      // hook's doc comment. A successful view_state has already proved the
      // bridge is up, so the 5-request connection check is redundant on
      // exactly the ticks where the control link is busiest.
      let viewState: ViewState
      try {
        viewState = await fetchViewState(opts)
      } catch (viewCause) {
        if (cancelled) return
        // Every branch below is a failed read. Only a relayed get_view_state
        // failure counts towards ending the session (see countIdleSign); an
        // open one is otherwise held and shown as stale, for a while.
        failStreakRef.current += 1
        //
        // Answered, unreadably. Not a session we can see, not an idle scope
        // we can vouch for, and not a bridge problem — the sidecar just
        // answered, so get_status would prove nothing. Say what happened.
        if (viewCause instanceof SchemaError) {
          const sessionActivity = await sessionActivityPromise
          if (cancelled) return
          settleFailure(
            { phase: 'unrecognised', detail: viewCause.message, sessionActivity },
            `get_view_state answered in a shape this dashboard doesn't understand (${viewCause.message})`,
            sessionActivity,
          )
          return
        }
        // No View read. Now — and only now — spend the 5 requests to tell
        // "idle" from "the bridge is gone", which is the one question
        // get_status is actually here to answer.
        try {
          await fetchStatus(opts)
        } catch (cause) {
          const sessionActivity = await sessionActivityPromise
          if (cancelled) return
          const runActive = runState?.state === 'active'
          settleFailure(
            {
              phase: 'bridge-down',
              error: errorMessage(cause),
              runActive,
              runTarget: runActive ? (runState?.run?.target ?? null) : null,
              sessionActivity,
            },
            `the bridge did not answer (${errorMessage(cause)})`,
            sessionActivity,
          )
          return
        }
        const sessionActivity = await sessionActivityPromise
        if (cancelled) return
        const failure = viewFailure(viewCause)
        // The tool itself said get_view_state failed while get_status
        // answered: the documented idle signature, so it counts towards
        // ending the session — as an explicit answer does, and likewise not
        // while a skill-driven run is active. A request that got no answer
        // at all says nothing about the scope, and does not count.
        if (failure.kind === 'relayed' && runState?.state !== 'active') countIdleSign(false)
        settleFailure(withoutView(runState, failure, sessionActivity), describeViewFailure(failure), sessionActivity)
        return
      }

      // Answering is not observing. A connected scope with no view session
      // returns `result: {}` — it parses, and it used to count as "active":
      // a green live dot, "Stacking", a column of dashes and a guardrails
      // fetch for a session that did not exist, while the sidecar's
      // live_preview, given no View to scope by, scanned the whole share and
      // named an old target. No View is idle (unless a run is active — see
      // withoutView). The bridge has just answered, so get_status would
      // only re-prove it: skipped.
      const view = viewState.view_state?.result?.View
      if (view == null) {
        const sessionActivity = await sessionActivityPromise
        if (cancelled) return
        // The device answered, so no failure streak; and an explicit answer
        // counts towards ending the session — but not while a skill-driven
        // run is active: that run is still the session, between targets or
        // not.
        failStreakRef.current = 0
        if (runState?.state !== 'active') countIdleSign(true)
        setState(withoutView(runState, null, sessionActivity))
        return
      }
      if (cancelled) return

      // A View, so no idle run and no failure streak, and a run that ended
      // while the device still showed one has been outlived by the session:
      // from here the ordinary idle-run rule applies. A View naming a
      // different target is a different session.
      idleRunRef.current = { length: 0, explicitOnly: true }
      failStreakRef.current = 0
      runEndedRef.current = false
      if (view.target_name) {
        if (sessionViewTargetRef.current !== null && view.target_name !== sessionViewTargetRef.current) {
          endSession()
        }
        sessionViewTargetRef.current = view.target_name
      }
      lastViewAtRef.current = Date.now()

      // The device itself says it is observing, which outranks run_state's
      // `idle`: that only means "no skill-driven run", and a session started
      // by hand from the phone app reads idle on every poll. Counting those
      // answers put polls 2-5 of a live hand-driven session behind the
      // back-off: stack count, preview, guardrails and log froze for ~4
      // minutes, and the session's end went unnoticed for up to 5. Full
      // cadence for as long as the session is open; the back-off resumes
      // once it has ended.
      idleTicksRef.current = 0

      // The scope's own start when the server can tell us, and only then the
      // "since I started watching" fallback. Handback item 20: the guardrail
      // this feeds governs a hard stop, so understating elapsed time is the
      // dangerous direction — a dashboard opened three hours into a session
      // used to report the session as three hours younger than it was.
      // ONLY when the run is `active`. `unknown` retains a stale `run`
      // record by design — a stamp too old to vouch for, with the previous
      // run's fields still attached — so taking session_start_utc from it
      // feeds an abandoned session's start time into check_night_guardrails,
      // which governs a hard stop. That is the exact misuse we warned
      // seestar-mcp about ("a consumer treating run's presence as proof of a
      // live session would be wrong") and then committed here ourselves.
      const realStart =
        runState?.state === 'active' ? (runState.run?.session_start_utc ?? null) : null
      if (realStart !== null) {
        sessionStartedAtRef.current = realStart
      } else if (sessionStartedAtRef.current === null) {
        sessionStartedAtRef.current = new Date().toISOString()
      }
      // Read once into a local: the ref is non-null by the block above, but
      // it is a mutable field and narrowing it across the awaits below would
      // not be sound anyway.
      const sessionStart = sessionStartedAtRef.current ?? new Date().toISOString()

      const [guardrails, tier1, focuser, preview, sessionActivity] = await Promise.all([
        fetchGuardrails(sessionStart, opts).catch(() => null),
        fetchTier1(opts).catch(() => null),
        fetchFocuserPosition(opts).catch(() => null),
        fetchLivePreview(opts).catch(() => null),
        sessionActivityPromise,
      ])
      if (cancelled) return

      // The scope's own answer first, the share's second. See currentTarget's
      // doc comment: reading the preview alone meant an unreachable share
      // erased the target name from a session that was visibly still running.
      // Held sticky across a poll where both are momentarily absent, rather
      // than blanking the sweet-band card.
      const namedTarget = view.target_name ?? preview?.target
      if (namedTarget) currentTargetRef.current = namedTarget
      const target = currentTargetRef.current
      const observability = target
        ? await fetchTargetObservability(target, opts).catch(() => null)
        : null
      if (cancelled) return

      // Target-gated, not poll-gated — see shouldFetchLastStack's own doc
      // comment. A poll where the target hasn't changed reuses whatever is
      // already in lastStackRef rather than re-requesting a ~730 KB image.
      // The target is recorded as done only once the answer settles it (see
      // lastStackIsSettled); a transient failure is shown this poll and
      // asked again the next.
      if (target !== null && shouldFetchLastStack(target, lastStackTargetRef.current)) {
        const lastStack = await fetchLastStack(target, opts).catch(() => null)
        if (cancelled) return
        lastStackRef.current = lastStack
        if (lastStackIsSettled(lastStack)) lastStackTargetRef.current = target
      }

      if (tier1) logRef.current = appendTelemetryEntry(logRef.current, tier1)
      const stage = view.stage
      if (stage && stageHistoryRef.current[stageHistoryRef.current.length - 1] !== stage) {
        stageHistoryRef.current = [...stageHistoryRef.current, stage]
      }
      setState({
        phase: 'active',
        stale: null,
        readAt: new Date().toISOString(),
        viewState,
        guardrails,
        tier1,
        focuser,
        observability,
        preview,
        lastStack: lastStackRef.current,
        sessionActivity,
        log: logRef.current,
        sessionStartUtc: realStart,
        stageHistory: stageHistoryRef.current,
        currentTarget: currentTargetRef.current,
      })
    }

    // The next poll is scheduled one interval after this one SETTLES, not
    // on a fixed setInterval. setInterval fired whether or not the previous
    // poll had finished, and the sidecar serialises MCP calls, so slow polls
    // stacked up behind each other and interleaved their writes to the same
    // refs. Every request is bounded by the client's REQUEST_TIMEOUT_MS, so
    // a poll always settles.
    async function loop() {
      try {
        await poll()
      } catch {
        // poll() soft-fails every fetch itself; this only guards the loop
        // against an unexpected throw ending the polling for the tab's life.
      }
      if (!cancelled) timer = setTimeout(loop, POLL_INTERVAL_MS)
    }

    loop()
    return () => {
      cancelled = true
      clearTimeout(timer)
      // In-flight requests are abandoned, not merely ignored: the sidecar
      // should not keep queueing work for a screen nobody is looking at.
      controller.abort()
    }
  }, [])

  return state
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
