import { useEffect, useRef, useState } from 'react'
import {
  fetchFocuserPosition,
  fetchGuardrails,
  fetchLastStack,
  fetchLivePreview,
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
  Status,
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

/** The activity column shows a compact recent tail, not the whole log —
 * matching the design's own scrolling operator panel rather than an
 * unbounded list. */
export const SESSION_ACTIVITY_LIMIT = 30

export type LiveSessionState =
  | { phase: 'loading' }
  | { phase: 'bridge-down'; error: string; sessionActivity: SessionActivity | null }
  | { phase: 'idle'; sessionActivity: SessionActivity | null }
  | {
      phase: 'active'
      viewState: ViewState
      status: Status
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
       * (design README.md:434). A recorded history of what the server
       * already reported, not a derived state machine. */
      stageHistory: string[]
      /** The catalogue id (e.g. "M27") this client is currently treating as
       * "the target being imaged" — sourced from live_preview's own `target`
       * field (see client.ts's `fetchTargetObservability` doc comment for
       * why: get_view_state carries no target name at all), and held sticky
       * across a poll where the preview temporarily has none. `null` before
       * any preview has ever named one. */
      currentTarget: string | null
    }

/**
 * The idle/bridge-down distinction is read from *which* call fails, not from
 * matching error text — `get_status` is a cheap, always-answerable
 * connection check (CLAUDE.md's read-only table), while `get_view_state`
 * only answers during an active session and is documented to time out
 * otherwise (slice-3 spec §4: "native state methods time out on an idle
 * scope"). So:
 *
 *   get_status fails                → bridge-down (the connection itself is gone)
 *   get_status OK, view_state fails → idle (nothing wrong, nothing observing)
 *   both OK                         → active
 *
 * This avoids parsing the server's error prose to classify a failure, the
 * same reason this project never parses `reasons[]` to recover a value a
 * tool declined to return as a field.
 *
 * Preview/telemetry fetches only happen once a session is confirmed active —
 * "never poll while idle" (D2) is specifically about there being no new
 * frame or telemetry to fetch, not about the bounded, slow-interval
 * get_status/get_view_state check above that is what notices a session
 * starting in the first place.
 *
 * `check_night_guardrails` needs a `session_start_utc` the tool surface has
 * no real source for (see client.ts's `fetchGuardrails`) — this hook records
 * the moment IT first observed the session as active and reuses that for
 * every guardrails call this mount. That is an honest "since I've been
 * watching" timestamp, not the scope's actual session start, so a dashboard
 * opened mid-session will understate elapsed time and overstate the
 * max-duration/dawn-margin figures `check_night_guardrails` returns. Real
 * limitation, not silently papered over — see the report this task hands
 * back with.
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
  // Carries the last_stack result forward across polls where the target
  // hasn't changed, alongside which target it was actually fetched for —
  // see shouldFetchLastStack's own doc comment for why this is gated on the
  // target changing, not the poll interval.
  const lastStackRef = useRef<LastStack | null>(null)
  const lastStackTargetRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      // Kicked off immediately, independent of everything below — see this
      // hook's own doc comment.
      const sessionActivityPromise = fetchSessionActivity(SESSION_ACTIVITY_LIMIT).catch(() => null)

      let status: Status
      try {
        status = await fetchStatus()
      } catch (cause) {
        const sessionActivity = await sessionActivityPromise
        if (!cancelled) {
          setState({
            phase: 'bridge-down',
            error: cause instanceof Error ? cause.message : String(cause),
            sessionActivity,
          })
        }
        return
      }

      let viewState: ViewState
      try {
        viewState = await fetchViewState()
      } catch {
        const sessionActivity = await sessionActivityPromise
        if (!cancelled) setState({ phase: 'idle', sessionActivity })
        return
      }

      if (sessionStartedAtRef.current === null) {
        sessionStartedAtRef.current = new Date().toISOString()
      }

      const [guardrails, tier1, focuser, preview, sessionActivity] = await Promise.all([
        fetchGuardrails(sessionStartedAtRef.current).catch(() => null),
        fetchTier1().catch(() => null),
        fetchFocuserPosition().catch(() => null),
        fetchLivePreview().catch(() => null),
        sessionActivityPromise,
      ])

      // Observability needs a target id, which only live_preview's own
      // `target` field confirms (see client.ts) — fetched only once that's
      // known, and held sticky across a poll where the preview briefly has
      // none (e.g. a momentary share hiccup), rather than blanking the
      // sweet-band card every time preview.target is absent.
      if (preview?.target) currentTargetRef.current = preview.target
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
      const stage = viewState.view_state?.result?.View?.stage
      if (stage && stageHistoryRef.current[stageHistoryRef.current.length - 1] !== stage) {
        stageHistoryRef.current = [...stageHistoryRef.current, stage]
      }
      setState({
        phase: 'active',
        viewState,
        status,
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
