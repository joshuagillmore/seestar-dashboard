# Hand-back to the SeeStar-AI session

Server-side gaps found while building the SeeStar Console dashboard. Under the hand-back rule in
this repo's `CLAUDE.md`, none of these can be fixed here — working around them in the UI would
mean re-implementing server logic in the client, which is exactly what the rule forbids.

**Found:** 2026-07-27 to 2026-07-28, by reading `src/seestar_mcp/` and calling the read-only tools live against
the current installation (Example Observatory, Bortle 8).

**The encouraging part:** most of the values below are *already computed inside the server* — they
are simply not in the returned payload. Several are a dataclass field and a line in a return dict,
not new logic. (Deliberately not a count: this list has grown twice and the count went stale both
times.)

**A pattern worth noticing across items 3, 5 and 12:** in each, the server demonstrably knows a
value and mentions it in a `reasons[]` entry or a session note, but does not return it as a field.
Each one forces the dashboard to choose between an absent state and parsing English. A general
convention — *if a tool names a quantity in prose, return it as a field too* — would be worth more
than three separate fixes.

Line references are to `OrangeAgente/SeeStar-AI` @ `main` as of 2026-07-30.

---

## Start here — what to do first, and why

Added 2026-07-30, when this list reached sixteen items and became too long to hand over cold.
Four tiers, ordered by what they unblock rather than by effort.

### Tier 1 — blocks a whole screen from being started

**Item 1: `qa_tier2` strips the per-sub metric arrays.**

This is the long pole. The Review & QA screen is *made of* per-sub charts — eccentricity, FWHM,
SNR and star count across every frame — and `_compact_report` removes exactly those arrays before
the payload leaves. There is nothing partial to build in the meantime, so the screen cannot start
until this lands. Everything else on this list degrades a screen; this one prevents one existing.

### Tier 2 — blocks a feature within a screen that is otherwise buildable

**Item 10: provenance cannot tell one client from another.**

Gates the Live session screen's operator panel. The rest of that screen — live preview, stacking
telemetry, guardrails — can be built against `get_view_state` today, so slice 3 should not wait for
this. But a panel that says "Claude just slewed to M31" cannot exist while the dashboard's own
polling is indistinguishable from the agent's calls in the same log. The hook already exists and is
simply unused: `ProvenanceLog.log_call()` accepts the fields, and the `@mcp.tool()` wrappers pass
none of them.

### Tier 3 — small, and each closes a gap that is visible on screen today

Items **3** (precipitation), **13** (verdict summary) and **14** (narrowband/broadband class).

All three are quantities the server already computes and then flattens into English on the way
out. Item 14 probably also closes item **5** (the LP filter chip), since it is the same
classification. Each is roughly a dataclass field and a line in a return dict. Together they close
the PRECIP tile, the verdict banner's headline, the ranked-card subtitle and the filter chip — four
visible holes for what is likely a day's work.

**Item 16** (an IANA zone on the site profile) belongs here too, and is the one item on the list a
user rather than a developer supplies.

### Tier 4 — worth doing, nothing is waiting on it

Items **2**, **4**, **6**, **7**, **9**, **11**, **12**, **15**. The dashboard renders an honest
absent state for each and nothing is blocked. Two are worth a second look regardless, because they
may indicate real defects rather than missing fields:

- **Item 7** — `median_fwhm` is `null` on *every* session record. That looks like a write-path bug,
  not an omission.
- **Item 15** — `recommend_projects` sorts on a field that is zero for every real project, so its
  ranking is a no-op and its output is `list_projects` truncated. It is not returning a wrong
  answer; it is returning an unranked one while appearing ranked.

**Item 11** carries a warning rather than a request: the extended catalogue attached to it must
**not** be merged on its own. Adopting 12,517 objects without first vectorising the observability
computation makes `plan_targets` take about sixteen minutes per call, and without a
brightness/feasibility term the ranker will confidently recommend faint galaxies an f/5 50 mm
cannot resolve. Both are spelled out in that item.

