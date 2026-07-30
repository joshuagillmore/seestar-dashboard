import { describe, expect, it } from 'vitest'
import { computeFraming, FRAME_CENTER_X, FRAME_CENTER_Y, FRAME_HEIGHT_PX, FRAME_WIDTH_PX } from './framing'

describe('computeFraming', () => {
  it('reproduces the design\'s own worked example from the general formula', () => {
    // design README.md:399/402 — pixel (512, 934) against a 540/960 centre
    // reads "512, 934" / "offset 28 px left — in frame". Not special-cased:
    // this is computeFraming's general arithmetic landing on the same number.
    const framing = computeFraming(512, 934)
    expect(framing.offsetPx).toBe(-28)
    expect(framing.direction).toBe('left')
    expect(framing.inFrame).toBe(true)
    expect(framing.readout).toBe('offset 28 px left — in frame')
    expect(framing.centreLabel).toBe('frame centre 540, 960')
  })

  it('derives leftPct/topPct from the actual pixel coordinates, not a fixed literal', () => {
    // The design's own warning: overlay coordinates must come from the real
    // solve, never a hardcoded percentage. Two different solves must
    // therefore land at two different percentages.
    const a = computeFraming(512, 934)
    const b = computeFraming(200, 300)
    expect(a.leftPct).not.toBe(b.leftPct)
    expect(a.topPct).not.toBe(b.topPct)
    expect(b.leftPct).toBeCloseTo((200 / FRAME_WIDTH_PX) * 100)
    expect(b.topPct).toBeCloseTo((300 / FRAME_HEIGHT_PX) * 100)
  })

  it('reports right-of-centre and centred offsets distinctly from left', () => {
    expect(computeFraming(700, 960).direction).toBe('right')
    expect(computeFraming(700, 960).readout).toMatch(/right/)
    expect(computeFraming(FRAME_CENTER_X, FRAME_CENTER_Y).direction).toBe('centered')
    expect(computeFraming(FRAME_CENTER_X, FRAME_CENTER_Y).readout).not.toMatch(/offset/)
  })

  it('flags a solved position outside the physical frame as out of frame, not a fault', () => {
    // This is an honest geometry fact — computeFraming does not decide
    // whether it's a problem, it just reports the boolean. See PreviewCard
    // for how "out of frame" is rendered (information, not an error state).
    const outside = computeFraming(-40, 934)
    expect(outside.inFrame).toBe(false)
    expect(outside.readout).toMatch(/out of frame/)
  })

  it('treats the frame edges themselves as in frame (inclusive bounds)', () => {
    expect(computeFraming(0, 0).inFrame).toBe(true)
    expect(computeFraming(FRAME_WIDTH_PX, FRAME_HEIGHT_PX).inFrame).toBe(true)
  })
})
