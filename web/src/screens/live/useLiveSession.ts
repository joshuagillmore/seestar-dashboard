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
} from '../../api/client'
import type {
  FocuserPosition,
  Guardrails,
  LastStack,
  LivePreview,
  SessionActivity,
  TargetObservability,
  Tier1,
  ViewState,
} from '../../api/schemas'
import { appendTelemetryEntry, type TelemetryEntry } from './telemetryLog'
import { shouldFetchLastStack } from './lastStack'

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

export type LiveSessionState =
  | { phase: 'loading' }
  | { phase: 'bridge-down'; error: string; sessionActivity: SessionActivity | null }
  | {
      phase: 'idle'
      /** How the scope said so. `null`: `get_view_state` answered and
       * reported no view session (`result: {}`, the commonest real idle).
       * A string: `get_view_state` failed with this message while
       * `get_status` still answered — the documented idle-scope timeout. */
      viewError: string | null
      sessionActivity: SessionActivity | null
    }
  | {
      phase: 'active'
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
 *   view_state fails, status OK    → idle                 6 requests
 *   view_state fails, status fails → bridge-down          6 requests
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
 *                     still noticed within a few minutes
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
  // non-idle answer so a session start restores full cadence immediately.
  const idleTicksRef = useRef(0)
  // Carries the last_stack result forward across polls where the target
  // hasn't changed, alongside which target it was actually fetched for —
  // see shouldFetchLastStack's own doc comment for why this is gated on the
  // target changing, not the poll interval.
  const lastStackRef = useRef<LastStack | null>(null)
  const lastStackTargetRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    /**
     * Forget everything this hook remembers about "the session". Called on
     * every poll that establishes there is no session (idle) or no way to
     * tell (bridge-down). These refs are sticky within a session on purpose,
     * and nothing else ever cleared them: a tab left open into the next
     * night measured check_night_guardrails' elapsed time from yesterday's
     * start (a false `park_and_stop — Session duration 24.3h`), and carried
     * yesterday's target, stage breadcrumb, telemetry log and last-stack
     * panel into tonight's session.
     */
    function endSession() {
      sessionStartedAtRef.current = null
      currentTargetRef.current = null
      stageHistoryRef.current = []
      logRef.current = []
      lastStackRef.current = null
      lastStackTargetRef.current = null
    }

    async function poll() {
      // Kicked off immediately, independent of everything below — see this
      // hook's own doc comment.
      const sessionActivityPromise = fetchSessionActivity(SESSION_ACTIVITY_LIMIT).catch(() => null)

      // Free — a file read server-side, no Alpaca call — so this runs every
      // poll regardless of phase and is what gates the expensive ones below.
      // Failure is not fatal and must not suppress the device check: a
      // missing optimisation is better than a hidden session.
      const runState = await fetchRunState().catch(() => null)
      if (runState?.state === 'idle') {
        idleTicksRef.current += 1
      } else {
        idleTicksRef.current = 0
      }
      if (!shouldCheckDevice(runState?.state ?? null, idleTicksRef.current)) {
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
        viewState = await fetchViewState()
      } catch (viewCause) {
        // No session. Now — and only now — spend the 5 requests to tell
        // "idle" from "the bridge is gone", which is the one question
        // get_status is actually here to answer.
        try {
          await fetchStatus()
        } catch (cause) {
          const sessionActivity = await sessionActivityPromise
          if (cancelled) return
          endSession()
          setState({ phase: 'bridge-down', error: errorMessage(cause), sessionActivity })
          return
        }
        const sessionActivity = await sessionActivityPromise
        if (cancelled) return
        endSession()
        setState({ phase: 'idle', viewError: errorMessage(viewCause), sessionActivity })
        return
      }

      // Answering is not observing. A connected scope with no view session
      // returns `result: {}` — it parses, and it used to count as "active":
      // a green live dot, "Stacking", a column of dashes and a guardrails
      // fetch for a session that did not exist, while the sidecar's
      // live_preview, given no View to scope by, scanned the whole share and
      // named an old target. No View is idle. The bridge has just answered,
      // so get_status would only re-prove it: skipped.
      const view = viewState.view_state?.result?.View
      if (view == null) {
        const sessionActivity = await sessionActivityPromise
        if (cancelled) return
        endSession()
        setState({ phase: 'idle', viewError: null, sessionActivity })
        return
      }

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
        fetchGuardrails(sessionStart).catch(() => null),
        fetchTier1().catch(() => null),
        fetchFocuserPosition().catch(() => null),
        fetchLivePreview().catch(() => null),
        sessionActivityPromise,
      ])

      // The scope's own answer first, the share's second. See currentTarget's
      // doc comment: reading the preview alone meant an unreachable share
      // erased the target name from a session that was visibly still running.
      // Held sticky across a poll where both are momentarily absent, rather
      // than blanking the sweet-band card.
      const namedTarget = view.target_name ?? preview?.target
      if (namedTarget) currentTargetRef.current = namedTarget
      const observability = currentTargetRef.current
        ? await fetchTargetObservability(currentTargetRef.current).catch(() => null)
        : null

      // Target-gated, not poll-gated — see shouldFetchLastStack's own doc
      // comment. A poll where the target hasn't changed reuses whatever is
      // already in lastStackRef rather than re-requesting a ~730 KB image.
      if (shouldFetchLastStack(currentTargetRef.current, lastStackTargetRef.current)) {
        lastStackTargetRef.current = currentTargetRef.current
        lastStackRef.current = currentTargetRef.current
          ? await fetchLastStack(currentTargetRef.current).catch(() => null)
          : null
      }

      if (cancelled) return
      if (tier1) logRef.current = appendTelemetryEntry(logRef.current, tier1)
      const stage = view.stage
      if (stage && stageHistoryRef.current[stageHistoryRef.current.length - 1] !== stage) {
        stageHistoryRef.current = [...stageHistoryRef.current, stage]
      }
      setState({
        phase: 'active',
        viewState,
        guardrails,
        tier1,
        focuser,
        observability,
        preview,
        lastStack: lastStackRef.current,
        sessionActivity,
        log: logRef.current,
        stageHistory: stageHistoryRef.current,
        currentTarget: currentTargetRef.current,
      })
    }

    poll()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return state
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
