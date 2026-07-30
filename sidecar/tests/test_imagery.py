"""resolve_image_pointer is pure (no I/O beyond the dicts it's handed — see
imagery.py's module docstring on why the listing routes must never fetch).
fetch_survey_cutout is the one function in this codebase that makes a
network call, so every test here injects a stub `http_get` — nothing in this
file touches the real network. See ATTRIBUTION-DSS.md for the one manual
check that was run against the live service instead.
"""
from datetime import datetime, timezone

import pytest

from seestar_sidecar.archive import StackedImage
from seestar_sidecar.imagery import (
    DEFAULT_FOV_DEG,
    MAX_FOV_DEG,
    MIN_FOV_DEG,
    SURVEY_CREDIT,
    _fov_degrees,
    fetch_survey_cutout,
    is_plausible_target_id,
    resolve_image_pointer,
)

CATALOG = {
    "M31": {"id": "M31", "ra_deg": 10.685, "dec_deg": 41.269, "size_arcmin": 177.8},
    # No usable position — a malformed/partial catalogue record must not be
    # treated as resolvable just because *an* entry exists.
    "NOPOS": {"id": "NOPOS", "ra_deg": None, "dec_deg": None, "size_arcmin": 10.0},
}
ALIASES: dict = {}


def _stacked_image(path="dummy.jpg"):
    return StackedImage(path=path, is_thumbnail=False, captured_at=datetime.now(timezone.utc))


# --- resolve_image_pointer -------------------------------------------------


def test_own_stack_wins_even_when_the_catalogue_would_also_resolve():
    stacked = {"M31": _stacked_image()}
    pointer = resolve_image_pointer("M31", stacked, CATALOG, ALIASES)
    assert pointer == {"url": "/api/target_image/M31", "source": "own", "credit": None}


def test_survey_fallback_when_no_own_stack_but_catalogue_resolves():
    pointer = resolve_image_pointer("M31", {}, CATALOG, ALIASES)
    assert pointer == {
        "url": "/api/target_image/M31",
        "source": "survey",
        "credit": SURVEY_CREDIT,
    }


def test_credit_is_none_for_an_own_image_never_a_survey_string():
    # source is the load-bearing field the UI keys off of, but credit must
    # independently be absent for "own" too — nothing to attribute to a
    # third party for the user's own capture.
    pointer = resolve_image_pointer("M31", {"M31": _stacked_image()}, CATALOG, ALIASES)
    assert pointer["credit"] is None


def test_none_when_neither_source_can_place_the_target():
    pointer = resolve_image_pointer("Unknown", {}, CATALOG, ALIASES)
    assert pointer is None


def test_none_when_catalogue_entry_exists_but_has_no_usable_position():
    pointer = resolve_image_pointer("NOPOS", {}, CATALOG, ALIASES)
    assert pointer is None


def test_resolves_through_an_alias_the_same_way_catalog_resolve_does():
    aliases = {"NGC2244": "M31"}
    pointer = resolve_image_pointer("NGC2244", {}, CATALOG, aliases)
    assert pointer["source"] == "survey"
    assert pointer["url"] == "/api/target_image/NGC2244"


# --- is_plausible_target_id ------------------------------------------------


@pytest.mark.parametrize("target_id", ["M31", "NGC2244", "SH2-142", "C14_DoubleCluster", "IC5146"])
def test_accepts_real_target_id_shapes(target_id):
    assert is_plausible_target_id(target_id) is True


@pytest.mark.parametrize(
    "target_id",
    [
        "",
        "M 31",  # a raw archive display name, never a real target_id
        "../../etc/passwd",
        "a/b",
        "a" * 65,  # past the length cap
    ],
)
def test_rejects_shapes_no_real_target_id_ever_takes(target_id):
    assert is_plausible_target_id(target_id) is False


# --- _fov_degrees ------------------------------------------------------


def test_fov_scales_with_size_within_bounds():
    small = _fov_degrees(6.0)  # a small planetary nebula's rough size_arcmin
    large = _fov_degrees(60.0)  # a mid-sized nebula's
    assert MIN_FOV_DEG < small < large < MAX_FOV_DEG


def test_fov_floors_a_degenerately_small_size():
    assert _fov_degrees(0.001) == MIN_FOV_DEG


def test_fov_ceilings_a_very_large_size():
    assert _fov_degrees(646.0) == MAX_FOV_DEG  # the catalogue's own largest size_arcmin


@pytest.mark.parametrize("size_arcmin", [None, 0, -5])
def test_fov_falls_back_to_the_default_for_a_missing_or_invalid_size(size_arcmin):
    assert _fov_degrees(size_arcmin) == DEFAULT_FOV_DEG


