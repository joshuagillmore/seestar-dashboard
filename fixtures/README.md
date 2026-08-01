# fixtures/

Recorded payloads from the real installation, used by both test suites so the
code is exercised against shapes the hardware actually emits rather than shapes
someone imagined. That distinction has caught several real bugs — a hand-authored
`get_view_state.json` once encoded the plate-solve at the wrong nesting depth and
made the Live screen report an idle scope while it was stacking.

## One field is deliberately not faithful

**`get_site_profile.json`'s site is entirely synthetic.** Name, coordinates and
elevation are Greenwich Royal Observatory — the origin of the prime meridian, and
the canonical reference point in astronomy. It is unmistakably a landmark rather
than somebody's garden.

The real values located a house to about ten metres, and this repository is
public; the sister `seestar-mcp` project rewrote its entire git history to strip
exactly this category of data. Rounding was tried first and rejected: an
11 km-accurate coordinate still names the city, which is most of the exposure.

Nothing depends on the values. Bortle, horizon and altitude logic all read fields
that are still real, and the only tests touching coordinates either validate the
schema or override them outright.

**If you re-record this fixture, replace the site block again before committing.**

## Everything else is verbatim

`get_view_state.json` and `qa_tier1.json` were captured together during one live
session so their frame counts agree. `synthetic/` holds hand-built payloads for
states that cannot be recorded on demand — a stale frame, an unreachable share,
an absent stack — and is named `synthetic/` precisely so nobody mistakes them for
recordings.
