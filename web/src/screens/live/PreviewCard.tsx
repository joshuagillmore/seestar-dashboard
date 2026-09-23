import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Annotate, LivePreview } from '../../api/schemas'
import { Dot } from '../../ui/Dot'
import { projectOntoCover, resolveSolve, type ImageSize, type SolveResult } from './framing'
import { livePreviewImageSrc } from './livePreviewImage'
import { singleSubLabel } from './telemetryFormatting'
import { formatWhen } from './timestamps'
import styles from './PreviewCard.module.css'

export interface PreviewCardProps {
  /** `null` covers both "not fetched yet" and "the fetch failed" — the
   * card's own absent state handles both the same way, same convention as
   * TargetThumb's image prop. */
  preview: LivePreview | null
  /** From `get_view_state`'s `result.View.Stack.Annotate` — `null` while no
   * solve has run this poll (pre-stack stages, or Stack itself absent). */
  annotate: Annotate | null
  /** The running sub exposure, `View.Stack.Exposure.exp_ms`. Names the
   * length in the single-sub caption; absent, the caption names none. */
  exposureMs?: number | null
  /** `View.target_name` — which of the solve's annotations is the target.
   * Without it no annotation is treated as the target (see resolveSolve). */
  targetName?: string | null
}

/**
 * The point of the whole screen (slice-3 spec §0: "the main thing is to see
 * the current visual of the camera"). Three honesty rules the spec is
 * explicit about, all enforced here rather than left to the caller:
 *
 * 1. The plate-solve overlay defaults OFF — it is decoration over the image,
 *    which is the one thing this card exists to show. The framing readout
 *    stays visible as TEXT regardless of the toggle, because it is
 *    information (this unit's own ~20–30′ frame-left characteristic), not
 *    decoration.
 * 2. `source: "sub"` is a single noisy frame (its length from the scope's
 *    running exposure), not the accumulating stack the vendor app shows —
 *    said out loud, not left for a grainy image to imply a bad result on
 *    its own.
 * 3. `stale: true` is shown, with when the frame is actually from — a stale
 *    image presented as current is exactly the dishonesty this project
 *    avoids everywhere else.
 */
