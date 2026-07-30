"""One GET per allowlisted tool, plus a small set of sidecar-computed read
views (see allowlist.SIDECAR_ROUTES) that compose tool calls with local
read-only computation. Routes are literal — an unlisted tool 404s because no
handler exists for it, not because a guard rejected it.
"""
import os
from dataclasses import asdict
from datetime import timezone
from pathlib import Path

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from seestar_sidecar.allowlist import ALLOWED_TOOLS
from seestar_sidecar.archive import DEFAULT_ARCHIVE_DIR, scan_archive, scan_stacked_images
from seestar_sidecar.catalog import (
    DEFAULT_ALIASES_PATH,
    DEFAULT_CATALOG_PATH,
    load_aliases,
    load_catalog,
)
from seestar_sidecar.catalog import resolve as resolve_catalog_entry
from seestar_sidecar.imagery import (
    DEFAULT_IMAGE_CACHE_DIR,
    DEFAULT_IMAGE_SIZE_PX,
    MAX_IMAGE_SIZE_PX,
    MIN_IMAGE_SIZE_PX,
    fetch_survey_cutout,
    is_plausible_target_id,
    resolve_image_pointer,
)
from seestar_sidecar.mcp_proxy import ProxyTransportError
from seestar_sidecar.projects_union import attach_integration_goals, combine_projects
from seestar_sidecar.replay import load_fixture

router = APIRouter(prefix="/api")


def replay_enabled() -> bool:
    return os.environ.get("SEESTAR_REPLAY") == "1"


async def call_tool(request: Request, tool: str, arguments: dict) -> dict:
    """Indirection so tests can substitute a failing transport.

    The connection lives on app.state, not a module global: one per app
    instance, so two apps in a process cannot clobber each other.

    The tool check is a second, independent guard on top of the literal
    routes below it: those only guarantee an unlisted tool has no *route* to
    reach this function. SIDECAR_ROUTES is the first route class where a
    handler's URL name and the tool name it calls internally can differ
    (projects_combined calls list_projects, not "projects_combined") — a
    future handler that got that wrong internally (e.g. called
    qa_session_report) would sail past both the FORBIDDEN_TOOLS
    route-absence test and the route-set invariant, since neither inspects
    what a route's handler body calls. This is the one place left that can
    still say no.

    Deliberately a `raise`, not an `assert`: assert statements are compiled
    out entirely under `python -O` / `PYTHONOPTIMIZE=1`, so a defence-in-
    depth check written as one would silently disappear in an optimised run
    — a guard that evaporates under a flag is worse than no guard, since it
    looks present in the source while doing nothing. ProxyTransportError
    surfaces through _serve/_fetch's existing 502 handling, which is
    accurate: the sidecar refused to make the call.
    """
    if tool not in ALLOWED_TOOLS:
        raise ProxyTransportError(f"call_tool invoked for a non-allowlisted tool: {tool!r}")
    connection = getattr(request.app.state, "connection", None)
    if connection is None:
        # Two distinct reasons land here with the same symptom: the lifespan
        # simply never ran (a bare TestClient(create_app())), or it ran but
        # SEESTAR_AI_DIR wasn't set — main.py sets the latter's reason on
        # app.state so this 502 names the actual fix instead of reading like
        # an internal bug either way.
        reason = getattr(request.app.state, "connection_unavailable_reason", None)
        raise ProxyTransportError(reason or "MCP connection not started")
    return await connection.call(tool, arguments)


async def _fetch(request: Request, tool: str, arguments: dict) -> dict:
    """Fetch one tool's payload, replay or live, raising on failure.

    Split out from `_serve` so a route that needs more than one tool's
    result (projects_combined needs list_projects plus a local archive scan)
    can fetch and fail the same way a single-tool route does, without
    duplicating the replay/live branch.
    """
    if replay_enabled():
        return load_fixture(tool)
    return await call_tool(request, tool, arguments)


async def _serve(request: Request, tool: str, arguments: dict) -> JSONResponse:
    # Every failure below returns the same {ok, error} shape the tools
    # themselves use, so the client parses one error format regardless of which
    # layer failed. A tool RETURNING {"ok": false, ...} is not a failure — that
    # is a valid response and forwards at 200.
    try:
        return JSONResponse(await _fetch(request, tool, arguments))
    except (ProxyTransportError, FileNotFoundError) as exc:
        # FileNotFoundError carries a "run record.py" pointer (replay, fixture
        # missing). Letting either escape turns a diagnosable message into a
        # generic 500.
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/health")
async def health() -> dict:
    return {"ok": True, "replay": replay_enabled()}


