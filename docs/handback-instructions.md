# Work order for the seestar-mcp session

> **Status, 2026-08-03 — sections 1 and 2 are DONE; do not start them.**
>
> - **§1 (item 1), per-sub metric arrays: shipped 2026-07-31.** `_compact_report` returns
>   `subs[].metrics`, the Review & QA screen was built on it, and a 25-sub recording parses
>   through our schema. This was the blocking one; nothing blocks a screen now.
> - **§2 (item 10), provenance: both changes shipped.** `client` is unconditional on every
>   record — 217 in the live log read `"console"`, our own traffic — and `invoke_action()`
>   now names the method (`seestar.<method>`) instead of the fixed `alpaca.put.action`,
>   which stopped appearing on 2026-07-31. The four tools §2 says never appear under their
>   own names all do.
> - Also landed since this was written: item 7 (`median_fwhm`, see §5 — diagnosed, and our
>   guess was wrong), item 20 (`get_run_state`), item 26 (a stale docstring).
> - **One correction below is ours, not yours: §3 repeats "battery is confirmed not to be in
>   `get_device_state`". That is false** and item 19 was withdrawn on 2026-07-31 — see the
>   note in place there.
>
> §3 (minus the battery line), §4 and the second half of §5 are still the live work order.
> Everything else below is unchanged from what was sent.

A companion to `handback-to-seestar-ai.md`, which is the reference — the items with
evidence, file references and reasoning, deliberately not summarised by a count here since
the list has grown twice. **This document is the instruction set** — what to change, in
what order, grouped by the edit rather than by item number, because several items are one
change.

Everything here was found building the SeeStar Console dashboard against the live
installation (Example Observatory, Bortle 8). Nothing is a feature request for the dashboard's
convenience: each one is either a value the server already computes and discards, or a
defect. The dashboard ships an honest absent state for every one of them today, so nothing
is broken while you work — but five screens are showing less than they could.

**The pattern, stated once:** *if a tool names a quantity in prose, return it as a field
too.* It is the single most common shape on the list — items 3, 5, 12, 13, 14, 17, 18 and
21 are all instances, and 21 is the largest: an entire hourly weather series reduced to one
worst-case scalar before it leaves.

---

## 1. Do this first — it blocks an entire screen

### `qa_tier2` strips the per-sub metric arrays (item 1)

`_compact_report` removes the per-sub arrays — eccentricity, FWHM, SNR, star count — before
the payload leaves. The dashboard's Review & QA screen is **made of** those arrays; there is
nothing partial to build without them, so that screen cannot be started at all.

Every other item on this list degrades a screen. This one prevents one existing.

**Change:** return the per-sub metric arrays. Shape is yours; the dashboard needs per-sub
values it can chart and a stable sub identifier to key them to.

**Scale to design for** (measured on real nights, not guessed): 200–1400 subs per target,
400–1300 kept across 5–9 targets over 4–6 hours. If the full arrays are too large to return
inline, say so and we will discuss pagination — but please do not pre-aggregate them into
summary statistics, because the screen's whole purpose is showing the distribution.

---

## 2. Provenance — two changes, and the second is independently worth it

### Records cannot say who called, or what was called (item 10)

`ProvenanceLog.log_call()` already accepts `request`, `client_txn_id`, `server_txn_id`,
`response_code`, `fits_hash` and `note`. **The `@mcp.tool()` wrappers pass none of them.**
Records are bare `{ts, tool, args}`.

**Change A — a client identifier.** A stable per-process id, set once at initialise and
stamped on every `log_call`. Without it no client can tell its own traffic from the agent's.

**Change B — log the method that actually ran.** This is the part that surprised us.
`invoke_action()` hardcodes the string `"alpaca.put.action"` regardless of which native
method was invoked. Measured against a real 691-record log: **278 records of that one
string**, and four of the six read-only tools the Live screen uses — `get_view_state`,
`get_status`, `get_focuser_position`, `qa_tier1` — **never appear under their own names at
all**.

