# Design-fidelity review — 2026-07-30

Reviewed the shipped `main` (`0b44720`) against the Claude Design handoff
(`docs/design/README.md` plus the `Seestar Console.dc.html` prototype).

Four passes: three code reviews (tokens/global, Tonight, Projects/mobile/state) and
a rendered visual comparison of the built app against the prototype at 1440px.

**Scope:** Shell, Tonight and Projects. Live session and Review & QA are slices 3
and 4 and do not exist yet. Target imagery was in flight on `target-imagery` during
this review, so every imagery slot is excluded from the findings below.

## The clean result first

The token layer is **exact**. All 52 colour tokens present and byte-identical to the
handoff table; no hex literal anywhere in `web/src`; font families always resolve
through `--font-sans` / `--font-mono` with no silent `system-ui` fallback; self-hosted
weights match the ones the design uses. Top bar is 52px, sidebar 214px, content
padding `22px 24px 40px` — all verbatim.

Tonight's geometry was spot-checked value-by-value and matches: banner spine 4px,
padding `20px 22px`, gap 26px, GO at 38px/600; sweet-band gradient stops byte-for-byte,
lane `74px/20px/78px`, band radius 4px; ranked card grid `repeat(3,1fr)` gap 14px, and
the head/stat/reason/action typography throughout.

So this is not a "the build drifted from the design" review. What follows is a
specific, mostly small list.

---

## A. Fix — clear divergences with no recorded reason

**A1. The type chip renders a raw enum.** `PlanCard.tsx:54` emits `{target.type}`
directly, so the chip reads `planetary_nebula` and `globular_cluster`. The design's
card-data table (`README.md:350`) specifies `nebula`, `galaxy`, `cluster`. The
Fidelity caveat exempts "numbers, filenames, timestamps and log lines" as
representative — it does not exempt copy, and snake_case in a user-facing chip is
plainly not what the design shows. **Most visible single divergence on Tonight.**

**A2. Projects hours/goal row is not space-between.** The design puts collected hours
at the left and the goal right-aligned at the far edge (`3.0 h` … `of 6 h goal`,
`README.md:654-655`). Ours renders them adjacent on the left. Most visible divergence
on Projects.

**A3. The `2×` doubling control renders outside the card.** It floats above the card's
top-right corner, outside the rounded rectangle, so it reads as detached from the card
it controls.

**A4. Ranked-shortlist section header is missing entirely.** No eyebrow
`plan_targets · ranked shortlist`, and no right-aligned order line
`Order: … · earliest-setting first, 2 slews` (`README.md:320-321`). Not a server gap —
target order is the array order and slew count is `targets.length - 1`. Every other
section on the screen has its eyebrow, so this reads as an oversight.

**A5. Sidebar status dots are hardcoded.** `Sidebar.tsx:63` sets `tone = 'idle'` for
every row except Tonight. The design is explicit: *"The dot encodes each screen's
health and the meta its headline number … Both must be live."* For Projects the signal
already exists (`ProjectsScreen.tsx:65`, `needsDataCount`) and simply is not threaded
through. The meta is live; the dot is not.

**A6. No hover states on the plan-card actions.** `PlanCard.module.css:33,35` — design
specifies primary hover `accent/hover` and secondary hover brightening border and text
(`README.md:341-342`). Both tokens already exist and are used on `ProjectCard`. The
`Detail` button is enabled, so this is visibly reachable, not moot.

**A7. Session-history micro-label names the wrong tool.** `SessionHistory.tsx:36`
renders `… · SESSION HISTORY — list_projects`; the design says `log_session_result`
(`README.md:669`). No comment records the substitution.

**A8. Timeline legend has one entry, should have two.** Only `sweet band` renders; the
design also has `above floor, outside band` for the grey rail. The grey rails *are*
drawn — it is the key for them that is missing.

**A9. Card subtitle drops the descriptor suffix.** Design: `Wizard Nebula · emission`,
`Andromeda Galaxy · broadband`. Ours shows the common name only. The narrowband /
broadband distinction does exist server-side in `lightpollution.py`'s `LP_MODEL` but is
not returned, so this is either a small hand-back or a client-side mapping — worth
deciding which.

---

## B. Decide — divergences that may be correct, but are unrecorded

**B1. PRECIP: the number is in the prose but has no tile.** The banner says
"precipitation probability up to 28%" while the tile row shows only CLOUD / MOON / DEW.
Hand-back item 3 explains why there is no structured source, but the visible result is
a screen that states a precipitation figure in one place and omits its tile in another.

**B2. Mobile does not exist, at all.** No `surface` state, no phone frame, no
responsive breakpoint — `tokens.css` has exactly one `@media` block and it is
`prefers-reduced-motion`. The Desktop/Mobile toggle is absent from the top bar with no
comment. This *is* recorded as deferred in the slice-2 spec, but the design devotes a
full section to it, so it needs an explicit in-scope/out-of-scope call rather than
silence.

**B3. Verdict banner is a bullet list, not a prose sentence.** Design is one summary
sentence plus a GPS note; ours is five bullets. Denser and arguably more scannable, but
not the specified shape.

**B4. The GPS pass-dot row moved out of the banner** into the sidebar to avoid a double
render (`VerdictBanner.tsx:87-91`). Reasonable, but recorded only in an inline comment.

**B5. `recommend_projects` has vanished from the Projects header.** Design shows
`recommend_projects: NGC 1499 first — 6.9 h short of goal`; ours shows a provenance
line instead. Ours is useful and honest, but the recommendation has no home and the
tool has a route.

**B6. `archive only` occupies the tag slot.** It is a legitimate new state the design
did not know about — but it means a 279%-complete target like M42 shows `archive only`
rather than `complete`, with only the bar colour carrying completion.

**B7. Selection is lost on navigation.** `selectedProjectId` is local component state
and `App.tsx:14-19` unmounts the screen, so a round trip to Tonight and back resets to
the highest-hours default and re-fetches both endpoints with no cache.

**B8. The invented no-go caption.** "Ranked for reference — tonight is a no-go." is not
in the design. Well-reasoned and tested — it stops the shortlist reading as an
invitation to act — but it is an added element.

**B9. The provenance row on project cards** (store/archive minute split) is a seventh
element in a six-element card anatomy. Justified by the time-on-target work; the design
doc should probably absorb it.

---

## C. No action — documented deferrals, verified as such

Target imagery (in flight); `LP on`/`LP off` filter chip (hand-back 5); top-bar
telemetry pills and session facts (slice 3); excluded-by-ranker and horizon-mask cards
(hand-back 4, slice 3/5); above-floor rail timestamps (hand-back 2); three-state
CONDITIONAL verdict (hand-back 6); `median_fwhm` and filter columns (hand-back 7, 12);
`BEST WINDOW` without a UTC marker (already open in the backlog); the 99px timeline
inset (already ruled on); Live and Review screens (slices 3–4).

---

## Suggested order

A1 → A2 → A3 are the three a person would notice first. A4 through A9 are small and
mechanical. Section B needs your decisions before anything is built — B2 in particular,
since mobile is a slice-sized question rather than a fix.
