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

/** One archive night's captures for one target (see the sidecar's
 * `archive.ArchiveNight`) — a night, not a session: no filter, no median
 * FWHM, no kept/total split, because the archive scan has none of those to
 * report. A row built from this must render those columns as absent, not as
 * a zero or a dash that would imply a measured value — see SessionHistory.tsx. */
export const ArchiveNightSchema = z.object({
  night: z.string(),
  frames: z.number(),
  minutes: z.number(),
})

/** From the sidecar-computed `/api/projects_combined` — not an MCP tool
 * response, so it has no `goal_minutes`/`status`/`sessions`: those live only
 * on the matching `list_projects` entry, joined by `target_id` client-side
 * (see screens/projects/projects.ts). `sources` says which of the two the
 * minutes came from, so a merged total is never shown unexplained. `goal` is
 * `null` only when the target doesn't resolve to a single catalogued object
 * at all (e.g. the archive's own "Unknown" bucket, or a Caldwell id with no
 * canonical target) — see `IntegrationGoalSchema`.
 *
 * `nights` is the archive's per-night detail, already filtered server-side
 * through the exact same de-duplication `archive_minutes` uses (a night the
 * store already has a session record for is excluded before this array is
 * built) — so `nights.reduce((sum, n) => sum + n.minutes, 0) ===
 * archive_minutes` holds by construction and this client must not re-filter
 * or reconcile it further. Always an array, never nullable/optional: a
 * store-only target gets `nights: []` (its detail already exists as
 * `sessions` on the matching `list_projects` entry), same convention as
 * `sources` above. */
