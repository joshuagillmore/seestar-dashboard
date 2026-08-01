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

Line references were taken against `OrangeAgente/SeeStar-AI` @ `main` as of 2026-07-30.

> **The repository has since moved (2026-07-31).** The public repo is now
> **`github.com/OrangeAgente/seestar-mcp`**; the old `OrangeAgente/SeeStar-AI` is **private** and
> will 404. History was rewritten to remove personal data — site coordinates, a LAN address, local
> paths — and although all 106 commits are preserved, **every SHA changed**. Any pinned commit will
> not resolve; re-clone rather than fetch. Line numbers cited below may have drifted; treat them as
> a pointer to the right function, not an address.

---

## Start here — what to do first, and why

Added 2026-07-30, when this list reached sixteen items and became too long to hand over cold.
Four tiers, ordered by what they unblock rather than by effort.

### Tier 1 — blocks a whole screen from being started

**Item 1: `qa_tier2` strips the per-sub metric arrays. — ✅ LANDED (seestar-mcp, 2026-08-02).**

This was the long pole. The Review & QA screen is *made of* per-sub charts — eccentricity, FWHM,
SNR and star count across every frame — and `_compact_report` removed exactly those arrays before
the payload left. Nothing partial could be built in the meantime.

`_compact_report` now returns them deliberately: *"the arrays are computed for the verdicts
anyway — dropping them here discarded the only copy."* Confirmed against a real payload, not the
note: `web/src/api/tier2.test.ts` parses `fixtures/qa_tier2.subs.json` (25 real subs, 12 PASS /
7 MARGINAL / 6 REJECT) through `Tier2Schema`. **The screen is unblocked and the schema exists.**

That also closes the contract loop on their `qa_tier2` pins, which had been written against our
prose since round 3 with neither side able to call them validated.

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

- ~~**Item 7** — `median_fwhm` is `null` on every session record.~~ **Diagnosed and shipped
  2026-07-31, and our guess was wrong.** Not a write-path bug: `log_session_result` takes it as an
  optional parameter defaulting to `None` and no caller ever passes it — nor *can* one, because
  Tier-2 scores FITS in the local directory and so needs `download_subs`, which the run-books forbid
  mid-session. The write path was fine; nothing called it with a value. Now backfilled from the
  newest QA report. **Treat it as nullable forever** — a session never scored still cannot report
  one, and pre-fix records are not backfilled.
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

> **Shipped 2026-07-31.** `qa_tier2` now returns `subs[].metrics` — `star_count`, `fwhm`, `hfr`,
> `eccentricity`, `snr`, `background`, `scattered_light`, each nullable, with `metrics.error` set
> when a sub could not be analyzed. Verified at source: `_compact_report` now carries
> `"metrics": _compact_metrics(v.metrics)`. Measured payload from the built code: 298 B/PASS sub,
> 320 B/REJECT — ~412 KB at 1400 subs, well within budget. The Review & QA screen's sidecar half is
> built against this (docs/superpowers/specs/2026-07-31-slice-4-review-qa.md).
>
> **This did not fully unblock the screen — three follow-on gaps, below, are why "Option A" (an
> on-demand, cached analysis triggered by the client) was needed instead of a direct passthrough.**
> They are items 1a/1b/1c in that spec and are restated as their own hand-back asks here: **23**,
> **24**, **25**.

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

> **Reinforced 2026-07-31 by user feedback**, with a worked example. The user asked whether M15 is
> in the sweet band all night, and said that where a target falls outside it the timeline should
> show the design's line treatment for that stretch.
>
> Checked against live data. **M15 peaks under the 60° ceiling**, so it genuinely is in
> the band for its whole pass, and its bar is correct. But tonight's plan also contains **M13**, M76 and
> M103, all of which climb out of the band around transit.
>
> M13 is the clear case, and the server is entirely right about it: `transits_above_ceiling: true`,
> `best_window_utc` starting **after transit** — the span correctly begins only
> once the target has descended back below the ceiling. The gap between `dark_minutes_above_floor` and
> `dark_minutes_in_sweet_band` puts **about an hour above the floor but too high to use**.
>
> So the numbers are correct and the *timeline cannot express them*. Those minutes render as
> bare track — visually identical to the target being below the horizon. A user reasonably reads
> the gap as "not up yet" when it actually means "up, but rotating too fast to use", which is a
> completely different reason and points at a different decision.
>
> Two things follow. The rail needs this item's start/end timestamps, as already asked. But
> **`transits_above_ceiling` and the above-floor/sweet-band minute gap are both already returned**,
> so the dashboard can say *that* a target leaves the band and *for how long*, even before it can
> show *when*. That is being built now as an interim.

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

