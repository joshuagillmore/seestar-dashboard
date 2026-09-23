"""One GET per allowlisted tool, plus a small set of sidecar-computed read
views (see allowlist.SIDECAR_ROUTES) that compose tool calls with local
read-only computation. Routes are literal — an unlisted tool 404s because no
handler exists for it, not because a guard rejected it.
"""
import asyncio
import os
from dataclasses import asdict
from datetime import timezone
from pathlib import Path

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from seestar_sidecar.allowlist import ALLOWED_TOOLS
from seestar_sidecar.archive import (
    DEFAULT_ARCHIVE_DIR,
    SUB_THUMBNAIL_SUFFIX,
    ArchiveScan,
    scan_archive,
    scan_stacked_images,
)
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
    snap_image_size,
    resolve_image_pointer,
)
from seestar_sidecar.last_stack import (
    REASON_NO_STACK,
    LastStack,
    discover_last_stack_within_timeout,
)
from seestar_sidecar.live_preview import (
    DEFAULT_LIVE_SHARE_DIR,
    REASON_BRIDGE_DOWN,
    REASON_IDLE,
    REASON_NO_FRAME,
    REASON_NOT_CONFIGURED,
    REASON_SHARE_UNREACHABLE,
    SHARE_SCAN_TIMEOUT_SECONDS,
    LiveFrame,
    ShareUnreachableError,
    discover_frame_within_timeout,
    extract_stack_count,
    extract_target_name,
    is_frame_stale,
)
from seestar_sidecar.mcp_proxy import LONG_RUNNING_TOOLS, ProxyTransportError, effective_client_id
from seestar_sidecar.host_check import LOOPBACK_HOSTS, normalise_host
from seestar_sidecar.json_safety import replace_non_finite
from seestar_sidecar.redaction import redact_payload, redact_secrets
from seestar_sidecar.share_io import run_share_io
from seestar_sidecar.projects_union import attach_integration_goals, combine_projects
from seestar_sidecar import qa_analysis
from seestar_sidecar.qa_analysis import DEFAULT_QA_CACHE_DIR, QaJobRegistry
from seestar_sidecar.replay import load_fixture
from seestar_sidecar.session_activity import DEFAULT_PROVENANCE_PATH, read_recent_activity

router = APIRouter(prefix="/api")

#: Origins allowed to START an analysis. The sidecar serves the built frontend
#: itself, so a real request is same-origin; the Vite dev server is the one
#: legitimate cross-origin caller.
#:
#: Why this exists: qa_analysis_start used to be a GET. A GET that spawns
#: minutes of CPU is reachable from any page the user happens to have open —
#: `<img src="http://127.0.0.1:8787/api/qa_analysis_start?target=M31">` is
#: enough, and CORS does not stop the REQUEST, only the reading of its
#: response. Per-target idempotency does not help when an attacker can guess
#: or enumerate target ids.
#:
#: Three things now stand in the way, and the first two are the load-bearing
#: ones: the route is POST (so an <img>/<script>/simple-form cannot reach it),
#: and it requires a custom header, which a cross-origin request cannot set
#: without a preflight this server never answers. The Origin check below is
#: the belt to those braces.
#:
#: An Origin must name a host this server answers to — the same set the Host
#: check uses (app.state.allowed_hosts; see host_check.py): loopback, plus a
#: deliberately configured LAN bind or SEESTAR_ALLOWED_HOSTS name.

#: A header no cross-origin *simple* request can set. Its presence is what
#: distinguishes "our own fetch()" from "a page that happens to be open".
CLIENT_HEADER = "x-seestar-client"


def _is_allowed_origin(origin: str | None, allowed: frozenset[str]) -> bool:
    if not origin:
        # Deliberately allowed. Every browser we target sends Origin on every
        # POST, same-origin included, so an absent one means the request did
        # not come from a browser page at all (curl, a script, a test client).
        # This guard exists to stop a THIRD-PARTY PAGE, not to authenticate a
        # local process, which can already do anything this API offers.
        # `Origin: null` is different — a sandboxed frame or file:// page, a
        # browser page we cannot place — and falls through to be refused.
        return True
    from urllib.parse import urlparse

    # hostname strips IPv6 brackets and lower-cases, matching how
    # allowed_hosts stores names. The old literal list spelled loopback as
    # "[::1]", which hostname never returns, so an IPv6 origin was refused.
    host = urlparse(origin).hostname
    return host is not None and normalise_host(host) in allowed


def _reject_untrusted_caller(request: Request) -> JSONResponse | None:
    """`None` when the caller may start work, else the refusal to return."""
    if request.headers.get(CLIENT_HEADER) is None:
        return JSONResponse(
            {"ok": False, "error": f"missing {CLIENT_HEADER} header"}, status_code=403
        )
    allowed = getattr(request.app.state, "allowed_hosts", LOOPBACK_HOSTS)
    if not _is_allowed_origin(request.headers.get("origin"), allowed):
        return JSONResponse(
            {"ok": False, "error": "cross-origin analysis requests are refused"},
            status_code=403,
        )
    return None