### What is already done on the dashboard side

Nothing here is waiting on the dashboard. Every item has an honest absent state shipped — the
screens say what is missing rather than rendering a plausible placeholder, and none of them parses
prose to fill a gap. When a field arrives, the corresponding surface should light up without
further UI work in most cases.

---

## 1. Per-sub metrics are stripped from the `qa_tier2` payload

**Blocks:** the entire Review & QA screen — the per-sub eccentricity chart, the star-count chart,
and every metric column of the per-sub table.

`server.py:474 _compact_report()` deliberately reduces each sub to `{name, verdict, reasons}`:

```python
"subs": [
    {"name": v.name, "verdict": v.verdict, "reasons": v.reasons}
    for v in report.subs
],
```

The full `SubMetrics` dataclass (`qa_tier2.py:88`) already carries `star_count`, `fwhm`, `hfr`,
`eccentricity`, `snr`, `background`, `scattered_light` — and `qa_session_report` *does* write all
of it to the JSON artifact via `dataclasses.asdict(report)` (`qa_tier2.py:599`).

So the data exists and is already serialised elsewhere; only the tool response drops it.

**Asked for:** add the metrics to each sub in the tool payload — or, if response size is the
concern (766 subs × 7 floats is roughly 40 KB of JSON), a `detail: bool = False` parameter, or a
separate read-only getter that returns an already-written report.

**Note the related gap:** there is still **no read-only tool that fetches a previously written
report**. `qa_session_report` writes artifacts and winds down the session, so a dashboard cannot
call it to display results — it would generate files on every page refresh. A read-only
`get_session_report(target, date)` would solve items 1 and this together.

---

## 2. Above-floor span has no start/end timestamps

**Blocks:** the grey `chart/rail` bar on the Tonight sweet-band timeline — the "what a naive
planner would promise" contrast that the design calls the core idea of the product.

`Observability` (`planning/astro.py:60`) returns `dark_minutes_above_floor` — an integrated
duration — but no span. The sweet band, by contrast, *does* get timestamps via
`best_window_utc`, computed at `astro.py:320`:

```python
best_window_utc = _longest_run(sweet, times)
```

The `above_floor` boolean mask already exists one line earlier (`astro.py:279`).

**Asked for:** `above_floor_window_utc = _longest_run(above_floor, times)` and a corresponding
field. Same helper, same data, adjacent line.

---

## 3. Precipitation probability is computed but not returned

**Blocks:** the PRECIP stat tile on the Tonight verdict banner.

`ConditionsAssessment` (`planning/weather.py:63`) has no precipitation field. But precip is
fetched (`weather.py:51`, `"precipitation_probability"`), is an input to scoring
(`weather.py:153`, `_score(cloud_pct, wind_kph, max_precip)`), and is one of the two conditions
that gate `go` (`weather.py:54`, `_GO_PRECIP_PCT`).

Today it reaches the client only as prose inside `reasons[]`:

> `"precipitation probability up to 16%"`

Parsing that string client-side to fill a stat tile would be exactly the wrong thing.

**Asked for:** add `max_precip_pct: float | None` to `ConditionsAssessment`.

> **Confirmed and authorised 2026-07-30.** The user confirms the skill sources this from a
> **meteoblue** feed, so the value is fetched, parsed and scored on before being dropped on the
> way out — this is a discarded field, not a missing capability. They have asked that the
> dashboard **not** work around it: *"no use having you trying to code around a simple fix."*
>
> The dashboard side is therefore doing nothing here. The PRECIP tile stays absent, and the
> banner keeps stating the figure only in prose, until the field exists.

---

## 4. Excluded targets are dropped silently by the ranker

