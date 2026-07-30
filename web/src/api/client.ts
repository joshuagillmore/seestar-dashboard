import type { ZodType } from 'zod'
import {
  ConditionsSchema,
  FocuserPositionSchema,
  GuardrailsSchema,
  HealthSchema,
  ListProjectsSchema,
  LivePreviewSchema,
  PlanTargetsSchema,
  ProjectsCombinedSchema,
  RecommendProjectsSchema,
  SessionActivitySchema,
  SiteProfileSchema,
  StatusSchema,
  TargetObservabilitySchema,
  Tier1Schema,
  ViewStateSchema,
  type Conditions,
  type FocuserPosition,
  type Guardrails,
  type Health,
  type ListProjects,
  type LivePreview,
  type PlanTargets,
  type ProjectsCombined,
  type RecommendProjects,
  type SessionActivity,
  type SiteProfile,
  type Status,
  type TargetObservability,
  type Tier1,
  type ViewState,
} from './schemas'

export class ApiError extends Error {}

/** How to get the sidecar running, repeated in every message that means
 * "the sidecar didn't answer" — this is the one line of the app most
 * likely to be read by someone who has never seen the codebase. */
const SIDECAR_HINT =
  'make sure the sidecar is running (uv run seestar-dashboard) and reachable, by default at http://localhost:8000'

async function get<T>(path: string, schema: ZodType<T>): Promise<T> {
  let response: Response
  try {
    response = await fetch(path)
  } catch (cause) {
    throw new ApiError(`sidecar unreachable at ${path} — ${SIDECAR_HINT}`, { cause })
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    // A JSON {error} body means the sidecar formed the response itself and
    // has something specific to say (see _serve() in routes.py) — surface
    // that verbatim. Anything else — no body, or a body that isn't JSON —
    // means the request never reached sidecar code at all. That is not a
    // hypothetical: Vite's dev proxy resolves a dead sidecar as a *resolved*
    // fetch carrying an HTML 502 page, not a rejected fetch, so `HTTP 502`
    // used to be the only thing a stopped sidecar ever produced.
    const detail =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `sidecar returned HTTP ${response.status} for ${path} — ${SIDECAR_HINT}`
    throw new ApiError(detail)
  }
  // A tool-level failure arrives as {ok: false, error} at HTTP 200 — the MCP
  // tools never raise, so that is a valid response saying the tool itself
  // failed. Surface its message. Without this it falls through to schema
  // validation and reports "unexpected payload", which blames the shape for
  // what is really an upstream error.
  if (isToolFailure(body)) {
    throw new ApiError(String(body.error ?? 'the tool reported a failure'))
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    // Loud, not silent: a shape change should be visible, not a blank card.
    throw new ApiError(`unexpected payload from ${path}: ${parsed.error.message}`)
  }
  return parsed.data
}

function isToolFailure(body: unknown): body is { ok: false; error?: unknown } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'ok' in body &&
    (body as { ok: unknown }).ok === false
  )
}

export const fetchConditions = (): Promise<Conditions> =>
  get('/api/assess_conditions', ConditionsSchema)

export const fetchPlan = (limit = 12): Promise<PlanTargets> =>
  get(`/api/plan_targets?limit=${limit}`, PlanTargetsSchema)

export const fetchSite = (): Promise<SiteProfile> =>
  get('/api/get_site_profile', SiteProfileSchema)

/** Drives the top bar's "fixtures — not live" indicator. */
export const fetchHealth = (): Promise<Health> => get('/api/health', HealthSchema)

/** The store's own project records — goals, status, and per-session history.
 * Joined client-side with fetchProjectsCombined() by target_id; see
 * screens/projects/projects.ts. */
export const fetchProjects = (): Promise<ListProjects> =>
  get('/api/list_projects', ListProjectsSchema)

/** Totals unioned across the store and the on-disk archive scan, with
 * per-source provenance. Sidecar-computed, not an MCP tool call — see
 * routes.py's projects_combined. */