export const ProjectsCombinedEntrySchema = z.object({
  target_id: z.string(),
  target_name: z.string(),
  store_minutes: z.number(),
  archive_minutes: z.number(),
  sources: z.array(z.enum(['store', 'archive'])),
  nights: z.array(ArchiveNightSchema),
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

/**
 * Live-session shapes (slice 3). Transcribed from `fixtures/*.json`, hand-
 * authored by the sidecar's own build against `SeeStar-AI/src/seestar_mcp/
 * server.py`'s controller methods (no live hardware session was available to
 * record.py) — see `.superpowers/live-sidecar-report.md`. An earlier version
 * of this file guessed these shapes from the design handoff's sample values
 * before that landed, and several guesses were wrong in ways worth naming so
 * the mistake isn't repeated: `get_view_state` nests one level deeper than
 * guessed (`ok.view_state.result.View`, not `ok.result.View` — the exact
 * "silently produced empty telemetry" failure mode the slice-3 spec warned
 * about, this time caught by a second pair of eyes rather than a fixture);
 * `check_night_guardrails` returns a flat `{proceed,action,reasons[],
 * hard_stops[]}`, not five named/toned checks — there is no server-side
 * per-check identity or tone to render as five dotted rows, so GuardrailsCard
 * renders the real shape instead of inventing one; `qa_tier1` already
 * computes deltas (`trends`) and a ready-made log line (`status_line`), so
 * this client no longer diffs polls itself — see telemetryLog.ts; and
 * `get_target_observability` is the *nightly* aggregate (peak altitude,
 * best sweet-band window) `plan_targets` already returns per target, not an
 * instantaneous current-alt/az reading — no such reading exists anywhere in
 * the confirmed tool surface, so SweetBandGauge no longer plots a live
 * position marker.
 */
/** One solved object in `Annotate.result.annotations`. Captured from firmware
 * 7.75 mid-session on NGC 7380:
 * `{"type":"ngc","names":["NGC 7380"],"pixelx":309.123,"pixely":1190.65,"radius":315.861}`
 * Pixel coordinates are against `result.image_size` (`[1080, 1920]`). */
export const AnnotationSchema = z.object({
  type: z.string().nullish(),
  names: z.array(z.string()).nullish(),
  pixelx: z.number().nullish(),
  pixely: z.number().nullish(),
  radius: z.number().nullish(),
})

/**
 * `pixelx`/`pixely`/`radius` live inside `result.annotations[]`, NOT flat on
 * `Annotate`.
 *
 * This schema previously declared them flat, which made every live stacking
 * payload fail validation — and because the client reads "get_view_state
 * failed" as "the scope is idle", the Live screen reported an idle scope while
 * it was actively stacking 94 frames. The recorded fixture had the flat shape
 * too: it was hand-authored from a reference note that recorded the right
 * fields at the wrong depth, so fixture and schema agreed with each other and
 * both disagreed with the hardware.
 *
 * Third nesting-depth error in this codebase, after `ok.view_state.result.View`
 * and battery under `pi_status`. The lesson each time: a field's absence at one
 * level is not its absence, and a fixture nobody captured from a device is a
 * record of what someone believed.
 */
export const AnnotateSchema = z.object({
  state: z.string().nullish(),
  lapse_ms: z.number().nullish(),
  result: z
    .object({
      image_size: z.array(z.number()).nullish(),
      annotations: z.array(AnnotationSchema).nullish(),
      image_id: z.unknown().nullish(),
    })
    .nullish(),
})

export const StackStateSchema = z.object({
  stacked_frame: z.number(),
  dropped_frame: z.number(),
  /** Present on live hardware alongside the counts; not in the hand-authored
   * fixture. Optional so neither source fails the other. */
  frame_errcode: z.number().nullish(),
  can_annotate: z.boolean().nullish(),
  Annotate: AnnotateSchema.nullable().optional(),
})

/** `target_name` and `lp_filter` are both present on the View block —
 * confirmed on hardware 2026-07-31 against a live NGC 7380 session (firmware
 * 7.75): `{"target_name":"NGC7380","lp_filter":true,"gain":80,...}`. An
 * earlier version of this comment said no `target_name` existed anywhere in
 * this shape; that was true of the hand-authored fixture this schema was
 * first written against, and false of the real device — see this section's
 * own module doc comment on why a recorded fixture now outranks an older
 * assumption in a comment.
 *
 * `target_name` is a catalogue id ("NGC7380"), not the resolved common name
 * `get_target_observability`'s `target.name` returns ("Wizard Nebula") — the
 * target header's name fallback chain (LiveScreen.tsx) treats it as a
 * source ahead of the live-preview-derived id it used exclusively before,
 * still behind observability's own resolved name once that arrives.
 *
 * `lp_filter` is a genuine boolean, not a tri-state: `false` means the
 * filter is confirmed OFF, not that the field is absent. `.nullish()` is for
 * a firmware/stage that omits the key entirely (e.g. pre-stack), which must
 * render as "unknown" rather than as `false` — see TargetHeader's own LP
 * chip, which renders three distinct states for exactly this reason. */
const ViewSchema = z.object({
  stage: z.string().nullable().optional(),
  target_name: z.string().nullish(),
  lp_filter: z.boolean().nullish(),
  /** Absent/null during a pre-stack stage (3PPA, AutoGoto) — a session can
   * be "ok" without stacking having started yet. Not observed directly (the
   * one recorded fixture is mid-stack) but kept nullable on the same
   * reasoning as before. */
  Stack: StackStateSchema.nullable().optional(),
})

export const ViewStateSchema = z.object({
  ok: z.boolean(),
  // The extra nesting the earlier guess missed entirely.
  view_state: z
    .object({
      // `View` is `nullish`, not `nullable`, and the difference is the whole
      // idle state. A connected-but-not-observing scope returns `result: {}` —
      // the key is *absent*, not null — and `.nullable()` rejects that, so the
      // screen threw a parse error in the single most common real condition.
      // Caught only against live hardware: every fixture had either a full
      // `View` or a null payload, and nobody had written the empty middle.
      // `result` is nullish for the same reason, one level up.
      result: z.object({ View: ViewSchema.nullish() }).nullish(),
    })
    .nullable(),
})

export const StatusSchema = z.object({
  ok: z.boolean(),
  connected: z.boolean().nullable().optional(),
  rightascension: z.number().nullable().optional(),
  declination: z.number().nullable().optional(),
  tracking: z.boolean().nullable().optional(),
  slewing: z.boolean().nullable().optional(),
})

/** `check_night_guardrails`'s real, flat shape — `action`/`proceed` are the
 * server's own verdict (rendered verbatim, never re-derived from `reasons`),
 * and `hard_stops` are the subset of `reasons` that are actually blocking
 * (shown with more weight, not a separate judgement this client makes).
 * `session_start_utc` is a *required* query param the route has no default
 * for — see client.ts's `fetchGuardrails` for where that comes from and its
 * honesty caveat. */
export const GuardrailsSchema = z.object({
  ok: z.boolean(),
  proceed: z.boolean(),
  action: z.string(),
  reasons: z.array(z.string()),
  hard_stops: z.array(z.string()),
})

/** One `qa_tier1` poll. The server already computes both a ready-made log
 * line (`status_line`) and structured deltas (`trends`) — this client
 * renders `status_line` verbatim for the telemetry log rather than
 * recomposing one from `snapshot`, and reads `trends` rather than diffing
 * polls itself (an earlier version of this screen did that client-side
 * arithmetic before this shape was confirmed; the server already does it).
 * Tier-1 is cheap health polling; it never carries a per-sub quality verdict
 * (that's Tier-2, at wind-down only) — `flags` is where a health warning
 * would appear, and this client renders it verbatim if ever non-empty rather
 * than inventing one. */
export const Tier1SnapshotSchema = z.object({
  ts: z.string(),
  stacked: z.number().nullable().optional(),
  rejected: z.number().nullable().optional(),
  solve_ok: z.boolean().nullable().optional(),
  solve_rms: z.number().nullable().optional(),
  focus_pos: z.number().nullable().optional(),
  hfd: z.number().nullable().optional(),
  tracking: z.boolean().nullable().optional(),
})

export const Tier1TrendsSchema = z.object({
  stacked_delta: z.number().nullable().optional(),
  rejected_delta: z.number().nullable().optional(),
  focus_delta: z.number().nullable().optional(),
  hfd_delta: z.number().nullable().optional(),
})

export const Tier1Schema = z.object({
  ok: z.boolean(),
  snapshot: Tier1SnapshotSchema,
  flags: z.array(z.string()),
  status_line: z.string(),
  trends: Tier1TrendsSchema.nullable().optional(),
})

/** `focus_pos` is the flat convenience field also present on `qa_tier1`'s
 * snapshot (same name, same value) — used in preference to the nested
 * `focuser.result`, which exists but is redundant. */
export const FocuserPositionSchema = z.object({
  ok: z.boolean(),
  focus_pos: z.number().nullable(),
})

/** `get_target_observability`'s real shape: the *nightly* aggregate for one
 * target — peak altitude, transit/rise/set, the sweet-band window — the same
 * kind of figures `plan_targets` already returns per target on Tonight, not
 * an instantaneous current-alt/az reading. No such live reading exists
 * anywhere in the confirmed tool surface, so SweetBandGauge renders this
 * target's sweet-band *context* for tonight rather than a moving position
 * marker — see bandGeometry.ts and SweetBandGauge.tsx. Requires a `target`
 * id as a query param (client.ts sources it from the live-preview frame's
 * own `target`, the only confirmed source for "what is currently framed"). */
export const ObservabilityTargetSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  ra_deg: z.number().nullable().optional(),
  dec_deg: z.number().nullable().optional(),
  type: z.string().nullable().optional(),
  size_arcmin: z.number().nullable().optional(),
  magnitude: z.number().nullable().optional(),
})

