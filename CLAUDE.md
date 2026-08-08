# SeeStar Dashboard — web client for the seestar-mcp tools

A web dashboard that **reads** the SeeStar telescope's state and QA results and
presents them. It accompanies the `seestar-mcp` server + Skills that live in
`C:\Users\<user>\SeeStar-AI` — it does not modify them.

Bootstrapped from Command Center on 2026-07-27 as a **separate session** on the
Claude Design agent's recommendation: the SeeStar-AI session carries the whole
skill-authoring history, and a session deep in skill-authoring context reaches
for skill edits when the actual work here is a frontend plus a thin read layer.

## Scope — what this repo is, and is not

**Is:** a frontend + a thin read layer over the seestar-mcp tools.

**Is not:** the MCP server, the Skills, or the QA engine. Those live in
`SeeStar-AI` and are worked on in *that* session.

### The hand-back rule (important)

If a screen needs data the tools don't currently return — per-sub metric arrays
for an eccentricity chart, project progress in a single call, a read-only report
fetch — that is a **server/skill change** and belongs in the **SeeStar-AI
session**, not here. Write down what's missing and hand it back; do not work
around it by re-implementing server logic in the UI.

## The data source

Tools are defined in `SeeStar-AI/src/seestar_mcp/server.py` (FastMCP,
`@mcp.tool()` wrappers near the bottom of the file).

**Read-only — safe to call on page load / refresh:**

| Tool | Returns |
|---|---|
| `get_view_state` | live view/stacking telemetry (stack count, rejected count, plate-solve state, focus) |
| `get_status` | connection, RA/Dec pointing, tracking/slewing state |
| `list_projects` / `get_project` | observing projects and their goals |
| `list_subs` | the subs captured for a target |
| `get_site_profile` | site position, Bortle, horizon mask |

**⚠️ NOT read-only — never call these from the UI on load:**
`qa_session_report`, `goto_target`, `start_stack`, `stop_view`, `park`,
`shutdown`, `run_autofocus`, `set_filter`, `set_dew_heater`, `set_project_goal`,
`add_horizon_mask`.

`qa_session_report` in particular **writes a JSON+MD report and a manifest and
winds down the session**. A dashboard that calls it to render QA results would
generate artifacts on every refresh.

**Known gap (verified 2026-07-27):** there is **no read-only tool that fetches an
already-written report**. Displaying QA results therefore needs either (a)
reading the report artifacts `qa_session_report` previously wrote, or (b) a new
read-only getter added to the MCP server — which is a **SeeStar-AI session**
change under the hand-back rule.

## Verdict thresholds are NOT the UI's business

The QA verdict vocabulary is **PASS / MARGINAL / REJECT**. Those verdicts and the
thresholds behind them are owned by the server:

- `SeeStar-AI/src/seestar_mcp/config.py` — the numbers
- `docs/qa-policy-SKILL.md` (copied here for reference) — the policy and how to
  explain a verdict

**Most of these are session-relative, not constants** — they are computed from
the session's own median and sigma, so they differ per target and per night.
That is why `qa_tier2` returns a `thresholds` object alongside the verdicts,
and why the chart draws its cutoff lines from *that* rather than from anything
written here. Current shape of the policy, for display context only:

| Metric | REJECT | MARGINAL |
|---|---|---|
| Eccentricity | ≥ 0.575 (canonical PixInsight cutoff — the one fixed line) | session-relative: `min(max(median + 1.0σ, 0.42), 0.575)` |
| FWHM | > median + 1.5σ | median + 1.0σ … + 1.5σ |
| SNR | < median × 0.5 | — |
| Star count | < 50% of session median (cloud signal) | — |
| Scatter | > median + 2.0σ | > median + 1.0σ |

The eccentricity MARGINAL line **was** a flat 0.42 and stopped being one in
contract 1.1.0. `0.42` survives as a perceptibility *floor*, not the cutoff:
an alt-az rig baselines near 0.49, so measured over 970 real subs the flat
constant graded 96.5% of a good night MARGINAL. Contract 1.1.1 then guaranteed
the derived value is finite and never above the REJECT line, which is what lets
`MetricChart` draw both lines without checking their order.

A stale copy of these numbers in the client is exactly the failure this section
exists to prevent, so **read `summary.thresholds` off the payload** and treat
the table above as orientation, never as a source.

**The UI renders verdicts; it never computes or re-derives them, and never
hardcodes these numbers.** A sub is PASS only if it clears everything; any single
REJECT trigger rejects it. If a threshold needs changing, that's a `config.py`
change in the SeeStar-AI session.

Every verdict shown should stay traceable to a metric and a threshold — the
policy's standard is "an auditable, defensible quality verdict, never a vibe",
e.g. *"REJECT — eccentricity 0.61 ≥ 0.575 cutoff (tracking error)."* Keep that
legible in the UI rather than reducing it to a colour.

## Reference material in `docs/`

- `qa-policy-SKILL.md` — the QA policy skill, verbatim from SeeStar-AI.
- `seestar-mcp-design.md` — the original system design (architecture, the
  Jetson/Alpaca stack, QA tiers). Background; the dashboard is not in it.

- `design/` — the Claude Design handoff for the SeeStar Console (landed
  2026-07-27). `design/README.md` is the authority on tokens, per-screen specs
  and copy; `design/github.md` is the screen→source map. `Seestar Console.dc.html`
  is the prototype — open it in a browser to interact with it, but **do not port
  `support.js`**; it is a design-tool runtime, not production code.
- `superpowers/specs/` — approved design specs, one per slice.
- `handback-to-seestar-ai.md` — the running list of server-side gaps this repo
  cannot fix under the hand-back rule.

## Conventions

- **Stack (decided 2026-07-27):** React + TypeScript + Vite, Vitest for the gate.
  Python + FastAPI for the sidecar. **No charting
  library** — the sweet-band timeline and the per-sub charts are
  absolutely-positioned and flex-div bars driven by the token table; a chart lib
  fights both. Reconsider only if a screen needs axes/scales these don't cover.
- The sidecar exposes MCP tools over HTTP behind a **route allowlist**: a tool
  with side effects has no route at all. Never add one to make a screen easier.
- Add a real test gate early; this repo is a candidate for orchestrated
  refinement, which requires a fast deterministic gate. The gate as it stands
  is `npm test` + `npm run build` in `web/` and `uv run pytest` in `sidecar/`.
  **`npx tsc --noEmit` checks nothing here** — the root `tsconfig.json` is a
  solution file with `"files": []`, so it exits 0 having read no source. Use
  `tsc -b`, which `npm run build` already runs.
- **Playwright was planned for slice 2 and never adopted.** Slices 1–4 shipped
  without it; browser behaviour is verified by hand instead. Worth knowing
  before writing a plan that assumes an e2e layer exists — there is none, so
  **no test in this repo asserts anything about layout at a given viewport.**
  All four phone layouts were checked by hand at 393×852 on 2026-08-08 and
  render correctly; that is a snapshot of one afternoon, not a standing
  guarantee, and nothing will tell you when it stops being true.
  - Resizing the browser window through the automation tooling has failed
    every time it has been tried (it reports success while `innerWidth` does
    not change). Rendering the app in a same-origin `<iframe>` sized to
    393×852 does work — media queries key off the iframe's own viewport — and
    is how those checks were done.
- Never commit secrets. SeeStar-AI uses age+sops (`.env.enc` committable, key
  never leaves the machine) — follow the same pattern if secrets appear.
