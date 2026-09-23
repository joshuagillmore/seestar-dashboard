import { describe, expect, it } from 'vitest'
import {
  describeGoal,
  formatHours,
  goalLabel,
  goalMet,
  goalProgressPct,
  hasNumericGoal,
} from './integrationGoal'
import type { IntegrationGoal } from './schemas'

const goal = (overrides: Partial<IntegrationGoal> = {}): IntegrationGoal => ({
  track: 'photometric',
  suggested_hours: 3.0,
  coarse: false,
  beyond_reach: false,
  surface_brightness: 23.3,
  bortle_multiplier: 1.0,
  reason: null,
  note: 'note',
  ...overrides,
})

describe('describeGoal', () => {
  it('reads "not-catalogued" from a bare null, not from track "none"', () => {
    expect(describeGoal(null)).toEqual({ kind: 'not-catalogued' })
  })

  it('distinguishes no_magnitude from photometry_unreliable — two different reasons, both track "none"', () => {
    const noMag = goal({ track: 'none', suggested_hours: null, reason: 'no_magnitude' })
    const unreliable = goal({ track: 'none', suggested_hours: null, reason: 'photometry_unreliable' })
    expect(describeGoal(noMag)).toEqual({ kind: 'no-goal', reason: 'no_magnitude', note: 'note' })
    expect(describeGoal(unreliable)).toEqual({ kind: 'no-goal', reason: 'photometry_unreliable', note: 'note' })
  })

  it('reads beyond-reach only when the flag is set, regardless of track', () => {
    expect(describeGoal(goal({ beyond_reach: true, suggested_hours: null }))).toEqual({
      kind: 'beyond-reach',
      note: 'note',
    })
  })

  it('reads a real number for both the cluster and (non-coarse) photometric tracks', () => {
    expect(describeGoal(goal({ track: 'cluster', suggested_hours: 2.0, coarse: true }))).toEqual({
      kind: 'goal',
      hours: 2.0,
      coarse: true,
      note: 'note',
    })
    expect(describeGoal(goal({ track: 'photometric', suggested_hours: 4.5, coarse: false }))).toEqual({
      kind: 'goal',
      hours: 4.5,
      coarse: false,
      note: 'note',
    })
  })
})

describe('goalLabel', () => {
  it('gives each of the four absent/qualified states its own distinct text', () => {
    const notCatalogued = goalLabel(null, false).text
    const noMagnitude = goalLabel(goal({ track: 'none', suggested_hours: null, reason: 'no_magnitude' }), false).text
    const unreliable = goalLabel(
      goal({ track: 'none', suggested_hours: null, reason: 'photometry_unreliable' }),
      false,
    ).text
    const beyondReach = goalLabel(goal({ beyond_reach: true, suggested_hours: null }), false).text
    const texts = [notCatalogued, noMagnitude, unreliable, beyondReach]
    expect(new Set(texts).size).toBe(4) // all four distinct — no accidental collapse
  })

  it('prefixes a coarse figure with "~", leaves a real one bare', () => {
    expect(goalLabel(goal({ coarse: true, suggested_hours: 2.0 }), false).text).toBe('of ~2.0 h suggested')
    expect(goalLabel(goal({ coarse: false, suggested_hours: 2.0 }), false).text).toBe('of 2.0 h suggested')
  })

  it('never words a real number as needed/required/remaining', () => {
    const { text } = goalLabel(goal({ suggested_hours: 5.0 }), false)
    expect(text).toBe('of 5.0 h suggested')
    expect(text).not.toMatch(/needed|required|remaining|short of/i)
  })

  it('doubles the displayed hours, and only the displayed hours, when doubled=true', () => {
    expect(goalLabel(goal({ suggested_hours: 3.0 }), true).text).toBe('of 6.0 h suggested')
    expect(goalLabel(goal({ suggested_hours: 3.0, coarse: true }), true).text).toBe('of ~6.0 h suggested')
  })

  it('carries the server\'s own note into the title, for the states that have one', () => {
    const withNote = goalLabel(goal({ track: 'none', suggested_hours: null, reason: 'no_magnitude', note: 'the real note' }), false)
    expect(withNote.title).toBe('the real note')
    expect(goalLabel(null, false).title).toBeUndefined() // nothing to explain — the server never said why
  })
})

describe('goalProgressPct', () => {
  it('is null whenever describeGoal is not "goal"', () => {
    expect(goalProgressPct(100, null, false)).toBeNull()
    expect(goalProgressPct(100, goal({ track: 'none', suggested_hours: null, reason: 'no_magnitude' }), false)).toBeNull()
    expect(goalProgressPct(100, goal({ beyond_reach: true, suggested_hours: null }), false)).toBeNull()
  })

  it('computes a rounded percentage and clamps at 100', () => {
    expect(goalProgressPct(30, goal({ suggested_hours: 1.0 }), false)).toBe(50)
    expect(goalProgressPct(90, goal({ suggested_hours: 1.0 }), false)).toBe(100)
  })

  it('halves the percentage when doubled', () => {
    expect(goalProgressPct(30, goal({ suggested_hours: 1.0 }), true)).toBe(25)
  })

  it('never shows 100 for a goal not yet met — 99.5% is not complete', () => {
    // 597 of 600 minutes: three minutes short. Math.round(99.5) is 100, which
    // drew a full bar and (via projectStatus) a "complete" tag.
    expect(goalProgressPct(597, goal({ suggested_hours: 10 }), false)).toBe(99)
    expect(goalProgressPct(600, goal({ suggested_hours: 10 }), false)).toBe(100)
  })
})

describe('goalMet — compares the raw minutes, never a rounded percentage', () => {
  it('is false three minutes short of a 10 h goal', () => {
    expect(goalMet(597, goal({ suggested_hours: 10 }), false)).toBe(false)
  })

  it('is true at and past the goal', () => {
    expect(goalMet(600, goal({ suggested_hours: 10 }), false)).toBe(true)
    expect(goalMet(900, goal({ suggested_hours: 10 }), false)).toBe(true)
  })

  it('measures against the doubled figure when doubled', () => {
    expect(goalMet(900, goal({ suggested_hours: 10 }), true)).toBe(false)
  })

  it('is null when there is no numeric goal to meet', () => {
    expect(goalMet(100, null, false)).toBeNull()
    expect(goalMet(100, goal({ beyond_reach: true, suggested_hours: null }), false)).toBeNull()
  })
})

describe('hasNumericGoal', () => {
  it('is true only for the "goal" kind', () => {
    expect(hasNumericGoal(goal({ suggested_hours: 2.0 }))).toBe(true)
    expect(hasNumericGoal(null)).toBe(false)
    expect(hasNumericGoal(goal({ beyond_reach: true, suggested_hours: null }))).toBe(false)
    expect(hasNumericGoal(goal({ track: 'none', suggested_hours: null, reason: 'no_magnitude' }))).toBe(false)
  })
})

describe('formatHours', () => {
  it('formats to one decimal with a unit suffix', () => {
    expect(formatHours(180)).toBe('3.0 h')
    expect(formatHours(37)).toBe('0.6 h')
  })
})
