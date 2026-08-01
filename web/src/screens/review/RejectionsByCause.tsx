import type { QaSummary } from '../../api/schemas'
import { METRIC_LABELS, rejectionsByCause } from './qa'
import styles from './RejectionsByCause.module.css'

export interface RejectionsByCauseProps {
  summary: QaSummary
}

/**
 * Which metrics the session's rejects were blamed on.
 *
 * Counted from the server's own `reasons[]` text (see `rejectionsByCause`),
 * so a sub rejected for both star count and SNR is counted under both. The
 * totals therefore do **not** sum to the reject count, which is why this is
 * labelled "by cause" and each row carries its own count rather than a share
 * of a whole. Presenting it as a partition would imply a single attributed
 * cause per sub that the payload does not contain.
 *
 * `dominant_reject_cause` is the server's own answer to "what mostly went
 * wrong" and is shown in the stat grid; this panel is the breakdown behind
 * it, not a second opinion.
 */
export function RejectionsByCause({ summary }: RejectionsByCauseProps) {
  const causes = rejectionsByCause(summary)
  const max = causes.length ? Math.max(...causes.map((c) => c.count)) : 0

  return (
    <div className={styles.panel}>
      <div className={styles.eyebrow}>Rejections by cause</div>

      {causes.length === 0 ? (
        <div className={styles.empty}>
          {summary.subs.length === 0 ? 'no subs analysed' : 'nothing rejected this session'}
        </div>
      ) : (
        <div className={styles.rows}>
          {causes.map(({ cause, count }) => (
            <div key={cause} className={styles.row}>
              <span className={styles.label}>{METRIC_LABELS[cause] ?? cause}</span>
              <span className={styles.track}>
                <span
                  className={styles.fill}
                  style={{ width: `${max > 0 ? (count / max) * 100 : 0}%` }}
                />
              </span>
              <span className={styles.count}>{count}</span>
            </div>
          ))}
        </div>
      )}

      {causes.length > 1 && (
        <p className={styles.note}>
          A sub blamed on more than one metric is counted under each, so these do not sum to the
          reject total.
        </p>
      )}
    </div>
  )
}
