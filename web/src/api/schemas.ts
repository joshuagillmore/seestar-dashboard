import { z } from 'zod'

/**
 * Shapes are transcribed from payloads recorded off the live server, not from
 * the design handoff. Nullable fields are nullable because the real server sends
 * null there — location.matched, sqm and median_fwhm all do today.
 */

export const LocationSchema = z.object({
  matched: z.boolean().nullable(),
  distance_km: z.number().nullable(),
  site_name: z.string(),
  mask_applied: z.boolean(),
  warning: z.string().nullable().optional(),
})

export const ConditionsSchema = z.object({
  ok: z.boolean(),
  location: LocationSchema,
  go: z.boolean().nullable(),
  suitability: z.number(),
  cloud_cover_pct: z.number().nullable(),
  dew_risk: z.string(),
  wind_kph: z.number().nullable(),
  transparency: z.string().nullable(),
  seeing: z.string().nullable(),
  moon_illum_frac: z.number(),
  dark_window_utc: z.tuple([z.string(), z.string()]),
  source: z.string(),
  reasons: z.array(z.string()),
  /** Hand-back item 13: `assess_conditions` does not yet return a one-line
   * verdict summary, only `reasons[]` — five equally-weighted lines with no
   * stated headline even when one factor (e.g. 86% cloud) decided the
   * verdict alone. `.optional()` alongside `.nullable()` matches
   * `TargetImageSchema`'s convention above: this field hasn't shipped on any
   * recorded payload yet, so a fixture or live response missing the key
   * entirely must parse exactly like an explicit `null`. VerdictBanner
   * renders it as the headline when present and renders nothing — never a
   * composed sentence — when it is not. */
  summary: z.string().nullable().optional(),
})

/** Per-target imagery — the user's own stacked capture when one exists, a
 * sky-survey cutout when they have never imaged the object, or absent when
 * neither resolves (no stack and no catalogue position to fetch a cutout
 * for). `credit` is the survey attribution string and is `null` only when
 * `source` is `'own'`. `.optional()` alongside `.nullable()` is deliberate:
 * this field has not shipped on either payload yet (the sidecar route is
 * built in parallel), so a fixture or a live response missing the key
 * entirely must parse exactly like an explicit `null` — see TargetThumb,
 * which is the one place both call sites render it. */
export const TargetImageSchema = z.object({
  url: z.string(),
  source: z.enum(['own', 'survey']),
  credit: z.string().nullable(),
})

export const PlanTargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  score: z.number(),
  reasons: z.array(z.string()),
  best_window_utc: z.tuple([z.string(), z.string()]),
  recommended_subs: z.number(),
  recommended_exposure_s: z.number(),
  framing_note: z.string().nullable(),
  max_alt_deg: z.number(),
  transit_utc: z.string().nullable(),
  sweet_band_min: z.number(),
  moon_sep_deg: z.number(),
  image: TargetImageSchema.nullable().optional(),
})

export const PlanTargetsSchema = z.object({
  ok: z.boolean(),
  location: LocationSchema,
  conditions: z.object({
    go: z.boolean().nullable(),
    suitability: z.number(),
    source: z.string(),
  }),
  count: z.number(),
  targets: z.array(PlanTargetSchema),
})

export const SiteProfileSchema = z.object({
  ok: z.boolean(),
  profile: z.object({
    name: z.string(),
    lat_deg: z.number(),
    lon_deg: z.number(),
    elevation_m: z.number(),
    bortle: z.number().nullable(),
    sqm: z.number().nullable(),
    horizon_mask: z.array(z.unknown()),
    min_altitude_deg: z.number(),
    field_rotation_ceiling_deg: z.number(),
    location_tolerance_km: z.number(),
  }),
})

export const HealthSchema = z.object({
  ok: z.boolean(),
  replay: z.boolean(),
})

/** From `list_projects`. `median_fwhm` is nullable because the real store
 * sends null on every session recorded so far — see
 * docs/handback-to-seestar-ai.md item 7. There is no `filter` field: the
 * design's session-history table has a FILTER column with no source in this
 * shape at all, not merely a null one. */
export const SessionRecordSchema = z.object({
  date_utc: z.string(),
  integration_minutes: z.number(),
  subs_total: z.number(),
  subs_kept: z.number(),
  median_fwhm: z.number().nullable(),
  notes: z.string(),
})

