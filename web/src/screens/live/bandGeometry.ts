/**
 * Pure geometry for the vertical altitude gauge — a 0°(horizon)–90°(zenith)
 * axis read top-down, so this is the mirror image of framing.ts's frame math
 * but the same idea: convert a real number into a CSS percentage, never a
 * hardcoded one.
 */

const AXIS_MAX_DEG = 90

/** `%` from the top of the track for a given altitude — 90° (zenith) is 0%
 * from top, 0° (horizon) is 100%. Clamped: a plate-solve or a transient
 * telemetry glitch reporting slightly outside [0,90] should not overflow the
 * track. */
export function pctFromTop(altitudeDeg: number): number {
  const clamped = Math.min(AXIS_MAX_DEG, Math.max(0, altitudeDeg))
  return (1 - clamped / AXIS_MAX_DEG) * 100
}

export interface BandRegion {
  topPct: number
  heightPct: number
}

/** The shaded sweet-band region between the rotation ceiling (top) and the
 * altitude floor (bottom) — both site constants (get_site_profile's
 * `field_rotation_ceiling_deg` / `min_altitude_deg`), never a value this
 * client invents. */
export function bandRegion(ceilingDeg: number, floorDeg: number): BandRegion {
  const top = pctFromTop(ceilingDeg)
  const bottom = pctFromTop(floorDeg)
  return { topPct: top, heightPct: Math.max(0, bottom - top) }
}
