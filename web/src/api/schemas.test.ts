import { describe, expect, it } from 'vitest'
import {
  ConditionsSchema,
  ListProjectsSchema,
  PlanTargetsSchema,
  ProjectsCombinedSchema,
  SiteProfileSchema,
} from './schemas'
import {
  goConditions,
  recordedConditions,
  recordedListProjects,
  recordedPlan,
  recordedProjectsCombined,
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

  it('parses the recorded list_projects payload', () => {
    expect(() => ListProjectsSchema.parse(recordedListProjects())).not.toThrow()
  })

  it('parses the recorded projects_combined payload', () => {
    expect(() => ProjectsCombinedSchema.parse(recordedProjectsCombined())).not.toThrow()
  })

  it('tolerates the null median_fwhm every real session record actually has', () => {
    const parsed = ListProjectsSchema.parse(recordedListProjects())
    const sessions = parsed.projects.flatMap((p) => p.sessions)
    // Non-vacuous only if there are real sessions to check — guard against a
    // future empty fixture making the .every() below trivially true.
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.every((s) => s.median_fwhm === null)).toBe(true)
  })

  it('confirms every recorded project has goal_minutes 0 — the fact this screen is built around', () => {
    const parsed = ListProjectsSchema.parse(recordedListProjects())
    expect(parsed.projects.length).toBeGreaterThan(0)
    expect(parsed.projects.every((p) => p.goal_minutes === 0)).toBe(true)
  })

  it('accepts both source tags projects_combined actually sends', () => {
    const parsed = ProjectsCombinedSchema.parse(recordedProjectsCombined())
    const seen = new Set(parsed.projects.flatMap((p) => p.sources))
    expect(seen.has('store')).toBe(true)
    expect(seen.has('archive')).toBe(true)
  })

  it('parses every goal shape the recorded fixture actually contains: null, track "none" with each reason, and a real number', () => {
    const parsed = ProjectsCombinedSchema.parse(recordedProjectsCombined())
    const goals = parsed.projects.map((p) => p.goal)
    expect(goals.some((g) => g === null)).toBe(true) // e.g. "Unknown"
    expect(goals.some((g) => g?.reason === 'no_magnitude')).toBe(true) // e.g. SH2-142
    expect(goals.some((g) => g?.reason === 'photometry_unreliable')).toBe(true) // IC 405
    expect(goals.some((g) => g !== null && g.track !== 'none' && g.suggested_hours !== null)).toBe(true)
  })

  it('finds IC 405 flagged photometry_unreliable, not beyond_reach — the case CLAUDE.md singles out by name', () => {
    const parsed = ProjectsCombinedSchema.parse(recordedProjectsCombined())
    const ic405 = parsed.projects.find((p) => p.target_id === 'IC405')
    expect(ic405?.goal?.reason).toBe('photometry_unreliable')
    expect(ic405?.goal?.beyond_reach).toBe(false)
  })
})
