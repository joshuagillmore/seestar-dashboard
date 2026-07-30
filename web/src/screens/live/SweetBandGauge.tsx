import { bandRegion, pctFromTop } from './bandGeometry'
import styles from './SweetBandGauge.module.css'

export interface SweetBandGaugeProps {
  /** Site constants, not session data — see get_site_profile's already-typed
   * fields. Required: without them there is no band to draw at all. */
  rotationCeilingDeg: number
  altitudeFloorDeg: number
  /** Per-target live reading (get_target_observability) — absent while that
   * fetch hasn't succeeded, which degrades to the static band alone. */
  currentAltDeg: number | null
  currentAzDeg: number | null
  minutesToBandExit: number | null
}

/**
 * Vertical 0°(horizon)–90°(zenith) altitude gauge (design README.md:436-446).
 * The shaded band is the sweet band itself — the alt-az mount's real usable
 * integration window, "clean integration is the sweet-band figure, not the
 * whole pass" (kept as static methodology copy, not a per-session claim —
 * see this module's own note on why the design's "descending toward the
 * floor" direction is NOT reproduced: this client has no confirmed
 * rising/setting field, and guessing the direction from two samples would be
 * exactly the kind of derived assessment this project avoids).
 */
export function SweetBandGauge({
  rotationCeilingDeg,
  altitudeFloorDeg,
  currentAltDeg,
  currentAzDeg,
  minutesToBandExit,
}: SweetBandGaugeProps) {
  const region = bandRegion(rotationCeilingDeg, altitudeFloorDeg)
  const currentPct = currentAltDeg !== null ? pctFromTop(currentAltDeg) : null

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>Sweet band</span>
        {minutesToBandExit !== null && (
          <span className={styles.exit} data-testid="band-exit">
            leaves band in {minutesToBandExit} min
          </span>
        )}
      </div>

      <div className={styles.body}>
        <div className={styles.track} data-testid="altitude-track">
          <div
            className={styles.band}
            style={{ top: `${region.topPct}%`, height: `${region.heightPct}%` }}
          />
          {currentPct !== null && (
            <div className={styles.current} style={{ top: `${currentPct}%` }} data-testid="current-altitude-marker">
              <span className={styles.currentLabel}>{currentAltDeg?.toFixed(1)}°</span>
            </div>
          )}
        </div>

        <div className={styles.legend}>
          <span className={styles.legendDim}>90° zenith</span>
          <span className={styles.legendAccent}>{rotationCeilingDeg}° rotation ceiling</span>
          <span className={styles.legendCurrent}>
            {currentAltDeg !== null && currentAzDeg !== null
              ? `current ${currentAltDeg.toFixed(1)}° · az ${currentAzDeg.toFixed(1)}°`
              : 'current altitude unavailable'}
          </span>
          <span className={styles.legendAccent}>{altitudeFloorDeg}° altitude floor</span>
          <span className={styles.legendDim}>0° horizon</span>
        </div>
      </div>

      <div className={styles.footer}>Clean integration is the sweet-band figure, not the whole pass.</div>
    </section>
  )
}
