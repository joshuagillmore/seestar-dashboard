"""Unit-level tests for session_activity.py's tail-reading and classification
logic — synthetic files under `tmp_path`, no HTTP, no real provenance.jsonl.

The property that matters most here is the one the module docstring argues
for at length: "ambiguous" is NOT a bare ALLOWED_TOOLS membership check.
Several tests below exist specifically to prove the low-level native tags
(alpaca.put.action, alpaca.get.*, qa_tier1.poll) classify as ambiguous even
though none of them is a literal ALLOWED_TOOLS/SIDECAR_ROUTES name — the
concrete bug this module's design avoids.
"""
import pytest

from seestar_sidecar import session_activity as sa

ALLOWED = frozenset({"list_projects", "get_site_profile"})
SIDECAR = frozenset({"projects_combined"})


def _write(path, lines, trailing_newline=True):
    text = "\n".join(lines)
    if trailing_newline:
        text += "\n"
    path.write_text(text, encoding="utf-8")


def _record(tool, **args):
    import json

    return json.dumps({"ts": "2026-07-30T00:00:00+00:00", "tool": tool, "args": args})


# --- classify_origin ---------------------------------------------------------


def test_a_literal_allowed_tool_is_ambiguous():
    assert sa.classify_origin("list_projects", ALLOWED, SIDECAR) == sa.ORIGIN_AMBIGUOUS


def test_a_literal_sidecar_route_is_ambiguous():
    assert sa.classify_origin("projects_combined", ALLOWED, SIDECAR) == sa.ORIGIN_AMBIGUOUS


@pytest.mark.parametrize(
    "tag",
    [
        "alpaca.put.action",
        "alpaca.get.connected",
        "alpaca.get.rightascension",
        "alpaca.get.declination",
        "alpaca.get.tracking",
        "alpaca.get.slewing",
        "qa_tier1.poll",
    ],
)
def test_known_native_side_effect_tags_are_ambiguous_not_agent(tag):
    """The core property this module exists for: a tag produced as a side
    effect of a tool we DO call (get_status, get_view_state, qa_tier1, ...)
    must never read as "necessarily the agent" just because it isn't a
    literal ALLOWED_TOOLS name — see the module docstring's traced call
    graph for exactly which tool produces each of these.
    """
    assert sa.classify_origin(tag, ALLOWED, SIDECAR) == sa.ORIGIN_AMBIGUOUS


@pytest.mark.parametrize("tag", ["goto_target", "set_filter", "park", "download_subs"])
def test_a_forbidden_or_unrelated_tool_is_agent(tag):
    """A tool this dashboard has no route for at all — including one this
    project has explicitly forbidden — cannot have been us.
    """
    assert sa.classify_origin(tag, ALLOWED, SIDECAR) == sa.ORIGIN_AGENT


def test_adding_a_tool_to_allowed_tools_moves_it_from_agent_to_ambiguous():
    """Proves the classification is actually derived from the passed-in
    allowlist, not a hardcoded copy — the exact staleness failure mode the
    module docstring warns against.
    """
    assert sa.classify_origin("qa_tier2", ALLOWED, SIDECAR) == sa.ORIGIN_AGENT
    widened = ALLOWED | {"qa_tier2"}
    assert sa.classify_origin("qa_tier2", widened, SIDECAR) == sa.ORIGIN_AMBIGUOUS


# --- _parse_record ------------------------------------------------------------


def test_parse_record_classifies_a_well_formed_line():
    record = sa._parse_record(_record("list_projects"), ALLOWED, SIDECAR)
    assert record.tool == "list_projects"
    assert record.origin == sa.ORIGIN_AMBIGUOUS
    assert record.ts == "2026-07-30T00:00:00+00:00"


def test_parse_record_handles_invalid_json_as_unknown():
    record = sa._parse_record("not json at all {{{", ALLOWED, SIDECAR)
    assert record.origin == sa.ORIGIN_UNKNOWN
    assert record.tool is None


def test_parse_record_handles_a_json_scalar_as_unknown():
    record = sa._parse_record("42", ALLOWED, SIDECAR)
    assert record.origin == sa.ORIGIN_UNKNOWN


def test_parse_record_handles_a_missing_tool_field_as_unknown_but_keeps_ts():
    import json

    line = json.dumps({"ts": "2026-07-30T00:00:00+00:00", "args": {}})
    record = sa._parse_record(line, ALLOWED, SIDECAR)
    assert record.origin == sa.ORIGIN_UNKNOWN
    assert record.ts == "2026-07-30T00:00:00+00:00"


def test_parse_record_handles_a_non_string_tool_as_unknown():
    import json

    line = json.dumps({"ts": None, "tool": 123, "args": {}})
    record = sa._parse_record(line, ALLOWED, SIDECAR)
    assert record.origin == sa.ORIGIN_UNKNOWN


# --- _tail_lines ---------------------------------------------------------------


