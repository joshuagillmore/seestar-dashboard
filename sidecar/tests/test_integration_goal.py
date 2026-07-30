"""integration_goal.py's constants are the module's real specification (see
its docstring) — these tests exist to fail the moment K, an anchor, a bound
or the Bortle curve is retuned without the published evidence to back it,
not merely to exercise the code path. See docs/slice-2-backlog.md's standing
check: every assertion below should die under a plausible one-line mutation
of the constant it's guarding.
"""
import math

import pytest

from seestar_sidecar.catalog import DEFAULT_ALIASES_PATH, DEFAULT_CATALOG_PATH, load_aliases, load_catalog, resolve
from seestar_sidecar.integration_goal import (
    BEYOND_REACH_HOURS,
    CLUSTER_HOURS,
    FLOOR_HOURS,
    K,
    REASON_NO_MAGNITUDE,
    REASON_PHOTOMETRY_UNRELIABLE,
    SB_REF,
    SITE_BORTLE_REF,
    T_REF,
    bortle_multiplier,
    suggest_integration_goal,
    surface_brightness,
)


def _entry_at_sb(sb: float, type_: str = "galaxy", size_arcmin: float = 10.0) -> dict:
    """Construct a synthetic catalogue record whose computed surface
    brightness is exactly `sb`, by solving surface_brightness()'s magnitude
    term backwards for an arbitrary fixed size. Isolates the hours curve
    (T_REF, K, SB_REF) from surface_brightness() itself, which gets its own
    tests against the real catalogue's M31/M42/M45/M101 rows below.
    """
    radius_arcsec = size_arcmin * 60 / 2
    area = math.pi * radius_arcsec**2
    magnitude = sb - 2.5 * math.log10(area)
    return {"type": type_, "magnitude": magnitude, "size_arcmin": size_arcmin}


class TestSurfaceBrightnessAnchors:
    """The formula must reproduce the catalogue's own M31/M42/M45/M101 rows
    within a few tenths of the independently published SB. The 0.6
    tolerance is loose enough to absorb the catalogue's own size/magnitude
    disagreeing slightly with whichever isophote the published figure used,
    but tight enough that an actual units bug would still fail loudly: using
    the full diameter instead of the radius shifts every value by
    2.5*log10(4) ~= 1.5 mag; forgetting the arcmin->arcsec *60 conversion
    shifts it by 2.5*log10(3600) ~= 8.9 mag. Either would blow straight
    through 0.6.
    """

    # magnitude/size below are the real catalogue rows for these four objects
    # (data/dso_catalog_extended.json), not synthetic numbers chosen to hit
    # `published` — that coupling is the point of this test (it's what would
    # catch a units bug) and must survive any future "simplification".
    @pytest.mark.parametrize(
        "magnitude,size_arcmin,published",
        [
            (3.4, 177.8, 23.3),  # M31
            (4.0, 90.0, 22.3),  # M42
            (1.2, 150.0, 20.4),  # M45 — not used by any track; see integration_goal.py
            (7.9, 24.0, 23.8),  # M101
        ],
    )
    def test_reproduces_published_value(self, magnitude, size_arcmin, published):
        assert surface_brightness(magnitude, size_arcmin) == pytest.approx(published, abs=0.6)


