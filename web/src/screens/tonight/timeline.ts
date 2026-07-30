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
export const parse = (iso: string): number =>
  Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`)

/** Whole minutes spanned by an ISO pair. */
export const minutesBetween = ([from, to]: [string, string]): number =>
  Math.round((parse(to) - parse(from)) / 60_000)

export function buildScale([darkStart, darkEnd]: [string, string]): Scale {
  const startMs = Math.floor((parse(darkStart) - HOUR_MS) / HOUR_MS) * HOUR_MS
  const endMs = Math.ceil((parse(darkEnd) + HOUR_MS) / HOUR_MS) * HOUR_MS
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
