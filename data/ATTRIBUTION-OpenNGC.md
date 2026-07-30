# Attribution and licence — OpenNGC

`dso_catalog_extended.json` and `dso_aliases.json` in this directory are
**adapted material** derived from the OpenNGC database. This file is the
attribution notice required by that database's licence.

## Required notice

- **Title:** OpenNGC — a database of NGC and IC objects
- **Creator:** Mattia Verga
- **Source:** <https://github.com/mattiaverga/OpenNGC>
- **Licence:** Creative Commons Attribution-ShareAlike 4.0 International
  (CC BY-SA 4.0) — full legal code at
  <https://creativecommons.org/licenses/by-sa/4.0/legalcode>
- **Disclaimer:** the source database is provided by its creator without
  warranties of any kind, to the extent permitted by law. The same applies to
  the derived files here.

## Modifications made

These files are **modified** from the original. The adaptations are:

1. Rows whose OpenNGC `Type` is `Dup`, `*`, `**`, `*Ass`, `NonEx` or `Nova` are
   excluded from the catalogue (1,519 rows). `Dup` rows are retained in the
   alias index only, as redirects.
2. OpenNGC's `Type` vocabulary is mapped onto the eight-value vocabulary used by
   the `seestar-mcp` planning module. Genuinely ambiguous source types (`Neb`,
   `Cl+N`, `DrkN`, `Other`) are mapped to `other` unless a cross-check against
   SIMBAD's own object-type code resolves the ambiguity — see item 9.
3. RA/Dec are converted from sexagesimal to decimal degrees.
4. Identifiers are de-zero-padded (`NGC0281` → `NGC281`) and Messier numbers are
   preferred where present.
5. `V-Mag` is selected as the magnitude where available, falling back to `B-Mag`.
6. Columns not needed by this application are dropped.
7. Two objects outside OpenNGC's NGC/IC scope are merged in from other sources —
   see **Other sources** below.
8. The alias index drops professional survey cross-references (PGC, SDSS, MCG,
   IRAS and similar) and adds no data of its own.
9. One OpenNGC `Common names` value known to be wrong (`IC434`, see **Other
   sources**) is overridden; everywhere else, OpenNGC's own name is kept as-is.

Exact, reproducible details are in `build_catalogue.py`.

## Share-alike — what it binds

CC BY-SA 4.0 is a share-alike licence. **The obligation attaches to these data
files and to adaptations of them, not to this repository's source code.**
Distributing `dso_catalog_extended.json` or `dso_aliases.json`, modified or not,
requires carrying this attribution and licensing them under CC BY-SA 4.0 or a
compatible licence. The application code that reads them is unaffected and
remains under the repository's own licence.

## Other sources

`manual_additions.json` contains two objects OpenNGC does not cover, each with a
per-field `_source` citation recorded in that file. Their provenance:

- **SH2-142** — position from SIMBAD; angular size from VizieR **VII/20**,
  Sharpless, S. 1959, *ApJS* **4**, 257, "Catalogue of HII Regions".
- **LDN 1625** — position from SIMBAD, cross-checked against VizieR **VII/7A**,
  Lynds, B. T. 1962, *ApJS* **7**, 1, "Catalogue of Dark Nebulae"; angular size
  from SIMBAD, measured by Dutra & Bica 2002, *A&A* **383**, 631.

VizieR/CDS terms ask that the **original papers** be cited rather than the
service; the references above are those papers. Neither object has a magnitude
in any band, and none has been invented — see the `_source` notes for why the
quantity is not merely missing but undefined for a diffuse or dark nebula.

`simbad_types.json` also draws on SIMBAD (CDS, Strasbourg): every OpenNGC
object whose `Type` mapped to `other` was looked up there (batched, offline,
cached — not queried live during the build) so it could be reclassified where
SIMBAD's own object-type code is unambiguous, rather than left as `other` by
default or guessed. See that file's `_meta` for the exact code table and
query date, and `.superpowers/catalogue-extension-report.md` for the full
methodology and result. `name_overrides.json` corrects one OpenNGC `Common
names` value (`IC434`) that contradicts that same OpenNGC row's own `NED
notes` — a cited divergence from upstream, not a new external data source.
