"""Serve recorded fixtures instead of spawning a subprocess.

This is what the test gate and offline UI work run against.
"""
import json
from functools import lru_cache
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


@lru_cache(maxsize=None)
def load_fixture(tool: str) -> dict:
    path = FIXTURES / f"{tool}.json"
    if not path.is_file():
        raise FileNotFoundError(
            f"no fixture for {tool!r} at {path} — run `uv run python record.py`"
        )
    return json.loads(path.read_text(encoding="utf-8"))