@router.get("/assess_conditions")
async def assess_conditions(request: Request) -> JSONResponse:
    return await _serve(request, "assess_conditions", {})


def _catalog_paths(request: Request) -> tuple[Path, Path]:
    catalog_path = getattr(request.app.state, "catalog_path", None) or DEFAULT_CATALOG_PATH
    aliases_path = getattr(request.app.state, "aliases_path", None) or DEFAULT_ALIASES_PATH
    return Path(catalog_path), Path(aliases_path)


def _archive_dir_and_tz(request: Request) -> tuple[Path | None, timezone | None]:
    """`None` when no archive is configured at all (see archive.
    DEFAULT_ARCHIVE_DIR) — every caller below (scan_archive,
    scan_stacked_images) accepts that directly rather than this wrapping it
    in `Path(None)`, which raises.
    """
    archive_dir = getattr(request.app.state, "archive_dir", None) or DEFAULT_ARCHIVE_DIR
    local_tz = getattr(request.app.state, "local_tz", None)
    return (Path(archive_dir) if archive_dir is not None else None), local_tz


def _attach_images(entries: list[dict], id_key: str, request: Request) -> None:
    """Attach an `image` pointer (see imagery.resolve_image_pointer) to each
    entry in place, keyed by `id_key` — "target_id" for projects_combined's
    entries, "id" for plan_targets' (the two payloads disagree on the field
    name; this is the one place that has to know both).

    Local-only, like the rest of this function's callers: an archive
    directory scan and a catalogue lookup, never a network call. The actual
    bytes are fetched lazily, and cached, by GET /api/target_image/<id> — see
    imagery.py's module docstring for why the split matters.
    """
    archive_dir, local_tz = _archive_dir_and_tz(request)
    stacked_images = scan_stacked_images(archive_dir, local_tz=local_tz)
    catalog_path, aliases_path = _catalog_paths(request)
    catalog = load_catalog(catalog_path)
    aliases = load_aliases(aliases_path)
    for entry in entries:
        entry["image"] = resolve_image_pointer(entry[id_key], stacked_images, catalog, aliases)


@router.get("/plan_targets")
async def plan_targets(
    request: Request, limit: int = Query(default=12, ge=1, le=50)
) -> JSONResponse:
    try:
        payload = await _fetch(request, "plan_targets", {"limit": limit})
    except (ProxyTransportError, FileNotFoundError) as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)
    if not payload.get("ok"):
        # Same rule as projects_combined: a valid {ok: false, ...} tool
        # response is forwarded as-is, not papered over with an enrichment
        # that has nothing to attach to.
        return JSONResponse(payload)
    _attach_images(payload.get("targets", []), "id", request)
    return JSONResponse(payload)


@router.get("/get_site_profile")
async def get_site_profile(request: Request) -> JSONResponse:
    return await _serve(request, "get_site_profile", {})


@router.get("/list_projects")
async def list_projects(request: Request) -> JSONResponse:
    return await _serve(request, "list_projects", {})


@router.get("/recommend_projects")
async def recommend_projects(
    request: Request, limit: int | None = Query(default=None, ge=1, le=50)
) -> JSONResponse:
    return await _serve(request, "recommend_projects", {"limit": limit})


async def _fetch_bortle(request: Request) -> int | None:
    """Best-effort site Bortle class for the goal model's Bortle term (see
    integration_goal.py) — `get_site_profile` is already allowlisted and
    already fetched elsewhere in the app, so this adds no new route. A
    hiccup fetching it (transport failure, or a valid `{ok: false}`) degrades
    to `None` — `suggest_integration_goal` then falls back to its own
    Bortle-8 default — rather than failing the whole projects listing over a
    term that is a no-op at Bortle 8 anyway, which is the only site in use.
    """
    try:
        profile = await _fetch(request, "get_site_profile", {})
    except (ProxyTransportError, FileNotFoundError):
        return None
    if not profile.get("ok"):
        return None
    return profile.get("profile", {}).get("bortle")


