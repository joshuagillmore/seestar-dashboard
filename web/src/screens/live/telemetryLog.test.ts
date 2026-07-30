import { describe, expect, it } from 'vitest'
import { appendTelemetryEntry, describeEntry, formatElapsed, MAX_LOG_ENTRIES, type TelemetryEntry } from './telemetryLog'
import type { Tier1 } from '../../api/schemas'

const snapshot = (over: Partial<Tier1> = {}): Tier1 => ({
  ok: true,
  stacked_frame: 428,
  dropped_frame: 23,
  solve_ok: true,
  focus_position: 1645,
  ...over,
})

describe('appendTelemetryEntry', () => {
  it('appends newest last (callers render newest-first by reversing)', () => {
    const log = appendTelemetryEntry(appendTelemetryEntry([], snapshot({ stacked_frame: 1 })), snapshot({ stacked_frame: 2 }))
    expect(log.map((e) => e.tier1.stacked_frame)).toEqual([1, 2])
  })

  it('caps retention at MAX_LOG_ENTRIES, dropping the oldest first', () => {
    let log: TelemetryEntry[] = []
    for (let i = 0; i < MAX_LOG_ENTRIES + 10; i++) {
      log = appendTelemetryEntry(log, snapshot({ stacked_frame: i }))
    }
    expect(log).toHaveLength(MAX_LOG_ENTRIES)
    expect(log[0].tier1.stacked_frame).toBe(10) // the first 10 were evicted
    expect(log[log.length - 1].tier1.stacked_frame).toBe(MAX_LOG_ENTRIES + 9)
  })
})

describe('formatElapsed', () => {
  it('reproduces the design\'s own worked example spacing — one poll (60s) apart', () => {
    const first = Date.parse('2026-07-30T00:00:00Z')
    expect(formatElapsed(first, first)).toBe('00:00')
    expect(formatElapsed(first + 60_000, first)).toBe('01:00')
    expect(formatElapsed(first + 7 * 60_000 + 20_000, first)).toBe('07:20')
  })

  it('never goes negative even if a clock skew makes atMs precede firstAtMs', () => {
    const first = Date.parse('2026-07-30T00:00:10Z')
    expect(formatElapsed(first - 5000, first)).toBe('00:00')
  })
})

describe('describeEntry', () => {
  it('matches the design\'s own log line shape when a previous entry exists to diff against', () => {
    const previous: TelemetryEntry = { atMs: 0, tier1: snapshot({ stacked_frame: 422, focus_position: 1642 }) }
    const entry: TelemetryEntry = { atMs: 60_000, tier1: snapshot({ stacked_frame: 428, focus_position: 1645 }) }
    expect(describeEntry(entry, previous)).toBe('stacked 428 (+6) | dropped 23 | solve OK | focus Δ=+3')
  })

  it('omits the delta (not a fabricated +0) on the first entry, with nothing to diff against', () => {
    const entry: TelemetryEntry = { atMs: 0, tier1: snapshot() }
    expect(describeEntry(entry, null)).toBe('stacked 428 | dropped 23 | solve OK | focus 1645')
  })

  it('drops a clause entirely, rather than padding it, when its field is absent from this snapshot', () => {
    const entry: TelemetryEntry = { atMs: 0, tier1: snapshot({ solve_ok: null, focus_position: null }) }
    const line = describeEntry(entry, null)
    expect(line).toBe('stacked 428 | dropped 23')
    expect(line).not.toMatch(/solve/)
    expect(line).not.toMatch(/focus/)
  })

  it('renders a negative focus delta and a negative stacked delta with their own sign, not a fabricated "+"', () => {
    const previous: TelemetryEntry = { atMs: 0, tier1: snapshot({ stacked_frame: 430, focus_position: 1650 }) }
    const entry: TelemetryEntry = { atMs: 60_000, tier1: snapshot({ stacked_frame: 428, focus_position: 1645 }) }
    const line = describeEntry(entry, previous)
    expect(line).toMatch(/\(-2\)/)
    expect(line).toMatch(/Δ=-5/)
  })
})
