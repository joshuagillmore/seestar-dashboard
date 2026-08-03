# Handoff: SeeStar Console

> **Read me first (added 2026-08-03). This document is still the authority on
> tokens, layout, per-screen specs and copy — it is not corrected to match the
> build, and where the two differ the build is usually what needs justifying.**
> Four factual notes where following it literally would now be wrong:
>
> 1. **`OrangeAgente/SeeStar-AI` (below) is private and 404s.** The public repo
>    is `github.com/OrangeAgente/seestar-mcp`; history was rewritten, so every
>    SHA changed.
> 2. **Review must not call `qa_session_report`** — see the note on that row in
>    "Server state, by screen", and §3 of the slice-4 spec.
> 3. **"The repo today has no UI at all" was true at handoff.** Four screens
>    shipped, each with a phone layout.
> 4. **There is no agent chat and no approval gate.** Both appear throughout as
>    Live-screen features; neither was built, and the operator panel that
>    replaced the chat reads `provenance.jsonl` rather than talking to an agent.
>    Not an omission — the tool surface has no such channel.

## Overview

A desktop-web control and review console for a **Seestar S50** smart telescope, sitting on top of the
`OrangeAgente/SeeStar-AI` MCP server (Python, stdio MCP + a TCP bridge to the scope on port 5555).

The repo today has **no UI at all** — it is an MCP server plus a set of Claude Code skills
(`observing-planner`, `run-session`, `qa-policy`, `seestar-refine`). This design is the first
graphical surface for it. Every screen is a view onto MCP tools that already exist, plus a chat
panel onto the agent that calls them.

Four screens:

| Screen | Job |
|---|---|
| Tonight's plan | Go/no-go verdict for the night + ranked target shortlist |
| Live session | Stacking progress, telemetry, guardrails, agent chat with approval gate |
| Review & QA | Morning-after per-sub PASS/MARGINAL/REJECT, keep-list, session trends |
| Projects | Multi-night integration progress toward per-target hour goals |

Plus a **Mobile** view (two 393×852 phone screens) for driving the scope from the field.

## About the Design Files

The files in this bundle are **design references created in HTML** — a prototype showing intended
look and behavior. They are **not production code to copy directly**.

`Seestar Console.dc.html` is authored in a bespoke internal component format (a `<x-dc>` template
with `{{ }}` holes plus a `Component extends DCLogic` class, driven by the bundled `support.js`).
That runtime exists only in the design tool. **Do not try to port `support.js` or the `<sc-for>` /
`<sc-if>` / `<x-import>` tags** — read them as "loop", "conditional", and "mount child component"
and write the equivalent in your framework.

The task is to **recreate these designs in the target codebase's environment** using its established
patterns and libraries. There is no frontend in `SeeStar-AI` yet, so you are choosing the stack. A
reasonable default given the repo (Python backend, MCP over stdio, local-network device):

- **React + TypeScript + Vite** for the client
- A thin **FastAPI** (or similar) sidecar that exposes the MCP tools over HTTP/SSE to the browser —
  the browser cannot speak stdio MCP directly, and this is the single biggest piece of new backend
  work
- Server-Sent Events or a WebSocket for live telemetry push (see *Data & Backend Requirements*)

Open `Seestar Console.dc.html` in a browser to interact with the prototype: the sidebar switches
screens, the Desktop/Mobile toggle in the top-right switches surface, and the Approve/Not-yet
buttons on the Live screen demonstrate the approval gate.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, and copy. Recreate pixel-perfectly using the
codebase's libraries. Every hex value, font size, and pixel measurement in this document is taken
from the prototype and is intentional.

Two caveats:

- **All data shown is representative, not live.** Numbers, filenames, timestamps, and log lines are
  plausible fixtures built from the repo's real metric names and thresholds. Wire them to real tool
  output.
- **The charts are CSS bars, not a charting library.** They are drawn as flex rows of `<div>`s with
  percentage heights because the prototype had no chart dependency. Reimplement with whatever the
  codebase uses (Recharts, visx, uPlot). The *visual result* — thin bars, color-coded by verdict,
  dashed threshold lines — is the spec; the implementation is not.

---

## Design Tokens

### Color

| Token | Hex | Use |
|---|---|---|
| `bg/root` | `#0d0e10` | App background, phone screen background |
| `bg/chrome` | `#101215` | Top bar, left sidebar |
| `bg/chrome-alt` | `#0f1114` | Top-nav bar (topbar layout variant) |
| `bg/card` | `#15171a` | Primary card surface |
| `bg/card-sunken` | `#131518` | Secondary//de-emphasized card, table header row, table footer |
| `bg/cell` | `#181b1e` | Stat cells inside a grid |
| `bg/inset` | `#101317` | Inset wells: chart tracks, chat bubbles (agent), input field |
| `bg/hover` | `#1e2226` | Active nav item, user chat bubble |
| `bg/seg-active` | `#2a2f34` | Active segmented-control button |
| `bg/seg-track` | `#181b1f` | Segmented-control track |
| `bg/track` | `#1c1f22` | Progress-bar track, cause-bar track |
| `bg/track-alt` | `#101317` | Timeline lane track |
| `border/default` | `#262a2f` | Card borders, chip borders |
| `border/subtle` | `#1f2327` | Internal dividers inside cards, section rules |
| `border/faint` | `#1c1f22` | Table row separators |
| `border/quiet` | `#222629` | Border on sunken cards |
| `border/control` | `#2f343a` | Secondary button border |
| `border/control-hover` | `#3f454b` | Secondary button border, hover |
| `text/primary` | `#e9e7e4` | Headings, key values |
| `text/body` | `#d5d2ce` | Body prose in callouts |
| `text/secondary` | `#c5c2be` | Labels, table cells |
| `text/muted` | `#a8a5a1` | Reason text, de-emphasized prose |
| `text/dim` | `#9aa0a6` | Inactive nav, log lines, filenames |
| `text/dimmer` | `#8b8f95` | Metadata, sub-labels |
| `text/faint` | `#6f747a` | Micro-labels, units |
| `text/fainter` | `#5f646a` | Section eyebrows, placeholder |
| `text/ghost` | `#4d5257` | Axis tick labels |
| `accent` | `#c4643a` | Primary action, live state, sweet band, scores |
| `accent/hover` | `#d97b51` | Primary button hover |
| `accent/text` | `#e2a883` | Accent text on imagery |
| `accent/text-bright` | `#f0c6ab` | Accent text on chart |
| `accent/on-accent` | `#120d09` | Text on an accent-filled button |
| `accent/on-accent-alt` | `#150d08` | Text on an accent-filled chart bar |
| `accent/bg` | `#1c1712` | Accent-tinted chip/callout background |
| `accent/bg-alt` | `#1b1712` | Approval callout background |
| `accent/border` | `#3a2f26` | Accent-tinted chip/callout border |
| `accent/hover-bg` | `#241d16` | Accent ghost button hover |
| `pass` | `#4f9b7a` | PASS verdict, GO verdict, healthy status dot |
| `pass/bg` | `#12241d` | PASS badge background, complete tag background |
| `marginal` | `#c9a24a` | MARGINAL verdict, warning status |
| `marginal/bg` | `#242015` | MARGINAL badge background, needs-data tag background |
| `marginal/callout-bg` | `#161311` | Pattern-callout background |
| `marginal/callout-border` | `#2d2621` | Pattern-callout border |
| `reject` | `#d1554e` | REJECT verdict, destructive action |
| `reject/bg` | `#241514` | REJECT badge background |
| `reject/btn-bg` | `#1e1513` | Destructive button background |
| `reject/btn-bg-hover` | `#271917` | Destructive button hover |
| `reject/btn-border` | `#4a2f2b` | Destructive button border |
| `neutral/tag-bg` | `#1a1d21` | Neutral tag background ("no goal") |
| `chart/bar-quiet` | `#3a4a44` | Star-count bars, normal |
| `chart/rail` | `#2f353b` | Timeline "above floor, outside band" segment |
| `chart/rail-empty` | `#3a4046` | Progress bar with no goal; timeline bracket edges |

