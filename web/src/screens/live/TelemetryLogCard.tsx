import { formatElapsed, type TelemetryEntry } from './telemetryLog'
import styles from './TelemetryLogCard.module.css'

export interface TelemetryLogCardProps {
  log: TelemetryEntry[]
}

/**
 * design README.md:463-476. Newest first. Each line is `qa_tier1`'s own
 * `status_line`, rendered verbatim — the server already composes "stacked
 * 211 (+1) | rejected 0 | solve OK | focus Δ=+3 | hfd 2.40" from its own
 * `snapshot`/`trends`, so this client does not recompose or re-derive it
 * (see telemetryLog.ts's own doc comment for why an earlier version of this
 * card did that arithmetic itself before the real shape was confirmed).
 * `flags`, when non-empty, is a real server-reported health flag — rendered
 * as-is, never invented.
 *
 * "Quality verdict pending — Tier-2 scores the FITS at wind-down" is the one
 * rule from the design that must survive verbatim: Tier-1 is cheap health
 * polling, and this card must never show a per-sub PASS/MARGINAL/REJECT
 * during the session — that's Tier-2, at wind-down only.
 */
export function TelemetryLogCard({ log }: TelemetryLogCardProps) {
  const first = log[0] ?? null
  // Newest first for display.
  const rows = [...log].reverse()

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>qa_tier1 · health telemetry</span>
        <span className={styles.pending}>Quality verdict pending — Tier-2 scores the FITS at wind-down</span>
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
