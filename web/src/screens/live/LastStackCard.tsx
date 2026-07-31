import type { LastStack } from '../../api/schemas'
import { formatStackDate, lastStackImageSrc, lastStackReasonLabel } from './lastStack'
import styles from './LastStackCard.module.css'

export interface LastStackCardProps {
  /** `null` covers "no target has resolved yet" and "the fetch failed" —
   * same soft-fail convention as every other independent card on this
   * screen (see useLiveSession's own doc comment). `target: null` inside a
   * successful response is the distinct, normal "no completed stack for
   * this target yet" state — see LastStackSchema's own doc comment. */
  lastStack: LastStack | null
}

/**
 * handback-to-seestar-ai.md item 23's own workaround, named verbatim in that
 * item: "a clearly-dated 'last completed stack' panel beneath [the live
 * sub], built from the share." Sits directly under PreviewCard in the same
 * column (see LiveScreen.tsx's `.previewColumn`).
 *
 * **The one rule this card exists under: it must never look live.** The
 * scope writes the stacked master exactly once, at session end — confirmed
 * twice on hardware, at 37 and 141 stacked frames — so mid-session the only
 * stack on the share is the *previous* session's, sometimes weeks old. That
 * is still genuinely useful (what the target looked like last time, next to
 * what the camera sees right now), but only if the label carries the whole
 * honesty burden: no pulsing dot, no "Live" anywhere, a real date on every
 * render. Contrast with PreviewCard's header, which earns its pulsing accent
 * dot because that frame genuinely is current.
 *
 * A target with no completed stack yet (e.g. the first-ever session on an
 * object) is a normal, common state, not an error. `target` is the real
 * discriminator, not `url` — the committed route always sends the same
 * literal `url` ("/api/last_stack/image") on both branches, so checking it
 * would show an image attempt even when there is nothing behind it.
 * `reason` is a short machine code (`no_stack`/`idle`/`bridge_down`/
 * `not_configured`/`share_unreachable`), never prose — see
 * `lastStackReasonLabel`'s own doc comment for why this never renders it
 * raw. `lastStack === null` (nothing fetched yet, or the fetch failed)
 * renders through the same label function, which falls back to a generic
 * message for a missing reason too.
 */
export function LastStackCard({ lastStack }: LastStackCardProps) {
  const hasImage = Boolean(lastStack?.target)

  return (
    <section className={styles.card} data-testid="last-stack-card">
      <header className={styles.head}>
        <span className={styles.eyebrow}>Last completed stack</span>
      </header>

      {hasImage && lastStack ? (
        <>
          <div className={styles.imageWrap}>
            <img
              src={lastStackImageSrc(lastStack)}
              alt={`Last completed stack of ${lastStack.target}`}
              className={styles.image}
            />
          </div>
          <div className={styles.caption} data-testid="last-stack-caption">
            Last completed stack · {formatStackDate(lastStack.captured_at)} ·{' '}
            {lastStack.frame_count ?? '—'} frames
          </div>
        </>
      ) : (
        <div className={styles.empty} data-testid="last-stack-empty">
          {lastStackReasonLabel(lastStack?.reason)}
        </div>
      )}
    </section>
  )
}
