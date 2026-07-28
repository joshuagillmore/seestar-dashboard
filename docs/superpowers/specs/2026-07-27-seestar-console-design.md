# SeeStar Console — slice 1 design

**Date:** 2026-07-27
**Status:** approved
**Scope:** transport + app shell + the Tonight screen, end-to-end against the real MCP server.

---

## 1. Context

Claude Design delivered a high-fidelity handoff for a four-screen desktop console
(`docs/design/`): a token table, per-screen specs with exact hex/px/type values, verbatim copy,
five real S50 JPEGs, and a `github.md` screen→source map. The handoff's *Data & Backend
Requirements* section flags four data gaps plus the HTTP-sidecar gap.

Before specifying anything, the handoff's claims were checked against the real server source in
`C:\Users\<user>\SeeStar-AI` and against live read-only tool calls. Both the gap list and the
fixture data turned out to be materially different from the design's assumptions. Section 3
records what was found; it is the main reason this spec exists in its current shape.

The handoff is **not one spec's worth of work**. It decomposes into six slices (section 10).
This spec covers slice 1 only.

---

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Sidecar location | **This repo**, Python/FastAPI, proxying over stdio | Matches this repo's stated job — "a frontend plus a thin read layer." Proxying (rather than importing `seestar_mcp` as a library) makes it structurally impossible to reach into server internals and quietly re-implement logic here. Leaves SeeStar-AI untouched, so the two sessions never collide. |
| First slice | **Shell + Tonight**, end-to-end | Proves stdio → HTTP → React → pixel-accurate render against real tools. `assess_conditions` / `plan_targets` are read-only and need no telescope, so it is developable at any hour. Its layout exercises enough of the token system to lock the design language. |
| Dev data | **Golden fixtures recorded from the real server** | Fast, offline, deterministic gate — and real payload shapes, which is precisely what kills fixture-first UI work (see section 3). |
| Design divergence | **Build to the design; design the real states properly** | The states the design treats as edge cases are the default state of this installation. |
| Stack | **React + TypeScript + Vite + Vitest. No charting library.** | README's suggested default. Charts in this design are absolutely-positioned and flex-div bars driven by the token table; Recharts would fight both the sweet-band timeline and the 60-bar eccentricity plot. |

---

## 3. Verified findings

### 3.1 The handoff's four flagged gaps

| Flagged | Verified reality |
|---|---|
| Per-sub metric arrays | **Real gap.** `server.py:474 _compact_report()` deliberately strips metrics; MCP returns only `{name, verdict, reasons}` per sub. Full `SubMetrics` (fwhm, hfr, eccentricity, snr, star_count, background, scattered_light) exists internally and *is* written to the JSON artifact by `qa_session_report`. Blocks the Review screen (slice 4), not slice 1. |
| Structured reason tags | **Mostly met.** `SubVerdict.reasons: list[str]` is server-authored, and `ranker.py:152` builds plan reasons server-side. Strings rather than tag objects, but no client-side prose parsing is needed. |
| Sweet-band geometry | **Half met.** `Observability.best_window_utc` gives the sweet-band span as real ISO-UTC timestamps. The above-floor span has only `dark_minutes_above_floor` — an integrated duration with no start/end. |
| Project aggregates in one call | **Not a gap.** `list_projects` returns full `Project` objects including `collected_minutes`, `goal_minutes`, `status`, and `sessions[]` with `date_utc` / `subs_total` / `subs_kept` / `median_fwhm`. One call covers all project cards *and* the session-history table. |

### 3.2 Gaps the handoff did not flag

Found by calling `assess_conditions` and `plan_targets` live:

1. **Precipitation probability** is not a structured field. It appears only as prose inside
   `reasons[]` (`"precipitation probability up to 16%"`). The design shows PRECIP as a stat tile.
2. **Filter recommendation (LP on/off)** is not returned. `type` is present; inferring the filter
   from it would be UI-side policy.
3. **Excluded-by-ranker targets** are not returned. `ranker.py:333` silently `continue`s past
   zero-sweet-band targets. The design has a dedicated card for them.
4. **Target thumbnails** have no source tool.

### 3.3 Design fixtures vs. real installation data