# --- fetch_survey_cutout -----------------------------------------------


async def test_cache_hit_serves_bytes_without_calling_http_get(tmp_path):
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "M31_480.jpg").write_bytes(b"cached-bytes")

    async def must_not_be_called(url, params):
        raise AssertionError("cache hit must not reach the network")

    result = await fetch_survey_cutout(
        target_id="M31",
        ra_deg=10.685,
        dec_deg=41.269,
        size_arcmin=177.8,
        size_px=480,
        cache_dir=cache_dir,
        http_get=must_not_be_called,
    )

    assert result == b"cached-bytes"


async def test_cache_miss_fetches_writes_the_cache_and_returns_the_bytes(tmp_path):
    cache_dir = tmp_path / "cache"
    calls = []

    async def fake_get(url, params):
        calls.append((url, params))
        return b"fetched-bytes"

    result = await fetch_survey_cutout(
        target_id="M31",
        ra_deg=10.685,
        dec_deg=41.269,
        size_arcmin=177.8,
        size_px=480,
        cache_dir=cache_dir,
        http_get=fake_get,
    )

    assert result == b"fetched-bytes"
    assert len(calls) == 1
    assert (cache_dir / "M31_480.jpg").read_bytes() == b"fetched-bytes"


async def test_a_second_request_after_a_cache_miss_makes_no_further_request(tmp_path):
    """Proves the property end to end rather than just per-call: fetch once,
    then fetch again with a getter that raises if invoked at all.
    """
    cache_dir = tmp_path / "cache"

    async def fake_get(url, params):
        return b"fetched-bytes"

    first = await fetch_survey_cutout(
        target_id="M31", ra_deg=10.685, dec_deg=41.269, size_arcmin=177.8,
        size_px=480, cache_dir=cache_dir, http_get=fake_get,
    )

    async def must_not_be_called(url, params):
        raise AssertionError("second request for the same target/size must hit the cache")

    second = await fetch_survey_cutout(
        target_id="M31", ra_deg=10.685, dec_deg=41.269, size_arcmin=177.8,
        size_px=480, cache_dir=cache_dir, http_get=must_not_be_called,
    )

    assert first == second == b"fetched-bytes"


async def test_a_different_size_is_a_different_cache_entry_and_does_fetch(tmp_path):
    cache_dir = tmp_path / "cache"
    calls = []

    async def fake_get(url, params):
        calls.append(params["width"])
        return b"bytes-for-" + str(params["width"]).encode()

    await fetch_survey_cutout(
        target_id="M31", ra_deg=10.685, dec_deg=41.269, size_arcmin=177.8,
        size_px=480, cache_dir=cache_dir, http_get=fake_get,
    )
    await fetch_survey_cutout(
        target_id="M31", ra_deg=10.685, dec_deg=41.269, size_arcmin=177.8,
        size_px=256, cache_dir=cache_dir, http_get=fake_get,
    )

    assert calls == [480, 256]
    assert (cache_dir / "M31_480.jpg").is_file()
    assert (cache_dir / "M31_256.jpg").is_file()


async def test_network_failure_degrades_to_none_not_an_exception(tmp_path):
    cache_dir = tmp_path / "cache"

    async def failing_get(url, params):
        return None  # _live_get's own contract on a non-200 / transport error

    result = await fetch_survey_cutout(
        target_id="M31", ra_deg=10.685, dec_deg=41.269, size_arcmin=177.8,
        size_px=480, cache_dir=cache_dir, http_get=failing_get,
    )

    assert result is None
    assert not (cache_dir / "M31_480.jpg").exists()


async def test_a_raising_getter_is_caught_and_degrades_to_none(tmp_path):
    """fetch_survey_cutout must not let a network dependency's exception
    escape into the route — offline/unreachable must be an honest absent
    state, never a 500. See routes.py's target_image handler.
    """
    cache_dir = tmp_path / "cache"

    async def boom(url, params):
        raise RuntimeError("connection reset")

    result = await fetch_survey_cutout(
        target_id="M31", ra_deg=10.685, dec_deg=41.269, size_arcmin=177.8,
        size_px=480, cache_dir=cache_dir, http_get=boom,
    )

    assert result is None


async def test_empty_response_body_is_treated_as_no_image(tmp_path):
    cache_dir = tmp_path / "cache"

    async def empty_get(url, params):
        return b""

    result = await fetch_survey_cutout(
        target_id="M31", ra_deg=10.685, dec_deg=41.269, size_arcmin=177.8,
        size_px=480, cache_dir=cache_dir, http_get=empty_get,
    )

    assert result is None
    assert not (cache_dir / "M31_480.jpg").exists()
