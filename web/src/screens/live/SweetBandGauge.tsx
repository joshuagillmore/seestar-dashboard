import type { ObservabilityDetail } from '../../api/schemas'
import { bandRegion, pctFromTop } from './bandGeometry'
import styles from './SweetBandGauge.module.css'

export interface SweetBandGaugeProps {
  /** Site constants, not session data — see get_site_profile's already-typed
   * fields. Required: without them there is no band to draw at all. */
  rotationCeilingDeg: number
  altitudeFloorDeg: number
  /** `get_target_observability`'s real shape is the *nightly* aggregate for
   * this target — peak altitude, the sweet-band window, whether the transit
   * clears the ceiling — not an instantaneous current-alt/az reading (no
   * such reading exists anywhere in the confirmed tool surface; an earlier
   * version of this component plotted a live position marker before that
   * was confirmed). `null` on fetch failure or before a target is known. */
  observability: ObservabilityDetail | null
}

/**
 * Vertical 0°(horizon)–90°(zenith) altitude gauge (design README.md:436-446),
 * showing the static band plus this target's own peak-altitude marker for
 * tonight — not a moving "where it is right now" indicator, since nothing
 * this client can reach provides one. `transits_above_ceiling` is the
 * server's own verdict on whether the peak ever clears the sweet band,
 * rendered verbatim rather than derived by comparing max_alt_deg to the
 * ceiling client-side (they're both real numbers, but the server has
 * already made the call once and repeating it here risks disagreeing with
 * its own answer, e.g. at the exact boundary).
 */
export function SweetBandGauge({ rotationCeilingDeg, altitudeFloorDeg, observability }: SweetBandGaugeProps) {
  const region = bandRegion(rotationCeilingDeg, altitudeFloorDeg)
  const peakAlt = observability?.max_alt_deg ?? null
  const peakPct = peakAlt !== null ? pctFromTop(peakAlt) : null

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>Sweet band</span>
        {observability?.transits_above_ceiling && (
          <span className={styles.warn} data-testid="transits-above-ceiling">
            transits above the rotation ceiling
          </span>
        )}
      </div>

      <div className={styles.body}>
        <div className={styles.track} data-testid="altitude-track">
          <div
            className={styles.band}
            style={{ top: `${region.topPct}%`, height: `${region.heightPct}%` }}
          />
          {peakPct !== null && (
            <div className={styles.peak} style={{ top: `${peakPct}%` }} data-testid="peak-altitude-marker">
              <span className={styles.peakLabel}>{peakAlt?.toFixed(1)}°</span>
            </div>
          )}
        </div>

        <div className={styles.legend}>
          <span className={styles.legendDim}>90° zenith</span>
          <span className={styles.legendAccent}>{rotationCeilingDeg}° rotation ceiling</span>
          <span className={styles.legendCurrent}>
            {peakAlt !== null ? `peak ${peakAlt.toFixed(1)}° tonight` : 'peak altitude unavailable'}
          </span>
          <span className={styles.legendAccent}>{altitudeFloorDeg}° altitude floor</span>
          <span className={styles.legendDim}>0° horizon</span>
        </div>
      </div>

      {observability?.dark_minutes_in_sweet_band != null && (
        <div className={styles.stat} data-testid="sweet-band-minutes">
          {Math.round(observability.dark_minutes_in_sweet_band)} min of clean sweet-band time tonight
        </div>
      )}

      <div className={styles.footer}>Clean integration is the sweet-band figure, not the whole pass.</div>
    </section>
  )
}
