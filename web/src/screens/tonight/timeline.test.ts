import { describe, expect, it } from 'vitest'
import { buildScale, minutesBetween, parse, spanToPercent } from './timeline'

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
    // M76's recorded best_window_utc: 19:48:37.986 to 22:10:55.589 UTC.
    expect(
      minutesBetween(['2026-09-24T19:48:37.986', '2026-09-24T22:10:55.589']),
    ).toBe(142)
  })
})
