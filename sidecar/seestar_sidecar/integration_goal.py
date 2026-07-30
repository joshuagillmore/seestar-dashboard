"""Suggested integration-time goal for a catalogue target — the denominator
`projects_union.py`'s `total_minutes` (the numerator, hours already captured)
gets measured against on the Projects screen and the Tonight ranked cards.

Every constant here has a cited source and a stated confidence. The evidence
base is `.superpowers/integration-constants-research.md` (gitignored working
notes; the load-bearing citations are duplicated below so they survive with
the code). Read that file before touching a constant in this module.

## The headline finding, and why it constrains everything below

Published total-integration reports for one object at fixed Bortle span
roughly **2 h 10 m to 100 h** (M101: 2 h 10 m "healthy SNR", 6 h 18 m, 56.5 h,
100 h for a deep project). That ~50x spread on a *single object* is wider
than the surface-brightness range across the whole catalogue. So the number
this module returns is **a choice of quality tier — the "solid / presentable"
result, not the deep-project one — never a physical requirement.** Nothing
that calls this module may render it, or word it, as "needed". "Suggested"
only.

There is also **no published amateur formula for total integration time vs
surface brightness** — the closest citable framework (Glover / SharpCap)
answers *optimal sub-exposure length*, a different question. The curve below
is an empirical fit to observed practice, labelled as one, not physics.

## Surface brightness

    SB = magnitude + 2.5 * log10(pi * (size_arcmin * 60 / 2) ** 2)   mag/arcsec^2

The standard mean-SB definition. Reproduces the catalogue's own M31 (mag 3.4,
177.8') at 23.28, M42 (mag 4.0, 90.0') at 22.40, M101 (mag 7.9, 24.0') at
23.43 and M45 (mag 1.2, 150.0') at 20.71 — all within a few tenths of the
independently published 23.3 / 22.3 / 23.8 / 20.4. The residual is the
catalogue's own size/magnitude values disagreeing slightly with whichever
isophote or aperture the published figures used, not a units error — a units
error would be off by orders of magnitude, not tenths. (M45's number is not
used for anything below regardless — see "Track: cluster".)

**Deliberately uses only `size_arcmin` (the major axis) — modelling every
object as a circle, not an ellipse — even though several nebulae here are
strongly elongated** (IC 405 50'x30', NGC 7000 120'x30'). This was checked,
not overlooked: correcting to an ellipse makes IC 405's numbers *worse*, not
better, because M31 (177.8'x63'), which defines `SB_REF`, is itself more
elongated than IC 405 — correcting both moves the reference down further
than the target and widens the gap it was meant to close:

  |                          | circle (current) | ellipse |
  |--------------------------|-------------------|---------|
  | M31 (defines `SB_REF`)   | 23.28             | 22.15   |
  | IC 405                  | 27.12             | 26.57   |
  | IC 405 minus `SB_REF`    | 3.84              | 4.42    |

The circle-only formula is also the one `T_REF`/`SB_REF`/`K` were calibrated
consistently against, and published mean-SB figures already vary by more than
a magnitude depending on the isophote/aperture used regardless of which shape
model is chosen — the ellipse's apparent precision is illusory. Left alone on
purpose; do not "fix" this without re-deriving the anchor table's SB values
the same way, or every number in this module silently shifts.

## Track 1 — photometric

Galaxies, planetary nebulae, emission/reflection nebulae and supernova
remnants that have both a magnitude and a size in the catalogue.

    hours = T_REF * 10 ** (K * (SB - SB_REF))

- `SB_REF = 23.3` (M31) and `T_REF = 3.0` h: published Bortle-8 Seestar/smart-
  scope reports for M31 run 2-4 h; 3.0 h anchors the curve at its midpoint.
- `K = 0.45` is an **empirical fit to observed practice, not physics**. The
  background-limited SNR law derives cleanly to K = 0.8 (SNR ~ S*sqrt(t)/sqrt(B),
  S ~ 10^(-0.4*SB_target), B ~ 10^(-0.4*SB_sky) => t ~ 10^(0.8*SB_target)),
  consistent with STScI's WFPC2 handbook, ESO's and Hamamatsu's CCD SNR
  treatments — but K = 0.8 implies ~4800x across the catalogue's real SB
  range, where practice runs 10-15x. Three compounding, independent reasons
  the physical exponent does not survive contact with practice (see the
  research file for the full argument): the amateur quality bar itself varies
  by an order of magnitude across target types (dominant effect, bigger than
  any choice of K); mean SB is a poor difficulty proxy for objects with
  concentrated rather than spread light (structural, not fixable by K — see
  "Track: cluster" below); and the highest-SB targets are exactly the ones
  normally shot dual-band, which compresses the apparent slope further.
- **K = 0.45 deliberately overrides the research file's recommended K = 0.25.**
  That value was fitted including M45 as the bright anchor — the same object
  the research identifies as misrepresented by the SB formula (its 20.4/20.7
  comes from smearing bright pinpoint starlight over a 110'-150' disk, not
  from genuinely faint extended emission). Removing clusters from the fit,
  which this module does anyway (see below), removes the pull toward 0.25.
  Refit against the four non-cluster anchors: 0.45 lands inside every
  published range below, 0.25 falls below two of them (M101 and NGC 7000).
  If this override turns out to be wrong, it is wrong in a specific,
  falsifiable way — the anchor test below is the real specification of K, not
  this paragraph, and should fail first.

  Anchor table (Bortle 8, f/5 — the only site/instrument this module
  currently serves; SB values are the published/idealised figures the
  constants were fit to, not necessarily what this specific catalogue's
  mag/size pair computes for that named object):

  | Target      | SB   | Published range | Model at K=0.45 |
  |-------------|------|------------------|------------------|
  | M42         | 22.3 | 1-3 h            | 1.1 h            |
  | M31         | 23.3 | 2-4 h            | 3.0 h            |
  | M101        | 23.8 | 3-8 h            | 5.0 h            |
  | NGC 7000    | 24.0 | 6-15 h           | 6.2 h            |
  | faint SH2   | 25.0 | 15-30+ h         | 17.4 h           |

  **None of the five anchors is a planetary nebula** (two galaxies, three
  nebulae/emission regions) — `K` has never been checked against one. That
  compounds with the size issue below, which is why planetary nebulae get an
  explicit, separate caveat rather than being trusted at the same confidence
  as everything else on this track.

### Planetary nebulae — coarse, not corrected

`.superpowers/catalogue-extension-report.md`'s spot-check of the extended
catalogue against the previous curated one found **planetary-nebula sizes
running ~35% smaller** (median ratio 0.65, n=5 — thin on its own, but
corroborated by the same ~0.65 ratio across 55 open/globular clusters, a much
larger sample, suggesting one consistent OpenNGC `MajAx` convention rather
than five unrelated coincidences). At `K = 0.45`, a 35% size understatement
moves SB brighter by ~0.94 mag, which is ~2.6x in hours — not a rounding
difference.

**Not corrected numerically.** The report is explicit that neither
measurement is "wrong": OpenNGC's `MajAx` likely captures the bright core,
curated catalogues often include the faint halo, and which one actually
predicts imaging difficulty is not established either way. Inventing a
1/0.65 multiplier from an n=5 sample to paper over that would trade one
unverified number for another, and would let the systematic get silently
absorbed into the model exactly the way it must not be.

**Instead: every planetary nebula is `coarse: True`** on this track — the SB
curve still runs (there is real magnitude and size data, unlike Track 3's
inputs) but the result is flagged the same way Track 2's cluster estimates
are, for the same underlying reason: a known, cited measurement-convention
uncertainty large enough that the number should not be shown with the same
confidence as a galaxy's or a well-measured nebula's. Revisit if a per-object
correction (or better, a size field that specifies which convention it uses)
ever becomes available.

## Track 2 — cluster (coarse)

Open and globular clusters **never go through the SB curve at all** — mean
surface brightness over the catalogued area is a bad predictor of imaging
difficulty when the light is concentrated in stars rather than spread. M45's
SB (20.4-20.7 depending on source) comes from smearing integrated starlight
over a 110'-150' disk; what is actually imaged is bright pinpoint stars, and
the same formula would confidently tell a magnitude-1.6 cluster it needs
serious integration time, which is wrong. This is a structural property of
the input, not something a different K can fix.

Instead: a **flat CLUSTER_HOURS = 2.0 h band, marked coarse.** A magnitude-
driven curve was considered — integrated magnitude is arguably the right
measure for a concentrated object — but there are published anchors only for
a handful of *bright* clusters; inventing a curve for faint ones would be
fabrication. Flat and honestly labelled beats precise and unfounded.

The flat band is still scaled by the broadband Bortle curve (see below):
2.0 h is itself a Bortle-8 figure, not a site-independent constant.

## Track 3 — none

No magnitude (dark nebulae; diffuse HII regions SIMBAD carries with no
integrated magnitude, e.g. SH2-142, NGC 281, NGC 2237, NGC 1579; any
catalogue record missing magnitude or a usable size), or no catalogue record
at all. **No number is shown** — the caller shows hours captured with no
progress bar, rather than a fabricated denominator — but *why* is always
machine-readable; see "The `reason` field" below. There is no published
linkage from Sharpless brightness class or Lynds opacity class to exposure
time in any source found — those schemes predate digital SNR calculation —
so nothing tries to derive one.

## Bortle adjustment

The observing site is Bortle 8 and every anchor above is a Bortle-8 figure,
so `bortle_multiplier(8, band) == 1.0` **exactly**, by construction (any
base ** ((8 - SITE_BORTLE_REF) / 7) is base ** 0), not by a tuned
coincidence — this is what makes the term inert for the only site currently
in use, and lets it stay simple.

Two curves, not one, because broadband and narrowband skyglow penalties
behave very differently:

- **Broadband** (galaxy, cluster, reflection nebula, and this catalogue's
  untyped "other" bucket — see below): `BROADBAND_BORTLE_RATIO = 70` across
  Bortle 1 -> 8, the geometric mean of the researched 50-100x range
  (Bortle/Unihedron SQM table: Class 1 ~21.76-22.0, Class 8 <18.0 => ~4.4 mag
  => ~55x; cross-checked against a published calculator's worked 9.8x for
  Bortle 1->5). Moderate confidence.
- **Narrowband / dual-band** (emission nebula, planetary nebula, supernova
  remnant): `NARROWBAND_BORTLE_RATIO = 2` across Bortle 1 -> 8, inside the
  researched ~1.5-3x range. **This is an extrapolation, not a measurement —
  no source publishes a number**, only a strong, repeated qualitative
  consensus that narrowband flattens the Bortle penalty. Low-to-medium
  confidence, and should not be trusted beyond "materially flatter than
  broadband".

This catalogue's `type` field has an "other" bucket for objects the OpenNGC
import couldn't classify unambiguously (originally 583 entries — genuinely
ambiguous OpenNGC codes `Neb`/`Cl+N`/`DrkN`/`Other`; see `data/build_catalogue.
py`'s `TYPE_MAP`). Lacking a reliable per-object imaging-mode signal, "other"
defaults to the **broadband** curve. This is a known simplification, not a
finding — flag it if the model ever generalises to a non-Bortle-8 site, where
it would start to matter. It has zero effect today: the multiplier is 1.0 at
Bortle 8 regardless of which curve it resolves to.

**This bucket is shrinking under you, live.** A SIMBAD `otype`-based
reclassification (`data/simbad_types.json`) is moving objects out of "other"
into a real type as this is written — do not name specific ids here or in
tests as permanently "other"; several already moved during this task (M42,
NGC1499 -> `emission_nebula`; NGC1579, NGC7380, IC5146 -> `open_cluster`). Key
everything off the type *set*, never an id, and expect the exact membership
of "other" to keep changing without this module needing to.

## Bounds

- **Floor: `FLOOR_HOURS = 1.0` h.** Below this the ~50x real-world spread on
  a single object swamps any distinction the curve could be claiming to
  make — a computed 0.03 h is not a meaningfully different suggestion from
  1 h, it is noise dressed up as precision.
- **Beyond practical reach: `BEYOND_REACH_HOURS = 50` h.** A faint galaxy at
  SB 27 computes to ~140 h, which is an honest extrapolation of the curve but
  a useless progress-bar denominator. Past this bound, no hours figure is
  returned at all (`beyond_reach: True`, `suggested_hours: None`) — flagging
  it as beyond what this instrument and site can reasonably reach is more
  informative than a number nobody will complete. **Except** for the diffuse-
  nebula family — see immediately below.

## Beyond reach vs. unreliable photometry

IC 405 (the user's single largest archive investment, 217 real minutes
captured) computes to SB 27.1 / ~158 h and would trip `beyond_reach` like the
faint-galaxy example above. That reading is wrong, and not for a reason `K`
or a bound can fix: OpenNGC gives IC 405 (50'x30') a B-Mag of 10.0, while
NGC 7000 (120'x30', a comparably bright, comparably sized diffuse nebula)
gets B-Mag 4.0. A six-magnitude gap between two similar objects is not
credible physics — integrated magnitude is poorly defined and inconsistently
measured for diffuse nebulae in the first place (the research file already
says this; it was previously applied only to objects with *missing*
magnitude, not to objects whose magnitude is present but not credible).

So for the **diffuse-nebula family only** — `_UNRELIABLE_PHOTOMETRY_TYPES`:
`emission_nebula`, `reflection_nebula`, and this catalogue's untyped `other`
bucket (IC 405's current type; see "Bortle adjustment" above for why several
real nebulae still land in `other`) — a computed result past
`BEYOND_REACH_HOURS` is treated as evidence the *input* is bad, not evidence
the *target* is unreachable, and falls back to Track 3 (no goal, hours only,
no bar) instead of `beyond_reach`. This is scoped to that type set
deliberately: keyed off `type`, not off IC 405's id, so it applies correctly
whether IC 405 stays `other` or the in-flight SIMBAD reclassification moves
it to `emission_nebula` — either way it must still fall back, and both are
tested. Galaxies, planetary nebulae and supernova remnants are not in scope:
their beyond_reach answers are trusted and stay exactly as before — the
distinction is about the reliability of *this class of input*, not about
raising the bound generally.

**Corrected.** The fallback is *also* logged (`reason=photometry_unreliable`,
matching the token below), but a log line is not reachable from the browser
that has to render an honest absent state — see "The `reason` field" next.

## The `reason` field

The UI renders what this module decides and must never re-derive it or
guess at wording — that cuts both ways: if this module *knows* why there is
no goal, it has to say so in the payload, not just in a log a browser can
never read. So `suggest_integration_goal()` only ever returns a bare `None`
when there is no catalogue record at all (an unresolved id — "Unknown", or a
Caldwell number with no single canonical object); every *resolved* target
gets a dict, even when there is nothing to show a bar for.

`reason` is `None` whenever a real result exists — a normal photometric
number, a coarse cluster/planetary-nebula estimate, or a trusted
`beyond_reach` — because those three are already self-describing through
their own fields (`coarse`, `beyond_reach`). It is one of two short, stable, machine-readable tokens
(`REASON_NO_MAGNITUDE`, `REASON_PHOTOMETRY_UNRELIABLE` below) exactly when
`track` is `"none"` — four genuinely
different "why is there no bar" states in total, once the bare-`None`
"not a catalogue object" case is counted too:

| State | `track` | `reason` | Meaning |
|---|---|---|---|
| not in the catalogue | *(the whole return is `None`)* | — | no record resolved at all |
| no magnitude | `"none"` | `no_magnitude` | integrated magnitude is undefined for many dark/diffuse nebulae, not merely unmeasured |
| unreliable photometry | `"none"` | `photometry_unreliable` | magnitude present but not credible for this object class (IC 405) |
| beyond reach | `"photometric"` | `None` | a trusted target whose computed hours exceed `BEYOND_REACH_HOURS` |
| coarse | `"cluster"` or `"photometric"` | `None` | a real number, flagged low-confidence |
| normal | `"photometric"` or `"cluster"` | `None` | a real, trusted number |

The wording that turns a `reason` token into a sentence a user reads is the
UI's job, and belongs with the design, not here — this module hands over a
token, never prose for that token.

## f-ratio

`t ~ f-ratio**2` for extended objects at fixed aperture is standard and
confirmed (explicit in SharpCap's Glover-derived light-pollution-rate model),
but the Seestar S50 is a fixed f/5 — there is no live f-ratio term here, it is
baked into `T_REF`. Would need to become a real parameter if this model ever
generalises across Seestar/Dwarf/Vaonis bodies with different f-ratios.
"""
import logging
import math

