"""Target imagery: the user's own stacked master where one exists, a sky-survey
cutout otherwise. See `docs/slice-2-backlog.md`'s "Imagery: a dashboard feature,
not a server gap" and `docs/handback-to-seestar-ai.md` item 8 — this is a
dashboard-owned read layer over two sources, not a hand-back.

Two independent halves:

- `resolve_image_pointer()` — pure, no I/O beyond the archive dict/catalog
  dict it's handed. Decides "own", "survey" or nothing at all, without ever
  touching the network. This is what `routes.py` calls to enrich
  `projects_combined` and `plan_targets` on every page load — see the
  module-level warning below about why those two must never do more than this.
- `fetch_survey_cutout()` — the one function in this codebase that makes an
  outbound network call. Only reachable from `/api/target_image/<id>`, never
  from a listing route, and cache-first: a cached cutout is served with no
  request at all.

## Why the listing routes never fetch

`projects_combined` and `plan_targets` are read on every page load/refresh.
If enriching them with an `image` field triggered a live hips2fits request per
target, a slow or unreachable survey would slow down — or, without the cache,
repeatedly hit — every refresh. `resolve_image_pointer()` only ever answers
"does an image plausibly exist, and which source" from local data (the
archive scan already done for `projects_combined`'s own union, and the
already-loaded catalogue): a dict lookup and a `catalog.resolve()` call,
nothing else. The actual bytes, and the only network dependency, are deferred
to whichever image the browser actually requests, and cached there. This
mirrors the rest of the repo's offline guarantee (self-hosted fonts,
committed SIMBAD cache) — DSS2 is the one genuine live external dependency,
so it is walled off to a single, cached, timeout-bounded call site.

## Attribution

DSS2 imagery (STScI/AURA, Palomar Observatory/Caltech, and the UK Schmidt
plates via the Anglo-Australian Observatory) carries a required
acknowledgment — see `docs/ATTRIBUTION-DSS.md` for the full notice. `credit`
below is not the whole notice (that belongs in the docs file, once, not
repeated on every response); it is short enough for a UI label while still
naming the actual rights holders, not just the delivery service.
"""
import asyncio
import logging
import os
import re
from pathlib import Path

import httpx

from seestar_sidecar import env as _env  # noqa: F401 — loads .env before the os.environ.get() below; see env.py
from seestar_sidecar.catalog import resolve as resolve_catalog_entry

logger = logging.getLogger(__name__)

#: CDS's hips2fits cutout service — no API key, JPEG out. Verified live
#: 2026-07-30: `ra`/`dec`/`fov` are degrees, `width`/`height` are pixels,
#: `format=jpg` returns `image/jpeg`; a missing/invalid parameter returns
#: HTTP 400 with a `{"title", "description"}` JSON body, not a 200 with a
#: broken image. See docs/ATTRIBUTION-DSS.md for the verification notes.
HIPS2FITS_URL = "https://alasky.cds.unistra.fr/hips-image-services/hips2fits"
#: DSS2 colour — the sensible default full-sky survey; no per-object choice
#: needed since DSS2 has whole-sky coverage.
DEFAULT_HIPS_SURVEY = "CDS/P/DSS2/color"
#: Short enough for a UI label; the full acknowledgment text is
#: docs/ATTRIBUTION-DSS.md, which is what any redistribution must actually
#: carry.
SURVEY_CREDIT = "DSS2 (STScI/AURA, Palomar Obs./Caltech, UK Schmidt-AAO), via CDS HiPS2FITS"

HTTP_TIMEOUT_SECONDS = 8.0

#: A cutout is framed with headroom around the catalogued size rather than
#: cropped exactly to it.
_FOV_PADDING = 1.3
#: Below this, a cutout request is a meaningless close-up of empty sky —
#: floor, not a measured constant. 3 arcmin.
MIN_FOV_DEG = 0.05
#: hips2fits itself accepts up to fov=180 (whole sky); this is our own,
#: much tighter ceiling — nothing this app calls a "target" needs a cutout
#: wider than 3 degrees, and a degenerate/huge size_arcmin must not be able
#: to request one.
MAX_FOV_DEG = 3.0
#: Used when a resolved catalogue entry has no usable size_arcmin.
DEFAULT_FOV_DEG = 0.5

