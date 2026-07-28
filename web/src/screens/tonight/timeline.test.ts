import { describe, expect, it } from 'vitest'
import { buildScale, spanToPercent } from './timeline'

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
})
