"""One GET per allowlisted tool. Routes are literal — an unlisted tool 404s
because no handler exists for it, not because a guard rejected it.
"""
import os

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from seestar_sidecar.mcp_proxy import ProxyTransportError
from seestar_sidecar.replay import load_fixture

router = APIRouter(prefix="/api")


def replay_enabled() -> bool:
    return os.environ.get("SEESTAR_REPLAY") == "1"


async def call_tool(tool: str, arguments: dict) -> dict:
    """Indirection so tests can substitute a failing transport."""
    from seestar_sidecar.main import get_connection

    return await get_connection().call(tool, arguments)


async def _serve(tool: str, arguments: dict) -> JSONResponse:
    if replay_enabled():
        return JSONResponse(load_fixture(tool))
    try:
        return JSONResponse(await call_tool(tool, arguments))
    except ProxyTransportError as exc:
        # Same {ok, error} shape the tools themselves use on failure, so the
        # client has exactly one error shape to handle.
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/health")
async def health() -> dict:
    return {"ok": True, "replay": replay_enabled()}


@router.get("/assess_conditions")
async def assess_conditions() -> JSONResponse:
    return await _serve("assess_conditions", {})


@router.get("/plan_targets")
async def plan_targets(limit: int = Query(default=3, ge=1, le=10)) -> JSONResponse:
    return await _serve("plan_targets", {"limit": limit})


@router.get("/get_site_profile")
async def get_site_profile() -> JSONResponse:
    return await _serve("get_site_profile", {})
