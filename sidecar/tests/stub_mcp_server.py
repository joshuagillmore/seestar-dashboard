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
    """Raise inside a HEALTHY server, to exercise tool-level failure.

    Comes back to the client as CallToolResult(isError=True) — the session
    survives. Contrast crash_the_server below.
    """
    raise RuntimeError("stub failure")


@mcp.tool()
async def crash_the_server() -> dict:
    """Kill this process mid-call, breaking the pipe.

    This is the only way to exercise call()'s except branch and its _reset():
    a tool that merely raises is caught by the isError check and never touches
    the session, so it cannot stand in for a genuine transport failure.
    """
    os._exit(1)


if __name__ == "__main__":
    mcp.run()