| | Design assumes | Actual |
|---|---|---|
| Site | Backyard, 40.713 N / 74.006 W, Bortle 6, floor 25° | Example Observatory (scope GPS), 51.4778 N / −0.0015 W, Bortle 8, floor **20°**, ceiling 60° |
| Horizon mask | "mask ON (3 arcs)" | `horizon_mask: []` |
| GPS | "GPS matched site 'Backyard' (0.2 km)" | `matched: null`, `distance_km: null`, warning `"GPS unverified — assuming saved site 'Example Observatory (scope GPS)'."` |
| Tonight | GO — 6% cloud, 12% moon, dew low | **NO-GO** — `go: false`, `suitability: 0`, 99% cloud, 98% moon, dew high, transparency poor |
| Projects | 5 cards, goal-driven progress | 15 projects, **every one `goal_minutes: 0.0`** |
| Median FWHM | `3.42` in card meta and history column | `median_fwhm: null` on every session record |
| Scores | 82 / 78 / 66 | 97 / 92 / 91 — a much tighter spread |

**Consequence:** the states the design lists under *"Not yet designed — you will need these"*
(NO-GO, empty, error) are this installation's **default** state. They are primary work in this
slice, not follow-up.

### 3.4 Confirmed-good contracts

- `assess_conditions` returns `dark_window_utc` as an ISO-UTC pair — drives the twilight strip's
  astronomical-dark bracket directly.
- `plan_targets[].best_window_utc` — drives the accent sweet-band bar directly.
- `reasons[]` on both tools are server-authored strings — render as-is.
- `plan_targets[]` also returns `score`, `type`, `sweet_band_min`, `recommended_subs`,
  `recommended_exposure_s`, `framing_note`, `max_alt_deg`, `transit_utc`, `moon_sep_deg`.

---

## 4. Architecture

```
seestar-dashboard/
├── sidecar/
│   ├── main.py            FastAPI app + CORS for the Vite dev origin
│   ├── routes.py          one GET per allowlisted read-only tool
│   ├── mcp_proxy.py       spawns seestar-mcp over stdio; forwards tool calls
│   ├── replay.py          SEESTAR_REPLAY=1 → serve fixtures, never spawn
│   ├── record.py          one-shot script that writes fixtures/
│   ├── fixtures/          recorded real payloads (committed)
│   └── tests/
├── web/
│   ├── src/
│   │   ├── tokens.ts      the handoff token table, verbatim → CSS custom properties
│   │   ├── shell/         AppShell · TopBar · Sidebar
│   │   ├── screens/tonight/
│   │   ├── api/           fetch clients + zod schemas
│   │   └── test/
│   └── vite.config.ts
└── docs/
    ├── design/            the handoff (committed)
    ├── handback-to-seestar-ai.md
    └── superpowers/specs/
```

Two independently testable units. The sidecar's contract is "HTTP in, verbatim tool JSON out";
the web app's contract is "typed payload in, pixels out." Neither needs the other to be tested.

---

## 5. Sidecar contract

**The sidecar never interprets payloads.** It forwards tool JSON through unmodified. It adds
exactly two behaviours.

### 5.1 Route allowlist

Only these are routable, one `GET` each, no parameters in slice 1 beyond `plan_targets`' `limit`:

```
GET /api/assess_conditions
GET /api/plan_targets?limit=<int>
GET /api/get_site_profile
GET /api/health           → sidecar's own liveness + whether replay mode is on
```

Every other tool — `qa_session_report`, `goto_target`, `start_stack`, `stop_view`, `park`,
`shutdown`, `run_autofocus`, `set_filter`, `set_dew_heater`, `set_project_goal`,
`add_horizon_mask`, `set_site_profile`, `log_session_result`, `log_sky_result`, `download_subs`,
`plate_solve`, `connect_telescope` — has **no route**. Not 403; absent, returning 404.

This is the structural enforcement of the read-only discipline. A UI bug cannot fire
`qa_session_report` because there is nothing to call. The allowlist is a literal in `routes.py`
and is asserted by test (section 8).

`list_projects`, `get_status`, `get_view_state`, `qa_tier1`, `recommend_projects`,
`check_night_guardrails` and `get_project` are read-only and will be added in their own slices;
they are deliberately not routed in slice 1, so the allowlist test has meaning.

