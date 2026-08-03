"""Unit-level tests for session_activity.py's tail-reading and classification
logic — synthetic files under `tmp_path`, no HTTP, no real provenance.jsonl.

The property that matters here is that origin comes from the record's own
`client` field and from nothing else. The previous version of this file proved
the opposite property at length — that a set of hardcoded native tool tags
classified as "ambiguous" rather than "agent" — and those tests passed right up
until the tags changed upstream, which is the whole reason the tag heuristic is
gone. Tests that pin a mirror of another repo's internals go green on stale
data; this file must not acquire another one.
"""
import json

import pytest

from seestar_sidecar import session_activity as sa

SELF = "console"


def _write(path, lines, trailing_newline=True):
    text = "\n".join(lines)
    if trailing_newline:
        text += "\n"
    path.write_text(text, encoding="utf-8")


def _record(tool, client=SELF, **args):
    payload = {"ts": "2026-07-30T00:00:00+00:00", "tool": tool, "args": args}
    if client is not None:
        payload["client"] = client
    return json.dumps(payload)


# --- classify_origin ---------------------------------------------------------


def test_our_own_client_id_is_console():
    assert sa.classify_origin("console", SELF) == sa.ORIGIN_CONSOLE


def test_any_other_client_is_the_agent():
    assert sa.classify_origin("anon-fd80208c", SELF) == sa.ORIGIN_AGENT


def test_a_second_console_with_its_own_id_is_not_us():
    """An operator running two consoles sets SEESTAR_CLIENT_ID on one. The
    other one's records are somebody else's, and saying so is the point of
    letting the id be overridden at all."""
    assert sa.classify_origin("console-shed", SELF) == sa.ORIGIN_AGENT


def test_an_operator_overridden_id_is_matched_not_the_default():
    """Proves the match is against the id passed in — what
    mcp_proxy.effective_client_id() resolved — and not a hardcoded "console".
    """
    assert sa.classify_origin("console-shed", "console-shed") == sa.ORIGIN_CONSOLE
    assert sa.classify_origin("console", "console-shed") == sa.ORIGIN_AGENT


def test_a_record_with_no_client_field_is_ambiguous_not_agent():
    """Pre-fix records. Calling them "agent" would be a guess in the
    direction that misattributes our own history to Claude."""
    assert sa.classify_origin(None, SELF) == sa.ORIGIN_AMBIGUOUS


@pytest.mark.parametrize("value", [123, [], {}, True, ""])
def test_a_malformed_or_empty_client_is_ambiguous(value):
    """A non-string or empty client is not evidence of anything, and
    seestar-mcp treats a falsy client_id as absent too (it generates
    anon-<hex>), so an empty string can never legitimately be ours."""
    assert sa.classify_origin(value, SELF) == sa.ORIGIN_AMBIGUOUS


def test_the_tool_name_does_not_affect_classification():
    """The regression this file exists for. `seestar.get_view_state` is a tag
    that did not exist when the old classifier was written; under it, that tag
    fell through to ORIGIN_AGENT and reported our own polling as Claude's.
    A forbidden tool with our client id is likewise not reclassified — origin
    answers "who", never "should they have".
    """
    assert sa.classify_origin(SELF, SELF) == sa.ORIGIN_CONSOLE
    for tool in ("seestar.get_view_state", "alpaca.put.action", "goto_target", "park"):
        line = _record(tool)
        assert sa._parse_record(line, SELF).origin == sa.ORIGIN_CONSOLE, tool


# --- _parse_record ------------------------------------------------------------


def test_parse_record_classifies_a_well_formed_line():
    record = sa._parse_record(_record("list_projects"), SELF)
    assert record.tool == "list_projects"
    assert record.origin == sa.ORIGIN_CONSOLE
    assert record.ts == "2026-07-30T00:00:00+00:00"


def test_parse_record_reads_the_client_off_the_record():
    record = sa._parse_record(_record("list_projects", client="anon-abc123"), SELF)
    assert record.tool == "list_projects"
    assert record.origin == sa.ORIGIN_AGENT


def test_parse_record_handles_invalid_json_as_unknown():
    record = sa._parse_record("not json at all {{{", SELF)
    assert record.origin == sa.ORIGIN_UNKNOWN
    assert record.tool is None


def test_parse_record_handles_a_json_scalar_as_unknown():
    assert sa._parse_record("42", SELF).origin == sa.ORIGIN_UNKNOWN


def test_parse_record_handles_a_missing_tool_field_as_unknown_but_keeps_ts():
    line = json.dumps({"ts": "2026-07-30T00:00:00+00:00", "client": SELF, "args": {}})
    record = sa._parse_record(line, SELF)
    assert record.origin == sa.ORIGIN_UNKNOWN
    assert record.ts == "2026-07-30T00:00:00+00:00"


def test_parse_record_handles_a_non_string_tool_as_unknown():
    line = json.dumps({"ts": None, "tool": 123, "client": SELF, "args": {}})
    assert sa._parse_record(line, SELF).origin == sa.ORIGIN_UNKNOWN


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
    _write(
        path,
        [
            _record("list_projects"),
            _record("goto_target", client="anon-9f2c"),
            _record("get_site_profile", client=None),
        ],
    )

    records, truncated = sa.read_recent_activity(path, limit=10, self_id=SELF)

    assert [r.tool for r in records] == ["get_site_profile", "goto_target", "list_projects"]
    assert [r.origin for r in records] == [
        sa.ORIGIN_AMBIGUOUS,
        sa.ORIGIN_AGENT,
        sa.ORIGIN_CONSOLE,
    ]
    assert truncated is False


def test_read_recent_activity_skips_blank_lines(tmp_path):
    path = tmp_path / "p.jsonl"
    _write(path, [_record("list_projects"), "", _record("goto_target")])

    records, _truncated = sa.read_recent_activity(path, limit=10, self_id=SELF)

    assert len(records) == 2


def test_read_recent_activity_includes_a_malformed_line_as_unknown_rather_than_dropping_it(tmp_path):
    path = tmp_path / "p.jsonl"
    _write(path, [_record("list_projects"), "{not valid json", _record("goto_target")])

    records, _truncated = sa.read_recent_activity(path, limit=10, self_id=SELF)

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
