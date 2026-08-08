# data/

An extended deep-sky-object catalogue for the observing planner, generated from
OpenNGC, plus a small alias index and two manually-sourced objects OpenNGC
doesn't cover.

This directory is **data and its generator only** — no code here is imported by
anything. The two JSON files, however, **are** read at runtime: the sidecar
loads them through `seestar_sidecar/catalog.py` (`DEFAULT_CATALOG_PATH` /
`DEFAULT_ALIASES_PATH`, resolved relative to the repo root) so that
`projects_union.py` can turn a target id into a catalogue record and hand it to
`integration_goal.suggest_integration_goal()`, and so `imagery.py` can find a
target's coordinates for a survey cutout. The alias index is what makes `C33`
and `NGC2244` resolve at all.

`catalog.py` duplicates `build_catalogue.py`'s `normalise_alias()` rather than
importing it, precisely because `data/` is a generator directory and not a
package the sidecar depends on — the two must be kept in step by hand, which
`sidecar/tests/test_catalog.py` checks against known transforms.

Wiring the catalogue into **`seestar-mcp`'s own planner** is the part that is
still outstanding, and it is hand-back work — see
[`docs/handback-to-seestar-ai.md`](../docs/handback-to-seestar-ai.md) item 11,
which also records why the catalogue must not be adopted there without
vectorising the observability computation first.

## Files

| File | What it is |
|---|---|
| `dso_catalog_extended.json` | The catalogue: one JSON array of `{id, name, ra_deg, dec_deg, type, size_arcmin, magnitude}`, exactly the shape of the server's `SeeStar-AI/src/seestar_mcp/planning/data/dso_catalog.json` (110 Messier + 10 showpieces) so it can be dropped in as a replacement. 12,517 objects. |
| `dso_aliases.json` | A sibling lookup table: every other designation OpenNGC records for an object (Caldwell, cross-catalogue Messier/NGC/IC forms, common names, and the redirect target of every excluded `Dup` row) mapped to that object's id in the file above. Not embedded in the catalogue itself, because that file has to stay a bare array to remain a drop-in replacement. |
| `manual_additions.json` | Two objects (`SH2-142`, `LDN1625`) outside OpenNGC's NGC/IC scope entirely. Each field carries a `_source` citation (SIMBAD / VizieR, with retrieval date) — see that file's `_readme`. |
| `simbad_types.json` | A **committed, offline cache** of raw SIMBAD facts (main object type + full object-type list) for every object whose OpenNGC `Type` was ambiguous (`Neb`/`Cl+N`/`DrkN`/`Other`, 583 objects) — never a live query during the build, and the build fails loudly if this file is missing. The reclassification *rule* itself lives as code in `build_catalogue.py` (`GALAXY_OTYPES`, `SIMBAD_OTYPE_MAP`, `resolve_simbad_type`), not in this cache. See its `_meta` for citation and counts. |
| `name_overrides.json` | A small, cited list of corrections to OpenNGC `Common names` values that contradict that same row's own `NED notes` (one entry: `IC434`). See its `_readme`. |
| `alias_overrides.json` | A small, cited list of extra aliases for an object that already exists correctly in the OpenNGC-derived catalogue — not a new object (that's what `manual_additions.json` is for). One entry: `NGC2238` (Rosette Nebula) gains `Rosette`/`Sh2-275`/`SH2-275` as aliases. See its `_readme`. |
| `build_catalogue.py` | The generator. Re-runnable; see below. |
| `ATTRIBUTION-OpenNGC.md` | The CC BY-SA 4.0 attribution and licence notice this data requires, the list of modifications made, and the Sharpless/Lynds paper citations for the two manual additions. **Read this before redistributing either JSON file.** |
| `openngc/` | Where the raw source CSVs go locally. **Gitignored** — never commit these (see below). |

## Licence — the short version

`dso_catalog_extended.json` and `dso_aliases.json` are adapted from OpenNGC
(CC BY-SA 4.0, © Mattia Verga). That licence's share-alike condition binds
**these two data files and anything adapted from them — not this repository's
application code**, which stays under the repo's own licence ([MIT](../LICENSE)). Full notice,
required attribution text, and the exact list of modifications: see
`ATTRIBUTION-OpenNGC.md`. The CC BY-SA 4.0 legal code itself allows satisfying
its "include the licence" condition with a link rather than the full text
(Section 3(a)(1)(c)); `ATTRIBUTION-OpenNGC.md` links to
<https://creativecommons.org/licenses/by-sa/4.0/legalcode>.

## Regenerating

The raw OpenNGC CSVs (`NGC.csv` is ~3.7 MB) are **not committed**. Download
them and point the generator at the folder holding both:

```
mkdir -p data/openngc
curl -Lo data/openngc/NGC.csv https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv
curl -Lo data/openngc/addendum.csv https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv
uv run python data/build_catalogue.py
```

`--source-dir` points at a different folder if you keep the CSVs elsewhere;
`--ngc-csv`/`--addendum-csv` override the individual paths. Every run prints a
provenance header — the SHA-256 of whatever it actually read — to stderr, so a
regeneration can be checked against the known-good snapshot the committed
`dso_catalog_extended.json` was built from:

`simbad_types.json` and `name_overrides.json` are also required — both are
committed, offline caches (not fetched live during the build), and the script
fails loudly rather than silently skipping either if they're missing.

| File | SHA-256 |
|---|---|
| `NGC.csv` | `be150bdaa1997dacbcb39f303074403edec7a953b589b36d5f1c4522c0cc6fae` |
| `addendum.csv` | `1d8f0914e643ada325a5a94d88d8fefad6a4937a2f77cc34f21483af22b11983` |

If OpenNGC has released a newer snapshot, the hashes (and likely some counts)
will differ — that's expected, not an error; re-run the verification checks in
`.superpowers/catalogue-extension-report.md`'s method before treating the new
output as good.

## Filtering and type-mapping, briefly

Every real object is included regardless of size or magnitude — the ranker,
not the catalogue, decides nightly suitability. Only OpenNGC `Type` values that
aren't real deep-sky objects are dropped (`Dup`, `*`, `**`, `*Ass`, `NonEx`,
`Nova`); `Dup` rows are kept in the alias index as redirects rather than
discarded outright. OpenNGC's `Type` vocabulary is mapped onto the server's
`TARGET_TYPES`; genuinely ambiguous source types (`Neb`, `Cl+N`, `DrkN`,
`Other`) map to `other` rather than a guess, since the light-pollution model
keys off `type` and a wrong guess would silently produce a wrong score.

