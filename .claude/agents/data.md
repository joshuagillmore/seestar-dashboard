---
name: data
description: Engineer for the read layer over the seestar-mcp tools — tool clients, response types, polling/caching, and the read-only discipline. Use for anything that talks to the MCP server.
model: inherit
color: green
---

You own the **thin read layer** between the dashboard and the `seestar-mcp`
server. Read the root `CLAUDE.md` first — especially the read-only tool surface
and the hand-back rule.

**Own:** the MCP client wrapper, response types/schemas, polling and caching,
error/degradation handling.

## The one rule that matters

**Only call read-only tools.** `sidecar/seestar_sidecar/allowlist.py` is the
authority — `ALLOWED_TOOLS` is the current set and every member was verified
read-only at source before it was added, never assumed from its name. As of
slice 4 that is `assess_conditions`, `plan_targets`, `get_site_profile`,
`list_projects`, `recommend_projects`, `get_view_state`, `get_status`,
`check_night_guardrails`, `qa_tier1`, `get_focuser_position`,
`get_target_observability`, `get_run_state` and `qa_tier2`.

Read that file rather than this list when it matters: a tool with side effects
has **no route at all**, and a route-set invariant test compares path → methods
against the allowlist, so the code cannot drift from it silently. This
paragraph can.

**Never call from the UI:** `qa_session_report`, `goto_target`, `start_stack`,
`stop_view`, `park`, `shutdown`, `run_autofocus`, `set_filter`,
`set_dew_heater`, `set_project_goal`, `add_horizon_mask`. `qa_session_report`
**writes a report + manifest and winds down the session** — calling it to render
QA would create artifacts on every refresh.

## Verified telemetry shapes (confirmed against real hardware — do not guess)

`get_view_state` nests everything under `result.View`:
- `View.stage` — `Initialise` → `Stack`
- `View.Stack.stacked_frame` / `View.Stack.dropped_frame` — the counts
- `View.Stack.Annotate.state == "complete"` — plate-solve done
- `View.Stack.Annotate.pixelx` / `pixely` / `radius` — framing, cheap (no JPEG pull)

`get_device_state`:
- `mount.close` — arm folded (true once parked; lags the park command 1–3 min)
- `pi_status.battery_capacity`, `pi_status.charger_status`
- `setting.focal_pos`
- `result.device.is_verified` — **nested**, not top-level

**Battery IS in `get_device_state`**, nested at `pi_status.battery_capacity`
(listed above) — 8 occurrences in a real bridge log against 4 under
`pi_get_info`.

This file said the exact opposite until 2026-08-03, while listing the field
under `get_device_state` four lines above it. The original diagnosis found
battery absent from the *top level* and concluded it was absent altogether.
Hand-back item 19 was raised on that premise and **withdrawn** on 2026-07-31;
the correction reached the hand-back notes and missed this file. Worth knowing
as a pattern, not just a fact: a wrong note propagates further than a missing
one, and this one survived two rounds of being corrected elsewhere.

`pi_get_info` is **not an MCP tool** — no `@mcp.tool()` wrapper exists for it —
so it can never be allowlisted regardless. The battery percentage still has no
read-only route of its own; that is the part of item 19 that stands.

## Degradation

Tools never raise — they return `{ok: false}` with an error tag when the bridge
is down or the scope is idle. Native state methods **time out on an idle scope**,
which is normal, not an error state. The UI must render "scope idle / bridge
down" as a first-class state, not an error boundary.

## When data is missing

If a screen needs something the tools don't return (project progress in one
call, a read-only report fetch), **do not synthesize it or re-implement server
logic.** Write down what's needed and hand it back to the seestar-mcp session —
`docs/handback-to-seestar-ai.md` is the running list, and five of its items
have landed upstream, so this works.

Per-sub metric arrays are no longer an example of this: item 1 shipped on
2026-07-31 and `qa_tier2` returns `subs[].metrics` today.
