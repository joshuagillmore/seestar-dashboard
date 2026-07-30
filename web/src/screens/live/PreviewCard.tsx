import { useState } from 'react'
import type { Annotate, LivePreview } from '../../api/schemas'
import { Dot } from '../../ui/Dot'
import { computeFraming, FRAME_HEIGHT_PX, FRAME_WIDTH_PX } from './framing'
import { localHhMm, parse } from '../tonight/timeline'
import styles from './PreviewCard.module.css'

export interface PreviewCardProps {
  /** `null` covers both "not fetched yet" and "the fetch failed" — the
   * card's own absent state handles both the same way, same convention as
   * TargetThumb's image prop. */
  preview: LivePreview | null
  /** From `get_view_state`'s `result.View.Stack.Annotate` — `null` while no
   * solve has run this poll (pre-stack stages, or Stack itself absent). */
  annotate: Annotate | null
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
 * 2. `source: "sub"` is a single noisy 10 s frame, not the accumulating
 *    stack the vendor app shows — said out loud, not left for a grainy
 *    image to imply a bad result on its own.
 * 3. `stale: true` is shown, with when the frame is actually from — a stale
 *    image presented as current is exactly the dishonesty this project
 *    avoids everywhere else.
 */
export function PreviewCard({ preview, annotate }: PreviewCardProps) {
  const [overlayOn, setOverlayOn] = useState(false)

  const framing =
    annotate?.pixelx != null && annotate?.pixely != null
      ? computeFraming(annotate.pixelx, annotate.pixely)
      : null

  const hasImage = Boolean(preview?.url)

  return (
    <section className={styles.card}>
      <header className={styles.head}>
        <span className={styles.live}>
          <Dot tone="accent" pulse size="sm" />
          <span className={styles.eyebrow}>Live stack</span>
        </span>
        <span className={styles.dims}>
          {FRAME_WIDTH_PX} × {FRAME_HEIGHT_PX}
        </span>
      </header>

      <div className={styles.imageWrap}>
        {hasImage && preview ? (
          <>
            <img
              src={preview.url ?? undefined}
              alt={preview.target ? `Live camera view of ${preview.target}` : 'Live camera view'}
              className={styles.image}
            />

            {overlayOn && framing && (
              <div className={styles.overlay} data-testid="preview-overlay">
                <div
                  className={styles.targetCircle}
                  style={{ left: `${framing.leftPct}%`, top: `${framing.topPct}%` }}
                />
                <div className={styles.centreReticleH} />
                <div className={styles.centreReticleV} />
              </div>
            )}

            <div className={styles.badges}>
              {preview.source === 'sub' && (
                <span className={styles.badge} data-testid="preview-source-sub">
                  single 10 s sub — not the accumulating stack
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
          <div className={styles.framing}>No plate-solve annotation yet</div>
        )}
      </footer>
    </section>
  )
}

/** `captured_at` is an ISO timestamp; render it the same local-clock way
 * every other clock on this app does (see tonight/timeline.ts's own
 * zone-honesty note — this inherits the same "browser's zone, not
 * necessarily the site's" caveat, which matters less here since it's a
 * relative "how long ago" figure a viewer reads at a glance). */
function formatCapturedAt(capturedAt: string | null): string {
  if (!capturedAt) return 'an unknown time'
  return localHhMm(parse(capturedAt))
}
