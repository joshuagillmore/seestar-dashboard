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

## Everything computed *from* the site is synthetic too

Replacing the site block alone was not enough, and for a while it was all that
had been done. `plan_targets.json` still carried each target's peak altitude and
transit time, and `assess_conditions.json` the dark window — all computed at the
real site. Peak altitude against a catalogue declination gives latitude; transit
time against right ascension gives longitude. Three targets agreed on the real
location to about 10–20 km: the same city-level exposure the rounding above was
rejected for.

So every site-derived value in `plan_targets.json`, `assess_conditions.json` and
`synthetic/assess_conditions.*.json` — dark windows, best windows, transits, peak
altitudes, sweet-band minutes, moon separations and the reason strings quoting
them — is recomputed by seestar-mcp's own planner (`planning.astro` /
`planning.ranker`, called in-process) at the Greenwich site above. Everything
else in those payloads — scores, ordering, weather, project notes — is as
recorded.

The night is also moved **59 days later** (e.g. 2026-07-30 → 2026-09-26). At
Greenwich in late July astronomical dark lasts about 2.4 h, which collapsed all
twelve targets onto one identical window and lost the above-ceiling transits the
recording exercised. 59 days is two synodic months, so the moon phase is
unchanged and the recording's moon and weather text still holds. The shifted
night crosses UTC midnight, which the original did not.

**A re-record needs the same treatment:** run the planner against the synthetic
site rather than hand-editing numbers, or the geometry will again point home.

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
site. Re-checked 2026-09-22 for values *derived* from the site, which the first
check missed (see above). Both are properties to re-check after any re-record,
not ones to assume.
