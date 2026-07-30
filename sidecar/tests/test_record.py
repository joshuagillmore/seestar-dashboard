"""record.py's deferred bug: ARGUMENTS[tool] was indexed while iterating
ALLOWED_TOOLS, so a newly allowlisted tool with no ARGUMENTS entry raised
KeyError mid-loop, after some fixtures had already been overwritten.
_assert_arguments_complete() turns that into a pre-flight check.

Importing record.py is safe in CI: it only runs this assertion at import
time, not main() (which spawns the real MCP server) — see the module's own
docstring for why main() itself stays a deliberate, non-CI action.
"""
import pytest

import record


def test_current_arguments_match_the_allowlist_exactly():
    # Guards the real values: this is what would have raised the deferred
    # KeyError if list_projects/recommend_projects had been allowlisted
    # without also gaining an ARGUMENTS entry.
    record._assert_arguments_complete(record.ARGUMENTS, record.ALLOWED_TOOLS)


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
