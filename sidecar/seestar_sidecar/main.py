"""FastAPI app factory. CORS is open to the Vite dev origin only."""
import os
from contextlib import asynccontextmanager
from datetime import timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from seestar_sidecar import env as _env  # noqa: F401 — loads .env before SEESTAR_AI_DIR is read below; see env.py
from seestar_sidecar.archive import DEFAULT_ARCHIVE_DIR
from seestar_sidecar.catalog import DEFAULT_ALIASES_PATH, DEFAULT_CATALOG_PATH
from seestar_sidecar.frontend import DEFAULT_WEB_DIST, mount_frontend
from seestar_sidecar.imagery import DEFAULT_IMAGE_CACHE_DIR
from seestar_sidecar.live_preview import DEFAULT_LIVE_SHARE_DIR
from seestar_sidecar.allowlist import ALLOWED_TOOLS
from seestar_sidecar.mcp_proxy import (
    DEFAULT_CALL_TIMEOUT_SECONDS,
    LONG_RUNNING_TOOLS,
    QA_CALL_TIMEOUT_SECONDS,
    McpConnection,
)
from seestar_sidecar.qa_analysis import DEFAULT_QA_CACHE_DIR, QaJobRegistry
from seestar_sidecar.routes import replay_enabled, router
from seestar_sidecar.session_activity import DEFAULT_PROVENANCE_PATH