#: Every image route serves a file whose CONTENT can change while its URL
#: stays the same — a new stacked master lands for a target, or the server
#: starts serving a different variant at the same path (which is exactly what
#: happened when target_image began preferring the scope's `_thn.jpg`).
#:
#: With no directive at all, browsers apply heuristic freshness and simply do
#: not revalidate: measured in a real tab, 22 of 32 Projects images were still
#: being served from cache as the OLD full-resolution files, so a client that
#: had loaded the grid before the change got none of the 6.1 MB -> 0.75 MB
#: benefit. The same silence would have served a stale master after a new
#: session, which was already wrong before that change made it visible.
#:
#: `no-cache` does not mean "do not store" — it means "revalidate before
#: reuse".
#:
#: Note what that costs here, because it is not free: Starlette's bare
#: FileResponse SETS an ETag but does not implement conditional responses
#: (that is StaticFiles' job), so a revalidation is a full re-fetch, not a
#: 304. Acceptable on this route and measured rather than assumed: these are
#: 8-27 KB files served from local disk, so a whole Projects grid is ~0.75 MB
#: at ~10 ms each. If they were the old 400-840 KB masters this would be the
#: wrong trade and conditional handling would be worth writing.
IMAGE_CACHE_CONTROL = "no-cache"


def _image_response(path, *, media_type: str = "image/jpeg") -> FileResponse:
    """A file response that revalidates. See IMAGE_CACHE_CONTROL."""
    return FileResponse(
        path, media_type=media_type, headers={"Cache-Control": IMAGE_CACHE_CONTROL}
    )



def replay_enabled() -> bool:
    return os.environ.get("SEESTAR_REPLAY") == "1"


