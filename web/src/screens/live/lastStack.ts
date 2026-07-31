import type { LastStack } from '../../api/schemas'
import { parse } from '../tonight/timeline'

/**
 * Whether `/api/last_stack` should be (re-)fetched this poll. Target changes
 * only — never the 60 s telemetry cadence `useLiveSession`'s other
 * active-session fetchers run on. The route serves a full-resolution JPEG
 * (~730 KB, per handback-to-seestar-ai.md item 23) rather than a thumbnail,
 * because it is meant to be a one-off fetch when the framed target changes,
 * not a poll — refetching it every minute regardless of target would be
 * exactly the traffic hazard that item warns against.
 *
 * `target: null` means nothing has resolved a current target yet, so there
 * is nothing to fetch for. `fetchedFor` is the target the caller already has
 * a result for (or attempted); a `null` current target never overwrites it.
 */
export function shouldFetchLastStack(target: string | null, fetchedFor: string | null): boolean {
  return target !== null && target !== fetchedFor
}

/** Jan/Feb/… — spelled out rather than reached for via `Intl` so the render
 * path and its test don't depend on the runner's default locale deciding
 * "day month" vs "month day" ordering (see timeline.test.ts's own
 * `formatUtcOffset`/`zoneLabel` tests for the same trap, avoided the same
 * way there). */
export const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * `captured_at` as `"12 Jul"` — day-of-month then short month, in the
 * browser's local zone (this app's established convention; see timeline.ts's
 * `localHhMm` doc comment for the same "browser's clock, not necessarily the
 * site's" caveat). Deliberately fixed-order text, not `toLocaleDateString`,
 * so the panel reads the same regardless of the viewer's locale — see
 * `MONTH_ABBR`'s own comment.
 */
export function formatStackDate(capturedAt: string | null): string {
  if (!capturedAt) return 'unknown date'
  const ms = parse(capturedAt)
  if (Number.isNaN(ms)) return 'unknown date'
  const d = new Date(ms)
  return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`
}

/**
 * The sidecar's `/api/last_stack/image` URL is expected to be the same
 * literal path regardless of which target it currently serves (mirroring
 * `/api/live_preview/image` — see livePreviewImage.ts's own doc comment for
 * why that matters): without a cache-buster, switching targets could leave
 * the browser serving whichever stack it fetched first for the lifetime of
 * the tab. `captured_at` genuinely changes with the target (a different
 * night's stack), so it rides as the cache-busting query param, same
 * approach as `livePreviewImageSrc`.
 */
export function lastStackImageSrc(lastStack: LastStack | null): string | undefined {
  if (!lastStack?.url) return undefined
  return lastStack.captured_at
    ? `${lastStack.url}?t=${encodeURIComponent(lastStack.captured_at)}`
    : lastStack.url
}
