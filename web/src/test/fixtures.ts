import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..', '..', 'fixtures')

export const loadFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(ROOT, `${name}.json`), 'utf8'))

export const recordedConditions = () => loadFixture('assess_conditions')
export const recordedPlan = () => loadFixture('plan_targets')
export const recordedSite = () => loadFixture('get_site_profile')
export const goConditions = () => loadFixture('synthetic/assess_conditions.go')
export const unknownConditions = () => loadFixture('synthetic/assess_conditions.unknown')
export const recordedListProjects = () => loadFixture('list_projects')
export const recordedRecommendProjects = () => loadFixture('recommend_projects')
/** Not an MCP tool fixture recorded by record.py — projects_combined is a
 * sidecar-computed route (list_projects + a real archive scan), so this was
 * generated once by running that same computation directly against the
 * recorded list_projects.json and the real archive directory. See the sidecar
 * report for how; the numbers here are real (33 targets, ~30.6h total). */
export const recordedProjectsCombined = () => loadFixture('projects_combined')

/**
 * Slice 3 (Live session) has no recorded fixtures yet — none of these tools
 * has run through `record.py` against a real session. Hand-built instead,
 * mirroring the design handoff's own sample values (SH2-142, stacked 428,
 * dropped 23, focus 1645, …) so a test reads as "the design's worked
 * example", not an arbitrary number. See schemas.ts's own doc comment on
 * why every field beyond the confirmed View.Stack/Annotate nesting and the
 * live_preview shape is deliberately optional.
 */
export const liveViewState = () => loadFixture('synthetic/live_view_state')
export const liveViewStatePreStack = () => loadFixture('synthetic/live_view_state_pre_stack')
export const liveStatus = () => loadFixture('synthetic/live_status')
export const liveGuardrails = () => loadFixture('synthetic/live_guardrails')
export const liveTier1 = () => loadFixture('synthetic/live_tier1')
export const liveFocuserPosition = () => loadFixture('synthetic/live_focuser_position')
export const liveTargetObservability = () => loadFixture('synthetic/live_target_observability')
export const livePreviewStacked = () => loadFixture('synthetic/live_preview_stacked')
export const livePreviewSub = () => loadFixture('synthetic/live_preview_sub')
export const livePreviewStale = () => loadFixture('synthetic/live_preview_stale')
export const livePreviewNone = () => loadFixture('synthetic/live_preview_none')