### 5.2 Replay mode

`SEESTAR_REPLAY=1` serves `fixtures/<tool>.json` and never spawns a subprocess. This is what the
test gate and offline UI work run against. `GET /api/health` reports `{"replay": true}` so the
web app can surface a visible "fixtures, not live" indicator during development.

### 5.3 Errors

The MCP tools follow a never-raise contract, returning `{"ok": false, "error": "..."}`. The
sidecar forwards that body with HTTP 200 — it is a valid tool response, not a transport failure.
Transport failures (subprocess dead, timeout) return 502 with `{"ok": false, "error": ...}` in
the same shape, so the client has one error shape to handle.

---

## 6. The verdict mapping

The design specifies three verdict states (GO / CONDITIONAL / NO-GO). The server returns
`go: bool | null` plus `suitability: int`.

**The UI will not derive a verdict.** The rendered states are exactly the three values `go` can
hold:

| `go` | Rendered | Spine |
|---|---|---|
| `true` | `GO` | `pass` |
| `false` | `NO-GO` | `reject` |
| `null` | `UNKNOWN` | `marginal` |

`null` means the weather fetch failed; the tool docstring's guidance is "assess the sky manually,"
so UNKNOWN renders the reasons list and an explicit instruction rather than a number.

**CONDITIONAL is not rendered in slice 1.** Synthesising it from `suitability` would be the UI
computing a verdict from a threshold, which `CLAUDE.md` forbids. It is hand-back item 6.

This mapping is a 1:1 relabel of an existing field with no arithmetic, and it lives in the web
app's schema layer, documented as the one place verdict naming happens.

---

## 7. Design system and real states

### 7.1 Tokens

`web/src/tokens.ts` transcribes the handoff's colour table verbatim into CSS custom properties,
plus the type scale (IBM Plex Sans 400/500/600, IBM Plex Mono 400/500), spacing, radii, and the
single `livePulse` keyframe. The Sans/Mono split is load-bearing and is expressed as two token
families, not ad-hoc `font-family` declarations.

`prefers-reduced-motion` drops `livePulse` to a static dot. (No pulsing element appears in slice
1 — it belongs to Live — but the rule ships with the tokens.)

### 7.2 States that must be designed, not stubbed

Because they are this installation's normal state:

- **NO-GO banner** — `reject` spine, the word NO-GO, `reasons[]` promoted to the primary content
  (they are the actionable information), no ranked shortlist. This is tonight's real render.
- **UNKNOWN** — `go: null`; weather-outage copy.
- **GPS unverified** — the sidebar's confident `pass`-dot row becomes a `marginal` warning row
  carrying `location.warning` verbatim.
- **Empty horizon mask** — `horizon_mask: []` renders "mask off", not "3 arcs".
- **Absent fields** — precip, filter chip, thumbnail, and the excluded-by-ranker card have no
  data source. Each renders an explicit absent treatment (an em-dash in `text/ghost`, or the
  element omitted with its container collapsed). **Never a plausible-looking placeholder value.**
  A fake `0%` precip tile is worse than no tile.
- **Above-floor rail** — the grey `chart/rail` bar has no timestamps. The sweet-band accent bar
  renders from `best_window_utc`; the rail is omitted until hand-back item 2 lands. The legend
  entry for it is omitted too, so the legend never describes something absent.
- **Loading** — skeletons for the banner, timeline, and card grid.
- **Sidecar unreachable** — a screen-level banner; the top-bar connection pills are the natural
  home for per-connection failure and will carry it once `get_status` is routed (slice 3).

### 7.3 Fidelity

Colours, type, spacing, radii and copy are reproduced from the handoff exactly. Where a value has
no data source, the *layout* is still built to spec so that adding the field later is a data
change rather than a re-layout.

---

## 8. Testing — the gate

`vitest run` for `web/`, `pytest` for `sidecar/`. Target: under 10 seconds combined. Everything
runs against recorded fixtures; nothing in the gate touches the network or a subprocess.

**Sidecar**

- Allowlist test: every side-effecting tool name returns 404. Asserted against an explicit list of
  the forbidden tools, so adding a route for one fails the build.
