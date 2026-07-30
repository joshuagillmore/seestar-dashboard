import { describe, expect, it } from 'vitest'
import { buildScale, formatUtcOffset, minutesBetween, parse, spanToPercent, zoneLabel } from './timeline'

describe('timeline scale', () => {
  const scale = buildScale(['2026-09-24T19:49:29.005', '2026-09-25T03:54:29.005'])

  it('pads an hour each side and rounds outward to the hour', () => {
    expect(scale.startMs).toBe(Date.parse('2026-09-24T18:00:00Z'))
    expect(scale.endMs).toBe(Date.parse('2026-09-25T05:00:00Z'))
  })

  it('places the dark window inside the padded axis', () => {
    const { left, width } = spanToPercent(scale, [
      '2026-09-24T19:49:29.005',
      '2026-09-25T03:54:29.005',
    ])
    expect(left).toBeGreaterThan(0)
    expect(left + width).toBeLessThan(100)
  })

  it('clamps a span that runs past the axis', () => {
    const { left, width } = spanToPercent(scale, [
      '2026-07-28T00:00:00.000',
      '2026-07-28T12:00:00.000',
    ])
    expect(left).toBe(0)
    expect(width).toBe(100)
  })

  it('produces one hourly tick per hour of the axis', () => {
    expect(scale.ticks).toHaveLength(12) // 18:00 through 05:00 inclusive, across midnight
  })

  it('collapses a span entirely outside the axis rather than going negative', () => {
    const before = spanToPercent(scale, [
      '2026-07-27T20:00:00.000',
      '2026-07-27T22:00:00.000',
    ])
    expect(before).toEqual({ left: 0, width: 0 })
    const after = spanToPercent(scale, [
      '2026-07-28T10:00:00.000',
      '2026-07-28T12:00:00.000',
    ])
    expect(after).toEqual({ left: 100, width: 0 })
  })

  it('parses UTC timestamps with or without a trailing Z identically', () => {
    // The component appends nothing of its own now; a double-Z would be NaN.
    expect(parse('2026-07-28T02:00:00.000')).toBe(parse('2026-07-28T02:00:00.000Z'))
  })

  it('returns the whole-minute span between two timestamps', () => {
    // M76's recorded best_window_utc: 19:43:23.680 to 22:03:40.684 UTC.
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

describe('zoneLabel', () => {
  it('names the zone the machine running the test is actually in, in the same shape formatUtcOffset produces', () => {
    // Cannot pin an exact value without depending on the runner's own system
    // zone (exactly the trap localHhMm's own untested-output gap warned
    // about) — so this asserts the real Date-based wiring holds by checking
    // it agrees with formatUtcOffset called on that same instant's real
    // offset, and that the shape is well-formed either way.
    const ms = Date.parse('2026-07-30T12:00:00Z')
    expect(zoneLabel(ms)).toBe(formatUtcOffset(-new Date(ms).getTimezoneOffset()))
    expect(zoneLabel(ms)).toMatch(/^UTC([+-]\d{1,2}(:\d{2})?)?$/)
  })
})