**Blocks:** the "EXCLUDED BY THE RANKER — NOT ON THE PLAN" card on Tonight, which the design
uses to explain *why* an obvious target isn't in the shortlist (behind the horizon mask, transits
above the rotation ceiling, sets below the floor).

`planning/ranker.py:333`:

```python
if obs.dark_minutes_in_sweet_band <= 0:
    continue  # never up / no clean sweet-band time — excluded
```

There is a second silent drop just above it (`ranker.py:331`) that swallows any target whose
observability computation raises — those disappear with no trace at all, which is worth surfacing
for diagnostics independently of the UI.

**Asked for:** collect excluded targets into an `excluded: [{id, name, reason}]` array on the
`plan_targets` response. The exclusion reason is known at the point of the `continue`; the
`Observability` object in scope already distinguishes the cases (`transits_above_ceiling`,
`dark_minutes_above_floor == 0`, mask-blocked).

---

## 5. Filter recommendation (LP on/off) is not returned

**Blocks:** the filter chip on each Tonight plan card, and the accent/neutral chip styling that
depends on it.

`ranker.py:120` already computes `lp_fit = lp_suitability(target.type, bortle_for(site))`, and it
surfaces in prose at `ranker.py:172` — `"planetary nebula suits Bortle 8 (LP fit 0.96)"` — but
`lp_fit` is not a field on the returned target.

Inferring the filter from `type` in the client would put an observing-policy decision in the UI.

**Asked for:** expose `lp_fit: float` and, ideally, an explicit `use_lp_filter: bool` matching the
parameter `goto_target` already takes. The planner and the executor should agree on the filter
without the UI mediating.

---

## 6. Conditions verdict is two-state; the design is three-state

**Affects:** the Tonight verdict banner and the sidebar status dot.

The design specifies GO / CONDITIONAL / NO-GO. `assess_conditions` returns `go: bool | None` plus
`suitability: int`.

The dashboard currently renders exactly the three values `go` can hold — `true → GO`,
`false → NO-GO`, `null → UNKNOWN (weather outage)` — and **does not render CONDITIONAL**.
Synthesising it from a `suitability` threshold would be the UI computing a verdict, which this
repo's `CLAUDE.md` forbids outright.

Worth noting `go` is *already* a compound verdict: `weather.py:54` gates it on suitability **and**
precipitation being below `_GO_PRECIP_PCT`. So the server is the right owner; it just collapses
to a boolean at the end.

**Asked for:** either return an explicit three-state verdict (with the threshold owned by
`config.py` like every other threshold), or confirm that two-state-plus-unknown is the intended
contract and CONDITIONAL is design-only — in which case the design should drop it.

---

## 7. `median_fwhm` is `null` on every session record

**Affects:** the "med FWHM 3.42" meta line on Projects cards and the MED FWHM column of the
session-history table — both empty for all real data.

`SessionRecord.median_fwhm` (`planning/projects.py:37`) is typed `float | None = None` and
commented *"from qa_session_report if available"*. Across all 15 projects and 22 session records
in the live store, it is `null` in every single one.

**Asked for:** confirm whether the write path from `qa_session_report` → `log_session_result` ever
populates it. If it's meant to and doesn't, that's a server bug worth catching independently of
this dashboard — it means session quality history is not being retained anywhere.

---

## 8. No tool returns target imagery — but the imagery exists on disk

> **Corrected 2026-07-28.** This item originally read "no tool returns target
> imagery" and treated it as a server gap. That was wrong. The exports are on
> the user's machine at `C:\Users\<user>\OneDrive\Documents\SeeStar` — 19,622
> files, 11,818 JPEG and 7,804 FITS — in exactly the convention the design
> handoff describes. **This is a dashboard feature, not a SeeStar-AI change**,
> and it is tracked in `slice-2-backlog.md` rather than here.

**Affects:** the 64×88 thumbnails on Tonight plan cards, the 96px project covers, the Live preview
image, and the Review master image.

The archive is laid out one directory per target, with masters and subs separated:

