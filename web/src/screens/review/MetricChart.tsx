import type { QaSubVerdict } from '../../api/schemas'
import { bucketSubs } from './qa'
import styles from './MetricChart.module.css'

export interface MetricChartProps {
  eyebrow: string
  subs: readonly QaSubVerdict[]
  metric: keyof QaSubVerdict['metrics']
  /** Bars to aim for. Fewer subs than this renders one bar per sub — the
   * chart never pads to fill the axis. */
  buckets?: number
  height?: number
  totalSubs: number
}

/**
 * Per-sub metric across the session, as flex-div bars. No charting library —
 * the CSS-bars decision in CLAUDE.md.
 *
 * **Bars are coloured by the server's own per-sub verdict, never by comparing
 * a value to a cutoff.** That is not a shortcut, it is the only honest option
 * available: the `qa_tier2` payload carries `medians` but no thresholds, and
 * the cutoffs exist only as prose inside `reasons[]` ("scattered light 0.016
 * > 0.014 (median + 2σ)"). Parsing numbers out of those sentences to draw a
 * line would be re-deriving a verdict, which CLAUDE.md forbids, and
 * hardcoding them is forbidden twice over.
 *
 * So the design's two dashed threshold lines are **deliberately absent**
 * rather than approximated — see the note the screen renders under the
 * legend, and handback item 26. The colour still carries the same
 * information: where in the session the rejects fall, and whether two
 * independent metrics dip together.
 *
 * Bar HEIGHT is scaled to the largest value present in this chart, so the
 * shape of the distribution is honest even though the absolute scale is
 * unlabelled. A bucket with nothing measurable renders as a gap, not a
 * zero-height bar at the floor — a sub that was never measured must not look
 * like one that measured zero.
 */
export function MetricChart({
  eyebrow,
  subs,
  metric,
  buckets = 60,
  height = 118,
  totalSubs,
}: MetricChartProps) {
  const data = bucketSubs(subs, metric, buckets)
  const values = data.map((b) => b.value).filter((v): v is number => v != null)
  const max = values.length ? Math.max(...values) : 0

  return (
    <div className={styles.chart}>
      <div className={styles.eyebrow}>{eyebrow}</div>
      <div className={styles.plot} style={{ height: `${height}px` }}>
        {data.length === 0 ? (
          <div className={styles.empty}>no subs to plot</div>
        ) : (
          data.map((bucket) => {
            if (bucket.value == null) {
              return (
                <div
                  key={bucket.startIndex}
                  className={styles.gap}
                  title={`subs ${bucket.startIndex}–${bucket.startIndex + bucket.count - 1}: not analysed`}
                />
              )
            }
            // Clamped to a visible minimum so a genuinely small value is
            // still a bar rather than nothing — but only for values that
            // exist. Absent stays absent, above.
            const pct = max > 0 ? Math.max(4, (bucket.value / max) * 100) : 4
            return (
              <div
                key={bucket.startIndex}
                className={`${styles.bar} ${styles[bucket.tone]}`}
                style={{ height: `${pct}%` }}
                title={
                  `subs ${bucket.startIndex}–${bucket.startIndex + bucket.count - 1}` +
                  ` · ${bucket.value.toFixed(4)}`
                }
              />
            )
          })
        )}
      </div>
      <div className={styles.axis}>
        <span>sub 0</span>
        <span>{totalSubs}</span>
      </div>
    </div>
  )
}
