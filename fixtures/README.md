# fixtures/

Recorded payloads from the real installation, used by both test suites so the
code is exercised against shapes the hardware actually emits rather than shapes
someone imagined. That distinction has caught several real bugs — a hand-authored
`get_view_state.json` once encoded the plate-solve at the wrong nesting depth and
made the Live screen report an idle scope while it was stacking.

## One field is deliberately not faithful

**`get_site_profile.json`'s coordinates are rounded to one decimal place** — about
11 km. The real values locate a house to roughly ten metres, and this repository
is public; the sister `seestar-mcp` project rewrote its entire git history to
strip exactly this category of data.

One decimal is enough for everything that reads them (Bortle context, horizon and
altitude logic, the sidebar's site block) and not enough to identify anyone. No
test asserts the precise values.

**If you re-record this fixture, round it again before committing.**

## Everything else is verbatim

`get_view_state.json` and `qa_tier1.json` were captured together during one live
session so their frame counts agree. `synthetic/` holds hand-built payloads for
states that cannot be recorded on demand — a stale frame, an unreachable share,
an absent stack — and is named `synthetic/` precisely so nobody mistakes them for
recordings.
