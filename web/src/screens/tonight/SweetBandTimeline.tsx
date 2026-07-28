import type { Conditions, PlanTarget } from '../../api/schemas'
import styles from './SweetBandTimeline.module.css'
import { buildScale, localHhMm, minutesBetween, parse, spanToPercent } from './timeline'

interface Props {
  conditions: Conditions
  targets: PlanTarget[]
}

/**
 * The sweet band is the core idea of the product: on an alt-az mount, usable
 * integration is only the span between the altitude floor and the field-rotation
 * ceiling — not the whole time a target is up.
 *
 * The handoff contrasts that accent bar against a grey "above floor" rail. The
 * server returns only dark_minutes_above_floor — an integrated duration with no
 * start/end — so the rail and its legend entry are both omitted rather than
 * faked. See docs/handback-to-seestar-ai.md item 2.
 */
export function SweetBandTimeline({ conditions, targets }: Props) {
  const scale = buildScale(conditions.dark_window_utc)
  const dark = spanToPercent(scale, conditions.dark_window_utc)

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>Tonight · sweet-band windows</span>
        <span className={styles.legend}>
          <span className={styles.swatch} /> sweet band
        </span>
      </div>

      <div className={styles.bracketLabels}>
        <span className={styles.bracketLabel} style={{ left: `${dark.left}%` }}>
          {localHhMm(parse(conditions.dark_window_utc[0]))} dark
        </span>
        <span
          className={`${styles.bracketLabel} ${styles.bracketLabelEnd}`}
          style={{ left: `${dark.left + dark.width}%` }}
        >
          {localHhMm(parse(conditions.dark_window_utc[1]))} dawn
        </span>
      </div>

      <div className={styles.strip}>
        <div className={styles.bracket} style={{ left: `${dark.left}%`, width: `${dark.width}%` }} />
      </div>

      {targets.map((target) => {
        const band = spanToPercent(scale, target.best_window_utc)
        const [from, to] = target.best_window_utc
        return (
          <div key={target.id} className={styles.lane}>
            <span className={styles.laneName}>{target.id}</span>
            <div className={styles.laneTrack}>
              <div
                data-band
                className={styles.band}
                style={{ left: `${band.left}%`, width: `${band.width}%` }}
              >
                {/* The bar's OWN span, not target.sweet_band_min. The bar is
                    drawn from best_window_utc — the longest contiguous run —
                    while sweet_band_min is the integrated total across the dark
                    window and may include time this bar does not cover. On
                    tonight's data they differ by 2 minutes; on a night with a
                    fragmented band they could differ a lot, and this is the one
                    chart whose purpose is an auditable promised-vs-bankable
                    comparison. See handback item 9. */}
                {minutesBetween(target.best_window_utc)} min
              </div>
            </div>
            <span className={styles.laneWindow}>
              {localHhMm(parse(from))}–{localHhMm(parse(to))}
            </span>
          </div>
        )
      })}

      <div className={styles.axis}>
        {scale.ticks.map((tick) => (
          <span key={tick}>{localHhMm(tick).slice(0, 2)}</span>
        ))}
      </div>
    </section>
  )
}