export const ProjectSchema = z.object({
  target_id: z.string(),
  target_name: z.string(),
  goal_minutes: z.number(),
  collected_minutes: z.number(),
  status: z.string(),
  created_utc: z.string(),
  updated_utc: z.string(),
  sessions: z.array(SessionRecordSchema),
  notes: z.string(),
})

export const ListProjectsSchema = z.object({
  ok: z.boolean(),
  projects: z.array(ProjectSchema),
  count: z.number(),
})

/** `recommend_projects` returns the exact same shape as `list_projects` — full
 * `Project` records, reordered — not a distinct ranked-shortfall shape. See
 * docs/superpowers/specs/2026-07-28-slice-2-runnable-and-projects.md § Phase
 * 2: "recommend_projects returns the same shape as list_projects — full
 * Project objects, reordered. One schema, not two." Verified again against
 * fixtures/recommend_projects.json: with every real project's `goal_minutes`
 * at 0, its `limit: 12` response is byte-for-byte `list_projects`'s own first
 * 12 entries in the same order — there is no shortfall figure anywhere in
 * the payload to rank by yet (see ProjectsScreen.tsx's RECOMMEND_TITLE). */
export const RecommendProjectsSchema = ListProjectsSchema

/** `suggest_integration_goal()`'s return shape — see
 * sidecar/seestar_sidecar/integration_goal.py's module docstring, "The
 * `reason` field", for what each state means. Never `null` from
 * `suggest_integration_goal` unless the whole target failed to resolve in
 * the catalogue at all (see `ProjectsCombinedEntrySchema.goal` below) —
 * every *resolved* target gets one of these, even a target with nothing to
 * show a bar for. `track: "none"` always carries a non-null `reason`;
 * `reason` is null on every other track (those are self-describing via
 * `coarse`/`beyond_reach`). This module renders the four resulting states;
 * it must never compute a new one — see web/src/api/integrationGoal.ts. */
export const IntegrationGoalSchema = z.object({
  track: z.enum(['photometric', 'cluster', 'none']),
  suggested_hours: z.number().nullable(),
  coarse: z.boolean(),
  beyond_reach: z.boolean(),
  surface_brightness: z.number().nullable(),
  bortle_multiplier: z.number().nullable(),
  reason: z.enum(['no_magnitude', 'photometry_unreliable']).nullable(),
  note: z.string(),
})

/** From the sidecar-computed `/api/projects_combined` — not an MCP tool
 * response, so it has no `goal_minutes`/`status`/`sessions`: those live only
 * on the matching `list_projects` entry, joined by `target_id` client-side
 * (see screens/projects/projects.ts). `sources` says which of the two the
 * minutes came from, so a merged total is never shown unexplained. `goal` is
 * `null` only when the target doesn't resolve to a single catalogued object
 * at all (e.g. the archive's own "Unknown" bucket, or a Caldwell id with no
 * canonical target) — see `IntegrationGoalSchema`. */
export const ProjectsCombinedEntrySchema = z.object({
  target_id: z.string(),
  target_name: z.string(),
  store_minutes: z.number(),
  archive_minutes: z.number(),
  sources: z.array(z.enum(['store', 'archive'])),
  total_minutes: z.number(),
  goal: IntegrationGoalSchema.nullable(),
  image: TargetImageSchema.nullable().optional(),
})

export const ProjectsCombinedSchema = z.object({
  ok: z.boolean(),
  projects: z.array(ProjectsCombinedEntrySchema),
  count: z.number(),
  totals: z.object({
    store_minutes: z.number(),
    archive_minutes: z.number(),
    total_minutes: z.number(),
  }),
})

export type Conditions = z.infer<typeof ConditionsSchema>
export type PlanTargets = z.infer<typeof PlanTargetsSchema>
export type PlanTarget = z.infer<typeof PlanTargetSchema>
export type TargetImage = z.infer<typeof TargetImageSchema>
export type SiteProfile = z.infer<typeof SiteProfileSchema>
export type Health = z.infer<typeof HealthSchema>
export type SessionRecord = z.infer<typeof SessionRecordSchema>
export type Project = z.infer<typeof ProjectSchema>
export type ListProjects = z.infer<typeof ListProjectsSchema>
export type RecommendProjects = z.infer<typeof RecommendProjectsSchema>
export type IntegrationGoal = z.infer<typeof IntegrationGoalSchema>
export type ProjectsCombinedEntry = z.infer<typeof ProjectsCombinedEntrySchema>
export type ProjectsCombined = z.infer<typeof ProjectsCombinedSchema>
