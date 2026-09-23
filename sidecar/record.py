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
    # detail="full", exactly as routes._FULL_DETAIL sends it: both tools
    # default to "summary", which drops `sessions`, so `{}` would record a
    # shape the live routes never return and the web schemas reject.
    "list_projects": {"detail": "full"},
    "recommend_projects": {"limit": 12, "detail": "full"},
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


#: The site every committed fixture carries: Greenwich Royal Observatory under
#: a name that says it is a placeholder. This repository is public, and the
#: real profile located a house to about ten metres — see fixtures/README.md.
#: tests/test_record.py pins both this and the committed fixture to it.
SYNTHETIC_SITE = {
    "name": "Example Observatory",
    "lat_deg": 51.4778,
    "lon_deg": -0.0015,
    "elevation_m": 46.0,
}

#: Tools whose payloads are COMPUTED from the site: peak altitudes and
#: transits (latitude and longitude, from a catalogue position), dark
#: windows, dawn times. Scrubbing the site block cannot fix these — the
#: numbers themselves point home — so they must be regenerated at the
#: synthetic site, as fixtures/README.md describes, before committing.
SITE_DERIVED_TOOLS = (
    "assess_conditions",
    "check_night_guardrails",
    "get_target_observability",
    "plan_targets",
)

SITE_DERIVED_WARNING = f"""
!!! PRIVACY — DO NOT COMMIT THESE FIXTURES AS RECORDED !!!

The site block in get_site_profile.json and the site name everywhere have
been replaced with the synthetic Greenwich site. That is NOT enough:
{", ".join(SITE_DERIVED_TOOLS)} contain geometry COMPUTED at the real site
(peak altitudes, transits, dark windows, dawn times), and those numbers
locate it to a city. Regenerate them at the synthetic site with
seestar-mcp's own planner, as fixtures/README.md describes, and re-check
every fixture for the real site before committing. Do not commit the
recorded versions.
"""


def _replace_in_strings(value, old: str, new: str):
    if isinstance(value, str):
        return value.replace(old, new)
    if isinstance(value, dict):
        return {k: _replace_in_strings(v, old, new) for k, v in value.items()}
    if isinstance(value, list):
        return [_replace_in_strings(v, old, new) for v in value]
    return value


def scrub_site(payloads: dict[str, dict]) -> dict[str, dict]:
    """`payloads` (tool -> recorded payload) with the real site replaced.

    - get_site_profile's `profile` gets SYNTHETIC_SITE's name, coordinates and
      elevation. Bortle, horizon mask and altitude limits are kept: the
      README records that they stay real, and alone they locate nothing.
    - The real site's NAME is replaced wherever it appears in any payload —
      `location.site_name`, and warning text that quotes it.

    Site-derived geometry is deliberately not touched here; see
    SITE_DERIVED_WARNING for why it cannot be scrubbed, only regenerated.
    """
    scrubbed = dict(payloads)
    profile_payload = payloads.get("get_site_profile") or {}
    real_profile = profile_payload.get("profile")
    real_name = real_profile.get("name") if isinstance(real_profile, dict) else None

    if isinstance(real_profile, dict):
        scrubbed["get_site_profile"] = {
            **profile_payload,
            "profile": {**real_profile, **SYNTHETIC_SITE},
        }
    if isinstance(real_name, str) and real_name.strip() and real_name != SYNTHETIC_SITE["name"]:
        scrubbed = {
            tool: _replace_in_strings(payload, real_name, SYNTHETIC_SITE["name"])
            for tool, payload in scrubbed.items()
        }
    for tool, payload in scrubbed.items():
        location = payload.get("location") if isinstance(payload, dict) else None
        if isinstance(location, dict) and "site_name" in location:
            scrubbed[tool] = {**payload, "location": {**location, "site_name": SYNTHETIC_SITE["name"]}}
    return scrubbed


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
        # Everything is recorded before anything is written: the real site's
        # name, from get_site_profile, has to be known to scrub the others.
        recorded = {
            tool: await connection.call(tool, ARGUMENTS[tool]) for tool in sorted(ALLOWED_TOOLS)
        }
    finally:
        await connection.aclose()

    FIXTURES.mkdir(parents=True, exist_ok=True)
    for tool, payload in scrub_site(recorded).items():
        path = FIXTURES / f"{tool}.json"
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(FIXTURES.parent)}")
    print(SITE_DERIVED_WARNING, file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