- Replay test: with `SEESTAR_REPLAY=1`, each allowlisted route returns its fixture byte-identical
  to the recorded file — proving the proxy does not transform payloads.
- Error-shape test: transport failure produces the same `{ok: false, error}` shape as a tool-level
  failure.

**Web**

- **Fixture-contract test** — every recorded fixture is re-validated against its zod schema. When
  the server's payload changes, this fails with a clear message instead of the UI rendering blank
  cards. This is the early-warning system for drift between the two repos.
- Component tests per state: NO-GO (real recorded fixture), GO (hand-edited from the recorded
  one, file-named `*.synthetic.json` and asserted to be the only synthetic fixture), UNKNOWN
  (`go: null`), GPS-unverified, empty-mask, loading, sidecar-unreachable.
- **No stray hex** — no hex colour literal outside `tokens.ts`. Airtight, trivially greppable.
- **No hardcoded QA thresholds** — deny-list of the distinctive constants `0.575` and `0.42`
  anywhere in `web/src`. This is a deny-list, not a proof: floor/ceiling degrees (20/60) are too
  generic to grep for without false positives, so those are covered by the convention that all
  site geometry is read from `get_site_profile` and by review, not by the test. Recorded honestly
  here so nobody mistakes the test for full coverage.

Playwright and visual-regression are deferred to slice 2, once a second screen exists to justify
the harness.

---

## 9. Hand-back to the SeeStar-AI session

Written to `docs/handback-to-seestar-ai.md`, each item with the file and line where it was found
so that session does not repeat this investigation.

| # | Item | Location | Blocks |
|---|---|---|---|
| 1 | `_compact_report` strips `SubMetrics`; expose per-sub metrics in the tool payload | `server.py:474` | Review screen (slice 4) — its charts and table cannot be built without this |
| 2 | Above-floor span start/end timestamps; `_longest_run(above_floor, times)` alongside the existing sweet-band call | `planning/astro.py:279,320` | The timeline's grey rail (slice 1, degraded) |
| 3 | Precipitation probability as a structured field, not prose in `reasons[]` | `planning/weather.py` / `assess_conditions` | PRECIP stat tile (slice 1, degraded) |
| 4 | Return excluded targets with an exclusion reason instead of silently skipping | `planning/ranker.py:333` | Excluded-by-ranker card (slice 1, degraded) |
| 5 | Filter recommendation (LP on/off) per ranked target | `planning/ranker.py` | Filter chip (slice 1, degraded) |
| 6 | A 3-state conditions verdict, or confirm `go: bool\|null` is the intended contract and CONDITIONAL is design-only | `assess_conditions` | CONDITIONAL state |
| 7 | `median_fwhm` is `null` on all 15 projects' session records — is it ever populated, or is the write path missing? | `planning/projects.py:37` | Projects card meta + history column (slice 5) |
| 8 | No tool returns target imagery | — | Thumbnails (slices 1, 5) |

Items 2–5 degrade slice 1 rather than block it; the design accommodates their absence explicitly
(section 7.2).

---

## 10. Slice roadmap

| # | Slice | Depends on |
|---|---|---|
| **1** | **Transport + shell + Tonight** | — |
| 2 | Projects | 1 (hand-back 7 for full fidelity) |
| 3 | Live — telemetry, gauge, guardrails, log; SSE lands here | 1 |
| 4 | Review & QA | 1, **hand-back 1** |
| 5 | Agent chat + approval gate — its own subsystem: streaming, provenance, motion protocol | 3 |
| 6 | Mobile breakpoint | 1–3 |

Slice 3 should consult the session memory `seestar-telemetry-shapes`, which records
hardware-verified `get_view_state` / `get_device_state` structures and the framing-offset,
idle-timeout and scale quirks a client must render correctly.

---

## 11. Out of scope for slice 1

Live, Review, Projects, the agent chat and approval gate, the mobile breakpoint, SSE/WebSocket
transport, Playwright, and any change to the SeeStar-AI repo. The approval-gate and
horizon-mask-confirmation invariants are policy for slices 3 and 5; nothing in slice 1 can move
the mount, because no such route exists.
