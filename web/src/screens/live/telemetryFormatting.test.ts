import { describe, expect, it } from 'vitest'
import { ANNOTATE_STATE_OK, droppedPct, formatAnnotateState, formatStageHistory } from './telemetryFormatting'

describe('droppedPct', () => {
  it('matches the recorded fixture\'s own numbers — 0 rejected of 211 kept', () => {
    expect(droppedPct(211, 0)).toBe(0)
  })

  it('computes a real percentage when frames actually dropped', () => {
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
  it('renders the recorded fixture\'s real value verbatim', () => {
    expect(formatAnnotateState('complete')).toBe('complete')
    expect(formatAnnotateState('complete')).toBe(ANNOTATE_STATE_OK)
  })

  it('renders an honest dash when there is no annotation yet', () => {
    expect(formatAnnotateState(null)).toBe('—')
    expect(formatAnnotateState(undefined)).toBe('—')
  })
})
