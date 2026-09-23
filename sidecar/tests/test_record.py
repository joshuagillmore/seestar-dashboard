"""record.py's deferred bug: ARGUMENTS[tool] was indexed while iterating
ALLOWED_TOOLS, so a newly allowlisted tool with no ARGUMENTS entry raised
KeyError mid-loop, after some fixtures had already been overwritten.
_assert_arguments_complete() turns that into a pre-flight check.

Importing record.py is safe in CI: it only runs this assertion at import
time, not main() (which spawns the real MCP server) — see the module's own
docstring for why main() itself stays a deliberate, non-CI action.
"""
import json
from pathlib import Path

import pytest

import record

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"

#: Greenwich Royal Observatory under a placeholder name — spelled out here,
#: not imported from record.py, so a change to record.py's constant cannot
#: quietly move what this pins. See fixtures/README.md.
GREENWICH = {
    "name": "Example Observatory",
    "lat_deg": 51.4778,
    "lon_deg": -0.0015,
    "elevation_m": 46.0,
}


def test_current_arguments_match_the_allowlist_exactly():
    # Guards the real values: this is what would have raised the deferred
    # KeyError if list_projects/recommend_projects had been allowlisted
    # without also gaining an ARGUMENTS entry.
    record._assert_arguments_complete(record.ARGUMENTS, record.ALLOWED_TOOLS)


@pytest.mark.parametrize("tool", ["list_projects", "recommend_projects"])
def test_project_tools_are_recorded_with_full_detail(tool):
    """Both default to detail="summary" server-side, which drops each
    project's `sessions`. A fixture recorded with `{}` would then be the
    summary shape — which the web schemas reject, and which the replay path
    would serve as if it were what the live routes return (they pass
    detail="full"; see routes._FULL_DETAIL)."""
    assert record.ARGUMENTS[tool].get("detail") == "full"


def test_missing_entry_fails_fast():
    allowed = record.ALLOWED_TOOLS | {"some_new_tool"}
    with pytest.raises(AssertionError, match="some_new_tool"):
        record._assert_arguments_complete(record.ARGUMENTS, allowed)


def test_stale_entry_also_fails_fast():
    """Checking only for "missing" would pass this: the bug this guards
    against is a mismatch in either direction, not just the KeyError one.
    """
    arguments = dict(record.ARGUMENTS, retired_tool={})
    with pytest.raises(AssertionError, match="retired_tool"):
        record._assert_arguments_complete(arguments, record.ALLOWED_TOOLS)


# --- the real site must never reach a committed fixture --------------------
#
# This repository is public. The real site profile located a house to about
# ten metres; see fixtures/README.md for the history. The fake "real" site
# below is invented for the test.

_FAKE_REAL_PROFILE = {
    "name": "Somebodys Garden",
    "lat_deg": 12.3456,
    "lon_deg": 65.4321,
    "elevation_m": 321.0,
    "bortle": 8,
    "sqm": None,
    "horizon_mask": [[0.0, 90.0, 30.0]],
    "min_altitude_deg": 20.0,
    "field_rotation_ceiling_deg": 60.0,
    "location_tolerance_km": 1.0,
}


def test_the_committed_site_profile_fixture_is_the_synthetic_greenwich_site():
    profile = json.loads((FIXTURES / "get_site_profile.json").read_text(encoding="utf-8"))["profile"]

    assert {key: profile[key] for key in GREENWICH} == GREENWICH
    assert record.SYNTHETIC_SITE == GREENWICH


def test_scrubbing_replaces_the_site_block_and_keeps_the_rest():
    recorded = {
        "get_site_profile": {"ok": True, "profile": dict(_FAKE_REAL_PROFILE)},
        "assess_conditions": {
            "ok": True,
            "location": {
                "site_name": "Somebodys Garden",
                "warning": "GPS unverified — assuming saved site 'Somebodys Garden'.",
            },
        },
    }

    scrubbed = record.scrub_site(recorded)

    profile = scrubbed["get_site_profile"]["profile"]
    assert {key: profile[key] for key in GREENWICH} == GREENWICH
    # Fields the README says stay real are kept — they locate nothing alone.
    assert profile["bortle"] == 8
    assert profile["horizon_mask"] == [[0.0, 90.0, 30.0]]
    location = scrubbed["assess_conditions"]["location"]
    assert location["site_name"] == "Example Observatory"
    assert "Somebodys Garden" not in json.dumps(scrubbed)


async def test_main_writes_only_scrubbed_payloads_and_warns_about_derived_geometry(
    tmp_path, monkeypatch, capsys
):
    class FakeConnection:
        def __init__(self, command, args):
            pass

        async def start(self):
            pass

        async def call(self, tool, arguments):
            if tool == "get_site_profile":
                return {"ok": True, "profile": dict(_FAKE_REAL_PROFILE)}
            return {"ok": True, "tool": tool}

        async def aclose(self):
            pass

    out_dir = tmp_path / "fixtures"
    monkeypatch.setattr(record, "SEESTAR_AI_DIR", "/somewhere/seestar-mcp")
    monkeypatch.setattr(record, "McpConnection", FakeConnection)
    monkeypatch.setattr(record, "FIXTURES", out_dir)

    await record.main()

    written = json.loads((out_dir / "get_site_profile.json").read_text(encoding="utf-8"))
    assert {key: written["profile"][key] for key in GREENWICH} == GREENWICH
    assert "Somebodys Garden" not in "".join(
        p.read_text(encoding="utf-8") for p in out_dir.glob("*.json")
    )

    printed = capsys.readouterr()
    warning = (printed.out + printed.err).lower()
    for tool in ("plan_targets", "assess_conditions"):
        assert tool in warning
    assert "fixtures/readme.md" in warning
    assert "do not commit" in warning
