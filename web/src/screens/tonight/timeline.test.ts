import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildScale,
  formatUtcOffset,
  localHhMm,
  minutesBetween,
  parse,
  spanToPercent,
  zoneLabel,
} from './timeline'

/**
 * Run a block under a fixed IANA zone. Node re-reads `process.env.TZ` on
 * assignment, so this pins the zone the Date APIs see — which is the only way
 * to test clock output without depending on wherever the runner happens to
 * be. Restored after each test, since a forked worker can be reused.
 */
function inZone(tz: string) {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env.TZ
    process.env.TZ = tz
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.TZ
    else process.env.TZ = saved
  })
}

describe('timeline scale', () => {
  // Pinned: the axis now aligns to LOCAL hours, so these UTC expectations are
  // only exact in a whole-hour zone. UTC is the simplest one.
  inZone('UTC')
  const scale = () => buildScale(['2026-09-24T19:48:37.257', '2026-09-25T03:53:37.257'])

  it('pads an hour each side and rounds outward to the hour', () => {
    expect(scale().startMs).toBe(Date.parse('2026-09-24T18:00:00Z'))
    expect(scale().endMs).toBe(Date.parse('2026-09-25T05:00:00Z'))
  })

  it('places the dark window inside the padded axis', () => {
    const { left, width } = spanToPercent(scale(), [
      '2026-09-24T19:48:37.257',
      '2026-09-25T03:53:37.257',
    ])
    expect(left).toBeGreaterThan(0)
    expect(left + width).toBeLessThan(100)
  })

  it('clamps a span that runs past the axis', () => {
    const { left, width } = spanToPercent(scale(), [
      '2026-09-24T12:00:00.000',
      '2026-09-25T12:00:00.000',
    ])
    expect(left).toBe(0)
    expect(width).toBe(100)
  })

  it('produces one hourly tick per hour of the axis', () => {
    expect(scale().ticks).toHaveLength(12) // 18:00 through 05:00 inclusive, across midnight
  })

  it('collapses a span entirely outside the axis rather than going negative', () => {
    const before = spanToPercent(scale(), [
      '2026-09-24T14:00:00.000',
      '2026-09-24T16:00:00.000',
    ])
    expect(before).toEqual({ left: 0, width: 0 })
    const after = spanToPercent(scale(), [
      '2026-09-25T06:00:00.000',
      '2026-09-25T08:00:00.000',
    ])
    expect(after).toEqual({ left: 100, width: 0 })
  })

  it('parses UTC timestamps with or without a trailing Z identically', () => {
    // The component appends nothing of its own now; a double-Z would be NaN.
    expect(parse('2026-07-28T02:00:00.000')).toBe(parse('2026-07-28T02:00:00.000Z'))
  })

  it('returns the whole-minute span between two timestamps', () => {
    // M76's fixture best_window_utc: 19:43:23.680 to 22:03:40.684 UTC.
    expect(
      minutesBetween(['2026-09-26T19:43:23.680', '2026-09-26T22:03:40.684']),
    ).toBe(140)
  })
})

describe('formatUtcOffset', () => {
  // Hand-picked offset minutes, not the test runner's own zone — this is the
  // same shape check the localHhMm gap called for: assertable without
  // depending on wherever CI or a contributor's machine happens to be.
  it('renders zero offset as bare UTC, matching the design label exactly at that one value', () => {
    expect(formatUtcOffset(0)).toBe('UTC')
  })

  it('renders a whole-hour negative offset (e.g. US Mountain Standard)', () => {
    expect(formatUtcOffset(-420)).toBe('UTC-7')
  })

  it('renders a whole-hour positive offset (e.g. Central European Summer)', () => {
    expect(formatUtcOffset(120)).toBe('UTC+2')
  })

  it('renders a fractional-hour offset (e.g. India Standard Time)', () => {
    expect(formatUtcOffset(330)).toBe('UTC+5:30')
  })

  it('zero-pads a remainder under ten minutes', () => {
    // No real IANA zone has a 5-minute remainder; this exercises padStart's
    // branch directly rather than leaving it uncovered.
    expect(formatUtcOffset(-425)).toBe('UTC-7:05')
  })
})