class TestKAnchorTable:
    """The real specification of K=0.45 (see integration_goal.py's module
    docstring for why it overrides the research file's recommended 0.25).
    Bortle is pinned to SITE_BORTLE_REF so the multiplier is exactly 1.0 and
    every result here isolates K alone.
    """

    @pytest.mark.parametrize(
        "sb,low,high",
        [
            (22.3, 1.0, 3.0),  # M42
            (23.3, 2.0, 4.0),  # M31
            (23.8, 3.0, 8.0),  # M101
            (24.0, 6.0, 15.0),  # NGC 7000 (dual-band)
            (25.0, 15.0, 30.0),  # faint SH2 (narrowband)
        ],
    )
    def test_anchor_lands_in_published_range(self, sb, low, high):
        result = suggest_integration_goal(_entry_at_sb(sb), bortle=SITE_BORTLE_REF)
        assert low <= result["suggested_hours"] <= high

    def test_anchor_at_sb_ref_equals_t_ref(self):
        """SB_REF is M31's own anchor — at that exact SB the curve must
        return T_REF unchanged, independent of whatever K currently is.
        """
        result = suggest_integration_goal(_entry_at_sb(SB_REF), bortle=SITE_BORTLE_REF)
        assert result["suggested_hours"] == pytest.approx(T_REF, abs=0.05)


class TestBortleMultiplier:
    def test_exactly_one_at_bortle_8_both_bands(self):
        assert bortle_multiplier(8, "broadband") == 1.0
        assert bortle_multiplier(8, "narrowband") == 1.0

    def test_missing_site_profile_defaults_to_bortle_8(self):
        assert bortle_multiplier(None, "broadband") == bortle_multiplier(8, "broadband")

    def test_broadband_span_matches_researched_50_to_100x(self):
        # Bortle 1 needs far LESS time than Bortle 8 — the inverse ratio.
        ratio = bortle_multiplier(8, "broadband") / bortle_multiplier(1, "broadband")
        assert 50.0 <= ratio <= 100.0

    def test_narrowband_span_matches_researched_1_5_to_3x(self):
        ratio = bortle_multiplier(8, "narrowband") / bortle_multiplier(1, "narrowband")
        assert 1.5 <= ratio <= 3.0

    def test_narrowband_is_flatter_than_broadband_off_reference(self):
        assert bortle_multiplier(1, "narrowband") > bortle_multiplier(1, "broadband")

    def test_type_other_defaults_to_broadband_curve(self):
        """This catalogue's untyped "other" bucket holds several real
        emission/reflection nebulae the OpenNGC import couldn't classify
        (M42, IC405, NGC1499 — see integration_goal.py's module docstring).
        Off the Bortle-8 reference this is where that default becomes
        visible: an "other" entry must scale like broadband, not narrowband.
        """
        entry = {"type": "other", "magnitude": 10.0, "size_arcmin": 30.0}
        result = suggest_integration_goal(entry, bortle=1)
        # bortle_multiplier is returned rounded to 3dp — compare against the
        # same rounding rather than pytest.approx's tight default tolerance.
        assert result["bortle_multiplier"] == round(bortle_multiplier(1, "broadband"), 3)

    def test_emission_nebula_uses_narrowband_curve(self):
        entry = {"type": "emission_nebula", "magnitude": 10.0, "size_arcmin": 30.0}
        result = suggest_integration_goal(entry, bortle=1)
        assert result["bortle_multiplier"] == round(bortle_multiplier(1, "narrowband"), 3)


class TestBounds:
    def test_bright_target_is_floored(self):
        # M57-like: bright compact planetary nebula computes to well under
        # an hour unfloored (SB ~18, far brighter than SB_REF=23.3).
        entry = {"type": "planetary_nebula", "magnitude": 8.8, "size_arcmin": 1.3}
        result = suggest_integration_goal(entry, bortle=SITE_BORTLE_REF)
        assert result["suggested_hours"] == FLOOR_HOURS

    def test_faint_target_is_flagged_beyond_reach_not_given_a_number(self):
        result = suggest_integration_goal(_entry_at_sb(27.0), bortle=SITE_BORTLE_REF)
        assert result["beyond_reach"] is True
        assert result["suggested_hours"] is None
        # beyond_reach is trusted and self-describing via its own flag — the
        # `reason` field (see "The `reason` field") is reserved for track:
        # "none" and stays None here, the "ordinary case carries none" check.
        assert result["reason"] is None

    def test_just_under_the_cap_still_returns_a_number(self):
        # Solve for the SB whose raw (pre-floor) hours sits just under the cap.
        sb_at_cap = SB_REF + math.log10(BEYOND_REACH_HOURS / T_REF) / K
        result = suggest_integration_goal(_entry_at_sb(sb_at_cap - 0.05), bortle=SITE_BORTLE_REF)
        assert result["beyond_reach"] is False
        assert result["suggested_hours"] is not None

    def test_just_over_the_cap_is_beyond_reach(self):
        sb_at_cap = SB_REF + math.log10(BEYOND_REACH_HOURS / T_REF) / K
        result = suggest_integration_goal(_entry_at_sb(sb_at_cap + 0.05), bortle=SITE_BORTLE_REF)
        assert result["beyond_reach"] is True