Semantic rule: **`accent` is never a verdict.** Verdicts are `pass` / `marginal` / `reject`. The
accent marks the live/actionable thing — the current target, the sweet band, the primary action.
Keep this separation.

### Typography

Two families, loaded from Google Fonts:

```
IBM Plex Sans — weights 400, 500, 600 — all prose, labels, buttons, headings
IBM Plex Mono — weights 400, 500      — all numerals, IDs, filenames, timestamps, log output
```

Anything a machine produced or a human would read as a measurement is Mono. Anything written for a
human is Sans. This split is load-bearing for the look — do not collapse it.

| Role | Spec |
|---|---|
| Screen heading | Sans 600 / 19px / 1.2 / `-.01em` |
| Card heading | Sans 600 / 24px / 1 / `-.01em` |
| Verdict display (GO) | Sans 600 / 38px / 1 / `-.02em` |
| Verdict display, mobile | Sans 600 / 34px / 1 / `-.02em` |
| Card title | Sans 600 / 16px / 1.1 |
| Project card title | Sans 600 / 15px / 1.1 |
| Section eyebrow | Mono 500 / 10px / 1 / `.12em` / uppercase / `text/fainter` |
| Micro label (stat cells) | Mono 400 / 9.5px / 1 / `.08em` / `text/faint` |
| Stat value | Mono 500 / 20px / 1 |
| Stat sub-line | Mono 400 / 10px / 1 / `text/faint` |
| Score | Mono 500 / 18px / 1 / `accent` |
| Body prose | Sans 400 / 14.5px / 1.5 / `text/body` |
| Reason line | Sans 400 / 11.5px / 1.45 / `text/muted` |
| Chat message | Sans 400 / 12.5px / 1.55 |
| Button label | Sans 500 / 12px / 1 |
| Nav item | Sans 500 / 12.5px / 1 |
| Table cell | Mono 400 / 11.5px / 1.3 |
| Log line | Mono 400 / 11.5px / 1.95 |
| Verdict badge | Mono 500 / 9.5px / 1.5 / `.06em` |
| Chip | Mono 400 / 9.5px / 1 |
| Axis tick | Mono 400 / 9.5px / 1 / `text/ghost` |

### Spacing, radius, misc

- Spacing: content gaps `14px` / `16px`; card padding `16–20px` horizontal, `13–18px` vertical;
  tight cell padding `9–13px`.
- Radius: cards `10px`; buttons, inputs, chart lanes `6–7px`; chips, badges, small bars `3–5px`;
  stat-grid container `8px`; phone frame `48px`.
- Borders are always `1px solid`. There are **no drop shadows anywhere** except the phone frames
  (`0 0 0 1px #2a2f34, 0 30px 60px rgba(0,0,0,.5)`) and text shadows on chart/image overlays
  (`0 1px 2px #000` / `0 1px 3px #000`).
- Status dots: `6px` circle in the header and chat, `5px` in guardrail rows and chips.
- Scrollbars are restyled: `9px`, thumb `#2b3036` at `5px` radius, transparent track.

### The one animation

```css
@keyframes livePulse { 0%,100% { opacity:1 } 50% { opacity:.25 } }
```

Applied only to the live-state dot: `animation: livePulse 1.8s ease-in-out infinite`. It appears on
the "Live stack" card header and the mobile "Stacking" label. Nothing else in the design moves.
Respect `prefers-reduced-motion` and drop it to a static dot.

---

## Global Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ Top bar — 52px, fixed                                            │
├────────────┬─────────────────────────────────────────────────────┤
│ Sidebar    │ Screen content                                      │
│ 214px      │ overflow-y: auto; padding: 22px 24px 40px           │
│            │                                                     │
└────────────┴─────────────────────────────────────────────────────┘
```

Root is `display:flex; flex-direction:column; height:100vh; overflow:hidden`. Only the content
column scrolls.

### Top bar (52px)

`padding: 0 18px`, `border-bottom: 1px solid border/subtle`, `background: bg/chrome`, `gap: 16px`.

Left to right:

1. Wordmark `seestar` — Sans 600 / 14px / `-.01em`; beside it `mcp 0.1.0` — Mono 400 / 10px / `text/faint`. Baseline-aligned, `gap: 9px`.
2. `1px × 20px` divider, `#262a2f`.
3. Three connection pills, `gap: 7px`. Each: `4px 9px` padding, `1px solid border/default`, `5px`
   radius, Mono 400 / 10.5px / `text/dim`, with a leading `5px` `pass`-colored dot, `gap: 6px`.
   Content: `bridge :5555`, `S50 fw 7.75`, `alt-az`.
4. Flex spacer.
5. Session facts — Mono 400 / 11px / `text/dimmer`, `gap: 18px`, with the value portion in
   `text/primary`: `23:53 local` · `dark ends 03:44` · `batt 61%` · `eMMC 38.2/64 GB`.
6. Desktop/Mobile segmented control. Track `bg/seg-track`, `1px solid border/default`, `6px` radius,
   `2px` padding. Buttons `5px 11px`, `4px` radius, Sans 500 / 11px; active = `bg/seg-active` +
   `text/primary`, inactive = transparent + `text/dimmer`.

