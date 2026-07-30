import { useEffect, useRef, useState } from 'react'
import {
  fetchFocuserPosition,
  fetchGuardrails,
  fetchLivePreview,
  fetchStatus,
  fetchTargetObservability,
  fetchTier1,
  fetchViewState,
} from '../../api/client'
import type {
  FocuserPosition,
  Guardrails,
  LivePreview,
  Status,
  TargetObservability,
  Tier1,
  ViewState,
} from '../../api/schemas'
import { appendTelemetryEntry, type TelemetryEntry } from './telemetryLog'

/**
 * How often the screen re-checks scope/session state and re-polls the
 * preview and telemetry. Deliberately slow, per the slice-3 spec's own D2
 * ruling — "slow by default, and configurable" — and matches the cadence
 * the design's own telemetry-log example implies (each row is exactly one
 * poll apart; see telemetryLog.ts's formatElapsed). There is no settings UI
 * yet, so "configurable" today means "change this one constant."
 */
export const POLL_INTERVAL_MS = 60_000

export type LiveSessionState =
  | { phase: 'loading' }
  | { phase: 'bridge-down'; error: string }
  | { phase: 'idle' }
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
      log: TelemetryEntry[]
      /** First focuser reading seen this mount — bookkeeping for the
       * telemetry grid's "baseline 1642 · Δ+3" (design README.md:433), the
       * same class of client-side arithmetic as the elapsed-time clock: it
       * records what was already observed, it does not judge it. `null`
       * until a focuser reading has actually arrived. */
      focuserBaseline: number | null
      /** Every distinct `stage` value observed this mount, in order,
       * de-duplicating only consecutive repeats — "3PPA → AutoGoto → Stack"
       * (design README.md:434). A recorded history of what the server
       * already reported, not a derived state machine. */
      stageHistory: string[]
    }

/**
 * The idle/bridge-down distinction is read from *which* call fails, not from
 * matching error text — `get_status` is a cheap, always-answerable
 * connection check (CLAUDE.md's read-only table), while `get_view_state`
 * only answers during an active session and is documented to time out
 * otherwise (slice-3 spec §4: "native state methods time out on an idle
 * scope"). So:
 *
 *   get_status fails            → bridge-down (the connection itself is gone)
 *   get_status OK, view_state fails → idle (nothing wrong, nothing observing)
 *   both OK                     → active
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
 */
export function useLiveSession(): LiveSessionState {
  const [state, setState] = useState<LiveSessionState>({ phase: 'loading' })
  // Persists across polls without forcing a re-render on its own — folded
  // into `state` only once a fresh poll actually arrives.
  const logRef = useRef<TelemetryEntry[]>([])
  const focuserBaselineRef = useRef<number | null>(null)
  const stageHistoryRef = useRef<string[]>([])

  useEffect(() => {
    let cancelled = false

    async function poll() {
      let status: Status
      try {
        status = await fetchStatus()
      } catch (cause) {
        if (!cancelled) {
          setState({
            phase: 'bridge-down',
            error: cause instanceof Error ? cause.message : String(cause),
          })
        }
        return
      }

      let viewState: ViewState
      try {
        viewState = await fetchViewState()
      } catch {
        if (!cancelled) setState({ phase: 'idle' })
        return
      }

      const [guardrails, tier1, focuser, observability, preview] = await Promise.all([
        fetchGuardrails().catch(() => null),
        fetchTier1().catch(() => null),
        fetchFocuserPosition().catch(() => null),
        fetchTargetObservability().catch(() => null),
        fetchLivePreview().catch(() => null),
      ])

      if (cancelled) return
      if (tier1) logRef.current = appendTelemetryEntry(logRef.current, tier1)
      if (focuserBaselineRef.current === null && focuser?.position != null) {
        focuserBaselineRef.current = focuser.position
      }
      const stage = viewState.result?.View?.stage
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
        log: logRef.current,
        focuserBaseline: focuserBaselineRef.current,
        stageHistory: stageHistoryRef.current,
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
