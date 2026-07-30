import { describeEntry, formatElapsed, type TelemetryEntry } from './telemetryLog'
import styles from './TelemetryLogCard.module.css'

export interface TelemetryLogCardProps {
  log: TelemetryEntry[]
}

/**
 * design README.md:463-476. Newest first — see telemetryLog.ts for why each
 * line's elapsed bracket and its "+N"/"Δ=" deltas are plain arithmetic over
 * what qa_tier1 already returned, not a derived judgement.
 *
 * "Quality verdict pending — Tier-2 scores the FITS at wind-down" is the one
 * rule from the design that must survive verbatim: Tier-1 is cheap health
 * polling, and this card must never show a per-sub PASS/MARGINAL/REJECT
 * during the session — that's Tier-2, at wind-down only.
 */
export function TelemetryLogCard({ log }: TelemetryLogCardProps) {
  const firstAtMs = log[0]?.atMs ?? 0
  // Newest first for display; each line still diffs against the
  // chronologically previous entry, not the previous rendered row.
  const rows = [...log].reverse()

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>qa_tier1 · health telemetry</span>
        <span className={styles.pending}>Quality verdict pending — Tier-2 scores the FITS at wind-down</span>
      </div>

      <div className={styles.body} data-testid="telemetry-log-body">
        {rows.length === 0 ? (
          <div className={styles.empty}>No health telemetry polled yet this session.</div>
        ) : (
          rows.map((entry, i) => {
            // rows[i] is newest-first; the chronologically previous entry to
            // diff against is the NEXT element in this reversed array.
            const previous = rows[i + 1] ?? null
            return (
              <div key={entry.atMs} className={styles.line} data-testid="telemetry-log-line">
                <span className={styles.bracket}>[{formatElapsed(entry.atMs, firstAtMs)}]</span>{' '}
                {describeEntry(entry, previous)}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
