import { describe, expect, it } from 'vitest'
import { shortlistOrderLabel } from './shortlist'
import { PlanTargetsSchema, type PlanTarget } from '../../api/schemas'
import { recordedPlan } from '../../test/fixtures'

// shortlistOrderLabel only reads `.id` off each target — a bare id is enough
// to exercise the ordering/count logic without dragging in every PlanTarget
// field a real fixture carries.
const stub = (id: string): PlanTarget => ({ id } as PlanTarget)

describe('shortlistOrderLabel', () => {
  it('matches the design example exactly at 3 targets — no truncation marker', () => {
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

  it('does not truncate right at the cap (3 targets)', () => {
    const targets = ['A', 'B', 'C'].map(stub)
    expect(shortlistOrderLabel(targets)).toBe('Order: A → B → C · earliest-setting first, 2 slews')
  })

  it('truncates the chain to the first 3 ids plus a count one past the cap (4 targets)', () => {
    const targets = ['A', 'B', 'C', 'D'].map(stub)
    // The rationale (slew count) still reflects the FULL list, not the
    // truncated chain — truncating the display must never truncate the count.
    expect(shortlistOrderLabel(targets)).toBe('Order: A → B → C → +1 more · earliest-setting first, 3 slews')
  })

  it('matches the real 12-target recorded fixture: chain capped at 3, but 11 slews (the full count)', () => {
    const targets = PlanTargetsSchema.parse(recordedPlan()).targets
    expect(targets).toHaveLength(12)
    const label = shortlistOrderLabel(targets)
    const [a, b, c] = targets.map((t) => t.id)
    expect(label).toBe(`Order: ${a} → ${b} → ${c} → +9 more · earliest-setting first, 11 slews`)
    // Guards the cap itself: none of the later ids should leak into the
    // chain even though they're real target ids that could plausibly appear.
    for (const id of targets.slice(3).map((t) => t.id)) {
      expect(label).not.toContain(id)
    }
  })

  it('stays a bounded length at 50 targets — plan_targets accepts limit up to 50, and the line must not scale with it', () => {
    const targets = Array.from({ length: 50 }, (_, i) => stub(`T${i}`))
    const label = shortlistOrderLabel(targets)
    expect(label).toBe('Order: T0 → T1 → T2 → +47 more · earliest-setting first, 49 slews')
    // The bound that actually matters: this must not grow linearly with
    // target count the way the pre-cap implementation did (a 50-id chain
    // alone would run past 250 characters).
    expect(label.length).toBeLessThan(100)
  })
})