export const ObservabilityDetailSchema = z.object({
  target_id: z.string(),
  max_alt_deg: z.number(),
  transit_utc: z.string().nullable().optional(),
  rise_utc: z.string().nullable().optional(),
  set_utc: z.string().nullable().optional(),
  dark_minutes_above_floor: z.number().nullable().optional(),
  dark_minutes_in_sweet_band: z.number().nullable().optional(),
  field_rotation_deg_per_hr_at_transit: z.number().nullable().optional(),
  usable_sub_minutes: z.number().nullable().optional(),
  transits_above_ceiling: z.boolean().nullable().optional(),
  moon_sep_deg: z.number().nullable().optional(),
  moon_alt_deg: z.number().nullable().optional(),
  moon_illum_frac: z.number().nullable().optional(),
  best_window_utc: z.tuple([z.string(), z.string()]).nullable().optional(),
})

export const TargetObservabilitySchema = z.object({
  ok: z.boolean(),
  target: ObservabilityTargetSchema.nullable().optional(),
  observability: ObservabilityDetailSchema.nullable().optional(),
})

/** `/api/live_preview` — given verbatim, see this section's module comment.
 * `source: null` always carries a `reason` (e.g. no session, nothing written
 * yet); `stacked`/`sub` distinguishes the accumulating stack from a single
 * noisy 10 s sub, which the preview card must say out loud rather than let a
 * grainy frame read as a poor result. */
export const LivePreviewSchema = z.object({
  ok: z.boolean(),
  source: z.enum(['stacked', 'sub']).nullable(),
  captured_at: z.string().nullable(),
  stack_count: z.number().nullable().optional(),
  target: z.string().nullable().optional(),
  stale: z.boolean(),
  url: z.string().nullable(),
  reason: z.string().nullable().optional(),
})

