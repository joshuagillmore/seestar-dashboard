import { describe, expect, it } from 'vitest'
import { ConditionsSchema, PlanTargetsSchema, SiteProfileSchema } from './schemas'
import {
  goConditions,
  recordedConditions,
  recordedPlan,
  recordedSite,
  unknownConditions,
} from '../test/fixtures'

/**
 * The early-warning system for drift between this repo and SeeStar-AI. When the
 * server's payload changes, this fails with a field-level message instead of the
 * UI silently rendering blank cards.
 */
describe('fixture contract', () => {
  it('parses the recorded conditions payload', () => {
    expect(() => ConditionsSchema.parse(recordedConditions())).not.toThrow()
  })

  it('parses the recorded plan payload', () => {
    expect(() => PlanTargetsSchema.parse(recordedPlan())).not.toThrow()
  })

  it('parses the recorded site profile', () => {
    expect(() => SiteProfileSchema.parse(recordedSite())).not.toThrow()
  })

  it('parses both synthetic conditions variants', () => {
    expect(() => ConditionsSchema.parse(goConditions())).not.toThrow()
    expect(() => ConditionsSchema.parse(unknownConditions())).not.toThrow()
  })

  it('tolerates the nulls the real server actually sends', () => {
    const parsed = ConditionsSchema.parse(recordedConditions())
    expect(parsed.location.matched).toBeNull()
    expect(parsed.location.warning).toContain('GPS unverified')
  })

  it('keeps go as a tri-state and never coerces null to false', () => {
    expect(ConditionsSchema.parse(unknownConditions()).go).toBeNull()
    expect(ConditionsSchema.parse(recordedConditions()).go).toBe(false)
  })
})
