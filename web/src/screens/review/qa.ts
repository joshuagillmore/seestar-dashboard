import type { QaSubVerdict, QaSummary } from '../../api/schemas'

/**
 * Presentation helpers for QA results.
 *
 * The rule this module exists to keep, from CLAUDE.md: **the UI renders
 * verdicts; it never computes or re-derives them, and never hardcodes the
 * thresholds behind them.** Everything here maps a value the server already
 * decided onto something renderable. Nothing here decides anything.
 *
 * Concretely, what is deliberately NOT in this file:
 *   - no comparison of a metric against a cutoff
 *   - no cutoff constants (see src/test/no-thresholds.test.ts, which fails
 *     the build on one appearing anywhere in src/, comments included)
 *   - no inference of which metric caused a verdict from the numbers
 */

/** The three the policy defines. Anything else is rendered verbatim and
 * untoned — see `toneFor`. */
export type QaTone = 'pass' | 'marginal' | 'reject' | 'unknown'

/**
 * Map a server verdict string to a tone.
 *
 * Returns `'unknown'` rather than guessing when the vocabulary grows. The
 * schema deliberately types `verdict` as a string, not an enum, so a fourth
 * verdict reaches us intact instead of blanking the screen; this is the other
 * half of that decision. An unknown verdict renders as its own text with
 * neutral styling — visible and honest, never silently coloured as a pass.
 */
export function toneFor(verdict: string): QaTone {
  if (verdict === 'PASS') return 'pass'
  if (verdict === 'MARGINAL') return 'marginal'
  if (verdict === 'REJECT') return 'reject'
  return 'unknown'
}

/** A sub that could not be analysed at all. Distinct from a rejected one: it
 * has no metrics to show, and rendering it as a rejection would attribute a
 * quality judgement the server never made. */
export function isUnanalysed(sub: QaSubVerdict): boolean {
  return sub.metrics.error != null
}

/**
 * What to say for a sub whose `reasons[]` is empty.
 *
 * The server never sends an empty list today — a PASS carries "PASS: all
 * metrics within session norms" — but an empty list is not evidence of a
 * clean sub, and only the server's own PASS may be described as clearing
 * every gate. Anything else says plainly that no reason came with it.
 */
export function noReasonText(sub: QaSubVerdict): string {
  return toneFor(sub.verdict) === 'pass' ? 'Clears every gate.' : 'No reason given by the server.'
}

/** A metric value the server actually measured, or null.
 *
 * Null for an unanalysable sub regardless of what its fields hold: on the
 * error path the server still sends `star_count: 0` (an int in its
 * dataclass), and rendering or plotting that 0 would present a sub nobody
 * scored as one that measured zero stars. */
export function measuredValue(
  sub: QaSubVerdict,
  metric: keyof QaSubVerdict['metrics'],
): number | null {
  if (isUnanalysed(sub)) return null
  const value = sub.metrics[metric]
  return typeof value === 'number' ? value : null
}

/**
 * Metric tokens exactly as the server's reason sentences spell them —
 * `qa_tier2.py` `_score_sub`: `eccentricity`, `FWHM`, `SNR`, `star_count`
 * (with the underscore) and `scattered light`. Matched case-insensitively,
 * and only in the position the server puts them: straight after the
 * sentence's own verdict prefix.
 *
 * `hfr` and `background` are listed so a reason naming them is attributed
 * if the server ever writes one; it does not today.
 */
const REASON_METRIC_TOKENS: ReadonlyArray<readonly [string, keyof QaSubVerdict['metrics']]> = [
  ['eccentricity', 'eccentricity'],
  ['fwhm', 'fwhm'],
  ['snr', 'snr'],
  ['star_count', 'star_count'],
  ['scattered light', 'scattered_light'],
  ['hfr', 'hfr'],
  ['background', 'background'],
]

/** `REJECT: …` / `MARGINAL: …` — the prefix every non-PASS reason carries.
 * The error path (`could not analyze: …`) and `PASS: …` deliberately do not
 * match: neither blames a metric. */
const REASON_PREFIX = /^(REJECT|MARGINAL):\s*/

/** One metric one reason blames, toned by that reason's own prefix. */
export interface ReasonBlame {
  metric: string
  tone: 'reject' | 'marginal'
  /** The server's sentence, verbatim. */
  reason: string
}

