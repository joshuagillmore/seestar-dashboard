import type { ZodType } from 'zod'
import {
  ConditionsSchema,
  FocuserPositionSchema,
  GuardrailsSchema,
  HealthSchema,
  LastStackSchema,
  ListProjectsSchema,
  LivePreviewSchema,
  PlanTargetsSchema,
  ProjectsCombinedSchema,
  QaAnalysisResponseSchema,
  QaTargetsSchema,
  RunStateSchema,
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
  type LastStack,
  type ListProjects,
  type LivePreview,
  type PlanTargets,
  type ProjectsCombined,
  type QaAnalysisResponse,
  type QaTargets,
  type RunState,
  type RecommendProjects,
  type SessionActivity,
  type SiteProfile,
  type Status,
  type TargetObservability,
  type Tier1,
  type ViewState,
} from './schemas'

export class ApiError extends Error {}

/**
 * The sidecar answered, successfully, with a payload this client's schema
 * does not accept. Still an `ApiError` (every existing `catch` keeps
 * working), but distinct, because it means something different from every
 * other failure: the telescope is talking, in a shape we do not understand.
 *
 * The Live screen used to read every `get_view_state` failure as "scope
 * idle", and a schema mismatch is how that misreport happened on hardware —
 * "idle" while the scope stacked 94 frames (see AnnotateSchema's doc
 * comment). A caller that can tell this apart can say so instead.
 */
export class SchemaError extends ApiError {}

/**
 * The request got no answer from the sidecar's own code: this client's
 * timeout fired, the fetch never connected, or an HTTP error came back with
 * no JSON error body (Vite's dev proxy answering for a dead sidecar). Still
 * an `ApiError`, but distinct from a failure the sidecar or the tool itself
 * reported, because a caller reads the two differently: a relayed failure
 * proves the bridge answered; this proves nothing about the scope at all.
 *
 * `message` keeps the "make sure the sidecar is running" advice, for the
 * screens that show it verbatim. `brief` is the same fact without it, for a
 * caller that has just seen the sidecar answer another request, where that
 * advice would contradict the sentence around it.
 */
export class NoAnswerError extends ApiError {
  readonly brief: string

  constructor(message: string, brief: string, options?: ErrorOptions) {
    super(message, options)
    this.brief = brief
  }
}

/** How to get the sidecar running, repeated in every message that means
 * "the sidecar didn't answer" — this is the one line of the app most
 * likely to be read by someone who has never seen the codebase. */
const SIDECAR_HINT =
  'make sure the sidecar is running (uv run seestar-dashboard) and reachable, by default at http://localhost:8000'

/** The header the sidecar requires on any request that STARTS work. A
 * cross-origin simple request cannot set it, and the preflight it would
 * otherwise need is one this server never answers — see routes.py's
 * CLIENT_HEADER. */
const CLIENT_HEADER = 'X-Seestar-Client'

/**
 * How long one request may take before this client gives up on it.
 *
 * There used to be no limit. The sidecar serialises MCP calls onto one
 * session (mcp_proxy.py), so a single slow call holds every call behind it,
 * and a request that never answered left its caller waiting forever — the
 * Live screen's polls piled up behind it and interleaved their writes.
 *
 * Longer than seestar-mcp's own 30 s device timeout (config.py's
 * `http_timeout_s`), so a device call the SERVER gives up on still comes
 * back as the server's own, more specific, error rather than ours.
 */
export const REQUEST_TIMEOUT_MS = 45_000

export interface RequestOptions {
  /** Cancels the request — e.g. when the component that asked unmounts. */
  signal?: AbortSignal
}

async function request<T>(
  path: string,
  schema: ZodType<T>,
  init: RequestInit = {},
  { signal: callerSignal }: RequestOptions = {},
): Promise<T> {
  // One controller per request, fired by whichever comes first: the timeout,
  // or the caller's own signal.
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  const onCallerAbort = () => controller.abort()
  if (callerSignal?.aborted) controller.abort()
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true })

  // Settles the request on abort even if a fetch implementation (or a test
  // double) ignores its signal, and covers the body read as well.
  const aborted = new Promise<never>((_, reject) => {
    const fail = () =>
      reject(
        timedOut
          ? new NoAnswerError(
              `sidecar did not answer ${path} within ${REQUEST_TIMEOUT_MS / 1000} s — ${SIDECAR_HINT}`,
              `no answer within ${REQUEST_TIMEOUT_MS / 1000} s`,
            )
          : new ApiError(`request to ${path} was cancelled`),
      )
    if (controller.signal.aborted) fail()
    else controller.signal.addEventListener('abort', fail, { once: true })
  })
  aborted.catch(() => {})

  try {
    let response: Response
    try {
      response = await Promise.race([fetch(path, { ...init, signal: controller.signal }), aborted])
    } catch (cause) {
      if (controller.signal.aborted) return await aborted
      throw new NoAnswerError(
        `sidecar unreachable at ${path} — ${SIDECAR_HINT}`,
        'the request did not reach the sidecar',
        { cause },
      )
    }
    const body = await Promise.race([response.json().catch(() => null), aborted])
    return parseBody(path, schema, response, body)
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', onCallerAbort)
  }
}

