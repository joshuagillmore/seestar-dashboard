import type { Tier1 } from '../../api/schemas'
import { parse } from '../tonight/timeline'

/**
 * `qa_tier1` is a snapshot (design README.md:504: "Tier-1 is cheap health
 * polling"), not a pre-built log — the Telemetry log card is this client's
 * own rolling history of snapshots, one appended per poll. Never carries a
 * per-sub quality verdict; that is Tier-2's job, at wind-down only (see
 * schemas.ts's Tier1Schema doc comment).
 *
 * The real `qa_tier1` payload already computes both a ready-made line
 * (`status_line`, e.g. `"stacked 211 (+1) | rejected 0 | solve OK | focus
 * Δ=+3 | hfd 2.40"`) and structured deltas (`trends`) — an earlier version
 * of this module recomputed both client-side before that shape was
 * confirmed. Rendering `status_line` verbatim is both simpler and more
 * honest: the server is the one source of what counts as "the log line for
 * this poll", the same way this project never recomposes a QA verdict or a
 * conditions summary sentence.
 */
export interface TelemetryEntry {
  tier1: Tier1
}

/** Bounds a whole night's worth of one-per-poll entries (a 6 h session at
 * POLL_INTERVAL_MS's 60 s cadence is ~360 entries) without an unbounded
 * client-side array — the card itself only ever shows a scrolling 132px
 * window (slice-3 spec §7), this is just the memory retention behind it. */
export const MAX_LOG_ENTRIES = 500

export function appendTelemetryEntry(log: TelemetryEntry[], tier1: Tier1): TelemetryEntry[] {
  const next = [...log, { tier1 }]
  return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next
}

/** `MM:SS` elapsed since the first entry in the log, both times read from
 * the server's own `snapshot.ts` — a real telemetry timestamp, not a
 * client-side fetch time — matching the design's own worked example
 * (`[71:20]` down to `[64:20]`, each row one poll apart). */
export function formatElapsed(entry: TelemetryEntry, first: TelemetryEntry): string {
  // Uses the shared `parse`, not a bare `Date.parse`. `snapshot.ts` is
  // offset-bearing today, which bare Date.parse handles correctly — but the
  // server emits BOTH shapes (planning naive, projects/provenance
  // offset-bearing, confirmed by seestar-mcp 2026-08-01), and bare Date.parse
  // reads a naive string as LOCAL time, not UTC. That is silent and would show
  // as an elapsed counter wrong by the UTC offset. One normaliser, everywhere.
  const totalSeconds = Math.max(
    0,
    Math.round((parse(entry.tier1.snapshot.ts) - parse(first.tier1.snapshot.ts)) / 1000),
  )
  const mm = Math.floor(totalSeconds / 60)
  const ss = totalSeconds % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}
