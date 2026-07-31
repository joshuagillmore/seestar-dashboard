/**
 * The single place verdict naming happens.
 *
 * The server returns `go: boolean | null`. This is a 1:1 relabel of that field
 * with no arithmetic — it is NOT a derivation. The design's CONDITIONAL state
 * has no server source, and synthesising it from `suitability` would mean the UI
 * computing a verdict from a threshold, which this project forbids. See
 * docs/handback-to-seestar-ai.md item 6.
 */
export type Verdict = 'GO' | 'NO-GO' | 'UNKNOWN'

export function verdictFor(go: boolean | null): Verdict {
  if (go === true) return 'GO'
  if (go === false) return 'NO-GO'
  return 'UNKNOWN'
}

/** Maps a verdict to its token family: pass / reject / marginal. */
export function verdictTone(verdict: Verdict): 'pass' | 'reject' | 'marginal' {
  if (verdict === 'GO') return 'pass'
  if (verdict === 'NO-GO') return 'reject'
  return 'marginal'
}

/**
 * `assess_conditions.dew_risk` returns exactly four strings: high (spread < 2
 * deg C), moderate (< 5 deg C), low (>= 5 deg C), or "unknown" from the
 * weather-outage fallback. Mapping that closed categorical to a tone is a 1:1
 * relabel, not a derivation — the cutoffs themselves stay server-side. Any
 * value this map doesn't recognise (today, just "unknown") falls through to
 * `undefined` and renders uncoloured, honestly, rather than guessing a tone.
 *
 * Shared by VerdictBanner (desktop) and MobileTonightView's DEW RISK tile —
 * both read the same server field, so the mapping lives in one place rather
 * than drifting between two copies.
 */
const DEW_TONE: Partial<Record<string, 'pass' | 'marginal' | 'reject'>> = {
  low: 'pass',
  moderate: 'marginal',
  high: 'reject',
}

export function dewRiskTone(risk: string): 'pass' | 'marginal' | 'reject' | undefined {
  return DEW_TONE[risk]
}