def test_tail_lines_returns_everything_when_the_file_has_fewer_lines_than_count(tmp_path):
    path = tmp_path / "p.jsonl"
    _write(path, ["a", "b", "c"])

    lines, truncated = sa._tail_lines(path, count=10)

    assert lines == ["a", "b", "c"]
    assert truncated is False


def test_tail_lines_drops_a_partial_final_line_not_ending_in_newline(tmp_path):
    """The server mid-write — normal here, not corruption (see the module
    docstring's "read-only in the strict sense").
    """
    path = tmp_path / "p.jsonl"
    _write(path, ["a", "b", "c-partial-write-in-progress"], trailing_newline=False)

    lines, _truncated = sa._tail_lines(path, count=10)

    assert lines == ["a", "b"]


def test_tail_lines_on_an_empty_file(tmp_path):
    path = tmp_path / "p.jsonl"
    path.write_text("", encoding="utf-8")

    lines, truncated = sa._tail_lines(path, count=10)

    assert lines == []
    assert truncated is False


def test_tail_lines_returns_only_the_newest_count_lines_and_reports_truncated(tmp_path):
    path = tmp_path / "p.jsonl"
    all_lines = [f"line-{i}" for i in range(20)]
    _write(path, all_lines)

    lines, truncated = sa._tail_lines(path, count=5)

    assert lines == all_lines[-5:]
    assert truncated is True


def test_tail_lines_forced_multi_chunk_read_does_not_corrupt_surviving_lines(tmp_path):
    """Forces the backward-read loop to span several small chunks (a tiny
    chunk_bytes override, rather than needing a genuinely large file) so the
    "started mid-file, drop the leading fragment" path is actually exercised
    — proves the boundary logic, not just the common single-chunk case.
    """
    path = tmp_path / "p.jsonl"
    all_lines = [f"record-number-{i:03d}" for i in range(50)]
    _write(path, all_lines)

    lines, truncated = sa._tail_lines(path, count=10, chunk_bytes=16)

    assert lines == all_lines[-10:]
    assert truncated is True
    # No fragment leaked into a surviving line (e.g. a truncated "ecord-...").
    assert all(line.startswith("record-number-") for line in lines)


def test_tail_lines_boundary_case_reports_truncated_even_at_the_exact_count_edge(tmp_path):
    """The specific off-by-one this module's docstring calls out: a mid-file
    read that captures exactly count+1 newlines can, after the fragment and
    trailing-line drops, leave exactly `count` surviving lines — which a
    length-only check would misread as "nothing missing". `truncated` must
    still be True whenever the read started mid-file.
    """
    path = tmp_path / "p.jsonl"
    all_lines = [f"x{i}" for i in range(30)]
    _write(path, all_lines)

    lines, truncated = sa._tail_lines(path, count=9, chunk_bytes=8)

    assert truncated is True
    assert lines == all_lines[-9:]


# --- read_recent_activity (composition) ---------------------------------------


def test_read_recent_activity_is_newest_first(tmp_path):
    path = tmp_path / "p.jsonl"
    _write(path, [_record("list_projects"), _record("get_site_profile"), _record("goto_target")])

    records, truncated = sa.read_recent_activity(path, limit=10, allowed_tools=ALLOWED, sidecar_routes=SIDECAR)

    assert [r.tool for r in records] == ["goto_target", "get_site_profile", "list_projects"]
    assert [r.origin for r in records] == [sa.ORIGIN_AGENT, sa.ORIGIN_AMBIGUOUS, sa.ORIGIN_AMBIGUOUS]
    assert truncated is False


def test_read_recent_activity_skips_blank_lines(tmp_path):
    path = tmp_path / "p.jsonl"
    _write(path, [_record("list_projects"), "", _record("goto_target")])

    records, _truncated = sa.read_recent_activity(path, limit=10, allowed_tools=ALLOWED, sidecar_routes=SIDECAR)

    assert len(records) == 2


def test_read_recent_activity_includes_a_malformed_line_as_unknown_rather_than_dropping_it(tmp_path):
    path = tmp_path / "p.jsonl"
    _write(path, [_record("list_projects"), "{not valid json", _record("goto_target")])

    records, _truncated = sa.read_recent_activity(path, limit=10, allowed_tools=ALLOWED, sidecar_routes=SIDECAR)

    assert len(records) == 3
    origins = {r.origin for r in records}
    assert sa.ORIGIN_UNKNOWN in origins

# Note: DEFAULT_PROVENANCE_PATH's own env-var resolution (SEESTAR_PROVENANCE_
# PATH vs. SEESTAR_AI_DIR-derived vs. unset) is deliberately NOT unit-tested
# here via importlib.reload — this codebase has no precedent for testing
# archive.DEFAULT_ARCHIVE_DIR or imagery.DEFAULT_IMAGE_CACHE_DIR that way
# either, and reloading this module mutates a SHARED object other tests in
# the same process still hold a reference to, which is a real staleness risk
# for no corresponding benefit: what actually matters in production — that
# an explicit `provenance_path` passed to create_app() is used, and that
# "unset" degrades honestly — is already covered end to end in
# test_session_activity_route.py against the real create_app().