The pills are **real state**, not decoration — bridge reachability, firmware version from
`get_device_state`, and mount mode. Wire them; a stale green dot on a dead bridge is worse than no
dot.

### Sidebar (214px)

`border-right: 1px solid border/subtle`, `background: bg/chrome`, `padding: 14px 10px`, column flex.

- Eyebrow `Session`, `padding: 0 8px 10px`.
- Four nav buttons. Each: full width, `9px 8px` padding, `6px` radius, `2px` bottom margin,
  `gap: 10px`, Sans 500 / 12.5px, left-aligned. Active = `bg/hover` + `text/primary`; inactive =
  transparent + `text/dim`. Layout is `[6px dot] [label, flex:1] [meta, Mono 400 10px text/fainter]`.

  | Label | Dot | Meta |
  |---|---|---|
  | Tonight's plan | `pass` | `GO` |
  | Live session | `accent` | `428` |
  | Review & QA | `pass` | `618/766` |
  | Projects | `marginal` | `3 need data` |

  The dot encodes each screen's health and the meta its headline number, so the rail doubles as a
  status summary. Both must be live.

- Flex spacer, then a **Site profile** block above a `1px` top border, `padding: 12px 8px 2px`:
  eyebrow `Site profile`; `Backyard` in Sans 500 / 12.5px / 1.4; then Mono 400 / 10.5px / 1.6 /
  `text/dimmer`: `40.713 N · 74.006 W` / `Bortle 6 · floor 25° · ceiling 60°`; then a `pass` dot row,
  Mono 400 / 10.5px: `GPS matched · mask ON (3 arcs)`.

  The floor/ceiling values come from `SEESTAR_ALT_FLOOR_DEG` / `SEESTAR_ALT_CEILING_DEG`. Show the
  configured values, not hardcoded 25/60.

---

## Screen 1 — Tonight's plan

**Purpose:** decide whether to observe tonight and in what order. Maps to `assess_conditions` +
`plan_targets`.

**Header row:** eyebrow `Observing planner · assess_conditions`; heading `Sunday 27 July 2026`;
right-aligned Mono 400 / 10.5px / `text/faint`: `source: meteoblue · fallback open-meteo`. Naming
the data source is deliberate — forecast provenance matters when the verdict is wrong.

### Verdict banner

Card with a **`4px` full-height left spine** in the verdict color (`pass` for GO). Inner padding
`20px 22px`, `gap: 26px`, centered items.

- `GO` at Sans 600 / 38px / `pass`, with `verdict` beneath in Mono 400 / 10px / `text/faint`.
- `1px` vertical divider, `align-self: stretch`.
- Prose (Sans 400 / 14.5px / `text/body`): "Clear (6% cloud) through the dark window, 5.8 h of
  astronomical dark, 12%-lit moon 96° from the plan." Below it a `pass`-dot row, Mono 400 / 11px /
  `pass`: `GPS matched site 'Backyard' (0.2 km) — horizon mask applied`.
- Right: four stats in a `repeat(4,auto)` grid, `gap: 0 26px` — CLOUD `6%`, PRECIP `0%`, MOON `12%`,
  DEW `low` (`pass`-colored). Micro-label above, Mono 500 / 17px value below.

Verdict states: **GO** (`pass`), **CONDITIONAL** (`marginal`), **NO-GO** (`reject`). The spine, the
word, and the sidebar dot all change together.

### Sweet-band timeline

Card, `18px 20px 14px`. Eyebrow `Tonight · sweet-band windows`; right-aligned legend, Mono 400 /
10px / `text/faint`, two entries with `16px × 3px` swatches: `accent` = "sweet band",
`chart/rail` = "above floor, outside band".

Then a `14px`-tall **twilight strip** representing 19:00→05:00 (600 minutes) as 0–100%:

```css
background: linear-gradient(90deg,#1b1f24 0%,#171b20 25%,#0f1215 32%,#0f1215 85%,#171b20 90%,#1b1f24 100%);
```

Darkness deepens toward the middle. A bracket at `left:29.7%; width:57.6%` with `1px solid #3a4046`
left/right edges marks the astronomical-dark window, labeled `21:58 dark` and `03:44 dawn` above
(Mono 400 / 9.5px / `text/dimmer`; the right label is `translateX(-100%)`).

Below, one lane per target: `[74px name] [flex lane, 20px tall, 4px radius, bg/track-alt] [78px window, right-aligned]`, `gap: 12px`, `5px 0` padding.

Each lane holds two absolutely-positioned bars, both as a percentage of the same 600-minute scale:

- **Above-floor span** — `top:7px; height:6px; radius:3px; background:chart/rail`
- **Sweet band** — full lane height, `4px` radius, `background:accent`, with the duration in
  `accent/on-accent-alt` Mono 500 / 10px, `padding: 0 8px`, vertically centered

| Target | Above floor | Sweet band | Label | Window |
|---|---|---|---|---|
| SH2-142 | 200→400 min | 220→370 | `150 min` | `22:40–01:10` |
| M31 | 340→540 | 380→510 | `130 min` | `01:20–03:30` |
| M45 | 400→560 | 430→520 | `90 min` | `02:10–03:40` |

Axis ticks `19 20 21 22 23 00 01 02 03 04 05`, `padding: 8px 86px 0 86px`, space-between.

**The sweet band is the core idea of the whole product.** On an alt-az mount, usable integration is
only the span between the altitude floor and the field-rotation ceiling — not the whole time the
target is up. The gray rail shows what a naive planner would promise; the accent bar shows what you
actually get. Preserve that contrast.

### Ranked shortlist

`repeat(3, 1fr)` grid, `gap: 14px`. Above it: eyebrow `plan_targets · ranked shortlist` and, right-
aligned, Sans 400 / 11px / `text/dimmer`: `Order: SH2-142 → M31 → M45 · earliest-setting first, 2 slews`.

Each card is a column flex with four bordered bands:

1. **Head** (`14px 15px`, `gap: 14px`): a `64 × 88` thumbnail (`6px` radius, `object-fit: cover`,
   black bg) beside a block containing target ID (Sans 600 / 16px, `white-space: nowrap`) and score
   (Mono 500 / 18px / `accent` + the word `score` in Mono 400 / 9.5px / `text/faint`) on a
   space-between baseline row; then the common name (Sans 400 / 11.5px / `text/dimmer`); then two
   chips at `gap: 6px`.

   Filter chip **on**: `accent/bg` bg, `accent/border` border, `accent` text. **Off**: `#15191d` bg,
   `border/control` border, `text/dimmer` text. Type chip is always neutral-bordered.

2. **Two-up stats** (`1fr 1fr`, `1px` internal divider): `BEST WINDOW UTC` and `RECOMMENDED`, values
   Mono 500 / 13px.

