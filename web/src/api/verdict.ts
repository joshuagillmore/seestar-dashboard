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
