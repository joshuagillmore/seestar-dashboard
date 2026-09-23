import { describe, expect, it } from 'vitest'
import { StackStateSchema, Tier1Schema, ViewStateSchema } from '../../api/schemas'
import { recordedTier1, recordedViewState } from '../../test/fixtures'
import {
  ANNOTATE_STATE_OK,
  deriveTelemetryValues,
  droppedPct,
  formatAnnotateState,
  formatExposure,
  formatStageHistory,
  integrationMinutes,
} from './telemetryFormatting'

describe('integration from the running exposure', () => {
  it('is kept frames × sub exposure — the recorded session: 115 × 10 s', () => {
    expect(integrationMinutes(115, 10_000)).toBeCloseTo(19.17, 2)
  })

  it('is null, not 0, when either figure is missing', () => {
    expect(integrationMinutes(null, 10_000)).toBeNull()
    expect(integrationMinutes(115, null)).toBeNull()
  })

  it('formats a sub exposure in seconds, without a trailing .0', () => {
    expect(formatExposure(10_000)).toBe('10 s')
    expect(formatExposure(2_500)).toBe('2.5 s')
  })

  it('is derived from the recorded payload alongside the other telemetry values', () => {
    const stack = ViewStateSchema.parse(recordedViewState()).view_state?.result?.View?.Stack ?? null
    const values = deriveTelemetryValues(stack, Tier1Schema.parse(recordedTier1()), null)
    expect(values.exposureMs).toBe(10_000)
    expect(values.integrationMin).toBeCloseTo(19.17, 2)
  })

  it('reports no exposure when the Stack block carries none', () => {
    const stack = StackStateSchema.parse({ stacked_frame: 3, dropped_frame: 0 })
    const values = deriveTelemetryValues(stack, null, null)
    expect(values.exposureMs).toBeNull()
    expect(values.integrationMin).toBeNull()
  })
})

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
