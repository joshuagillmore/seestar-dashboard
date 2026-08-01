import { z } from 'zod'

/**
 * Shapes are transcribed from payloads recorded off the live server, not from
 * the design handoff. Nullable fields are nullable because the real server sends
 * null there — location.matched, sqm and median_fwhm all do today.
 */

/**
 * The seestar-mcp consumer contract version this file was written against.
 *
 * `docs/CONTRACT.md` in `OrangeAgente/seestar-mcp`, enforced by their
 * `tests/test_console_contract.py` — it fails *their* build rather than our
 * runtime, which is the whole point of it existing. They version it so we can
 * pin; this is us pinning.
 *
 * It cannot be checked automatically: we have no import path to their repo,
 * and a test asserting this constant against itself would prove nothing. It is
 * a **provenance record**, not a guard — it makes "which contract were we built
 * against?" answerable, so drift can be diffed rather than discovered.
 *
 * **On a version bump, diff their CONTRACT.md against this version and
 * re-record the fixtures** before assuming anything still holds. A green test
 * suite pinning a stale recording is indistinguishable from a passing contract
 * until the day it isn't — which is why `fixtures/qa_tier2.subs.json` has been
 * re-recorded four times (e8f0221, f51a1e2, d555c4b, 04dce5e).
 *
 * Their semantics: MAJOR removes or renames a required key, or changes a
 * value's unit, sign or reference frame — the changes a schema cannot see.
 * MINOR adds a key. PATCH corrects a description without changing behaviour.
 *
 * 1.1.0 made `thresholds.eccentricity_marginal` session-derived rather than a
 * constant — a value-derivation change a schema cannot see, which is exactly
 * why the fixture is re-recorded on a bump and not merely re-read.
 */
export const SEESTAR_MCP_CONTRACT_VERSION = '1.1.0'

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

/* --- slice 4: qa_tier2 (Review & QA) ----------------------------------------
 *
 * Transcribed from seestar-mcp `main @ e8f0221` source — `qa_tier2.py`'s
 * `SubMetrics` / `SubVerdict` / `SessionReport` and `server.py`'s
 * `_compact_report` / `_compact_metrics` — and confirmed field-by-field by
 * the seestar-mcp session in their round-4 close.
 *
 * This is the schema their `qa_tier2` contract tests have been pinning
 * against our *prose* since round 3, with neither side able to call them
 * validated. Parsing a real payload is what closes that loop.
 */

/** One sub's metrics. Every value is nullable: a sub that could not be
 * analysed still appears in `subs[]` with `error` set and the rest null —
 * dropping it would silently shrink the denominator on a screen whose whole
 * job is the distribution.
 *
 * `star_count` is typed `int` (not `int | None`) in their dataclass and is 0
 * on every failure path, so null is not expected — accepted anyway, for the
 * same reason `StatusSchema`'s fields are `.optional()`: an unexpected null
 * should render an absent state, not blank the screen. Flagged to them as a
 * note-vs-type discrepancy, not a defect.
 *
 * Unknown keys pass through: `_compact_metrics` iterates
 * `dataclasses.asdict`, so a new metric appears here the moment they add a
 * field, and rejecting the payload over one would be the wrong trade. */
export const QaSubMetricsSchema = z.object({
  star_count: z.number().nullable().optional(),
  fwhm: z.number().nullable().optional(),
  hfr: z.number().nullable().optional(),
  eccentricity: z.number().nullable().optional(),
  snr: z.number().nullable().optional(),
  background: z.number().nullable().optional(),
  scattered_light: z.number().nullable().optional(),
  /** Set when the sub could not be analysed at all. Its presence — not a
   * null metric — is what marks a row unanalysable. */
  error: z.string().nullable().optional(),
})

export const QaSubVerdictSchema = z.object({
  /** The sub's stable key, and the archive join key.
   *
   * `path.stem` server-side — the filename WITHOUT its extension:
   * `Light_M76_10.0s_LP_20260801-004233`, never `….fit`. Verified in
   * `qa_tier2.py:240` (`sub_name = name if name is not None else path.stem`),
   * and flagged by the seestar-mcp session before we wrote this: a join key
   * carrying `.fit` matches zero rows, silently. Our own archive scan keys
   * on nights rather than frames today, so nothing joins on this yet — this
   * comment exists so the first thing that does gets it right. */
  name: z.string(),
  /** "PASS" | "MARGINAL" | "REJECT" — deliberately NOT a z.enum.
   *
   * The vocabulary is the server's, and so is the decision. An enum would
   * reject the whole payload the day a fourth verdict appears, blanking a
   * screen over a value we could have shown verbatim. Rendering maps the
   * three known values to a tone and shows anything else as-is, unstyled —
   * see qa.ts. The UI renders verdicts; it never computes or re-derives
   * them (CLAUDE.md), and that has to include not asserting the list. */
  verdict: z.string(),
  /** The justification, already composed server-side and rendered verbatim —
   * each line names the metric, its measured value, and the cutoff it fell
   * on. Never re-worded here, and never reduced to a colour: the policy's
   * standard is an auditable verdict traceable to a metric and a threshold.
   *
   * Deliberately not quoting a sample reason in this comment. The literal
   * cutoffs live in seestar-mcp's config.py and nowhere in this repo — see
   * src/test/no-thresholds.test.ts, which fails the build on one appearing
   * here, comment included. A threshold written into a comment goes stale
   * exactly as silently as one written into code. */
  reasons: z.array(z.string()),
  metrics: QaSubMetricsSchema,
})

