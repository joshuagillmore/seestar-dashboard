"""Loads `.env` from the repo root, once, before any module reads
os.environ for its own machine-specific configuration — see
docs/configuration.md and .env.example.

Environment variables alone are not enough for either audience this app
serves: they have to be re-exported in every new shell, and the documented
Windows launch path is a desktop shortcut with no shell to have exported
anything. `.env` is the persistence layer for both; real environment
variables still win over it (`override=False` below, python-dotenv's own
default, spelled out here for clarity) — a `.env` is a convenience for a
checkout, never a way to override something deliberately set.

Every module that reads a machine-specific env var at import time
(archive.py's DEFAULT_ARCHIVE_DIR, main.py's SEESTAR_AI_DIR,
imagery.py's DEFAULT_IMAGE_CACHE_DIR, record.py's SEESTAR_AI_DIR) imports
this module first, so `.env` is loaded before that read happens regardless
of which of those modules gets imported first — pytest importing archive.py
directly, uvicorn importing main.py, or record.py's/launcher.py's own entry
points. launcher.py reads SEESTAR_PORT inside main(), not at import time,
but still imports this module at its own top for the same reason: it never
transitively imports the others before evaluating that default.

Safe to import from more than one module: Python only runs a module's body
once per process (subsequent imports just fetch the cached module object),
so the `load_dotenv_once()` call below only actually reads the file once
regardless of how many of this sidecar's modules import this one.
"""
from pathlib import Path

from dotenv import load_dotenv

#: sidecar/seestar_sidecar/env.py -> parents[2] is the repo root — the same
#: hop count frontend.py's DEFAULT_WEB_DIST and catalog.py's
#: DEFAULT_CATALOG_PATH already use for "relative to this checkout".
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DOTENV_PATH = REPO_ROOT / ".env"


def load_dotenv_once(path: Path = DEFAULT_DOTENV_PATH) -> None:
    """Load `path` into `os.environ`, real values always winning.

    A missing `.env` is a silent no-op — python-dotenv's own behaviour,
    and the same "not configured" default every other optional setting in
    this app already degrades to (see archive.DEFAULT_ARCHIVE_DIR). Takes
    an explicit `path` (rather than only ever reading DEFAULT_DOTENV_PATH)
    so tests can point this at a synthetic fixture instead of this
    machine's real, gitignored `.env` — the same discipline
    archive_dir/catalog_path already hold themselves to elsewhere in this
    app.
    """
    load_dotenv(path, override=False)


load_dotenv_once()
