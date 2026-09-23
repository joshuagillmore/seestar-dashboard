import { describe, expect, it } from 'vitest'
import { AnnotateSchema, ViewStateSchema } from '../../api/schemas'
import { recordedViewState } from '../../test/fixtures'
import { computeFraming, projectOntoCover, resolveSolve, type ImageSize } from './framing'

/** The S50's portrait sub frame, as the recorded solve's own image_size says. */
const S50: ImageSize = { width: 1080, height: 1920 }

describe('computeFraming', () => {
  it('reproduces the design\'s own worked example from the general formula', () => {
    // design README.md:425/402 — pixel (512, 934) against a 540/960 centre
    // reads "512, 934" / "offset 28 px left — in frame". Not special-cased:
    // this is computeFraming's general arithmetic landing on the same number.
    const framing = computeFraming(512, 934, S50)
    expect(framing.offsetPx).toBe(-28)
    expect(framing.direction).toBe('left')
    expect(framing.inFrame).toBe(true)
    expect(framing.readout).toBe('offset 28 px left — in frame')
    expect(framing.centreLabel).toBe('frame centre 540, 960')
  })

  it('measures against the frame size it is given, not a hardcoded 1080×1920', () => {
    const half = computeFraming(270, 480, { width: 540, height: 960 })
    expect(half.direction).toBe('centered')
    expect(half.centreLabel).toBe('frame centre 270, 480')
    expect(computeFraming(1000, 900, { width: 540, height: 960 }).inFrame).toBe(false)
  })

  it('reports right-of-centre and centred offsets distinctly from left', () => {
    expect(computeFraming(700, 960, S50).direction).toBe('right')
    expect(computeFraming(700, 960, S50).readout).toMatch(/right/)
    expect(computeFraming(540, 960, S50).direction).toBe('centered')
    expect(computeFraming(540, 960, S50).readout).not.toMatch(/offset/)
  })

  it('flags a solved position outside the physical frame as out of frame, not a fault', () => {
    // This is an honest geometry fact — computeFraming does not decide
    // whether it's a problem, it just reports the boolean. See PreviewCard
    // for how "out of frame" is rendered (information, not an error state).
    const outside = computeFraming(-40, 934, S50)
    expect(outside.inFrame).toBe(false)
    expect(outside.readout).toMatch(/out of frame/)
  })

  it('treats the frame edges themselves as in frame (inclusive bounds)', () => {
    expect(computeFraming(0, 0, S50).inFrame).toBe(true)
    expect(computeFraming(S50.width, S50.height, S50).inFrame).toBe(true)
  })
})

describe('projectOntoCover', () => {
  // PreviewCard's image box: 286 px card less its 1 px borders, by 300 px.
  const BOX = { width: 284, height: 300 }

  it('maps a solve through object-fit: cover, not as a percentage of the box', () => {
    // A 9:16 frame covering a 284×300 box is scaled to 284×505 and loses
    // ~102 px top and bottom. Positioning by percentage of the box ignored
    // that crop and drew the recorded solve ~25 px too high.
    const p = projectOntoCover(309.123, 1190.65, S50, BOX)
    const scale = 284 / 1080
    expect(p.leftPx).toBeCloseTo(309.123 * scale, 1)
    expect(p.topPx).toBeCloseTo(1190.65 * scale - (1920 * scale - 300) / 2, 1)
    expect(p.topPx).toBeCloseTo(210.7, 0)
    expect(Math.abs(p.topPx - (1190.65 / 1920) * 300)).toBeGreaterThan(20)
    expect(p.visible).toBe(true)
  })

  it('reports a point in the cropped-away band as not visible', () => {
    expect(projectOntoCover(540, 50, S50, BOX).visible).toBe(false)
    expect(projectOntoCover(540, 1880, S50, BOX).visible).toBe(false)
  })

  it('crops the sides instead when the frame is wider than the box', () => {
    const p = projectOntoCover(10, 540, { width: 1920, height: 1080 }, BOX)
    expect(p.visible).toBe(false)
    expect(projectOntoCover(960, 540, { width: 1920, height: 1080 }, BOX).leftPx).toBeCloseTo(142, 0)
  })
})

describe('resolveSolve', () => {
  const recorded = () => {
    const view = ViewStateSchema.parse(recordedViewState()).view_state?.result?.View
    return { annotate: view?.Stack?.Annotate ?? null, target: view?.target_name ?? null }
  }

  it('finds the recorded solve for its own target, matching "NGC7380" against "NGC 7380"', () => {
    const { annotate, target } = recorded()
    const solve = resolveSolve(annotate, target)
    expect(solve.kind).toBe('ok')
    if (solve.kind !== 'ok') return
    expect(solve.imageSize).toEqual(S50)
    expect(solve.framing.readout).toBe('offset 231 px left — in frame')
  })

  it('picks the annotation naming the target, not simply the first one', () => {
    const annotate = AnnotateSchema.parse({
      state: 'complete',
      result: {
        image_size: [1080, 1920],
        annotations: [
          { type: 'ic', names: ['IC 1470'], pixelx: 900, pixely: 300, radius: 40 },
          { type: 'ngc', names: ['NGC 7380'], pixelx: 309.123, pixely: 1190.65, radius: 315.861 },
        ],
      },
    })
    const solve = resolveSolve(annotate, 'NGC7380')
    expect(solve.kind === 'ok' && solve.point).toEqual({ x: 309.123, y: 1190.65 })
  })

  it('claims no framing when no annotation names the target', () => {
    const { annotate } = recorded()
    expect(resolveSolve(annotate, 'M27')).toEqual({ kind: 'unmatched', target: 'M27' })
    expect(resolveSolve(annotate, null)).toEqual({ kind: 'unmatched', target: null })
  })

  it('ignores a solve that is not complete', () => {
    const { annotate, target } = recorded()
    expect(resolveSolve(annotate && { ...annotate, state: 'working' }, target).kind).toBe('none')
    expect(resolveSolve(null, target).kind).toBe('none')
  })

  it('reads the frame size from the solve, and computes nothing without one', () => {
    const { annotate, target } = recorded()
    const half = resolveSolve(
      annotate && { ...annotate, result: { ...annotate.result, image_size: [540, 960] } },
      target,
    )
    expect(half.kind === 'ok' && half.imageSize).toEqual({ width: 540, height: 960 })
    const sizeless = resolveSolve(
      annotate && { ...annotate, result: { ...annotate.result, image_size: null } },
      target,
    )
    expect(sizeless.kind).toBe('no-size')
  })
})