/**
 * Which metric each of a sub's `reasons[]` blames, one entry per reason.
 *
 * The design highlights the offending metric cell in a row. That means
 * knowing WHICH metric failed, and HOW BADLY — and the only honest source is
 * the server's own reason text. Each sentence names one metric and carries
 * its own verdict prefix; a sub can be REJECT for FWHM and only MARGINAL on
 * eccentricity, and colouring both with the sub's REJECT would call a
 * marginal measurement a rejection. We never compare a value to a threshold.
 *
 * An unanalysable sub blames nothing: it was never scored, and its error
 * text ("no stars detected") is not a star-count verdict.
 */
export function reasonBlames(sub: QaSubVerdict): ReasonBlame[] {
  if (isUnanalysed(sub)) return []
  return sub.reasons.flatMap((reason) => {
    const prefix = REASON_PREFIX.exec(reason)
    if (!prefix) return []
    const rest = reason.slice(prefix[0].length).toLowerCase()
    const hit = REASON_METRIC_TOKENS.find(([token]) => new RegExp(`^${token}\\b`).test(rest))
    if (!hit) return []
    const tone: 'reject' | 'marginal' = prefix[1] === 'REJECT' ? 'reject' : 'marginal'
    return [{ metric: hit[1], tone, reason }]
  })
}

/** Every metric a sub's reasons blame, with the worst tone any reason gave it. */
export function blamedMetrics(sub: QaSubVerdict): Map<string, 'reject' | 'marginal'> {
  const blamed = new Map<string, 'reject' | 'marginal'>()
  for (const { metric, tone } of reasonBlames(sub)) {
    if (blamed.get(metric) !== 'reject') blamed.set(metric, tone)
  }
  return blamed
}

/**
 * Reject counts per cause, for the "rejections by cause" panel.
 *
 * Counts a rejected sub under every metric a `REJECT:` reason names — a sub
 * rejected for both star count and SNR appears under both, because both are
 * true of it. A `MARGINAL:` reason on a rejected sub is not a cause of its
 * rejection and is not counted. The totals therefore do not sum to the
 * reject count, which is correct and is why the panel is labelled by cause
 * rather than presented as a partition.
 *
 * Two causes that are not metrics, so no reject is ever silently dropped:
 *   - `error`: a sub the server could not analyse. It is REJECTed on the
 *     wire, and `error` is the server's own cause name for it
 *     (`qa_tier2.py` CAUSE_ERROR), so `dominant_reject_cause` can say it too.
 *   - `unattributed`: a reject whose reasons name no metric we recognise. A
 *     vocabulary change must not turn a rejected night into "nothing
 *     rejected".
 */
export function rejectionsByCause(summary: QaSummary): Array<{ cause: string; count: number }> {
  const counts = new Map<string, number>()
  const bump = (cause: string) => counts.set(cause, (counts.get(cause) ?? 0) + 1)
  for (const sub of summary.subs) {
    if (toneFor(sub.verdict) !== 'reject') continue
    if (isUnanalysed(sub)) {
      bump('error')
      continue
    }
    const causes = new Set(
      reasonBlames(sub)
        .filter((b) => b.tone === 'reject')
        .map((b) => b.metric),
    )
    if (causes.size === 0) bump('unattributed')
    for (const cause of causes) bump(cause)
  }
  return [...counts.entries()]
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause))
}

/** Human label for a metric key — or a reject cause, which is the same
 * vocabulary plus the two non-metric causes. Presentation only. */
export const METRIC_LABELS: Record<string, string> = {
  fwhm: 'FWHM',
  hfr: 'HFR',
  eccentricity: 'eccentricity',
  snr: 'SNR',
  star_count: 'star count',
  scattered_light: 'scattered light',
  background: 'background',
  error: 'not analysed',
  unattributed: 'no metric named',
}

/**
 * Down-sample subs to at most `buckets` bars for a chart.
 *
 * The spec is explicit that a sparse target must not be made to look dense:
 * *"Low-sub targets (e.g. 83 subs) are genuinely noisy results — don't smooth
 * them into looking like a 1386-sub stack."* So when there are fewer subs
 * than buckets this returns one bar per sub and no more — it never pads,
 * stretches or interpolates to fill the axis.
 *
 * Bucketing is the ORDINARY path, not an edge case: it starts above 60 subs
 * on desktop and 40 on mobile, which is every real session. So a bucket must
 * never hide the sub the chart exists to show:
 *
 *   - its HEIGHT is the bucket's worst value in the metric's bad direction —
 *     the largest for a ceiling metric (eccentricity, FWHM, scattered light),
 *     the smallest for a floor (SNR, star count). A mean would draw one
 *     outlier among forty clean subs BELOW the cutoff line it crossed.
 *   - its TONE is the worst verdict any reason gave THIS metric in the
 *     bucket — not the sub's overall verdict. A sub rejected for FWHM has an
 *     ordinary eccentricity, and painting its eccentricity bar red puts a red
 *     bar on the passing side of the line.
 *
 * Neither is a threshold comparison: the direction is which way the server's
 * own cutoff faces (THRESHOLD_FIELDS), and the tone is read off its reasons.
 *
 * An unanalysed sub contributes nothing — no value (the server sends
 * `star_count: 0` for it, which is not a measurement) and no tone (it was
 * never scored). A bucket of only those is a gap.
 */
