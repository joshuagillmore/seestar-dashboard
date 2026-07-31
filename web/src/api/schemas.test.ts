import { describe, expect, it } from 'vitest'
import {
  ConditionsSchema,
  FocuserPositionSchema,
  GuardrailsSchema,
  ListProjectsSchema,
  LivePreviewSchema,
  PlanTargetsSchema,
  ProjectsCombinedSchema,
  SessionActivitySchema,
  SiteProfileSchema,
  StatusSchema,
  TargetObservabilitySchema,
  Tier1Schema,
  ViewStateSchema,
} from './schemas'
import {
  goConditions,
  livePreviewNone,
  livePreviewStacked,
  livePreviewStale,
  livePreviewSub,
  recordedConditions,
  recordedFocuserPosition,
  recordedGuardrails,
  recordedListProjects,
  recordedObservability,
  recordedPlan,
  recordedProjectsCombined,
  recordedSite,
  recordedStatus,
  recordedTier1,
  recordedViewState,
  sessionActivity,
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
 * Slice 3's live-session tools — six recorded fixtures, hand-authored
 * against SeeStar-AI's controller source (no live hardware session was
 * available; see test/fixtures.ts's own doc comment and
 * .superpowers/live-sidecar-report.md). `/api/live_preview` has no recorded
 * fixture (a sidecar-computed route, not a tool call) and stays synthetic.
 */
describe('live-session schemas', () => {
  it('parses get_view_state\'s real nesting — ok.view_state.result.View.Stack.Annotate', () => {
    const parsed = ViewStateSchema.parse(recordedViewState())
    const view = parsed.view_state?.result?.View
    expect(view?.Stack?.stacked_frame).toBe(211)
    expect(view?.Stack?.dropped_frame).toBe(0)
    expect(view?.Stack?.Annotate?.pixelx).toBe(219)
    expect(view?.Stack?.Annotate?.pixely).toBe(960)
    expect(view?.Stack?.Annotate?.state).toBe('complete')
  })

  it('rejects a payload missing the view_state wrapper — the exact extra-nesting bug an earlier version of this schema had', () => {
    // A parser (or a schema) reading `ok.result.View` directly — one level
    // shallower than the real shape — would find nothing, silently. That
    // was this schema's own first draft, caught only once a real fixture
    // landed. Prove the wrapper is load-bearing by asserting a payload
    // missing it fails validation outright.
    const missingWrapper = { ok: true, result: { View: { stage: 'Stack' } } }
    expect(ViewStateSchema.safeParse(missingWrapper).success).toBe(false)
  })

  it('accepts a pre-stack stage with Stack absent', () => {
    // Not observed in the one recorded fixture (which is mid-stack) but a
    // documented state transition (3PPA/AutoGoto precede Stack) — Stack
    // stays nullable/optional on that reasoning, checked here directly
    // rather than assumed.
    const parsed = ViewStateSchema.parse({
      ok: true,
      view_state: { result: { View: { stage: '3PPA', Stack: null } } },
    })
    expect(parsed.view_state?.result?.View?.stage).toBe('3PPA')
    expect(parsed.view_state?.result?.View?.Stack).toBeNull()
  })

  it('parses the connected-but-idle payload, where `result` is {} and `View` is absent', () => {
    // Captured from live hardware 2026-07-31: scope connected and tracking,
    // no view session, so get_view_state returns `result: {}` — the `View`
    // key is *missing*, not null.
    //
    // This is the most common real state of the screen, and it used to throw:
    // `View` was `.nullable()`, which accepts null but rejects undefined, so
    // the Live screen showed a parse error whenever nothing was stacking. No
    // fixture caught it because every one had either a full `View` or a null
    // payload — nobody had written the empty middle. Only real hardware did.
    const live = {
      ok: true,
      view_state: {
        jsonrpc: '2.0',
        Timestamp: '2439.848473865',
        method: 'get_view_state',
        result: {},
        code: 0,
        id: 10054,
      },
    }
    const parsed = ViewStateSchema.parse(live)
    expect(parsed.ok).toBe(true)
    // The point is that it parses *and* reports no view — not that it merely
    // fails to throw.
    expect(parsed.view_state?.result?.View ?? null).toBeNull()
  })

  it('parses get_status', () => {
    expect(() => StatusSchema.parse(recordedStatus())).not.toThrow()
  })

  it('parses check_night_guardrails\' real flat shape — proceed/action/reasons/hard_stops, not five named checks', () => {
    const parsed = GuardrailsSchema.parse(recordedGuardrails())
    expect(parsed.proceed).toBe(true)
    expect(parsed.action).toBe('continue')
    expect(parsed.reasons).toEqual([])
    expect(parsed.hard_stops).toEqual([])
  })

  it('parses qa_tier1\'s real shape — snapshot/flags/status_line/trends', () => {
    const parsed = Tier1Schema.parse(recordedTier1())
    expect(parsed.snapshot.stacked).toBe(211)
    expect(parsed.snapshot.rejected).toBe(0)
    expect(parsed.status_line).toMatch(/^stacked 211/)
    expect(parsed.trends?.focus_delta).toBe(3)
  })

  it('parses get_focuser_position\'s flat focus_pos field', () => {
    expect(FocuserPositionSchema.parse(recordedFocuserPosition()).focus_pos).toBe(1830)
  })

  it('parses get_target_observability as the nightly aggregate it really is — max_alt_deg, not a current-alt/az reading', () => {
    const parsed = TargetObservabilitySchema.parse(recordedObservability())
    expect(parsed.target?.id).toBe('M27')
    expect(parsed.observability?.max_alt_deg).toBe(61.4)
    expect(parsed.observability?.transits_above_ceiling).toBe(false)
    expect(parsed.observability?.best_window_utc).toHaveLength(2)
  })

  it('parses every live_preview source state — stacked, sub, stale, and none', () => {
    expect(LivePreviewSchema.parse(livePreviewStacked()).source).toBe('stacked')
    expect(LivePreviewSchema.parse(livePreviewSub()).source).toBe('sub')
    expect(LivePreviewSchema.parse(livePreviewStale()).stale).toBe(true)
    const none = LivePreviewSchema.parse(livePreviewNone())
    expect(none.source).toBeNull()
    expect(none.reason).toBeTruthy()
  })

  it('parses session_activity\'s three origin states, including a fully-null unknown record', () => {
    const parsed = SessionActivitySchema.parse(sessionActivity())
    const origins = parsed.records.map((r) => r.origin)
    expect(origins).toEqual(['agent', 'ambiguous', 'unknown'])
    const unknown = parsed.records[2]
    expect(unknown.ts).toBeNull()
    expect(unknown.tool).toBeNull()
    expect(unknown.args).toBeNull()
    expect(parsed.truncated).toBe(true)
    expect(parsed.source_configured).toBe(true)
  })

  it('parses the not-configured session_activity state — records empty, source_configured false', () => {
    const parsed = SessionActivitySchema.parse({
      ok: true,
      records: [],
      truncated: false,
      source_configured: false,
    })
    expect(parsed.records).toEqual([])
    expect(parsed.source_configured).toBe(false)
  })
})
