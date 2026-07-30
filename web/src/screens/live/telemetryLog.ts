import type { Tier1 } from '../../api/schemas'

/**
 * `qa_tier1` is a snapshot (design README.md:478: "Tier-1 is cheap health
 * polling"), not a pre-built log — the Telemetry log card is this client's
 * own rolling history of snapshots, one appended per poll. Never carries a
 * per-sub quality verdict; that is Tier-2's job, at wind-down only (see
 * schemas.ts's Tier1Schema doc comment).
 */
export interface TelemetryEntry {
  /** When this snapshot was taken (`Date.now()`), not anything the server
   * returns. */
  atMs: number
  tier1: Tier1
}

/** Bounds a whole night's worth of one-per-poll entries (a 6 h session at
 * POLL_INTERVAL_MS's 60 s cadence is ~360 entries) without an unbounded
 * client-side array — the card itself only ever shows a scrolling 132px
 * window (slice-3 spec §7), this is just the memory retention behind it. */
export const MAX_LOG_ENTRIES = 500

export function appendTelemetryEntry(log: TelemetryEntry[], tier1: Tier1): TelemetryEntry[] {
  const next = [...log, { atMs: Date.now(), tier1 }]
  return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next
}

/** `MM:SS` elapsed since the first entry in the log — not a wall clock, and
 * not tied to any server-supplied session-start time (get_view_state does
 * not confirm one yet). Newest-first rendering means this shrinks toward
 * `00:00` as you scroll down, matching the design's own worked example
 * (`[71:20]` down to `[64:20]`, each row exactly one poll apart). */
export function formatElapsed(atMs: number, firstAtMs: number): string {
  const totalSeconds = Math.max(0, Math.round((atMs - firstAtMs) / 1000))
  const mm = Math.floor(totalSeconds / 60)
  const ss = totalSeconds % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/** One rendered log line, e.g. `stacked 428 (+6) | dropped 23 | solve OK |
 * focus Δ=+3` — design README.md:468. Each clause is independent and
 * dropped (not padded with a placeholder) when its field is absent from this
 * entry, since Tier1Schema's fields are all individually optional pending
 * the real contract. Deltas (`+6`, `Δ=+3`) are plain arithmetic against the
 * previous entry's own value — bookkeeping like the elapsed clock, not a
 * derived assessment — and are omitted (not shown as `+0`) when there is no
 * previous entry to diff against. */
export function describeEntry(entry: TelemetryEntry, previous: TelemetryEntry | null): string {
  const { tier1 } = entry
  const parts: string[] = []

  if (tier1.stacked_frame !== null && tier1.stacked_frame !== undefined) {
    const prevStacked = previous?.tier1.stacked_frame
    const diff =
      prevStacked !== null && prevStacked !== undefined ? tier1.stacked_frame - prevStacked : null
    parts.push(`stacked ${tier1.stacked_frame}${diff !== null ? ` (${diff >= 0 ? '+' : ''}${diff})` : ''}`)
  }
  if (tier1.dropped_frame !== null && tier1.dropped_frame !== undefined) {
    parts.push(`dropped ${tier1.dropped_frame}`)
  }
  if (tier1.solve_ok !== null && tier1.solve_ok !== undefined) {
    parts.push(`solve ${tier1.solve_ok ? 'OK' : 'FAIL'}`)
  }
  if (tier1.focus_position !== null && tier1.focus_position !== undefined) {
    const prevFocus = previous?.tier1.focus_position
    if (prevFocus !== null && prevFocus !== undefined) {
      const diff = tier1.focus_position - prevFocus
      parts.push(`focus Δ=${diff >= 0 ? '+' : ''}${diff}`)
    } else {
      parts.push(`focus ${tier1.focus_position}`)
    }
  }

  return parts.join(' | ')
}