So the log currently cannot answer "what happened", quite apart from "who did it". A client
trying to infer origin from the tool name gets it backwards: its own calls fan out and log
under names outside its own allowlist.

Also cheap and useful while you are in there: `response_code`, so a failed call is visible
as failed, and elapsed time per call.

---

## 3. Return what you already compute — one batch, ~a day

These are each roughly a dataclass field plus a line in a return dict. Grouped by where the
edit lands.

### `ConditionsAssessment` — two fields (items 3 and 13)

- **`max_precip_pct: float | None`.** Precipitation is fetched from meteoblue
  (`weather.py:51`), scored on (`weather.py:153`), and gates `go` (`weather.py:54`) — then
  dropped. It reaches clients only inside a `reasons[]` string. The user has confirmed the
  source and asked that the dashboard not work around it.
- **`summary: str`.** One sentence naming the decisive factors, in the same voice as the
  existing reasons. The verdict banner leads with a headline; the dashboard will not compose
  one, because choosing which factor mattered most is a judgement about the night, not a
  rendering choice. `reasons[]` stays exactly as it is — this is additive.

### `plan_targets` — one field, closes two items (items 5 and 14)

**`lp_class`** (or your preferred name) on each ranked target: the narrowband / broadband /
robust / neutral classification `LP_MODEL` already assigns and `lp_suitability()` already
scores 20% of the rank on. It is not returned.

This answers **both** the ranked-card subtitle (`Wizard Nebula · emission`) and the
`LP on`/`LP off` filter chip — item 5 and item 14 are almost certainly one change.

The dashboard could re-derive it from `type`, and deliberately does not: that would copy
`LP_MODEL`'s mapping into the client, which drifts silently the moment the model changes.
Same reason QA thresholds are not hardcoded there.

### `check_night_guardrails` — the checks behind the verdict (items 17 and 19)

Returns `{proceed, action, reasons[], hard_stops[]}` and nothing per-check. The five checks
demonstrably run — dawn, battery, weather, connection, max duration — but only the verdict
comes back.

**Change:** the per-check results as structured data, e.g. `{check, state, detail}`.
`reasons[]` and `hard_stops[]` can stay untouched.

**This likely closes item 19 too.** Battery has no read-only route at all — `pi_get_info` is
not an MCP tool, and `check_night_guardrails` calls it natively to decide. Folding the
battery percentage into the per-check results answers both at once.

> **Correction, 2026-07-31 — ignore the sentence that used to end this paragraph.** It read
> "battery is confirmed *not* to be in `get_device_state`; reading it from there previously
> caused false 'battery unknown' trips". **Battery IS in `get_device_state`**, nested at
> `pi_status.battery_capacity` — 8 occurrences in a real bridge log against 4 under
> `pi_get_info`. Our original diagnosis found it absent from the *top level* and wrongly
> concluded it was absent altogether. So this needs no new accessor and no extra device
> round-trip: the value is already in a call the guardrail check makes. Item 19 is withdrawn
> on that basis; what stands is only that the percentage does not surface on a read-only
> tool today.

### `get_status` or `get_view_state` — two fields (items 18 and 20)

- **`alt_deg` / `az_deg`** for the active target. `get_target_observability` returns nightly
  aggregates; `get_status` returns RA/Dec. The Live screen's sweet-band gauge marks where
  the target *is now* against the band — the band edges are already available from the site
  profile, only the current position is missing. The dashboard will not compute it from
  RA/Dec: an error would misplace the marker, and "is this still in the sweet band" is
  exactly the judgement the gauge exists to convey.
- **The current session's start time.** `check_night_guardrails` takes a `session_start_utc`
  and nothing returns one, so the dashboard times from when it started watching — correct
  only if it was open before the session began. Connect mid-session and the max-duration
  guardrail, which governs a hard stop, **understates elapsed time**.

### `SiteProfile` — one field (item 16)

