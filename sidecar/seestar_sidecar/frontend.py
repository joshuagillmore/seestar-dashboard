"""Serves the built frontend from the same process and port as /api/*.

Route order is the whole trick: FastAPI/Starlette tries routes in the order
they were added and stops at the first match. The `/api` router is included
in main.create_app() before mount_frontend() runs, so every allowlisted tool
route wins over the mount below it even though the mount's "/" prefix
technically matches every path, including theirs.
"""
import mimetypes
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.types import Scope

# Found by curling the actually-running server, not by a test: this
# machine's Windows mimetypes registry has no .woff2/.woff entry, so
# StaticFiles' FileResponse guessed `None` and fell back to text/plain for
# the self-hosted fonts. Browsers are lenient about font MIME types, but
# there's no reason to ship the wrong one when registering the right one
# is two lines, done once at import time.
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")

#: sidecar/seestar_sidecar/frontend.py -> parents[2] is the repo root.
DEFAULT_WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"

MISSING_DIST_MESSAGE = (
    "SeeStar Console has not been built yet.\n\n"
    "Run `npm run build` in web/, then restart the sidecar.\n"
    "The API is already available at /api/*."
)


class _SpaStaticFiles(StaticFiles):
    """Falls back to index.html for any path that isn't a real file.

    StaticFiles(html=True) alone only auto-serves index.html when the
    resolved path IS a directory, which is why "/" works out of the box —
    a client-side route like "/projects" is not a directory or a file on
    disk, so it 404s unless a 404.html copy of index.html sits next to it.
    Catching the 404 here and re-serving index.html does the same job
    without asking the build to produce that extra file: any path that
    isn't a real asset is, by definition, a client-side route.

    The one path shape this must NOT rescue is /api/*: an unregistered tool
    under /api is supposed to 404 (see allowlist.py — "a tool with side
    effects has no route at all"), and this mount only ever sees such a
    path because the /api router already looked at it and didn't recognise
    it. Falling back to index.html there would turn that structural 404
    into a silent 200, which is worse than either a stack trace or a plain
    404: it would look like the request worked.
    """

    async def get_response(self, path: str, scope: Scope) -> Any:
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or _is_api_path(path):
                raise
            return await super().get_response("index.html", scope)


def _is_api_path(path: str) -> bool:
    first_segment = path.replace("\\", "/").lstrip("/").split("/", 1)[0]
    return first_segment == "api"


def mount_frontend(app: FastAPI, web_dist: Path) -> None:
    """Mount web_dist at "/", or a plain setup message if it hasn't been built.

    Must be called after the /api router is included on `app` — see the
    module docstring. A missing web/dist is a setup state (the user hasn't
    run `npm run build` yet), not a crash: the sidecar still boots and
    /api/* still works, so uv run uvicorn ... comes up before web/ is ever
    built.
    """
    if web_dist.is_dir():
        app.mount("/", _SpaStaticFiles(directory=web_dist, html=True), name="frontend")
        return

    @app.get("/", include_in_schema=False)
    async def _frontend_not_built() -> PlainTextResponse:
        return PlainTextResponse(MISSING_DIST_MESSAGE)