function parseBody<T>(path: string, schema: ZodType<T>, response: Response, body: unknown): T {
  if (!response.ok) {
    // A JSON {error} body means the sidecar formed the response itself and
    // has something specific to say (see _serve() in routes.py) — surface
    // that verbatim. Anything else — no body, or a body that isn't JSON —
    // means the request never reached sidecar code at all. That is not a
    // hypothetical: Vite's dev proxy resolves a dead sidecar as a *resolved*
    // fetch carrying an HTML 502 page, not a rejected fetch, so `HTTP 502`
    // used to be the only thing a stopped sidecar ever produced.
    if (body && typeof body === 'object' && 'error' in body) {
      throw new ApiError(String((body as { error: unknown }).error))
    }
    throw new NoAnswerError(
      `sidecar returned HTTP ${response.status} for ${path} — ${SIDECAR_HINT}`,
      `HTTP ${response.status} with no error body`,
    )
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
    throw new SchemaError(`unexpected payload from ${path}: ${parsed.error.message}`)
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


const get = <T>(path: string, schema: ZodType<T>, opts?: RequestOptions): Promise<T> =>
  request(path, schema, {}, opts)

/** POST with the client header. Used only by startQaAnalysis — see its own
 * comment for why the one mutating call is not a GET. */
const post = <T>(path: string, schema: ZodType<T>): Promise<T> =>
  request(path, schema, { method: 'POST', headers: { [CLIENT_HEADER]: 'console' } })

export const fetchConditions = (): Promise<Conditions> =>
  get('/api/assess_conditions', ConditionsSchema)

export const fetchPlan = (limit = 12): Promise<PlanTargets> =>
  get(`/api/plan_targets?limit=${limit}`, PlanTargetsSchema)

export const fetchSite = (opts?: RequestOptions): Promise<SiteProfile> =>
  get('/api/get_site_profile', SiteProfileSchema, opts)

/** Drives the top bar's "fixtures — not live" indicator. */
export const fetchHealth = (opts?: RequestOptions): Promise<Health> =>
  get('/api/health', HealthSchema, opts)

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
export const fetchViewState = (opts?: RequestOptions): Promise<ViewState> =>
  get('/api/get_view_state', ViewStateSchema, opts)

export const fetchStatus = (opts?: RequestOptions): Promise<Status> =>
  get('/api/get_status', StatusSchema, opts)

/**
 * `session_start_utc` is a required query param the sidecar route has no
 * default for (routes.py's `check_night_guardrails` handler) — it needs to
 * know when the session started to compute dawn margin and max-duration
 * remaining. `useLiveSession` passes `get_run_state`'s `run.session_start_utc`
 * (the scope's real start, handback item 20) when the run is active, and only
 * otherwise falls back to the moment THIS client first observed the session —
 * which understates elapsed time for a dashboard opened mid-session. See its
 * own doc comment. */
export const fetchGuardrails = (sessionStartUtc: string, opts?: RequestOptions): Promise<Guardrails> =>
  get(
    `/api/check_night_guardrails?session_start_utc=${encodeURIComponent(sessionStartUtc)}`,
    GuardrailsSchema,
    opts,
  )

export const fetchTier1 = (opts?: RequestOptions): Promise<Tier1> =>
  get('/api/qa_tier1', Tier1Schema, opts)

export const fetchFocuserPosition = (opts?: RequestOptions): Promise<FocuserPosition> =>
  get('/api/get_focuser_position', FocuserPositionSchema, opts)

/** `target` is a required query param (the catalogue id, e.g. "M27") — the
 * route has no default. `useLiveSession` sources it from `get_view_state`'s
 * own `View.target_name` first and `/api/live_preview`'s `target` second —
 * see its `currentTarget` doc comment for why that order. */
/** `date`, when given, is an instant inside the night to describe: with none,
 * seestar-mcp (contract 1.2.0) answers for the night in progress only inside
 * astronomical dark, and for the NEXT night after dawn. */
export const fetchTargetObservability = (
  target: string,
  date?: string | null,
  opts?: RequestOptions,
): Promise<TargetObservability> =>
  get(
    `/api/get_target_observability?target=${encodeURIComponent(target)}` +
      (date ? `&date=${encodeURIComponent(date)}` : ''),
    TargetObservabilitySchema,
    opts,
  )

/** Metadata only — `stale`, `source`, `captured_at`, and the `url` to point
 * an `<img>` at (see PreviewCard). Never fetches the image bytes itself. */
export const fetchLivePreview = (opts?: RequestOptions): Promise<LivePreview> =>
  get('/api/live_preview', LivePreviewSchema, opts)

/** `target` is a required query param — the catalogue id, same value
 * `fetchTargetObservability` takes (see useLiveSession's `currentTarget`).
 * Metadata only, same convention as `fetchLivePreview` above: `url` points
 * at the image bytes (a full-resolution JPEG, ~730 KB — see LastStackCard's
 * own doc comment on why that is fetched on target change, not on the
 * telemetry poll). Never call this on the 60 s cadence the rest of the
 * active-session fetchers use. */
export const fetchLastStack = (target: string, opts?: RequestOptions): Promise<LastStack> =>
  get(`/api/last_stack?target=${encodeURIComponent(target)}`, LastStackSchema, opts)

/** Newest-first tail of provenance.jsonl (routes.py's `session_activity`
 * handler) — an activity feed, not a tool call itself, and not gated behind
 * an active session the way the telescope-state fetchers above are (it's a
 * local file read, unrelated to whether the scope is observing). See
 * SessionActivityCard for how `origin` must be rendered without flattening. */
export const fetchSessionActivity = (limit?: number, opts?: RequestOptions): Promise<SessionActivity> =>
  get(
    `/api/session_activity${limit !== undefined ? `?limit=${limit}` : ''}`,
    SessionActivitySchema,
    opts,
  )

/* --- slice 4: Review & QA -------------------------------------------------
 *
 * `qa_tier2` is minutes long over a real target's 200-1400 subs, so it is
 * NEVER a page-load fetch. Three routes, and the split is the safety
 * property, not a convenience:
 *
 *   fetchQaTargets   listing + per-target status only. Never a report, never
 *                    starts anything. Safe on load.
 *   fetchQaStatus    one target's status, plus its full report once complete.
 *                    Safe to poll; never starts anything.
 *   startQaAnalysis  the ONLY call that can begin a run. Deliberate user
 *                    action only. Idempotent: a target already running, or
 *                    already analysed for its current sub set, returns that
 *                    status without recomputing.
 */
export const fetchQaTargets = (): Promise<QaTargets> =>
  get('/api/qa_targets', QaTargetsSchema)

export const fetchQaStatus = (target: string): Promise<QaAnalysisResponse> =>
  get(`/api/qa_analysis_status?target=${encodeURIComponent(target)}`, QaAnalysisResponseSchema)

/** The only call that starts work, and the only non-GET in this client.
 *
 * POST plus a custom header, both required by the sidecar (see routes.py's
 * `_reject_untrusted_caller`). It used to be a GET, which meant any page the
 * user happened to have open could spawn minutes of CPU with a bare
 * `<img src="http://127.0.0.1:8787/api/qa_analysis_start?target=M31">` —
 * CORS does not stop the request being sent, only its response being read.
 * A simple cross-origin request can issue neither a POST with this header
 * nor a preflight this server answers. */
export const startQaAnalysis = (target: string): Promise<QaAnalysisResponse> =>
  post(`/api/qa_analysis_start?target=${encodeURIComponent(target)}`, QaAnalysisResponseSchema)

/** Is a run in progress right now — the tool that replaces inferring it from
 * a get_view_state timeout. Reads a file server-side, no Alpaca call, so
 * unlike every other state fetcher this one costs the bridge nothing and is
 * safe to poll on the idle path. */
export const fetchRunState = (opts?: RequestOptions): Promise<RunState> =>
  get('/api/get_run_state', RunStateSchema, opts)

/** URL for one sub's Seestar-written JPEG thumbnail (`<stem>_thn.jpg`).
 *
 * `subName` is `qa_tier2.summary.subs[].name` — the stem, no extension. Both
 * components are encoded: sub names contain spaces ("Light_M57 Ring
 * Nebula_10.0s_LP_…"), and the route matches the DECODED value against stems
 * the archive scan found, so it must arrive intact.
 *
 * Returns a URL for an <img>, not bytes — same convention as
 * `fetchLivePreview`/`fetchLastStack`. */
export const subImageSrc = (targetId: string, subName: string): string =>
  `/api/sub_image/${encodeURIComponent(targetId)}/${encodeURIComponent(subName)}`
