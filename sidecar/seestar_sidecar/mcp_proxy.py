"""A long-lived MCP stdio session, exposed as a simple async call().

This module is deliberately thin: it moves JSON, and does not interpret it. If
you find yourself reshaping a payload here, it belongs in the server instead —
see docs/handback-to-seestar-ai.md.
"""
import asyncio
import json
from contextlib import AsyncExitStack
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class ProxyTransportError(RuntimeError):
    """The MCP subprocess could not be reached, started, or answered."""


class McpConnection:
    """Owns one stdio session to an MCP server and serialises calls onto it."""

    def __init__(self, command: str, args: list[str]) -> None:
        self._command = command
        self._args = list(args)
        self._stack: AsyncExitStack | None = None
        self._session: ClientSession | None = None
        self._lock = asyncio.Lock()

    @property
    def is_started(self) -> bool:
        return self._session is not None

    async def start(self) -> None:
        """Spawn the server and initialise the session. Idempotent."""
        if self._session is not None:
            return
        stack = AsyncExitStack()
        try:
            params = StdioServerParameters(command=self._command, args=self._args)
            read, write = await stack.enter_async_context(stdio_client(params))
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
        except Exception as exc:
            await stack.aclose()
            raise ProxyTransportError(f"could not start MCP server: {exc}") from exc
        self._stack = stack
        self._session = session

    async def call(self, tool: str, arguments: dict[str, Any]) -> dict:
        """Call a tool and return its payload. Restarts the session on failure."""
        async with self._lock:
            if self._session is None:
                await self.start()
            assert self._session is not None
            try:
                result = await self._session.call_tool(tool, arguments or {})
            except Exception as exc:
                await self._reset()
                raise ProxyTransportError(f"call to {tool!r} failed: {exc}") from exc
        return _extract_payload(result)

    async def aclose(self) -> None:
        await self._reset()

    async def _reset(self) -> None:
        if self._stack is not None:
            try:
                await self._stack.aclose()
            except Exception:  # noqa: BLE001 - teardown must not mask the cause
                pass
        self._stack = None
        self._session = None


def _extract_payload(result: Any) -> dict:
    """Pull the tool's dict out of an MCP CallToolResult."""
    for block in getattr(result, "content", []) or []:
        text = getattr(block, "text", None)
        if text is not None:
            return json.loads(text)
    structured = getattr(result, "structuredContent", None)
    if isinstance(structured, dict):
        return structured
    raise ProxyTransportError("tool returned no readable content")