export function PreviewCard({ preview, annotate, exposureMs = null, targetName = null }: PreviewCardProps) {
  const [overlayOn, setOverlayOn] = useState(false)
  const imageWrapRef = useRef<HTMLDivElement>(null)
  const box = useBoxSize(imageWrapRef)

  // The solve lives in `Annotate.result.annotations[]`, not flat on `Annotate`
  // — confirmed against firmware 7.75 mid-session on NGC 7380. Reading the flat
  // fields made every live payload fail schema validation, which the client
  // reads as "get_view_state failed" and therefore "the scope is idle": the
  // screen reported an idle scope while it was stacking.
  //
  // Which annotation, and whether to trust it, is resolveSolve's call: the
  // one naming View.target_name (not simply the first — any catalogued
  // object in the field can be listed), only from a COMPLETED solve, and
  // measured against the solve's own image_size rather than an assumed
  // 1080×1920.
  const solve = resolveSolve(annotate, targetName)
  const framing = solve.kind === 'ok' ? solve.framing : null
  // Mapped through object-fit: cover (see projectOntoCover). Not drawn when
  // the box has not been measured, or when the point is in the cropped-away
  // band: a circle over pixels that are not on screen marks nothing.
  const marker =
    solve.kind === 'ok' && box ? projectOntoCover(solve.point.x, solve.point.y, solve.imageSize, box) : null

  const imageSrc = livePreviewImageSrc(preview)

  /**
   * Whether there is actually a frame — keyed on `source`, NOT on `url`.
   *
   * This tested `url` and was wrong against the real server. `url` is a
   * STATIC ROUTE PATH that `_live_preview_absent()` sets unconditionally
   * (routes.py), so it is present even when `source` is null and `reason` is
   * `share_unreachable`. The card therefore rendered an `<img>` at a URL that
   * 404s — a broken-image icon — and the honest absent state below it, which
   * exists precisely for this case, was unreachable in practice.
   *
   * It passed every test because `fixtures/synthetic/live_preview_none.json`
   * omitted `url`, which no real response ever does. The fixture has been
   * corrected alongside this. Found by opening the screen against a live
   * scope with an unreachable share; no unit test could have caught it while
   * the fixture disagreed with the server.
   *
   * `source` is `null` exactly when there is no frame, in both the fixtures
   * and the real payload, which is what makes it the honest guard.
   */
  const hasImage = Boolean(preview?.source)

  return (
    <section className={styles.card}>
      <header className={styles.head}>
        <span className={styles.live}>
          <Dot tone="accent" pulse size="sm" />
          <span className={styles.eyebrow}>Live stack</span>
        </span>
        {solve.kind === 'ok' && (
          <span className={styles.dims}>
            {solve.imageSize.width} × {solve.imageSize.height}
          </span>
        )}
      </header>

      <div className={styles.imageWrap} ref={imageWrapRef}>
        {hasImage && preview ? (
          <>
            <img
              src={imageSrc ?? undefined}
              alt={preview.target ? `Live camera view of ${preview.target}` : 'Live camera view'}
              className={styles.image}
            />

            {overlayOn && framing && (
              <div className={styles.overlay} data-testid="preview-overlay">
                {marker?.visible && (
                  <div
                    className={styles.targetCircle}
                    data-testid="preview-target-marker"
                    style={{ left: `${marker.leftPx}px`, top: `${marker.topPx}px` }}
                  />
                )}
                <div className={styles.centreReticleH} />
                <div className={styles.centreReticleV} />
              </div>
            )}

            <div className={styles.badges}>
              {preview.source === 'sub' && (
                <span className={styles.badge} data-testid="preview-source-sub">
                  {singleSubLabel(exposureMs, preview.stale)} — not the accumulating stack
                </span>
              )}
              {preview.stale && (
                <span className={`${styles.badge} ${styles.badgeStale}`} data-testid="preview-stale">
                  stale — from {formatCapturedAt(preview.captured_at)}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className={styles.empty} data-testid="preview-empty">
            {preview?.reason ?? 'No preview available'}
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.overlayToggle}
          aria-pressed={overlayOn}
          onClick={() => setOverlayOn((v) => !v)}
        >
          {overlayOn ? 'Hide' : 'Show'} plate-solve overlay
        </button>
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerSource}>get_view_state → Stack.Annotate</div>
        {framing ? (
          <div className={styles.framing} data-testid="framing-readout">
            {framing.centreLabel} / {framing.readout}
          </div>
        ) : (
          <div className={styles.framing}>{solveAbsentText(solve)}</div>
        )}
      </footer>
    </section>
  )
}

function solveAbsentText(solve: SolveResult): string {
  if (solve.kind === 'unmatched') {
    return solve.target
      ? `Plate solve did not name ${solve.target} — no framing to report`
      : 'No target name to match the plate solve against'
  }
  if (solve.kind === 'no-size') return 'Plate solve carried no image size — framing not computed'
  return 'No completed plate solve yet'
}

/**
 * The element's laid-out content size, kept current with a ResizeObserver
 * where one exists. `null` until measured, and whenever it measures 0×0 (not
 * laid out) — the caller must not place anything against an unknown box.
 */
function useBoxSize(ref: RefObject<HTMLElement | null>): ImageSize | null {
  const [size, setSize] = useState<ImageSize | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const width = el.clientWidth
      const height = el.clientHeight
      setSize((prev) => {
        if (width <= 0 || height <= 0) return null
        return prev && prev.width === width && prev.height === height ? prev : { width, height }
      })
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/** `captured_at` is an ISO timestamp, rendered with its date whenever it is
 * not from today (see `formatWhen`): a stale frame is exactly the one that
 * may be days old. Unparseable reads as "an unknown time", never "Invalid
 * Date". */
function formatCapturedAt(capturedAt: string | null): string {
  return formatWhen(capturedAt) ?? 'an unknown time'
}
