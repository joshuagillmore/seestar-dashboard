import type { FocuserPosition, StackState, Tier1 } from '../../api/schemas'

/**
 * Formatting helpers for the six-cell telemetry grid. `qa_tier1`'s own
 * `trends` already computes the per-poll deltas the grid shows (stacked/
 * rejected/focus) — an earlier version of this module diffed polls itself
 * before that shape was confirmed (see schemas.ts's live-session doc
 * comment). This file keeps only what has no server-computed equivalent: a
 * dropped-frame percentage (plain arithmetic, not a judgement about *why*),
 * the stage-history breadcrumb (a client-side recording of what the server
 * already reported), and rendering `Annotate.state`.
 */

/** What fraction of frames captured this session were dropped/rejected, as
 * a percentage — plain arithmetic over two counts the server already
 * returned. Deliberately does not reproduce the design's "rotation
 * trailing" cause: this client has no field naming *why* frames dropped,
 * and guessing one would be exactly the kind of derived assessment this
 * project avoids (VerdictBanner's headline, the QA verdict banner, …). */
export function droppedPct(kept: number | null, dropped: number | null): number | null {
  if (kept == null || dropped == null) return null
  const total = kept + dropped
  if (total <= 0) return null
  return (dropped / total) * 100
}

/** "3PPA → AutoGoto → Stack ✓" — every distinct stage this mount has
 * observed, in order, with a checkmark on the current (last) one. Caps at
 * the 4 most recent so a long session's history can't grow the header
 * unbounded; the cap only ever trims the OLDEST stages, never the current
 * one. */
const MAX_STAGES_SHOWN = 4

export function formatStageHistory(history: string[]): string {
  if (history.length === 0) return '—'
  const shown = history.slice(-MAX_STAGES_SHOWN)
  return shown.map((stage, i) => (i === shown.length - 1 ? `${stage} ✓` : stage)).join(' → ')
}

/** `Annotate.state` is a string in the one confirmed fixture (`"complete"`)
 * — other values (pending, failed) are not yet observed. Rendered verbatim
 * rather than mapped to a fixed vocabulary this client hasn't confirmed. */
export function formatAnnotateState(state: string | null | undefined): string {
  return state ?? '—'
}

/** The only value this client currently treats as a confirmed "solved OK"
 * signal, for the PLATE SOLVE cell's tone — see formatAnnotateState's own
 * doc comment on why nothing else is asserted as a failure state. */
export const ANNOTATE_STATE_OK = 'complete'

/** Minutes of integration kept so far: stacked frames × the sub exposure
 * the scope reports running (`View.Stack.Exposure.exp_ms`). Plain
 * arithmetic over two figures the scope returned, not a judgement. `null`,
 * never 0, when either is missing. */
export function integrationMinutes(stacked: number | null, exposureMs: number | null): number | null {
  if (stacked == null || exposureMs == null) return null
  return (stacked * exposureMs) / 60_000
}

/** `10000` → "10 s", `2500` → "2.5 s". */
export function formatExposure(exposureMs: number): string {
  const seconds = Math.round((exposureMs / 1000) * 10) / 10
  return `${seconds} s`
}

/**
 * "single 10 s sub" / "single sub" — the caption a `source: "sub"` preview
 * frame carries, shared by PreviewCard and MobileLiveView. The length comes
 * from the scope's running exposure; it used to be a hardcoded "10 s".
 *
 * No length for a STALE frame: it can be from an earlier session, whose
 * sub length the current exposure says nothing about.
 */
export function singleSubLabel(exposureMs: number | null | undefined, stale: boolean): string {
  return exposureMs != null && !stale ? `single ${formatExposure(exposureMs)} sub` : 'single sub'
}

export interface TelemetryValues {
  stackedValue: number | null
  droppedValue: number | null
  droppedPctValue: number | null
  focusValue: number | null
  annotateState: string | null | undefined
  solveTone: 'pass' | undefined
  /** The running sub exposure, from `View.Stack.Exposure.exp_ms`. */
  exposureMs: number | null
  integrationMin: number | null
}

/**
 * The single derivation of "what do STACKED/DROPPED/FOCUS/PLATE SOLVE
 * actually read this poll" — shared by TelemetryGrid (desktop's six-cell
 * grid) and MobileLiveView (the three tiles field density leaves room for:
 * DROPS, FOCUS, PLATE SOLVE — see that component's own doc comment for why
 * ALT/BAND aren't among them). Pulling this out of TelemetryGrid means the
 * two compositions can render entirely different markup around these values
 * without risking the underlying numbers drifting apart.
 */
export function deriveTelemetryValues(
  stack: StackState | null,
  tier1: Tier1 | null,
  focuser: FocuserPosition | null,
): TelemetryValues {
  const snapshot = tier1?.snapshot
  const stackedValue = snapshot?.stacked ?? stack?.stacked_frame ?? null
  const droppedValue = snapshot?.rejected ?? stack?.dropped_frame ?? null
  const droppedPctValue = droppedPct(stackedValue, droppedValue)
  const focusValue = snapshot?.focus_pos ?? focuser?.focus_pos ?? null
  const annotateState = stack?.Annotate?.state
  const solveTone = annotateState === ANNOTATE_STATE_OK ? ('pass' as const) : undefined
  const exposureMs = stack?.Exposure?.exp_ms ?? null
  const integrationMin = integrationMinutes(stackedValue, exposureMs)

  return {
    stackedValue,
    droppedValue,
    droppedPctValue,
    focusValue,
    annotateState,
    solveTone,
    exposureMs,
    integrationMin,
  }
}
