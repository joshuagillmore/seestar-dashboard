"""FastAPI app factory. CORS is open to the Vite dev origin only."""
import os
from contextlib import asynccontextmanager
from datetime import timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from seestar_sidecar.archive import DEFAULT_ARCHIVE_DIR
from seestar_sidecar.catalog import DEFAULT_ALIASES_PATH, DEFAULT_CATALOG_PATH
from seestar_sidecar.frontend import DEFAULT_WEB_DIST, mount_frontend
from seestar_sidecar.imagery import DEFAULT_IMAGE_CACHE_DIR
from seestar_sidecar.mcp_proxy import McpConnection
from seestar_sidecar.routes import replay_enabled, router

VITE_DEV_ORIGIN = "http://localhost:5173"
SEESTAR_AI_DIR = os.environ.get("SEESTAR_AI_DIR", "C:/Users/<user>/SeeStar-AI")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The connection lives on app.state rather than a module global, so each
    # create_app() owns its own and two apps in one process cannot clobber
    # each other. Routes read it via request.app.state.
    app.state.connection = None
    if not replay_enabled():
        app.state.connection = McpConnection(
            command="uv",
            args=["--directory", SEESTAR_AI_DIR, "run", "python", "-m", "seestar_mcp.server"],
        )
        # Deliberately not started here: a dead SeeStar-AI checkout should not
        # stop the sidecar booting. The first request starts it and surfaces
        # any failure as a 502 the UI can render.
    yield
    if app.state.connection is not None:
        await app.state.connection.aclose()
        app.state.connection = None


def create_app(
    web_dist: Path | str | None = None,
    archive_dir: Path | str | None = None,
    local_tz: timezone | None = None,
    catalog_path: Path | str | None = None,
    aliases_path: Path | str | None = None,
    image_cache_dir: Path | str | None = None,
) -> FastAPI:
    """`web_dist` defaults to web/dist and `archive_dir` to
    SEESTAR_ARCHIVE_DIR / its own default — both only need overriding in
    tests, since the `uv run seestar-dashboard` / `--factory` entry points
    call this with no arguments.

    `local_tz` is likewise test-only: it threads through to
    `archive.scan_archive()`, whose own default (`None`) reads the system's
    timezone — correct for a production sidecar always running on the
    machine that wrote the archive, but a machine-timezone dependency no
    test should inherit. See archive.py's `_local_capture_instant_utc`.

    `catalog_path` / `aliases_path` default to the committed
    `data/dso_catalog_extended.json` / `data/dso_aliases.json` — see
    catalog.py — and, like `archive_dir`, only need overriding so a test can
    point at a small synthetic fixture instead of the real 12,517-object file.

    `image_cache_dir` defaults to `imagery.DEFAULT_IMAGE_CACHE_DIR`
    (`sidecar/.cache/target_images`, gitignored) and only needs overriding so
    a test can point at `tmp_path` instead of writing into the real cache —
    see imagery.fetch_survey_cutout().
    """
    app = FastAPI(title="seestar-sidecar", version="0.1.0", lifespan=lifespan)
    # Safe default for callers that never run the lifespan — a bare
    # TestClient(create_app()) does exactly that. Routes then report
    # "MCP connection not started" as a 502 rather than an AttributeError 500.
    app.state.connection = None
    app.state.archive_dir = Path(archive_dir) if archive_dir is not None else DEFAULT_ARCHIVE_DIR
    app.state.local_tz = local_tz
    app.state.catalog_path = Path(catalog_path) if catalog_path is not None else DEFAULT_CATALOG_PATH
    app.state.aliases_path = Path(aliases_path) if aliases_path is not None else DEFAULT_ALIASES_PATH
    app.state.image_cache_dir = (
        Path(image_cache_dir) if image_cache_dir is not None else DEFAULT_IMAGE_CACHE_DIR
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[VITE_DEV_ORIGIN],
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    app.include_router(router)
    # Must come after include_router(): mount_frontend()'s "/" mount
    # technically matches every path, so anything registered after it would
    # never be reached. See frontend.py's module docstring.
    mount_frontend(app, Path(web_dist) if web_dist is not None else DEFAULT_WEB_DIST)
    return app
