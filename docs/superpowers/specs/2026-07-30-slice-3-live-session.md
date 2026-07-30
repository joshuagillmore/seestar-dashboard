# Slice 3 — Live session

**Status:** decisions taken 2026-07-30 — see §0. §2 is kept for the reasoning, not as open questions.
**Design:** `docs/design/README.md` Screen 2 (lines 383–517).
**Base:** `main` @ `c5e22ce` — 277 web / 242 sidecar tests green.

Three columns, `gap: 16px`, top-aligned: preview `286px` / center `flex: 1` / operator `336px`.

---

## 0. Decisions — and the reframing they cause

**Taken 2026-07-30, after showing the user the rendered prototype.**

> *"as far as controls of the telescope goes, they're not needed. controls for the Claude session
> would be a nice to have, but the main thing is to see the current visual of the camera so I'm not
> having to go into the seestar app and can make decisions as needed."*

This **inverts the slice's priorities** and dissolves its hardest problem.

| | Design's emphasis | Actual need |
|---|---|---|
| Live camera view | one of three columns | **the reason the screen exists** |
| Telemetry | the centre, most of the pixels | useful support |
| Telescope controls | prominent, top-right | **not wanted** |
| Operator panel | a full third of the width | nice to have |

**D1 — resolved, and the architectural conflict is gone.** §1 framed the blocker as "every control
maps to a forbidden tool". With controls unwanted, nothing on this screen needs a write route, the
allowlist is untouched, and no coordination protocol is required. Drop `Refocus`, `Stop stack` and
`Wind down & park`; defer the operator panel and its approval gate to a later slice.

Note what this preserves: the human-in-the-loop contract stays entirely inside the `run-session`
skill, where the design says it belongs, rather than being partly re-implemented in a browser on
the LAN. The safest version of that feature turned out to be the one the user actually wanted.

**D2 — fetch live on a slow interval.** Chosen with the hazard stated. The requirement is a
*current* view, so the overlay-only option in §2 does not meet it — an annotation over a
placeholder does not tell you what the camera sees.

The hazard is real and does not go away because the feature is wanted, so the implementation
carries the constraints rather than the decision being revisited:

- **Find the cheapest source before assuming SMB.** The scope serves a preview to its own app; the
  stacking process may write a local JPEG. Pulling full frames over SMB is the *last* resort, not
  the first. Establish what is actually available before building.
- **Slow by default, and configurable.** A conservative interval, tunable, documented.
- **Never poll while idle.** `get_view_state` timing out means the scope is not observing; there is
  nothing to fetch and no reason to touch the network.
- **Degrade, never disrupt.** If a fetch is slow or fails, keep the last frame with an honest
  staleness indicator. Never retry aggressively — the failure mode this guards against is a starved
  control link, and retrying makes exactly that worse.
- **Say when the image is from.** A stale frame presented as current is the dishonesty this project
  avoids everywhere else; timestamp it.

#### D2 resolved — investigated 2026-07-30, and the caution above was miscalibrated

Measured, not assumed:

| File | Size | Written |
|---|---|---|
| per-sub thumbnail `Light_*_thn.jpg` | **15.3 KB** | every ~10 s, as each sub lands |
| stacked thumbnail `Stacked_*_thn.jpg` | 14.7 KB | once per session |
| stacked full `Stacked_*.jpg` | 476 KB | once per session |
| per-sub FITS | 4,056 KB | every ~10 s |

**The hazard was mis-scoped, including by me.** The field note warns against a *heavy* offload —
7,804 FITS at ~4 MB is roughly 31 GB, and that is what starves the control link. Polling a single
15 KB thumbnail once a minute is 0.25 KB/s. It is a trickle, not an offload, and the note does not
describe it. The constraints above still stand as good practice; the risk does not justify refusing
the feature.

**What exists, established rather than inferred:**

- **No image-shaped MCP tool exists at all.** All 33 tools read end to end: `Annotate` is geometry
  only, `list_subs`/`download_subs` are FITS. So there is no read-only tool to call, and this is a
  hand-back candidate (see below).
- **The vendor app uses RTSP (4554/4555) plus a binary live-stack stream (4800/4804)** —
  reverse-engineered, unwrapped by anything in this codebase. Building a client for it would put a
  fragile raw protocol in the dashboard, violating `seestar-mcp`'s own "confine the fragile surface
  to one place" rule, and it is a continuous stream, the wrong shape for an interval fetch. Rejected.
- **`SEESTAR_ARCHIVE_DIR` is not a live mirror.** Confirmed empirically: newest file is 24 days old,
  zero files in the last five days. It is a periodic export. Rejected as a live source.
- **`AllowInsecureGuestAuth` is already enabled** on this machine, so the scope's SMB share needs no
  new security change here. **It is still a prerequisite for anyone else** and must be documented —
  it is a host-wide relaxation, and a community user should be told what they are turning on and why.
- **`Stacked_21_…` and `Stacked_97_…` are different sessions, not increments.** The exported archive
  holds one stacked image per session, written at the end. The live-updating artifact is the
  per-sub thumbnail.