> **Strengthened 2026-07-30**, after building a read-only activity feed against the real log.
> The problem is worse than "no client id" — measured against all 691 records plus a trace of
> `alpaca_client.py`'s call graph.
>
> **Most read tools never appear in the log under their own names at all.** Of the six read-only
> tools the Live screen uses:
>
> | Tool | Appears as itself? |
> |---|---|
> | `get_view_state` | **never** |
> | `get_status` | **never** |
> | `get_focuser_position` | **never** |
> | `qa_tier1` | **never** |
> | `check_night_guardrails` | yes |
> | `get_target_observability` | yes |
>
> What appears instead is the native layer: **278 records of `alpaca.put.action`**, plus
> `alpaca.get.<property>` tags. `invoke_action()` hardcodes the string `"alpaca.put.action"`
> whichever native method actually ran — so the log cannot say *what happened*, not merely
> *who did it*.
>
> This defeats the obvious workaround. A client can reason "a tool I have no route for cannot be
> mine" — but because its own calls fan out and log under different names, that rule classifies the
> dashboard's own traffic as the agent's. **The inference fails in exactly the direction that
> matters**, confidently attributing our own polling to Claude.
>
> The dashboard ships a supplementary tag set to compensate, and it is the one piece of that
> codebase which cannot be kept correct mechanically: it hardcodes a mirror of *this* repo's
> internal call graph, in another repo, maintained by another session. Add a native call anywhere
> and the dashboard silently starts misattributing again, with nothing to catch it.
>
> **Three corrections from the server team, 2026-07-31 — all three are ours, and one changes the ask.**
>
> **The count was three, not four.** `qa_tier1` *does* log, as **`qa_tier1.poll`** — 9 records. My
> check used an exact-name match, so a suffixed tag read as absent. The three that genuinely never
> appear under their own names are `get_view_state`, `get_status` and `get_focuser_position`.
> Anyone building a filter on this should expect the suffix. **Our own classifier had it right** —
> `qa_tier1.poll` is in its tag set and classifies as `ambiguous`; only this write-up was wrong.
>
> **`response_code` already exists**, on transport records. Asking for it as new was wrong: it is
> the *name* that is lost between layers, not the outcome. Withdrawn as a request.
>
> **`elapsed_ms` is deliberately absent from tool-layer records, and that is correct.** Most tool
> records are written **before** the work runs, so a duration there would be fabricated. It lives on
> transport records, where the time actually goes. **We do not need end-to-end tool duration** — no
> current or specified surface uses it, and no number is better than one that does not mean what it
> says. Withdrawn; please do not make that change on our account.
>
> A consequence worth recording, which I should have inferred from the same fact: because tool
> records are written on entry, **the timestamps in our activity feed are call-start times, not
> completions.** A slow call appears at the moment it began.

> **So the ask, after those corrections, is one thing:** a stable client identifier per record.
> The tool-tag point stands as a separate, smaller observation — `invoke_action()` logging a fixed
> `alpaca.put.action` means the log cannot say which native method ran — but it is not blocking us,
> and `response_code` and `elapsed_ms` are both withdrawn. With a client id, the compensating tag
> set can be deleted outright.

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

## 17. `check_night_guardrails` returns a verdict but not the checks behind it

**Affects:** the guardrails card on the Live session screen (design README, Screen 2, ~line 452).

**Found 2026-07-30** building that card.

The tool returns a flat verdict:

```json
{ "ok": true, "proceed": true, "action": "continue", "reasons": [], "hard_stops": [] }
```

The design shows five named rows, each with its own dot and value — Dawn `2 h 31 m of margin`,
Battery `61% · ~3 h 40 m`, Weather `go · 6% cloud, no precip`, Connection `bridge + scope verified`,
Max duration `3 h 12 m of 6 h`.

**Those five checks demonstrably happen** — the tool evaluates each to reach its verdict — but only
the verdict and some freeform prose come back. Building the card as designed would mean parsing
`reasons[]` to reverse-engineer which check produced which string, and then assigning each a
pass/marginal tone the server never asserted. That is the same thing the QA policy forbids for sub
quality: *the UI renders verdicts, it never computes or re-derives them.* So the card renders the
verdict and the reasons as given, and the five-row breakdown is simply absent.