```
C 33/       Stacked_C 33_10.0s_LP_20240104-202236.fit   + _thn.jpg
C 33-sub/   Light_C 33_10.0s_LP_20240104-200144.fit     + _thn.jpg
```

So `Stacked_<target>_…_thn.jpg` is already a per-target thumbnail, and the
`-sub` directories hold the individual `Light_*.fit` frames that `qa_tier2`
scores — which is the raw material the Review screen needs in slice 4.

**What remains for the server, if anything:** only a canonical answer to *where*
that directory lives, so the sidecar is not hardcoding a personal path. A
`data_root` field on `get_site_profile`, or an existing config value the tool
already knows, would do it. Everything else can be served from disk.

**Note the target-name mismatch.** Directories use spaced catalogue names
(`M 31`, `NGC 281`) while the tools use unspaced ids (`M31`, `NGC281`). Any
lookup needs to normalise, and one directory is simply named `Unknown`.

---

## 9. `plan_targets` returns only the longest sweet-band span, not all of them

**Affects:** the sweet-band timeline's bar labels, and its ability to show a
fragmented band honestly.

`Observability.best_window_utc` (`planning/astro.py:81`) is
`_longest_run(sweet, times)` — the single longest contiguous span. Alongside it,
`dark_minutes_in_sweet_band` is the *integrated total* across the whole dark
window, which may include further spans the longest run does not cover.

On the recorded night the two differ by two minutes (M76's longest
contiguous run against its total). Invisible. But a band split by a
cloud gap or a horizon-mask crossing can diverge arbitrarily, and the dashboard
has no way to draw the second span or to say one exists.

The client currently labels each bar with the span it actually draws, so nothing
on screen is false — but it means the ranker's headline figure and the chart
disagree, and the chart is the one screen whose stated purpose is an auditable
promised-versus-bankable comparison.

**Asked for:** return every sweet-band span, not only the longest — e.g.
`sweet_band_windows_utc: [[start, end], ...]`. The mask already exists
(`astro.py:280`), and `_longest_run` is one of several possible reductions over
it. With the full list the chart can draw each span and the gaps between them,
which is the honest picture.

---

## 10. Provenance records cannot tell one client from another

**Blocks:** the Live session screen's operator panel (slice 5) — the dashboard
cannot show what Claude is doing while it runs the `run-session` skill.

`data/provenance.jsonl` is the only record shared between the agent and the
dashboard. It has 537 records, and each is exactly this:

```json
{"ts": "2026-07-29T01:17:25.103569+00:00", "tool": "list_projects", "args": {}}
```

Three fields. **No client id, no session id, no result.** The dashboard and
Claude Code each spawn their own `seestar_mcp.server` process against the same
`data/` directory, so both write here — and nothing distinguishes them. Verified
directly: the three most recent records are the dashboard's own calls, sitting
indistinguishably alongside the agent's.

The design's operator panel assumes otherwise. Its composer footnote reads
*"Every tool call is written to provenance.jsonl"*, which is true, but a panel
that says "Claude just slewed to M31" needs to know which calls were Claude's.

**The hook already exists and is simply unused.** `ProvenanceLog.log_call()`
(`provenance.py:70`) already accepts `request`, `client_txn_id`,
`server_txn_id`, `response_code`, `fits_hash` and `note` — the `@mcp.tool()`
wrappers pass none of them. `SessionManifest` (`provenance.py:138`) already
carries a `session_id`, but only materialises at QA wind-down.

**Asked for:** populate a stable per-process client identifier and, where a
session exists, its `session_id` on every `log_call`. A client sets it once at
initialise; the server stamps each record. That is enough for the dashboard to
tail the log and attribute each call correctly.

Two smaller things would make the panel materially better and cost little:
`response_code` (so a failed call is visible as failed) and the elapsed time of
each call.

---

