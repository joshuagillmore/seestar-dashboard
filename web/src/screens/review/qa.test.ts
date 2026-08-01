import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Tier2Schema } from '../../api/schemas'
import {
  blamedMetrics,
  bucketSubs,
  isUnanalysed,
  keptPercent,
  rejectionsByCause,
  thresholdLinesFor,
  toneFor,
} from './qa'

const fixture = (p: string) =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../../fixtures', p), 'utf-8'))

const real = () => Tier2Schema.parse(fixture('qa_tier2.subs.json')).summary
const unanalysable = () =>
  Tier2Schema.parse(fixture('synthetic/qa_tier2.unanalysable.json')).summary

describe('toneFor', () => {
  it('maps the three policy verdicts', () => {
    expect(toneFor('PASS')).toBe('pass')
    expect(toneFor('MARGINAL')).toBe('marginal')
    expect(toneFor('REJECT')).toBe('reject')
  })

  it('returns unknown for a verdict it has not seen, rather than guessing', () => {
    // The dangerous failure would be defaulting to 'pass' — a frame the
    // server flagged rendering as clean.
    expect(toneFor('PROVISIONAL')).toBe('unknown')
    expect(toneFor('')).toBe('unknown')
  })
})

describe('blamedMetrics — from the reason text, never from the numbers', () => {
  it('finds the metric the server named', () => {
    const sub = real().subs.find((s) => s.verdict === 'REJECT')!

    // Real reason: "REJECT: scattered light 0.016 > 0.014 (median + 2σ) …"
    expect(blamedMetrics(sub).has('scattered_light')).toBe(true)
  })

  it('blames nothing when the reason names no metric', () => {
    const sub = { ...real().subs[0]!, reasons: ['REJECT: could not analyse'] }

    expect(blamedMetrics(sub).size).toBe(0)
  })

  it('does not blame a metric just because its value looks bad', () => {
    // The whole point: a sub whose reasons name only scattered light must not
    // have its eccentricity cell highlighted because we thought it looked
    // high. Deciding that is the server's job.
    const sub = {
      ...real().subs[0]!,
      verdict: 'REJECT',
      reasons: ['REJECT: scattered light 0.9 > 0.1 (median + 2σ)'],
      metrics: { ...real().subs[0]!.metrics, eccentricity: 0.99, fwhm: 99 },
    }
    const blamed = blamedMetrics(sub)

    expect(blamed.has('scattered_light')).toBe(true)
    expect(blamed.has('eccentricity')).toBe(false)
    expect(blamed.has('fwhm')).toBe(false)
  })
})

describe('rejectionsByCause', () => {
  it('counts causes across the real payload', () => {
    const causes = rejectionsByCause(real())

    expect(causes.length).toBeGreaterThan(0)
    // Sorted by count descending.
    for (let i = 1; i < causes.length; i += 1) {
      expect(causes[i - 1]!.count).toBeGreaterThanOrEqual(causes[i]!.count)
    }
  })

  it('counts a multi-cause reject under every cause it names', () => {
    const summary = {
      ...real(),
      subs: [
        {
          name: 'x',
          verdict: 'REJECT',
          reasons: ['REJECT: star count 173 low', 'REJECT: SNR 6.4 low'],
          metrics: real().subs[0]!.metrics,
        },
      ],
    }
    const causes = rejectionsByCause(summary)

    // Deliberately not a partition — both are true of the sub, and the panel
    // is labelled by cause rather than presented as a breakdown that sums.
    expect(causes.map((c) => c.cause).sort()).toEqual(['snr', 'star_count'])
  })

  it('ignores non-rejected subs', () => {
    const summary = { ...real(), subs: real().subs.filter((s) => s.verdict === 'PASS') }

    expect(rejectionsByCause(summary)).toEqual([])
  })
})

