"""One GET per allowlisted tool, plus a small set of sidecar-computed read
views (see allowlist.SIDECAR_ROUTES) that compose tool calls with local
read-only computation. Routes are literal — an unlisted tool 404s because no
handler exists for it, not because a guard rejected it.
"""
import os
from pathlib import Path

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from seestar_sidecar.archive import DEFAULT_ARCHIVE_DIR, scan_archive
from seestar_sidecar.mcp_proxy import ProxyTransportError
from seestar_sidecar.projects_union import combine_projects
from seestar_sidecar.replay import load_fixture

router = APIRouter(prefix="/api")


def replay_enabled() -> bool:
    return os.environ.get("SEESTAR_REPLAY") == "1"


async def call_tool(request: Request, tool: str, arguments: dict) -> dict:
    """Indirection so tests can substitute a failing transport.

    The connection lives on app.state, not a module global: one per app
    instance, so two apps in a process cannot clobber each other.
    """
    connection = getattr(request.app.state, "connection", None)
    if connection is None:
        raise ProxyTransportError("MCP connection not started")
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


@router.get("/plan_targets")
async def plan_targets(
    request: Request, limit: int = Query(default=12, ge=1, le=50)
) -> JSONResponse:
    return await _serve(request, "plan_targets", {"limit": limit})


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


@router.get("/projects_combined")
async def projects_combined(request: Request) -> JSONResponse:
    """Union of the store's list_projects with the on-disk archive scan.

    Not a tool call itself — see allowlist.SIDECAR_ROUTES — but it never
    reads or computes anything list_projects and a filesystem scan couldn't
    already give it: no side effects, nothing written.
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

    archive_dir = getattr(request.app.state, "archive_dir", None) or DEFAULT_ARCHIVE_DIR
    scan = scan_archive(Path(archive_dir))
    projects = combine_projects(store["projects"], scan.targets)
    totals = {
        "store_minutes": round(sum(p["store_minutes"] for p in projects), 4),
        "archive_minutes": round(sum(p["archive_minutes"] for p in projects), 4),
        "total_minutes": round(sum(p["total_minutes"] for p in projects), 4),
    }
    return JSONResponse(
        {"ok": True, "projects": projects, "count": len(projects), "totals": totals}
    )
