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
 * The sidecar's `/api/last_stack/image` URL is the same literal path
 * regardless of which target it currently serves — confirmed against the
 * real, committed route (`_last_stack_absent`/`_last_stack_payload` in
 * routes.py both hardcode `"url": "/api/last_stack/image"`, even on the
 * absent branch), mirroring `/api/live_preview/image` (see
 * livePreviewImage.ts's own doc comment). Without a cache-buster, switching
 * targets could leave the browser serving whichever stack it fetched first
 * for the lifetime of the tab. `captured_at` genuinely changes with the
 * target (a different night's stack), so it rides as the cache-busting
 * query param, same approach as `livePreviewImageSrc`.
 */
export function lastStackImageSrc(lastStack: LastStack | null): string | undefined {
  if (!lastStack?.url) return undefined
  return lastStack.captured_at
    ? `${lastStack.url}?t=${encodeURIComponent(lastStack.captured_at)}`
    : lastStack.url
}

/**
 * `reason` tokens are short, stable, machine-readable wire values — the real,
 * committed route (`sidecar/seestar_sidecar/last_stack.py`) reuses
 * `live_preview.py`'s own `REASON_IDLE`/`REASON_BRIDGE_DOWN`/
 * `REASON_NOT_CONFIGURED`/`REASON_SHARE_UNREACHABLE` tokens verbatim, adding
 * only `REASON_NO_STACK`, and that module's own doc comment is explicit:
 * "the wording a user reads is the UI's job, never this module's." So this
 * client must translate the code, never render it raw — a card that showed
 * literal text like "no_stack" or "share_unreachable" would fail that rule.
 *
 * `no_stack` is the normal, common case this whole panel exists to handle
 * gracefully (a first-ever session on this target, or the only session so
 * far still running) — worded as such, not as a fault. The other four are
 * infra hiccups this card degrades from independently, same soft-fail
 * register `GuardrailsCard`/`PreviewCard`'s own empty states use elsewhere on
 * this screen. An unrecognised future code falls back to itself rather than
 * disappearing silently — loud, not blank.
 */
const LAST_STACK_REASON_LABELS: Record<string, string> = {
  no_stack: 'No completed stack yet for this target.',
  idle: 'Scope not observing right now.',
  bridge_down: 'Bridge unreachable — the same connection the rest of this screen depends on.',
  not_configured: 'Live share not configured on the sidecar.',
  share_unreachable: 'Live share unreachable right now.',
}

export function lastStackReasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'No completed stack available yet.'
  return LAST_STACK_REASON_LABELS[reason] ?? reason
}
