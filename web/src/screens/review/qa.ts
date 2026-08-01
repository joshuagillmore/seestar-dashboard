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
 * Which metrics a sub's own `reasons[]` actually blame.
 *
 * The design highlights the offending metric cell in a row. That means
 * knowing WHICH metric failed — and the only honest source is the server's
 * own reason text, which names it. We match metric NAMES against the reason
 * strings; we never compare a value to a threshold to decide.
 *
 * The match is on the vocabulary the server uses in its own messages
 * ("scattered light 0.016 > 0.014 (median + 2σ)"), so a reason that names no
 * metric simply highlights nothing rather than guessing at one.
 */
const METRIC_PHRASES: ReadonlyArray<readonly [keyof QaSubVerdict['metrics'], readonly string[]]> = [
  ['fwhm', ['fwhm']],
  ['eccentricity', ['eccentricity', 'ecc ']],
  ['snr', ['snr']],
  ['star_count', ['star count', 'stars']],
  ['scattered_light', ['scattered light', 'scatter']],
  ['hfr', ['hfr']],
  ['background', ['background']],
]

export function blamedMetrics(sub: QaSubVerdict): Set<string> {
  const blamed = new Set<string>()
  const haystack = sub.reasons.join(' ').toLowerCase()
  for (const [metric, phrases] of METRIC_PHRASES) {
    if (phrases.some((phrase) => haystack.includes(phrase))) blamed.add(metric)
  }
  return blamed
}

/**
 * Reject counts per cause, for the "rejections by cause" panel.
 *
 * Counts a sub under every metric its reasons name — a sub rejected for both
 * star count and SNR appears under both, because both are true of it. The
 * totals therefore do not sum to the reject count, which is correct and is
 * why the panel is labelled by cause rather than presented as a partition.
 */
export function rejectionsByCause(summary: QaSummary): Array<{ cause: string; count: number }> {
  const counts = new Map<string, number>()
  for (const sub of summary.subs) {
    if (toneFor(sub.verdict) !== 'reject') continue
    for (const metric of blamedMetrics(sub)) {
      counts.set(metric, (counts.get(metric) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause))
}

/** Human label for a metric key. Presentation only. */
export const METRIC_LABELS: Record<string, string> = {
  fwhm: 'FWHM',
  hfr: 'HFR',
  eccentricity: 'eccentricity',
  snr: 'SNR',
  star_count: 'star count',
  scattered_light: 'scattered light',
  background: 'background',
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
 * When it does aggregate, a bucket takes the WORST verdict it contains rather
 * than an average: a single reject inside a bucket of forty must stay
 * visible, and averaging tones would hide exactly the event the chart exists
 * to show.
 */
export interface ChartBucket {
  /** Mean of the non-null values in the bucket, or null if none had one. */
  value: number | null
  tone: QaTone
  /** Index of the first sub in this bucket, for the axis. */
  startIndex: number
  count: number
}

const TONE_SEVERITY: Record<QaTone, number> = { pass: 0, unknown: 1, marginal: 2, reject: 3 }

export function bucketSubs(
  subs: readonly QaSubVerdict[],
  metric: keyof QaSubVerdict['metrics'],
  buckets: number,
): ChartBucket[] {
  if (subs.length === 0) return []
  const size = Math.max(1, Math.ceil(subs.length / buckets))
  const out: ChartBucket[] = []

  for (let start = 0; start < subs.length; start += size) {
    const slice = subs.slice(start, start + size)
    const values = slice
      .map((sub) => sub.metrics[metric])
      .filter((v): v is number => typeof v === 'number')
    const worst = slice.reduce<QaTone>((acc, sub) => {
      const tone = toneFor(sub.verdict)
      return TONE_SEVERITY[tone] > TONE_SEVERITY[acc] ? tone : acc
    }, 'pass')

    out.push({
      value: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      tone: worst,
      startIndex: start,
      count: slice.length,
    })
  }
  return out
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

const THRESHOLD_FIELDS: Partial<
  Record<string, ReadonlyArray<{ field: string; label: string; tone: 'marginal' | 'reject' }>>
> = {
  eccentricity: [
    { field: 'eccentricity_marginal', label: 'marginal', tone: 'marginal' },
    { field: 'eccentricity_reject', label: 'reject', tone: 'reject' },
  ],
  fwhm: [
    { field: 'fwhm_marginal', label: 'marginal', tone: 'marginal' },
    { field: 'fwhm_reject', label: 'reject', tone: 'reject' },
  ],
  scattered_light: [
    { field: 'scattered_light_marginal', label: 'marginal', tone: 'marginal' },
    { field: 'scattered_light_reject', label: 'reject', tone: 'reject' },
  ],
  snr: [{ field: 'snr_floor', label: 'floor', tone: 'reject' }],
  star_count: [{ field: 'star_count_floor', label: 'floor', tone: 'reject' }],
}

export function thresholdLinesFor(
  metric: string,
  thresholds: Record<string, number | null | undefined> | undefined,
): ThresholdLine[] {
  if (thresholds == null) return []
  return (THRESHOLD_FIELDS[metric] ?? []).flatMap(({ field, label, tone }) => {
    const value = thresholds[field]
    if (typeof value !== 'number') return []
    // The number is the server's; the label states which cutoff it is and,
    // for a floor, that it is one.
    return [{ value, label: `${label} ${value}`, tone }]
  })
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
