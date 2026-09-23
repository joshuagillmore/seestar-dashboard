import type { QaSubMetrics, QaSubVerdict } from '../../api/schemas'

/**
 * TEST DATA ONLY — the server's own reason sentences, built from the same
 * f-strings seestar-mcp writes them with (`qa_tier2.py` `_score_sub`, and the
 * `could not analyze:` error path above it).
 *
 * Why this file exists: the attribution bugs in qa.ts got past every test
 * because the tests were written against invented prose ("star count 173
 * low", "REJECT - could not analyse") instead of what the server actually
 * sends (`star_count`, `REJECT:`, `could not analyze: no stars detected`).
 * A test that feeds the parser text the server never emits proves nothing
 * about the parser.
 *
 * The CUTOFF numbers each test passes in are its own synthetic values — never
 * the policy constants. Those live in seestar-mcp config.py, and
 * src/test/no-thresholds.test.ts fails the build on one appearing here.
 */

const f2 = (n: number) => n.toFixed(2)
const f3 = (n: number) => n.toFixed(3)
/** Python's `:.3g` for the magnitudes star counts take (tens to thousands). */
const g3 = (n: number) => String(Number(n.toPrecision(3)))

export const serverReason = {
  /** `f"REJECT: eccentricity {m.eccentricity:.2f} >= {ecc_cut:g} cutoff"` */
  eccReject: (value: number, cut: number) => `REJECT: eccentricity ${f2(value)} >= ${cut} cutoff`,
  /** The session-relative MARGINAL line, with its derivation named. */
  eccMarginal: (value: number, line: number, median: number) =>
    `MARGINAL: eccentricity ${f2(value)} >= ${f2(line)} (median ${f2(median)} + 1sigma)`,
  fwhmReject: (value: number, line: number, median: number) =>
    `REJECT: FWHM ${f2(value)} > ${f2(line)} (median ${f2(median)} + 1.5sigma)`,
  fwhmMarginal: (value: number, line: number, median: number) =>
    `MARGINAL: FWHM ${f2(value)} > ${f2(line)} (median ${f2(median)} + 1sigma)`,
  snrReject: (value: number, floor: number, median: number) =>
    `REJECT: SNR ${f2(value)} < ${f2(floor)} floor (0.5 x median ${f2(median)})`,
  /** Note the token: `star_count`, with the underscore — not "star count". */
  starReject: (count: number, floor: number, median: number) =>
    `REJECT: star_count ${count} < ${g3(floor)} floor (0.5 x median ${g3(median)})`,
  scatterReject: (value: number, line: number) =>
    `REJECT: scattered light ${f3(value)} > ${f3(line)} (median + 2σ) — likely thin cirrus / bright-star halos`,
  scatterMarginal: (value: number, line: number) =>
    `MARGINAL: scattered light ${f3(value)} > ${f3(line)} (median + 1σ) — possible thin cirrus / bright-star halos`,
  /** Every PASS carries this one line; `reasons` is never empty on the wire. */
  pass: 'PASS: all metrics within session norms',
  /** The error path: verdict REJECT, and NO `REJECT:` prefix on the reason. */
  unanalysed: (error: string) => `could not analyze: ${error}`,
} as const

const NULL_METRICS: QaSubMetrics = {
  star_count: null,
  fwhm: null,
  hfr: null,
  eccentricity: null,
  snr: null,
  background: null,
  scattered_light: null,
  error: null,
}

/** A sub shaped exactly as `_compact_report` emits one. */
export function makeSub(
  name: string,
  verdict: string,
  reasons: string[],
  metrics: Partial<QaSubMetrics> = {},
): QaSubVerdict {
  return { name, verdict, reasons, metrics: { ...NULL_METRICS, ...metrics } }
}

/**
 * The "no stars detected" sub, as the server really sends it: verdict REJECT,
 * `star_count: 0` (an int in their dataclass, never null), a real background
 * median, every other metric null, and `error` set.
 *
 * The 0 is the trap. It is not a measurement of zero stars in the sense the
 * star-count gate means — the sub was never scored — and "no stars detected"
 * contains the substring "stars".
 */
export function noStarsSub(name: string): QaSubVerdict {
  return makeSub(name, 'REJECT', [serverReason.unanalysed('no stars detected')], {
    star_count: 0,
    background: 812.5,
    error: 'no stars detected',
  })
}
