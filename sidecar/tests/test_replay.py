"""Replay serves recorded fixtures unmodified.

The assertion compares parsed JSON, not raw bytes: JSONResponse emits compact
JSON while the fixtures on disk are pretty-printed, so byte parity was never
achievable and claiming it would be false. What it does prove is that no key is
renamed, dropped, added or retyped on the way out — the pass-through property
that actually matters.
"""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar.allowlist import ALLOWED_TOOLS, NO_DIRECT_ROUTE_TOOLS
from seestar_sidecar.main import create_app

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    # plan_targets is enriched with an `image` field computed from the real
    # archive scan and DSO catalogue (see routes.py's _attach_images).
    # Pointing both at a tmp_path that holds neither keeps this file's result
    # independent of whatever the dev machine's real OneDrive archive/
    # catalogue happen to contain right now — the same discipline
    # test_archive.py/test_catalog.py already hold their own suites to.
    return TestClient(
        create_app(
            archive_dir=tmp_path / "no-archive",
            catalog_path=tmp_path / "no-catalog.json",
            aliases_path=tmp_path / "no-aliases.json",
        )
    )


#: plan_targets is the one allowlisted tool this sidecar enriches (an
#: `image` field per target — see routes._attach_images), so it is no longer
#: a byte-for-byte passthrough and gets its own test below instead of this
#: parametrization.
#:
#: check_night_guardrails and get_target_observability (slice 3) each have a
#: REQUIRED query param with no route-side default (session_start_utc / target
#: — see routes.py) — a bare `GET /api/{tool}` 422s before ever reaching
#: replay, so the generic no-args parametrization below can't exercise them
#: either. Each gets its own test below instead, supplying the required
#: param(s) — replay mode ignores the actual arguments regardless (see
#: routes._fetch), so the exact values only matter for making the request
#: valid, not for which fixture comes back.
#:
#: NO_DIRECT_ROUTE_TOOLS (qa_tier2, slice 4) has no `/api/{tool}` route at
#: all — see allowlist.py's own comment — so `GET /api/qa_tier2` 404s before
#: ever reaching replay, the same "can't exercise it here" reason as the
#: three named above, for a different cause.
_PASSTHROUGH_TOOLS = sorted(
    ALLOWED_TOOLS
    - {"plan_targets", "check_night_guardrails", "get_target_observability"}
    - NO_DIRECT_ROUTE_TOOLS
)


@pytest.mark.parametrize("tool", _PASSTHROUGH_TOOLS)
def test_replay_returns_the_fixture_unmodified(client, tool):
    response = client.get(f"/api/{tool}")
    assert response.status_code == 200
    assert response.json() == json.loads((FIXTURES / f"{tool}.json").read_text(encoding="utf-8"))


def test_plan_targets_replay_adds_only_the_image_field(client):
    """The same "nothing renamed/dropped/retyped" property the parametrized
    test above proves for every other tool, proven here for plan_targets
    once its one deliberate addition is accounted for: strip `image` back out
    of every target and the rest must match the fixture exactly.

    The `client` fixture points `archive_dir`/`catalog_path` at nothing, so
    `image` is deterministically `None` for every target — this also proves
    the field is actually being computed (present, not merely absent because
    the route silently failed), not just that the key exists.
    """
    response = client.get("/api/plan_targets")
    assert response.status_code == 200
    body = response.json()

    assert body["targets"], "fixture must have at least one target for this to test anything"
    assert all("image" in target for target in body["targets"])
    assert all(target["image"] is None for target in body["targets"])

    stripped = json.loads(json.dumps(body))
    for target in stripped["targets"]:
        del target["image"]
    assert stripped == json.loads((FIXTURES / "plan_targets.json").read_text(encoding="utf-8"))


def test_recorded_night_is_a_no_go(client):
    """Guards against someone quietly replacing the fixture with a rosier one."""
    assert client.get("/api/assess_conditions").json()["go"] is False