logger = logging.getLogger(__name__)

#: M31 — the SB the whole curve is anchored to (see module docstring).
SB_REF = 23.3
#: Hours at SB_REF, Bortle 8: mid-point of published 2-4 h Bortle-8 M31 reports.
T_REF = 3.0
#: Empirical fit to amateur practice — deliberately overrides the research
#: file's recommended 0.25; see the module docstring for the full reasoning.
K = 0.45

#: Flat, coarse hours for open/globular clusters (Track 2) — a Bortle-8
#: figure, scaled by the broadband Bortle curve like everything else here.
CLUSTER_HOURS = 2.0

#: Below this, the ~50x real-world spread on a single object makes the
#: curve's output noise rather than a meaningful suggestion.
FLOOR_HOURS = 1.0
#: Above this, don't show a number — flag the target as beyond what this
#: instrument/site combination can reasonably reach.
BEYOND_REACH_HOURS = 50.0

#: Every anchor above is measured at this Bortle class — the multiplier is
#: exactly 1.0 here by construction, not tuning.
SITE_BORTLE_REF = 8
#: Broadband Bortle 1->8 ratio: geometric mean of the researched 50-100x
#: range (SQM-derived). Moderate confidence.
BROADBAND_BORTLE_RATIO = 70.0
#: Narrowband/dual-band Bortle 1->8 ratio: inside the researched ~1.5-3x
#: range. Extrapolated — no source publishes a number. Low-to-medium confidence.
NARROWBAND_BORTLE_RATIO = 2.0

