import { describe, expect, it } from 'vitest'
import { bandRegion, pctFromTop } from './bandGeometry'

describe('pctFromTop', () => {
  it('puts zenith (90°) at the top and the horizon (0°) at the bottom', () => {
    expect(pctFromTop(90)).toBe(0)
    expect(pctFromTop(0)).toBe(100)
  })

  it('reproduces the design\'s own worked example — 54.2° reads near the middle-lower area', () => {
    expect(pctFromTop(54.2)).toBeCloseTo(39.8, 1)
  })

  it('clamps rather than overflowing the track on an out-of-range reading', () => {
    expect(pctFromTop(120)).toBe(0)
    expect(pctFromTop(-10)).toBe(100)
  })
})

describe('bandRegion', () => {
  it('matches the design\'s own worked example — 60° ceiling, 25° floor', () => {
    const region = bandRegion(60, 25)
    expect(region.topPct).toBeCloseTo(33.3, 1)
    expect(region.topPct + region.heightPct).toBeCloseTo(pctFromTop(25), 1)
  })

  it('derives from the actual site figures, not a hardcoded percentage', () => {
    const a = bandRegion(60, 25)
    const b = bandRegion(45, 20)
    expect(a.topPct).not.toBe(b.topPct)
  })

  it('never reports a negative height even if the floor were misconfigured above the ceiling', () => {
    expect(bandRegion(25, 60).heightPct).toBe(0)
  })
})
