"""One-shot: call the real seestar-mcp server and write golden fixtures.

Run this deliberately, not in CI. It performs one HTTPS GET to the weather
provider (via assess_conditions) and reads the local projects store. It calls
only read-only tools — nothing here touches the telescope.

    uv run python record.py
"""
import asyncio
import json
from pathlib import Path

from seestar_sidecar.allowlist import ALLOWED_TOOLS
from seestar_sidecar.mcp_proxy import McpConnection

SEESTAR_AI_DIR = "C:/Users/<user>/SeeStar-AI"
FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"

ARGUMENTS: dict[str, dict] = {
    "assess_conditions": {},
    "plan_targets": {"limit": 12},
    "get_site_profile": {},
}


async def main() -> None:
    connection = McpConnection(
        command="uv",
        args=["--directory", SEESTAR_AI_DIR, "run", "python", "-m", "seestar_mcp.server"],
    )
    await connection.start()
    try:
        FIXTURES.mkdir(parents=True, exist_ok=True)
        for tool in sorted(ALLOWED_TOOLS):
            payload = await connection.call(tool, ARGUMENTS[tool])
            path = FIXTURES / f"{tool}.json"
            path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
            print(f"wrote {path.relative_to(FIXTURES.parent)}")
    finally:
        await connection.aclose()


if __name__ == "__main__":
    asyncio.run(main())