DEFAULT_IMAGE_SIZE_PX = 480
MIN_IMAGE_SIZE_PX = 64
MAX_IMAGE_SIZE_PX = 1024

#: The only sizes ever fetched and cached. A requested `size` snaps UP to the
#: nearest of these (see snap_image_size). Every size from 64 to 1024 used to
#: be its own cache file, so any page the user had open could fill the disk
#: with `<img>` tags — 961 sizes for each of 12,517 catalogue objects. The web
#: only ever requests the default (the `url` resolve_image_pointer builds has
#: no size); MAX is kept for a caller that asks to actually look at an image.
IMAGE_SIZES_PX = (DEFAULT_IMAGE_SIZE_PX, MAX_IMAGE_SIZE_PX)


def snap_image_size(size_px: int) -> int:
    """The smallest of IMAGE_SIZES_PX at least `size_px` — never smaller
    than asked, so a caller never gets a blurrier image than it requested."""
    return next((s for s in IMAGE_SIZES_PX if s >= size_px), IMAGE_SIZES_PX[-1])

#: sidecar/seestar_sidecar/imagery.py -> parents[1] is sidecar/. Gitignored
#: (see .gitignore's "sidecar/.cache/"); a fetched cutout is written here
#: keyed by target id and requested pixel size so a repeat request never
#: hits the network — see fetch_survey_cutout().
DEFAULT_IMAGE_CACHE_DIR = Path(
    os.environ.get(
        "SEESTAR_IMAGE_CACHE_DIR",
        str(Path(__file__).resolve().parents[1] / ".cache" / "target_images"),
    )
)

#: Real target ids seen in the store/archive/catalogue are letters, digits,
#: spaces-turned-nothing, hyphens (SH2-142), underscores (C14_DoubleCluster)
#: and the odd plus/dot from a designation — never a path separator. Used to
#: reject a URL path segment that could not possibly name a real target
#: before it is ever woven into a cache filename or a lookup key: the route
#: is read-only and path-constrained (see docs/slice-2-backlog.md), and this
#: is what makes that true rather than assumed.
#:
#: Applied with fullmatch, never match + `$`: in Python `$` also matches just
#: before a trailing newline, so `^...$` accepted "M31\n" and let it on into
#: cache file names.
_TARGET_ID_RE = re.compile(r"[A-Za-z0-9_+.-]{1,64}")


def is_plausible_target_id(target_id: str) -> bool:
    return bool(_TARGET_ID_RE.fullmatch(target_id))


#: Bumped when the BYTES served at `/api/target_image/<id>` change meaning
#: for the same id.
#:
#: v2: the own-image path began serving the scope's `_thn.jpg` at default size
#: instead of the full-resolution master (400-840 KB -> 7-21 KB). Same URL,
#: different resource — and browsers that had already cached v1 kept serving
#: the old bodies. Measured in a real tab: 22 of 32 images still came from
#: cache as full-resolution files, so an existing client got none of the
#: benefit. `Cache-Control: no-cache` fixes it going FORWARD, but a stored
#: response keeps the freshness rules it was stored with, so entries cached
#: before that header existed revalidate only when their heuristic freshness
#: lapses — for 2024-dated files, potentially weeks.
#:
#: A changed URL is the only thing that reaches those entries immediately.
#: Bump this if the served variant ever changes again.
IMAGE_VARIANT = "2"