/** Session medians — the thresholds each sub was actually scored against.
 * Shown so a verdict stays traceable; never used to recompute one. */
export const QaMediansSchema = z.object({
  fwhm: z.number().nullable().optional(),
  fwhm_sigma: z.number().nullable().optional(),
  snr: z.number().nullable().optional(),
  star_count: z.number().nullable().optional(),
  hfr: z.number().nullable().optional(),
  eccentricity: z.number().nullable().optional(),
  scattered_light: z.number().nullable().optional(),
  scattered_light_sigma: z.number().nullable().optional(),
  /** How many subs contributed to the medians above — NOT `total`. A session
   * where these diverge had unanalysable subs, and the medians are drawn
   * from the smaller set. */
  n_analyzed: z.number().nullable().optional(),
})

/**
 * The cutoffs this session was **actually scored against** — not the config
 * constants they derive from.
 *
 * Requested and shipped at seestar-mcp d555c4b. Before it, the numbers
 * existed only as prose inside `reasons[]` ("0.016 > 0.014 (median + 2σ)"),
 * and parsing them back out to draw a line would have been re-deriving a
 * verdict. This is the field that makes the design's dashed cutoff lines
 * drawable without the client inventing or hardcoding anything.
 *
 * `_effective_thresholds` mirrors `_score_sub`'s branching, so an absolute
 * override reads as the override and a session-relative floor reads as that
 * session's own number. **They are not constants**: `snr_floor` is half the
 * session's median SNR, so two nights reject at different absolute values,
 * and a line positioned from one night's report means nothing on another's.
 *
 * Every entry is nullable — null when the threshold could not be computed
 * (no analysable subs on that axis), never a fabricated default. A null
 * threshold must render as no line, never as a line at zero.
 *
 * Note the two senses: `*_reject`/`*_marginal` on eccentricity, FWHM and
 * scattered light are CEILINGS (above is worse); `snr_floor` and
 * `star_count_floor` are FLOORS (below is worse). Both position identically
 * on a linear axis, but a label that gets the direction wrong is worse than
 * no label.
 */
export const QaThresholdsSchema = z.object({
  eccentricity_reject: z.number().nullable().optional(),
  eccentricity_marginal: z.number().nullable().optional(),
  fwhm_reject: z.number().nullable().optional(),
  fwhm_marginal: z.number().nullable().optional(),
  snr_floor: z.number().nullable().optional(),
  star_count_floor: z.number().nullable().optional(),
  scattered_light_reject: z.number().nullable().optional(),
  scattered_light_marginal: z.number().nullable().optional(),
})

export const QaSummarySchema = z.object({
  target: z.string().nullable(),
  total: z.number(),
  kept: z.number(),
  /** Star-count-weighted mean FWHM across subs. */
  wfwhm: z.number().nullable(),
  medians: QaMediansSchema,
  /** `.optional()` so a report cached before d555c4b still parses — the
   * screen renders no cutoff lines for those rather than failing. */
  thresholds: QaThresholdsSchema.optional(),
  dominant_reject_cause: z.string().nullable(),
  subs: z.array(QaSubVerdictSchema),
})

/** The raw `qa_tier2` tool response, stored verbatim as a job's `result`
 * (qa_analysis.py) and surfaced as `report` on a complete/stale status. */
export const Tier2Schema = z.object({
  ok: z.boolean(),
  summary: QaSummarySchema,
  /** Names of subs with verdict != REJECT — the server's keep decision,
   * carried so the UI can show it without deriving it from `subs[]`. */
  keep_list: z.array(z.string()),
})

/** `/api/qa_analysis_status` and `/api/qa_analysis_start`: a discriminated
 * union on `status`, not one shape with everything optional.
 *
 * `stale` is a first-class state, distinct from both `complete` and
 * `not_analysed`: a real report exists but the sub set on disk has changed
 * since it was computed. Showing it as complete would date-stamp stale
 * numbers as current; hiding it would discard a usable result. */