## 11. The planner's catalogue is 120 objects, so the ranker cannot suggest half the user's own targets

**Affects:** `plan_targets` itself, and every screen that shows a suggested
target. An artifact is attached — see *What is attached* below.

`planning/data/dso_catalog.json` holds **120 objects** (110 Messier plus ten
showpieces). **Ten of the user's twenty archive targets are not in it**,
including **IC 405 — their single largest investment at 217 minutes.**

This is not a display problem the dashboard can work around. `plan_targets` can
only rank what the catalogue contains, so **the ranker is structurally incapable
of ever suggesting IC 405, NGC 1499 or SH2-142**, however well placed they are
on a given night. The user's most-observed objects are invisible to their own
planner.

### What is attached

`data/dso_catalog_extended.json` in the dashboard repo — **12,517 objects**,
generated from OpenNGC by `data/build_catalogue.py`, emitted in
`dso_catalog.json`'s exact shape so it is a drop-in replacement. Verified: no
duplicate ids, nothing outside `TARGET_TYPES`, 91.4% carry both magnitude and
size.

Also `data/dso_aliases.json` — 28,802 alternative designations mapped to
canonical ids. This exists because of a failure worth repeating: **two of the
user's targets could not be found by the names they actually use.** `NGC 2244`
is a `Dup` redirect to `NGC 2239`, and `C33` is Caldwell notation for
`NGC 6992`. Both objects were present all along. With the alias index,
resolution goes from 30/32 to **32/32**.

**Licensing matters here and is not optional.** OpenNGC is CC BY-SA 4.0. The
share-alike condition binds the data files and anything adapted from them, but
**not** the application code that reads them — so this is compatible with
SeeStar-AI being MIT, provided the attribution ships with the data.
`data/ATTRIBUTION-OpenNGC.md` is written and must travel with the JSON.

### Adopting the catalogue alone would make the ranker worse

This is the important part. **Do not merge the catalogue without these two
changes.**

**a. The observability computation must be vectorised first.** Measured on this
machine: the current per-target astropy path runs at **79 ms/target**. At 12,517
objects that is **16.5 minutes per `plan_targets` call** — unusable. A
vectorised spherical-trig implementation
(`sin(alt) = sin δ sin φ + cos δ cos φ cos H`) measured **0.0033 ms/target**,
about **24,000× faster**, giving ~41 ms for the whole catalogue, with a maximum
error of 0.24° against astropy. At the scale of a horizon mask and a sweet-band
test, that error is irrelevant.

This measurement is also what killed the alternative of shipping a
deliberately-crippled catalogue: the bottleneck was never storage, it was
compute, and the compute is fixable.

**b. The ranker needs a brightness/feasibility term, which it currently has
none of.** The score (`planning/ranker.py:126`) is:

| Weight | Value |
|---|---|
| `W_SWEET_BAND` | 0.40 |
| `W_LP_FIT` | 0.20 |
| `W_MOON` | 0.15 |
| `W_FIELD_ROT` | 0.15 |
| `W_FRAMING` | 0.10 |

Every term is about *when and where* the object is, and none about *whether the
instrument can actually record it*. With 120 curated showpieces that was safe —
they are all imageable by construction. **86.2% of the extended catalogue is
galaxies** (10,792 of 12,517), most of them faint, and against that population a
ranker with no feasibility term will happily recommend a 15th-magnitude smudge
that an f/5 50 mm cannot resolve, purely because it sits high at midnight.

The dashboard has an integration-time model
(`sidecar/seestar_sidecar/integration_goal.py`) that estimates hours from
surface brightness and could inform such a term, but **the ranker is server-side
policy and the weighting is not the dashboard's call** — flagging it, not
proposing a number.

### Two smaller notes

- Ambiguous OpenNGC type codes (`Neb`, `Cl+N`) affect `lp_suitability()`, which
  keys off `type`. They are resolved against SIMBAD `otype` where SIMBAD answers
  unambiguously, and left as `other` where it does not.
