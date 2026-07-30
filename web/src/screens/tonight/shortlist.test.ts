import { describe, expect, it } from 'vitest'
import { shortlistOrderLabel } from './shortlist'
import { PlanTargetsSchema, type PlanTarget } from '../../api/schemas'
import { recordedPlan } from '../../test/fixtures'

// shortlistOrderLabel only reads `.id` off each target — a bare id is enough
// to exercise the ordering/count logic without dragging in every PlanTarget
// field a real fixture carries.
const stub = (id: string): PlanTarget => ({ id } as PlanTarget)

describe('shortlistOrderLabel', () => {
  it('joins target ids in array order with an arrow, and counts slews as one fewer than target count', () => {
    const targets = ['SH2-142', 'M31', 'M45'].map(stub)
    expect(shortlistOrderLabel(targets)).toBe(
      'Order: SH2-142 → M31 → M45 · earliest-setting first, 2 slews',
    )
  })

  it('singularizes "slew" for exactly two targets, not just any count', () => {
    const targets = ['A', 'B'].map(stub)
    expect(shortlistOrderLabel(targets)).toMatch(/1 slew$/)
    expect(shortlistOrderLabel(targets)).not.toMatch(/1 slews$/)
  })

  it('never goes negative for zero or one target', () => {
    expect(shortlistOrderLabel([])).toMatch(/0 slews$/)
    expect(shortlistOrderLabel([stub('SOLO')])).toMatch(/0 slews$/)
  })

  it('matches the real 12-target recorded fixture: 11 slews, order equal to the array order', () => {
    const targets = PlanTargetsSchema.parse(recordedPlan()).targets
    const label = shortlistOrderLabel(targets)
    expect(label).toMatch(/11 slews$/)
    expect(label).toBe(`Order: ${targets.map((t) => t.id).join(' → ')} · earliest-setting first, 11 slews`)
  })
})
