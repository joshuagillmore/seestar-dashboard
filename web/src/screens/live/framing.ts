import type { Annotate } from '../../api/schemas'

/**
 * Pure geometry over `get_view_state`'s `View.Stack.Annotate` block. No
 * network call, no server knowledge beyond what the solve itself returned:
 * the solved pixel, and the frame size that pixel is measured against
 * (`Annotate.result.image_size`, `[1080, 1920]` on the S50 — read from the
 * payload, not assumed).
 *
 * The design's own worked example — pixel (512, 934) reads "offset 28 px
 * left — in frame" against a frame centre of (540, 960) — is a spot-check of
 * this arithmetic, not a value to special-case. Overlay coordinates must be
 * *derived* from the real solve, never a hardcoded percentage (design
 * README.md:433) — that's the whole reason this lives in its own testable
 * module rather than being inlined as JSX math in PreviewCard.
 */

export interface ImageSize {
  width: number
  height: number
}

export interface FramingOverlay {
  /** Signed horizontal offset from centre, in the frame's own pixel scale.
   * Positive is right of centre, negative is left. */
  offsetPx: number
  direction: 'left' | 'right' | 'centered'
  /** Whether the solved position itself falls inside the frame — this unit's
   * known ~20–30′ frame-left characteristic (CLAUDE.md) means it usually
   * does, but a bad solve or a target near the edge can put it outside.
   * Never a fault to report as one; see PreviewCard. */
  inFrame: boolean
  /** "offset 28 px left — in frame" — the one load-bearing line: this is
   * information (how far off, and whether it still matters), not decoration,
   * so it renders even when the toggleable overlay graphic is off. */
  readout: string
  /** "frame centre 540, 960" — the fixed reference point the readout above
   * is measured against. */
  centreLabel: string
}

export function computeFraming(pixelx: number, pixely: number, frame: ImageSize): FramingOverlay {
  const centreX = frame.width / 2
  const centreY = frame.height / 2
  const offsetPx = Math.round(pixelx - centreX)
  const direction: FramingOverlay['direction'] =
    offsetPx < 0 ? 'left' : offsetPx > 0 ? 'right' : 'centered'
  const inFrame = pixelx >= 0 && pixelx <= frame.width && pixely >= 0 && pixely <= frame.height
  const frameNote = inFrame ? 'in frame' : 'out of frame'
  const readout =
    direction === 'centered'
      ? `centred on frame — ${frameNote}`
      : `offset ${Math.abs(offsetPx)} px ${direction} — ${frameNote}`

  return {
    offsetPx,
    direction,
    inFrame,
    readout,
    centreLabel: `frame centre ${centreX}, ${centreY}`,
  }
}

/**
 * Where a frame pixel lands on screen when the frame is drawn into `box`
 * with `object-fit: cover` — scaled until it covers the box, centred, and
 * the overflow cropped. `visible` is false when the point is in the
 * cropped-away part.
 *
 * The overlay used to be positioned as a percentage of the box, which is
 * only right for `fill`. A 9:16 frame covering PreviewCard's 284×300 well
 * loses ~102 px top and bottom, so the recorded NGC 7380 marker sat ~25 px
 * too high, and solves near the top or bottom edge drew circles over parts
 * of the frame that are not on screen at all.
 */
export function projectOntoCover(
  x: number,
  y: number,
  frame: ImageSize,
  box: ImageSize,
): { leftPx: number; topPx: number; visible: boolean } {
  const scale = Math.max(box.width / frame.width, box.height / frame.height)
  const leftPx = x * scale - (frame.width * scale - box.width) / 2
  const topPx = y * scale - (frame.height * scale - box.height) / 2
  const visible = leftPx >= 0 && leftPx <= box.width && topPx >= 0 && topPx <= box.height
  return { leftPx, topPx, visible }
}

/** `Annotate.result.image_size` as `{width, height}` — `null` unless it is
 * exactly two positive, finite numbers. */
export function readImageSize(annotate: Annotate | null): ImageSize | null {
  const size = annotate?.result?.image_size
  if (!size || size.length !== 2) return null
  const [width, height] = size
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) return null
  return { width, height }
}

/** "NGC 7380", "ngc7380" and "NGC7380" are the same object: the firmware
 * echoes the goto string as `target_name` without the catalogue's spacing. */
const normaliseName = (name: string) => name.replace(/[\s_-]+/g, '').toUpperCase()

/** What the plate solve says about the current target:
 *
 * - `none` — no COMPLETED solve this poll. A solve in progress still
 *   carries the previous result, which must not be read as current.
 * - `unmatched` — solved, but no annotation names the target. The first
 *   annotation used to be assumed to be the target; it can be any catalogued
 *   object in the field.
 * - `no-size` — the matching annotation came without `image_size`, so there
 *   is no frame to measure its pixel against.
 * - `ok` — the target's solved pixel and the frame it is measured in.
 */
export type SolveResult =
  | { kind: 'none' }
  | { kind: 'unmatched'; target: string | null }
  | { kind: 'no-size' }
  | { kind: 'ok'; point: { x: number; y: number }; imageSize: ImageSize; framing: FramingOverlay }

export function resolveSolve(annotate: Annotate | null, targetName: string | null | undefined): SolveResult {
  if (annotate?.state !== 'complete') return { kind: 'none' }
  const target = targetName ? normaliseName(targetName) : null
  const match = target
    ? annotate.result?.annotations?.find((a) => a.names?.some((n) => normaliseName(n) === target))
    : undefined
  if (!match || match.pixelx == null || match.pixely == null) {
    return { kind: 'unmatched', target: targetName ?? null }
  }
  const imageSize = readImageSize(annotate)
  if (!imageSize) return { kind: 'no-size' }
  return {
    kind: 'ok',
    point: { x: match.pixelx, y: match.pixely },
    imageSize,
    framing: computeFraming(match.pixelx, match.pixely, imageSize),
  }
}
