import type { QaVerdictCounts } from '../../api/schemas'
import styles from './QualityBar.module.css'

export interface QualityBarProps {
  verdicts: QaVerdictCounts
  /** Opens this target's report on the Review & QA screen. Omitted when the
   * caller has nowhere to send them. */
  onOpen?: () => void
}

const SEGMENTS = [
  { key: 'pass', label: 'pass' },
  { key: 'marginal', label: 'marginal' },
  { key: 'reject', label: 'reject' },
  { key: 'unknown', label: 'unrecognised verdict' },
] as const

/**
 * A target's captured time, split by what the QA verdicts actually say about
 * it.
 *
 * The bar above this one answers "how much have I collected against the
 * suggested integration". This one answers the question that changes what you
 * do next: **how much of it is keepable**. A target can be at 100% of its
 * suggested time and still be mostly rejects.
 *
 * Proportions are sub counts, not minutes. Every sub is the same exposure
 * within a session, so the two are the same shape — but counts are what the
 * server actually returns, and converting to minutes here would mean
 * multiplying by an exposure this component does not have and would have to
 * assume.
 *
 * **Absent, not empty, when a target was never analysed.** The caller renders
 * nothing rather than a grey bar: an empty bar reads as "nothing passed",
 * which is a claim about quality, where the truth is that nobody measured.
 *
 * `unknown` gets a segment despite never appearing today. It is the count of
 * verdicts outside the policy's three, and a vocabulary change should show up
 * as a visible slice rather than quietly inflating another one.
 */
export function QualityBar({ verdicts, onOpen }: QualityBarProps) {
  const { total } = verdicts
  if (total === 0) return null

  const pct = (n: number) => (n / total) * 100
  const keepable = verdicts.pass + verdicts.marginal

  const bar = (
    <div className={styles.track} data-testid="quality-bar">
      {SEGMENTS.map(({ key, label }) => {
        const n = verdicts[key]
        if (n === 0) return null
        return (
          <span
            key={key}
            className={`${styles.segment} ${styles[key]}`}
            style={{ width: `${pct(n)}%` }}
            title={`${n} ${label} — ${pct(n).toFixed(0)}%`}
          />
        )
      })}
    </div>
  )

  const caption = `${keepable} of ${total} subs keepable · ${verdicts.reject} rejected`

  return onOpen ? (
    <button type="button" className={styles.clickable} onClick={onOpen} title="Open the QA report">
      {bar}
      <span className={styles.caption}>{caption}</span>
    </button>
  ) : (
    <div className={styles.static}>
      {bar}
      <span className={styles.caption}>{caption}</span>
    </div>
  )
}
