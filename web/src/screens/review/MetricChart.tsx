import type { QaSubVerdict } from '../../api/schemas'
import { bucketSubs } from './qa'
import styles from './MetricChart.module.css'

/** One cutoff line. `value` comes from `summary.thresholds` — never a
 * constant, never parsed out of a reason string. */
export interface ThresholdLine {
  value: number
  label: string
  tone: 'marginal' | 'reject'
}

export interface MetricChartProps {
  eyebrow: string
  subs: readonly QaSubVerdict[]
  metric: keyof QaSubVerdict['metrics']
  /** Bars to aim for. Fewer subs than this renders one bar per sub — the
   * chart never pads to fill the axis. */
  buckets?: number
  height?: number
  totalSubs: number
  /** Cutoff lines to draw. Empty when the report predates
   * `summary.thresholds` or the server could not compute them: no line is
   * drawn rather than one at zero. */
  thresholds?: readonly ThresholdLine[]
}

/**
 * Per-sub metric across the session, as flex-div bars with the server's own
 * cutoff lines over them. No charting library — the CSS-bars decision.
 *
 * **Bar colour is the server's per-sub verdict, and the lines are the
 * server's effective thresholds.** Neither is computed here: the chart never
 * compares a value to a cutoff to decide anything, it just draws both and
 * lets them be seen together. A bar crossing a line is the server's verdict
 * and the server's threshold agreeing on screen, not this component deriving
 * one from the other.
 *
 * The lines were impossible until seestar-mcp shipped `summary.thresholds`
 * (d555c4b) — before that the cutoffs existed only inside `reasons[]` prose.
 *
 * ## The domain
 *
 * Bars and lines must share one scale or the picture lies. The domain is the
 * largest of the bar values **and the thresholds**, plus headroom — not just
 * the bars. That matters in the ordinary case: on a clean session every sub
 * sits well below the reject cutoff, so scaling to the bars alone would push
 * the reject line off the top of the chart exactly when its absence is the
 * good news worth showing. The real M 81 recording is this case: every sub
 * sits below the marginal cutoff and the reject line is well clear of the
 * tallest bar. No numbers quoted here on purpose — src/test/no-thresholds
 * fails the build on a cutoff literal anywhere in source, comments included,
 * and it has now caught two of mine.
 *
 * A bucket with nothing measurable renders as a gap, not a zero-height bar:
 * a sub that was never measured must not look like one that measured zero.
 */
export function MetricChart({
  eyebrow,
  subs,
  metric,
  buckets = 60,
  height = 118,
  totalSubs,
  thresholds = [],
}: MetricChartProps) {
  const data = bucketSubs(subs, metric, buckets)
  const barValues = data.map((b) => b.value).filter((v): v is number => v != null)
  const lineValues = thresholds.map((t) => t.value)
  const peak = Math.max(0, ...barValues, ...lineValues)
  // 8% headroom so a line at the very top is not flush with the edge.
  const domain = peak > 0 ? peak * 1.08 : 1

  return (
    <div className={styles.chart}>
      <div className={styles.eyebrow}>{eyebrow}</div>
      <div className={styles.plot} style={{ height: `${height}px` }}>
        {/* Labels are pinned to opposite ends by TONE, not by index: marginal
            left, reject right. Two cutoffs can sit arbitrarily close together
            — on a real M 42 report they are 0.02 apart on a domain of ~0.6, so
            both labels landed in the same few pixels at the right edge and
            neither could be read. Staggering them vertically instead would
            detach a label from the line it names, which is worse than
            crowding. Charts with a single cutoff all use tone `reject`
            (`THRESHOLD_FIELDS` in qa.ts), so they are unaffected. */}
        {thresholds.map((line) => (
          <div
            key={line.label}
            className={`${styles.threshold} ${styles[`line_${line.tone}`]}`}
            style={{ bottom: `${(line.value / domain) * 100}%` }}
          >
            <span
              className={`${styles.thresholdLabel} ${line.tone === 'marginal' ? styles.labelStart : ''}`}
            >
              {line.label}
            </span>
          </div>
        ))}

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
            const pct = Math.max(4, (bucket.value / domain) * 100)
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
