import { localHhMm, parse } from '../tonight/timeline'

/** Jan/Feb/… — spelled out rather than reached for via `Intl` so the render
 * path and its test don't depend on the runner's default locale deciding
 * "day month" vs "month day" ordering (see timeline.test.ts's own
 * `formatUtcOffset`/`zoneLabel` tests for the same trap, avoided the same
 * way there). */
export const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * When a piece of Live-screen data is from, in the browser's local zone
 * (this app's convention; see timeline.ts's `localHhMm` for the caveat).
 *
 * `21:14` when it is from today, `30 Jul 21:14` when it is not, and
 * `30 Jul 2025 21:14` when it is not even this year. A bare HH:MM reads as
 * "today", which is exactly wrong for the data this labels: a stale preview
 * frame or a provenance record can be days old, and "stale — from 21:14" on
 * last week's frame reads as tonight's.
 *
 * `null` for a missing or unparseable time — never "Invalid Date". The
 * caller decides the fallback wording.
 */
export function formatWhen(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null
  const ms = parse(iso)
  if (Number.isNaN(ms)) return null
  const d = new Date(ms)
  const today = new Date(now)
  const clock = localHhMm(ms)
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return clock
  }
  const year = d.getFullYear() === today.getFullYear() ? '' : ` ${d.getFullYear()}`
  return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]}${year} ${clock}`
}
