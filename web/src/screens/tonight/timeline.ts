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
 *  is used, which matches the site only when the user is at the site. */
export const localHhMm = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
