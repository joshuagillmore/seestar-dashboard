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
