"""catalog.py is pure I/O plus one lookup rule (target_id, then its alias's
canonical id, else None) — exercised here against small synthetic fixtures,
plus a couple of checks against the real committed data files for the two
real aliasing cases (NGC2244, C33) that motivated building this at all.
"""
import json

import pytest

from seestar_sidecar.catalog import (
    DEFAULT_ALIASES_PATH,
    DEFAULT_CATALOG_PATH,
    load_aliases,
    load_catalog,
    resolve,
)


@pytest.fixture
def synthetic_catalog_path(tmp_path):
    path = tmp_path / "catalog.json"
    path.write_text(
        json.dumps(
            [
                {
                    "id": "M31",
                    "name": "Andromeda Galaxy",
                    "ra_deg": 10.685,
                    "dec_deg": 41.269,
                    "type": "galaxy",
                    "size_arcmin": 177.8,
                    "magnitude": 3.4,
                }
            ]
        ),
        encoding="utf-8",
    )
    return path


@pytest.fixture
def synthetic_aliases_path(tmp_path):
    path = tmp_path / "aliases.json"
    path.write_text(json.dumps({"ANDROMEDA": "M31", "GHOST": None}), encoding="utf-8")
    return path


def test_load_catalog_indexes_by_id(synthetic_catalog_path):
    catalog = load_catalog(synthetic_catalog_path)
    assert set(catalog) == {"M31"}
    assert catalog["M31"]["magnitude"] == 3.4


def test_load_catalog_missing_file_degrades_to_empty(tmp_path):
    assert load_catalog(tmp_path / "never-built.json") == {}


def test_load_aliases_missing_file_degrades_to_empty(tmp_path):
    assert load_aliases(tmp_path / "never-built.json") == {}


def test_resolve_direct_id_hit(synthetic_catalog_path, synthetic_aliases_path):
    catalog = load_catalog(synthetic_catalog_path)
    aliases = load_aliases(synthetic_aliases_path)
    assert resolve("M31", catalog, aliases) == catalog["M31"]


def test_resolve_through_alias(synthetic_catalog_path, synthetic_aliases_path):
    catalog = load_catalog(synthetic_catalog_path)
    aliases = load_aliases(synthetic_aliases_path)
    assert resolve("ANDROMEDA", catalog, aliases) == catalog["M31"]


def test_resolve_alias_mapped_to_none_is_unresolved(synthetic_catalog_path, synthetic_aliases_path):
    """"GHOST" is in the alias index (so it's a known designation) but maps
    to None — no single canonical object, same shape as the real Caldwell-14
    Double Cluster case. Must resolve to None, not raise a KeyError digging
    for a catalogue entry that was never named.
    """
    catalog = load_catalog(synthetic_catalog_path)
    aliases = load_aliases(synthetic_aliases_path)
    assert resolve("GHOST", catalog, aliases) is None


def test_resolve_unknown_id_is_unresolved(synthetic_catalog_path, synthetic_aliases_path):
    catalog = load_catalog(synthetic_catalog_path)
    aliases = load_aliases(synthetic_aliases_path)
    assert resolve("Unknown", catalog, aliases) is None


def test_resolve_alias_pointing_at_a_missing_catalogue_id_is_unresolved(tmp_path):
    """Guards against trusting the alias index blindly: if it points at an id
    the catalogue doesn't actually have, that's still "no target", not a
    KeyError.
    """
    catalog = {}
    aliases = {"DANGLING": "NOWHERE"}
    assert resolve("DANGLING", catalog, aliases) is None


@pytest.mark.skipif(
    not (DEFAULT_CATALOG_PATH.is_file() and DEFAULT_ALIASES_PATH.is_file()),
    reason="data/dso_catalog_extended.json / dso_aliases.json not present",
)
class TestRealAliasResolution:
    """The two real cases from the user's archive that motivated the alias
    index (see the sidecar's handoff): "NGC2244" and "C33" are not
    themselves catalogue ids.
    """

    @pytest.fixture(scope="class")
    def real(self):
        return load_catalog(), load_aliases()

    def test_ngc2244_resolves_through_its_alias(self, real):
        catalog, aliases = real
        assert "NGC2244" not in catalog
        entry = resolve("NGC2244", catalog, aliases)
        assert entry is not None

    def test_c33_resolves_through_its_alias(self, real):
        catalog, aliases = real
        assert "C33" not in catalog
        entry = resolve("C33", catalog, aliases)
        assert entry is not None
