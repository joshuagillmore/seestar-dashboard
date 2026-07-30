#!/usr/bin/env python
"""Regenerate ``data/dso_catalog_extended.json`` from OpenNGC + a small manual list.

Source data
-----------
OpenNGC (https://github.com/mattiaverga/OpenNGC), CC-BY-SA-4.0. The raw CSVs
are **not committed** (``NGC.csv`` is ~3.7 MB; see ``.gitignore``) — download
them yourself and point ``--source-dir`` at the folder holding both:

    curl -LO https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv
    curl -LO https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv

The known-good snapshot this repo's committed ``dso_catalog_extended.json``
was built from has SHA-256 hashes recorded in ``data/README.md``; every run of
this script prints the hashes of whatever it actually read (its "provenance
header") so you can diff your snapshot against that record. ``--ngc-csv`` /
``--addendum-csv`` override the individual paths if you keep them elsewhere.

A handful of objects the user tracks fall outside OpenNGC's NGC/IC scope
entirely (Sharpless HII regions, Lynds dark nebulae). Those are carried in
``data/manual_additions.json``, each with an explicit ``_source`` citation —
see that file's ``_readme``.

Two further, smaller committed inputs refine the OpenNGC pass rather than
replacing it — both are **required, offline caches**: this script fails
loudly if either is missing rather than silently building without them.

* ``data/simbad_types.json`` — every object whose OpenNGC ``Type`` mapped to
  ``other`` (ambiguous ``Neb``/``Cl+N``/``DrkN``/``Other``) was looked up
  against SIMBAD (batched ``sim-script`` queries, not a live call during the
  build). The cache stores SIMBAD *facts* only — the main otype and the full
  otype list (an object can genuinely be more than one thing: a star cluster
  embedded in an HII region is both, and SIMBAD's "main" code for the row
  sometimes names the cluster). The reclassification *rule* lives here, as
  code, not baked into the cache: ``GALAXY_OTYPES``, ``SIMBAD_OTYPE_MAP`` and
  ``resolve_simbad_type`` (a galaxy-coded main otype always wins; failing
  that, "HII" anywhere in the full otype list means emission nebula
  regardless of the main otype; failing that, the main otype alone; failing
  that, stays ``other``). See ``apply_simbad_reclassification`` and that
  file's ``_meta`` for citation and counts.
* ``data/name_overrides.json`` — corrects OpenNGC ``Common names`` values that
  contradict that same row's own ``NED notes`` (found by audit: e.g. IC434's
  Common name is "Flame Nebula", but IC434's own NED note says the Horsehead
  is an absorption patch *in* it — the Flame Nebula is the separate NGC 2024,
  which has no Common name in OpenNGC at all). A deliberate, cited divergence
  from upstream, not a bug in this generator — see that file's ``_readme``.

Output shape
------------
Matches ``SeeStar-AI/src/seestar_mcp/planning/data/dso_catalog.json`` exactly:
a JSON array of ``{id, name, ra_deg, dec_deg, type, size_arcmin, magnitude}``,
one object per line. ``type`` is one of the server's ``TARGET_TYPES``
(``seestar_mcp.planning.catalog``); ``size_arcmin``/``magnitude`` are ``null``
when OpenNGC has no measurement, rather than fabricated. A sibling file,
``data/dso_aliases.json``, maps every other designation OpenNGC records for an
object (Caldwell, cross-catalogue Messier/NGC/IC forms, common names, and the
canonical target of every excluded ``Dup`` row) to that object's id — see
``normalise_alias`` below for the lookup key convention.

Usage
-----
    uv run python data/build_catalogue.py
    uv run python data/build_catalogue.py --source-dir path/to/openngc/checkout

Prints a verification summary (counts, type breakdown, duplicate ids, alias
counts) to stderr; a fuller report with the user's target-list check and a
spot-check against the existing 120-object catalogue is a separate,
uncommitted artifact (see the docstring in this repo's hand-back notes for
that run).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE_DIR = REPO_ROOT / "data" / "openngc"
DEFAULT_MANUAL_ADDITIONS = REPO_ROOT / "data" / "manual_additions.json"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "dso_catalog_extended.json"
DEFAULT_ALIASES = REPO_ROOT / "data" / "dso_aliases.json"
DEFAULT_SIMBAD_TYPES = REPO_ROOT / "data" / "simbad_types.json"
DEFAULT_NAME_OVERRIDES = REPO_ROOT / "data" / "name_overrides.json"
DEFAULT_ALIAS_OVERRIDES = REPO_ROOT / "data" / "alias_overrides.json"

# Where the two source CSVs live upstream — echoed in the "file not found"
# error and the provenance header so regenerating never requires guessing.
NGC_CSV_URL = "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv"
ADDENDUM_CSV_URL = (
    "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv"
)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()

# OpenNGC "Type" values that are not real deep-sky objects for our purposes:
# duplicate catalogue entries, stars/double-stars/associations, objects later
# found not to exist, and novae. Every other Type is a real DSO and is kept
# regardless of size or magnitude — the ranker, not the catalogue, decides
# nightly suitability.
EXCLUDE_TYPES = {"Dup", "*", "**", "*Ass", "NonEx", "Nova"}

# OpenNGC Type -> the server's TARGET_TYPES vocabulary
# (seestar_mcp.planning.catalog.TARGET_TYPES). Unambiguous mappings first;
# genuinely ambiguous OpenNGC types map to "other" rather than a guess — see
# the catalogue-extension report for the rationale and the resulting count.
TYPE_MAP: dict[str, str] = {
    "G": "galaxy",
    "GPair": "galaxy",
    "GTrpl": "galaxy",
    "GGroup": "galaxy",
    "OCl": "open_cluster",
    "GCl": "globular_cluster",
    "PN": "planetary_nebula",
    "SNR": "supernova_remnant",
    "RfN": "reflection_nebula",
    "HII": "emission_nebula",
    "EmN": "emission_nebula",
    # Ambiguous: could be emission or reflection ("Neb"), is genuinely both
    # ("Cl+N"), or has no equivalent in the vocabulary and is an absorption
    # feature rather than an emitter ("DrkN"). Mapping any of these to a
    # specific emitter/broadband type would tell the light-pollution model
    # something we don't actually know.
    "Neb": "other",
    "Cl+N": "other",
    "DrkN": "other",
    "Other": "other",
}

# --- SIMBAD reclassification of the "other" objects above -----------------
# Every code below is verified against SIMBAD's authoritative otype
# dictionary (http://simbad.cds.unistra.fr/guide/otypes/json/otype_nodes.json,
# fetched 2026-07-30) and cross-checked against live sim-script responses for
# this catalogue's 583 "other"-typed objects. See
# .superpowers/catalogue-extension-report.md for the full methodology.

#: SIMBAD main-otype (``otype3``) codes that mean "this is a galaxy". Checked
#: first, ahead of the HII-list discriminator below: an HII-tagged galaxy
#: (``H2G``, or a galaxy with an associated star-forming region noted in its
#: type list) is still a galaxy for imaging/light-pollution purposes, not a
#: nebula. In this catalogue's actual data no object has both a galaxy main
#: otype and "HII" in its full type list, so the ordering doesn't change any
#: current result, but it's the astronomically correct priority.
GALAXY_OTYPES = {
    "G", "GiG", "GiC", "GiP", "BiC", "IG", "PaG", "GrG", "CGG", "LSB", "SBG",
    "bCG", "EmG", "rG", "H2G", "LIN",
}
#: Deliberately NOT included: "AG?" is the *candidate-AGN* marker (SIMBAD's
#: own otype dictionary: node "AGN" has candidate="AG?"), not a distinct
#: galaxy code -- excluded for the same reason as "QSO"/"BLL"/"Sy1"/"Sy2"/
#: "AGN" themselves (active-nucleus classifications, effectively point
#: sources at this aperture). "PoG" ("Part of a Galaxy") is a real code but
#: SIMBAD files it under blends/errors/not-well-defined, not galaxy taxonomy,
#: and wasn't requested -- left as "other" rather than added unilaterally.

#: SIMBAD main-otype codes mapped directly, once the galaxy check above and
#: the HII-list discriminator below have both had a chance to fire first.
SIMBAD_OTYPE_MAP: dict[str, str] = {
    "HII": "emission_nebula",
    "SFR": "emission_nebula",
    "EmO": "emission_nebula",
    "RNe": "reflection_nebula",  # verified real SIMBAD code; "RfN" does not exist
    "PN": "planetary_nebula",
    "SNR": "supernova_remnant",
    "OpC": "open_cluster",
    "GlC": "globular_cluster",
}


def resolve_simbad_type(otype3: str | None, otype_list: list[str]) -> str | None:
    """Reclassify an ``other``-typed object from SIMBAD facts, or return
    ``None`` to leave it ``other``.

    Order matters: (1) a galaxy-coded main otype is always a galaxy; (2) an
    object whose *full* otype list contains ``HII`` is an emission nebula
    regardless of what its main otype says -- this is what catches a
    cluster-plus-nebula complex (e.g. the Wizard Nebula's embedded cluster,
    SIMBAD main otype ``OpC``) whose HII region is real but isn't the "main"
    classification for that specific catalogue row; (3) otherwise fall back
    to the main otype alone; (4) otherwise stay ``other``.
    """
    if otype3 in GALAXY_OTYPES:
        return "galaxy"
    if "HII" in otype_list:
        return "emission_nebula"
    return SIMBAD_OTYPE_MAP.get(otype3)


# Matches an OpenNGC "Name" like "NGC0224", "IC0080 NED01", "IC0186A",
# "ESO056-115", "PGC000143", "C009": an alpha prefix, a zero-padded number,
# and an optional suffix (component letters, " NEDnn", a dash-suffix, etc).
_DESIGNATION_RE = re.compile(r"^([A-Za-z]+)0*(\d+)(.*)$")

# A bare Messier id, e.g. "M16" — used to break alias ties toward the
# designation a person is most likely to mean.
_MESSIER_ID_RE = re.compile(r"^M\d+$")

# Professional survey cross-references that no one types into a telescope app.
# The alias index exists so a target can be found by the name the *user* uses —
# what their archive folders are called, what a project is named, what they type
# — which in practice means Messier, NGC/IC, Caldwell, Sharpless, Lynds and
# common names. Dropping these prefixes removes ~30k of ~52k entries and more
# than half the file size without losing a designation anyone would reach for.
# Visual-observer catalogues (UGC, ESO, LBN, PK, Collinder, Melotte…) are kept.
_ALIAS_PREFIX_DENYLIST = (
    "PGC", "SDSSJ", "SDSS", "MCG", "IRAS", "LEDA", "2MASX", "2MASS",
    "TYC", "HD", "HIP", "BD", "GSC", "WISEA", "AKARI", "CGCG", "VV",
)
_ALIAS_DENY_RE = re.compile(rf"^({'|'.join(_ALIAS_PREFIX_DENYLIST)})\d")


def designation_id(name: str) -> str:
    """Turn an OpenNGC ``Name`` into the server's id convention: no zero
    padding (``NGC281`` not ``NGC0281``), no spaces."""
    name = name.strip()
    m = _DESIGNATION_RE.match(name)
    if not m:
        return name.replace(" ", "")
    prefix, num, rest = m.groups()
    return f"{prefix}{num}{rest}".replace(" ", "")


def normalise_alias(token: str) -> str:
    """Fold any way of writing a designation onto one key.

    ``"C 033"``, ``"C033"`` and ``"C33"`` all become ``"C33"``; a common name
    like ``"Eastern Veil"`` becomes ``"EASTERN VEIL"``. Lookups normalise the
    user's input the same way, so the caller never has to know which form the
    catalogue happened to store.
    """
    token = " ".join(token.strip().split())
    if not token:
        return ""
    compact = token.replace(" ", "")
    m = _DESIGNATION_RE.match(compact)
    if m:
        prefix, num, rest = m.groups()
        return f"{prefix.upper()}{num}{rest.upper()}"
    return token.upper()


def build_id(row: dict[str, str]) -> str:
    """Prefer Messier over the OpenNGC designation, per the hand-off spec."""
    m_field = row.get("M", "").strip()
    if m_field:
        return f"M{int(m_field)}"
    return designation_id(row["Name"])


def pick_name(row: dict[str, str], fallback_id: str) -> str:
    """First OpenNGC common name, else the designation itself."""
    common = (row.get("Common names") or "").strip()
    if common:
        first = common.split(",")[0].strip()
        if first:
            return first
    return fallback_id


def parse_ra(raw: str) -> float:
    """OpenNGC RA is ``HH:MM:SS.ss`` J2000 -> decimal degrees."""
    h, m, s = raw.strip().split(":")
    return round((float(h) + float(m) / 60 + float(s) / 3600) * 15, 3)


def parse_dec(raw: str) -> float:
    """OpenNGC Dec is ``+DD:MM:SS.s`` / ``-DD:MM:SS.s`` J2000 -> decimal degrees."""
    raw = raw.strip()
    sign = -1.0 if raw.startswith("-") else 1.0
    d, m, s = raw.lstrip("+-").split(":")
    return round(sign * (float(d) + float(m) / 60 + float(s) / 3600), 3)


def pick_size(row: dict[str, str]) -> float | None:
    """Largest angular extent (arcmin), or ``None`` if OpenNGC has no MajAx."""
    majax = (row.get("MajAx") or "").strip()
    return round(float(majax), 1) if majax else None


def pick_magnitude(row: dict[str, str]) -> float | None:
    """Prefer V-Mag (matches the existing catalogue's values, e.g. M31 =
    3.4 = OpenNGC's V-Mag 3.44, not its B-Mag 4.29); fall back to B-Mag;
    ``None`` if OpenNGC has neither."""
    v = (row.get("V-Mag") or "").strip()
    if v:
        return round(float(v), 1)
    b = (row.get("B-Mag") or "").strip()
    if b:
        return round(float(b), 1)
    return None


def load_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh, delimiter=";"))


class Builder:
    """Accumulates rows across NGC.csv/addendum.csv/manual additions, tracking
    duplicate ids and unmapped types so nothing is silently dropped."""

    def __init__(self) -> None:
        self.objects: list[dict] = []
        self.seen_ids: dict[str, str] = {}  # id -> originating Name/source
        self.duplicates: list[tuple[str, str, str]] = []  # id, first source, dupe source
        self.unmapped_types: Counter[str] = Counter()
        self.excluded_count = 0
        self.type_counts: Counter[str] = Counter()
        # Alias support. ``designation_to_id`` maps every included row's own
        # OpenNGC designation to the id we chose for it (which may be a Messier
        # number instead), so a ``Dup`` row naming "NGC0281" can be resolved to
        # whatever that object ended up being called.
        self.designation_to_id: dict[str, str] = {}
        self.dup_rows: list[dict[str, str]] = []
        self.aliases: dict[str, str] = {}
        self.alias_conflicts: list[tuple[str, str, str]] = []  # alias, kept, rejected
        self.unresolved_dups: list[str] = []

    def add_from_csv(self, rows: list[dict[str, str]]) -> None:
        for row in rows:
            t = row["Type"].strip()
            if t in EXCLUDE_TYPES:
                self.excluded_count += 1
                # A ``Dup`` row is not junk: it records a designation that
                # redirects to a real object (NGC 2244 -> NGC 2239). Excluding
                # it from the catalogue is right; discarding the redirect is
                # not, because it is often the name the user actually types.
                if t == "Dup":
                    self.dup_rows.append(row)
                continue
            mapped = TYPE_MAP.get(t)
            if mapped is None:
                self.unmapped_types[t] += 1
                continue
            obj_id = build_id(row)
            if obj_id in self.seen_ids:
                self.duplicates.append((obj_id, self.seen_ids[obj_id], row["Name"]))
                continue
            self.seen_ids[obj_id] = row["Name"]
            self.designation_to_id[normalise_alias(row["Name"])] = obj_id
            self.type_counts[mapped] += 1
            self._harvest_aliases(row, obj_id)
            self.objects.append(
                {
                    "id": obj_id,
                    "name": pick_name(row, obj_id),
                    "ra_deg": parse_ra(row["RA"]),
                    "dec_deg": parse_dec(row["Dec"]),
                    "type": mapped,
                    "size_arcmin": pick_size(row),
                    "magnitude": pick_magnitude(row),
                }
            )

    def _register_alias(self, raw: str, obj_id: str) -> None:
        key = normalise_alias(raw)
        if not key or key == obj_id or _ALIAS_DENY_RE.match(key):
            return
        existing = self.aliases.get(key)
        if existing is not None and existing != obj_id:
            # Two objects claim the same alias — almost always a common name
            # shared by an interacting pair ("Antennae Galaxies") or by a
            # nebula and the cluster inside it ("Eagle Nebula" = IC 4703 and
            # M 16). Prefer the Messier designation: someone typing a common
            # name means the famous object, not whichever row came first.
            if _MESSIER_ID_RE.match(obj_id) and not _MESSIER_ID_RE.match(existing):
                self.alias_conflicts.append((key, obj_id, existing))
                self.aliases[key] = obj_id
                return
            self.alias_conflicts.append((key, existing, obj_id))
            return
        self.aliases[key] = obj_id

    def _harvest_aliases(self, row: dict[str, str], obj_id: str) -> None:
        """Index every other designation OpenNGC records for this object.

        ``Identifiers`` is where the Caldwell numbers live (``C 033`` for the
        Eastern Veil), alongside LBN/MWSC/PGC and friends. Without this the
        catalogue contains the object but cannot be found by the name on the
        user's own target list.
        """
        self._register_alias(row["Name"], obj_id)
        m_field = row.get("M", "").strip()
        if m_field:
            self._register_alias(f"M{int(m_field)}", obj_id)
        for column in ("NGC", "IC"):
            value = (row.get(column) or "").strip()
            if value:
                self._register_alias(f"{column}{value}", obj_id)
        for token in (row.get("Identifiers") or "").split(","):
            if token.strip():
                self._register_alias(token, obj_id)
        for token in (row.get("Common names") or "").split(","):
            if token.strip():
                self._register_alias(token, obj_id)

    def add_manual(self, path: Path) -> None:
        data = json.loads(path.read_text(encoding="utf-8"))
        for obj in data["objects"]:
            clean = {k: v for k, v in obj.items() if not k.startswith("_")}
            obj_id = clean["id"]
            if obj_id in self.seen_ids:
                self.duplicates.append((obj_id, self.seen_ids[obj_id], "manual_additions.json"))
                continue
            self.seen_ids[obj_id] = "manual_additions.json"
            self.designation_to_id[normalise_alias(obj_id)] = obj_id
            self.type_counts[clean["type"]] += 1
            self._register_alias(clean["name"], obj_id)
            for extra in obj.get("_aliases", []):
                self._register_alias(extra, obj_id)
            self.objects.append(clean)

    def finalise_aliases(self) -> None:
        """Resolve ``Dup`` redirects, then drop anything that would shadow a
        real id. Must run after every source has been added."""
        for row in self.dup_rows:
            target_id = None
            for column in ("NGC", "IC"):
                value = (row.get(column) or "").strip()
                if value:
                    target_id = self.designation_to_id.get(normalise_alias(f"{column}{value}"))
                    if target_id:
                        break
            if target_id is None:
                self.unresolved_dups.append(row["Name"].strip())
                continue
            self._register_alias(row["Name"], target_id)

        # A real object's own id always wins over an alias pointing elsewhere.
        for obj_id in self.seen_ids:
            self.aliases.pop(obj_id, None)

    def apply_simbad_reclassification(self, cache: dict) -> tuple[int, Counter]:
        """Reclassify ``other``-typed objects using the committed SIMBAD cache.

        Only ever moves an object *out of* ``other`` (never into it). The
        cache holds SIMBAD *facts* only (``otype3``, ``otype_list``); the
        reclassification rule itself is ``resolve_simbad_type`` above, kept
        as versioned code rather than a value baked into the cache. An
        object absent from the cache, or present but unresolved/ambiguous at
        SIMBAD, is left as ``other`` — that is the correct, honest outcome,
        not a gap.
        """
        entries = cache.get("objects", {})
        reclassified = 0
        gained: Counter[str] = Counter()
        for obj in self.objects:
            if obj["type"] != "other":
                continue
            entry = entries.get(obj["id"])
            if not entry or entry.get("status") != "resolved":
                continue
            new_type = resolve_simbad_type(entry.get("otype3"), entry.get("otype_list", []))
            if not new_type or new_type == "other":
                continue
            self.type_counts["other"] -= 1
            self.type_counts[new_type] += 1
            obj["type"] = new_type
            reclassified += 1
            gained[new_type] += 1
        return reclassified, gained

    def apply_name_overrides(self, overrides: dict) -> list[str]:
        """Apply cited corrections to OpenNGC ``Common names`` values that
        contradict that same row's own NED notes (see ``data/name_overrides.json``).
        """
        applied = []
        by_id = {o["id"]: o for o in self.objects}
        for entry in overrides.get("overrides", []):
            obj = by_id.get(entry["id"])
            if obj is None:
                continue
            obj["name"] = entry["corrected_name"]
            applied.append(entry["id"])
        return applied

    def apply_alias_overrides(self, overrides: dict) -> list[tuple[str, str]]:
        """Register extra, cited aliases for objects that already exist
        correctly (see ``data/alias_overrides.json``) -- not new objects.
        Errors loudly if a target id doesn't exist, so this can't silently
        create a dangling alias.
        """
        applied = []
        for entry in overrides.get("overrides", []):
            obj_id = entry["id"]
            if obj_id not in self.seen_ids:
                raise SystemExit(
                    f"alias_overrides.json names id {obj_id!r}, which isn't in the "
                    "catalogue -- fix the override or the id."
                )
            for alias in entry.get("aliases", []):
                self._register_alias(alias, obj_id)
                applied.append((alias, obj_id))
        return applied


def write_output(objects: list[dict], path: Path) -> None:
    """Write one JSON object per line, matching dso_catalog.json's style."""
    lines = ["["]
    for i, obj in enumerate(objects):
        line = json.dumps(obj, ensure_ascii=False)
        comma = "," if i < len(objects) - 1 else ""
        lines.append(f"  {line}{comma}")
    lines.append("]")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=DEFAULT_SOURCE_DIR,
        help="Folder holding NGC.csv and addendum.csv (default: data/openngc/, gitignored).",
    )
    parser.add_argument("--ngc-csv", type=Path, default=None, help="Override NGC.csv path.")
    parser.add_argument(
        "--addendum-csv", type=Path, default=None, help="Override addendum.csv path."
    )
    parser.add_argument("--manual-additions", type=Path, default=DEFAULT_MANUAL_ADDITIONS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--aliases", type=Path, default=DEFAULT_ALIASES)
    parser.add_argument("--simbad-types", type=Path, default=DEFAULT_SIMBAD_TYPES)
    parser.add_argument("--name-overrides", type=Path, default=DEFAULT_NAME_OVERRIDES)
    parser.add_argument("--alias-overrides", type=Path, default=DEFAULT_ALIAS_OVERRIDES)
    args = parser.parse_args()

    ngc_csv = args.ngc_csv or args.source_dir / "NGC.csv"
    addendum_csv = args.addendum_csv or args.source_dir / "addendum.csv"

    for p, url in ((ngc_csv, NGC_CSV_URL), (addendum_csv, ADDENDUM_CSV_URL)):
        if not p.exists():
            print(
                f"error: {p} not found.\n"
                f"Download it from {url}\n"
                f"e.g.: curl -Lo {p} {url}\n"
                "Then either save both CSVs under --source-dir "
                f"(default {DEFAULT_SOURCE_DIR}) or pass --ngc-csv/--addendum-csv directly. "
                "The known-good SHA-256 for each file is recorded in data/README.md — "
                "compare it against this run's provenance header below once both files exist.",
                file=sys.stderr,
            )
            return 1

    # Both are committed, offline caches, not live network calls during the
    # build — fail loudly rather than silently building without them, since a
    # silent skip here would mean "other" objects that should reclassify
    # quietly don't, and a wrong upstream name quietly ships uncorrected.
    for p, what in (
        (args.simbad_types, "SIMBAD object-type cache"),
        (args.name_overrides, "name-override list"),
    ):
        if not p.exists():
            print(
                f"error: {p} not found. This is a committed, offline {what} — "
                "it is not fetched live during the build. If it is genuinely "
                "missing, regenerate it (see the module docstring) rather than "
                "running without it.",
                file=sys.stderr,
            )
            return 1
    simbad_cache = json.loads(args.simbad_types.read_text(encoding="utf-8"))
    name_overrides = json.loads(args.name_overrides.read_text(encoding="utf-8"))

    # Provenance header: exactly what was read, so a regeneration can be
    # checked against the hashes recorded in data/README.md without shipping
    # the ~3.7 MB source CSVs in the repo.
    print("Provenance:", file=sys.stderr)
    for p, url in ((ngc_csv, NGC_CSV_URL), (addendum_csv, ADDENDUM_CSV_URL)):
        print(f"  {p.name}: sha256={sha256_of(p)} source={url}", file=sys.stderr)

    builder = Builder()
    builder.add_from_csv(load_csv_rows(ngc_csv))
    builder.add_from_csv(load_csv_rows(addendum_csv))
    if args.manual_additions.exists():
        builder.add_manual(args.manual_additions)
    builder.finalise_aliases()

    other_before = builder.type_counts["other"]
    reclassified, gained = builder.apply_simbad_reclassification(simbad_cache)
    overrides_applied = builder.apply_name_overrides(name_overrides)
    alias_overrides_applied: list[tuple[str, str]] = []
    if args.alias_overrides.exists():
        alias_overrides_applied = builder.apply_alias_overrides(
            json.loads(args.alias_overrides.read_text(encoding="utf-8"))
        )

    write_output(builder.objects, args.output)
    # A sibling file, not a key inside the catalogue: dso_catalog_extended.json
    # has to stay a drop-in replacement for the server's dso_catalog.json, and
    # that file is a bare JSON array.
    args.aliases.write_text(
        json.dumps(dict(sorted(builder.aliases.items())), ensure_ascii=False, indent=0) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {len(builder.objects)} objects to {args.output}", file=sys.stderr)
    print(f"Excluded (Dup/*/**/*Ass/NonEx/Nova): {builder.excluded_count}", file=sys.stderr)
    print("Type counts:", file=sys.stderr)
    for t, c in builder.type_counts.most_common():
        print(f"  {t}: {c}", file=sys.stderr)
    with_mag = sum(1 for o in builder.objects if o["magnitude"] is not None)
    with_size = sum(1 for o in builder.objects if o["size_arcmin"] is not None)
    with_both = sum(
        1 for o in builder.objects if o["magnitude"] is not None and o["size_arcmin"] is not None
    )
    print(f"With magnitude: {with_mag}/{len(builder.objects)}", file=sys.stderr)
    print(f"With size: {with_size}/{len(builder.objects)}", file=sys.stderr)
    print(f"With both: {with_both}/{len(builder.objects)}", file=sys.stderr)
    if builder.unmapped_types:
        print(f"WARNING — unmapped types (skipped): {dict(builder.unmapped_types)}", file=sys.stderr)
    if builder.duplicates:
        print(f"WARNING — {len(builder.duplicates)} duplicate id(s):", file=sys.stderr)
        for obj_id, first_src, dupe_src in builder.duplicates:
            print(f"  {obj_id}: kept {first_src!r}, dropped {dupe_src!r}", file=sys.stderr)

    print(f"Wrote {len(builder.aliases)} aliases to {args.aliases}", file=sys.stderr)
    print(f"  resolved from Dup redirects: {len(builder.dup_rows) - len(builder.unresolved_dups)}"
          f"/{len(builder.dup_rows)}", file=sys.stderr)
    if builder.unresolved_dups:
        print(f"  unresolved Dup rows ({len(builder.unresolved_dups)}): "
              f"{builder.unresolved_dups[:10]}", file=sys.stderr)
    if builder.alias_conflicts:
        print(f"  {len(builder.alias_conflicts)} alias conflict(s) (first wins), e.g. "
              f"{builder.alias_conflicts[:5]}", file=sys.stderr)

    print(
        f"SIMBAD reclassification: {reclassified} objects moved out of 'other' "
        f"({other_before} -> {builder.type_counts['other']}); gained: {dict(gained)}",
        file=sys.stderr,
    )
    print(f"Name overrides applied: {overrides_applied}", file=sys.stderr)
    if alias_overrides_applied:
        print(f"Alias overrides applied: {alias_overrides_applied}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
