"""env.py loads .env from the repo root before any module reads a
machine-specific env var — see docs/configuration.md and .env.example.

None of these tests touch this machine's real, gitignored .env: every test
here builds its own synthetic file under tmp_path and calls
env.load_dotenv_once() with that path explicitly, the same discipline
archive_dir/catalog_path already hold themselves to elsewhere in this suite
(see test_archive.py's/test_projects_combined_route.py's synthetic
archives). A test that instead exercised the real repo-root .env would pass
or fail depending on whether this machine happens to have one — exactly the
class of hidden coupling this whole hardening pass exists to remove.

Test variable names are prefixed SIDECAR_ENV_TEST_ rather than reusing real
names like SEESTAR_ARCHIVE_DIR, so a cleanup miss here can never leak into
(or be masked by) a real variable a test elsewhere in this suite depends on.
"""
import os

import pytest

from seestar_sidecar import env


@pytest.fixture(autouse=True)
def _clean_test_vars(monkeypatch):
    """Belt-and-suspenders: load_dotenv() writes straight to os.environ, not
    through monkeypatch's own setenv/delenv, so monkeypatch's automatic
    teardown does not know to undo it. Every test var used below is deleted
    both before (in case a previous run's cleanup somehow failed) and after.
    """
    names = [
        "SIDECAR_ENV_TEST_A",
        "SIDECAR_ENV_TEST_B",
        "SIDECAR_ENV_TEST_C",
        "SIDECAR_ENV_TEST_PATH",
        "SIDECAR_ENV_TEST_URL",
        "SIDECAR_ENV_TEST_QUOTED",
    ]
    for name in names:
        monkeypatch.delenv(name, raising=False)
    yield
    for name in names:
        monkeypatch.delenv(name, raising=False)


def test_a_dotenv_value_is_picked_up_when_the_variable_is_unset(tmp_path):
    dotenv_path = tmp_path / ".env"
    dotenv_path.write_text("SIDECAR_ENV_TEST_A=hello-from-dotenv\n", encoding="utf-8")

    env.load_dotenv_once(dotenv_path)

    assert os.environ["SIDECAR_ENV_TEST_A"] == "hello-from-dotenv"


def test_a_real_environment_variable_wins_over_dotenv(monkeypatch, tmp_path):
    """The whole point of override=False: .env is a convenience for a
    checkout, never a way to override something deliberately set — see
    env.py's module docstring.
    """
    monkeypatch.setenv("SIDECAR_ENV_TEST_B", "the-real-value")
    dotenv_path = tmp_path / ".env"
    dotenv_path.write_text("SIDECAR_ENV_TEST_B=the-dotenv-value\n", encoding="utf-8")

    env.load_dotenv_once(dotenv_path)

    assert os.environ["SIDECAR_ENV_TEST_B"] == "the-real-value"


def test_a_missing_dotenv_file_is_a_silent_no_op(tmp_path):
    """The same "not configured is a normal state, not an error" discipline
    every other optional setting in this app already holds itself to (see
    archive.scan_archive) — a checkout with no .env at all (the default:
    .env is gitignored) must not raise and must not fabricate a value.
    """
    never_written = tmp_path / "does-not-exist.env"

    env.load_dotenv_once(never_written)  # must not raise

    assert "SIDECAR_ENV_TEST_C" not in os.environ


def test_a_windows_path_with_backslashes_survives_unquoted_and_literal(tmp_path):
    """The exact risk flagged for this feature: a real Windows path
    (C:\\Users\\<name>\\...) must come through byte-for-byte, not have any
    of its backslash sequences interpreted. Deliberately includes "\\n" and
    "\\U" immediately after a backslash — "\\n" is a real escape sequence
    python-dotenv recognises inside a DOUBLE-QUOTED value (see the quoted
    test below, which proves this value WOULD be corrupted quoted) and
    "\\U" is not a recognised escape at all; an unquoted value must treat
    both identically: literally.
    """
    windows_path = r"C:\Users\nick\OneDrive\Documents\SeeStar"
    dotenv_path = tmp_path / ".env"
    dotenv_path.write_text(f"SIDECAR_ENV_TEST_PATH={windows_path}\n", encoding="utf-8")

    env.load_dotenv_once(dotenv_path)

    assert os.environ["SIDECAR_ENV_TEST_PATH"] == windows_path


def test_a_quoted_windows_path_is_the_known_risk_this_repo_avoids_by_convention(tmp_path):
    """Not a defect in this code — a documented, upstream property of
    python-dotenv's double-quote syntax (shared with Node's/Ruby's dotenv):
    a double-quoted value undergoes escape processing, so "\\n" inside one
    becomes an actual newline. This is exactly why .env.example tells users
    never to quote a path. Characterised here, against the actual pinned
    dependency, so the guidance in .env.example/configuration.md is a
    verified fact rather than an assumption — and so a future dependency
    bump that changed this behaviour would be caught.
    """
    dotenv_path = tmp_path / ".env"
    dotenv_path.write_text(r'SIDECAR_ENV_TEST_QUOTED="C:\Users\nick\Documents"' + "\n", encoding="utf-8")

    env.load_dotenv_once(dotenv_path)

    # Not the literal path: "\n" (backslash-n, before "ick") was consumed as
    # a newline character, splitting the string — the corruption this
    # project's .env.example instructs users to avoid by never quoting.
    assert os.environ["SIDECAR_ENV_TEST_QUOTED"] != r"C:\Users\nick\Documents"
    assert "\n" in os.environ["SIDECAR_ENV_TEST_QUOTED"]


def test_a_value_containing_an_equals_sign_is_split_on_the_first_one_only(tmp_path):
    url = "http://example.com/?a=1&b=2"
    dotenv_path = tmp_path / ".env"
    dotenv_path.write_text(f"SIDECAR_ENV_TEST_URL={url}\n", encoding="utf-8")

    env.load_dotenv_once(dotenv_path)

    assert os.environ["SIDECAR_ENV_TEST_URL"] == url


def test_default_dotenv_path_points_at_the_repo_root():
    """Proves the parents[] hop count independently of env.py's own
    expression, the same discipline test_static.py's
    test_default_web_dist_points_at_the_sibling_web_dist_directory already
    holds itself to for DEFAULT_WEB_DIST — a wrong hop count would silently
    point at a .env that can never exist, and a test that re-derived the
    same expression from the same starting point would not catch that.
    """
    from pathlib import Path

    repo_root = Path(__file__).resolve().parents[2]
    assert env.DEFAULT_DOTENV_PATH == repo_root / ".env"