export interface ChartBucket {
  /** The bucket's worst measured value in the metric's bad direction, or
   * null if nothing in it was measured. */
  value: number | null
  tone: QaTone
  /** The server's sentence behind `tone`, verbatim, when a reason blamed
   * this metric — so a bar can say why it is coloured. */
  reason: string | null
  /** The server's verdicts on the analysed subs in this bucket, distinct,
   * verbatim — a bar says what the server decided, not only its colour. */
  verdicts: string[]
  /** Index of the first sub in this bucket, for the axis. */
  startIndex: number
  count: number
  /** Subs in this bucket the server could not analyse. */
  unanalysed: number
}

const TONE_SEVERITY: Record<QaTone, number> = { pass: 0, unknown: 1, marginal: 2, reject: 3 }

/**
 * The tone one sub earns on one metric's chart.
 *
 * - A reason blames this metric → that reason's own REJECT/MARGINAL.
 * - The server's reasons blame other metrics only → this one cleared its
 *   gates (the server writes a reason for every gate a sub trips), so it is
 *   drawn as passing on THIS chart whatever the sub's overall verdict.
 * - Nothing in its reasons can be attributed at all → the sub's own verdict.
 *   A reason format we do not recognise must not turn a reject into a
 *   clean-looking bar; falling back keeps it visible.
 */
function metricTone(sub: QaSubVerdict, metric: string): { tone: QaTone; reason: string | null } {
  const blames = reasonBlames(sub)
  const own = blames.filter((b) => b.metric === metric)
  if (own.length > 0) {
    const worst = own.find((b) => b.tone === 'reject') ?? own[0]!
    return { tone: worst.tone, reason: worst.reason }
  }
  const overall = toneFor(sub.verdict)
  if (overall === 'pass' || blames.length > 0) return { tone: 'pass', reason: null }
  return { tone: overall, reason: null }
}

export function bucketSubs(
  subs: readonly QaSubVerdict[],
  metric: keyof QaSubVerdict['metrics'],
  buckets: number,
): ChartBucket[] {
  if (subs.length === 0) return []
  const size = Math.max(1, Math.ceil(subs.length / buckets))
  const direction = metricDirection(metric)
  const out: ChartBucket[] = []

  for (let start = 0; start < subs.length; start += size) {
    const slice = subs.slice(start, start + size)
    const analysed = slice.filter((sub) => !isUnanalysed(sub))
    const values = analysed
      .map((sub) => measuredValue(sub, metric))
      .filter((v): v is number => v != null)

    let tone: QaTone = 'pass'
    let reason: string | null = null
    for (const sub of analysed) {
      const t = metricTone(sub, metric)
      if (TONE_SEVERITY[t.tone] > TONE_SEVERITY[tone]) {
        tone = t.tone
        reason = t.reason
      }
    }

    out.push({
      value: values.length ? worstValue(values, direction) : null,
      tone,
      reason,
      verdicts: [...new Set(analysed.map((sub) => sub.verdict))],
      startIndex: start,
      count: slice.length,
      unanalysed: slice.length - analysed.length,
    })
  }
  return out
}

