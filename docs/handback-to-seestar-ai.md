# Hand-back to the SeeStar-AI session

Server-side gaps found while building the SeeStar Console dashboard. Under the hand-back rule in
this repo's `CLAUDE.md`, none of these can be fixed here — working around them in the UI would
mean re-implementing server logic in the client, which is exactly what the rule forbids.

**Found:** 2026-07-27 to 2026-07-28, by reading `src/seestar_mcp/` and calling the read-only tools live against
the current installation (Example Observatory, Bortle 8).

**The encouraging part:** eight of the nine values below are *already computed inside the
server* — they are simply not in the returned payload. Most of these are a dataclass field and a
line in a return dict, not new logic.

Line references are to `OrangeAgente/SeeStar-AI` @ `main` as of 2026-07-27.

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

## 8. No tool returns target imagery

**Affects:** the 64×88 thumbnails on Tonight plan cards, the 96px project covers, the Live preview
image, and the Review master image.

The design's five reference JPEGs are stand-ins the user supplied. In production the handoff notes
these "come from the scope's own storage," but no tool exposes them.

**Asked for:** a read-only path to stacked previews — either a tool returning a path/URL per
target, or a documented on-disk convention the sidecar can serve from. The S50 export naming
(`Stacked_<target>_<exposure>_<filter>_<timestamp>[_thn].jpg`) already encodes what's needed to
match an image to a target.

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
| 8 | No target imagery | All thumbnails | No |
| 9 | Only the longest sweet-band span returned | Fragmented-band rendering; ranker figure and chart disagree | Yes — the mask exists, `_longest_run` is one reduction over it |

Items 2–5 and 9 **degrade** the Tonight screen rather than block it; the dashboard renders an
explicit absent state for each rather than a plausible-looking placeholder, so nothing on screen is
a lie. Item 1 **blocks** the Review screen outright. Item 7 may indicate a real server-side defect.
