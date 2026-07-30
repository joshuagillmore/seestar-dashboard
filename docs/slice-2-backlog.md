# Carried forward from slice 1

Twenty-five items were deliberately deferred during slice 1 and triaged by the
final whole-branch review. Everything marked must-fix was fixed before merge;
what remains is below, with the reasoning that put it here rather than in the
branch.

Nothing on this list is a defect on screen. Slice 1's rule — nothing rendered
asserts something nobody verified — holds as shipped.

## Blocks slice 2's Projects screen: "time on target" is currently unknowable

Found 2026-07-28, after slice 1 was complete. This is a design constraint, not a
defect — but the Projects screen cannot be built honestly without resolving it.

There are **two disjoint records of what has been imaged**, and neither is complete:

| Source | Span | Targets | Integration |
|---|---|---|---|
| `list_projects` store | Jul 2026 | 15 | 9.1 h |
| `C:\Users\<user>\OneDrive\Documents\SeeStar` | Dec 2023 – **Jul 2026** | **22** | **21.5 h** |

They overlap on **four** targets: `NGC 281`, `M 31`, `M 27` and `M 57`. A Projects
screen reading `list_projects` alone would report 9.1 hours and be blind to 21.5
hours sitting on disk.

> **Corrected 2026-07-30.** This originally read 20 targets / 20.9 h spanning
> Dec 2023 – Mar 2024, and concluded that copying to OneDrive had stopped. All
> three were wrong. My scan filtered on `endswith("-sub")`, and **the archive
> uses two naming conventions**:
>
> ```
> M 31-sub                    hyphen, catalogue id only
> M27 Dumbbell Nebula_sub     underscore, id + common name
> ```
>
> Two folders use the second form and were silently skipped: `M27` (118 subs,
> nights 2026-07-05 and 07-06) and `M57` (102 subs, 2026-07-06). Those are
> **July 2026** — copying is ongoing, and the two sources are live and
> converging rather than historically separate.
>
> Consequences: any scanner must handle both suffixes **and** strip the common
> name when deriving a target id, or it undercounts silently. And
> de-duplication is not the theoretical safeguard the next paragraph implies —
> the sources now record the same targets in the same month, and will collide
> on a night as soon as one session is copied that the store also logged.

The M 31 case shows why this matters: the store holds 84.2 min from July 2026,
the archive holds a further 38.3 min from January 2024, and **neither source
knows the real total of roughly 122 min**. Progress toward an hours goal — the
entire point of the screen — would be stated confidently and be wrong.

Counted from the archive (each `Light_*.fit` is one sub; exposure is in the
filename, 10.0s throughout):

```
IC 405    1303 subs  217.2 min   5 nights   M 45     447   74.5    4 nights
M 42      1204        200.7      6          LDN 1625 418   69.7    1
NGC 1499   647        107.8      2          NGC 281  283   47.2    2
M 81       587         97.8      2          M 1      265   44.2    4
SH2-142    558         93.0      2          M 31     230   38.3    1
Unknown    535         89.2      1          …14 more targets
```

**Before building the Projects screen, decide:**

1. **Which source is authoritative** — the store, the filesystem, or a union. A
   union needs target-name normalisation (`M 31` on disk vs `M31` in the tools)
   and de-duplication where a night appears in both.
2. **Where that reconciliation belongs.** Counting FITS files to derive
   integration time is arguably server work — it is the same data `qa_tier2`
   already walks — which would put it behind the hand-back rule. Doing it in the
   sidecar is faster but means the dashboard and the MCP server disagree about
   how much data exists.
3. **Whether the store should be backfilled** from the archive, so
   `list_projects` becomes the single source of truth and this problem stops
   recurring.

Related: hand-back item 7 records that `median_fwhm` is `null` on every session
record in the store. Between that and the missing 20.9 hours, the projects store
is currently a partial record of observing history rather than a complete one.

## Imagery: a dashboard feature, not a server gap

Same archive, same discovery. `Stacked_<target>_…_thn.jpg` is a ready-made
thumbnail per target, and the `-sub` directories hold every individual frame.
That is what the design's plan-card thumbnails, project covers and Review master
image need — so the sidecar can serve them from disk.

Hand-back item 8 has been corrected accordingly; the only thing still owed by the
server is a canonical `data_root` so the sidecar is not hardcoding a personal
path. Note the sidecar's route allowlist currently exposes tool calls only —
serving image bytes is a new route class and should be read-only and
path-constrained, not a general static mount.

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
- **`plan_targets?limit=` ignored in replay.** Inherent to one-fixture-per-tool; the fixture is recorded at the default (now 12), so replay always returns that many regardless of the requested limit.
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