function worstValue(values: readonly number[], direction: MetricDirection | undefined): number {
  if (direction === 'ceiling') return Math.max(...values)
  if (direction === 'floor') return Math.min(...values)
  // No server cutoff on this metric (hfr, background), so no "worse" side to
  // favour. Neither is charted today; the mean is the neutral summary.
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Cutoff lines for one metric's chart, from `summary.thresholds`.
 *
 * This is a field-to-chart MAPPING, not a computation: it says which of the
 * server's threshold fields belong on the eccentricity chart and which on the
 * star-count chart, and nothing else. No value is derived, compared or
 * defaulted. A null or missing threshold yields no line — never a line at
 * zero, which would draw a cutoff the server explicitly declined to state.
 *
 * The label carries the DIRECTION, because the two senses read identically on
 * a linear axis and a label that gets it wrong is worse than no label:
 * eccentricity/FWHM/scattered-light cutoffs are ceilings (above is worse),
 * `snr_floor` and `star_count_floor` are floors (below is worse).
 */
export interface ThresholdLine {
  value: number
  label: string
  tone: 'marginal' | 'reject'
}

/** Which way a metric's cutoffs face: a `ceiling` is crossed going UP
 * (bigger is worse), a `floor` going DOWN. */
export type MetricDirection = 'ceiling' | 'floor'

const THRESHOLD_FIELDS: Partial<
  Record<
    string,
    {
      direction: MetricDirection
      fields: ReadonlyArray<{ field: string; label: string; tone: 'marginal' | 'reject' }>
    }
  >
> = {
  eccentricity: {
    direction: 'ceiling',
    fields: [
      { field: 'eccentricity_marginal', label: 'marginal', tone: 'marginal' },
      { field: 'eccentricity_reject', label: 'reject', tone: 'reject' },
    ],
  },
  fwhm: {
    direction: 'ceiling',
    fields: [
      { field: 'fwhm_marginal', label: 'marginal', tone: 'marginal' },
      { field: 'fwhm_reject', label: 'reject', tone: 'reject' },
    ],
  },
  scattered_light: {
    direction: 'ceiling',
    fields: [
      { field: 'scattered_light_marginal', label: 'marginal', tone: 'marginal' },
      { field: 'scattered_light_reject', label: 'reject', tone: 'reject' },
    ],
  },
  snr: { direction: 'floor', fields: [{ field: 'snr_floor', label: 'floor', tone: 'reject' }] },
  star_count: {
    direction: 'floor',
    fields: [{ field: 'star_count_floor', label: 'floor', tone: 'reject' }],
  },
}

/** The direction of `metric`'s server cutoffs, or undefined for a metric the
 * server draws no cutoff on (hfr, background). */
export function metricDirection(metric: string): MetricDirection | undefined {
  return THRESHOLD_FIELDS[metric]?.direction
}

export function thresholdLinesFor(
  metric: string,
  thresholds: Record<string, number | null | undefined> | undefined,
): ThresholdLine[] {
  if (thresholds == null) return []
  return (THRESHOLD_FIELDS[metric]?.fields ?? []).flatMap(({ field, label, tone }) => {
    const value = thresholds[field]
    if (typeof value !== 'number') return []
    // The number is the server's; the label states which cutoff it is and,
    // for a floor, that it is one.
    return [{ value, label: `${label} ${value}`, tone }]
  })
}

/**
 * True when a chart's MARGINAL line lies beyond its REJECT line in the
 * metric's bad direction — above it for a ceiling, below it for a floor.
 *
 * seestar-mcp contract 1.1.1 guarantees the marginal line is never past the
 * reject line, but a report cached before it can carry the pair inverted, and
 * drawing them as sent without comment would show a marginal band that
 * begins after the rejections do. This compares the server's two cutoffs to
 * EACH OTHER to spot an inconsistent payload; it never compares a sub's
 * value to either, and decides no verdict. Equal is not inverted — 1.1.1
 * clamps the marginal line to at most the reject line, so they can coincide.
 */
export function cutoffsInverted(metric: string, lines: readonly ThresholdLine[]): boolean {
  const direction = metricDirection(metric)
  const marginal = lines.find((l) => l.tone === 'marginal')
  const reject = lines.find((l) => l.tone === 'reject')
  if (direction == null || marginal == null || reject == null) return false
  return direction === 'ceiling' ? marginal.value > reject.value : marginal.value < reject.value
}

/** Format a metric for display. The server already rounds to 4dp at the wire
 * boundary (seestar-mcp f51a1e2); this is about column width, not precision. */
export function formatMetric(value: number | null | undefined, dp = 2): string {
  if (value == null) return '—'
  return value.toFixed(dp)
}

/** `kept / total` as a percentage string, or `—` when there is nothing to
 * divide by. Never renders `0.0%` for an empty session — that reads as a
 * catastrophic night rather than an absent one. */
export function keptPercent(summary: QaSummary): string {
  if (summary.total === 0) return '—'
  return `${((summary.kept / summary.total) * 100).toFixed(1)}%`
}