export const fetchProjectsCombined = (): Promise<ProjectsCombined> =>
  get('/api/projects_combined', ProjectsCombinedSchema)

/** Read-only, allowlisted (routes.py:171). Same shape as `fetchProjects` —
 * see `RecommendProjectsSchema`'s doc comment for why this doesn't get its
 * own schema. `limit` defaults unset (server default: no limit); the header
 * only ever needs the first entry, so callers should pass a small one. */
export const fetchRecommendProjects = (limit?: number): Promise<RecommendProjects> =>
  get(
    `/api/recommend_projects${limit !== undefined ? `?limit=${limit}` : ''}`,
    RecommendProjectsSchema,
  )

/**
 * Live-session fetchers (slice 3). Every one of these is expected to fail
 * or time out while the scope is idle — that is the documented normal case
 * (CLAUDE.md, "Known gap" / slice-3 spec §4), not a bug to retry around. Each
 * throws `ApiError` exactly like every fetcher above; screens/live/
 * useLiveSession.ts is what turns those failures into the idle/bridge-down
 * distinction, by seeing which calls fail together — see its own doc comment
 * for why that's a more honest signal than pattern-matching error text.
 */
export const fetchViewState = (): Promise<ViewState> => get('/api/get_view_state', ViewStateSchema)

export const fetchStatus = (): Promise<Status> => get('/api/get_status', StatusSchema)

/**
 * `session_start_utc` is a required query param the sidecar route has no
 * default for (routes.py's `check_night_guardrails` handler) — it needs to
 * know when the session started to compute dawn margin and max-duration
 * remaining. Nothing in the confirmed tool surface returns a real session
 * start time, so `useLiveSession` passes the moment THIS client first
 * observed the session as active, not the scope's actual start — see its
 * own doc comment. That means the max-duration/dawn-margin figures this
 * returns understate elapsed time whenever the dashboard connects mid-
 * session; flagged there and in the handback list, not silently assumed
 * accurate. */
export const fetchGuardrails = (sessionStartUtc: string): Promise<Guardrails> =>
  get(
    `/api/check_night_guardrails?session_start_utc=${encodeURIComponent(sessionStartUtc)}`,
    GuardrailsSchema,
  )

export const fetchTier1 = (): Promise<Tier1> => get('/api/qa_tier1', Tier1Schema)

export const fetchFocuserPosition = (): Promise<FocuserPosition> =>
  get('/api/get_focuser_position', FocuserPositionSchema)

/** `target` is a required query param (the catalogue id, e.g. "M27") — the
 * route has no default. `useLiveSession` sources it from `/api/live_preview`'s
 * own `target` field (a normalized id parsed from the live share's directory
 * name), the only confirmed source for "what is currently framed" — see
 * live_preview.py's `LiveFrame.target` and schemas.ts's own note that
 * `get_view_state` carries no target name at all. */
export const fetchTargetObservability = (target: string): Promise<TargetObservability> =>
  get(`/api/get_target_observability?target=${encodeURIComponent(target)}`, TargetObservabilitySchema)

/** Metadata only — `stale`, `source`, `captured_at`, and the `url` to point
 * an `<img>` at (see PreviewCard). Never fetches the image bytes itself. */
export const fetchLivePreview = (): Promise<LivePreview> =>
  get('/api/live_preview', LivePreviewSchema)

/** Newest-first tail of provenance.jsonl (routes.py's `session_activity`
 * handler) — an activity feed, not a tool call itself, and not gated behind
 * an active session the way the telescope-state fetchers above are (it's a
 * local file read, unrelated to whether the scope is observing). See
 * SessionActivityCard for how `origin` must be rendered without flattening. */
export const fetchSessionActivity = (limit?: number): Promise<SessionActivity> =>
  get(`/api/session_activity${limit !== undefined ? `?limit=${limit}` : ''}`, SessionActivitySchema)
