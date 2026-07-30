import type { Conditions, PlanTarget } from '../../api/schemas'
import styles from './SweetBandTimeline.module.css'
import { buildScale, localHhMm, minutesBetween, parse, spanToPercent, zoneLabel } from './timeline'

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
        {/* Every clock on this card — the dark/dawn bracket labels, each
            lane's window, and the hour axis below — is the browser's local
            wall clock (see timeline.ts's localHhMm). None of them individually
            has room for a zone marker (the axis is a bare "19", the lane
            window column is 78px), so it's stated once here for the whole
            card rather than repeated per label. See handback-to-seestar-ai.md
            item 16 for why this can only name the browser's own zone, not the
            observing site's — the two agree only when the reader is at the
            site. */}
        <span
          className={styles.legend}
          title="Browser-local clock time — may not match the observing site's zone."
        >
          <span className={styles.swatch} /> sweet band · times in {zoneLabel(scale.startMs)}
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

      {/* Only this list scrolls. The strip, bracket labels and axis above/below
          share buildScale's coordinate frame and stay fixed — a scrolling axis
          would be meaningless. Sized to show ~3 lanes (30px each: 20px track +
          5px top/bottom padding); the rest is reachable by scroll rather than
          growing the card with a 12-target plan. See .laneScroll's registration
          note below for why the right inset there is 99px, not 90px. */}
      <div className={styles.laneScroll} data-testid="lane-scroll">
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
      </div>

      <div className={styles.axis}>
        {scale.ticks.map((tick) => (
          // data-tick lets a test count rendered ticks without depending on
          // the test runner's local timezone — the label text is local wall
          // clock (see localHhMm), but the tick COUNT is a pure function of
          // the UTC scale and must track dark_window_utc, not a fixed window.
          <span key={tick} data-tick>{localHhMm(tick).slice(0, 2)}</span>
        ))}
      </div>
    </section>
  )
}