3. **Reasons** (`flex: 1`): micro-label `WHY — REASON TAGS`, then rows of `[accent "+"] [text]`,
   `gap: 8px` / `6px` between rows.

4. **Actions** (`12px 15px`, `gap: 8px`): primary `Hand to run-session` (accent fill,
   `accent/on-accent` text, `flex: 1`, `white-space: nowrap`, hover `accent/hover`) and secondary
   `Detail` (transparent, `border/control`, hover brightens border and text).

Card data:

| | SH2-142 | M31 | M45 |
|---|---|---|---|
| Score | 82 | 78 | 66 |
| Name | Wizard Nebula · emission | Andromeda Galaxy · broadband | Pleiades · reflection cluster |
| Filter | LP on | LP off | LP off |
| Type | nebula | galaxy | cluster |
| Window | 22:40–01:10 | 01:20–03:30 | 02:10–03:40 |
| Subs | 620 × 10 s | 460 × 10 s | 300 × 10 s |
| Image | `assets/sh2-142.jpg` | `assets/m31.jpg` | `assets/m45.jpg` |

Reasons — SH2-142: 150 min in the sweet band — the longest clean pass tonight / Emission target
suits Bortle 6: the dual-band filter passes Hα/OIII / Fits the 0.73° × 1.29° FOV with margin for the
rotation crop / Moon 96° away and only 12% lit. M31: Project needs 3.0 h more to hit its 6 h goal /
Broadband — sequenced into true dark, filter off / Large target: rotation crop costs the outer dust
lanes / Transits at 58°, just under the rotation ceiling. M45: Bright broadband — tolerates the last
hour before dawn / Compact enough to sit in the always-covered zone / Only 90 min of sweet band
before the altitude floor.

**The reason tags are the point of the screen.** A bare score is not trustworthy; the ranker must
show its work. If `plan_targets` doesn't return structured reasons, add that to the tool rather than
generating prose client-side.

### Bottom row (`gap: 14px`)

**Excluded by the ranker** (sunken card, `flex: 1`): micro-label `EXCLUDED BY THE RANKER — NOT ON THE PLAN`, then three lines at Sans 400 / 12px / 1.5 / `text/dimmer` with the target ID in Mono / `text/secondary`:

- NGC 7000 — behind the horizon mask (arc 90–100° / alt 22°), learned from 4 clear nights
- M13 — no sweet-band pass: transits above the 60° field-rotation ceiling
- M51 — sets below the 25° floor 40 min after dark

**Horizon-mask suggestion** (sunken card, `320px` fixed): micro-label `SUGGEST_HORIZON_MASK — AWAITING REVIEW`; prose "Bearing 90–100° / ~22° failed on **4 clear nights** (5 of 6 solves). A fixed obstruction?"; two buttons — `Add arc to mask` (accent ghost: `#1c1712` bg, `accent/border`, `accent` text, hover `#241d16`) and `Keep collecting` (transparent, `border/control`); footnote Mono 400 / 10px / `text/fainter`: `Never auto-applied — user confirms each arc.`

That footnote reflects a hard rule in the skills: **learned horizon masks are never applied without
explicit user confirmation.** Keep the confirmation step.

---

## Screen 2 — Live session

**Purpose:** watch the current stack and steer the agent. Three columns, `gap: 16px`, top-aligned:
preview `286px` / center `flex: 1` / operator `336px`.

### Left — live preview