**Source strategy: prefer a live stacked preview on the share if one exists, else the newest
per-sub thumbnail.** Whether the scope writes intermediate stacked JPEGs during a session is
unknown — an export made afterwards would not show them either way. Preferring one and falling back
to the other resolves the question the first time a real session runs, without blocking on it now.

The difference matters to the user and should be visible: a single 10-second sub is what the camera
just captured, but it is noisy and dark next to the accumulating stack the vendor app displays. If
the fallback is what is showing, the UI should say so rather than letting a grainy frame read as a
poor result.

**Hand-back candidate:** a read-only tool returning the latest preview JPEG would put this in the
one place the architecture wants it, and would remove the SMB prerequisite from every client. Not
raised yet — worth doing only once the source question above is settled by a real session.

**D3 — my call, unchanged:** add the read-only tools this screen needs to `ALLOWED_TOOLS`, each
verified read-only against the server source rather than assumed from its name.

### Follow-up clarifications, same session

> *"controls are not needed. feel free to keep status indicators in if it's not too difficult or
> problematic."*

**Status indicators stay, controls go.** The distinction is actionable-vs-informational, not
which card something sits in: the telemetry grid, stage, plate-solve state, focus reading,
guardrail dots and sweet-band gauge are all read-only status and all stay. What goes is anything
that would *do* something. Where a design element was a button, it becomes either a plain readout
or nothing — never a disabled button, which reads as "broken" rather than "not offered".

> *"for the view, not reticle required and if the LLM has a sentence on stacking assessment like in
> the design or an automated status from the Seestar, great, but if not, we can always reassess."*

**The overlay defaults off.** The design already calls it toggleable, so this is a default rather
than a removal: the frame-centre reticle, target circle and crosshair are decoration over the one
thing the screen exists to show, and the user asked for the picture. Keep the **framing readout as
text** — `offset 28 px left — in frame` is information, not decoration, and it is how the known
~20–30′ frame-left characteristic of this unit stays visible without cluttering the image.