**Asked for:** the per-check results as structured data — a list of `{check, state, detail}` or
equivalent — alongside the existing verdict. `reasons[]` and `hard_stops[]` can stay exactly as they
are; this is additive.

**Related:** the same shape as items 3, 13 and 14 — a quantity the server computes, mentions in
prose, and does not return as a field.

---

## 18. No instantaneous altitude or azimuth for the observing target

**Affects:** the sweet-band gauge on the Live session screen (design README, ~line 437).

**Found 2026-07-30.**

The design's gauge marks where the target *is right now* against the band: a bar at the current
altitude labelled `current 54.2° · az 168.4°`, between the `60°` rotation ceiling and the `25°`
floor. That live marker is the entire point of the gauge — it answers "how long have I got?".

`get_target_observability` returns **nightly aggregates** — `max_alt_deg`, `transit_utc`,
`rise_utc`, `set_utc`, sweet-band minutes. Nothing instantaneous. `get_status` returns RA/Dec
pointing, not alt/az.

The dashboard could compute it: RA/Dec plus the site's coordinates plus the time is deterministic
astronomy with no policy in it. **It deliberately does not**, because an error would misplace the
marker relative to the band, and "is this target still in the sweet band" is exactly the judgement
the gauge exists to convey. The band edges themselves are already available — `min_altitude_deg`
and `field_rotation_ceiling_deg` are on the site profile — so only the current position is missing.

**Asked for:** current `alt_deg` / `az_deg` for the active target, on `get_status` or
`get_view_state`, whichever is the more natural home. The server already does this arithmetic in
the ranker.

---

## 19. Battery has no read-only route at all

**Affects:** the Battery row of the guardrails card, and the top bar's `batt 61%` session fact.

**Found 2026-07-30.**

> **Superseded in part (2026-08-02).** The "battery is not in `get_device_state`" claim below came
> from a seestar-mcp docstring that was **wrong**, and we inherited the error. Battery *is* there,
> at `result.pi_status.battery_capacity`. They have removed the redundant native `pi_get_info` from
> `check_night_guardrails` — the 610 wasted round-trips measured in our own session — and corrected
> the docstring. The item itself stands: the percentage still does not surface on a read-only tool.

`pi_get_info` is **not an MCP tool** — there is no `@mcp.tool()` wrapper for it anywhere.
`check_night_guardrails` calls it natively and uses the battery level to reach its verdict, but the
percentage never surfaces. Battery is also confirmed *not* to be in `get_device_state`; reading it
from there previously caused false "battery unknown" guardrail trips server-side.

So a value the guardrails logic depends on cannot be displayed at all, and the design shows it in
two places.

> **WITHDRAWN 2026-07-31 — our premise was wrong, and the real answer is cheaper.**
>
> This item said battery was "confirmed *not* to be in `get_device_state`". That came from our own
> reference notes, which had been wrong since 2026-07-12 — and self-contradictory, listing
> `pi_status.battery_capacity` under `get_device_state` while asserting it was absent.
>
> **Battery is in `get_device_state`**, nested at `pi_status.battery_capacity` — 8 occurrences in a
> real bridge log against 4 under `pi_get_info`. The original diagnosis found it absent from the
> *top level* and wrongly concluded it was absent altogether.
>
> So no new accessor is needed. Battery folds into item 17's per-check results from a call already
> being made, which also removes a redundant device round-trip per guardrail check — and guardrails
> now run roughly every 10 minutes inside a slot, so that saving is real.
>
> Corrected in our notes at source so it cannot propagate again.

**Asked for:** a read-only accessor exposing the battery percentage and charger status — either a
thin `pi_get_info` wrapper, or the value folded into item 17's per-check results, which would
answer both at once.

---

## 20. No way to learn when the current session started

**Affects:** elapsed-time on the Live screen's target header, and the Max-duration guardrail.

**Found 2026-07-30.**

`check_night_guardrails` takes a `session_start_utc` argument, and nothing in the tool surface
returns one. The dashboard therefore has to supply a value it does not know.

The current workaround is to time from **when this client started watching**, which is right only
if the dashboard was open before the session began. Connect mid-session and the elapsed figure —
and with it the Max-duration guardrail, which governs a hard stop — **understates the truth**. A
guardrail that reads "3 h 12 m of 6 h" when the real answer is five hours is worse than one that
admits it does not know.

The server knows: a session has a start, and `SessionManifest` already carries a `session_id`.