describe('bucketSubs — aggregate without making sparse look dense', () => {
  it('never returns more bars than subs', () => {
    // The spec: "don't smooth them into looking like a 1386-sub stack".
    // An 8-sub target asked for 60 buckets must render 8 bars, not 60.
    const eight = { ...real(), subs: real().subs.slice(0, 8) }
    const buckets = bucketSubs(eight.subs, 'eccentricity', 60)

    expect(buckets).toHaveLength(8)
    expect(buckets.every((b) => b.count === 1)).toBe(true)
  })

  it('aggregates when there are more subs than buckets', () => {
    const buckets = bucketSubs(real().subs, 'eccentricity', 5)

    expect(buckets.length).toBeLessThanOrEqual(5)
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(real().subs.length)
  })

  it('a bucket takes the WORST verdict it contains, never an average', () => {
    // One reject inside forty passes has to stay visible — averaging tones
    // would hide the exact event the chart exists to show.
    const subs = [
      { ...real().subs[0]!, verdict: 'PASS' },
      { ...real().subs[0]!, verdict: 'PASS' },
      { ...real().subs[0]!, verdict: 'REJECT' },
      { ...real().subs[0]!, verdict: 'PASS' },
    ]

    expect(bucketSubs(subs, 'eccentricity', 1)[0]!.tone).toBe('reject')
  })

  it('a bucket with no measurable values has a null value, not a zero', () => {
    const subs = unanalysable().subs.filter(isUnanalysed)

    const [bucket] = bucketSubs(subs, 'eccentricity', 1)

    // Zero would plot as a bar at the floor — a measured-looking value for a
    // sub that was never measured.
    expect(bucket!.value).toBeNull()
  })

  it('handles an empty session without throwing', () => {
    expect(bucketSubs([], 'fwhm', 60)).toEqual([])
  })
})

describe('keptPercent', () => {
  it('reports the real payload', () => {
    // 19 of 25.
    expect(keptPercent(real())).toBe('76.0%')
  })

  it('renders an absent state for an empty session, not 0.0%', () => {
    // 0.0% reads as a catastrophic night; nothing analysed is a different
    // thing and the screen has to be able to say so.
    expect(keptPercent({ ...real(), total: 0, kept: 0 })).toBe('—')
  })
})

describe('isUnanalysed', () => {
  it('is driven by metrics.error, not by null metrics', () => {
    expect(unanalysable().subs.filter(isUnanalysed)).toHaveLength(1)
    expect(real().subs.filter(isUnanalysed)).toHaveLength(0)
  })
})

describe('thresholdLinesFor — maps server fields to charts, decides nothing', () => {
  const thresholds = () => Tier2Schema.parse(fixture('qa_tier2.subs.json')).summary.thresholds

  it('gives eccentricity its two cutoffs, with the server\u2019s own numbers', () => {
    const lines = thresholdLinesFor('eccentricity', thresholds())
    const t = thresholds()!

    expect(lines.map((l) => l.value)).toEqual([
      t.eccentricity_marginal,
      t.eccentricity_reject,
    ])
    expect(lines.map((l) => l.tone)).toEqual(['marginal', 'reject'])
  })

  it('labels a floor as a floor, not as a reject ceiling', () => {
    // snr_floor and star_count_floor are FLOORS — below is worse. They plot
    // identically to a ceiling on a linear axis, so the label is the only
    // thing carrying the direction.
    const [line] = thresholdLinesFor('star_count', thresholds())

    expect(line!.label).toMatch(/^floor /)
  })

  it('returns nothing for a metric with no thresholds defined', () => {
    expect(thresholdLinesFor('background', thresholds())).toEqual([])
    expect(thresholdLinesFor('hfr', thresholds())).toEqual([])
  })

  it('returns nothing when the report predates the thresholds field', () => {
    expect(thresholdLinesFor('eccentricity', undefined)).toEqual([])
  })

  it('omits a null threshold rather than drawing a line at zero', () => {
    // The server sends null when a cutoff could not be computed — no
    // analysable subs on that axis. A line at 0 would assert a cutoff it
    // explicitly declined to state.
    // Deliberately NOT the real cutoff: src/test/no-thresholds.test.ts bans
    // the literal from source, and an obviously-synthetic value also stops a
    // reader mistaking a test input for the policy number.
    const SYNTHETIC = 0.9
    const lines = thresholdLinesFor('eccentricity', {
      eccentricity_marginal: null,
      eccentricity_reject: SYNTHETIC,
    })

    expect(lines).toHaveLength(1)
    expect(lines[0]!.value).toBe(SYNTHETIC)
  })
})
