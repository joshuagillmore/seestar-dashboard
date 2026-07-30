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


class TestTrackSelection:
    def test_open_cluster_never_uses_the_sb_curve(self):
        entry = {"type": "open_cluster", "magnitude": 1.2, "size_arcmin": 150.0}
        result = suggest_integration_goal(entry, bortle=SITE_BORTLE_REF)
        assert result["track"] == "cluster"
        assert result["coarse"] is True
        assert result["surface_brightness"] is None
        assert result["suggested_hours"] == CLUSTER_HOURS

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

    def test_missing_magnitude_is_no_target(self):
        entry = {"type": "emission_nebula", "magnitude": None, "size_arcmin": 30.0}
        assert suggest_integration_goal(entry, bortle=SITE_BORTLE_REF) is None

    def test_missing_size_is_no_target(self):
        entry = {"type": "galaxy", "magnitude": 10.0, "size_arcmin": None}
        assert suggest_integration_goal(entry, bortle=SITE_BORTLE_REF) is None

    def test_zero_size_is_no_target(self):
        # A handful of real catalogue rows have magnitude but size_arcmin: 0.0
        # (no measured extent) — log10(0) must degrade to "no target", not raise.
        entry = {"type": "planetary_nebula", "magnitude": 10.4, "size_arcmin": 0.0}
        assert suggest_integration_goal(entry, bortle=SITE_BORTLE_REF) is None

    def test_no_catalogue_entry_is_no_target(self):
        assert suggest_integration_goal(None, bortle=SITE_BORTLE_REF) is None


@pytest.fixture(scope="module")
def real_catalog_and_aliases():
    if not DEFAULT_CATALOG_PATH.is_file() or not DEFAULT_ALIASES_PATH.is_file():
        pytest.skip("data/dso_catalog_extended.json / dso_aliases.json not present")
    return load_catalog(), load_aliases()


class TestRealUserTargetsLandInTrackNone:
    """The five real targets the spec names explicitly (no magnitude in any
    band, or a dark nebula) must produce no target at all — this is the
    behaviour the whole Track 3 design exists for, checked against the real
    committed catalogue, not a synthetic stand-in.
    """

    @pytest.mark.parametrize(
        "target_id", ["SH2-142", "LDN1625", "NGC281", "NGC2237", "NGC1579"]
    )
    def test_target_has_no_suggested_goal(self, target_id, real_catalog_and_aliases):
        catalog, aliases = real_catalog_and_aliases
        entry = resolve(target_id, catalog, aliases)
        assert entry is not None, f"{target_id} should still resolve to a catalogue row"
        assert suggest_integration_goal(entry, bortle=8) is None