class TestUnreliableDiffuseNebulaPhotometry:
    """IC 405's real case (see integration_goal.py's "Beyond reach vs.
    unreliable photometry" and "The `reason` field"): a diffuse nebula
    computing past BEYOND_REACH_HOURS is treated as unreliable integrated-
    magnitude photometry, not a genuinely unreachable target, and falls back
    to `track: "none"` with `reason: REASON_PHOTOMETRY_UNRELIABLE` — never
    a bare `None` (the UI has to be able to render *why*), and never
    `beyond_reach: True`. Scoped to a type *set*
    (`_UNRELIABLE_PHOTOMETRY_TYPES`), not to IC405's id, because the
    in-flight SIMBAD reclassification may retype it from "other" to
    "emission_nebula" — both must behave identically.
    """

    @pytest.mark.parametrize("type_", ["other", "emission_nebula", "reflection_nebula"])
    def test_diffuse_nebula_family_falls_back_to_no_goal(self, type_):
        result = suggest_integration_goal(_entry_at_sb(27.0, type_=type_), bortle=SITE_BORTLE_REF)
        assert result["track"] == "none"
        assert result["suggested_hours"] is None
        assert result["beyond_reach"] is False
        assert result["reason"] == REASON_PHOTOMETRY_UNRELIABLE

    @pytest.mark.parametrize("type_", ["galaxy", "planetary_nebula", "supernova_remnant"])
    def test_types_outside_the_diffuse_family_keep_the_honest_beyond_reach_answer(self, type_):
        """The contrast case team-lead asked to keep tested: types NOT in
        the diffuse-nebula set still get a trusted beyond_reach answer at
        the exact same SB that falls back to nothing for the nebula family.
        """
        result = suggest_integration_goal(_entry_at_sb(27.0, type_=type_), bortle=SITE_BORTLE_REF)
        assert result["track"] != "none"
        assert result["beyond_reach"] is True
        assert result["suggested_hours"] is None
        assert result["reason"] is None

    def test_real_ic405_catalog_entry_falls_back_to_no_goal(self, real_catalog_and_aliases):
        catalog, aliases = real_catalog_and_aliases
        entry = resolve("IC405", catalog, aliases)
        assert entry is not None
        assert entry["magnitude"] is not None  # has photometry, just untrustworthy
        result = suggest_integration_goal(entry, bortle=8)
        assert result["track"] == "none"
        assert result["reason"] == REASON_PHOTOMETRY_UNRELIABLE

    def test_fallback_is_logged_with_a_distinct_reason(self, caplog):
        import logging as _logging

        with caplog.at_level(_logging.INFO, logger="seestar_sidecar.integration_goal"):
            suggest_integration_goal(_entry_at_sb(27.0, type_="other"), bortle=SITE_BORTLE_REF)
        assert REASON_PHOTOMETRY_UNRELIABLE in caplog.text

    def test_ordinary_no_magnitude_case_logs_nothing(self, caplog):
        """Contrast: the routine "no photometry at all" Track 3 path is not
        anomalous and must not emit the same (or any) log line — otherwise
        "photometry_unreliable" would stop being a distinct signal.
        """
        import logging as _logging

        entry = {"type": "emission_nebula", "magnitude": None, "size_arcmin": 30.0}
        with caplog.at_level(_logging.INFO, logger="seestar_sidecar.integration_goal"):
            result = suggest_integration_goal(entry, bortle=SITE_BORTLE_REF)
        assert result["reason"] == REASON_NO_MAGNITUDE
        assert caplog.text == ""


