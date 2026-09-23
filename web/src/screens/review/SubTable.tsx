import type { QaSubVerdict } from '../../api/schemas'
import { blamedMetrics, formatMetric, isUnanalysed, measuredValue, toneFor } from './qa'
import styles from './SubTable.module.css'

export interface SubTableProps {
  subs: readonly QaSubVerdict[]
  /** How many rows to render. The design shows 6 of 766 deliberately: "the
   * charts carry the distribution, the table carries evidence." */
  limit?: number
  /** Total before filtering, so the footer can say "of 102" rather than "of
   * 28" and hide that a filter is on. */
  totalUnfiltered?: number
  onSelect?: (sub: QaSubVerdict) => void
  selectedName?: string | null
}

const METRIC_COLUMNS = [
  { key: 'fwhm', label: 'FWHM', dp: 2 },
  { key: 'eccentricity', label: 'ECC', dp: 2 },
  { key: 'snr', label: 'SNR', dp: 1 },
  { key: 'star_count', label: 'STARS', dp: 0 },
  { key: 'scattered_light', label: 'SCATTER', dp: 3 },
] as const

/**
 * Per-sub verdicts — the evidence table under the charts.
 *
 * Two rules from CLAUDE.md and the slice-4 spec are load-bearing here:
 *
 * 1. **The verdict and its reason are rendered verbatim.** The badge shows
 *    what the server said; the reason text beside it is the server's own
 *    sentence, not a paraphrase. The policy's standard is "an auditable,
 *    defensible quality verdict, never a vibe" — reducing that sentence to a
 *    coloured badge would throw away the audit trail, so the badge and the
 *    reason always travel together.
 *
 * 2. **A highlighted metric cell means the server blamed that metric**, via
 *    `blamedMetrics`, which reads the reason text — and its colour is that
 *    reason's own REJECT/MARGINAL, not the sub's overall verdict. It never
 *    means we compared a value to a cutoff: the cutoffs are the server's,
 *    and deriving a verdict from them here is forbidden.
 *
 * An unanalysable sub gets its own row treatment: a dash in every metric
 * cell (the server still sends `star_count: 0` for it, which is not a
 * measurement), the error shown, and no verdict tone. It is not a rejection — the server made no
 * quality judgement about it — and colouring it as one would attribute a
 * decision nobody took.
 */
export function SubTable({
  subs,
  limit = 12,
  totalUnfiltered,
  onSelect,
  selectedName = null,
}: SubTableProps) {
  const rows = subs.slice(0, limit)

  return (
    <div className={styles.table}>
      <div className={`${styles.row} ${styles.head}`}>
        <span>SUB</span>
        {METRIC_COLUMNS.map((c) => (
          <span key={c.key} className={styles.numeric}>
            {c.label}
          </span>
        ))}
        <span>VERDICT</span>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>no subs in this report</div>
      ) : (
        rows.map((sub) => {
          const tone = toneFor(sub.verdict)
          const blamed = blamedMetrics(sub)
          const unanalysed = isUnanalysed(sub)

          return (
            <div
              key={sub.name}
              className={[
                styles.row,
                onSelect ? styles.clickable : '',
                sub.name === selectedName ? styles.selected : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={onSelect ? () => onSelect(sub) : undefined}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onKeyDown={
                onSelect
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect(sub)
                      }
                    }
                  : undefined
              }
            >
              <span className={styles.name} title={sub.name}>
                {sub.name}
              </span>

              {METRIC_COLUMNS.map((c) => {
                // Toned by the reason that blamed THIS metric, not by the
                // sub's overall verdict — see qa.ts reasonBlames.
                const blamedTone = blamed.get(c.key)
                const cls = [styles.numeric, blamedTone ? styles[blamedTone] : '']
                  .filter(Boolean)
                  .join(' ')
                return (
                  <span key={c.key} className={cls}>
                    {formatMetric(measuredValue(sub, c.key), c.dp)}
                  </span>
                )
              })}

              <span className={styles.verdict}>
                {unanalysed ? (
                  <>
                    <span className={`${styles.badge} ${styles.unanalysed}`}>NOT ANALYSED</span>
                    <span className={styles.reason}>{sub.metrics.error}</span>
                  </>
                ) : (
                  <>
                    <span className={`${styles.badge} ${styles[tone]}`}>{sub.verdict}</span>
                    <span className={styles.reason}>
                      {sub.reasons.length > 0 ? sub.reasons.join(' · ') : 'clears every gate'}
                    </span>
                  </>
                )}
              </span>
            </div>
          )
        })
      )}

      {(subs.length > rows.length || (totalUnfiltered != null && totalUnfiltered !== subs.length)) && (
        <div className={styles.footer}>
          showing {rows.length} of {subs.length}
          {totalUnfiltered != null && totalUnfiltered !== subs.length
            ? ` matching (${totalUnfiltered} in the session)`
            : ''}{' '}
          — the charts above carry the full distribution, unfiltered
        </div>
      )}
    </div>
  )
}
