import { describe, expect, it } from 'vitest'
import { localHhMm } from '../tonight/timeline'
import { MONTH_ABBR, formatWhen } from './timestamps'

/**
 * Times on the Live screen are often not from today: a stale preview frame,
 * a provenance record from three nights ago. An HH:MM alone reads as "today"
 * and makes a days-old frame look recent. Expected strings are built from
 * the same local-zone Date accessors the formatter uses, so these pass in
 * any runner time zone.
 */
const dayLabel = (iso: string) => {
  const d = new Date(Date.parse(iso))
  return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`
}

describe('formatWhen', () => {
  const NOW = Date.parse('2026-09-23T12:00:00Z')

  it('gives just the clock time for a moment earlier the same local day', () => {
    const sameDay = new Date(NOW)
    sameDay.setHours(0, 5, 0, 0)
    expect(formatWhen(sameDay.toISOString(), NOW)).toBe(localHhMm(sameDay.getTime()))
  })

  it('adds the date when the moment is not from today', () => {
    const iso = '2026-07-30T03:53:00+00:00'
    expect(formatWhen(iso, NOW)).toBe(`${dayLabel(iso)} ${localHhMm(Date.parse(iso))}`)
  })

  it('adds the year too when it is not this year', () => {
    const iso = '2025-07-30T12:00:00Z'
    expect(formatWhen(iso, NOW)).toBe(`${dayLabel(iso)} 2025 ${localHhMm(Date.parse(iso))}`)
  })

  it('reads a zone-less timestamp as UTC, like every other clock in this app', () => {
    expect(formatWhen('2026-07-30T03:53:00', NOW)).toBe(formatWhen('2026-07-30T03:53:00Z', NOW))
  })

  it('returns null — never "Invalid Date" — for a missing or unparseable time', () => {
    expect(formatWhen(null, NOW)).toBeNull()
    expect(formatWhen('not a time', NOW)).toBeNull()
  })
})
