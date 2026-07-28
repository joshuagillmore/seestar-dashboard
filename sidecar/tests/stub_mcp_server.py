"""A minimal FastMCP server over stdio, used to test the proxy deterministically.

Speaks the same protocol as seestar-mcp but needs no telescope, no astropy and
no SeeStar-AI checkout, so proxy tests stay fast and hermetic.
"""
import os

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("stub-seestar")

CANNED_PROFILE = {
    "ok": True,
    "profile": {"name": "Stub Site", "lat_deg": 51.4778, "bortle": 8},
}


@mcp.tool()
async def get_site_profile() -> dict:
    """Return a fixed profile."""
    return CANNED_PROFILE


@mcp.tool()
async def whoami() -> dict:
    """Return this server process's pid.

    Exists so a test can tell session reuse from a per-call respawn: a canned
    payload is identical either way, but the pid is not.
    """
    return {"pid": os.getpid()}


@mcp.tool()
async def failing_tool() -> dict:
    """Always raises, to exercise tool-level failure."""
    raise RuntimeError("stub failure")


if __name__ == "__main__":
    mcp.run()