**Asked for:** expose the current session's start time on a read-only tool — `get_view_state` or
`get_status` would both be reasonable — so a client can report elapsed time correctly however late
it connects, and pass a truthful `session_start_utc` back into the guardrail check.

**✅ ANSWERED (seestar-mcp `main @ b6f3d60`, 2026-08-02) — `get_run_state`, the 34th tool.**

Built to the shape agreed in round 4, and it answers more than this item asked for:

```
{ ok, state: "active" | "idle" | "unknown", stamped_utc, run: {…} | null }
run: { session_start_utc, target, slot_ends_utc, park_deadline_utc,
       targets_remaining?, resolved_id? }
```

`run.session_start_utc` is the real answer to this item — we can stop timing from browser-open.
The tri-state is the one we argued for: `unknown` is distinct from `idle` and **must not be read
as "the scope is free"**; a corrupt file reads `unknown`, never `idle`. `targets_remaining` and
`resolved_id` are *omitted* when unknown rather than nulled or emptied, and `resolved_id` appears
only when `find_target()` actually resolved the string — which is the disambiguation we asked for
after finding `Veil Nebula East` and `Veil Nebula West` both fold to `Veil`. Timestamps are
offset-bearing. Staleness threshold is theirs, currently 15 minutes.

**Still to do on our side:** allowlist `get_run_state`, add its schema, drop the
`get_view_state`-timeout inference for "is a run in progress", and stop faking the session start.

---

## 21. The hourly weather series is fetched, reduced to a maximum, and discarded

**Affects:** a requested cloud/precipitation band under the Tonight verdict card — and, more
seriously, the honesty of the single `cloud_cover_pct` figure already on screen.

**Raised 2026-07-31**, from direct user feedback:

> *"I still have to check my phone to see if it's going to rain or whether cloud cover will
> appear later in the evening and if it's only temporary."*

That is the dashboard failing at its stated job. The user opens it to avoid opening something
else, and for weather they still reach for the phone.

**The data is already in the process.** `planning/weather.py` requests hourly arrays —
`cloudcover_low`, `cloudcover_mid`, `cloudcover_high`, `precipitation_probability`
(`_HOURLY_VARS`, ~line 44) — and `_window_rows()` (line 109) selects the rows inside the dark
window. Those per-hour values are then collapsed to a single worst-case number and thrown away.
`ConditionsAssessment` exposes one `cloud_cover_pct`, documented as *"the worst-case cloud over
the dark window: the max"*.

**A maximum cannot answer the question that matters.** `cloud 86%` is the same figure whether the
night is solidly overcast or clear until 02:00 with one bad hour. Those are completely different
nights — one is a write-off, the other is a four-hour session with a late start — and the current
payload cannot distinguish them. So the figure is not merely incomplete; it makes a recoverable
night look identical to a lost one.

**Asked for:** the per-hour series over the dark window, alongside the existing aggregates —
timestamps plus cloud and precipitation probability per hour. `cloud_cover_pct` and the `go`
verdict stay exactly as they are; this is additive.

With it the dashboard can render a band showing when cloud arrives, how long it lasts and whether
it clears — which is the actual decision the user is making. Without it, no amount of UI work can
show the shape of the night, because the shape has already been averaged away before it leaves the
server.

**Related:** the same pattern as items 3, 13, 14, 17, 18 and 20, and the largest instance of it —
here an entire time series is reduced to one scalar.

---

## 22. The moon penalty ignores whether the target is narrowband

**Affects:** the ranking of every emission target on a bright night — which, near full moon, is
most of what is actually worth shooting.

**Raised 2026-07-31**, from user feedback: *"we want to factor in those LP objects when moonlight
is strong to the score."*

`ranker.py:121`:

```python
moon_term = min(1.0, obs.moon_sep_deg / 90.0) * (1.0 - 0.5 * obs.moon_illum_frac)
```

The term is a function of moon separation and illumination only. **It is identical for a dual-band
emission nebula and a broadband galaxy**, and that is not how the physics works: a dual-band filter
passes Hα/OIII and rejects most of the moon's scattered broadband light. Under a bright moon a
narrowband target is often the *right* answer, while a faint galaxy is hopeless. The ranker
currently penalises both equally and so ranks them as though the moon affected them the same way.

Tonight makes it concrete: the moon is **98% illuminated**, so `(1.0 - 0.5 × 0.98) = 0.51` — every
target's moon term is roughly halved regardless of whether a filter would recover it.