- One upstream OpenNGC error is corrected in the attached data as a documented
  divergence: `IC 434`'s common name is recorded as "Flame Nebula", which the
  same row's own NED note contradicts — the Flame is `NGC 2024`.

---

## 12. `SessionRecord` has no filter field, though the filter is known

**Affects:** the FILTER column of the Projects screen's session-history table
(design README, Screen 4).

`SessionRecord` (`planning/projects.py:30`) carries exactly six fields:
`date_utc`, `integration_minutes`, `subs_total`, `subs_kept`, `median_fwhm`,
`notes`. There is no filter. Not null — absent. Across all 20 session records in
the live store, nothing states which filter a session used as data.

**But the information exists, twice over.**

It is in the notes as prose — *"Broadband/IRCUT, 0 dropped. Faint (Bortle 8
low-SB galaxy)..."* — which the dashboard will not parse, for the same reason it
does not parse precipitation out of `reasons[]` (item 3): that puts server
knowledge in the client.

And it is in every archive filename:

```
Light_M 31_10.0s_IRCUT_20240104-200144.fit
Light_C 33_10.0s_LP_20240104-200144.fit
```

Counted across the user's archive: **5,953 frames LP, 1,800 IRCUT**. The
telescope records the filter on every single frame it writes; only the session
store drops it.

**Asked for:** add `filter: str | None` to `SessionRecord`, populated at
`log_session_result` from the same source that already names it in the notes.

This is the third instance of one pattern — precipitation (item 3), the LP filter
recommendation (item 5), and now this — where a value the server demonstrably
knows reaches the client only as prose. Each forces the dashboard to either show
an absent state or parse English. A general fix would be worth more than three
specific ones: when a tool mentions a quantity in a reason or note, return it as
a field as well.

---

## 13. No one-line summary of the verdict, only the reason list

**Affects:** the Tonight verdict banner (design README, Screen 1, ~line 268).

**Raised 2026-07-30**, after the user chose the hybrid banner treatment.

The design's banner leads with a single composed sentence:

> *"Clear (6% cloud) through the dark window, 5.8 h of astronomical dark, 12%-lit moon 96° from
> the plan."*

`assess_conditions` returns `reasons[]` — a list of individual findings — but nothing that reads
as a headline. Tonight's real payload gives five separate lines (cloud, dew, wind, precipitation,
moon), all weighted equally, when only the 86% cloud actually decided the verdict.

**The dashboard must not compose this itself.** The verdict and its justification are server-owned
policy in this project, the same as QA verdicts and thresholds — a client that writes its own
summary sentence is deciding which factor mattered most, which is a judgement about the night, not
a rendering choice. The server already composes the prose in `reasons[]`, so this is the same class
of work it is doing anyway.

**Asked for:** a `summary: str` on `ConditionsAssessment` — one sentence naming the decisive
factors, in the same voice as the existing reasons. `reasons[]` stays exactly as it is; the banner
will show the summary as the headline and the reasons as supporting detail.

Until it exists the banner renders the reason list alone, with no invented headline.

---

## 14. `plan_targets` does not say whether a target is narrowband or broadband

**Affects:** the ranked-card subtitle on Tonight (design README, ~line 348).

**Raised 2026-07-30.**

The design's card subtitle pairs the common name with an imaging descriptor:

| Design | Ours today |
|---|---|
| `Wizard Nebula · emission` | `Wizard Nebula` |
| `Andromeda Galaxy · broadband` | `Andromeda Galaxy` |
| `Pleiades · reflection cluster` | `Pleiades` |

That descriptor is not decoration — it is the single most useful thing on the card for deciding
whether tonight's moon or skyglow matters for this target, and it is **already computed**.
`planning/lightpollution.py`'s `LP_MODEL` classifies every target type as `narrowband`,
`broadband`, `robust` or `neutral`, and `lp_suitability()` uses exactly that classification for 20%
of the ranker's score. It simply is not returned.