**The stacking-assessment sentence is best-effort.** The design's `framing OK · stars tight ·
background clean` is an *assessment*, not telemetry — the sort of thing the agent produces, and the
operator panel that would carry it is deferred. So: render whatever the server actually returns,
and if nothing does, omit the line rather than deriving one. The UI does not author assessments,
the same way it does not author QA verdicts or the verdict-banner headline. Revisit when the
operator panel lands — that is where a sentence like this naturally lives.

---

## 1. The problem to settle first

**Every control on this screen is a tool the allowlist deliberately excludes.**

| Design element | Tool it implies | Status |
|---|---|---|
| `Refocus` button | `run_autofocus` | **FORBIDDEN** |
| `Stop stack` button | `stop_view` | **FORBIDDEN** |
| `Wind down & park` button | `park` | **FORBIDDEN** |
| `Approve slew` | `goto_target` | **FORBIDDEN** |
| `LP filter` change | `set_filter` | **FORBIDDEN** |
| Composer ("Ask about the session…") | not an MCP tool at all | — |

This is not an oversight in the allowlist. `CLAUDE.md` states it as a security property:

> The sidecar exposes MCP tools over HTTP behind a **route allowlist**: a tool with side effects has
> no route at all. Never add one to make a screen easier.

So the right column and the center's button row cannot be built as designed without breaking the
one rule this project has held since slice 1. **This needs a decision, not a workaround** — see §2.

Worth being precise about what the design is actually describing: the operator panel is not a
control surface the dashboard owns. It is a **view onto a conversation happening elsewhere** —
a Claude session running the `run-session` skill — plus an approval prompt belonging to that
session. The design's own note says so:

> **Any tool that moves the mount or changes hardware state requires explicit approval.** This is
> the human-in-the-loop contract from the run-session skill.

The contract is the skill's. The question is whether the dashboard may *participate* in it.

---

## 2. Decisions needed

### D1 — What does the dashboard do about motion controls?

**Option A — Observer only.** The dashboard renders live state and shows what the agent is doing
and what it is asking for, but every control is inert: approval happens in Claude's own interface.
Buttons either disappear or render disabled with an explanation. No new write path, allowlist
untouched.

*Cost:* the screen's most prominent affordances become decoration. A pinned "Motion — needs
approval" card you cannot approve from is arguably worse than not showing it.

**Option B — A coordination channel that is not a tool route.** The dashboard writes an approval
decision to a file (or a small local endpoint) that the `run-session` skill polls; the skill still
makes every actual tool call. No side-effecting MCP tool ever gains a route, and the telescope is
only ever driven by the agent.

*Cost:* it is still a write, and it is a new coordination protocol that does not exist yet — it
needs a change in the **skill**, so it is a SeeStar-AI change under the hand-back rule, not
something this repo can land alone. It also needs thinking about who may approve and from where:
anything reachable from a browser on the LAN can now authorise mount motion.

**Option C — Defer the operator panel entirely.** Build the observation two-thirds (preview +
center column) this slice, and treat the panel as its own slice once the coordination protocol
exists.

**Recommendation: C, then B.** The observation half is genuinely useful on its own, unblocked
today, and roughly two-thirds of the screen. It also makes the panel's requirements concrete
before designing a protocol for it. B is the right long-term answer; A permanently misrepresents
the screen's purpose.

### D2 — Does the live preview fetch a live image?

**This one has a hardware hazard, not just a design cost.** From verified field notes:

> A heavy SMB offload **saturates the scope's Wi-Fi and starves the control link**, causing bridge
> auth timeouts. Never pull files during imaging.

The design wants a `462px` live frame. Pulling the current stack image from the scope on a polling
interval is exactly the traffic that note warns about — **the dashboard could disrupt the session
it is watching.** A dashboard that degrades observing to display observing is a bad trade.

The good news is that the *annotation* is cheap and separate:

> `View.Stack.Annotate.pixelx` / `pixely` / `radius` — framing check, cheap (no JPEG download
> needed)

So the plate-solve overlay, the framing readout and the offset figure — the informative parts —
can all render with no image traffic at all.

Options: **(a)** render the overlay geometry over a placeholder, no image fetch; **(b)** fetch the
existing on-disk thumbnail written by the stacking process, if one exists locally rather than over
SMB; **(c)** fetch live at a deliberately slow interval with a documented risk.

**Recommendation: (a) for this slice, investigate (b).** Never (c) while a session is running.

### D3 — Which read-only tools get routes?

`ALLOWED_TOOLS` currently holds **five** tools, none of which this screen uses. Everything the
center column needs is absent:

| Needed for | Tool | Read-only? |
|---|---|---|
| stacked / dropped / solve / stage | `get_view_state` | Yes — named read-only in `CLAUDE.md` |
| pointing, tracking state | `get_status` | Yes — named read-only in `CLAUDE.md` |
| guardrails card | `check_night_guardrails` | **Verify** |
| telemetry log | `qa_tier1` | **Verify** — Tier-1 is health polling, but confirm it writes nothing |
| focus value | `get_focuser_position` | **Verify** |
| battery | `pi_get_info` | **Verify** — battery is *not* in `get_device_state` |
| sweet-band gauge | `get_target_observability` | **Verify** |

Adding a genuinely read-only tool is not a loosening of the rule — the rule excludes *side effects*.
But **each must be verified against the server source, not assumed from its name**, and the
allowlist's disjointness test must keep passing.

---

## 3. What is buildable, assuming C + (a)

- **Preview card** — header, plate-solve overlay geometry from `Annotate`, framing readout, footer.
- **Target header** — name, filter chip, sub length, started/elapsed.
- **Telemetry grid** — six cells, `repeat(3, minmax(0,1fr))`. Note the design's own warning: use
  `minmax(0,1fr)`, not `1fr`, whose `min-content` minimum overflowed the prototype twice.
- **Sweet-band gauge** — altitude, band region, rotation ceiling, floor.
- **Guardrails card** — five checks with dots.
- **Telemetry log** — newest-first Tier-1 lines.

## 4. States that are not errors, and must not render as errors

From verified field notes — these are normal and the screen has to say so:

- **Native state methods time out on an idle scope.** `get_view_state`, `get_focuser_position` and
  `list_subs` all do. A timeout means "not observing", not "broken".
- **Tools never raise.** They return `{ok: false}` with an error tag when the bridge is down.
  **Bridge-down and scope-idle are first-class UI states**, not error banners.
- **The scope sleeps after park and drops its SMB share.**
- **A systematic ~20–30′ frame-left offset** is a characteristic of this unit — it survived a power
  cycle, re-level and fresh 3PPA. Show it as information, never as a fault. The design already gets
  this right: `offset 28 px left — in frame`.
- **Eccentricity dominating reject reasons is real alt-az field rotation**, worst near zenith.

## 5. Things the design states that must survive implementation

- **Never show a per-sub quality verdict during the session.** Tier-1 is cheap health polling;
  Tier-2 scores the FITS at wind-down. The design's "Quality verdict pending" is the correct state.
- **Overlay coordinates must be derived from the real solve against the 1080×1920 frame**, not
  hardcoded percentages.
- The one animation — the pulsing `accent` dot — already exists (`tokens.css`, with a
  `prefers-reduced-motion` guard) and has had zero call sites until now. This slice is its first.

## 6. Dependencies outside this repo

- **Hand-back item 10** — provenance cannot distinguish the dashboard's own calls from the agent's,
  so the operator panel cannot attribute messages. Gates D1/option B, not the observation half.
- **Hand-back item 5 / 14** — the `LP filter` chip needs the filter state the server does not return.
- **D1/option B** needs a `run-session` skill change; it cannot land here alone.

## 7. Scale

Real nights run 200–1400 subs per target and 400–1300 kept across 5–9 targets over 4–6 hours. The
telemetry log is capped at `132px` scrolling, newest first, so it is bounded by design — but the
polling interval and log retention need deciding rather than defaulting.
