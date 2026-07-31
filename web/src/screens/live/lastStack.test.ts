import { describe, expect, it } from 'vitest'
import type { LastStack } from '../../api/schemas'
import { MONTH_ABBR, formatStackDate, lastStackImageSrc, shouldFetchLastStack } from './lastStack'

describe('shouldFetchLastStack', () => {
  it('does not fetch when no target has resolved yet', () => {
    expect(shouldFetchLastStack(null, null)).toBe(false)
  })

  it('fetches the first time a target resolves', () => {
    expect(shouldFetchLastStack('M27', null)).toBe(true)
  })

  it('does not re-fetch on a later poll of the same target — the property the telemetry cadence must never trigger on its own', () => {
    expect(shouldFetchLastStack('M27', 'M27')).toBe(false)
  })

  it('fetches again once the target actually changes', () => {
    expect(shouldFetchLastStack('M31', 'M27')).toBe(true)
  })

  it('does not fetch when the target disappears again (a momentary preview hiccup) — the caller keeps its prior result', () => {
    expect(shouldFetchLastStack(null, 'M27')).toBe(false)
  })
})

describe('formatStackDate', () => {
  it('renders a placeholder, not "Invalid Date", when captured_at is null', () => {
    expect(formatStackDate(null)).toBe('unknown date')
  })

  it('renders day-of-month + short month in a fixed order, independent of the runner locale', () => {
    // Computed via the same local Date the function itself uses, not a
    // hardcoded "12 Jul" — pinning that would depend on the test runner's
    // own system zone, the exact trap timeline.test.ts's zoneLabel test
    // documents avoiding.
    const capturedAt = '2026-07-12T12:00:00Z'
    const d = new Date(Date.parse(capturedAt))
    expect(formatStackDate(capturedAt)).toBe(`${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`)
    expect(formatStackDate(capturedAt)).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/)
  })

  it('handles a non-Z-suffixed UTC timestamp the same way the rest of this app does (see timeline.ts\'s own parse)', () => {
    expect(formatStackDate('2026-07-12T12:00:00')).toBe(formatStackDate('2026-07-12T12:00:00Z'))
  })
})

describe('lastStackImageSrc', () => {
  const base: LastStack = {
    ok: true,
    target: 'M27',
    captured_at: '2026-07-12T21:44:10Z',
    frame_count: 178,
    url: '/api/last_stack/image',
    reason: null,
  }

  it('returns undefined when there is no url at all (the absent-state response)', () => {
    expect(lastStackImageSrc(null)).toBeUndefined()
    expect(lastStackImageSrc({ ...base, target: null, url: null })).toBeUndefined()
  })

  it('appends captured_at as a cache-buster so switching targets cannot serve a stale cached image', () => {
    expect(lastStackImageSrc(base)).toBe(
      `/api/last_stack/image?t=${encodeURIComponent('2026-07-12T21:44:10Z')}`,
    )
  })

  it('falls back to the bare url when captured_at is missing', () => {
    expect(lastStackImageSrc({ ...base, captured_at: null })).toBe('/api/last_stack/image')
  })
})
