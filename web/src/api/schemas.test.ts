import { describe, expect, it } from 'vitest'
import {
  ConditionsSchema,
  FocuserPositionSchema,
  GuardrailsSchema,
  ListProjectsSchema,
  LivePreviewSchema,
  PlanTargetsSchema,
  ProjectsCombinedSchema,
  SiteProfileSchema,
  StatusSchema,
  TargetObservabilitySchema,
  Tier1Schema,
  ViewStateSchema,
} from './schemas'
import {
  goConditions,
  liveFocuserPosition,
  liveGuardrails,
  livePreviewNone,
  livePreviewStacked,
  livePreviewStale,
  livePreviewSub,
  liveStatus,
  liveTargetObservability,
  liveTier1,
  liveViewState,
  liveViewStatePreStack,
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

/**
 * Slice 3 has no recorded fixtures (see test/fixtures.ts) — these parse the
 * hand-built synthetic ones instead, so they are a check on this repo's own
 * schema definitions, not yet an early-warning system against the real
 * server. Replace with `describe('fixture contract')`-style recorded
 * parsing the moment record.py captures a real session.
 */
describe('live-session schemas (synthetic — no recorded fixture yet)', () => {
  it('parses get_view_state\'s nested result.View.Stack.Annotate shape', () => {
    const parsed = ViewStateSchema.parse(liveViewState())
    expect(parsed.result?.View?.Stack?.stacked_frame).toBe(428)
    expect(parsed.result?.View?.Stack?.dropped_frame).toBe(23)
    expect(parsed.result?.View?.Stack?.Annotate?.pixelx).toBe(512)
    expect(parsed.result?.View?.Stack?.Annotate?.pixely).toBe(934)
  })

  it('rejects a payload with View.Stack hoisted to the top level — the exact bug the nesting note warns about', () => {
    // A parser (or a schema) that read View.Stack at the top level would
    // find nothing, silently — the slice-3 spec says this already happened
    // once server-side. Prove ViewStateSchema actually requires the nesting
    // by asserting the flattened shape fails validation outright, rather
    // than silently parsing into an empty/undefined `result`.
    const flattened = { ok: true, stacked_frame: 428, dropped_frame: 23 }
    expect(ViewStateSchema.safeParse(flattened).success).toBe(false)
  })

  it('accepts a pre-stack stage with Stack absent', () => {
    const parsed = ViewStateSchema.parse(liveViewStatePreStack())
    expect(parsed.result?.View?.stage).toBe('3PPA')
    expect(parsed.result?.View?.Stack).toBeNull()
  })

  it('parses get_status', () => {
    expect(() => StatusSchema.parse(liveStatus())).not.toThrow()
  })

  it('parses check_night_guardrails, five checks and a verdict', () => {
    const parsed = GuardrailsSchema.parse(liveGuardrails())
    expect(parsed.checks).toHaveLength(5)
    expect(parsed.verdict).toBe('continue')
  })

  it('parses qa_tier1', () => {
    expect(() => Tier1Schema.parse(liveTier1())).not.toThrow()
  })

  it('parses get_focuser_position', () => {
    expect(FocuserPositionSchema.parse(liveFocuserPosition()).position).toBe(1645)
  })

  it('parses get_target_observability', () => {
    expect(() => TargetObservabilitySchema.parse(liveTargetObservability())).not.toThrow()
  })

  it('parses every live_preview source state — stacked, sub, stale, and none', () => {
    expect(LivePreviewSchema.parse(livePreviewStacked()).source).toBe('stacked')
    expect(LivePreviewSchema.parse(livePreviewSub()).source).toBe('sub')
    expect(LivePreviewSchema.parse(livePreviewStale()).stale).toBe(true)
    const none = LivePreviewSchema.parse(livePreviewNone())
    expect(none.source).toBeNull()
    expect(none.reason).toBeTruthy()
  })
})