#: Track 2 — never goes through the SB curve (see module docstring).
_CLUSTER_TYPES = frozenset({"open_cluster", "globular_cluster"})
#: Imaged narrowband/dual-band in practice, so the flatter Bortle curve
#: applies. Everything else (including this catalogue's untyped "other"
#: bucket) defaults to broadband — see module docstring.
_NARROWBAND_TYPES = frozenset({"emission_nebula", "planetary_nebula", "supernova_remnant"})
#: Stays on the photometric (SB) track but always flagged `coarse` — see
#: "Planetary nebulae — coarse, not corrected" in the module docstring.
#: `.superpowers/catalogue-extension-report.md`: this catalogue's
#: planetary-nebula sizes run ~35% smaller (median ratio 0.65, n=5) than the
#: previous curated catalogue's, corroborated by the same ratio across 55
#: open/globular clusters. Not corrected numerically — neither size
#: convention is established as the "right" one for imaging difficulty, and
#: none of K's own anchors is a planetary nebula either.
_COARSE_PHOTOMETRIC_TYPES = frozenset({"planetary_nebula"})
#: See "Beyond reach vs. unreliable photometry" in the module docstring.
#: Scoped to the diffuse-nebula family — a `beyond_reach` result here is
#: better evidence of unreliable integrated-magnitude photometry (IC 405's
#: real case) than of a genuinely unreachable target. Galaxies, planetary
#: nebulae and supernova remnants are deliberately excluded and keep the
#: honest beyond_reach answer.
_UNRELIABLE_PHOTOMETRY_TYPES = frozenset({"emission_nebula", "reflection_nebula", "other"})