**`tz_name: str | None`**, user-supplied via `set_site_profile` the same way `bortle` and
`sqm` are. Coordinates do not determine a zone unambiguously near a border, and
reverse-geocoding is a real dependency for a small gain — so a field, not a computation.

Without it, a browser away from the mount cannot know its clock differs from the
telescope's. The dashboard names its own zone honestly and cannot detect the mismatch.

### `SessionRecord` — one field (item 12)

**`filter`.** It is in the session notes as prose and on every one of the 7,753 archive
filenames, but not on the record.

---

## 4. Read this before touching the catalogue (item 11)

A 12,517-object catalogue derived from OpenNGC is attached in the dashboard repo at
`data/dso_catalog_extended.json`, with a 28,804-entry alias index, generated by a committed
re-runnable script and licensed CC BY-SA 4.0 with attribution.

**Do not merge it on its own.** Two paired changes are required first, or it makes the
planner worse:

1. **Vectorise the observability computation.** Measured: the current per-target astropy
   path runs at 79 ms/target, which is **16.5 minutes per `plan_targets` call** at this size.
   A vectorised spherical-trig implementation measured 0.0033 ms/target — ~41 ms for the
   whole catalogue, max error 0.24° against astropy, which is irrelevant at the scale of a
   horizon mask.
2. **Add a brightness/feasibility term to the ranker.** Every current weight —
   `W_SWEET_BAND` 0.40, `W_LP_FIT` 0.20, `W_MOON` 0.15, `W_FIELD_ROT` 0.15, `W_FRAMING` 0.10
   — concerns *when and where* an object is, none whether the instrument can record it. Safe
   with 120 curated showpieces; **86.6% of the extension is galaxies**, and against that
   population the ranker will confidently recommend a 15th-magnitude smudge that sits high
   at midnight.

The weighting is server-side policy and not the dashboard's call — flagging the need, not
proposing a number.

Why it matters: the current 120-object catalogue is missing ten of the user's twenty archive
targets, including **IC 405, their single largest investment at 217 minutes**. The ranker is
structurally incapable of ever suggesting it.

---

## 5. Two that may be defects rather than omissions

Worth a look regardless of priority.

- ~~**`median_fwhm` is `null` on every session record** (item 7). Not some — every one. That
  looks like a write-path bug rather than a missing field.~~ **Diagnosed and shipped
  2026-07-31, and our guess was wrong** — not a write-path bug. `log_session_result` takes
  it as an optional parameter defaulting to `None` and no caller ever passed one, nor could:
  Tier-2 scores FITS in the local directory and so needs `download_subs`, which the run-books
  forbid mid-session. Now backfilled from the newest QA report. Treat it as nullable forever;
  pre-fix records are not backfilled.
- **`recommend_projects` returns an unranked list while appearing ranked** (item 15). It
  sorts by remaining minutes with open-ended projects given a sentinel "large remaining"
  (`planning/projects.py:216`). Every real project has `goal_minutes == 0`, so they all tie,
  the sort is a no-op, and the output is byte-identical to `list_projects` truncated —
  verified programmatically. Either rank on something else when goals are unset, or accept a
  goal hint. Note the dashboard cannot set goals: `set_project_goal` is a write tool its
  allowlist excludes by design.

---

## What happens on our side

Nothing is waiting on you to talk to us first — every item has an honest absent state
shipped, and most surfaces will light up when a field arrives without further UI work.

Three things we would appreciate back:

1. **Tell us if any of these is wrong.** Several findings came from tracing your source from
   outside, and we have been wrong before — a review finding of ours about a UI element that
   did not exist, and a classification rule that would have misattributed our own traffic.
   Push back rather than implementing something we described badly.
2. **Field names are yours.** Everything above names a shape, not an API. If a different
   name or home fits your code better, take it — just tell us.
3. **If item 1 is large, say so early.** It is the only thing on this list blocking a whole
   screen, and if it needs pagination or a different shape we would rather design that
   together than receive an implementation we cannot chart.
