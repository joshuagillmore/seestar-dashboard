import type { TelemetryEntry } from './telemetryLog'

/** Diff between the two most recent log entries' `stacked_frame` — the
 * grid's "+6 last poll" (design README.md:429). `null` with fewer than two
 * entries: there is nothing to diff against yet, not a fabricated `+0`. */
export function stackedDiff(log: TelemetryEntry[]): number | null {
  if (log.length < 2) return null
  const current = log[log.length - 1].tier1.stacked_frame
  const previous = log[log.length - 2].tier1.stacked_frame
  if (current == null || previous == null) return null
  return current - previous
}

/** What fraction of frames captured this session were dropped, as a
 * percentage — plain arithmetic over two counts the server already
 * returned, not a judgement about *why* (see this module's own doc comment
 * in TelemetryGrid.tsx for why "rotation trailing" is not reproduced here:
 * this client has no field naming a cause, and inventing one would be
 * exactly the kind of derived assessment this project avoids). */
export function droppedPct(stackedFrame: number | null, droppedFrame: number | null): number | null {
  if (stackedFrame == null || droppedFrame == null) return null
  const total = stackedFrame + droppedFrame
  if (total <= 0) return null
  return (droppedFrame / total) * 100
}

/** Delta from the first focuser reading seen this mount (the "baseline") to
 * the current one — bookkeeping, not a judgement about whether refocusing
 * is warranted. */
export function focusDelta(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null) return null
  return current - baseline
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

/** `Annotate.state`'s real type is not yet confirmed (see schemas.ts) — this
 * accepts whatever the server actually sends and renders a stable label
 * either way, rather than the UI guessing a boolean/string convention and
 * being wrong for every real payload. */
export function formatAnnotateState(state: boolean | string | null | undefined): string {
  if (state === null || state === undefined) return '—'
  if (typeof state === 'boolean') return state ? 'OK' : 'FAILED'
  return state
}