## Ruling: timeline scrollbar registration (2026-07-30)

The sweet-band timeline scrolls its lane list while the twilight strip, bracket
labels and hour axis stay fixed above and below. Those four elements must share
one horizontal coordinate frame or the bracket stops lining up with the bands —
a bug that shipped once already, at 46px and 56px of drift, and was caught only
by measuring in a real browser.

The scroll container reserves a gutter via `scrollbar-gutter: stable`, and the
fixed elements compensate with a `99px` right inset (90px lane budget + the 9px
declared scrollbar treatment).

**Measured, in Chrome:** left edges match exactly at 344.98px. Right edges differ
by **2.11px**, because Chrome reserves 11px of layout gutter for
`scrollbar-width: thin` while rendering a 9px thumb.

**Ruling: accept the 2.11px. Do not retune the 99px.**

Tuning it to 101px would encode Chrome's particular interpretation of `thin`,
reintroducing the browser-specific fragility that adding the standard
`scrollbar-width` property to `tokens.css` had just removed — before that, the
restyle was `::-webkit-scrollbar` only, so Firefox reserved its native ~16px and
the compensation was wrong there by far more than 2px.

The compensation should track the *declared* treatment, not one engine's
rounding. 2.11px on a ~900px chart is 0.2% and invisible; the failure this
guards against was 20× larger.

Revisit only if a real misalignment becomes visible, or if the fixed elements can
be restructured to share the scroll container's content box directly — which
would remove the magic number rather than retune it, and is the better fix if
this area is ever reworked.

## Standing check: assertions that test a proxy instead of the property

Seven times now, this project has shipped an assertion that reads as meaningful
and **cannot fail**. Reviews caught all seven, but it is predictable enough to
belong in every plan rather than be rediscovered each slice.

Every instance has the same shape: **the assertion checks something correlated
with the property instead of the property itself.**

| # | Where | Asserted | Actually needed |
|---|---|---|---|
| 1 | TopBar | no element with `[data-dot="pass"]` | nothing in the repo set that attribute — it matched zero elements always |
| 2 | TopBar | `queryByText(/fw \d/i)` absent | reads only *direct* text nodes; a nested span slips past |
| 3 | VerdictBanner | `getByText('99%')` | two stats legitimately read 99% — matched twice and threw |
| 4 | TonightScreen | `getAllByText('M76')` non-empty | the timeline satisfied it; the card grid it meant to check could be deleted |
| 5 | SweetBandTimeline | no `[data-rail]` element | `data-rail` existed only inside that query |
| 6 | SweetBandTimeline | `left >= 0 && left + width <= 100` | guaranteed by `spanToPercent`'s own clamping, for any input |
| 7 | test_static | `path.parent.name == "web"` | `parents[1]` and `parents[2]` both end `.../web/dist` |

**The check to run on every new assertion:** *what single change would make this
fail?* If the answer is "nothing I can think of", or if it is a change nobody
would plausibly make, the assertion is decoration.

**Prefer proving it by mutation over reasoning about it.** Break the thing
deliberately, confirm the test fails, restore, confirm green. That took minutes
each time and caught what reading did not — including a `parents[2]` → `parents[1]`
off-by-one that would have made production permanently report "not built yet"
while its own test stayed green.

**Specific smells:** asserting a *name* where identity is meant; a *substring*
where a match is meant; a *count* where a source is meant; an attribute or
test-id that nothing in the codebase sets; and any bound that the code under
test already enforces by construction.

## Two process notes from phase 1

**Verify the gate on the merged result *before* pushing, and check it actually
ran.** Phase 1's merge ran `uv run pytest` but `uv` could not rebuild the venv —
a dev server still held `seestar-dashboard.exe` — so the sidecar suite silently
did not execute, and the push went out on an unverified gate. It was green when
re-run, but that was luck. A gate that errors is not a gate that passed: check
for a test count, not just a zero exit.

**End-to-end runs must clean up their own processes.** Phase 1's report said
scratch processes were killed; 24 `seestar-dashboard` processes were still alive
afterwards, on ports 8791–8793, each with a spawned `seestar_mcp.server` child.
Those hold the console script (blocking `uv sync`) and keep MCP connections open
against the telescope's data directory. Any task that starts a server should stop
it in the same breath, and the check is `Get-CimInstance Win32_Process`, not
"I ran Stop-Process once".