The dashboard could re-derive it from `type`, but that would mean copying `LP_MODEL`'s mapping into
the client — the same hardcoding-the-server's-policy problem as QA thresholds, and it would drift
silently the moment the model changes.

**Asked for:** return the classification already used for scoring — e.g. `lp_class: str` on each
ranked target — so the subtitle can name it instead of the UI guessing.

**Related:** this is the same field that would answer item 5 (the `LP on`/`LP off` filter chip),
so the two are likely one change.

---

## 15. `recommend_projects` degenerates to list order, because no project has a goal

**Affects:** the Projects header recommendation (design README, ~line 649).

**Found 2026-07-30** while restoring that line to the screen.

`recommend_projects` (`planning/projects.py:199`) selects active projects still needing data and
sorts by remaining minutes descending, with open-ended projects — `goal_minutes == 0` — documented
as *"treated as a large remaining, so they sort high"*.

**Every real project in the store has `goal_minutes == 0`.** So every candidate ties at that same
sentinel, the sort is a no-op, and the result is byte-identical to `list_projects`' own order,
truncated to `limit`. Verified against the live store.

Two consequences:

1. The recommendation carries no ranking information. It is presented as the tool's judgement about
   what to shoot next, and it is really just the first row of an unrelated ordering.
2. The design's copy — `recommend_projects: NGC 1499 first — 6.9 h short of goal` — cannot be
   produced at all. There is no shortfall to state when nothing has a goal.

**What the dashboard did, and deliberately did not do.** The recommendation is shown using the
tool's real output, with the shortfall clause omitted rather than filled in. The dashboard *does*
now compute a suggested integration goal per target
(`sidecar/seestar_sidecar/integration_goal.py`), so it could produce a plausible "N h short"
figure — but pairing the server's chosen target with a shortfall derived from a completely
different computation would imply the server ranked on our number. It did not. That would be a
fabricated agreement between two unrelated things, which is worse than an absent clause.

**Asked for — either would fix it:**

- Rank on something meaningful when goals are unset (last-observed date, total collected, or
  sweet-band availability), so the recommendation reflects a real judgement; **or**
- Accept a goal hint so a client that has computed goals can rank against them.

Note the dashboard cannot set goals itself: `set_project_goal` is a write tool and the sidecar
allowlist excludes it by design, so this cannot be resolved from the client side.

**Related:** this is the mirror image of item 11. There the ranker cannot suggest targets outside a
120-object catalogue; here it cannot rank the projects it does have, because the field it ranks on
is never populated.

---

## 16. The observing site has no IANA timezone, only coordinates

**Affects:** every clock on the Tonight screen (the ranked cards' `BEST WINDOW` stat, and the
sweet-band timeline's dark/dawn labels, per-target windows and hour axis) — none of them can say
whether they match the telescope's own zone.

**Found 2026-07-30** while labeling those clocks so they at least name *some* zone rather than the
ambiguous "local" the design uses.

`get_site_profile` (`server.py:629`) returns `dataclasses.asdict(profile)` — `name`, `lat_deg`,
`lon_deg`, `elevation_m`, `bortle`, `sqm`, `horizon_mask`, `min_altitude_deg`,
`field_rotation_ceiling_deg`. No timezone field, named or otherwise.

The one `local_tz` in this codebase (`sidecar/seestar_sidecar/archive.py`) is not a fit either, for
two independent reasons: it is not derived from the site's coordinates at all — its own docstring
says production leaves it `None` and reads "the system's own timezone" of whatever machine runs the
sidecar — and it has no HTTP route exposing it regardless, since it exists only to parse archive
filenames.

So a browser checking Tonight's plan from anywhere other than the site (a hotel, a phone away from
the mount) has no way to know whether the times it renders match the telescope's — the dashboard can
name **its own** clock's zone (an honest UTC-offset label, shipped in this same change) but not the
site's, and cannot even detect whether the two agree.