#: `reason` tokens — see "The `reason` field" in the module docstring. Short
#: and stable because they are a wire contract with the UI: the wording a
#: user reads belongs to the UI/design, never to this module.
REASON_NO_MAGNITUDE = "no_magnitude"
REASON_PHOTOMETRY_UNRELIABLE = "photometry_unreliable"

_BORTLE_RATIO = {
    "broadband": BROADBAND_BORTLE_RATIO,
    "narrowband": NARROWBAND_BORTLE_RATIO,
}


def surface_brightness(magnitude: float, size_arcmin: float) -> float:
    """Mean surface brightness in mag/arcsec^2 — the standard definition,
    spreading the integrated magnitude over the object's catalogued disk
    area. See the module docstring for why this is a poor proxy for
    concentrated light (clusters) even though the arithmetic is correct.
    """
    radius_arcsec = size_arcmin * 60 / 2
    area_arcsec2 = math.pi * radius_arcsec**2
    return magnitude + 2.5 * math.log10(area_arcsec2)


def bortle_multiplier(bortle: int | None, band: str) -> float:
    """Scale factor relative to the Bortle-8 anchors, exactly 1.0 at Bortle 8
    by construction (see module docstring). `bortle=None` (site profile
    unavailable) falls back to SITE_BORTLE_REF — the only site this model has
    ever been calibrated against — rather than guessing a number.
    """
    if bortle is None:
        bortle = SITE_BORTLE_REF
    ratio = _BORTLE_RATIO[band]
    return ratio ** ((bortle - SITE_BORTLE_REF) / 7)