def test_check_night_guardrails_replay_returns_the_fixture_unmodified(client):
    response = client.get("/api/check_night_guardrails?session_start_utc=2026-07-30T02:00:00Z")
    assert response.status_code == 200
    assert response.json() == json.loads(
        (FIXTURES / "check_night_guardrails.json").read_text(encoding="utf-8")
    )


def test_get_target_observability_replay_returns_the_fixture_unmodified(client):
    response = client.get("/api/get_target_observability?target=M27")
    assert response.status_code == 200
    assert response.json() == json.loads(
        (FIXTURES / "get_target_observability.json").read_text(encoding="utf-8")
    )


def test_transport_failure_uses_the_same_error_shape(monkeypatch):
    from seestar_sidecar import routes
    from seestar_sidecar.mcp_proxy import ProxyTransportError

    async def boom(request, tool, arguments):
        raise ProxyTransportError("subprocess died")

    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)
    monkeypatch.setattr(routes, "call_tool", boom)
    response = TestClient(create_app()).get("/api/get_site_profile")
    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert "subprocess died" in body["error"]


def test_missing_fixture_uses_the_standard_error_shape(monkeypatch):
    """A fixture that has not been recorded yet must stay diagnosable.

    load_fixture raises FileNotFoundError with a pointer to record.py. If that
    escapes _serve it becomes a generic 500 and the pointer is lost — on the one
    path built specifically for offline work. This bites the first time a tool is
    allowlisted before its fixture is recorded, which is what slice 2 does.
    """
    from seestar_sidecar import routes

    def missing(tool: str) -> dict:
        raise FileNotFoundError(f"no fixture for {tool!r} — run record.py")

    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    monkeypatch.setattr(routes, "load_fixture", missing)
    response = TestClient(create_app()).get("/api/get_site_profile")
    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert "record.py" in body["error"]


# --- lifespan ------------------------------------------------------------
#
# TestClient only emits ASGI startup/shutdown events inside a `with` block.
# Every test above constructs it bare, so none of them exercise the lifespan —
# these do. Without them the connection wiring ships with no coverage at all.


def test_lifespan_creates_a_connection_in_live_mode(monkeypatch):
    """SEESTAR_AI_DIR is read once at import time (see main.py) — has no
    personal-path default any more, so this sets it explicitly rather than
    relying on whatever happens to be in this machine's real environment
    (see docs/configuration.md). monkeypatch.setattr on the module attribute,
    not monkeypatch.setenv, because main.SEESTAR_AI_DIR was already bound
    before this test runs; the env var itself is only read once, at import.
    """
    from seestar_sidecar import main

    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)
    monkeypatch.setattr(main, "SEESTAR_AI_DIR", "/some/seestar-mcp/checkout")
    app = create_app()
    with TestClient(app):
        assert app.state.connection is not None
    assert app.state.connection is None  # closed and cleared on shutdown


def test_lifespan_creates_no_connection_in_replay(monkeypatch):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    app = create_app()
    with TestClient(app):
        assert app.state.connection is None


def test_lifespan_leaves_connection_none_when_seestar_ai_dir_is_unset(monkeypatch):
    """The portability fix: SEESTAR_AI_DIR unset must degrade to a clear,
    non-crashing 502 on the first tool-backed request, not a TypeError out
    of subprocess.Popen from a literal `None` argv entry — see main.py's
    lifespan and routes.py's call_tool.
    """
    from seestar_sidecar import main

    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)
    monkeypatch.setattr(main, "SEESTAR_AI_DIR", None)
    app = create_app()
    with TestClient(app) as client:
        assert app.state.connection is None
        assert app.state.connection_unavailable_reason is not None
        response = client.get("/api/get_site_profile")
        assert response.status_code == 502
        assert "SEESTAR_AI_DIR" in response.json()["error"]


def test_each_app_owns_its_connection(monkeypatch):
    """Two apps in one process must not share connection state."""
    from seestar_sidecar import main

    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)
    monkeypatch.setattr(main, "SEESTAR_AI_DIR", "/some/seestar-mcp/checkout")
    first, second = create_app(), create_app()
    with TestClient(first), TestClient(second):
        assert first.state.connection is not second.state.connection