export const QaAnalysisStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not_analysed') }),
  z.object({
    status: z.literal('running'),
    started_at: z.string().nullable(),
    elapsed_seconds: z.number(),
  }),
  z.object({ status: z.literal('failed'), error: z.string().nullable() }),
  z.object({
    status: z.literal('complete'),
    analysed_at: z.string().nullable(),
    report: Tier2Schema.optional(),
  }),
  z.object({
    status: z.literal('stale'),
    analysed_at: z.string().nullable(),
    report: Tier2Schema.optional(),
  }),
])

/**
 * `get_run_state` — is an imaging run in progress right now?
 *
 * The one tool that answers this without inference. Everything else the Live
 * screen has is a device call that times out when the scope is idle, and
 * "the call failed" is not the same claim as "nothing is running" — reading
 * one as the other produces a confident wrong answer in the worst direction.
 *
 * **`state` is tri-valued and `unknown` is not `idle`.** A run was recorded
 * but its stamp is older than the server's staleness window (15 minutes at
 * d555c4b, theirs to change), or the file could not be parsed. It must never
 * render as "the scope is free" — the writer may have died mid-run with the
 * mount still tracking.
 *
 * **`run` is NOT null on `unknown`.** The note announcing the tool said
 * "run: null when idle", which is true of idle and misleading about unknown:
 * a stale record keeps its `run` object. Confirmed against a real recording
 * (`fixtures/get_run_state.json`, which caught exactly this state). A
 * consumer treating the presence of `run` as proof of a live session would be
 * wrong there.
 */
export const RunRecordSchema = z.object({
  /** The real session start — replaces timing from browser-open, which was
   * only ever right if the dashboard was open before the session began. */
  session_start_utc: z.string(),
  /** The string passed to `goto_target`, which the firmware echoes back as
   * `View.target_name` — so the two share an origin and are joinable. It is
   * NOT validated against the catalogue; see `resolved_id`. */
  target: z.string(),
  /** Present-and-null when unset, observed on the real recording — unlike
   * `targets_remaining`/`resolved_id`, which are omitted entirely. */
  slot_ends_utc: z.string().nullable().optional(),
  park_deadline_utc: z.string().nullable().optional(),
  /** OMITTED when the plan is not tracked, never `[]` — those render
   * identically and mean opposite things. */
  targets_remaining: z.array(z.string()).optional(),
  /** Present ONLY when the target string actually resolved against the
   * catalogue. Its absence is the honest "we never resolved this", and it is
   * what lets us disambiguate names our own normaliser collapses — `Veil
   * Nebula East` and `Veil Nebula West` both fold to `Veil`. */
  resolved_id: z.string().optional(),
  stamped_utc: z.string().optional(),
  notes: z.string().optional(),
})

export const RunStateSchema = z.object({
  ok: z.boolean(),
  state: z.enum(['active', 'idle', 'unknown']),
  /** Absent — not null — on idle and on an unparseable file. */
  stamped_utc: z.string().nullable().optional(),
  run: RunRecordSchema.nullable(),
})

/** One target the archive scan knows about, with its Tier-2 status attached.
 * `sub_count` is the raw scale, shown BEFORE the user opts into a run — a
 * 1400-sub analysis is minutes long and they deserve to know that first. */
export const QaTargetSchema = z.intersection(
  z.object({
    target_id: z.string(),
    display_name: z.string(),
    sub_count: z.number(),
  }),
  QaAnalysisStatusSchema,
)

export const QaTargetsSchema = z.object({
  ok: z.boolean(),
  targets: z.array(QaTargetSchema),
  /** Why the scan found nothing, when it found nothing — see the sidecar's
   * `archive.ArchiveStatus`. "Unconfigured" and "configured but empty" read
   * identically from a target count alone and are different problems. */
  archive_status: z.object({
    configured: z.boolean(),
    path: z.string().nullable(),
    exists: z.boolean(),
    target_count: z.number(),
  }),
})

/** `/api/qa_analysis_status` and `/api/qa_analysis_start` — the status union
 * plus the identifying fields the route merges in alongside it. */
export const QaAnalysisResponseSchema = z.intersection(
  z.object({
    ok: z.boolean(),
    target_id: z.string(),
    sub_count: z.number(),
  }),
  QaAnalysisStatusSchema,
)

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
export type QaSubMetrics = z.infer<typeof QaSubMetricsSchema>
export type QaSubVerdict = z.infer<typeof QaSubVerdictSchema>
export type QaMedians = z.infer<typeof QaMediansSchema>
export type QaSummary = z.infer<typeof QaSummarySchema>
export type Tier2 = z.infer<typeof Tier2Schema>
export type QaAnalysisStatus = z.infer<typeof QaAnalysisStatusSchema>
export type QaTarget = z.infer<typeof QaTargetSchema>
export type QaTargets = z.infer<typeof QaTargetsSchema>
export type QaAnalysisResponse = z.infer<typeof QaAnalysisResponseSchema>
export type RunRecord = z.infer<typeof RunRecordSchema>
export type RunState = z.infer<typeof RunStateSchema>