@router.get("/projects_combined")
async def projects_combined(request: Request) -> JSONResponse:
    """Union of the store's list_projects with the on-disk archive scan,
    each target's suggested integration-time goal attached (see
    projects_union.attach_integration_goals / integration_goal.py) and an
    `image` pointer attached (see imagery.resolve_image_pointer) — the same
    fields plan_targets gets via `_attach_images`, computed inline here since
    the archive scan and catalogue are already loaded for the goal model.

    Not a tool call itself — see allowlist.SIDECAR_ROUTES — but it never
    reads or computes anything list_projects, a filesystem scan, the
    checked-in DSO catalogue and get_site_profile (already allowlisted)
    couldn't already give it: no side effects, nothing written, and no
    network call — see imagery.py's module docstring for why `image` here is
    only ever a pointer, never a fetch.

    `archive_status` (see archive.ArchiveStatus) tells the UI *why*
    `archive_minutes` is 0 for every target when it is: SEESTAR_ARCHIVE_DIR
    was never set, it's set to a path that isn't there, or it's set to a
    real, currently-empty directory. Those read identically from the
    per-target minutes alone, so this is reported once at the top level
    rather than smuggled into every entry.
    """
    try:
        store = await _fetch(request, "list_projects", {})
    except (ProxyTransportError, FileNotFoundError) as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)
    if not store.get("ok"):
        # list_projects itself reported a failure (e.g. a corrupt store) —
        # forward that valid {ok: false, ...} response rather than papering
        # over it with an archive-only result.
        return JSONResponse(store)

    archive_dir, local_tz = _archive_dir_and_tz(request)
    scan = scan_archive(archive_dir, local_tz=local_tz)
    projects = combine_projects(store["projects"], scan.targets)

    catalog_path, aliases_path = _catalog_paths(request)
    catalog = load_catalog(catalog_path)
    aliases = load_aliases(aliases_path)
    bortle = await _fetch_bortle(request)
    projects = attach_integration_goals(projects, catalog, aliases, bortle)

    stacked_images = scan_stacked_images(archive_dir, local_tz=local_tz)
    for project in projects:
        project["image"] = resolve_image_pointer(
            project["target_id"], stacked_images, catalog, aliases
        )

    totals = {
        "store_minutes": round(sum(p["store_minutes"] for p in projects), 4),
        "archive_minutes": round(sum(p["archive_minutes"] for p in projects), 4),
        "total_minutes": round(sum(p["total_minutes"] for p in projects), 4),
    }
    return JSONResponse(
        {
            "ok": True,
            "projects": projects,
            "count": len(projects),
            "totals": totals,
            "archive_status": asdict(scan.status),
        }
    )


@router.get("/target_image/{target_id}")
async def target_image(
    request: Request,
    target_id: str,
    size: int = Query(default=DEFAULT_IMAGE_SIZE_PX, ge=MIN_IMAGE_SIZE_PX, le=MAX_IMAGE_SIZE_PX),
) -> Response:
    """The bytes `image.url` in projects_combined/plan_targets points at:
    the user's own stacked master where the archive has one, otherwise a
    cached-or-freshly-fetched DSS2 cutout, otherwise an honest 404.

    Not a tool call — see allowlist.SIDECAR_ROUTES — and not a general
    static mount either: `target_id` is validated against
    imagery.is_plausible_target_id() before it ever reaches a filesystem
    path or a cache key, the own-image path always comes from
    scan_stacked_images()'s own directory walk (never a path built directly
    from the URL), and the only network call this route can make is the
    single, timeout-bounded, cached hips2fits fetch in
    imagery.fetch_survey_cutout().
    """
    if not is_plausible_target_id(target_id):
        return JSONResponse(
            {"ok": False, "error": f"not a recognised target id: {target_id!r}"},
            status_code=404,
        )

    archive_dir, local_tz = _archive_dir_and_tz(request)
    stacked_images = scan_stacked_images(archive_dir, local_tz=local_tz)
    own = stacked_images.get(target_id)
    if own is not None:
        return FileResponse(own.path, media_type="image/jpeg")

    catalog_path, aliases_path = _catalog_paths(request)
    catalog = load_catalog(catalog_path)
    aliases = load_aliases(aliases_path)
    entry = resolve_catalog_entry(target_id, catalog, aliases)
    if entry is None or entry.get("ra_deg") is None or entry.get("dec_deg") is None:
        return JSONResponse(
            {"ok": False, "error": f"no imagery available for {target_id!r}"},
            status_code=404,
        )

    cache_dir = getattr(request.app.state, "image_cache_dir", None) or DEFAULT_IMAGE_CACHE_DIR
    image_bytes = await fetch_survey_cutout(
        target_id=target_id,
        ra_deg=entry["ra_deg"],
        dec_deg=entry["dec_deg"],
        size_arcmin=entry.get("size_arcmin"),
        size_px=size,
        cache_dir=Path(cache_dir),
    )
    if image_bytes is None:
        return JSONResponse(
            {"ok": False, "error": f"survey image unavailable for {target_id!r}"},
            status_code=404,
        )
    return Response(content=image_bytes, media_type="image/jpeg")