def _band_for_type(target_type: str | None) -> str:
    return "narrowband" if target_type in _NARROWBAND_TYPES else "broadband"


def _select_track(entry: dict) -> str:
    if entry.get("type") in _CLUSTER_TYPES:
        return "cluster"
    magnitude = entry.get("magnitude")
    size_arcmin = entry.get("size_arcmin")
    if magnitude is None or not size_arcmin or size_arcmin <= 0:
        return "none"
    return "photometric"


def suggest_integration_goal(entry: dict | None, bortle: int | None = None) -> dict | None:
    """Suggested integration-time goal for one catalogue record, or `None`
    when there is no catalogue record at all (see module docstring — `entry`
    itself is `None`, e.g. an unresolved alias or a target like "Unknown").
    Every *resolved* target returns a dict, even when there is no bar to
    show for it — see "The `reason` field" in the module docstring.

    Never raises on a malformed/missing `entry` field — a target this
    model can't say anything honest about degrades to no goal, the same
    as a target genuinely lacking photometry.

    Returned dict (always the same shape when not `None`), never phrased as
    a requirement — "suggested_hours", never "goal_minutes" or "needed":

        track:               "photometric" | "cluster" | "none"
        suggested_hours:     float, or None when there is no number to show
        coarse:              True for the cluster track, and for any
                              planetary nebula on the photometric track (see
                              "Planetary nebulae — coarse, not corrected")
        beyond_reach:        True for a trusted target whose computed hours
                              exceed BEYOND_REACH_HOURS
        surface_brightness:  mag/arcsec^2, or None when not computed
        bortle_multiplier:   the scale factor actually applied, or None
        reason:              None for a normal/coarse/beyond_reach result;
                              REASON_NO_MAGNITUDE or
                              REASON_PHOTOMETRY_UNRELIABLE when track is
                              "none" — see "The `reason` field"
        note:                a one-line, auditable explanation for the UI
    """
    if entry is None:
        return None
    track = _select_track(entry)
    if track == "none":
        return {
            "track": "none",
            "suggested_hours": None,
            "coarse": False,
            "beyond_reach": False,
            "surface_brightness": None,
            "bortle_multiplier": None,
            "reason": REASON_NO_MAGNITUDE,
            "note": (
                "No catalogued magnitude (or no usable size) for this target — "
                "integrated magnitude is undefined for many dark/diffuse "
                "nebulae, not merely unmeasured."
            ),
        }

    band = _band_for_type(entry.get("type"))
    multiplier = bortle_multiplier(bortle, band)

    if track == "cluster":
        hours = round(CLUSTER_HOURS * multiplier, 1)
        return {
            "track": "cluster",
            "suggested_hours": hours,
            "coarse": True,
            "beyond_reach": False,
            "surface_brightness": None,
            "bortle_multiplier": round(multiplier, 3),
            "reason": None,
            "note": (
                f"Flat {CLUSTER_HOURS:.1f} h band for open/globular clusters — "
                "mean surface brightness misrepresents concentrated starlight, so "
                "this is a coarse, not computed, estimate."
            ),
        }

    coarse = entry.get("type") in _COARSE_PHOTOMETRIC_TYPES
    sb = surface_brightness(entry["magnitude"], entry["size_arcmin"])
    raw_hours = T_REF * (10 ** (K * (sb - SB_REF))) * multiplier

    if raw_hours > BEYOND_REACH_HOURS:
        if entry.get("type") in _UNRELIABLE_PHOTOMETRY_TYPES:
            # See "Beyond reach vs. unreliable photometry" and "The `reason`
            # field" in the module docstring — IC 405's real case. Logged
            # (useful for ops) AND returned (the browser can't read a log):
            # the reason tag ties the two together, and is never emitted
            # for the ordinary no-magnitude case, which logs nothing because
            # there is nothing anomalous about it.
            logger.info(
                "integration_goal: %s (type=%s) computes to ~%.0f h at SB "
                "%.2f mag/arcsec², past BEYOND_REACH_HOURS=%.0f h — "
                "reason=%s, not beyond_reach (diffuse-nebula integrated "
                "magnitude is not trusted this far out); falling back to "
                "Track 3 (no goal).",
                entry.get("id", "<unknown>"),
                entry.get("type"),
                raw_hours,
                sb,
                BEYOND_REACH_HOURS,
                REASON_PHOTOMETRY_UNRELIABLE,
            )
            return {
                "track": "none",
                "suggested_hours": None,
                "coarse": False,
                "beyond_reach": False,
                "surface_brightness": round(sb, 2),
                "bortle_multiplier": round(multiplier, 3),
                "reason": REASON_PHOTOMETRY_UNRELIABLE,
                "note": (
                    f"SB {sb:.2f} mag/arcsec² computes to ~{raw_hours:.0f} h, which "
                    "is not credible for this object class — treating the "
                    "catalogued magnitude as unreliable, not the target as "
                    "unreachable."
                ),
            }
        return {
            "track": "photometric",
            "suggested_hours": None,
            "coarse": coarse,
            "beyond_reach": True,
            "surface_brightness": round(sb, 2),
            "bortle_multiplier": round(multiplier, 3),
            "reason": None,
            "note": (
                f"SB {sb:.2f} mag/arcsec² computes to ~{raw_hours:.0f} h — "
                "beyond practical reach for this instrument and site."
            ),
        }

    hours = max(raw_hours, FLOOR_HOURS)
    if coarse:
        note = (
            f"SB {sb:.2f} mag/arcsec² → suggested {hours:.1f} h — coarse: "
            "planetary-nebula sizes in this catalogue run ~35% smaller than "
            "the convention this curve was checked against, and the curve "
            "itself has no planetary-nebula anchor (see integration_goal.py)."
        )
    else:
        note = (
            f"SB {sb:.2f} mag/arcsec² → suggested {hours:.1f} h — an "
            "empirical fit to amateur practice at the 'solid/presentable' tier, "
            "not a physical requirement."
        )
    return {
        "track": "photometric",
        "suggested_hours": round(hours, 1),
        "coarse": coarse,
        "beyond_reach": False,
        "surface_brightness": round(sb, 2),
        "bortle_multiplier": round(multiplier, 3),
        "reason": None,
        "note": note,
    }
