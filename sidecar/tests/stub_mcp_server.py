"""A minimal FastMCP server over stdio, used to test the proxy deterministically.

Speaks the same protocol as seestar-mcp but needs no telescope, no astropy and
no SeeStar-AI checkout, so proxy tests stay fast and hermetic.
"""
import asyncio
import os
import threading
import time

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


@mcp.tool()
async def slow_tool(seconds: float) -> dict:
    """Take `seconds` to answer WITHOUT blocking this server's event loop.

    The shape of a legitimately slow read: the server stays responsive (it
    still answers a ping) while this one call is outstanding, so a client
    timeout on it must not tear the session down.
    """
    await asyncio.sleep(seconds)
    return {"slept": seconds}


@mcp.tool()
async def blocking_tool(seconds: float) -> dict:
    """Take `seconds` to answer while BLOCKING this server's event loop.

    The shape of a hung server — and of upstream qa_tier2, whose
    analyze_session() runs synchronously inside an async tool. Nothing else,
    a ping included, is answered until it returns.
    """
    time.sleep(seconds)  # noqa: ASYNC251 - blocking the loop is this tool's whole point
    return {"blocked": seconds}


@mcp.tool()
async def exit_soon() -> dict:
    """Answer normally, then die a moment later while the session is idle.

    Contrast crash_the_server, which dies mid-call: this is the server
    disappearing between calls, which is what a night-long dashboard sees
    when the process is killed or crashes while nothing is in flight.
    """
    threading.Timer(0.2, os._exit, args=(1,)).start()
    return {"ok": True}


if __name__ == "__main__":
    mcp.run()