**The classification is already in the function, one line earlier.** Line 120 computes
`lp_fit = lp_suitability(target.type, bortle_for(site))`, and `LP_MODEL` already sorts every target
type into `narrowband` / `broadband` / `robust` / `neutral`. So this is not new knowledge or a new
input — it is applying a value the function already holds to the term immediately below it.

**Asked for:** let the moon penalty depend on that same classification, so narrowband targets take
a reduced hit as moon illumination rises.

**The shape and the numbers are yours, not ours.** This is scoring policy, the same as item 11's
feasibility term — we are naming a factor the model does not currently account for, not proposing
a weight. Two things worth deciding along the way:

- Whether it belongs in `moon_term` or as a separate interaction, given `W_LP_FIT` already scores
  the LP dimension on its own and double-counting is a real risk.
- Whether separation should also be modulated, or only illumination. A narrowband filter helps with
  scattered skyglow; it does less for a target sitting a few degrees off the lunar disc.

**Please show the model before adopting it**, as you offered for item 11 — a change here reorders
the plan on exactly the nights the user most needs it to be right.

**Related:** item 14 (`lp_class` on ranked targets) is the display half of the same fact. The user
also wants the design's `LP on` / `LP off` chip back on the Tonight cards, which that item covers —
so 14 and this are the same classification surfacing in two places.

---

## 23. No read-only access to the live accumulating stack

**Affects:** the Live session screen's preview — the single feature the user named as the reason
that screen exists.

**Raised 2026-07-31**, from watching a real session end to end.

> *"the main thing is to see the current visual of the camera so I'm not having to go into the
> seestar app"*

The dashboard now shows the **latest 10-second sub**, pulled from the scope's share seconds after
capture. That is genuinely the current camera view, and it works. But it is a single raw
sub-exposure: dark, noisy, and nothing like the accumulating stack the vendor app displays — which
is what a person actually wants to look at.

**Established on hardware, twice in one session (at 37 and 141 stacked frames): the scope writes
the stacked master exactly once, at session end.** `<target>/Stacked_<N>_..._<timestamp>.jpg`
appears with the final frame count baked into the name; nothing intermediate is ever written. So
mid-session the only stack on the share is the *previous* session's — tonight, a 12 July image
while the scope stacked tonight's frames on the same object.

The vendor app clearly has the live stack, so the device produces it. Investigation found it is
served over a **binary live-stack stream (ports 4800/4804)** alongside RTSP — reverse-engineered,
unwrapped by anything in this stack, and continuous rather than pollable.

**We are deliberately not building a client for it.** Putting a reverse-engineered raw protocol in
the dashboard would violate `seestar-mcp`'s own "confine the fragile surface to one place" rule,
and it is exactly the kind of thing that belongs behind the tool boundary rather than in a browser
client. It is also the wrong shape: a continuous stream feeding an interval fetch.

**Asked for:** a read-only accessor returning the current live stack as an image — the same picture
the vendor app shows. Shape is yours; a JPEG of the current stack, with the frame count it
represents, is all the dashboard needs.

Two notes on cost, since the traffic hazard is real and we have measured it:

- The dashboard already polls a **15 KB** sub thumbnail on a slow interval, which is a trickle.
  Whatever this returns should be similarly modest — a preview-sized JPEG, not a full-resolution
  master.
- The share-side numbers for reference: a per-sub thumbnail is 15.3 KB, a stacked thumbnail 14.7 KB,
  a full stacked JPEG 476–730 KB, and a sub FITS 4,056 KB.

**Until it exists** the dashboard shows the live sub, plus a clearly-dated "last completed stack"
panel beneath it built from the share. That is honest and useful, but it is a workaround for a
picture the device already has.
## 24. No read-only getter for a written QA report

**Affects:** the Review & QA screen's data cost — this is why slice 4 had to build an on-demand,
client-cached analysis path (Option A, docs/superpowers/specs/2026-07-31-slice-4-review-qa.md §1)
instead of simply reading back what a session already scored.

**Verified 2026-07-31: there are zero `qa_report*.json` artifacts anywhere in the server's data
directory.** So even where this getter to exist, there is currently nothing for it to read — but
that's a separate, encouraging fact (nothing here is corrupted or lost; sessions simply have not
been wound down with `qa_session_report` yet on this installation).

`qa_session_report` **cannot** stand in for this: it writes a JSON+MD report and a manifest and
winds down the session, so a dashboard calling it to display results would generate artifacts and
end the session on every page refresh — ruled out outright by this repo's `CLAUDE.md`.

