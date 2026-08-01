"""One-shot: call the real seestar-mcp server and write golden fixtures.

Run this deliberately, not in CI. It performs one HTTPS GET to the weather
provider (via assess_conditions) and reads the local projects store. It calls
only read-only tools — nothing here touches the telescope.

    uv run python record.py
"""
import asyncio
import json
import os
import sys
from pathlib import Path

from seestar_sidecar import env as _env  # noqa: F401 — loads .env before the os.environ.get() below; see env.py
from seestar_sidecar.allowlist import ALLOWED_TOOLS
from seestar_sidecar.mcp_proxy import McpConnection

#: No personal-path default — see seestar_sidecar/main.py's SEESTAR_AI_DIR,
#: which this duplicates rather than imports (this script runs standalone,
#: outside the FastAPI app). Checked in main(), not at import time, so
#: `import record` (test_record.py's own pre-flight assertion test) stays
#: safe in CI regardless of whether this machine has it set.
SEESTAR_AI_DIR = os.environ.get("SEESTAR_AI_DIR")
FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"

ARGUMENTS: dict[str, dict] = {
    "assess_conditions": {},
    "plan_targets": {"limit": 12},
    "get_site_profile": {},
    "list_projects": {},
    "recommend_projects": {"limit": 12},
    # --- slice 3 (Live session screen) ------------------------------------
    "get_view_state": {},
    "get_status": {},
    "get_focuser_position": {},
    "qa_tier1": {},
    # M27 — an already-imaged real project (see fixtures/list_projects.json),
    # so recording against it exercises the real catalogue lookup rather
    # than an id chosen just for this script.
    "get_target_observability": {"target": "M27"},
    # session_start_utc is required (no tool-side default) — an arbitrary
    # recent-looking instant is fine for a recording run, since the point is
    # capturing the tool's real response *shape*, not a live guardrail
    # verdict for an actual session.
    "check_night_guardrails": {"session_start_utc": "2026-07-30T02:00:00+00:00"},
    # Reads data/run_state.json and makes no device call, so recording it is
    # free and works with the scope off. Expect `{"state": "idle", "run":
    # null}` on any machine that has not run a session — that IS the shape,
    # not a failed recording: the file only exists while a run is live.
    "get_run_state": {},
    # --- slice 4 (Review & QA screen) --------------------------------------
    # Explicit `paths: []`, not `target`: qa_tier2 is minutes-long over a
    # real target's subs (see qa_analysis.py's module docstring), and this
    # script is meant to be safe to re-run to refresh every fixture's SHAPE.
    # An empty path list still exercises the real "ok"/"summary"/"keep_list"
    # response shape (see fixtures/qa_tier2.json) with zero FITS analysis
    # cost — the sidecar's own qa_analysis_start route is what a real
    # analysis goes through, deliberately never this script.
    "qa_tier2": {"paths": []},
}


def _assert_arguments_complete(arguments: dict, allowed: frozenset) -> None:
    """`main()` used to index ARGUMENTS[tool] while iterating ALLOWED_TOOLS —
    a newly allowlisted tool with no arguments entry raised KeyError mid-loop,
    after already overwriting some fixtures on disk. Checking both directions
    (not just "nothing missing") turns that into a pre-flight failure instead:
    a stale entry left behind after a tool is removed from the allowlist
    should fail loudly too, not silently keep recording a fixture nobody
    routes to anymore.
    """
    missing = allowed - set(arguments)
    stale = set(arguments) - allowed
    assert not missing and not stale, (
        f"record.py's ARGUMENTS is out of sync with ALLOWED_TOOLS: "
        f"missing={sorted(missing)} stale={sorted(stale)}"
    )


_assert_arguments_complete(ARGUMENTS, ALLOWED_TOOLS)


async def main() -> None:
    if not SEESTAR_AI_DIR:
        print(
            "SEESTAR_AI_DIR is not set — this script needs it to find the "
            "seestar-mcp checkout to record fixtures from. See "
            "docs/configuration.md.",
            file=sys.stderr,
        )
        raise SystemExit(1)
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