describe('zoneLabel — against fixed zones, not a re-run of its own formula', () => {
  // This used to assert zoneLabel(ms) === formatUtcOffset(-getTimezoneOffset())
  // — the implementation restated — so on a UTC runner a dropped minus sign
  // or a lost ":30" passed. Each case below pins a real zone and the literal
  // label it must produce.
  const JAN = Date.parse('2026-01-15T12:00:00Z')
  const SEP = Date.parse('2026-09-26T12:00:00Z')

  describe('UTC', () => {
    inZone('UTC')
    it('is bare UTC', () => expect(zoneLabel(SEP)).toBe('UTC'))
  })

  describe('a whole-hour zone west of Greenwich', () => {
    inZone('America/Denver')
    it('keeps its minus sign', () => expect(zoneLabel(JAN)).toBe('UTC-7'))
  })

  describe('a half-hour zone east (India)', () => {
    inZone('Asia/Kolkata')
    it('keeps its minutes', () => expect(zoneLabel(SEP)).toBe('UTC+5:30'))
  })

  describe('a half-hour zone east (Northern Territory)', () => {
    inZone('Australia/Darwin')
    it('keeps its minutes', () => expect(zoneLabel(SEP)).toBe('UTC+9:30'))
  })

  describe('a half-hour zone west (Newfoundland), both sides of DST', () => {
    inZone('America/St_Johns')
    it('winter', () => expect(zoneLabel(JAN)).toBe('UTC-3:30'))
    it('summer', () => expect(zoneLabel(SEP)).toBe('UTC-2:30'))
  })
})

describe('the hour axis in a half-hour zone', () => {
  // Ticks used to fall on UTC hours and be labelled by slicing the hour off
  // local HH:MM. In a :30 zone every UTC hour is HH:30 locally, so every label
  // was 30 minutes off. The ticks must sit on LOCAL hour boundaries.
  const DARK: [string, string] = ['2026-09-26T19:43:20.878', '2026-09-27T03:58:20.878']

  for (const tz of ['Asia/Kolkata', 'Australia/Darwin', 'America/St_Johns']) {
    describe(tz, () => {
      inZone(tz)

      it('puts every tick on a local hour', () => {
        const { ticks } = buildScale(DARK)
        for (const tick of ticks) expect(localHhMm(tick)).toMatch(/:00$/)
      })

      it('still pads the dark window by at least an hour each side', () => {
        const { startMs, endMs } = buildScale(DARK)
        expect(startMs).toBeLessThanOrEqual(parse(DARK[0]) - 3_600_000)
        expect(endMs).toBeGreaterThanOrEqual(parse(DARK[1]) + 3_600_000)
      })

      it('keeps ticks an hour apart, from the axis start to its end', () => {
        const { startMs, endMs, ticks } = buildScale(DARK)
        expect(ticks[0]).toBe(startMs)
        expect(ticks[ticks.length - 1]).toBe(endMs)
        for (let i = 1; i < ticks.length; i += 1) expect(ticks[i]! - ticks[i - 1]!).toBe(3_600_000)
      })
    })
  }
})

describe('parse — zone handling', () => {
  it('treats a zone-less timestamp as UTC, which is what plan_targets emits', () => {
    expect(parse('2026-09-27T19:42:11.660')).toBe(Date.parse('2026-09-27T19:42:11.660Z'))
  })

  it('respects an offset that is already present, instead of appending Z to it', () => {
    // Regression: /api/live_preview and /api/last_stack return
    // "2026-07-31T07:09:54.280000+00:00". The old helper appended Z to
    // anything not ending in Z, producing "...+00:00Z" — not a date. Both
    // preview panels rendered "Invalid Date" / "unknown date" on live
    // hardware, losing the timestamps that stop a stale frame posing as a
    // current one.
    const withOffset = '2026-07-31T07:09:54.280000+00:00'
    expect(Number.isNaN(parse(withOffset))).toBe(false)
    expect(parse(withOffset)).toBe(Date.parse('2026-07-31T07:09:54.280Z'))
  })

  it('accepts a non-UTC offset and a compact one', () => {
    expect(parse('2026-07-31T03:09:54.280-04:00')).toBe(Date.parse('2026-07-31T07:09:54.280Z'))
    expect(Number.isNaN(parse('2026-07-31T07:09:54.280+0000'))).toBe(false)
  })

  it('still accepts a trailing Z unchanged', () => {
    expect(parse('2026-07-31T07:09:54.280Z')).toBe(Date.parse('2026-07-31T07:09:54.280Z'))
  })
})

