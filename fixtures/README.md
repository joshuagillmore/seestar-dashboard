# fixtures/

Recorded payloads from the real installation, used by both test suites so the
code is exercised against shapes the hardware actually emits rather than shapes
someone imagined. That distinction has caught several real bugs — a hand-authored
`get_view_state.json` once encoded the plate-solve at the wrong nesting depth and
made the Live screen report an idle scope while it was stacking.

## One field is deliberately not faithful

**`get_site_profile.json`'s site is entirely synthetic.** The coordinates and
elevation are Greenwich Royal Observatory — the origin of the prime meridian, and
the canonical reference point in astronomy — under the name `Example
Observatory`, which says outright that it is a placeholder. Between the two,
nothing here reads as somebody's garden.

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
session so their frame counts agree — both read 115 stacked, 0 dropped, and a
re-recording that breaks that agreement has caught a real bug before.
`synthetic/` holds hand-built payloads for states that cannot be recorded on
demand — a stale frame, an unreachable share, an absent stack — and is named
`synthetic/` precisely so nobody mistakes them for recordings.

One further caveat on "verbatim": `projects_combined.json` is a real recording
whose `nights` field was regenerated on its own when that field was added,
diffed against the previous copy to confirm nothing else moved. A full
end-to-end re-record would have pulled in unrelated in-flight changes.

Checked 2026-08-03: no fixture contains a local path, a username or the real
site. That is a property to re-check after any re-record, not one to assume.
