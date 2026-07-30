import { describe, expect, it } from 'vitest'
import { droppedPct, focusDelta, formatAnnotateState, formatStageHistory, stackedDiff } from './telemetryFormatting'
import type { TelemetryEntry } from './telemetryLog'
import type { Tier1 } from '../../api/schemas'

const entry = (stacked: number | null): TelemetryEntry => ({
  atMs: 0,
  tier1: { ok: true, stacked_frame: stacked, dropped_frame: null, solve_ok: null, focus_position: null } as Tier1,
})

describe('stackedDiff', () => {
  it('is null with fewer than two entries — nothing to diff against yet', () => {
    expect(stackedDiff([])).toBeNull()
    expect(stackedDiff([entry(428)])).toBeNull()
  })

  it('diffs the two most recent entries, matching the design\'s "+6 last poll"', () => {
    expect(stackedDiff([entry(422), entry(428)])).toBe(6)
  })

  it('reports a negative diff honestly rather than clamping to zero', () => {
    expect(stackedDiff([entry(428), entry(425)])).toBe(-3)
  })
})

describe('droppedPct', () => {
  it('matches the design\'s own worked example — 23 of 451 frames', () => {
    expect(droppedPct(428, 23)).toBeCloseTo(5.1, 1)
  })

  it('is null when either count is missing, not a fabricated 0%', () => {
    expect(droppedPct(null, 23)).toBeNull()
    expect(droppedPct(428, null)).toBeNull()
  })

  it('is null rather than dividing by zero when nothing has been captured yet', () => {
    expect(droppedPct(0, 0)).toBeNull()
  })
})

describe('focusDelta', () => {
  it('matches the design\'s own worked example — baseline 1642, current 1645', () => {
    expect(focusDelta(1645, 1642)).toBe(3)
  })

  it('is null before a baseline has been established', () => {
    expect(focusDelta(1645, null)).toBeNull()
  })
})

describe('formatStageHistory', () => {
  it('renders a single observed stage with a checkmark', () => {
    expect(formatStageHistory(['Stack'])).toBe('Stack ✓')
  })

  it('joins the observed sequence, checkmarking only the current (last) stage', () => {
    expect(formatStageHistory(['3PPA', 'AutoGoto', 'Stack'])).toBe('3PPA → AutoGoto → Stack ✓')
  })

  it('renders an honest dash before any stage has been observed', () => {
    expect(formatStageHistory([])).toBe('—')
  })

  it('caps at the 4 most recent stages, trimming the oldest first, never the current one', () => {
    const long = formatStageHistory(['A', 'B', 'C', 'D', 'E', 'F'])
    expect(long).toBe('C → D → E → F ✓')
  })
})

describe('formatAnnotateState', () => {
  it('renders a boolean state as OK/FAILED', () => {
    expect(formatAnnotateState(true)).toBe('OK')
    expect(formatAnnotateState(false)).toBe('FAILED')
  })

  it('renders a string state verbatim, since the real type is not yet confirmed', () => {
    expect(formatAnnotateState('OK')).toBe('OK')
  })

  it('renders an honest dash when there is no annotation yet', () => {
    expect(formatAnnotateState(null)).toBe('—')
    expect(formatAnnotateState(undefined)).toBe('—')
  })
})
