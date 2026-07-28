"""One GET per allowlisted tool. Nothing is registered dynamically from a
request path — the routes below are literal, so an unlisted tool 404s because
no handler exists for it.
"""
import os

from fastapi import APIRouter

router = APIRouter(prefix="/api")


def replay_enabled() -> bool:
    return os.environ.get("SEESTAR_REPLAY") == "1"


@router.get("/health")
async def health() -> dict:
    return {"ok": True, "replay": replay_enabled()}
