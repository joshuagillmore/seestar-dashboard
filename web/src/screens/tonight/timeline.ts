/**
 * The handoff pins the timeline to a 19:00→05:00 local, 600-minute axis. That
 * only works for the night it was drawn: real dark windows move with the season
 * (the recorded night is 19:49–03:54 UTC). The axis is therefore derived from
 * dark_window_utc — padded an hour each side, rounded outward to the hour.
 */
const HOUR_MS = 3_600_000

export interface Scale {
  startMs: number
  endMs: number
  ticks: number[]
}

/**
 * Fixture timestamps are UTC but carry no `Z`. Exported because the component
 * needs it too — an inline `Date.parse(`${x}Z`)` would append a second `Z` to
 * an already-suffixed string and yield NaN, rendering "Invalid Date".
 */
/** Matches an explicit zone already on the string: a trailing `Z`, or a
 * `±HH:MM` / `±HHMM` offset. */
const HAS_EXPLICIT_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/

/**
 * Parse an ISO timestamp to epoch ms, treating a zone-less string as UTC.
 *
 * The `Z` is appended only when the string does not already carry a zone.
 * It used to be appended whenever the string merely failed to end in `Z`,
 * which was correct for the producer this was written against — `plan_targets`
 * emits naive timestamps like `2026-09-27T19:42:11.660` — and silently wrong
 * for every other one. `/api/live_preview` and `/api/last_stack` return
 * `2026-07-31T07:09:54.280000+00:00`, and appending `Z` to that yields
 * `...+00:00Z`, which is not a date at all.
 *
 * Caught on live hardware: both preview panels rendered "Invalid Date" and
 * "unknown date" — the timestamps that exist precisely so a stale frame cannot
 * pose as a current one.
 */
export const parse = (iso: string): number =>
  Date.parse(HAS_EXPLICIT_ZONE.test(iso) ? iso : `${iso}Z`)

/** Whole minutes spanned by an ISO pair. */
export const minutesBetween = ([from, to]: [string, string]): number =>
  Math.round((parse(to) - parse(from)) / 60_000)

/** The browser zone's offset from UTC at `ms`, in ms (positive = ahead). */
const localOffsetMs = (ms: number): number => -new Date(ms).getTimezoneOffset() * 60_000

/** Round `ms` down (or up) to a LOCAL hour boundary. */
const toLocalHour = (ms: number, round: (x: number) => number): number => {
  const offset = localOffsetMs(ms)
  return round((ms + offset) / HOUR_MS) * HOUR_MS - offset
}

/**
 * The axis, padded an hour each side of the dark window and rounded outward
 * to the hour — to the viewer's LOCAL hour.
 *
 * The ticks are labelled with the local hour (SweetBandTimeline), so they
 * must sit on local hour boundaries. They used to sit on UTC hours, which in
 * a half-hour zone (UTC+5:30, +9:30, −3:30 …) are all HH:30 locally, so every
 * label was half an hour off. In a whole-hour zone the two coincide and
 * nothing moves.
 *
 * Ticks step a real hour from a local-hour start. A DST change inside the
 * window shifts the offset by a whole hour, so they stay on local hours.
 */
export function buildScale([darkStart, darkEnd]: [string, string]): Scale {
  const startMs = toLocalHour(parse(darkStart) - HOUR_MS, Math.floor)
  const endMs = toLocalHour(parse(darkEnd) + HOUR_MS, Math.ceil)
  const ticks: number[] = []
  for (let t = startMs; t <= endMs; t += HOUR_MS) ticks.push(t)
  return { startMs, endMs, ticks }
}

export function spanToPercent(
  scale: Scale,
  [from, to]: [string, string],
): { left: number; width: number } {
  const total = scale.endMs - scale.startMs
  const clamp = (value: number) => Math.min(100, Math.max(0, value))
  const left = clamp(((parse(from) - scale.startMs) / total) * 100)
  const right = clamp(((parse(to) - scale.startMs) / total) * 100)
  return { left, width: Math.max(0, right - left) }
}

/** Local wall-clock HH:MM. The handoff labels these "local"; the browser's zone
 *  is used, which matches the site only when the user is at the site. See
 *  `zoneLabel` below for what this app does about that gap. */
export const localHhMm = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

/**
 * Formats a UTC-offset in minutes (positive = ahead of UTC) as `"UTC"` or
 * `"UTC±H[:MM]"` — e.g. `0` → `"UTC"`, `-420` → `"UTC-7"`, `330` → `"UTC+5:30"`
 * for the fractional-hour zones (India, Nepal, ...). Split out from
 * `zoneLabel` so it can be tested with hand-picked offsets, independent of
 * the test runner's own system zone.
 */
export const formatUtcOffset = (offsetMin: number): string => {
  if (offsetMin === 0) return 'UTC'
  const sign = offsetMin > 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const hours = Math.floor(abs / 60)
  const minutes = abs % 60
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`
}

/**
 * Names the zone `localHhMm` is actually rendering in, at a given instant
 * (DST-aware — two instants six months apart can disagree).
 *
 * This is the BROWSER's zone, not the observing site's, and that distinction
 * is deliberate rather than an oversight: `get_site_profile` returns
 * `lat_deg`/`lon_deg` but no IANA zone name (verified against both
 * `SiteProfileSchema` here and the server's own `SiteProfile` dataclass), and
 * the sidecar's own `local_tz` (`archive.py`) is not derived from the site's
 * coordinates either — it is "whatever timezone the machine running the
 * sidecar happens to be in", used only to parse archive filenames, and no
 * route exposes it to this client regardless. So the site's own zone is
 * genuinely not knowable from anything this app can currently reach — see
 * handback-to-seestar-ai.md item 16. Naming the browser's zone explicitly,
 * instead of the ambiguous "local" the handoff uses, is what's left to do
 * honestly: a reader can now tell this is THEIR clock, and knows to check
 * whether it matches the telescope's when the two might differ (e.g.
 * checking tonight's plan from somewhere other than the site).
 */
export const zoneLabel = (ms: number): string =>
  formatUtcOffset(-new Date(ms).getTimezoneOffset())