**Asked for:** a read-only `get_session_report(target, date)` (or similar) that reads back an
already-written report from `reports/qa_report_<slug>-<timestamp>.json` without re-scoring anything
or touching the manifest/session state. With it, option B in the slice-4 spec (`§1`) replaces the
dashboard's own on-disk cache outright, and the expensive photutils pass runs once, server-side,
exactly where it already runs today for `qa_session_report`.

---

## 25. `qa_tier2`'s `_resolve_paths` cannot see the real archive layout

**Affects:** the same screen — this is the other reason slice 4 resolves paths itself rather than
calling `qa_tier2(target=...)` directly.

`_resolve_paths` (`server.py:463`) globs `self.settings.data_dir` **non-recursively** for
`*.fit`/`*.fits`. The user's real archive is nested one level down per target —
`…/SeeStar/<Target>_sub/Light_*.fit` (or `<Target>-sub/`, both conventions seen live) — so a bare
`qa_tier2(target="M31")` against that layout matches nothing; the glob never descends into
`<Target>_sub/`.

It does accept explicit `paths`, which is what the sidecar now does — resolving a target to its
FITS files from its own archive scan (`sidecar/seestar_sidecar/archive.py`, which already handles
both directory-naming conventions) and passing them in directly.

**Asked for:** a recursive option for `_resolve_paths` — `sorted(data_dir.rglob(pattern))` in place
of `data_dir.glob(pattern)`, or a documented `<target>[-_]sub/` convention it walks explicitly —
would make the `target` argument actually usable against a real archive, rather than only ever
working via explicit `paths`.

---

## 26. `qa_tier2`'s own docstring says it strips metrics it no longer strips

**Affects:** nothing on screen — a documentation-only item, raised because the server team's own
closing note on item 10 applies here too: *"a comment is evidence about what someone believed, not
about what the code does."*

`qa_tier2`'s docstring at `server.py:511` (the controller method) still reads:

> *"Returns a compact per-sub verdict summary + keep-list; does not dump full metrics for every
> sub."*

That was true before item 1 shipped and is no longer true now: `_compact_report` does include
`metrics` per sub today (verified at source, and directly exercised by slice 4's tests against a
real recorded payload). The `@mcp.tool()` wrapper's own docstring at `server.py:1598` was already
updated to match; only the controller method's copy was missed.

**Asked for:** drop the "does not dump full metrics" clause from the controller method's docstring
— one line, no behaviour change.

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
| 16 | Site profile has coordinates but no IANA timezone | Every clock on Tonight; a browser away from the mount cannot know its times differ from the site's | No — needs a user-supplied field |
| 17 | `check_night_guardrails` returns the verdict but not the five checks behind it | The guardrails card's per-check rows on Live | Yes — each check is evaluated to reach the verdict |
| 18 | No instantaneous alt/az for the active target | The sweet-band gauge's current-position marker on Live | Yes — the ranker already does this arithmetic |
| 19 | Battery has no read-only route (`pi_get_info` is not a tool) | Guardrails Battery row; top-bar `batt` fact | Yes — the guardrail logic reads it natively to decide |
| 20 | No way to learn when the current session started | Elapsed time on Live; the Max-duration guardrail understates on a mid-session connect | Yes — the session has a start and `SessionManifest` carries an id |
| 16 | `SiteProfile` has coordinates but no IANA timezone | Every clock on Tonight can name the browser's own zone but not the site's, or detect whether the two agree | No — nothing computes or stores one today |
| 23 | No read-only getter for a written QA report | Forces the Review screen's on-demand client cache (Option A) instead of reading back a real report | No — `qa_session_report` writes reports today, but nothing reads them back |
| 24 | `_resolve_paths` is non-recursive | `qa_tier2(target=...)` cannot see the real, nested archive layout | No — needs a recursive glob or a documented sub-dir convention |
| 25 | `qa_tier2`'s controller-method docstring is stale | Nothing on screen — documentation only | N/A — one-line docstring fix, no behaviour change |

Items 2–5 and 9 **degrade** the Tonight screen rather than block it; the dashboard renders an
explicit absent state for each rather than a plausible-looking placeholder, so nothing on screen is
a lie. Item 1 **blocks** the Review screen outright. Item 7 may indicate a real server-side defect.
Item 10 blocks slice 5. Item 11 is the only one that degrades a tool the *agent* uses rather than
just the dashboard — the ranker's blind spot is the user's most-imaged object. Item 16 likewise
degrades rather than blocks: the dashboard now states the zone it *can* name honestly instead of the
ambiguous "local", it just cannot yet name the site's.
