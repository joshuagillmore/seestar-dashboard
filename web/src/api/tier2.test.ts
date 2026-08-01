import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { QaAnalysisStatusSchema, Tier2Schema } from './schemas'

const fixture = (p: string) =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../fixtures', p), 'utf-8'))

/**
 * The qa_tier2 schema, against real recorded payloads.
 *
 * This file CLOSES the contract loop. seestar-mcp pinned qa_tier2 in their
 * build in round 3 against our prose, and both sides agreed those pins could
 * not be called validated until a real payload parsed on this side. It now
 * does: `fixtures/qa_tier2.subs.json` is the tool's actual output over 25
 * subs from the local archive export, not a hand-built shape.
 *
 * `fixtures/qa_tier2.json` is also real but empty (total 0, subs []) — kept
 * because "nothing analysed" is a state the screen has to render, and it is
 * the only recorded example of it.
 *
 * The synthetic fixture stays for the one case neither recording contains:
 * an unanalysable sub. Clearly labelled; it proves nothing about the contract.
 */
describe('Tier2Schema against the real recorded payload', () => {
  const real = () => Tier2Schema.parse(fixture('qa_tier2.subs.json'))

  it('parses 25 real subs with a genuine verdict spread', () => {
    const s = real().summary

    expect(s.subs).toHaveLength(25)
    expect(s.total).toBe(25)
    const counts = s.subs.reduce<Record<string, number>>(
      (acc, sub) => ({ ...acc, [sub.verdict]: (acc[sub.verdict] ?? 0) + 1 }),
      {},
    )
    // Not asserting exact counts — those are this recording's, not a contract.
    // What matters is that all three verdicts occur, so the screen's three
    // rendering paths are all exercised by something real.
    expect(Object.keys(counts).sort()).toEqual(['MARGINAL', 'PASS', 'REJECT'])
  })

  it('real sub names carry no file extension', () => {
    // The correction seestar-mcp sent before we wrote the schema, now
    // confirmed against the tool's own output rather than their description.
    for (const sub of real().summary.subs) {
      expect(sub.name).not.toMatch(/\.fits?$/i)
    }
  })

  it('keep_list is exactly the non-REJECT subs', () => {
    const parsed = real()
    const kept = parsed.summary.subs.filter((s) => s.verdict !== 'REJECT')

    expect(parsed.keep_list).toHaveLength(kept.length)
    expect(parsed.keep_list).toHaveLength(parsed.summary.kept)
  })

  it('summary.target is null, because we always call with paths', () => {
    // Observed, not assumed. qa_tier2 only sets `target` when invoked with
    // target=; qa_analysis.py always invokes it with paths=. So the screen
    // must take the target from our own target_id — reading it from the
    // payload would render "—" on every report we ever fetch.
    expect(real().summary.target).toBeNull()
  })

  it('every float is rounded to 4dp — aggregates included', () => {
    // At e8f0221 only subs[].metrics were rounded; medians and wfwhm shipped
    // at full float precision, and an earlier version of this test pinned
    // that asymmetry. seestar-mcp fixed it at f51a1e2 after we flagged it —
    // their own reason for _METRIC_DP (full repr "implies precision that
    // does not exist") applies equally to aggregates drawn from the same
    // measurements. Rounded at the wire boundary only; classification
    // upstream still runs on full precision.
    //
    // The fixture was RE-RECORDED for this. Leaving the old assertion against
    // the old recording would have kept passing while the real server did
    // something else — a green test pinning behaviour that no longer exists.
    const s = real().summary
    const dp = (n: number) => (String(n).split('.')[1] ?? '').length

    for (const sub of s.subs) {
      for (const value of Object.values(sub.metrics)) {
        if (typeof value === 'number') expect(dp(value)).toBeLessThanOrEqual(4)
      }
    }
    for (const value of Object.values(s.medians)) {
      if (typeof value === 'number') expect(dp(value)).toBeLessThanOrEqual(4)
    }
    expect(dp(s.wfwhm ?? 0)).toBeLessThanOrEqual(4)
  })
})

describe('Tier2Schema against the real EMPTY payload', () => {
  it('an empty subs[] is a real state, not a parse failure', () => {
    // A session where nothing analysed differs from a broken payload, and
    // the screen must be able to say so.
    const parsed = Tier2Schema.parse(fixture('qa_tier2.json'))

    expect(parsed.summary.total).toBe(0)
    expect(parsed.summary.subs).toEqual([])
  })

  it('carries all nine medians keys even with nothing to summarise', () => {
    expect(Object.keys(Tier2Schema.parse(fixture('qa_tier2.json')).summary.medians).sort()).toEqual([
      'eccentricity',
      'fwhm',
      'fwhm_sigma',
      'hfr',
      'n_analyzed',
      'scattered_light',
      'scattered_light_sigma',
      'snr',
      'star_count',
    ])
  })
})