VITE_DEV_ORIGIN = "http://localhost:5173"
#: No personal-path fallback: unlike DEFAULT_ARCHIVE_DIR (see archive.py),
#: there is no default at all here, guessed or otherwise — a checkout of
#: this repo has no way to know where a sibling seestar-mcp checkout lives
#: on someone else's machine. `None` means "not configured" and is handled
#: explicitly below, not passed to subprocess.Popen. See docs/configuration.md.
SEESTAR_AI_DIR = os.environ.get("SEESTAR_AI_DIR")
#: The message call_tool (routes.py) raises when app.state.connection is
#: None specifically because SEESTAR_AI_DIR isn't set — distinct from a bare
#: TestClient(create_app()) that never ran the lifespan at all, which keeps
#: the older, more generic message (see create_app()'s own comment below).
_SEESTAR_AI_DIR_UNSET_MESSAGE = (
    "SEESTAR_AI_DIR is not set, so the sidecar has nowhere to run the "
    "seestar-mcp server from. Set it to your seestar-mcp checkout, or run "
    "with SEESTAR_REPLAY=1 to serve recorded fixtures instead — see "
    "docs/configuration.md."
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The connection lives on app.state rather than a module global, so each
    # create_app() owns its own and two apps in one process cannot clobber
    # each other. Routes read it via request.app.state.
    app.state.connection = None
    app.state.qa_connection = None
    if not replay_enabled():
        if SEESTAR_AI_DIR:
            server_args = ["--directory", SEESTAR_AI_DIR, "run", "python", "-m", "seestar_mcp.server"]
            # Two server processes, not one. qa_tier2 runs for minutes and
            # blocks its server's event loop while it does (upstream's
            # analyze_session() is synchronous — a hand-back item); on a shared
            # connection every live poll queued behind it. Each connection only
            # accepts the tools it exists for, so a routing mistake is a
            # refusal rather than a minutes-long call on the wrong process.
            # See mcp_proxy.LONG_RUNNING_TOOLS for why a second process is safe.
            app.state.connection = McpConnection(
                command="uv",
                args=server_args,
                allowed_tools=ALLOWED_TOOLS - LONG_RUNNING_TOOLS,
                call_timeout_s=DEFAULT_CALL_TIMEOUT_SECONDS,
            )
            app.state.qa_connection = McpConnection(
                command="uv",
                args=server_args,
                allowed_tools=LONG_RUNNING_TOOLS,
                call_timeout_s=QA_CALL_TIMEOUT_SECONDS,
            )
            # Deliberately not started here: a dead SeeStar-AI checkout should
            # not stop the sidecar booting. The first request starts it and
            # surfaces any failure as a 502 the UI can render. The QA server
            # in particular is only ever spawned by a user starting an
            # analysis.
        else:
            # Leaving connection None here, rather than building a
            # McpConnection with a None directory, is what stops this from
            # reaching subprocess.Popen with a literal `None` argv entry on
            # the first request — a TypeError, not the readable 502 every
            # other missing-config path in this app produces. call_tool's
            # existing "connection is None" branch already renders this as a
            # 502; only the message differs (see below).
            app.state.connection_unavailable_reason = _SEESTAR_AI_DIR_UNSET_MESSAGE
    yield
    # Both servers are closed even if closing one fails: an exception from
    # the first must not leave the second process running after the sidecar
    # has exited.
    connections = [app.state.connection, app.state.qa_connection]
    app.state.connection = None
    app.state.qa_connection = None
    failures = []
    for connection in connections:
        if connection is None:
            continue
        try:
            await connection.aclose()
        except Exception as exc:  # noqa: BLE001 — re-raised below, after the rest
            failures.append(exc)
    if failures:
        raise failures[0]


def create_app(
    web_dist: Path | str | None = None,
    archive_dir: Path | str | None = None,
    local_tz: timezone | None = None,
    catalog_path: Path | str | None = None,
    aliases_path: Path | str | None = None,
    image_cache_dir: Path | str | None = None,
    live_share_dir: Path | str | None = None,
    provenance_path: Path | str | None = None,
    qa_cache_dir: Path | str | None = None,
) -> FastAPI:
    """`web_dist` defaults to web/dist; `archive_dir` defaults to
    SEESTAR_ARCHIVE_DIR, or `None` — "not configured" — when that isn't set
    (see archive.DEFAULT_ARCHIVE_DIR and docs/configuration.md). Both only
    need overriding in tests, since the `uv run seestar-dashboard` /
    `--factory` entry points call this with no arguments.

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

    `live_share_dir` defaults to `live_preview.DEFAULT_LIVE_SHARE_DIR`
    (`SEESTAR_LIVE_SHARE_DIR`, or `None` if unset — see live_preview.py and
    docs/configuration.md) and only needs overriding so a test can point at a
    synthetic `tmp_path` tree instead of a real SMB share.

    `provenance_path` defaults to `session_activity.DEFAULT_PROVENANCE_PATH`
    (`SEESTAR_PROVENANCE_PATH`, or `<SEESTAR_AI_DIR>/data/provenance.jsonl`,
    or `None` if neither is set — see session_activity.py and
    docs/configuration.md) and only needs overriding so a test can point at
    a synthetic file instead of the real, live-appended one.

    `qa_cache_dir` defaults to `qa_analysis.DEFAULT_QA_CACHE_DIR`
    (`sidecar/.cache/qa_analysis`, gitignored) and only needs overriding so a
    test can point at `tmp_path` instead of writing into the real cache —
    see qa_analysis.write_cached_report().
    """
    app = FastAPI(title="seestar-sidecar", version="0.1.0", lifespan=lifespan)
    # Safe default for callers that never run the lifespan — a bare
    # TestClient(create_app()) does exactly that. Routes then report
    # "MCP connection not started" as a 502 rather than an AttributeError 500.
    app.state.connection = None
    app.state.qa_connection = None
    app.state.connection_unavailable_reason = None
    app.state.archive_dir = Path(archive_dir) if archive_dir is not None else DEFAULT_ARCHIVE_DIR
    app.state.local_tz = local_tz
    app.state.catalog_path = Path(catalog_path) if catalog_path is not None else DEFAULT_CATALOG_PATH
    app.state.aliases_path = Path(aliases_path) if aliases_path is not None else DEFAULT_ALIASES_PATH
    app.state.image_cache_dir = (
        Path(image_cache_dir) if image_cache_dir is not None else DEFAULT_IMAGE_CACHE_DIR
    )
    app.state.live_share_dir = (
        Path(live_share_dir) if live_share_dir is not None else DEFAULT_LIVE_SHARE_DIR
    )
    app.state.provenance_path = (
        Path(provenance_path) if provenance_path is not None else DEFAULT_PROVENANCE_PATH
    )
    app.state.qa_cache_dir = (
        Path(qa_cache_dir) if qa_cache_dir is not None else DEFAULT_QA_CACHE_DIR
    )
    # One registry per app instance, same discipline as app.state.connection
    # — two apps in a process must not share QA job state. See
    # qa_analysis.QaJobRegistry and routes.py's qa_analysis_start/
    # qa_analysis_status handlers.
    app.state.qa_job_registry = QaJobRegistry()
    # Holds the last successfully discovered LiveFrame (see live_preview.py),
    # so a momentary share failure can degrade to "last known frame, marked
    # stale" instead of "nothing" — see routes.py's live_preview handler.
    # Lives on app.state for the same reason app.state.connection does: one
    # per app instance, so two apps in one process don't share a cache.
    app.state.live_preview_cache = None
    # Holds the last successfully discovered LastStack (see last_stack.py),
    # so /api/last_stack/image can serve the same bytes /api/last_stack most
    # recently found. Unlike live_preview_cache above, routes.py clears this
    # to None whenever a /api/last_stack call does NOT find a stack matching
    # the CURRENTLY active target — this route has no "stale but still show
    # it" degrade (see last_stack.py's module docstring: there is no polling
    # interval to be stale relative to, only a one-off fetch per target
    # change), and serving a previous target's cached image after being told
    # "no stack for this target" would be exactly the wrong-target mistake
    # the scoping rule exists to prevent.
    app.state.last_stack_cache = None
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
