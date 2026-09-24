import type { QaVerdictCounts } from '../api/schemas'
import styles from './QualityBar.module.css'

export interface QualityBarProps {
  verdicts: QaVerdictCounts
  /** Opens this target's report on the Review & QA screen. Omitted when the
   * caller has nowhere to send them. */
  onOpen?: () => void
  /** The target's captured minutes by source (projects_combined's
   * `store_minutes`/`archive_minutes`), so the bar can say what its
   * verdicts cover. The dashboard's Tier-2 runs on archive paths only: store
   * minutes have never been analysed here. Pass it wherever the bar sits
   * beside a captured-time figure that includes the store. */
  coverage?: { storeMinutes: number; archiveMinutes: number }
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
 *
 * **Says what it covers when that is not everything.** The verdicts are the
 * archive's subs only, and the callers show them beside a captured-time
 * figure that also counts the store. M1 read "113 of 265 subs keepable" next
 * to 3.5 h, where the 265 subs are the archive's 44.2 min and the store's
 * 167.2 min were never analysed, so 43% keepable read as applying to all
 * 3.5 h. With store time present, a note under the caption says so.
 */
export function QualityBar({ verdicts, onOpen, coverage }: QualityBarProps) {
  const { total } = verdicts
  if (total === 0) return null

  const pct = (n: number) => (n / total) * 100
  // The SERVER's keep rule, not one of ours: qa_tier2's keep_list is every
  // sub whose verdict is not REJECT — so an unrecognised verdict is kept
  // too, which `pass + marginal` silently dropped. This payload
  // (`/api/qa_targets` verdict_counts) carries no kept count to read
  // instead, so it is the complement of the one verdict the server drops.
  const keepable = total - verdicts.reject

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
  const note =
    coverage && coverage.storeMinutes > 0 ? (
      <span className={styles.note} data-testid="qa-coverage-note">
        QA covers the archive&apos;s {coverage.archiveMinutes.toFixed(1)} min only; the store&apos;s{' '}
        {coverage.storeMinutes.toFixed(1)} min is not analysed here
      </span>
    ) : null

  return onOpen ? (
    <button type="button" className={styles.clickable} onClick={onOpen} title="Open the QA report">
      {bar}
      <span className={styles.caption}>{caption}</span>
      {note}
    </button>
  ) : (
    <div className={styles.static}>
      {bar}
      <span className={styles.caption}>{caption}</span>
      {note}
    </div>
  )
}
