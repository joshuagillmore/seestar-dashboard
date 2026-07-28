"""FastAPI app factory. CORS is open to the Vite dev origin only."""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from seestar_sidecar.mcp_proxy import McpConnection
from seestar_sidecar.routes import replay_enabled, router

VITE_DEV_ORIGIN = "http://localhost:5173"
SEESTAR_AI_DIR = os.environ.get("SEESTAR_AI_DIR", "C:/Users/<user>/SeeStar-AI")

_connection: McpConnection | None = None


def get_connection() -> McpConnection:
    if _connection is None:
        raise RuntimeError("MCP connection not started")
    return _connection


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _connection
    if not replay_enabled():
        _connection = McpConnection(
            command="uv",
            args=["--directory", SEESTAR_AI_DIR, "run", "python", "-m", "seestar_mcp.server"],
        )
        # Deliberately not started here: a dead SeeStar-AI checkout should not
        # stop the sidecar booting. The first request starts it and surfaces
        # any failure as a 502 the UI can render.
    yield
    if _connection is not None:
        await _connection.aclose()
        _connection = None


def create_app() -> FastAPI:
    app = FastAPI(title="seestar-sidecar", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[VITE_DEV_ORIGIN],
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    app.include_router(router)
    return app
