import { describe, expect, it } from 'vitest'
import { appendTelemetryEntry, formatElapsed, MAX_LOG_ENTRIES, type TelemetryEntry } from './telemetryLog'
import type { Tier1 } from '../../api/schemas'

const snapshot = (ts: string, over: Partial<Tier1['snapshot']> = {}): Tier1 => ({
  ok: true,
  snapshot: {
    ts,
    stacked: 211,
    rejected: 0,
    solve_ok: true,
    solve_rms: 1.8,
    focus_pos: 1830,
    hfd: 2.4,
    tracking: true,
    ...over,
  },
  flags: [],
  status_line: 'stacked 211 (+1) | rejected 0 | solve OK | focus Δ=+3 | hfd 2.40',
  trends: { stacked_delta: 1, rejected_delta: 0, focus_delta: 3, hfd_delta: -0.02 },
})

describe('appendTelemetryEntry', () => {
  it('appends newest last (callers render newest-first by reversing)', () => {
    const log = appendTelemetryEntry(
      appendTelemetryEntry([], snapshot('2026-07-30T00:00:00Z', { stacked: 1 })),
      snapshot('2026-07-30T00:01:00Z', { stacked: 2 }),
    )
    expect(log.map((e) => e.tier1.snapshot.stacked)).toEqual([1, 2])
  })

  it('caps retention at MAX_LOG_ENTRIES, dropping the oldest first', () => {
    let log: TelemetryEntry[] = []
    for (let i = 0; i < MAX_LOG_ENTRIES + 10; i++) {
      log = appendTelemetryEntry(log, snapshot('2026-07-30T00:00:00Z', { stacked: i }))
    }
    expect(log).toHaveLength(MAX_LOG_ENTRIES)
    expect(log[0].tier1.snapshot.stacked).toBe(10) // the first 10 were evicted
    expect(log[log.length - 1].tier1.snapshot.stacked).toBe(MAX_LOG_ENTRIES + 9)
  })
})

describe('formatElapsed', () => {
  it('reads elapsed time from the server\'s own snapshot.ts, not a client fetch time', () => {
    const first: TelemetryEntry = { tier1: snapshot('2026-07-30T00:00:00Z') }
    expect(formatElapsed(first, first)).toBe('00:00')
    expect(formatElapsed({ tier1: snapshot('2026-07-30T00:01:00Z') }, first)).toBe('01:00')
    expect(formatElapsed({ tier1: snapshot('2026-07-30T00:07:20Z') }, first)).toBe('07:20')
  })

  it('never goes negative even if a clock skew makes an entry precede the first one', () => {
    const first: TelemetryEntry = { tier1: snapshot('2026-07-30T00:00:10Z') }
    expect(formatElapsed({ tier1: snapshot('2026-07-30T00:00:05Z') }, first)).toBe('00:00')
  })
})

describe('formatElapsed timestamp shapes', () => {
  const entry = (ts: string) =>
    ({ tier1: { snapshot: { ts } } }) as unknown as Parameters<typeof formatElapsed>[0]

  it('handles the offset-bearing shape qa_tier1 actually emits', () => {
    // seestar-mcp's projects/provenance layer emits `...+00:00`.
    expect(
      formatElapsed(entry('2026-07-31T18:53:57.970086+00:00'), entry('2026-07-31T18:52:57.970086+00:00')),
    ).toBe('01:00')
  })

  it('reads a naive timestamp as UTC, not local', () => {
    // The regression this guards: a bare Date.parse treats a date-time with no
    // offset as LOCAL time, so on a UTC-4 machine the elapsed counter would be
    // out by four hours — silently, and only for whoever is not on UTC.
    // seestar-mcp's planning layer emits exactly this shape, and a field
    // changing layer is not hypothetical.
    expect(formatElapsed(entry('2026-08-01T04:01:30'), entry('2026-08-01T04:00:00'))).toBe('01:30')
  })

  it('gives the same answer whichever shape the two timestamps use', () => {
    const mixed = formatElapsed(entry('2026-08-01T04:01:00+00:00'), entry('2026-08-01T04:00:00'))
    expect(mixed).toBe('01:00')
  })
})