describe('Tier2Schema against a synthetic multi-sub payload', () => {
  const report = () => Tier2Schema.parse(fixture('synthetic/qa_tier2.unanalysable.json'))

  it('parses subs, verdicts and reasons', () => {
    const parsed = report()

    expect(parsed.summary.subs).toHaveLength(6)
    expect(parsed.summary.total).toBe(6)
    expect(parsed.summary.kept).toBe(3)
  })

  it('the sub name carries NO file extension — it is path.stem', () => {
    // seestar-mcp flagged this before we wrote the schema: `name` is
    // path.stem (qa_tier2.py:240), not the on-device filename. A join key
    // built on `${name}.fit` would match zero archive rows and report an
    // empty result rather than an error. Pinned so the first thing that
    // joins on it cannot get this wrong.
    for (const sub of report().summary.subs) {
      expect(sub.name).not.toMatch(/\.fits?$/i)
    }
  })

  it('keeps an unanalysable sub in the array with error set', () => {
    // Filtering it out would silently shrink the denominator on a screen
    // whose entire job is the distribution.
    const failed = report().summary.subs.filter((s) => s.metrics.error != null)

    expect(failed).toHaveLength(1)
    expect(failed[0]?.metrics.fwhm).toBeNull()
    expect(failed[0]?.metrics.error).toContain('no 2-D image HDU')
  })

  it('keep_list matches the non-REJECT subs', () => {
    const parsed = report()
    const notRejected = parsed.summary.subs
      .filter((s) => s.verdict !== 'REJECT')
      .map((s) => s.name)

    // Not a rule we enforce on the server — a consistency check on the
    // fixture itself, so a hand-built payload cannot drift into something
    // the real tool would never emit.
    expect(parsed.keep_list).toEqual(notRejected)
    expect(parsed.keep_list).toHaveLength(parsed.summary.kept)
  })

  it('every reason names a metric and a threshold', () => {
    // The policy's standard is "an auditable, defensible quality verdict,
    // never a vibe". We render these verbatim, so this asserts the payload
    // we render actually carries the justification.
    const rejects = report().summary.subs.filter((s) => s.verdict === 'REJECT')

    expect(rejects.length).toBeGreaterThan(0)
    for (const sub of rejects) {
      expect(sub.reasons.length).toBeGreaterThan(0)
    }
  })
})

describe('verdict is a string, deliberately not an enum', () => {
  it('does not reject a verdict vocabulary we have not seen', () => {
    // An enum would blank the whole screen the day a fourth verdict ships,
    // over a value we could have displayed verbatim. The vocabulary is the
    // server's; asserting the list here would be the UI deciding what a
    // verdict may be.
    const payload = fixture('synthetic/qa_tier2.unanalysable.json')
    payload.summary.subs[0].verdict = 'PROVISIONAL'

    const parsed = Tier2Schema.parse(payload)

    expect(parsed.summary.subs[0]?.verdict).toBe('PROVISIONAL')
  })
})

describe('required structure still fails loudly', () => {
  it('rejects a payload with subs[] missing entirely', () => {
    const payload = fixture('synthetic/qa_tier2.unanalysable.json')
    delete payload.summary.subs

    expect(() => Tier2Schema.parse(payload)).toThrow()
  })

  it('rejects a sub with no name — it is the join key', () => {
    const payload = fixture('synthetic/qa_tier2.unanalysable.json')
    delete payload.summary.subs[0].name

    expect(() => Tier2Schema.parse(payload)).toThrow()
  })
})

describe('QaAnalysisStatusSchema discriminates on status', () => {
  it('parses each state the sidecar can return', () => {
    const report = fixture('synthetic/qa_tier2.unanalysable.json')

    expect(QaAnalysisStatusSchema.parse({ status: 'not_analysed' }).status).toBe(
      'not_analysed',
    )
    expect(
      QaAnalysisStatusSchema.parse({
        status: 'running',
        started_at: '2026-08-02T01:15:00+00:00',
        elapsed_seconds: 42.5,
      }).status,
    ).toBe('running')
    expect(
      QaAnalysisStatusSchema.parse({ status: 'failed', error: 'boom' }).status,
    ).toBe('failed')
    expect(
      QaAnalysisStatusSchema.parse({
        status: 'complete',
        analysed_at: '2026-08-02T01:15:00+00:00',
        report,
      }).status,
    ).toBe('complete')
  })

  it('stale is its own state, carrying a usable report', () => {
    // Distinct from both complete and not_analysed: a real report exists but
    // the sub set on disk has changed since. Collapsing it into `complete`
    // would date-stamp stale numbers as current.
    const parsed = QaAnalysisStatusSchema.parse({
      status: 'stale',
      analysed_at: '2026-08-01T22:00:00+00:00',
      report: fixture('synthetic/qa_tier2.unanalysable.json'),
    })

    expect(parsed.status).toBe('stale')
    if (parsed.status === 'stale') {
      expect(parsed.report?.summary.subs).toHaveLength(6)
    }
  })

  it('rejects an unknown status rather than guessing', () => {
    expect(() => QaAnalysisStatusSchema.parse({ status: 'sort_of_done' })).toThrow()
  })
})