Card. Header (`11px 13px`, bottom border): pulsing `accent` dot + `Live stack` eyebrow in `accent`;
right, `1080 × 1920` in Mono 400 / 10px / `text/faint` (the S50's native portrait sub dimensions).

Image: `assets/sh2-142.jpg`, `462px` tall, `object-fit: cover`, black background, with a
**plate-solve annotation overlay** (toggleable):

- Target circle: `118px`, `50%` radius, `1px solid rgba(196,100,58,.85)`, centered at `46.4% / 47.1%`
- Crosshair through it: `1px × 26px` and `26px × 1px` bars, same color
- Label at `left: calc(46.4% + 66px); top: 44%` — Mono 400 / 10px / 1.4 / `accent/text`,
  `text-shadow: 0 1px 3px #000`: `SH2-142` / `512, 934`
- Frame-center reticle at exact center: two `9px` white bars at `rgba(255,255,255,.5)`
- Bottom-left readout: `rgba(10,11,13,.72)` pill, `5px 8px`, `4px` radius, Mono 400 / 10px / 1.5 /
  `text/secondary`: `frame centre 540, 960` / `offset 28 px left — in frame`

Footer: Mono 400 / 10.5px / 1.7 / `text/dimmer` — `get_view_state → Stack.Annotate` and
`framing OK` (in `pass`) `· stars tight · background clean`.

Overlay coordinates must be derived from the real solve result against the 1080×1920 frame, not
hardcoded percentages.

### Center column (`gap: 14px`)

**Target header card** (`18px 20px`): `SH2-142` at Sans 600 / 24px beside an `LP filter` chip
(accent-tinted); below, Mono 400 / 12px / `text/dimmer`:
`Wizard Nebula · emission · 10.0 s subs · started 22:41 · elapsed 01:12:40`.

Right: three buttons, `gap: 8px`, `9px 13px`, `6px` radius, Sans 500 / 12px — `Refocus` and
`Stop stack` (secondary) and `Wind down & park` (destructive: `reject/btn-bg`, `reject/btn-border`,
`reject` text, hover `reject/btn-bg-hover`).

**Telemetry grid:** `repeat(3, minmax(0,1fr))` — *three* columns over two rows, `gap: 1px` on a
`border/subtle` background so the gaps read as hairlines, `8px` radius, `overflow: hidden`, cells
`bg/cell` at `13px 14px`.

> Use `minmax(0,1fr)`, not `1fr`. The `1fr` default minimum is `min-content`, which overflows the
> container when a label can't shrink. This bit the prototype twice.

| Label | Value | Sub | Color |
|---|---|---|---|
| STACKED | `428` | `+6 last poll` | default |
| DROPPED | `23` | `5.1% · rotation trailing` | `marginal` |
| INTEGRATION | `71.3` | `minutes kept` | default |
| PLATE SOLVE | `OK` | `annotate live` | `pass` |
| FOCUS | `1645` | `baseline 1642 · Δ+3` | default |
| STAGE | `Stack` | `3PPA → AutoGoto ✓` | default |

**Sweet-band gauge + guardrails** — two equal cards, `gap: 14px`.

*Sweet band* (`16px 18px`): eyebrow `Sweet band`, right `leaves band in 38 min` in `marginal`.
A `56px × 126px` vertical altitude gauge (`bg/track-alt`, `1px solid border/subtle`, `5px` radius):
the band region spans `top: 33.3%` to bottom with `rgba(196,100,58,.13)` fill and
`rgba(196,100,58,.5)` top/bottom edges; a `2px` `accent` bar at `top: 46.3%` marks current altitude,
labeled `54.2°` centered in `accent/text-bright` Mono 500 / 10px with a text shadow. Beside it, five
space-between labels in Mono 400 / 10.5px: `90° zenith` (`text/dimmer`), `60° rotation ceiling`
(`accent`), `current 54.2° · az 168.4°` (`text/secondary`), `25° altitude floor` (`accent`),
`0° horizon` (`text/dimmer`). Footer above a `1px` rule: "Descending toward the floor. Clean
integration is the sweet-band figure, not the whole pass."

*Guardrails* (`16px 18px`): eyebrow `check_night_guardrails`; five rows, each
`[5px dot] [label, flex:1, Sans 400 12px] [value, Mono 400 11px]`, `8px 0` padding,
`1px solid border/faint` bottom border:

| Check | Value | Dot |
|---|---|---|
| Dawn | 2 h 31 m of margin | `pass` |
| Battery | 61% · ~3 h 40 m | `pass` |
| Weather | go · 6% cloud, no precip | `pass` |
| Connection | bridge + scope verified | `pass` |
| Max duration | 3 h 12 m of 6 h | `marginal` |

Footer: `Verdict continue — every hard stop ends in park.` (`continue` in `pass` Mono; `park` in
`text/secondary` Mono.)

**Telemetry log** (`16px 18px`): eyebrow `qa_tier1 · health telemetry`; right, in `marginal`:
`Quality verdict pending — Tier-2 scores the FITS at wind-down`. Body is Mono 400 / 11.5px / 1.95,
`max-height: 132px`, scrolling, newest first:

```
[71:20] stacked 428 (+6) | dropped 23 | solve OK | focus Δ=+3     text/secondary
[70:20] stacked 422 (+6) | dropped 23 | solve OK | focus Δ=+3     text/dimmer
[69:20] stacked 416 (+5) | dropped 22 | solve OK | focus Δ=+2     text/dimmer
[68:20] sweet-band watch: 38 min to the 60° rotation ceiling      marginal
[67:20] stacked 411 (+6) | dropped 21 | solve OK | focus Δ=+2     text/dimmer
[66:20] conditions watch: go=true (6% cloud) — next poll in 10 min pass
[65:20] guardrails: continue — dawn 03:44, battery 61%, weather go pass
[64:20] stacked 405 (+6) | dropped 20 | solve OK | focus Δ=+2     text/dimmer
```

The Tier-1/Tier-2 distinction is real and must survive: Tier-1 is cheap health polling during the
session; Tier-2 scores FITS files after. **Never show a per-sub quality verdict during the session.**

### Right — operator panel (`336px`, `max-height: calc(100vh - 140px)`)

Header (`13px 15px`): `pass` dot, `Claude — session operator` (Sans 500 / 12.5px), right `run-session`
in Mono 400 / 9.5px / `text/faint`.

Scrolling message list (`14px 15px`, `gap: 12px`). Each message: timestamp line (Mono 400 / 9.5px /
`text/fainter`) above a bubble at `max-width: 96%`, `10px 12px`, `8px` radius, Sans 400 / 12.5px / 1.55.
Agent bubbles are left-aligned, `bg/inset` with a `#22262a` border, `text/secondary`. User bubbles are
right-aligned, `bg/hover`, `text/primary`, no border.

1. **Claude · 23:38** — "Dropped frames are up to 23, but eccentricity is flat at 0.31 and FWHM holds at 3.2 px. That is rotation trailing near transit — expected in alt-az, no action."
2. **You · 23:46** — "how is the framing?"
3. **Claude · 23:46** — "Annotation puts SH2-142 at (512, 934) against a frame centre of (540, 960) — 28 px left, well inside frame. Stars tight, background clean."
4. **Claude · 23:52** — "SH2-142 is 38 minutes from its rotation ceiling. Next in the plan is M31 (score 78), which enters true dark at 01:20."

**Approval gate** (pinned below the messages): `accent/bg-alt` card, `accent/border`, `9px` radius,
`13px 14px`. Header row: `5px` accent dot + `Motion — needs approval` (Mono 500 / 9.5px / `.1em` /
uppercase / `accent`). Body: "Slew to `M31`, LP filter off (broadband), ~3 min acquisition through
3PPA. Logs SH2-142 to its project first." Then `Approve slew` (accent fill) and `Not yet` (secondary),
each `flex: 1`.

After a decision the buttons are replaced by a result well (`bg/inset`, `6px` radius, `9px 11px`,
Mono 400 / 11.5px / 1.5):

- Approved → `pass`: "Approved 23:53 — logging SH2-142, then slewing. Provenance: goto_target(M31)."
- Declined → `marginal`: "Held. SH2-142 keeps stacking; I will ask again at the rotation ceiling."

Composer (`12px 15px`, top border): an inset field (`bg/inset`, `border/default`, `7px` radius,
`9px 11px`) with a `>` prompt glyph and placeholder "Ask about the session…"; below, Mono 400 / 9.5px /
`text/fainter`: `Every tool call is written to provenance.jsonl`.

**Any tool that moves the mount or changes hardware state requires explicit approval.** This is the
most important behavior on the screen — it is the human-in-the-loop contract from the run-session
skill. Read-only tools stream freely; motion blocks.

---

## Screen 3 — Review & QA

**Purpose:** morning-after triage. Maps to `qa_session_report`. Two columns, `gap: 16px`,
`max-width: 1320px`: left `300px`, right `flex: 1`.

### Left column (`gap: 14px`)

**Master image card:** header `Master · pystack` + `618 frames`; `assets/m31.jpg` at `486px`,
`object-fit: cover`; footer Mono 400 / 10.5px / 1.75 / `text/dimmer`:
`M31_20240104_master.fit` / `kappa-sigma · GRBG debayer · auto-stretch` / `gradient ✓ · white balance ✓ · deconv off`.

GRBG is the S50's actual Bayer pattern — carry it through from the FITS header rather than assuming.

**Refine actions** (sunken card): micro-label `SEESTAR-REFINE`; three stacked full-width buttons at
`10px` / `gap: 8px` — `Re-stack keep-list` (accent), `Stretch with deconvolution` and
`Prepare PixInsight handoff` (secondary); footnote
`DSS unavailable · pystack ready · PixInsight not configured`.

That footnote is a real capability probe. Disable buttons whose backend is missing rather than
failing on click.

### Right column (`gap: 14px`)

**Report header card** (`18px 20px`): eyebrow `qa_session_report`; `M31` at Sans 600 / 24px beside
`04 Jan 2024 · IRCUT · 10.0 s · alt-az` in Mono 400 / 12px / `text/dimmer`. Right: `Open report.md`
and `Logged to project ↗` (both secondary).

Stat grid — `repeat(5, minmax(0,1fr))`, same hairline-gap treatment:

| Label | Value | Sub | Color |
|---|---|---|---|
| KEPT | `618` | `of 766 subs · 80.7%` | `pass` |
| INTEGRATION | `103.0` | `minutes kept` | default |
| MEDIAN wFWHM | `3.42` | `px · session ranking metric` | default |
| MEDIAN ECC | `0.34` | `reject line 0.575` | default |
| DOMINANT CAUSE | `ecc` | `91 subs · field rotation` | `marginal` |

**Pattern callout:** `marginal/callout-bg` + `marginal/callout-border`, `12px 14px`, `8px` radius,
`gap: 10px`. Left: `PATTERN` in Mono 500 / 9.5px / 1.6 / `marginal`. Right (Sans 400 / 12.5px / 1.5 /
`text/secondary`): "Eccentricity climbs monotonically after sub ~430 while FWHM holds flat — field
rotation near transit, expected in alt-az. Not a focus fault and not a dew signature. The 17
scattered-light rejects around sub 700 are a thin-cirrus veil that slipped the SNR and star-count
floors."

This is the highest-value element on the screen: it explains *why* frames failed, in one sentence.
It should come from the agent, not a template.

**Trend chart card** (`16px 18px`): eyebrow `Per-sub eccentricity across the session`; legend with
`8px` square swatches for pass/marginal/reject.

Plot area `118px` tall with two dashed threshold lines — reject at `top: 26.1%`
(`1px dashed rgba(209,85,78,.6)`, labeled `reject 0.575` in `reject`) and marginal at `top: 45.2%`
(`rgba(201,162,74,.45)`, labeled `marginal 0.42` in `marginal`); labels sit at the right edge,
`translateY(-140%)`.

60 bars, `flex: 1` each, `gap: 2px`, `1.5px 1.5px 0 0` radius, bottom-aligned, height =
`ecc / 0.78 × 100%` clamped to `[4%, 100%]`. Color by threshold; the four bars at indices 53–56 are
forced `reject` (the cirrus event). Axis: `sub 0 / 190 / 380 / 570 / 766`.

Below a `1px` rule, two panels, `gap: 14px`, split by a `1px` vertical divider:

*Star count — cloud signal* (`flex: 1`): 60 bars, `44px` tall, normally `chart/bar-quiet` at 72–88%
height; indices 53–56 drop to ~28–34% and turn `reject`. The correlated dip across two independent
metrics is what proves cloud rather than optics — keep both charts on the same x-scale and aligned.

*Rejections by cause* (`300px`): five rows of
`[96px label, Mono 10.5px text/dim] [7px track, 3px radius, bg/track] [22px count, right-aligned]`,
`gap: 9px` / `7px`. Bar width is a percentage of the largest count (91).

| Cause | n | Bar |
|---|---|---|
| eccentricity | 91 | `reject` |
| star count | 28 | `reject` |
| scattered light | 17 | `marginal` |
| FWHM | 9 | `marginal` |
| SNR | 3 | `text/dimmer` |

**Per-sub table:** header row (`14px 18px`, bottom border): eyebrow `qa_tier2 · per-sub verdicts`;
right, Mono 400 / 10.5px / `text/faint`:
`thresholds session-relative · median wFWHM 3.42 px · median stars 612`.

Column template — used identically by the header and every row:

```css
grid-template-columns: 232px 62px 58px 58px 62px 66px 1fr;
```

Column head row: `9px 18px`, `bg/card-sunken`, Mono 400 / 9.5px / `.08em` / `text/faint` —
`SUB · FWHM · ECC · SNR · STARS · SCATTER · VERDICT · REASON`.

Data rows: `11px 18px`, `1px solid border/faint` bottom, Mono 400 / 11.5px / 1.3 / `text/secondary`.
The filename cell is `text/dim` with `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`.
Individual metric cells turn `marginal` or `reject` when that metric is what failed. The verdict cell
is `[badge] [reason in Sans 11.5px text/dimmer]`, `gap: 9px`.

Badge: `2px 6px`, `3px` radius, Mono 500 / 9.5px / 1.5 / `.06em` — PASS `pass/bg`+`pass`,
MARGINAL `marginal/bg`+`marginal`, REJECT `reject/bg`+`reject`.

| Sub | FWHM | ECC | SNR | STARS | SCATTER | Verdict | Reason |
|---|---|---|---|---|---|---|---|
| `…0412.fit` | 3.31 | 0.28 | 41.2 | 612 | 0.41 | PASS | clears every gate |
| `…0577.fit` | 3.44 | **0.44** | 39.8 | 588 | 0.52 | MARGINAL | ecc 0.44 inside 0.42–0.575 band |
| `…0612.fit` | 3.38 | **0.61** | 38.9 | 574 | 0.49 | REJECT | ecc 0.61 ≥ 0.575 — rotation trailing |
| `…0648.fit` | 3.52 | **0.66** | 37.1 | 551 | 0.55 | REJECT | ecc 0.66 ≥ 0.575 — rotation trailing |
| `…0701.fit` | 3.36 | 0.30 | 22.4 | **286** | **1.84** | REJECT | stars 286 < 306 floor; scatter +2.4σ — thin cirrus |
| `…0733.fit` | 3.29 | 0.27 | 40.6 | 604 | 0.44 | PASS | clears every gate |

Full filenames follow the S50 convention `Light_M 31_10.0s_IRCUT_<seq>.fit`; the table truncates the
middle. Footer bar (`13px 18px`, `bg/card-sunken`): left, Mono 400 / 11px / `text/dimmer` —
`keep-list → data/reports/M31_20240104_keeplist.txt · 618 files · 103.0 min`; right, Sans 400 / 11px /
`text/faint` — `showing 6 of 766 — full breakdown on request`.

Six rows of 766 is deliberate: the charts carry the distribution, the table carries evidence. Add
sort/filter if you like, but don't paginate all 766 rows by default.

### QA thresholds — read these from the server

Defaults live in `src/seestar_mcp/config.py` as `SEESTAR_QA_*` environment variables, and the policy
is in `skills/qa-policy/SKILL.md`. Thresholds are **session-relative** — star-count and scatter
floors derive from that session's own medians, so two nights can reject at different absolute
numbers. The `0.42` / `0.575` eccentricity lines and the `306` star floor shown here are computed,
not constants. **Never hardcode them in the client.** Ship them in the report payload.

---

## Screen 4 — Projects

**Purpose:** multi-night progress. Maps to `list_projects` / `recommend_projects`.

Header: eyebrow `list_projects · multi-night integration`; heading
`5 projects · 11.5 h collected · 3 need data`; right, Sans 400 / 11px / `text/dimmer`:
`recommend_projects: NGC 1499 first — 6.9 h short of goal`.

**Project cards:** `repeat(3, 1fr)`, `gap: 14px`. Each is a horizontal flex — a `96px` full-height
cover image, then a `15px 16px` column: ID (Sans 600 / 15px, nowrap) + status tag on a space-between
baseline row; common name (Sans 400 / 11px / `text/dimmer`); flex spacer (`min-height: 14px`); a
baseline row with hours collected (Mono 500 / 14px / `text/primary`) and the goal (Mono 400 / 11px /
`text/dimmer`); a `6px` progress track (`bg/track`, `3px` radius); then meta in Mono 400 / 10.5px /
`text/faint`.

Status tag: `3px 7px`, `4px` radius, Mono 400 / 9.5px / 1.4, nowrap.

| Project | Collected | Goal | % | Status | Tag colors | Bar | Meta |
|---|---|---|---|---|---|---|---|
| M31 · Andromeda Galaxy | 3.0 h | of 6 h goal | 50 | needs data | `marginal/bg` + `marginal` | `accent` | 7 sessions · last 19 Jul · med FWHM 3.42 |
| M42 · Orion Nebula | 4.2 h | of 4 h goal | 100 | complete | `pass/bg` + `pass` | `pass` | 5 sessions · last 25 Feb · med FWHM 3.11 |
| NGC 1499 · California Nebula | 1.1 h | of 8 h goal | 14 | needs data | `marginal/bg` + `marginal` | `accent` | 2 sessions · last 01 Jan · med FWHM 3.68 |
| M45 · Pleiades | 2.6 h | no goal set | 0 | no goal | `neutral/tag-bg` + `text/dimmer` | `chart/rail-empty` | 4 sessions · last 02 Feb · med FWHM 3.29 |
| SH2-142 · Wizard Nebula | 0.6 h | of 5 h goal | 12 | stacking now | `accent/bg` + `accent` | `accent` | 1 session · live tonight · +71 min pending |

**Session history** (sunken card, `16px 18px`): micro-label
`M31 · SESSION HISTORY — log_session_result`; a six-column grid
`120px 1fr 90px 90px 96px 1fr` with header `NIGHT · FILTER · KEPT · TOTAL · MED FWHM · INTEGRATION`
and rows at Mono 400 / 11.5px, `10px 0`, `border/faint` separators:

| Night | Filter | Kept | Total | Med FWHM | Integration |
|---|---|---|---|---|---|
| 2026-07-19 | IRCUT · alt-az | 412 | 498 | 3.38 px | 68.7 min |
| 2026-06-28 | IRCUT · alt-az | 301 | 388 | 3.51 px | 50.2 min |
| 2024-01-04 | IRCUT · alt-az | 618 | 766 | 103.0 min | 103.0 min |
| 2023-12-11 | IRCUT · alt-az | 188 | 294 | 3.74 px | 31.3 min |

The history table is scoped to the selected project. In the prototype it is hardwired to M31;
clicking a project card should re-scope it.

---

## Mobile

Toggling **Mobile** in the top bar replaces the content area with two phones side by side
(`gap: 40px`, centered), each captioned above in Mono 500 / 10px / `.12em` / uppercase /
`text/fainter`: `Remote control — live` and `Remote control — tonight`.

Each phone is a `393 × 852` frame (iPhone 14 Pro logical size), `48px` radius,
`box-shadow: 0 0 0 1px #2a2f34, 0 30px 60px rgba(0,0,0,.5)`. Screen content is `bg/root`,
`padding: 8px 16px 0`.

These are **the same data at field density**, not a separate product. Build them as a responsive
breakpoint of the same components where you can.

### Mobile — Live

- Header row: pulsing accent dot + `Stacking`; target `SH2-142` at Sans 600 / 21px; subtitle
  `Wizard Nebula · LP · 10.0 s` in Mono 400 / 11px. Right: `428` at Mono 500 / 26px over
  `stacked · 71.3 min`.
- Preview: `assets/sh2-142.jpg`, `230px`, `object-position: center 30%`, `10px` radius,
  `border/default` border.
- Three stat tiles (`1fr 1fr 1fr`, `gap: 7px`, `bg/cell`, `8px` radius, `9px 10px`): DROPS `23`,
  ALT `54.2°`, BAND `38m` (in `marginal`).
- Decision card: `bg/cell` with `accent/border` and a `2px` accent left border, `8px` radius.
  Label `Decision needed`; body "SH2-142 hits its rotation ceiling in 38 min. Next in the plan is
  M31 (score 78), entering true dark at 01:20."; buttons `Approve slew` (accent) and `Not yet`.
- Log tail: `TIER-1 TELEMETRY` micro-label + three lines at Mono 400 / 10.5px / 1.9.

### Mobile — Tonight

- Eyebrow `Sun 27 Jul · Backyard`; `GO` at Sans 600 / 34px / `pass` beside
  "clear (6% cloud), 5.8 h dark, 12%-lit moon well separated".
- Two tiles (`1fr 1fr`): DARK WINDOW `21:58 → 03:44`, DEW RISK `low` (`pass`).
- `Ranked shortlist` eyebrow, then three rows (`bg/cell`, `9px` radius, `10px`, `gap: 11px`): a
  `42 × 56` thumb, name + `window · sub count` in Mono 10.5px, and the score at Mono 500 / 16px /
  `accent`. SH2-142 `82` / M31 `78` / M45 `66`.
- Footer note: "Order: SH2-142 → M31 → M45 (earliest-setting first, 2 slews). NGC 7000 dropped —
  behind horizon mask."

**Every interactive element on mobile is ≥ 44px tall.** The buttons and shortlist rows carry an
explicit `min-height: 44px`. Preserve this — the real use case is cold hands in the dark.

---

## Interactions & Behavior

**Navigation.** Sidebar (or top tabs) switches screens; state is `view: 'tonight' | 'live' | 'review' | 'projects'`. No transition — instant swap. Two in-content shortcuts also navigate: "Hand to run-session" on a plan card → Live; "Logged to project ↗" on the QA report → Projects. In production both should carry the relevant target/project id.

**Surface toggle.** `surface: 'desktop' | 'mobile'` swaps the content area for the phone pair. This is a *demo* affordance for reviewing both layouts on one canvas — in production it becomes a real responsive breakpoint, not a toggle.

**Approval gate.** `approval: 'pending' | 'approved' | 'declined'`. Pending shows the two buttons; either decision hides them and shows the corresponding result well. In production this is a request/response against the agent, needs a loading state while the slew executes, and must handle rejection by the scope (target below horizon, mount busy).

**Hover states.** Primary buttons `accent → accent/hover`. Secondary buttons `border/control → border/control-hover` and `text/muted → text/primary`. Destructive `reject/btn-bg → reject/btn-bg-hover`. Accent ghost `#1c1712 → #241d16`. No transitions are specified; a `120ms ease` on background/border is a reasonable addition.

**Scrolling.** Only the content area, the telemetry log (`max-height: 132px`), and the chat list scroll. Custom scrollbar styling is global.

**Not yet designed** — you will need these:

- **Loading** — every screen needs a skeleton. Live is the hard one: it must show *something*
  within the poll interval.
- **Error / disconnected** — bridge down, scope unreachable, weather API failed. The top-bar pills
  are the natural place for connection failures; a screen-level banner for the rest.
- **Empty** — no session tonight, no projects yet, no QA report for the selected night.
- **NO-GO verdict** — the Tonight screen with a `reject` spine and no shortlist.
- **Session not running** — what Live shows when nothing is stacking.

---

## State Management

Client state is small:

```ts
view: 'tonight' | 'live' | 'review' | 'projects'
surface: 'desktop' | 'mobile'          // demo only
approval: 'pending' | 'approved' | 'declined'
selectedProjectId: string              // scopes the history table
overlayVisible: boolean                // annotation overlay
```

Server state, by screen:

| Screen | Source | Cadence |
|---|---|---|
| Tonight | `assess_conditions`, `plan_targets` | On load; refresh on demand. Conditions re-poll ~10 min while a session runs. |
| Live | `get_view_state`, `qa_tier1`, `check_night_guardrails` | Push (SSE/WS) or poll ~60 s — the prototype's log is one line per minute. |
| Review | ~~`qa_session_report`~~ **→ `qa_tier2`** | ~~On load, per session.~~ **Never on load.** See below. |
| Projects | `list_projects`, `recommend_projects`, `get_project_history` | On load. |
| ~~Chat~~ | ~~Agent stream~~ | Not built — there is no such channel on the tool surface. |

> **The Review row is the one place in this handoff that must not be followed
> (noted 2026-08-03).** `qa_session_report` writes a JSON+MD report and a
> manifest **and winds down the session**, so calling it on load would generate
> artifacts and end a session on every page refresh. It is in the sidecar's
> `FORBIDDEN_TOOLS` and has no route at all — a 404 by absence, not a guard.
>
> The shipped screen reads **`qa_tier2`**, which is read-only, and only from an
> explicit user action: it is minutes of photutils over 200–1400 raw subs, so
> the result is cached to disk per target and read back thereafter. The
> instinct behind "Expensive — cache it" was right; the cache just lives on our
> side, because there is still no read-only getter for a report the server
> already wrote (hand-back item 24). Full reasoning:
> `docs/superpowers/specs/2026-07-31-slice-4-review-qa.md` §1.

The three toggles exposed as Tweaks in the prototype (`navLayout: 'rail' | 'topbar'`,
`showOperatorPanel`, `showAnnotationOverlay`) are design-exploration switches. `navLayout` is a
layout decision to make once and hardcode; the other two are worth keeping as real user preferences.

---

## Data & Backend Requirements

The biggest gap between this design and the current repo is **transport**. The MCP server speaks
stdio to an agent; a browser cannot. You need a sidecar exposing the tools over HTTP, plus a push
channel for live telemetry.

Beyond that, four data needs may not be met by today's tool signatures — confirm before building,
and extend the server rather than synthesizing client-side:

1. **Per-sub metric arrays.** The eccentricity and star-count charts need one point per sub
   (~766 values). If `qa_session_report` returns only summary statistics, add an array to the payload.
2. **Structured reason tags.** Plan cards and per-sub rows show short causal strings. These should
   be structured data from `plan_targets` / `qa_tier2`, not prose parsed on the client.
3. **Sweet-band geometry.** The timeline needs, per target, the above-floor span *and* the
   sweet-band span as timestamps. If the planner computes these internally, expose them.
4. **Project aggregates in one call.** `list_projects` should return collected hours, goal hours,
   session count, last-session date, and median FWHM — five cards should not be five round trips.

Two invariants worth restating, because they are policy rather than UI:

- **Motion requires approval.** Read-only tools stream; anything that moves the mount or changes
  hardware state blocks on an explicit user decision.
- **Learned horizon masks require confirmation.** Never auto-apply a suggested arc.

---

## Assets

Five real Seestar S50 stacked JPEGs supplied by the user, in `assets/`:

| File | Target | Notes |
|---|---|---|
| `m31.jpg` | M31 · Andromeda | 1080 × 1920, full-resolution portrait sub |
| `m42.jpg` | M42 · Orion | thumbnail (`_thn`), small — do not scale up |
| `ngc1499.jpg` | NGC 1499 · California | thumbnail |
| `m45.jpg` | M45 · Pleiades | thumbnail |
| `sh2-142.jpg` | SH2-142 · Wizard | full resolution |

Original filenames follow the S50 export convention
`Stacked_<target>_<exposure>_<filter>_<timestamp>[_thn].jpg`, which encodes target, sub length, and
filter — useful for parsing.

Only `m31.jpg` and `sh2-142.jpg` are full resolution; the rest are thumbnails and will soften if
enlarged. In production these come from the scope's own storage. **There are no icon assets** — the
design uses none, only type, rules, and dots. Keep it that way; it is part of the look.

---

## Files

```
design_handoff_seestar_console/
├── README.md                    ← this document
├── Seestar Console.dc.html      ← the design (open in a browser)
├── support.js                   ← design-tool runtime; DO NOT PORT
├── ios-frame.jsx                ← phone bezel used by the mobile view; reference only
├── github.md                    ← repo association + screen→source map
└── assets/                      ← the five images
```

**Reading `Seestar Console.dc.html`:** the template is the markup after `</helmet>`; the logic class
is in the `<script data-dc-script>` block at the bottom. Translate `<sc-for list="{{ x }}" as="y">`
as a map over `x`, `<sc-if value="{{ c }}">` as a conditional, and `{{ path }}` as a value from the
`renderVals()` return object. Styling is entirely inline — every value in this README can be found
verbatim in the file.

`github.md` maps each screen to the repo files that informed it, which is the fastest way to find
the tool contract behind any given panel.
```
