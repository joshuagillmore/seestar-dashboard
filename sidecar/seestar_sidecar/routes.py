"""One GET per allowlisted tool. Routes are literal — an unlisted tool 404s
because no handler exists for it, not because a guard rejected it.
"""
import os

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from seestar_sidecar.mcp_proxy import ProxyTransportError
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


async def _serve(request: Request, tool: str, arguments: dict) -> JSONResponse:
    # Every failure below returns the same {ok, error} shape the tools
    # themselves use, so the client parses one error format regardless of which
    # layer failed. A tool RETURNING {"ok": false, ...} is not a failure — that
    # is a valid response and forwards at 200.
    if replay_enabled():
        try:
            return JSONResponse(load_fixture(tool))
        except FileNotFoundError as exc:
            # Carries a "run record.py" pointer. Letting it escape turns a
            # diagnosable message into a generic 500.
            return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)
    try:
        return JSONResponse(await call_tool(request, tool, arguments))
    except ProxyTransportError as exc:
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