**Asked for:** an IANA zone name on the site profile — e.g. `tz_name: str | None` alongside
`lat_deg`/`lon_deg` on `SiteProfile`, set by `set_site_profile` (a user-supplied value, the same way
`bortle`/`sqm` already are, since coordinates alone don't determine a zone unambiguously near a
border and reverse-geocoding is a real dependency for a small gain). With it, the dashboard could
show both clocks explicitly when they differ, instead of only being able to name one of them.

**Note for anyone standing up a fresh installation:** until this exists, don't assume the machine
running the sidecar is in the same zone as the browser viewing the dashboard, or as the telescope
itself — today it happens to be true for this one installation, and nothing checks it.

---

## Impact summary

| # | Item | Blocks | Already computed server-side? |
|---|---|---|---|
| 1 | Per-sub metrics stripped | Review screen entirely | Yes — written to the artifact |
| 2 | Above-floor span timestamps | Timeline grey rail | Yes — mask exists, helper exists |
| 3 | Precip probability | PRECIP tile | Yes — scored on, gates `go` |
| 4 | Excluded targets | Excluded card | Yes — known at the `continue` |
| 5 | Filter recommendation | Filter chip | Yes — `lp_fit` computed |
| 6 | Three-state verdict | CONDITIONAL state | Partly — `go` is already compound |
| 7 | `median_fwhm` always null | Projects meta + history column | Unknown — possible write-path bug |
| 8 | ~~No target imagery~~ — **not a server gap**, the archive is on disk | All thumbnails | N/A — dashboard feature, see `slice-2-backlog.md` |
| 9 | Only the longest sweet-band span returned | Fragmented-band rendering; ranker figure and chart disagree | Yes — the mask exists, `_longest_run` is one reduction over it |
| 10 | Provenance cannot distinguish clients | Live operator panel (slice 5) | Partly — `log_call` already accepts the fields, the wrappers never pass them |
| 11 | Catalogue covers 120 objects; half the user's targets are absent | Suggested integration targets; **and the ranker can never suggest IC 405, NGC 1499, SH2-142** | No — a 12,517-object OpenNGC extension plus alias index is supplied, but **must not be merged without the two paired ranker changes** (vectorise observability, add a feasibility term) |
| 12 | `SessionRecord` has no `filter` field | FILTER column of the session-history table | Yes — it is in the session notes as prose, and on every one of the 7,753 archive filenames |
| 13 | No one-line verdict summary, only `reasons[]` | Headline sentence of the Tonight banner | Partly — the server already composes the reason prose |
| 14 | `plan_targets` does not return the narrowband/broadband class | Ranked-card subtitle descriptor; likely also item 5's filter chip | Yes — `LP_MODEL` already classifies it and the ranker scores on it |
| 15 | `recommend_projects` ties every project on the same sentinel and returns list order | The Projects header recommendation, and the design's "N h short of goal" clause | No — it ranks on `goal_minutes`, which is 0 for every real project |
| 16 | `SiteProfile` has coordinates but no IANA timezone | Every clock on Tonight can name the browser's own zone but not the site's, or detect whether the two agree | No — nothing computes or stores one today |

Items 2–5 and 9 **degrade** the Tonight screen rather than block it; the dashboard renders an
explicit absent state for each rather than a plausible-looking placeholder, so nothing on screen is
a lie. Item 1 **blocks** the Review screen outright. Item 7 may indicate a real server-side defect.
Item 10 blocks slice 5. Item 11 is the only one that degrades a tool the *agent* uses rather than
just the dashboard — the ranker's blind spot is the user's most-imaged object. Item 16 likewise
degrades rather than blocks: the dashboard now states the zone it *can* name honestly instead of the
ambiguous "local", it just cannot yet name the site's.