async def _call_tool_on_app(app, tool: str, arguments: dict) -> dict:
    """The actual allowlist-guarded call, keyed off the FastAPI `app`
    directly rather than a live per-request `Request` — see call_tool()
    below for the normal, request-scoped entry point every other route uses.

    This exists for qa_analysis.start_analysis()'s background asyncio.Task
    (see routes.py's qa_analysis_start handler): that task is created inside
    a request handler but keeps running after the handler has already
    returned a response, so it must not depend on the original Request
    object still being meaningfully "live" — `app` is a plain, long-lived
    attribute of the whole process, unlike a Request's own receive/send
    channel, which is scoped to one HTTP exchange.

    The tool check is a second, independent guard on top of the literal
    routes below it: those only guarantee an unlisted tool has no *route* to
    reach this function. SIDECAR_ROUTES is the first route class where a
    handler's URL name and the tool name it calls internally can differ
    (projects_combined calls list_projects, not "projects_combined") — a
    future handler that got that wrong internally (e.g. called
    qa_session_report) would sail past both the FORBIDDEN_TOOLS
    route-absence test and the route-set invariant, since neither inspects
    what a route's handler body calls. This can still say no — and so can
    McpConnection.call itself, which refuses anything outside the set it was
    built with, for any caller that reaches a connection some other way.

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
    # qa_tier2 runs on its own server process so a minutes-long analysis
    # cannot hold the connection every live poll shares — see
    # mcp_proxy.LONG_RUNNING_TOOLS and main.lifespan.
    state_key = "qa_connection" if tool in LONG_RUNNING_TOOLS else "connection"
    connection = getattr(app.state, state_key, None)
    if connection is None:
        # Two distinct reasons land here with the same symptom: the lifespan
        # simply never ran (a bare TestClient(create_app())), or it ran but
        # SEESTAR_AI_DIR wasn't set — main.py sets the latter's reason on
        # app.state so this 502 names the actual fix instead of reading like
        # an internal bug either way.
        reason = getattr(app.state, "connection_unavailable_reason", None)
        raise ProxyTransportError(reason or "MCP connection not started")
    try:
        payload = await connection.call(tool, arguments)
    except ProxyTransportError as exc:
        raise ProxyTransportError(redact_secrets(str(exc))) from None
    except Exception as exc:  # noqa: BLE001 — e.g. an unparseable payload: a 502, not a bare 500
        raise ProxyTransportError(
            redact_secrets(f"call to {tool!r} failed: {type(exc).__name__}: {exc}")
        ) from None
    return _clean_payload(payload)


def _clean_payload(payload: dict) -> dict:
    """The one place every tool payload passes on its way to a route — see
    _call_tool_on_app and _fetch's replay branch, the only two sources.

    - `error` is redacted. An upstream exception string is untrusted input:
      httpx embeds the full request URL in HTTPStatusError, and a meteoblue
      API key reached the DOM that way (see redaction.py). This used to be
      each route's job, and plan_targets, projects_combined and the QA job
      errors each forgot; done here, a new route cannot.
    - Non-finite numbers become null, so no route can 500 rendering one
      (see json_safety.py).

    Transport failures are redacted alongside, in _call_tool_on_app, and
    re-raised `from None`: chaining the original would carry the unredacted
    message into any traceback that logs it.
    """
    return redact_payload(replace_non_finite(payload))


async def call_tool(request: Request, tool: str, arguments: dict) -> dict:
    """Indirection so tests can substitute a failing transport. See
    _call_tool_on_app() for the actual guard/dispatch — this is the plain
    request-scoped entry point every ordinary route uses.

    The allowlist check is repeated here, before `request.app` is ever
    touched, so it still fires for a bare `call_tool(None, tool, args)` with
    no request at all — test_call_tool_refuses_a_non_allowlisted_tool_name
    and test_call_tool_guard_survives_python_dash_o (test_allowlist.py) both
    rely on exactly that to prove the guard fires "before call_tool ever
    touches request.app.state". `_call_tool_on_app` repeats the same check
    for its own callers (qa_analysis_start's background task, which never
    goes through this function at all) — belt and suspenders, not a gap in
    either.
    """
    if tool not in ALLOWED_TOOLS:
        raise ProxyTransportError(f"call_tool invoked for a non-allowlisted tool: {tool!r}")
    return await _call_tool_on_app(request.app, tool, arguments)


async def _fetch(request: Request, tool: str, arguments: dict) -> dict:
    """Fetch one tool's payload, replay or live, raising on failure.

    Split out from `_serve` so a route that needs more than one tool's
    result (projects_combined needs list_projects plus a local archive scan)
    can fetch and fail the same way a single-tool route does, without
    duplicating the replay/live branch.
    """
    if replay_enabled():
        return _clean_payload(load_fixture(tool))
    return await call_tool(request, tool, arguments)


async def _serve(request: Request, tool: str, arguments: dict) -> JSONResponse:
    # Every failure below returns the same {ok, error} shape the tools
    # themselves use, so the client parses one error format regardless of which
    # layer failed. A tool RETURNING {"ok": false, ...} is not a failure — that
    # is a valid response and forwards at 200.
    # Every error leaving here is redacted first. An upstream exception string
    # is untrusted input: httpx embeds the full request URL in HTTPStatusError,
    # and a meteoblue API key reached the DOM that way. See redaction.py.
    try:
        return JSONResponse(redact_payload(await _fetch(request, tool, arguments)))
    except (ProxyTransportError, FileNotFoundError) as exc:
        # FileNotFoundError carries a "run record.py" pointer (replay, fixture
        # missing). Letting either escape turns a diagnosable message into a
        # generic 500.
        return JSONResponse(
            {"ok": False, "error": redact_secrets(str(exc))}, status_code=502
        )


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


#: Distinguishes "app.state.archive_dir was never set at all" (a bare app
#: that skipped create_app()'s state-setting — not reachable through any
#: real entry point today, but the same defensive style _catalog_paths
#: above already holds itself to) from "it was set, and set to `None`" —
#: the second is now a real, meaningful state since DEFAULT_ARCHIVE_DIR
#: itself can legitimately be `None` (SEESTAR_ARCHIVE_DIR unconfigured; see
#: archive.py). `getattr(..., None)` cannot tell those two apart — both
#: read as "falsy" — so a `None or DEFAULT_ARCHIVE_DIR` fallback would
#: silently re-derive and discard a deliberately-set `None`, exactly the
#: bug this sentinel exists to rule out.
_ARCHIVE_DIR_UNSET = object()


def _archive_dir_and_tz(request: Request) -> tuple[Path | None, timezone | None]:
    """`None` when no archive is configured at all (see archive.
    DEFAULT_ARCHIVE_DIR) — every caller below (scan_archive,
    scan_stacked_images) accepts that directly rather than this wrapping it
    in `Path(None)`, which raises.
    """
    archive_dir = getattr(request.app.state, "archive_dir", _ARCHIVE_DIR_UNSET)
    if archive_dir is _ARCHIVE_DIR_UNSET:
        archive_dir = DEFAULT_ARCHIVE_DIR
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


#: `list_projects` (since seestar-mcp a66f2d3) and `recommend_projects`
#: (since fffa8b6) default to `detail="summary"` server-side, which OMITS each project's
#: `sessions` history (replacing it with `sessions_count` /
#: `last_session_utc`). Omitting the key rather than emptying it was our own
#: request — an empty list renders as "no sessions logged", which is a real
#: and different state — so the default is safe but it is not what this
#: client wants: SessionHistory.tsx itemises `store.sessions`, and
#: projects_union de-duplicates archive nights against them.
#:
#: Passed explicitly at every call site rather than relied on as a default in
#: either direction. `detail="full"` is byte-identical to the historical
#: payload, so this restores exactly what ProjectSchema already parses.
_FULL_DETAIL = {"detail": "full"}


@router.get("/list_projects")
async def list_projects(request: Request) -> JSONResponse:
    return await _serve(request, "list_projects", dict(_FULL_DETAIL))


@router.get("/recommend_projects")
async def recommend_projects(
    request: Request, limit: int | None = Query(default=None, ge=1, le=50)
) -> JSONResponse:
    # detail="full" for the same reason as list_projects above: since
    # seestar-mcp fffa8b6 this tool has the same parameter and the same
    # "summary" default, which drops `sessions`.
    return await _serve(request, "recommend_projects", {"limit": limit, **_FULL_DETAIL})


# --- slice 3 (Live session screen) — plain passthroughs, same _serve pattern
# as every route above. Each tool was verified read-only against
# SeeStar-AI/src/seestar_mcp/server.py before being added to ALLOWED_TOOLS —
# see allowlist.py's own comments for what was checked, and for why
# `pi_get_info` (battery) is NOT among them: it isn't an MCP tool at all.


@router.get("/get_view_state")
async def get_view_state(request: Request) -> JSONResponse:
    return await _serve(request, "get_view_state", {})


@router.get("/get_status")
async def get_status(request: Request) -> JSONResponse:
    return await _serve(request, "get_status", {})


@router.get("/get_focuser_position")
async def get_focuser_position(request: Request) -> JSONResponse:
    return await _serve(request, "get_focuser_position", {})


@router.get("/qa_tier1")
async def qa_tier1(request: Request) -> JSONResponse:
    return await _serve(request, "qa_tier1", {})


@router.get("/get_target_observability")
async def get_target_observability(
    request: Request, target: str, date: str | None = Query(default=None)
) -> JSONResponse:
    return await _serve(request, "get_target_observability", {"target": target, "date": date})


@router.get("/get_run_state")
async def get_run_state(request: Request) -> JSONResponse:
    """Is an imaging run in progress right now?

    The one tool that answers this without inference. Everything else the Live
    screen has is a device call that TIMES OUT when the scope is idle, which
    is a signal we were reading backwards: "the call failed" and "nothing is
    running" are not the same claim, and treating them as one produces a
    confident wrong answer in the worst direction — "idle" while stacking.

    Costs the bridge nothing: it reads a JSON file, makes no Alpaca call. That
    is what makes it safe on the idle path, where the device-touching pollers
    are not.
    """
    return await _serve(request, "get_run_state", {})


@router.get("/check_night_guardrails")
async def check_night_guardrails(
    request: Request,
    session_start_utc: str,
    max_session_hours: float = Query(default=10.0, gt=0),
    battery_floor_pct: float = Query(default=20.0, ge=0, le=100),
    dawn_margin_min: float = Query(default=15.0, ge=0),
) -> JSONResponse:
    return await _serve(
        request,
        "check_night_guardrails",
        {
            "session_start_utc": session_start_utc,
            "max_session_hours": max_session_hours,
            "battery_floor_pct": battery_floor_pct,
            "dawn_margin_min": dawn_margin_min,
        },
    )


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
        store = await _fetch(request, "list_projects", dict(_FULL_DETAIL))
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
    # Bounds the disk cache: see imagery.IMAGE_SIZES_PX.
    size = snap_image_size(size)

    archive_dir, local_tz = _archive_dir_and_tz(request)
    stacked_images = scan_stacked_images(archive_dir, local_tz=local_tz)
    own = stacked_images.get(target_id)
    if own is not None:
        # Prefer the scope's own `_thn.jpg` when the caller asked for a small
        # image. The full masters are 400-840 KB and the Projects grid draws
        # 32 of them at roughly 90 px — 6.1 MB of JPEG decoded to paint
        # postage stamps, which is what made that screen slow. The thumbnails
        # are 7-21 KB and already on disk, so this needs no resizing library
        # and no cache; the survey path has always sized its cutouts and this
        # brings the own-image path in line.
        #
        # Only below the default: an explicit larger `size` is a caller
        # asking to actually look at the image, and must still get the
        # full-resolution file.
        if size <= DEFAULT_IMAGE_SIZE_PX and own.thumbnail_path is not None:
            return _image_response(own.thumbnail_path)
        return _image_response(own.path)

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


# --- live preview (slice 3) ------------------------------------------------
#
# Same "was this ever set on app.state at all" sentinel as
# _archive_dir_and_tz above — main.py's create_app() always sets
# app.state.live_share_dir, so this only guards a bare, non-create_app() app
# (not reachable through any real entry point today, same defensive style).
_LIVE_SHARE_DIR_UNSET = object()


def _live_share_dir(request: Request) -> Path | None:
    share_dir = getattr(request.app.state, "live_share_dir", _LIVE_SHARE_DIR_UNSET)
    if share_dir is _LIVE_SHARE_DIR_UNSET:
        share_dir = DEFAULT_LIVE_SHARE_DIR
    return Path(share_dir) if share_dir is not None else None


def _live_preview_absent(reason: str) -> dict:
    return {
        "ok": True,
        "source": None,
        "captured_at": None,
        "stack_count": None,
        "target": None,
        "stale": False,
        "reason": reason,
        "url": "/api/live_preview/image",
    }


def _live_preview_frame(frame: LiveFrame, stack_count: int | None, stale: bool) -> dict:
    """`frame.captured_at` was captured once at discovery time — see
    live_preview.LiveFrame's docstring for why this must NOT re-`.stat()`
    `frame.path` here: in the cache-fallback (`stale=True`) branch, `path`
    lives on a share that was just found unreachable, and re-touching it here
    would sneak the exact blocking network call
    `discover_frame_within_timeout()`'s timeout exists to bound back in.
    """
    return {
        "ok": True,
        "source": frame.source,
        "captured_at": frame.captured_at.isoformat(),
        "stack_count": stack_count,
        "target": frame.target,
        "stale": stale,
        "reason": None,
        "url": "/api/live_preview/image",
    }


@router.get("/live_preview")
async def live_preview(request: Request) -> JSONResponse:
    """Metadata only — no image bytes; see live_preview.py's module docstring
    and docs/superpowers/specs/2026-07-30-slice-3-live-session.md §0/D2.

    Never touches SEESTAR_LIVE_SHARE_DIR at all unless get_view_state (an
    already-allowlisted tool) confirms the scope is observing: "a timeout
    means the scope is not observing; there is nothing to fetch and no reason
    to touch the network" (the spec's D2). ProxyTransportError/
    FileNotFoundError (the MCP call itself failing) and a valid
    `{"ok": false, ...}` response (the scope answering "idle") are reported as
    distinct reasons — REASON_BRIDGE_DOWN vs. REASON_IDLE — per CLAUDE.md's
    "bridge-down and scope-idle are first-class UI states", not the same one.
    """
    try:
        view = await _fetch(request, "get_view_state", {})
    except (ProxyTransportError, FileNotFoundError):
        return JSONResponse(_live_preview_absent(REASON_BRIDGE_DOWN))
    if not view.get("ok"):
        return JSONResponse(_live_preview_absent(REASON_IDLE))

    stack_count = extract_stack_count(view)
    # Scope the scan to what the scope is actually on. Unscoped, discovery
    # returns the newest frame across the entire share — which during a live
    # session is routinely a different object from a previous night. Observed
    # on hardware: a week-old M103 served while slewing to NGC 7380.
    active_target = extract_target_name(view)

    share_dir = _live_share_dir(request)
    if share_dir is None:
        return JSONResponse(_live_preview_absent(REASON_NOT_CONFIGURED))

    cache: LiveFrame | None = getattr(request.app.state, "live_preview_cache", None)
    # The last known frame is only a fallback for the object the scope is on
    # NOW. It used to be served whatever it showed, so after a slew a share
    # hiccup put the previous target's frame up, marked merely "stale" — the
    # wrong-target mistake the scoped scan above exists to prevent. With no
    # active target the scan itself was unscoped, so there is nothing to
    # mismatch and the old degrade holds.
    if cache is not None and active_target is not None and cache.target != active_target:
        # Cleared, not just skipped: /api/live_preview/image serves whatever
        # is cached, and must not go on serving the old target's bytes.
        request.app.state.live_preview_cache = None
        cache = None
    try:
        frame = await discover_frame_within_timeout(share_dir, target=active_target)
    except ShareUnreachableError:
        if cache is not None:
            return JSONResponse(_live_preview_frame(cache, stack_count, stale=True))
        return JSONResponse(_live_preview_absent(REASON_SHARE_UNREACHABLE))

    if frame is None:
        if cache is not None:
            return JSONResponse(_live_preview_frame(cache, stack_count, stale=True))
        return JSONResponse(_live_preview_absent(REASON_NO_FRAME))

    request.app.state.live_preview_cache = frame
    # A successful scan does not mean a current frame: the target's directory
    # can still hold only an earlier night's files. See STALE_AFTER_SECONDS.
    return JSONResponse(_live_preview_frame(frame, stack_count, stale=is_frame_stale(frame)))


@router.get("/live_preview/image")
async def live_preview_image(request: Request) -> Response:
    """The bytes /api/live_preview's `url` points at — always whatever the
    metadata route most recently discovered (see app.state.live_preview_cache),
    never a path built from anything the client sent. A cold cache (this hit
    before /api/live_preview ever succeeded once) is an honest 404, same shape
    as target_image's absent states.
    """
    cache: LiveFrame | None = getattr(request.app.state, "live_preview_cache", None)
    if cache is None:
        return JSONResponse(
            {"ok": False, "error": "no live preview frame available yet"}, status_code=404
        )
    return await _share_image_response(
        cache.path, missing="no live preview frame available yet"
    )


#: The image routes' answer when the share did not answer in time. 503 rather
#: than 404: "could not tell" is not "there is nothing", the same distinction
#: live_preview.ShareUnreachableError draws for the metadata routes.
_SHARE_UNREACHABLE_BODY = {"ok": False, "error": "live share unreachable"}


async def _share_image_response(path: Path, *, missing: str) -> Response:
    """Serve a file from the scope's SMB share, or say why not.

    The existence check used to be a bare `path.is_file()` on the event loop,
    and a stat on an SMB share that has gone quiet can hang for as long as
    Windows' SMB client cares to wait — with every other route and poll
    frozen behind it. Bounded exactly as discover_frame_within_timeout bounds
    the metadata routes' scans: off the loop on the share's own bounded
    threads (share_io.py — a full pool raises an OSError, answered 503 here
    at once), under the same ceiling.
    """
    try:
        exists = await asyncio.wait_for(
            run_share_io(path.is_file), timeout=SHARE_SCAN_TIMEOUT_SECONDS
        )
    except (asyncio.TimeoutError, OSError):
        return JSONResponse(_SHARE_UNREACHABLE_BODY, status_code=503)
    if not exists:
        return JSONResponse({"ok": False, "error": missing}, status_code=404)
    return _image_response(path)


# --- last completed stack (slice 3 follow-up) ------------------------------
#
# Sibling of live_preview above: same share (_live_share_dir(), not a new
# variable), same get_view_state-first idle/bridge-down check, same
# never-touch-the-share-while-idle discipline. The question is different —
# "what did the LAST completed session leave for the target the scope is on
# NOW" rather than "what's newest anywhere" — and this is a one-off fetch on
# target change, not a poll: see last_stack.py's module docstring for why
# that changes which file gets served (full-resolution `.jpg`, never the
# `_thn` thumbnail live_preview.py insists on) and why there is no
# stale-cache degrade here the way live_preview has one.


def _last_stack_absent(reason: str) -> dict:
    return {
        "ok": True,
        "target": None,
        "captured_at": None,
        "frame_count": None,
        "reason": reason,
        "url": "/api/last_stack/image",
    }


def _last_stack_payload(stack: LastStack) -> dict:
    return {
        "ok": True,
        "target": stack.target,
        "captured_at": stack.captured_at.isoformat(),
        "frame_count": stack.frame_count,
        "reason": None,
        "url": "/api/last_stack/image",
    }


@router.get("/last_stack")
async def last_stack(request: Request) -> JSONResponse:
    """Metadata only — no image bytes; see last_stack.py's module docstring.

    Never touches SEESTAR_LIVE_SHARE_DIR unless get_view_state confirms the
    scope is observing AND names a target, matching live_preview's "a
    timeout means not observing; there is nothing to fetch" rule. `reason`
    values: REASON_BRIDGE_DOWN / REASON_IDLE / REASON_NOT_CONFIGURED /
    REASON_SHARE_UNREACHABLE are the exact tokens live_preview.py defines for
    the same underlying conditions, reused rather than duplicated;
    REASON_NO_STACK is new to this route (see last_stack.py).

    `app.state.last_stack_cache` is always overwritten to match THIS call's
    outcome — set on success, cleared to `None` on every absent branch below
    — never left holding a previous target's stack once a newer call has run
    for a different (or no) target. Unlike live_preview_cache, there is no
    "serve the old one anyway, marked stale" path: this route has no polling
    interval to be stale relative to, and serving a previous target's image
    after this call just reported "no stack for the current target" would be
    exactly the wrong-target mistake target-scoping exists to rule out.
    """
    try:
        view = await _fetch(request, "get_view_state", {})
    except (ProxyTransportError, FileNotFoundError):
        request.app.state.last_stack_cache = None
        return JSONResponse(_last_stack_absent(REASON_BRIDGE_DOWN))
    if not view.get("ok"):
        request.app.state.last_stack_cache = None
        return JSONResponse(_last_stack_absent(REASON_IDLE))

    # Scope to the active target — never fall back to an unscoped "newest
    # across the whole share" scan. Without a confirmed target there is no
    # safe answer here: showing whatever happens to be newest risks serving
    # a stack for a different object, which is exactly what this route must
    # not do (see last_stack.py's module docstring).
    active_target = extract_target_name(view)
    if active_target is None:
        request.app.state.last_stack_cache = None
        return JSONResponse(_last_stack_absent(REASON_NO_STACK))

    share_dir = _live_share_dir(request)
    if share_dir is None:
        request.app.state.last_stack_cache = None
        return JSONResponse(_last_stack_absent(REASON_NOT_CONFIGURED))

    try:
        stack = await discover_last_stack_within_timeout(share_dir, active_target)
    except ShareUnreachableError:
        request.app.state.last_stack_cache = None
        return JSONResponse(_last_stack_absent(REASON_SHARE_UNREACHABLE))

    if stack is None:
        request.app.state.last_stack_cache = None
        return JSONResponse(_last_stack_absent(REASON_NO_STACK))

    request.app.state.last_stack_cache = stack
    return JSONResponse(_last_stack_payload(stack))


@router.get("/last_stack/image")
async def last_stack_image(request: Request) -> Response:
    """The bytes /api/last_stack's `url` points at — always whatever the
    metadata route most recently found for the then-active target (see
    app.state.last_stack_cache), never a path built from anything the client
    sent. A cold cache — this hit before /api/last_stack ever succeeded, or
    after a call that found nothing for the current target — is an honest
    404, same shape as live_preview_image's and target_image's absent states.
    """
    cache: LastStack | None = getattr(request.app.state, "last_stack_cache", None)
    if cache is None:
        return JSONResponse(
            {"ok": False, "error": "no last stack available yet"}, status_code=404
        )
    return await _share_image_response(cache.path, missing="no last stack available yet")


# --- session activity (operator panel) --------------------------------------
#
# Same "was this ever set on app.state at all" sentinel as _archive_dir_and_tz
# / _live_share_dir above.
_PROVENANCE_PATH_UNSET = object()


def _provenance_path(request: Request) -> Path | None:
    path = getattr(request.app.state, "provenance_path", _PROVENANCE_PATH_UNSET)
    if path is _PROVENANCE_PATH_UNSET:
        path = DEFAULT_PROVENANCE_PATH
    return Path(path) if path is not None else None


@router.get("/session_activity")
async def session_activity(
    request: Request, limit: int = Query(default=100, ge=1, le=500)
) -> JSONResponse:
    """Newest-first tail of SeeStar-AI's provenance.jsonl, each record
    classified console/agent/ambiguous/unknown from its own `client` field —
    see session_activity.py's module docstring, which also records why this
    used to infer origin from the tool tag and why that had to go.

    Not a tool call — see allowlist.SIDECAR_ROUTES — and read-only in the
    strict sense: this only ever reads bytes off a file SeeStar-AI itself
    owns and is actively appending to, never writes, rotates, truncates or
    locks it.
    """
    path = _provenance_path(request)
    if path is None:
        return JSONResponse(
            {"ok": True, "records": [], "truncated": False, "source_configured": False}
        )
    if not path.is_file():
        # Configured, but nothing logged yet (or a typo'd path) — a normal,
        # non-error degrade, same discipline as ArchiveStatus's
        # "configured, but not there" state (see archive.py).
        return JSONResponse(
            {"ok": True, "records": [], "truncated": False, "source_configured": True}
        )
    records, truncated = read_recent_activity(path, limit, effective_client_id())
    return JSONResponse(
        {
            "ok": True,
            "records": [asdict(record) for record in records],
            "truncated": truncated,
            "source_configured": True,
        }
    )


# --- QA review (slice 4) ----------------------------------------------------
#
# See docs/superpowers/specs/2026-07-31-slice-4-review-qa.md and
# qa_analysis.py's module docstring for the full design ("Option A": on-demand,
# explicitly triggered, disk-cached analysis, never run implicitly). None of
# the three routes below is a literal tool call — see allowlist.SIDECAR_ROUTES
# — and `qa_tier2`, the one tool any of them ever reaches, is only ever
# called from qa_analysis_start's background asyncio.Task, never awaited
# inline in a request handler (see allowlist.NO_DIRECT_ROUTE_TOOLS).
#
# Same "was this ever set on app.state at all" sentinel as
# _archive_dir_and_tz / _live_share_dir / _provenance_path above.
_QA_CACHE_DIR_UNSET = object()


def _qa_cache_dir(request: Request) -> Path:
    cache_dir = getattr(request.app.state, "qa_cache_dir", _QA_CACHE_DIR_UNSET)
    if cache_dir is _QA_CACHE_DIR_UNSET:
        cache_dir = DEFAULT_QA_CACHE_DIR
    return Path(cache_dir)


def _refuse_unknown_target(target: str, scan: ArchiveScan) -> JSONResponse | None:
    """`None` when `target` is an id the archive scan produced or is shaped
    like a target id, else the 404 to return.

    Both QA routes below hand `target` to qa_analysis, which builds its cache
    file path from it. Unchecked, `?target=../x` read a file outside the
    cache, and `?target=//host/share/x` made Windows open an SMB session to
    an attacker's host (leaking the user's NTLM hash) — reachable from a bare
    `<img>` on any page the user had open, since qa_analysis_status is a GET.
    qa_analysis refuses such paths itself as well (see its `_contained`);
    this is the first layer.

    The shape check alone is a character whitelist, and real archive
    directories use others: "Thor's Helmet_sub" normalises to
    "Thor'sHelmet", which qa_targets listed and neither route would take. A
    key of `scan.targets` came from a directory name on the user's own disk,
    never from the request, so it is accepted as it is; its cache file name
    is still checked lexically by `_contained`.
    """
    if target in scan.targets or is_plausible_target_id(target):
        return None
    return JSONResponse(
        {"ok": False, "error": f"not a recognised target id: {target!r}"}, status_code=404
    )


def _qa_job_registry(request: Request) -> QaJobRegistry:
    """create_app() always sets app.state.qa_job_registry (see main.py) —
    the fallback here only guards a bare, non-create_app() app, the same
    defensive style every other app.state accessor in this file already
    holds itself to.
    """
    registry = getattr(request.app.state, "qa_job_registry", None)
    if registry is None:
        registry = QaJobRegistry()
        request.app.state.qa_job_registry = registry
    return registry


@router.get("/qa_targets")
async def qa_targets(request: Request) -> JSONResponse:
    """Every target the archive scan knows about, each with its Tier-2
    analysis status (see qa_analysis.resolve_status) and raw `sub_count` —
    so the screen can show scale ("842 subs") before the user opts into a
    multi-minute analysis, per the spec's honesty requirement. Reports never
    include the full per-sub report here (`include_report=False`): with N
    targets each carrying up to ~412 KB of per-sub metrics (measured at 1400
    subs — see the spec), embedding every one in a listing response would be
    exactly the bloat qa_analysis_status exists to avoid; that route is
    the one place a single target's full report is ever returned.

    NEVER triggers analysis — this only ever reads the archive scan, the
    in-memory job registry and the on-disk cache. See qa_analysis_start for
    the one route that can start a job.
    """
    archive_dir, local_tz = _archive_dir_and_tz(request)
    scan = scan_archive(archive_dir, local_tz=local_tz)
    cache_dir = _qa_cache_dir(request)
    registry = _qa_job_registry(request)

    targets = []
    for target in scan.targets.values():
        signature = qa_analysis.compute_signature(target.sub_paths)
        status = qa_analysis.resolve_status(
            registry, cache_dir, target.target_id, signature, include_report=False
        )
        # The quality mix, without the report. Five integers per target is
        # what lets the Projects grid tone a bar by pass/marginal/reject;
        # embedding 22 reports of up to ~430 KB would be the bloat
        # include_report=False exists to prevent.
        # Counts are attached ONLY when they describe the sub set on disk
        # right now. load_cached_report deliberately does not compare
        # signatures (that is resolve_status's job), so using it unqualified
        # meant a target whose subs had grown still advertised "N of M
        # keepable" from an older run — a specific, confident number that
        # silently omitted every new frame. `status` was already in this
        # payload, but a consumer has to remember to check it, and the
        # Projects grid did not.
        cached = qa_analysis.load_cached_report(cache_dir, target.target_id)
        counts = (
            qa_analysis.verdict_counts((cached or {}).get("result"))
            if status.get("status") == qa_analysis.STATUS_COMPLETE
            else None
        )
        targets.append(
            {
                "target_id": target.target_id,
                "display_name": target.display_name,
                "sub_count": len(target.sub_paths),
                **status,
                **({"verdicts": counts} if counts is not None else {}),
            }
        )
    return JSONResponse(
        {"ok": True, "targets": targets, "archive_status": asdict(scan.status)}
    )


@router.get("/sub_image/{target_id}/{sub_name}")
async def sub_image(request: Request, target_id: str, sub_name: str) -> Response:
    """The Seestar's own JPEG thumbnail for one sub, so a row in the Review &
    QA table can be looked at rather than only read.

    The scope writes `<stem>_thn.jpg` beside every `Light_*.fit` it captures —
    verified across the whole archive: 7,533 subs, 7,533 thumbnails, none
    missing. So this needs no FITS decoding and no handing a path to the OS to
    open; it serves a file that is already there, at ~15 KB.

    `sub_name` is `qa_tier2.summary.subs[].name`, which is `path.stem` — NO
    extension (see CONTRACT.md). This route appends the thumbnail suffix
    itself rather than trusting a filename from the URL.

    **Neither path component is ever used to build a filesystem path.**
    `target_id` goes through `_refuse_unknown_target()` as the QA routes'
    does — so the Review & QA table can show subs of a target like
    "Thor'sHelmet" that it can analyse — and is then only a key into the
    archive scan. The sub is resolved by matching `sub_name` against the
    STEMS of files the archive scan itself discovered. A `..` or an absolute
    path matches no stem and 404s, because nothing here concatenates user
    input onto a directory.
    """
    archive_dir, local_tz = _archive_dir_and_tz(request)
    scan = scan_archive(archive_dir, local_tz=local_tz)
    refusal = _refuse_unknown_target(target_id, scan)
    if refusal is not None:
        return refusal
    target = scan.targets.get(target_id)
    if target is None:
        return JSONResponse(
            {"ok": False, "error": f"no archive target {target_id!r}"}, status_code=404
        )

    # Match against what the scan found. Never `folder / f"{sub_name}_thn.jpg"`.
    match = next((p for p in target.sub_paths if p.stem == sub_name), None)
    if match is None:
        return JSONResponse(
            {"ok": False, "error": f"no sub {sub_name!r} in {target_id!r}"}, status_code=404
        )

    thumbnail = match.with_name(f"{match.stem}{SUB_THUMBNAIL_SUFFIX}")
    if not thumbnail.exists():
        # Honest absent state: the sub is real, its thumbnail is not. Distinct
        # from "no such sub", and the UI says so rather than showing a gap.
        return JSONResponse(
            {"ok": False, "error": f"no thumbnail alongside {sub_name!r}"}, status_code=404
        )

    return _image_response(thumbnail)


@router.post("/qa_analysis_start")
async def qa_analysis_start(request: Request, target: str) -> JSONResponse:
    """Explicitly trigger Tier-2 QA analysis for `target` — see
    qa_analysis.start_analysis(). Only ever reached from a deliberate user
    action on the client; never called on a page load (see CLAUDE.md and the
    spec's "Do not start an analysis on a page load, ever").

    Idempotent: a target already running, or already cached/analysed for its
    CURRENT sub set, returns that status without starting a second job or
    recomputing anything — see start_analysis()'s own docstring for exactly
    which cases short-circuit before `qa_tier2` is ever called.

    A target the archive scan has never heard of, or one with no subs on
    disk (an archive target directory that exists but is currently empty),
    is an honest 404 — there is nothing to analyse, not a transport failure.

    At qa_analysis.MAX_CONCURRENT_ANALYSES a new job is refused with HTTP 429
    `{"ok": false, "error": ...}` — a refusal, not a job state. A start
    answered from a finished analysis of the current sub set carries its
    `report`, the same shape qa_analysis_status returns.
    """
    refusal = _reject_untrusted_caller(request)
    if refusal is not None:
        return refusal

    archive_dir, local_tz = _archive_dir_and_tz(request)
    scan = scan_archive(archive_dir, local_tz=local_tz)
    refusal = _refuse_unknown_target(target, scan)
    if refusal is not None:
        return refusal
    archive_target = scan.targets.get(target)
    if archive_target is None or not archive_target.sub_paths:
        return JSONResponse(
            {"ok": False, "error": f"no subs found on disk for {target!r}"}, status_code=404
        )
    if not qa_analysis.can_cache(target):
        # Only an archive on a file system Windows cannot mirror gets here
        # (see qa_analysis._contained). Refused before minutes of analysis
        # whose report could never be saved.
        return JSONResponse(
            {"ok": False, "error": f"{target!r} cannot be analysed: its name cannot be a file name"},
            status_code=404,
        )

    cache_dir = _qa_cache_dir(request)
    registry = _qa_job_registry(request)
    app = request.app  # captured now; the background task must not depend
    # on this Request object staying meaningfully "live" past this handler's
    # own return — see _call_tool_on_app()'s docstring.

    async def call_qa_tier2(paths: list[str]) -> dict:
        return await _call_tool_on_app(app, "qa_tier2", {"paths": paths})

    try:
        # include_report=True: when start short-circuits on a finished
        # analysis of the current sub set (in memory or on disk), the answer
        # carries that report exactly as qa_analysis_status would. A running
        # job never has one, so a fresh start is unaffected.
        status = qa_analysis.start_analysis(
            registry, cache_dir, target, archive_target.sub_paths, call_qa_tier2, include_report=True
        )
    except qa_analysis.TooManyAnalyses as refusal:
        # A refusal, not a job state: nothing was started, and whatever the
        # client already shows for this target (a stale report, say) stands.
        return JSONResponse({"ok": False, "error": str(refusal)}, status_code=429)
    # `sub_count` included so this matches qa_analysis_status exactly. It used
    # to be omitted here and present there, which meant one client schema
    # could not describe both — the browser rejected every start response and
    # showed a parse error while the job it had just launched ran to
    # completion behind it. Two routes a consumer polls interchangeably should
    # not differ by a field.
    return JSONResponse(
        {"ok": True, "target_id": target, "sub_count": len(archive_target.sub_paths), **status}
    )


@router.get("/qa_analysis_status")
async def qa_analysis_status(request: Request, target: str) -> JSONResponse:
    """Poll — and, once complete, retrieve — one target's Tier-2 report.
    NEVER triggers analysis itself; see qa_analysis_start for that.

    `report`, present only when `status` is "complete" or "stale", is
    qa_tier2's own `summary`/`keep_list` shape verbatim — every per-sub
    `verdict`/`reasons`/`metrics` entry passed through exactly as the tool
    returned it. Per CLAUDE.md and the spec §2, this sidecar never recomputes
    or reshapes a verdict, never filters out a sub whose `metrics.error` is
    set, and never hardcodes a QA threshold — that discipline holds here
    just as much as it does in the browser.

    A target unknown to the archive scan still gets a real answer
    (`sub_count: 0`, whatever status the cache/registry independently know —
    ordinarily "not_analysed") rather than a 404: unlike qa_analysis_start,
    polling status is not an action that needs subs to exist on disk right
    now to make sense of.

    A `target` the archive does not hold and that is not even shaped like a
    target id is a 404 before anything reads the cache — see
    _refuse_unknown_target.
    """
    archive_dir, local_tz = _archive_dir_and_tz(request)
    scan = scan_archive(archive_dir, local_tz=local_tz)
    refusal = _refuse_unknown_target(target, scan)
    if refusal is not None:
        return refusal

    archive_target = scan.targets.get(target)
    sub_paths = archive_target.sub_paths if archive_target is not None else []

    signature = qa_analysis.compute_signature(sub_paths)
    cache_dir = _qa_cache_dir(request)
    registry = _qa_job_registry(request)
    status = qa_analysis.resolve_status(
        registry, cache_dir, target, signature, include_report=True
    )
    return JSONResponse({"ok": True, "target_id": target, "sub_count": len(sub_paths), **status})
