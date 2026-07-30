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

/** From the sidecar-computed `/api/projects_combined` — not an MCP tool
 * response, so it has no `goal_minutes`/`status`/`sessions`: those live only
 * on the matching `list_projects` entry, joined by `target_id` client-side
 * (see screens/projects/projects.ts). `sources` says which of the two the
 * minutes came from, so a merged total is never shown unexplained. */
export const ProjectsCombinedEntrySchema = z.object({
  target_id: z.string(),
  target_name: z.string(),
  store_minutes: z.number(),
  archive_minutes: z.number(),
  sources: z.array(z.enum(['store', 'archive'])),
  total_minutes: z.number(),
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
export type SiteProfile = z.infer<typeof SiteProfileSchema>
export type Health = z.infer<typeof HealthSchema>
export type SessionRecord = z.infer<typeof SessionRecordSchema>
export type Project = z.infer<typeof ProjectSchema>
export type ListProjects = z.infer<typeof ListProjectsSchema>
export type ProjectsCombinedEntry = z.infer<typeof ProjectsCombinedEntrySchema>
export type ProjectsCombined = z.infer<typeof ProjectsCombinedSchema>