/** `/api/last_stack` — the previous session's stacked master for the
 * currently-framed target, since handback-to-seestar-ai.md item 23:
 * established on hardware twice in one session (at 37 and 141 stacked
 * frames) that the scope writes the stacked JPEG exactly once, at session
 * END, with the final frame count baked into the filename. Mid-session the
 * only stack on the share is therefore from a PRIOR session — sometimes
 * weeks old — never the one currently accumulating; there is no read-only
 * access to that live stack (same item). This is the workaround item 23
 * itself names: "a clearly-dated 'last completed stack' panel beneath [the
 * live sub], built from the share."
 *
 * Verified directly against the real, committed route
 * (`sidecar/seestar_sidecar/routes.py`'s `_last_stack_payload`/
 * `_last_stack_absent`, and `last_stack.py`'s own module doc comment) once
 * the sidecar half of this contract landed:
 *
 * - `target: null` means no completed stack exists yet for this target (a
 *   first-ever session on the object, or the only session so far still
 *   running) — a normal, common state, not an error, same discriminator
 *   convention as `LivePreviewSchema.source` above. It always carries a
 *   `reason`.
 * - `reason` is a short, stable, machine-readable wire token —
 *   `no_stack`/`idle`/`bridge_down`/`not_configured`/`share_unreachable`,
 *   the same tokens `live_preview.py` already defines for the last four,
 *   reused rather than duplicated — never prose. The client must translate
 *   it, never render it raw; see `lastStackReasonLabel` in lastStack.ts.
 * - `url` is always the literal `"/api/last_stack/image"` on BOTH branches
 *   (the absent response hardcodes it too), so `target`, not `url`, is what
 *   a caller must check for "is there really an image here" — see
 *   LastStackCard's own `hasImage`.
 * - The sidecar's own image cache is cleared on every non-success response,
 *   so a target switch can never leave a previous target's picture being
 *   served — this client's `hasImage` check (keyed on `target`) already
 *   matches that: the panel is expected to disappear on switch, not linger.
 *
 * Every field still stays independently nullable in this schema, the same
 * defensive convention as the rest of this section — this parses the real
 * route's payload shape, not a guess, but a schema should still not assume a
 * field is non-null merely because one payload it has been checked against
 * happens to send it. */
export const LastStackSchema = z.object({
  ok: z.boolean(),
  target: z.string().nullable(),
  captured_at: z.string().nullable(),
  frame_count: z.number().nullable(),
  url: z.string().nullable(),
  reason: z.string().nullable().optional(),
})

/**
 * `/api/session_activity` — verified against `sidecar/seestar_sidecar/
 * session_activity.py` and `routes.py`'s handler directly (no recorded
 * fixture; the sidecar's own tests use hand-written provenance lines). A
 * plain activity feed off `provenance.jsonl` — `{ts, tool, args}` and
 * nothing else. There is no prose field anywhere in that file, so the
 * design's chat bubbles (Claude's own sentences) are simply not obtainable
 * from this source — see SessionActivityCard's own doc comment for why this
 * client renders an activity feed, never a synthesised transcript.
 *
 * `ts`/`tool`/`args` are all nullable: a line that failed to parse becomes
 * an `origin: "unknown"` record with every field `null` rather than being
 * dropped silently (`test_a_malformed_line_becomes_an_unknown_record_not_a_
 * 500`). `origin` is the honesty-critical field — hand-back item 10 means
 * the log has no client identifier, so the dashboard's OWN calls sit in
 * here too, indistinguishable from the agent's, unless a tag is provably
 * something only the agent could have produced (`"agent"`) or the record
 * didn't parse (`"unknown"`) — everything else able to come from either
 * source is `"ambiguous"`, never guessed further.
 */
export const SessionActivityRecordSchema = z.object({
  ts: z.string().nullable(),
  tool: z.string().nullable(),
  args: z.record(z.string(), z.unknown()).nullable(),
  origin: z.enum(['agent', 'ambiguous', 'unknown']),
})

export const SessionActivitySchema = z.object({
  ok: z.boolean(),
  records: z.array(SessionActivityRecordSchema),
  truncated: z.boolean(),
  /** `false` only when no provenance path is configured at all on this
   * installation — a real, first-class state (routes.py's `session_activity`
   * handler), not merely "empty right now". `records` is `[]` in both that
   * case and the "configured but nothing logged yet" case; only
   * `source_configured` tells them apart. */
  source_configured: z.boolean(),
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
export type ArchiveNight = z.infer<typeof ArchiveNightSchema>
export type ProjectsCombinedEntry = z.infer<typeof ProjectsCombinedEntrySchema>
export type ProjectsCombined = z.infer<typeof ProjectsCombinedSchema>

export type Annotate = z.infer<typeof AnnotateSchema>
export type StackState = z.infer<typeof StackStateSchema>
export type ViewState = z.infer<typeof ViewStateSchema>
export type Status = z.infer<typeof StatusSchema>
export type Guardrails = z.infer<typeof GuardrailsSchema>
export type Tier1Snapshot = z.infer<typeof Tier1SnapshotSchema>
export type Tier1Trends = z.infer<typeof Tier1TrendsSchema>
export type Tier1 = z.infer<typeof Tier1Schema>
export type FocuserPosition = z.infer<typeof FocuserPositionSchema>
export type ObservabilityTarget = z.infer<typeof ObservabilityTargetSchema>
export type ObservabilityDetail = z.infer<typeof ObservabilityDetailSchema>
export type TargetObservability = z.infer<typeof TargetObservabilitySchema>
export type LivePreview = z.infer<typeof LivePreviewSchema>
export type LastStack = z.infer<typeof LastStackSchema>
export type SessionActivityRecord = z.infer<typeof SessionActivityRecordSchema>
export type SessionActivity = z.infer<typeof SessionActivitySchema>
