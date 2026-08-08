import { formatElapsed, type TelemetryEntry } from './telemetryLog'
import styles from './TelemetryLogCard.module.css'

export interface TelemetryLogCardProps {
  log: TelemetryEntry[]
  /**
   * Mobile's "log tail" (design README.md:736) is a fixed-height list of the
   * most recent entries, not the desktop card's scrolling 132px window —
   * there's no room to scroll on a phone screen and the point of a tail is
   * "what just happened", not the whole history. Slices the newest-first
   * `rows` array down to this many; `undefined` (desktop's default) keeps
   * every entry, unchanged from before this prop existed.
   */
  limit?: number
  /**
   * Swaps the header for the design's compact mobile treatment — a bare
   * `TIER-1 TELEMETRY` micro-label, no "Quality verdict pending" caption —
   * rather than forking a second card. The per-sub-verdict rule itself
   * (`status_line`/`flags` only, never PASS/MARGINAL/REJECT) is unaffected by
   * this prop: it lives in what the server sends, not in this header.
   */
  compact?: boolean
}

/**
 * design README.md:489-502 (desktop) / :710 (mobile tail). Newest first. Each
 * line is `qa_tier1`'s own `status_line`, rendered verbatim — the server
 * already composes "stacked 211 (+1) | rejected 0 | solve OK | focus Δ=+3 |
 * hfd 2.40" from its own `snapshot`/`trends`, so this client does not
 * recompose or re-derive it (see telemetryLog.ts's own doc comment for why
 * an earlier version of this card did that arithmetic itself before the real
 * shape was confirmed). `flags`, when non-empty, is a real server-reported
 * health flag — rendered as-is, never invented.
 *
 * "Quality verdict pending — Tier-2 scores the FITS at wind-down" is the one
 * rule from the design that must survive verbatim on desktop: Tier-1 is cheap
 * health polling, and this card must never show a per-sub PASS/MARGINAL/
 * REJECT during the session — that's Tier-2, at wind-down only. `compact`
 * drops the caption itself (mobile has no room for it) but not the guarantee
 * behind it — nothing this component renders ever includes those words
 * regardless of `compact`.
 */
export function TelemetryLogCard({ log, limit, compact = false }: TelemetryLogCardProps) {
  const first = log[0] ?? null
  // Newest first for display, then capped to `limit` if the caller wants a
  // tail rather than the full history.
  const reversed = [...log].reverse()
  const rows = limit !== undefined ? reversed.slice(0, limit) : reversed

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        {compact ? (
          <span className={styles.eyebrow}>Tier-1 telemetry</span>
        ) : (
          <>
            <span className={styles.eyebrow}>qa_tier1 · health telemetry</span>
            <span className={styles.pending}>Quality verdict pending — Tier-2 scores the FITS at wind-down</span>
          </>
        )}
      </div>

      <div className={styles.body} data-testid="telemetry-log-body">
        {rows.length === 0 || first === null ? (
          <div className={styles.empty}>No health telemetry polled yet this session.</div>
        ) : (
          rows.map((entry, i) => (
            <div key={`${entry.tier1.snapshot.ts}-${i}`} className={styles.line} data-testid="telemetry-log-line">
              <span className={styles.bracket}>[{formatElapsed(entry, first)}]</span> {entry.tier1.status_line}
              {entry.tier1.flags.length > 0 && (
                <span className={styles.flags}> · {entry.tier1.flags.join(', ')}</span>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