class TestTrackSelection:
    def test_open_cluster_never_uses_the_sb_curve(self):
        entry = {"type": "open_cluster", "magnitude": 1.2, "size_arcmin": 150.0}
        result = suggest_integration_goal(entry, bortle=SITE_BORTLE_REF)
        assert result["track"] == "cluster"
        assert result["coarse"] is True
        assert result["surface_brightness"] is None
        assert result["suggested_hours"] == CLUSTER_HOURS
        assert result["reason"] is None  # coarse is self-describing; not a "none" track

    def test_globular_cluster_also_flat_band(self):
        entry = {"type": "globular_cluster", "magnitude": 6.3, "size_arcmin": 11.1}
        result = suggest_integration_goal(entry, bortle=SITE_BORTLE_REF)
        assert result["track"] == "cluster"

    def test_cluster_flat_band_still_scales_with_bortle(self):
        """CLUSTER_HOURS is itself a Bortle-8 figure (see integration_goal.py's
        docstring) — a cluster off-reference must scale like any other
        broadband target, not stay pinned at the literal constant.
        """
        entry = {"type": "open_cluster", "magnitude": 1.2, "size_arcmin": 150.0}
        result = suggest_integration_goal(entry, bortle=1)
        assert result["suggested_hours"] != CLUSTER_HOURS
        assert result["suggested_hours"] == pytest.approx(
            round(CLUSTER_HOURS * bortle_multiplier(1, "broadband"), 1)
        )

    def test_galaxy_with_magnitude_and_size_is_photometric(self):
        entry = {"type": "galaxy", "magnitude": 7.9, "size_arcmin": 24.0}
        result = suggest_integration_goal(entry, bortle=SITE_BORTLE_REF)
        assert result["track"] == "photometric"
        assert result["coarse"] is False
        assert result["reason"] is None

    def test_missing_magnitude_is_no_target(self):
        entry = {"type": "emission_nebula", "magnitude": None, "size_arcmin": 30.0}
        result = suggest_integration_goal(entry, bortle=SITE_BORTLE_REF)
        assert result["track"] == "none"
        assert result["suggested_hours"] is None
        assert result["reason"] == REASON_NO_MAGNITUDE

    def test_missing_size_is_no_target(self):
        entry = {"type": "galaxy", "magnitude": 10.0, "size_arcmin": None}
        result = suggest_integration_goal(entry, bortle=SITE_BORTLE_REF)
        assert result["track"] == "none"
        assert result["reason"] == REASON_NO_MAGNITUDE

    def test_zero_size_is_no_target(self):
        # A handful of real catalogue rows have magnitude but size_arcmin: 0.0
        # (no measured extent) — log10(0) must degrade to "no target", not raise.
        entry = {"type": "planetary_nebula", "magnitude": 10.4, "size_arcmin": 0.0}
        result = suggest_integration_goal(entry, bortle=SITE_BORTLE_REF)
        assert result["track"] == "none"
        assert result["reason"] == REASON_NO_MAGNITUDE

    def test_no_catalogue_entry_is_no_target(self):
        assert suggest_integration_goal(None, bortle=SITE_BORTLE_REF) is None


