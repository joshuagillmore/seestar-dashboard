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
 * Slice 3 (Live session) — six of these are recorded fixtures, hand-authored
 * by the sidecar side against `SeeStar-AI/src/seestar_mcp/server.py`'s
 * controller methods (no live hardware session was available to record.py
 * this task, but the shapes are traced through source, not guessed — see
 * `.superpowers/live-sidecar-report.md`). Named `recordedXxx` for
 * consistency with every other fixture above, even though `record.py`
 * itself hasn't run against live hardware yet.
 *
 * `/api/live_preview` has no recorded fixture (it's a sidecar-computed
 * route, not a tool call — see allowlist.SIDECAR_ROUTES) — those four stay
 * hand-built synthetic fixtures, mirroring the real route's own shape
 * (`{ok, source, captured_at, stack_count, target, stale, reason, url}`,
 * verified directly against `routes.py`'s `_live_preview_frame`/
 * `_live_preview_absent`).
 */
export const recordedViewState = () => loadFixture('get_view_state')
export const recordedStatus = () => loadFixture('get_status')
export const recordedGuardrails = () => loadFixture('check_night_guardrails')
export const recordedTier1 = () => loadFixture('qa_tier1')
export const recordedFocuserPosition = () => loadFixture('get_focuser_position')
export const recordedObservability = () => loadFixture('get_target_observability')
export const livePreviewStacked = () => loadFixture('synthetic/live_preview_stacked')
export const livePreviewSub = () => loadFixture('synthetic/live_preview_sub')
export const livePreviewStale = () => loadFixture('synthetic/live_preview_stale')
export const livePreviewNone = () => loadFixture('synthetic/live_preview_none')

/** `/api/last_stack` still has no fixture recorded off live hardware — the
 * sidecar route (handback item 23's workaround) was built in parallel with
 * this task — but both files below are shaped from the real, committed
 * route source (`sidecar/seestar_sidecar/routes.py`'s `_last_stack_payload`/
 * `_last_stack_absent`), not guessed: `reason: null` / a literal
 * `"/api/last_stack/image"` url on success, `target: null` with the real
 * `no_stack` wire token (never a hand-written sentence — see
 * lastStack.ts's own `lastStackReasonLabel`) on the absent branch.
 * `lastStackFound` mirrors the team's own worked example (M27, 12 Jul, 178
 * frames); `lastStackAbsent` is the normal "nothing completed yet for this
 * target" state, same discriminator convention as `livePreviewNone` above. */
export const lastStackFound = () => loadFixture('synthetic/last_stack_found')
export const lastStackAbsent = () => loadFixture('synthetic/last_stack_absent')

/** `/api/session_activity` also has no recorded fixture — hand-built to
 * mirror the three `origin` states `session_activity.py`'s own tests use as
 * worked examples: a tool with no dashboard route at all (`agent`), the
 * shared native tag both this dashboard and the agent can produce
 * (`ambiguous`), and a line that failed to parse (`unknown`, every field
 * null). See schemas.ts's own doc comment on the honesty constraint this
 * exists under. */
export const sessionActivity = () => loadFixture('synthetic/session_activity')
