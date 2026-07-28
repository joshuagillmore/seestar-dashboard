# Carried forward from slice 1

Twenty-five items were deliberately deferred during slice 1 and triaged by the
final whole-branch review. Everything marked must-fix was fixed before merge;
what remains is below, with the reasoning that put it here rather than in the
branch.

Nothing on this list is a defect on screen. Slice 1's rule — nothing rendered
asserts something nobody verified — holds as shipped.

## Fix in slice 2

| Item | Where | Why now |
|---|---|---|
| `isError` detail takes the first content block, not the first block *with* text | `sidecar/seestar_sidecar/mcp_proxy.py` | One line. Loses the traceback on a multi-block error — exactly when you need it. |
| `ARGUMENTS[tool]` indexed while iterating `ALLOWED_TOOLS` | `sidecar/record.py` | Slice 2 is when a tool gets allowlisted, so this fires then: a mid-loop `KeyError` with fixtures half-rewritten. A one-line `assert set(ARGUMENTS) == ALLOWED_TOOLS` makes it a pre-flight failure. |
| `SEESTAR_AI_DIR` personal-path default | `sidecar/seestar_sidecar/main.py:12`, `sidecar/record.py:16` | `main.py` reads the env var; `record.py` hardcodes the same path with no override. Fix together. |
| `call_tool`'s `connection is None` branch unexercised | `sidecar/seestar_sidecar/routes.py` | Four lines. It is the branch that fires on the first request if the lifespan never ran. |
| `verdictTone` has no dedicated test | `web/src/api/verdict.ts` | `pass`/`reject` are covered indirectly via Sidebar; `marginal` (UNKNOWN) is covered nowhere. |
| `Sidebar.test.tsx` hardcodes the GPS warning string | `web/src/shell/Sidebar.test.tsx` | Read it from `recordedConditions().location.warning`. Same staleness class the branch caught elsewhere. |
| Reason string used as React key | `web/src/screens/tonight/VerdictBanner.tsx`, `PlanCard.tsx:53` | Two files, not one. Ranker reasons are template-built, so duplicates are plausible. |
| `localHhMm` output never asserted | `web/src/screens/tonight/timeline.ts` | Every clock face on the screen goes through it. Assertable timezone-independently via an explicit `timeZone` or a `/^\d{2}:\d{2}$/` shape check. |
| **Index-based dot query will silently rot** | `web/src/screens/tonight/TonightScreen.test.tsx:92` | `getAllByTestId('dot')[0]` is the Sidebar's Tonight dot only because `TopBar` renders no dots — and `TopBar.tsx:9-21` documents that slice 3 adds them. The day that lands, this stops testing what its title says **without failing**. Fix: `within(screen.getByRole('navigation'))`. |

## Decide before slice 3

- **`Dot` API.** `web/src/ui/Dot.tsx` has no `className` passthrough. Deliberately not added in slice 1 — Sidebar was its only caller, so it would have been speculative. Slice 3 brings guardrail rows, the chat header and chips; decide before the third caller, not after. (`aria-hidden` specifically is not needed: an empty decorative `<span>` is already skipped by assistive tech.)
- **Route invariant is path-only.** `sidecar/tests/test_allowlist.py` now asserts the registered `/api/*` path set exactly equals `{health} ∪ ALLOWED_TOOLS`. It compares paths, not methods — a `POST` added to an already-allowed path, or a route under a different prefix, still passes. Worth tightening when slice 3 adds the approval gate, which is the first thing that will want a non-GET route.
- **Timezone marker.** Four surfaces render browser-local clock times with no zone label; the design labels one `BEST WINDOW UTC` and another `23:53 local`. `timeline.ts` notes the browser zone "matches the site only when the user is at the site" — the screen does not say which zone it is showing.

## Accepted as-is, with reasoning

- **Micro-label CSS repeated in three modules.** The no-central-type-scale ruling from Task 5 holds: the final review checked every copy and they have **not** drifted. Revisit only if they do.
- **`horizon_mask: z.array(z.unknown())`.** Slices 1–2 read only `.length`. Tighten before any mask-rendering screen (slice 5), not on a fixed date.
- **Global `* { animation: none !important }` for reduced motion.** `livePulse` is the only keyframe and renders nowhere in slice 1. Revisit in slice 3, which is where it first appears.
- **Crash-path test untimed.** ~20 ms to failure, measured. A timeout wrapper hardens against a hypothetical SDK change and adds a dependency.
- **`plan_targets?limit=` ignored in replay.** Inherent to one-fixture-per-tool; the fixture holds exactly the default 3.
- **`fetchSite` / `fetchHealth` untested.** Fixed-string one-liners with no interpolation. The real gap was one level up — screen-level prop threading — and that was fixed before merge.
- **Retained clamp assertion** at `SweetBandTimeline.test.tsx:61-66` is true by construction and contributes nothing, but the test's weight is now carried by the pinned geometry beside it.
- **Legend-only rail guard.** `not.toMatch(/above floor/i)` guards the legend text; a text-free grey rail div would slip past. A rail without its legend entry is not a failure mode anyone would plausibly introduce.
- **`Detail` button is enabled and does nothing** — no target screen exists until a later slice.
- **Fonts load from a CDN.** The sidecar has a full offline replay mode; the typography does not. Degrades to `system-ui`/`ui-monospace`, so the load-bearing Sans/Mono split survives — worth knowing before running this in a field.
- **`npm run preview` 404s every API call** — the Vite proxy is dev-only. Fine while the dev server is the only way this runs.

## Server-side

Nine gaps are written up separately in [`handback-to-seestar-ai.md`](handback-to-seestar-ai.md),
with file:line references into the SeeStar-AI repo. Eight of the nine are values the
server already computes and simply does not return. Item 1 blocks the Review
screen (slice 4) outright; items 2–5 and 9 degrade the Tonight screen, which
renders an explicit absent state for each.