class TestPlanetaryNebulaCoarseFlag:
    """Planetary-nebula sizes in this catalogue run ~35% smaller than the
    convention the curve was checked against (see
    .superpowers/catalogue-extension-report.md and integration_goal.py's
    "Planetary nebulae — coarse, not corrected"). Not numerically corrected
    (n=5 is too thin to fabricate a multiplier from), so this pins the
    decision that WAS made: still computed via the SB curve, but always
    flagged coarse, unlike every other photometric type.
    """

    def test_planetary_nebula_is_coarse_on_the_photometric_track(self):
        entry = {"type": "planetary_nebula", "magnitude": 8.8, "size_arcmin": 20.0}
        result = suggest_integration_goal(entry, bortle=SITE_BORTLE_REF)
        assert result["track"] == "photometric"
        assert result["coarse"] is True
        assert result["surface_brightness"] is not None  # unlike the cluster track
        assert result["reason"] is None  # coarse, not "no goal"

    def test_galaxy_at_the_same_sb_is_not_coarse(self):
        """Isolates the type-based flag from the SB value itself: a galaxy
        and a planetary nebula built to the same surface brightness must
        differ only in `coarse`, not in `suggested_hours`.
        """
        pn_entry = {"type": "planetary_nebula", "magnitude": 8.8, "size_arcmin": 20.0}
        galaxy_entry = dict(pn_entry, type="galaxy")
        pn_result = suggest_integration_goal(pn_entry, bortle=SITE_BORTLE_REF)
        galaxy_result = suggest_integration_goal(galaxy_entry, bortle=SITE_BORTLE_REF)
        assert pn_result["coarse"] is True
        assert galaxy_result["coarse"] is False
        assert pn_result["suggested_hours"] == galaxy_result["suggested_hours"]

    def test_beyond_reach_planetary_nebula_is_still_coarse(self):
        entry = {"type": "planetary_nebula", "magnitude": 20.0, "size_arcmin": 60.0}
        result = suggest_integration_goal(entry, bortle=SITE_BORTLE_REF)
        assert result["beyond_reach"] is True
        assert result["coarse"] is True


@pytest.fixture(scope="module")
def real_catalog_and_aliases():
    if not DEFAULT_CATALOG_PATH.is_file() or not DEFAULT_ALIASES_PATH.is_file():
        pytest.skip("data/dso_catalog_extended.json / dso_aliases.json not present")
    return load_catalog(), load_aliases()


class TestRealUserTargetsNeverGetAConfidentNumber:
    """The five real targets the spec names explicitly (SH2-142, LDN1625,
    NGC281, NGC2237, NGC1579) all lack a catalogued magnitude. Track
    selection keys off the `type` field (see integration_goal.py's module
    docstring and team-lead's note that the catalogue agent is actively
    reclassifying `other`-typed rows from SIMBAD `otype`), so asserting
    "these five land in Track 3" would be pinning a fact about today's
    `type` values, not the property the spec actually cares about — and it
    already broke once during this task: NGC1579 was reclassified
    other -> open_cluster mid-session, which correctly moves it from Track 3
    to Track 2 (cluster), not a regression.

    The real invariant, true regardless of how `type` gets reclassified: a
    target with no catalogued magnitude must never get a confident,
    SB-computed number. It gets either `track: "none"` (Track 3, with
    `reason: REASON_NO_MAGNITUDE`) or a coarse flat-band one (Track 2, if
    retyped as a cluster) — never `coarse: False` with real hours.
    """

    @pytest.mark.parametrize(
        "target_id", ["SH2-142", "LDN1625", "NGC281", "NGC2237", "NGC1579"]
    )
    def test_target_never_gets_an_uncoarse_photometric_number(
        self, target_id, real_catalog_and_aliases
    ):
        catalog, aliases = real_catalog_and_aliases
        entry = resolve(target_id, catalog, aliases)
        assert entry is not None, f"{target_id} should still resolve to a catalogue row"
        assert entry.get("magnitude") is None, (
            f"{target_id} now has a catalogued magnitude — this test's premise no "
            "longer holds and it should be revisited, not left green by accident"
        )
        result = suggest_integration_goal(entry, bortle=8)
        assert result["track"] == "none" or result["coarse"] is True
