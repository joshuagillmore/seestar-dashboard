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
import { makeSub, noStarsSub, serverReason } from './testReasons'

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
    const sub = { ...real().subs[0]!, reasons: [serverReason.pass] }

    expect(blamedMetrics(sub).size).toBe(0)
  })

  it('recognises the server’s own star-count token, `star_count`', () => {
    // The server writes `star_count`, with the underscore. Matching "star
    // count" / "stars" missed every cloud reject the server has ever sent.
    const sub = makeSub('cloudy', 'REJECT', [serverReason.starReject(12, 16, 32)], {
      star_count: 12,
    })

    expect(blamedMetrics(sub).get('star_count')).toBe('reject')
  })

  it('recognises every metric token the server’s reasons use', () => {
    const sub = makeSub('all', 'REJECT', [
      serverReason.eccReject(0.93, 0.9),
      serverReason.fwhmReject(2.8, 2.74, 2.61),
      serverReason.snrReject(20.1, 25.69, 51.38),
      serverReason.starReject(12, 16, 32),
      serverReason.scatterReject(0.016, 0.014),
    ])

    expect([...blamedMetrics(sub).keys()].sort()).toEqual([
      'eccentricity',
      'fwhm',
      'scattered_light',
      'snr',
      'star_count',
    ])
  })

  it('tones each blamed metric by ITS OWN reason’s prefix, not the sub’s verdict', () => {
    // Real sub 17 of the M 81 recording: REJECT overall, for FWHM — and
    // MARGINAL for eccentricity. Colouring the eccentricity cell with the
    // sub's REJECT paints a marginal measurement as a rejection.
    const sub17 = real().subs.find(
      (s) => s.verdict === 'REJECT' && s.reasons.some((r) => r.startsWith('MARGINAL:')),
    )!
    const blamed = blamedMetrics(sub17)

    expect(blamed.get('fwhm')).toBe('reject')
    expect(blamed.get('eccentricity')).toBe('marginal')
  })

  it('a metric named by both a MARGINAL and a REJECT reason takes the worse', () => {
    const sub = makeSub('both', 'REJECT', [
      serverReason.fwhmMarginal(2.7, 2.69, 2.61),
      serverReason.fwhmReject(2.8, 2.74, 2.61),
    ])

    expect(blamedMetrics(sub).get('fwhm')).toBe('reject')
  })

  it('blames nothing on a sub the server could not analyse', () => {
    // "could not analyze: no stars detected" contains "stars", and the sub
    // carries star_count 0 — but it was never scored, so nothing was blamed.
    expect(blamedMetrics(noStarsSub('dark')).size).toBe(0)
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
        makeSub('x', 'REJECT', [
          serverReason.starReject(173, 206, 412),
          serverReason.snrReject(6.4, 7.39, 14.77),
        ]),
      ],
    }
    const causes = rejectionsByCause(summary)

    // Deliberately not a partition — both are true of the sub, and the panel
    // is labelled by cause rather than presented as a breakdown that sums.
    expect(causes.map((c) => c.cause).sort()).toEqual(['snr', 'star_count'])
  })

  it('counts a cloudy night’s star-count rejects — the cloud signal', () => {
    const summary = {
      ...real(),
      subs: [1, 2, 3].map((i) =>
        makeSub(`cloud${i}`, 'REJECT', [serverReason.starReject(10 + i, 16, 32)]),
      ),
    }

    expect(rejectionsByCause(summary)).toEqual([{ cause: 'star_count', count: 3 }])
  })

  it('counts only REJECT reasons, never a MARGINAL one on a rejected sub', () => {
    // Real sub 17: rejected for FWHM, merely marginal on eccentricity. It is
    // not an eccentricity reject.
    const causes = rejectionsByCause(real())

    expect(causes.find((c) => c.cause === 'eccentricity')).toBeUndefined()
    expect(causes.find((c) => c.cause === 'fwhm')?.count).toBe(2)
  })

  it('files an unanalysable reject under the server’s own `error` cause, not star count', () => {
    const summary = { ...real(), subs: [noStarsSub('a'), noStarsSub('b')] }

    expect(rejectionsByCause(summary)).toEqual([{ cause: 'error', count: 2 }])
  })

  it('never drops a reject whose reasons name no metric it recognises', () => {
    // A vocabulary change must not turn a rejected night into "nothing
    // rejected". Counted, and labelled as unattributed.
    const summary = {
      ...real(),
      subs: [makeSub('odd', 'REJECT', ['REJECT: plate solve failed'])],
    }

    expect(rejectionsByCause(summary)).toEqual([{ cause: 'unattributed', count: 1 }])
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

  const passing = (name: string, eccentricity: number, star_count = 30) =>
    makeSub(name, 'PASS', [serverReason.pass], { eccentricity, star_count })

  it('a bucket takes the WORST verdict it contains, never an average', () => {
    // One reject inside forty passes has to stay visible — averaging tones
    // would hide the exact event the chart exists to show.
    const subs = [
      passing('a', 0.4),
      passing('b', 0.41),
      makeSub('c', 'REJECT', [serverReason.eccReject(0.93, 0.9)], { eccentricity: 0.93 }),
      passing('d', 0.39),
    ]

    expect(bucketSubs(subs, 'eccentricity', 1)[0]!.tone).toBe('reject')
  })

  it('a bucket is as tall as its WORST value in the bad direction, never the mean', () => {
    // The mean of forty good subs and one outlier sits below the cutoff line
    // — the outlier drawn as if it had cleared it.
    const subs = [
      passing('a', 0.4, 30),
      makeSub('b', 'REJECT', [serverReason.eccReject(0.93, 0.9)], {
        eccentricity: 0.93,
        star_count: 31,
      }),
      makeSub('c', 'REJECT', [serverReason.starReject(9, 16, 32)], {
        eccentricity: 0.41,
        star_count: 9,
      }),
    ]

    // Eccentricity is a ceiling: worst is the largest.
    expect(bucketSubs(subs, 'eccentricity', 1)[0]!.value).toBe(0.93)
    // Star count is a floor: worst is the smallest.
    expect(bucketSubs(subs, 'star_count', 1)[0]!.value).toBe(9)
  })

  it('tones a bucket by the reasons that blame THIS metric, not the sub’s verdict', () => {
    // Rejected for FWHM, clean on eccentricity: its eccentricity bar must not
    // be painted as a rejection.
    const fwhmOnly = makeSub('f', 'REJECT', [serverReason.fwhmReject(2.8, 2.74, 2.61)], {
      eccentricity: 0.4,
      fwhm: 2.8,
    })
    expect(bucketSubs([fwhmOnly], 'eccentricity', 60)[0]!.tone).toBe('pass')
    expect(bucketSubs([fwhmOnly], 'fwhm', 60)[0]!.tone).toBe('reject')

    // Real sub 17: REJECT overall, MARGINAL on eccentricity.
    const sub17 = real().subs.find(
      (s) => s.verdict === 'REJECT' && s.reasons.some((r) => r.startsWith('MARGINAL:')),
    )!
    const [bucket] = bucketSubs([sub17], 'eccentricity', 60)
    expect(bucket!.tone).toBe('marginal')
    // And carries the server's sentence, so the bar can say why.
    expect(bucket!.reason).toMatch(/^MARGINAL: eccentricity /)
  })

  it('falls back to the sub’s own verdict when no reason can be attributed', () => {
    // A reason format we do not recognise must not quietly turn a reject
    // into a clean-looking bar.
    const odd = makeSub('odd', 'REJECT', ['REJECT: plate solve failed'], { eccentricity: 0.4 })

    expect(bucketSubs([odd], 'eccentricity', 60)[0]!.tone).toBe('reject')
  })

  it('a bucket with no measurable values has a null value, not a zero', () => {
    const subs = unanalysable().subs.filter(isUnanalysed)

    const [bucket] = bucketSubs(subs, 'eccentricity', 1)

    // Zero would plot as a bar at the floor — a measured-looking value for a
    // sub that was never measured.
    expect(bucket!.value).toBeNull()
  })

  it('leaves an unanalysed sub out of its bucket — no zero star count, no reject tone', () => {
    // The server sends star_count 0 on the error path. Kept, it drew a red
    // zero bar on the star-count chart and dragged the bucket down.
    const [alone] = bucketSubs([noStarsSub('dark')], 'star_count', 60)
    expect(alone!.value).toBeNull()

    const [mixed] = bucketSubs([passing('a', 0.4, 30), noStarsSub('dark')], 'star_count', 1)
    expect(mixed!.value).toBe(30)
    expect(mixed!.tone).toBe('pass')
    expect(mixed!.unanalysed).toBe(1)
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
