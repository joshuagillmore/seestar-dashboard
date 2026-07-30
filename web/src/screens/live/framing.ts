/**
 * Pure geometry over `get_view_state`'s `View.Stack.Annotate` block —
 * `pixelx`/`pixely` against the S50's fixed 1080×1920 portrait sub frame
 * (docs/seestar-mcp-design.md, design README.md:391). No network call, no
 * server knowledge beyond the two numbers the solve already returned.
 *
 * The design's own worked example — pixel (512, 934) reads "offset 28 px
 * left — in frame" against a frame centre of (540, 960) — is a spot-check of
 * this arithmetic, not a value to special-case: `computeFraming(512, 934)`
 * must reproduce it from the general formula. Overlay coordinates must be
 * *derived* from the real solve, never a hardcoded percentage (design
 * README.md:407) — that's the whole reason this lives in its own testable
 * module rather than being inlined as JSX math in PreviewCard.
 */

export const FRAME_WIDTH_PX = 1080
export const FRAME_HEIGHT_PX = 1920
export const FRAME_CENTER_X = FRAME_WIDTH_PX / 2
export const FRAME_CENTER_Y = FRAME_HEIGHT_PX / 2

export interface FramingOverlay {
  /** Target position as a percentage of the frame, for CSS `left`/`top` —
   * scales with whatever size the image actually renders at. */
  leftPct: number
  topPct: number
  /** Signed horizontal offset from centre, in the frame's own pixel scale.
   * Positive is right of centre, negative is left. */
  offsetPx: number
  direction: 'left' | 'right' | 'centered'
  /** Whether the solved position itself falls inside the 1080×1920 frame —
   * this unit's known ~20–30′ frame-left characteristic (CLAUDE.md) means it
   * usually does, but a bad solve or a target near the edge can put it
   * outside. Never a fault to report as one; see PreviewCard. */
  inFrame: boolean
  /** "offset 28 px left — in frame" — the one load-bearing line: this is
   * information (how far off, and whether it still matters), not decoration,
   * so it renders even when the toggleable overlay graphic is off. */
  readout: string
  /** "frame centre 540, 960" — the fixed reference point the readout above
   * is measured against. */
  centreLabel: string
}

export function computeFraming(pixelx: number, pixely: number): FramingOverlay {
  const leftPct = (pixelx / FRAME_WIDTH_PX) * 100
  const topPct = (pixely / FRAME_HEIGHT_PX) * 100
  const offsetPx = Math.round(pixelx - FRAME_CENTER_X)
  const direction: FramingOverlay['direction'] =
    offsetPx < 0 ? 'left' : offsetPx > 0 ? 'right' : 'centered'
  const inFrame =
    pixelx >= 0 && pixelx <= FRAME_WIDTH_PX && pixely >= 0 && pixely <= FRAME_HEIGHT_PX
  const frameNote = inFrame ? 'in frame' : 'out of frame'
  const readout =
    direction === 'centered'
      ? `centred on frame — ${frameNote}`
      : `offset ${Math.abs(offsetPx)} px ${direction} — ${frameNote}`

  return {
    leftPct,
    topPct,
    offsetPx,
    direction,
    inFrame,
    readout,
    centreLabel: `frame centre ${FRAME_CENTER_X}, ${FRAME_CENTER_Y}`,
  }
}
