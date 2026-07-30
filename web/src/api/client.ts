import type { ZodType } from 'zod'
import {
  ConditionsSchema,
  HealthSchema,
  PlanTargetsSchema,
  SiteProfileSchema,
  type Conditions,
  type Health,
  type PlanTargets,
  type SiteProfile,
} from './schemas'

export class ApiError extends Error {}

async function get<T>(path: string, schema: ZodType<T>): Promise<T> {
  let response: Response
  try {
    response = await fetch(path)
  } catch (cause) {
    throw new ApiError(`sidecar unreachable at ${path}`, { cause })
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${response.status}`
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