def resolve_image_pointer(
    target_id: str,
    stacked_images: dict,
    catalog: dict,
    aliases: dict,
) -> dict | None:
    """The `image` field attached to one target_id in `projects_combined` /
    `plan_targets` — see the module docstring for why this never touches the
    network. `stacked_images` is `archive.scan_stacked_images()`'s result;
    `catalog`/`aliases` are `catalog.load_catalog()` / `catalog.load_aliases()`.

    Own stack wins outright when one exists — the whole point of the
    fallback ordering. Otherwise a survey cutout is offered whenever the
    catalogue can resolve `target_id` to real coordinates, whether or not
    the live fetch will actually succeed later (that answer is not knowable
    without a network call this function must not make — see the module
    docstring). `None` when neither source can say anything: no stack on
    disk and no resolvable catalogue position, e.g. the archive's own
    "Unknown" bucket.
    """
    if target_id in stacked_images:
        return {
            "url": f"/api/target_image/{target_id}?v={IMAGE_VARIANT}",
            "source": "own",
            "credit": None,
        }

    entry = resolve_catalog_entry(target_id, catalog, aliases)
    if entry is not None and entry.get("ra_deg") is not None and entry.get("dec_deg") is not None:
        return {
            "url": f"/api/target_image/{target_id}?v={IMAGE_VARIANT}",
            "source": "survey",
            "credit": SURVEY_CREDIT,
        }
    return None


def _fov_degrees(size_arcmin: float | None) -> float:
    """Frame `size_arcmin` with headroom, clamped to a sane cutout range —
    see MIN_FOV_DEG/MAX_FOV_DEG. `None` or non-positive (a rare catalogue gap)
    falls back to DEFAULT_FOV_DEG rather than raising or requesting a
    zero/negative field of view.
    """
    if not size_arcmin or size_arcmin <= 0:
        return DEFAULT_FOV_DEG
    fov = (size_arcmin * _FOV_PADDING) / 60
    return min(max(fov, MIN_FOV_DEG), MAX_FOV_DEG)


def _cache_path(cache_dir: Path, target_id: str, size_px: int) -> Path:
    return cache_dir / f"{target_id}_{size_px}.jpg"


async def _live_get(url: str, params: dict) -> bytes | None:
    """The one real network call in this codebase. A bounded timeout so a
    slow survey cannot hang a request; any transport failure or non-200
    response degrades to `None` (no image), never an exception the route
    would have to also handle — see fetch_survey_cutout()'s docstring for
    why that matters here specifically.
    """
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            response = await client.get(url, params=params)
    except httpx.HTTPError as exc:
        logger.warning("hips2fits request failed: %s", exc)
        return None
    if response.status_code != 200:
        logger.warning(
            "hips2fits returned %s for %s: %s", response.status_code, params, response.text[:200]
        )
        return None
    return response.content


async def fetch_survey_cutout(
    target_id: str,
    ra_deg: float,
    dec_deg: float,
    size_arcmin: float | None,
    size_px: int,
    cache_dir: Path,
    http_get=None,
) -> bytes | None:
    """Cache-first survey cutout for one target. A cache hit never calls
    `http_get` at all — the one property that matters here, since this is the
    codebase's one live network dependency and the whole point of caching is
    that a second request for the same target/size makes no outbound call.

    `http_get` defaults to the real `_live_get` (an `httpx` call to
    HIPS2FITS_URL); tests inject a stub so the suite never touches the
    network. Returns `None` — never raises — on any failure: no network, a
    survey outage, or a bad response all degrade to the same honest "no
    image" the caller (routes.py's /api/target_image) turns into a 404 with
    a JSON body, never a 500 or a broken image.
    """
    cache_path = _cache_path(cache_dir, target_id, size_px)
    if cache_path.is_file():
        return cache_path.read_bytes()

    getter = http_get or _live_get
    params = {
        "hips": DEFAULT_HIPS_SURVEY,
        "ra": ra_deg,
        "dec": dec_deg,
        "fov": _fov_degrees(size_arcmin),
        "width": size_px,
        "height": size_px,
        "format": "jpg",
    }
    try:
        image_bytes = await getter(HIPS2FITS_URL, params)
    except Exception:  # noqa: BLE001 - a network dependency must degrade, not crash the route
        logger.warning("survey cutout fetch raised for %s", target_id, exc_info=True)
        return None
    if not image_bytes:
        return None

    def _store() -> None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(image_bytes)

    await asyncio.to_thread(_store)
    return image_bytes