An object that lands in `other` gets a second chance: `simbad_types.json`
records both SIMBAD's *main* object type and its *full* object-type list for
every one of them, looked up ahead of time (not live during the build). A
verified galaxy-type main code reclassifies to `galaxy`; failing that, "HII"
anywhere in the full type list reclassifies to `emission_nebula` regardless
of the main type (catches a star cluster whose SIMBAD "main" classification
names the cluster even though it's embedded in — and, for imaging, dominated
by — an HII region); failing that, the main type alone; otherwise `other`
stays `other` — never reclassified on judgement. See the module docstring,
`GALAXY_OTYPES`/`SIMBAD_OTYPE_MAP`/`resolve_simbad_type` in
`build_catalogue.py` for the full rule, and
`.superpowers/catalogue-extension-report.md` for what it changes in practice.

**8 objects SIMBAD itself flags `err`** ("Not an Object (Error, Artefact,
…)"), including the Messier object `M73`, **stay in the catalogue, typed
`other`, and are not excluded** — a third-party flag isn't grounds to
silently drop a catalogued object, and someone looking for `M73` and finding
nothing would reasonably read that as a bug rather than a documented
judgement call.

**SIMBAD coverage limit, verified rather than assumed**: 311 of the 583
`other`-typed objects queried against SIMBAD (53%) have no SIMBAD record at
all. This was checked, not just accepted — three independent ways (a
differently-shaped re-batch of 40 objects, a common-name cross-check, and
hand-checks against SIMBAD's actual web-lookup endpoint for a fresh 5) all
confirm it's a real coverage limit of this "other"-typed subset (which is,
by construction, exactly the set OpenNGC itself couldn't confidently
classify), not a bug in this generator's SIMBAD queries. See
`.superpowers/catalogue-extension-report.md`, "Diagnosing the not-found
rate", for the full methodology.

**The Rosette Nebula** is `NGC2238` (`emission_nebula`, unambiguous from the
very first OpenNGC pass — its `Type` was always `HII`). `NGC2237` ("Rosette
A", a nebula fragment) and `NGC2239`/`NGC2244` (the embedded open cluster)
are separate, correctly-typed rows for the same complex. `Rosette`,
`C49`/`Caldwell 49` and `Sh2-275`/`SH2-275` all resolve to `NGC2238` via
`data/alias_overrides.json`.
