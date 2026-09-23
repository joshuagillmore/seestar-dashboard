import { useEffect, useState } from 'react'
import type { TargetImage } from '../api/schemas'
import styles from './TargetThumb.module.css'

export interface TargetThumbProps {
  /** `undefined` (field not yet on the payload) and `null` (resolved to no
   * image) are the same state to this component — both render the empty
   * placeholder. See TargetImageSchema's doc comment. */
  image: TargetImage | null | undefined
  /** Accessible name for the `<img>` — the target's catalogue id or common
   * name, whichever the caller already shows beside the thumbnail. */
  alt: string
  /** Sizing, radius and clipping are the caller's job (PlanCard's fixed
   * 64×88 box vs. ProjectCard's 96px full-height cover) — this component
   * only fills whatever box it is given. */
  className?: string
  /** Lets a caller that raises the thumbnail above its own click layer
   * (ProjectCard, so the survey credit's title can be hovered) keep the
   * click it would otherwise have swallowed. */
  onClick?: () => void
}

/**
 * Renders a target's imagery slot: the user's own stacked capture, a
 * sky-survey cutout when they have never imaged the object, or a quiet
 * placeholder when neither exists. Shared by the Tonight plan card and the
 * Projects cover image so both get the same three states — and the same
 * honesty guarantee — for free.
 *
 * The rule that matters most: a survey image must never be presentable as
 * the user's own capture. `source: 'survey'` always renders the SURVEY
 * caption band across the bottom of the image; `source: 'own'` never
 * renders it. The caption is visible without hovering — the credit string
 * (attribution the survey requires) is reachable via `title`, following this
 * codebase's existing convention for hover detail (see PlanCard's
 * `progressGoal` / ProjectCard's `.meta` title).
 *
 * A failed load — 404, network error, anything `<img>`'s `onError` sees —
 * degrades to the exact same placeholder as `image: null`. The caller never
 * needs to distinguish "no image" from "an image that didn't load"; neither
 * is an error state worth a broken-image glyph.
 */
export function TargetThumb({ image, alt, className, onClick }: TargetThumbProps) {
  const [failed, setFailed] = useState(false)

  // A remount isn't guaranteed here — both callers key their list by target
  // id, but nothing prevents a future caller from swapping `image` on an
  // already-mounted instance. Re-arm the fallback when the url changes
  // rather than leaving a stale "failed" flag pinned to a different image.
  useEffect(() => setFailed(false), [image?.url])

  const showImage = Boolean(image) && !failed

  return (
    <div className={`${styles.thumb} ${className ?? ''}`} onClick={onClick}>
      {showImage && image ? (
        <img
          src={image.url}
          alt={alt}
          className={styles.img}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className={styles.empty} data-testid="thumb-empty" />
      )}
      {showImage && image?.source === 'survey' && (
        <span
          className={styles.surveyBadge}
          data-testid="survey-badge"
          title={image.credit ?? 'Sky survey imagery'}
        >
          SURVEY
        </span>
      )}
    </div>
  )
}
