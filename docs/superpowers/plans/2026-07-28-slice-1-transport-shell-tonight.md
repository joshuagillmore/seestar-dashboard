# SeeStar Console Slice 1 — Transport, Shell & Tonight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Tonight screen rendering live `assess_conditions` and `plan_targets` data, served through a read-only HTTP sidecar that proxies the seestar-mcp server over stdio.

**Architecture:** A Python/FastAPI sidecar holds one long-lived MCP stdio session and exposes a small allowlist of read-only tools as `GET /api/<tool>`, passing tool JSON through unmodified. A React/TypeScript/Vite client parses those payloads with zod and renders the handoff design against CSS custom properties transcribed from the design token table. Golden fixtures recorded from the real server back a fully offline test gate.

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, `mcp[cli]==1.28.1`, pytest — React 18, TypeScript, Vite, zod, Vitest, Testing Library.

## Global Constraints

- **Read-only discipline.** Only `assess_conditions`, `plan_targets`, `get_site_profile` are routable in slice 1. Every other tool — especially `qa_session_report`, `goto_target`, `start_stack`, `stop_view`, `park`, `shutdown`, `run_autofocus`, `set_filter`, `set_dew_heater`, `set_project_goal`, `add_horizon_mask`, `set_site_profile`, `log_session_result`, `log_sky_result`, `download_subs`, `plate_solve`, `connect_telescope` — must have **no route**, returning 404.
- **The UI never computes a verdict.** `go` maps 1:1 — `true → GO`, `false → NO-GO`, `null → UNKNOWN`. CONDITIONAL is not rendered in slice 1.
- **No hardcoded QA thresholds.** The literals `0.575` and `0.42` must not appear anywhere in `web/src`. Altitude floor/ceiling come from `get_site_profile`, never from a constant.
- **No hex colour literal outside `web/src/tokens.css`.** All 52 colour tokens transcribed verbatim from `docs/design/README.md` § Design Tokens → Color.
- **Absent data renders as absent.** Where a field has no server source (precipitation %, filter recommendation, target thumbnail, excluded targets, above-floor span), render an explicit absent treatment — an em-dash in `text/ghost`, or omit the element and collapse its container. Never a plausible-looking placeholder value.
- **Typography split is load-bearing.** IBM Plex Sans (400/500/600) for prose/labels/buttons/headings; IBM Plex Mono (400/500) for all numerals, IDs, filenames, timestamps, log output. Do not collapse it.
- **No charting library.** Charts are positioned/flex `div`s driven by tokens.
- **Borders are always `1px solid`. No drop shadows anywhere in slice 1.**
- MCP server launch command: `uv --directory C:/Users/<user>/SeeStar-AI run python -m seestar_mcp.server`

**Reference:** the spec is `docs/superpowers/specs/2026-07-27-seestar-console-design.md`. The design authority is `docs/design/README.md` — every hex, px and copy string in this plan is taken from it.

**One deviation from the spec:** the spec named `web/src/tokens.ts`. This plan uses `web/src/tokens.css` only — a single source of truth as CSS custom properties, with no parallel TS object to drift from it. YAGNI.

---

## File Structure

```
fixtures/                          # shared golden fixtures, repo root
  assess_conditions.json           # recorded — real NO-GO night
  plan_targets.json                # recorded
  get_site_profile.json            # recorded
  synthetic/
    assess_conditions.go.json      # hand-edited GO variant
    assess_conditions.unknown.json # hand-edited go:null variant

sidecar/
  pyproject.toml
  seestar_sidecar/
    __init__.py
    allowlist.py                   # ALLOWED_TOOLS / FORBIDDEN_TOOLS constants
    mcp_proxy.py                   # McpConnection: long-lived stdio session
    replay.py                      # fixture loading for SEESTAR_REPLAY=1
    routes.py                      # FastAPI router, one GET per allowed tool
    main.py                        # app factory, lifespan, CORS
  record.py                        # one-shot fixture recorder
  tests/
    conftest.py
    stub_mcp_server.py             # tiny FastMCP server for deterministic tests
    test_allowlist.py
    test_proxy.py
    test_replay.py

web/
  package.json  vite.config.ts  tsconfig.json  index.html
  src/
    main.tsx  App.tsx
    tokens.css                     # ← the ONLY file containing hex literals
    api/
      schemas.ts                   # zod schemas for the three payloads
      verdict.ts                   # the go → GO/NO-GO/UNKNOWN mapping
      client.ts                    # typed fetch wrappers
    shell/
      AppShell.tsx  AppShell.module.css
      TopBar.tsx    TopBar.module.css
      Sidebar.tsx   Sidebar.module.css
    screens/tonight/
      TonightScreen.tsx      TonightScreen.module.css
      VerdictBanner.tsx      VerdictBanner.module.css
      SweetBandTimeline.tsx  SweetBandTimeline.module.css
      PlanCard.tsx           PlanCard.module.css
      timeline.ts            # pure scale math, unit-tested separately
    test/
      fixtures.ts                  # loads ../../fixtures/*.json
      tokens.test.ts
      no-thresholds.test.ts
```

---

## Task 1: Sidecar skeleton, allowlist and health endpoint

**Files:**
- Create: `sidecar/pyproject.toml`, `sidecar/seestar_sidecar/__init__.py`, `sidecar/seestar_sidecar/allowlist.py`, `sidecar/seestar_sidecar/main.py`, `sidecar/seestar_sidecar/routes.py`
- Test: `sidecar/tests/test_allowlist.py`

**Interfaces:**
- Produces: `ALLOWED_TOOLS: frozenset[str]`, `FORBIDDEN_TOOLS: frozenset[str]`, `create_app() -> FastAPI`

- [ ] **Step 1: Create the project**

`sidecar/pyproject.toml`:

```toml
[project]
name = "seestar-sidecar"
version = "0.1.0"
requires-python = ">=3.11,<3.13"
dependencies = [
  "fastapi==0.121.2",
  "uvicorn==0.41.0",
  "mcp[cli]==1.28.1",
]

[dependency-groups]
dev = ["pytest==8.4.2", "pytest-asyncio==1.3.0", "httpx==0.28.1"]

[tool.pytest.ini_options]
asyncio_mode = "auto"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

- [ ] **Step 2: Write the failing test**

`sidecar/tests/test_allowlist.py`:

```python
"""The allowlist is the structural enforcement of read-only discipline.

A tool with side effects must have no route at all — not a 403, which would
still confirm the endpoint exists. These tests fail loudly if anyone adds one.
"""
import pytest
from fastapi.testclient import TestClient

from seestar_sidecar.allowlist import ALLOWED_TOOLS, FORBIDDEN_TOOLS
from seestar_sidecar.main import create_app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    return TestClient(create_app())


def test_health_reports_replay_mode(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "replay": True}


@pytest.mark.parametrize("tool", sorted(FORBIDDEN_TOOLS))
def test_side_effecting_tools_have_no_route(client, tool):
    assert client.get(f"/api/{tool}").status_code == 404


def test_allowlist_and_forbidden_list_are_disjoint():
    assert not (ALLOWED_TOOLS & FORBIDDEN_TOOLS)


def test_slice_one_allowlist_is_exactly_three_tools():
    assert ALLOWED_TOOLS == frozenset(
        {"assess_conditions", "plan_targets", "get_site_profile"}
    )
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd sidecar && uv run pytest tests/test_allowlist.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'seestar_sidecar'`

- [ ] **Step 4: Write the allowlist**

`sidecar/seestar_sidecar/allowlist.py`:

```python
"""Which MCP tools this sidecar will expose over HTTP.

Read-only tools not in ALLOWED_TOOLS are simply not needed yet; they land in
their own slice. FORBIDDEN_TOOLS is the never-list — every tool that moves the
mount, changes hardware state, or writes to disk. It exists so the test suite
can assert their absence rather than trusting review to catch a new route.
"""

ALLOWED_TOOLS = frozenset(
    {
        "assess_conditions",
        "plan_targets",
        "get_site_profile",
    }
)

#: Tools that must NEVER be routable over HTTP. qa_session_report in particular
#: writes a JSON+MD report and a manifest and winds down the session — a
#: dashboard that called it on page load would generate artifacts on refresh.
FORBIDDEN_TOOLS = frozenset(
    {
        "qa_session_report",
        "goto_target",
        "start_stack",
        "stop_view",
        "park",
        "shutdown",
        "run_autofocus",
        "set_filter",
        "set_dew_heater",
        "set_project_goal",
        "add_horizon_mask",
        "set_site_profile",
        "log_session_result",
        "log_sky_result",
        "download_subs",
        "plate_solve",
        "connect_telescope",
    }
)
```

- [ ] **Step 5: Write routes and the app factory**

`sidecar/seestar_sidecar/routes.py`:

```python
"""One GET per allowlisted tool. Nothing is registered dynamically from a
request path — the routes below are literal, so an unlisted tool 404s because
no handler exists for it.
"""
import os

from fastapi import APIRouter

router = APIRouter(prefix="/api")


def replay_enabled() -> bool:
    return os.environ.get("SEESTAR_REPLAY") == "1"


@router.get("/health")
async def health() -> dict:
    return {"ok": True, "replay": replay_enabled()}
```

`sidecar/seestar_sidecar/main.py`:

```python
"""FastAPI app factory. CORS is open to the Vite dev origin only."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from seestar_sidecar.routes import router

VITE_DEV_ORIGIN = "http://localhost:5173"


def create_app() -> FastAPI:
    app = FastAPI(title="seestar-sidecar", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[VITE_DEV_ORIGIN],
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    app.include_router(router)
    return app
```

`sidecar/seestar_sidecar/__init__.py`: empty file.

- [ ] **Step 6: Run tests and confirm they pass**

Run: `cd sidecar && uv run pytest tests/test_allowlist.py -v`
Expected: PASS — 20 tests (1 health + 17 parametrized forbidden + 2 list assertions)

- [ ] **Step 7: Commit**

```bash
git add sidecar/
git commit -m "feat(sidecar): allowlist-gated FastAPI skeleton with health endpoint"
```

---

## Task 2: MCP stdio proxy

**Files:**
- Create: `sidecar/seestar_sidecar/mcp_proxy.py`, `sidecar/tests/stub_mcp_server.py`, `sidecar/tests/test_proxy.py`
- Do **not** modify `sidecar/seestar_sidecar/main.py`. Task 4 Step 5 replaces it wholesale, lifespan wiring included; adding it here would only be overwritten.

**Interfaces:**
- Consumes: nothing from Task 1 beyond `create_app`
- Produces: `McpConnection(command: str, args: list[str])` with `async start()`, `async call(tool: str, arguments: dict) -> dict`, `async aclose()`; and `ProxyTransportError(RuntimeError)`

**Why a long-lived session:** spawning `uv run python -m seestar_mcp.server` per request would re-import astropy and photutils every time — seconds of latency on every page load. One session is opened at startup and reused, guarded by a lock because MCP stdio is a single ordered channel.

**Known uncertainty, resolved by Step 3:** the MCP SDK may return the tool's dict in `result.structuredContent`, or as JSON text in `result.content[0].text`, depending on how FastMCP derives the output schema for a `-> dict` tool. The implementation reads text first and falls back to structured; the stub test asserts the returned payload equals the stub's dict exactly, so whichever path is live gets pinned. **If Step 3 fails on payload shape, fix `_extract_payload`, not the test.**

- [ ] **Step 1: Write the stub MCP server**

`sidecar/tests/stub_mcp_server.py`:

```python
"""A minimal FastMCP server over stdio, used to test the proxy deterministically.

Speaks the same protocol as seestar-mcp but needs no telescope, no astropy and
no SeeStar-AI checkout, so proxy tests stay fast and hermetic.
"""
import os

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("stub-seestar")

CANNED_PROFILE = {
    "ok": True,
    "profile": {"name": "Stub Site", "lat_deg": 51.4778, "bortle": 8},
}


@mcp.tool()
async def get_site_profile() -> dict:
    """Return a fixed profile."""
    return CANNED_PROFILE


@mcp.tool()
async def whoami() -> dict:
    """Return this server process's pid.

    Exists so a test can tell session reuse from a per-call respawn: a canned
    payload is identical either way, but the pid is not.
    """
    return {"pid": os.getpid()}


@mcp.tool()
async def failing_tool() -> dict:
    """Raise inside a HEALTHY server, to exercise tool-level failure.

    Comes back to the client as CallToolResult(isError=True) — the session
    survives. Contrast crash_the_server below.
    """
    raise RuntimeError("stub failure")


@mcp.tool()
async def crash_the_server() -> dict:
    """Kill this process mid-call, breaking the pipe.

    This is the only way to exercise call()'s except branch and its _reset():
    a tool that merely raises is caught by the isError check and never touches
    the session, so it cannot stand in for a genuine transport failure.
    """
    os._exit(1)


if __name__ == "__main__":
    mcp.run()
```

- [ ] **Step 2: Write the failing test**

`sidecar/tests/test_proxy.py`:

```python
import sys
from pathlib import Path

import pytest

from seestar_sidecar.mcp_proxy import McpConnection, ProxyTransportError

STUB = str(Path(__file__).parent / "stub_mcp_server.py")


@pytest.fixture
async def connection():
    conn = McpConnection(command=sys.executable, args=[STUB])
    await conn.start()
    yield conn
    await conn.aclose()


async def test_call_returns_the_tools_dict_verbatim(connection):
    from tests.stub_mcp_server import CANNED_PROFILE

    assert await connection.call("get_site_profile", {}) == CANNED_PROFILE


async def test_unreachable_subprocess_raises_transport_error():
    conn = McpConnection(command=sys.executable, args=["/nonexistent/path.py"])
    with pytest.raises(ProxyTransportError):
        await conn.start()


async def test_repeated_calls_reuse_one_subprocess(connection):
    """Same pid twice proves one session.

    Comparing canned payloads would NOT prove it — a regressed call() that tore
    down and respawned the server on every invocation returns identical dicts
    and still leaves is_started true. The pid is what distinguishes reuse from
    the per-call spawn this design rules out.
    """
    first = await connection.call("whoami", {})
    second = await connection.call("whoami", {})
    assert first["pid"] == second["pid"]
    assert connection.is_started


async def test_tool_level_failure_surfaces_as_transport_error(connection):
    """A tool that RAISED must not be mistaken for a payload.

    Distinct from a tool that RETURNS {"ok": false, "error": ...} — that is a
    valid response the sidecar forwards untouched (see Task 4). This covers the
    tool raising, where the result carries a traceback rather than JSON.
    """
    with pytest.raises(ProxyTransportError):
        await connection.call("failing_tool", {})


async def test_a_raising_tool_leaves_the_session_intact(connection):
    """isError is not a transport failure — the subprocess is still healthy.

    Deliberately NOT named "recovers": nothing was reset, so there is nothing
    to recover from. Conflating this with the reset path is how the reset path
    went untested in the first place.
    """
    with pytest.raises(ProxyTransportError):
        await connection.call("failing_tool", {})
    assert connection.is_started
    assert await connection.call("get_site_profile", {}) == CANNED_PROFILE


async def test_transport_failure_mid_call_resets_the_session(connection):
    """The subprocess dies, so call_tool() itself raises.

    This is the ONLY path that reaches call()'s except branch and its
    _reset(). It is what recovers the connection when the MCP server dies
    mid-session — the failure a night-long polling dashboard will actually
    hit — so it must be covered.
    """
    with pytest.raises(ProxyTransportError):
        await connection.call("crash_the_server", {})
    assert not connection.is_started


async def test_session_restarts_after_a_transport_failure(connection):
    with pytest.raises(ProxyTransportError):
        await connection.call("crash_the_server", {})
    assert await connection.call("get_site_profile", {}) == CANNED_PROFILE
    assert connection.is_started
```

Import `CANNED_PROFILE` at module scope in the test file rather than inside each
test.

**Third SDK/OS uncertainty, flagged like the other two:** `os._exit(1)` inside a
tool should surface to the client as a broken pipe or closed-stream error out of
`call_tool()`. If instead the client **hangs** waiting for a response that will
never come, do not leave a hanging test in the suite — report it, and say what
the client did. A hang is a finding about the proxy worth knowing (a dead server
should not wedge the dashboard), not merely a test-harness problem.

**SDK uncertainty, same class as `_extract_payload`'s:** a FastMCP tool that raises
may surface either as an exception out of `session.call_tool()` or as a returned
result with `isError=True` — the SDK does the latter in recent versions. The
implementation below handles the `isError` case explicitly. If the tests show it
arrives the other way, adjust the implementation and **report which it was**;
do not weaken the tests.

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd sidecar && uv run pytest tests/test_proxy.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'seestar_sidecar.mcp_proxy'`

- [ ] **Step 4: Implement the proxy**

`sidecar/seestar_sidecar/mcp_proxy.py`:

```python
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
        # Under the lock: shutdown can race an in-flight call(). Tearing the
        # subprocess out from under one turns a clean failure into a raw
        # transport error, and Task 4 wires this into FastAPI's lifespan
        # shutdown, where exactly that race is reachable. Neither path
        # re-acquires the lock, so this cannot deadlock.
        async with self._lock:
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
    """Pull the tool's dict out of an MCP CallToolResult.

    A tool that RAISED is not a payload: the SDK flags it via isError and the
    text block holds a traceback, not JSON. That is a different thing from a
    tool that RETURNS {"ok": false, "error": ...} — the MCP server's never-raise
    contract makes that a valid response, and the sidecar forwards it untouched.
    """
    if getattr(result, "isError", False):
        detail = next(
            (getattr(b, "text", None) for b in getattr(result, "content", []) or []),
            None,
        )
        raise ProxyTransportError(f"tool reported an error: {detail or 'no detail'}")
    for block in getattr(result, "content", []) or []:
        text = getattr(block, "text", None)
        if text is not None:
            return json.loads(text)
    structured = getattr(result, "structuredContent", None)
    if isinstance(structured, dict):
        return structured
    raise ProxyTransportError("tool returned no readable content")
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `cd sidecar && uv run pytest tests/test_proxy.py -v`
Expected: PASS — 7 tests

- [ ] **Step 6: Commit**

```bash
git add sidecar/seestar_sidecar/mcp_proxy.py sidecar/tests/
git commit -m "feat(sidecar): long-lived MCP stdio proxy with a stub-server test"
```

---

## Task 3: Record golden fixtures

**Files:**
- Create: `sidecar/record.py`, `fixtures/assess_conditions.json`, `fixtures/plan_targets.json`, `fixtures/get_site_profile.json`, `fixtures/synthetic/assess_conditions.go.json`, `fixtures/synthetic/assess_conditions.unknown.json`

**Interfaces:**
- Consumes: `McpConnection` from Task 2
- Produces: the `fixtures/` tree consumed by Tasks 4, 6 and 8–13

- [ ] **Step 1: Write the recorder**

`sidecar/record.py`:

```python
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
    "plan_targets": {"limit": 3},
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
```

- [ ] **Step 2: Record against the real server**

Run: `cd sidecar && uv run python record.py`
Expected: three files written. `assess_conditions.json` should show `"go": false` — that is the real current sky, not an error.

- [ ] **Step 3: Verify the recorded shapes match what the plan assumes**

Run: `cd sidecar && uv run python -c "import json,pathlib; d=json.loads(pathlib.Path('../fixtures/assess_conditions.json').read_text()); print(sorted(d))"`
Expected: includes `cloud_cover_pct`, `dark_window_utc`, `dew_risk`, `go`, `location`, `moon_illum_frac`, `ok`, `reasons`, `seeing`, `source`, `suitability`, `transparency`, `wind_kph`

If a key is missing or renamed, **stop and update `web/src/api/schemas.ts` in Task 6 to match** — the recorded server is the authority, not this plan.

- [ ] **Step 4: Create the two synthetic variants by hand**

Copy `fixtures/assess_conditions.json` to `fixtures/synthetic/assess_conditions.go.json` and edit only these fields, leaving everything else as recorded:

```json
{
  "go": true,
  "suitability": 88,
  "cloud_cover_pct": 6.0,
  "dew_risk": "low",
  "transparency": "good",
  "moon_illum_frac": 0.12,
  "reasons": ["cloud cover 6% (worst over window)", "moon 12% illuminated"]
}
```

Copy it again to `fixtures/synthetic/assess_conditions.unknown.json`. This one is
**not** a free invention: the server has an authoritative fallback constructor,
`_unknown()` at `SeeStar-AI/src/seestar_mcp/planning/weather.py:166`, and the
fixture must reproduce its output exactly. Keep `ok` and `location` as recorded
(the tool merges them in around the assessment), keep `dark_window_utc` as
recorded (it is computed from ephemeris, not weather), and set:

```json
{
  "go": null,
  "suitability": 0,
  "cloud_cover_pct": null,
  "dew_risk": "unknown",
  "wind_kph": null,
  "transparency": null,
  "seeing": null,
  "moon_illum_frac": 0.0,
  "source": "unknown",
  "reasons": ["weather unavailable — assess the sky manually"]
}
```

Three of these are easy to get wrong by reasoning from first principles:

- **`dew_risk` is `"unknown"`, not `null`.** The dataclass types it `str`, not
  `str | None` — the server cannot emit a null there, and the Task 6 schema
  types it `z.string()` accordingly. Leaving it at the recorded `"high"` would
  be incoherent (it is derived from the same forecast as cloud and wind), but
  nulling it would be a payload the server never produces.
- **`moon_illum_frac` is `0.0`, not the recorded value.** Moon phase is
  ephemeris rather than weather, so preserving it looks reasonable — but
  `_unknown()` zeroes it, and the server is the authority.
- **`source` is `"unknown"`**, matching the module docstring's stated contract
  (`go=None` / `source="unknown"`), and the reason string is
  `"weather unavailable — assess the sky manually"` verbatim.

> **Consequence for Task 11:** on the UNKNOWN verdict, `moon_illum_frac` is `0.0`
> — a placeholder, not a measurement. The banner must not render "MOON 0%"
> there; that is exactly the plausible-looking-but-false value the spec forbids.
> On UNKNOWN, the stat tiles render absent.

These are the only synthetic fixtures in the repo, and they live under `synthetic/` so nobody mistakes them for recorded data.

- [ ] **Step 5: Commit**

```bash
git add sidecar/record.py fixtures/
git commit -m "feat(fixtures): record golden payloads from the live MCP server"
```

---

## Task 4: Replay mode and the tool routes

**Files:**
- Create: `sidecar/seestar_sidecar/replay.py`, `sidecar/tests/test_replay.py`
- Modify: `sidecar/seestar_sidecar/routes.py`, `sidecar/seestar_sidecar/main.py`

**Interfaces:**
- Consumes: `ALLOWED_TOOLS` (Task 1), `McpConnection`/`ProxyTransportError` (Task 2), `fixtures/` (Task 3)
- Produces: `GET /api/assess_conditions`, `GET /api/plan_targets?limit=`, `GET /api/get_site_profile`; `load_fixture(tool: str) -> dict`

- [ ] **Step 1: Write the failing test**

`sidecar/tests/test_replay.py`:

```python
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

from seestar_sidecar.allowlist import ALLOWED_TOOLS
from seestar_sidecar.main import create_app

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    return TestClient(create_app())


@pytest.mark.parametrize("tool", sorted(ALLOWED_TOOLS))
def test_replay_returns_the_fixture_unmodified(client, tool):
    response = client.get(f"/api/{tool}")
    assert response.status_code == 200
    assert response.json() == json.loads((FIXTURES / f"{tool}.json").read_text())


def test_recorded_night_is_a_no_go(client):
    """Guards against someone quietly replacing the fixture with a rosier one."""
    assert client.get("/api/assess_conditions").json()["go"] is False


def test_transport_failure_uses_the_same_error_shape(monkeypatch):
    from seestar_sidecar import routes
    from seestar_sidecar.mcp_proxy import ProxyTransportError

    # Arity must match call_tool's (request, tool, arguments) — a 2-arg stub
    # raises TypeError instead, and the test passes for the wrong reason.
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
    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)
    app = create_app()
    with TestClient(app):
        assert app.state.connection is not None
    assert app.state.connection is None  # closed and cleared on shutdown


def test_lifespan_creates_no_connection_in_replay(monkeypatch):
    monkeypatch.setenv("SEESTAR_REPLAY", "1")
    app = create_app()
    with TestClient(app):
        assert app.state.connection is None


def test_each_app_owns_its_connection(monkeypatch):
    """Two apps in one process must not share connection state."""
    monkeypatch.delenv("SEESTAR_REPLAY", raising=False)
    first, second = create_app(), create_app()
    with TestClient(first), TestClient(second):
        assert first.state.connection is not second.state.connection
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd sidecar && uv run pytest tests/test_replay.py -v`
Expected: FAIL — 404 on every tool route, because no handlers exist yet

- [ ] **Step 3: Implement replay**

`sidecar/seestar_sidecar/replay.py`:

```python
"""Serve recorded fixtures instead of spawning a subprocess.

This is what the test gate and offline UI work run against.
"""
import json
from functools import lru_cache
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


@lru_cache(maxsize=None)
def load_fixture(tool: str) -> dict:
    path = FIXTURES / f"{tool}.json"
    if not path.is_file():
        raise FileNotFoundError(
            f"no fixture for {tool!r} at {path} — run `uv run python record.py`"
        )
    return json.loads(path.read_text(encoding="utf-8"))
```

- [ ] **Step 4: Add the tool routes**

Replace `sidecar/seestar_sidecar/routes.py` with:

```python
"""One GET per allowlisted tool. Routes are literal — an unlisted tool 404s
because no handler exists for it, not because a guard rejected it.
"""
import os

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from seestar_sidecar.mcp_proxy import ProxyTransportError
from seestar_sidecar.replay import load_fixture

router = APIRouter(prefix="/api")


def replay_enabled() -> bool:
    return os.environ.get("SEESTAR_REPLAY") == "1"


async def call_tool(request: Request, tool: str, arguments: dict) -> dict:
    """Indirection so tests can substitute a failing transport.

    The connection lives on app.state, not a module global: one per app
    instance, so two apps in a process cannot clobber each other.
    """
    connection = getattr(request.app.state, "connection", None)
    if connection is None:
        raise ProxyTransportError("MCP connection not started")
    return await connection.call(tool, arguments)


async def _serve(request: Request, tool: str, arguments: dict) -> JSONResponse:
    # Every failure below returns the same {ok, error} shape the tools
    # themselves use, so the client parses one error format regardless of which
    # layer failed. A tool RETURNING {"ok": false, ...} is not a failure — that
    # is a valid response and forwards at 200.
    if replay_enabled():
        try:
            return JSONResponse(load_fixture(tool))
        except FileNotFoundError as exc:
            # Carries a "run record.py" pointer. Letting it escape turns a
            # diagnosable message into a generic 500.
            return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)
    try:
        return JSONResponse(await call_tool(request, tool, arguments))
    except ProxyTransportError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/health")
async def health() -> dict:
    return {"ok": True, "replay": replay_enabled()}


@router.get("/assess_conditions")
async def assess_conditions(request: Request) -> JSONResponse:
    return await _serve(request, "assess_conditions", {})


@router.get("/plan_targets")
async def plan_targets(
    request: Request, limit: int = Query(default=3, ge=1, le=10)
) -> JSONResponse:
    return await _serve(request, "plan_targets", {"limit": limit})


@router.get("/get_site_profile")
async def get_site_profile(request: Request) -> JSONResponse:
    return await _serve(request, "get_site_profile", {})
```

- [ ] **Step 5: Add lifespan wiring to main.py**

Replace `sidecar/seestar_sidecar/main.py` with:

```python
"""FastAPI app factory. CORS is open to the Vite dev origin only."""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from seestar_sidecar.mcp_proxy import McpConnection
from seestar_sidecar.routes import replay_enabled, router

VITE_DEV_ORIGIN = "http://localhost:5173"
SEESTAR_AI_DIR = os.environ.get("SEESTAR_AI_DIR", "C:/Users/<user>/SeeStar-AI")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The connection lives on app.state rather than a module global, so each
    # create_app() owns its own and two apps in one process cannot clobber
    # each other. Routes read it via request.app.state.
    app.state.connection = None
    if not replay_enabled():
        app.state.connection = McpConnection(
            command="uv",
            args=["--directory", SEESTAR_AI_DIR, "run", "python", "-m", "seestar_mcp.server"],
        )
        # Deliberately not started here: a dead SeeStar-AI checkout should not
        # stop the sidecar booting. The first request starts it and surfaces
        # any failure as a 502 the UI can render.
    yield
    if app.state.connection is not None:
        await app.state.connection.aclose()
        app.state.connection = None


def create_app() -> FastAPI:
    app = FastAPI(title="seestar-sidecar", version="0.1.0", lifespan=lifespan)
    # Safe default for callers that never run the lifespan — a bare
    # TestClient(create_app()) does exactly that. Routes then report
    # "MCP connection not started" as a 502 rather than an AttributeError 500.
    app.state.connection = None
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[VITE_DEV_ORIGIN],
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    app.include_router(router)
    return app
```

- [ ] **Step 6: Run the whole sidecar suite**

Run: `cd sidecar && uv run pytest -v`
Expected: PASS — all tests from Tasks 1, 2 and 4 (36 total)

- [ ] **Step 7: Commit**

```bash
git add sidecar/
git commit -m "feat(sidecar): replay mode and the three read-only tool routes"
```

---

## Task 5: Web scaffold and design tokens

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/tokens.css`, `web/src/test/tokens.test.ts`, `web/src/test/no-thresholds.test.ts`

**Interfaces:**
- Produces: all 52 colour custom properties, the type scale, and the two guard tests

- [ ] **Step 1: Scaffold**

Run: `npm create vite@latest web -- --template react-ts` then `cd web && npm install && npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom && npm install zod`

`web/vite.config.ts` — note the import is from `vitest/config`, not `vite`.
Vite's own `defineConfig` has no `test` key on `UserConfigExport`, so the
config fails to typecheck; `vitest/config` re-exports a widened version. This is
vitest's documented approach, not a workaround.

Also add `"node"` to the `types` array in `web/tsconfig.app.json` — the guard
tests use `node:fs` and `__dirname`. `@types/node` already ships with the Vite
scaffold.

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
})
```

`web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

Add to `web/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Write the failing guard tests**

`web/src/test/tokens.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')
const TOKENS = join(SRC, 'tokens.css')
const HEX = /#[0-9a-fA-F]{3,8}\b/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx|css)$/.test(entry) && full !== TOKENS ? [full] : []
  })
}

describe('design tokens', () => {
  it('defines all 52 colour tokens from the handoff table', () => {
    const declared = readFileSync(TOKENS, 'utf8').match(/^\s*--[a-z0-9-]+:\s*#/gm) ?? []
    expect(declared).toHaveLength(52)
  })

  it('is the only file containing a hex colour literal', () => {
    const offenders = sourceFiles(SRC)
      .map((file) => ({ file, hits: readFileSync(file, 'utf8').match(HEX) }))
      .filter((entry) => entry.hits !== null)
    expect(offenders).toEqual([])
  })
})
```

`web/src/test/no-thresholds.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

/**
 * QA thresholds are owned by the server (SeeStar-AI config.py) and are
 * session-relative — two nights can reject at different absolute numbers.
 *
 * This is a deny-list of the distinctive eccentricity constants, NOT proof of
 * full coverage: altitude floor/ceiling degrees (20/60) are too generic to grep
 * for without false positives. Those rest on the convention that all site
 * geometry is read from get_site_profile, enforced by review.
 */
const FORBIDDEN = ['0.575', '0.42']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx|css)$/.test(entry) && !full.includes('no-thresholds') ? [full] : []
  })
}

describe('QA thresholds', () => {
  it.each(FORBIDDEN)('never hardcodes %s', (literal) => {
    const offenders = sourceFiles(SRC).filter((file) =>
      readFileSync(file, 'utf8').includes(literal),
    )
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 3: Run and confirm they fail**

Run: `cd web && npm test`
Expected: FAIL — `ENOENT` on `tokens.css`

- [ ] **Step 4: Write tokens.css**

Transcribe **every row** of the Color table in `docs/design/README.md` (52 rows, `bg/root` through `chart/rail-empty`). Token names convert `/` to `-`. The structure, showing the first rows of each group — **all 52 must be present or the test fails**:

```css
/* Transcribed verbatim from docs/design/README.md § Design Tokens → Color.
   This is the ONLY file in web/src permitted to contain a hex literal.
   Semantic rule from the handoff: `accent` is never a verdict. Verdicts are
   pass/marginal/reject; the accent marks the live or actionable thing. */
:root {
  --bg-root: #0d0e10;
  --bg-chrome: #101215;
  --bg-chrome-alt: #0f1114;
  --bg-card: #15171a;
  --bg-card-sunken: #131518;
  --bg-cell: #181b1e;
  --bg-inset: #101317;
  --bg-hover: #1e2226;
  --bg-seg-active: #2a2f34;
  --bg-seg-track: #181b1f;
  --bg-track: #1c1f22;
  --bg-track-alt: #101317;

  --border-default: #262a2f;
  --border-subtle: #1f2327;
  --border-faint: #1c1f22;
  --border-quiet: #222629;
  --border-control: #2f343a;
  --border-control-hover: #3f454b;

  --text-primary: #e9e7e4;
  --text-body: #d5d2ce;
  --text-secondary: #c5c2be;
  --text-muted: #a8a5a1;
  --text-dim: #9aa0a6;
  --text-dimmer: #8b8f95;
  --text-faint: #6f747a;
  --text-fainter: #5f646a;
  --text-ghost: #4d5257;

  --accent: #c4643a;
  --accent-hover: #d97b51;
  --accent-text: #e2a883;
  --accent-text-bright: #f0c6ab;
  --accent-on-accent: #120d09;
  --accent-on-accent-alt: #150d08;
  --accent-bg: #1c1712;
  --accent-bg-alt: #1b1712;
  --accent-border: #3a2f26;
  --accent-hover-bg: #241d16;

  --pass: #4f9b7a;
  --pass-bg: #12241d;

  --marginal: #c9a24a;
  --marginal-bg: #242015;
  --marginal-callout-bg: #161311;
  --marginal-callout-border: #2d2621;

  --reject: #d1554e;
  --reject-bg: #241514;
  --reject-btn-bg: #1e1513;
  --reject-btn-bg-hover: #271917;
  --reject-btn-border: #4a2f2b;

  --neutral-tag-bg: #1a1d21;

  --chart-bar-quiet: #3a4a44;
  --chart-rail: #2f353b;
  --chart-rail-empty: #3a4046;
}

/* Typography. The Sans/Mono split is load-bearing: anything a machine produced,
   or a human would read as a measurement, is Mono. Do not collapse it. */
:root {
  --font-sans: 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
  --radius-card: 10px;
  --radius-control: 6px;
  --radius-chip: 4px;

  /* The twilight strip's gradient — darkness deepens toward the middle. The
     handoff specifies it in the timeline section rather than the token table,
     but it lives here so tokens.css stays the only file with hex literals. */
  --twilight-strip: linear-gradient(
    90deg, #1b1f24 0%, #171b20 25%, #0f1215 32%,
    #0f1215 85%, #171b20 90%, #1b1f24 100%
  );
}

@keyframes livePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; }
}

* { box-sizing: border-box; }

html, body, #root { height: 100%; }

body {
  margin: 0;
  background: var(--bg-root);
  color: var(--text-primary);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

/* Scrollbars are restyled globally per the handoff. */
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: #2b3036; border-radius: 5px; }
::-webkit-scrollbar-track { background: transparent; }
```

> The `#2b3036` scrollbar thumb is inside `tokens.css`, so it does not trip the hex test. It is the one handoff colour that is not in the token table.

Add the Google Fonts link to `web/index.html` `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
```

Import it in `web/src/main.tsx`: `import './tokens.css'`.

- [ ] **Step 5: Run tests and confirm they pass**

Run: `cd web && npm test`
Expected: PASS — 4 tests (2 token, 2 threshold)

- [ ] **Step 6: Commit**

```bash
git add web/
git commit -m "feat(web): Vite scaffold with the 52-token design system and guard tests"
```

---

## Task 6: Payload schemas and the fixture-contract test

**Files:**
- Create: `web/src/api/schemas.ts`, `web/src/test/fixtures.ts`, `web/src/api/schemas.test.ts`

**Interfaces:**
- Consumes: `fixtures/` (Task 3)
- Produces: `ConditionsSchema`, `PlanTargetsSchema`, `SiteProfileSchema`, `HealthSchema`, and the inferred types `Conditions`, `PlanTargets`, `PlanTarget`, `SiteProfile`, `Health`

- [ ] **Step 1: Write the fixture loader**

`web/src/test/fixtures.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..', '..', 'fixtures')

export const loadFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(ROOT, `${name}.json`), 'utf8'))

export const recordedConditions = () => loadFixture('assess_conditions')
export const recordedPlan = () => loadFixture('plan_targets')
export const recordedSite = () => loadFixture('get_site_profile')
export const goConditions = () => loadFixture('synthetic/assess_conditions.go')
export const unknownConditions = () => loadFixture('synthetic/assess_conditions.unknown')
```

- [ ] **Step 2: Write the failing contract test**

`web/src/api/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ConditionsSchema, PlanTargetsSchema, SiteProfileSchema } from './schemas'
import {
  goConditions,
  recordedConditions,
  recordedPlan,
  recordedSite,
  unknownConditions,
} from '../test/fixtures'

/**
 * The early-warning system for drift between this repo and SeeStar-AI. When the
 * server's payload changes, this fails with a field-level message instead of the
 * UI silently rendering blank cards.
 */
describe('fixture contract', () => {
  it('parses the recorded conditions payload', () => {
    expect(() => ConditionsSchema.parse(recordedConditions())).not.toThrow()
  })

  it('parses the recorded plan payload', () => {
    expect(() => PlanTargetsSchema.parse(recordedPlan())).not.toThrow()
  })

  it('parses the recorded site profile', () => {
    expect(() => SiteProfileSchema.parse(recordedSite())).not.toThrow()
  })

  it('parses both synthetic conditions variants', () => {
    expect(() => ConditionsSchema.parse(goConditions())).not.toThrow()
    expect(() => ConditionsSchema.parse(unknownConditions())).not.toThrow()
  })

  it('tolerates the nulls the real server actually sends', () => {
    const parsed = ConditionsSchema.parse(recordedConditions())
    expect(parsed.location.matched).toBeNull()
    expect(parsed.location.warning).toContain('GPS unverified')
  })

  it('keeps go as a tri-state and never coerces null to false', () => {
    expect(ConditionsSchema.parse(unknownConditions()).go).toBeNull()
    expect(ConditionsSchema.parse(recordedConditions()).go).toBe(false)
  })
})
```

- [ ] **Step 3: Run and confirm it fails**

Run: `cd web && npm test -- schemas`
Expected: FAIL — cannot resolve `./schemas`

- [ ] **Step 4: Write the schemas**

`web/src/api/schemas.ts`:

```ts
import { z } from 'zod'

/**
 * Shapes are transcribed from payloads recorded off the live server, not from
 * the design handoff. Nullable fields are nullable because the real server sends
 * null there — location.matched, sqm and median_fwhm all do today.
 */

export const LocationSchema = z.object({
  matched: z.boolean().nullable(),
  distance_km: z.number().nullable(),
  site_name: z.string(),
  mask_applied: z.boolean(),
  warning: z.string().nullable().optional(),
})

export const ConditionsSchema = z.object({
  ok: z.boolean(),
  location: LocationSchema,
  go: z.boolean().nullable(),
  suitability: z.number(),
  cloud_cover_pct: z.number().nullable(),
  dew_risk: z.string(),
  wind_kph: z.number().nullable(),
  transparency: z.string().nullable(),
  seeing: z.string().nullable(),
  moon_illum_frac: z.number(),
  dark_window_utc: z.tuple([z.string(), z.string()]),
  source: z.string(),
  reasons: z.array(z.string()),
})

export const PlanTargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  score: z.number(),
  reasons: z.array(z.string()),
  best_window_utc: z.tuple([z.string(), z.string()]),
  recommended_subs: z.number(),
  recommended_exposure_s: z.number(),
  framing_note: z.string().nullable(),
  max_alt_deg: z.number(),
  transit_utc: z.string().nullable(),
  sweet_band_min: z.number(),
  moon_sep_deg: z.number(),
})

export const PlanTargetsSchema = z.object({
  ok: z.boolean(),
  location: LocationSchema,
  conditions: z.object({
    go: z.boolean().nullable(),
    suitability: z.number(),
    source: z.string(),
  }),
  count: z.number(),
  targets: z.array(PlanTargetSchema),
})

export const SiteProfileSchema = z.object({
  ok: z.boolean(),
  profile: z.object({
    name: z.string(),
    lat_deg: z.number(),
    lon_deg: z.number(),
    elevation_m: z.number(),
    bortle: z.number().nullable(),
    sqm: z.number().nullable(),
    horizon_mask: z.array(z.unknown()),
    min_altitude_deg: z.number(),
    field_rotation_ceiling_deg: z.number(),
    location_tolerance_km: z.number(),
  }),
})

export const HealthSchema = z.object({
  ok: z.boolean(),
  replay: z.boolean(),
})

export type Conditions = z.infer<typeof ConditionsSchema>
export type PlanTargets = z.infer<typeof PlanTargetsSchema>
export type PlanTarget = z.infer<typeof PlanTargetSchema>
export type SiteProfile = z.infer<typeof SiteProfileSchema>
export type Health = z.infer<typeof HealthSchema>
```

- [ ] **Step 5: Run and confirm it passes**

Run: `cd web && npm test -- schemas`
Expected: PASS — 6 tests. If a field mismatches, **change the schema to match the fixture**, not the reverse.

- [ ] **Step 6: Commit**

```bash
git add web/src/api/schemas.ts web/src/api/schemas.test.ts web/src/test/fixtures.ts
git commit -m "feat(web): zod schemas with a fixture-contract test against recorded payloads"
```

---

## Task 7: Verdict mapping

**Files:**
- Create: `web/src/api/verdict.ts`, `web/src/api/verdict.test.ts`

**Interfaces:**
- Consumes: `Conditions` (Task 6)
- Produces: `type Verdict = 'GO' | 'NO-GO' | 'UNKNOWN'`, `verdictFor(go: boolean | null): Verdict`, `verdictTone(verdict: Verdict): 'pass' | 'reject' | 'marginal'`

- [ ] **Step 1: Write the failing test**

`web/src/api/verdict.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { verdictFor } from './verdict'

describe('verdict mapping', () => {
  it('maps the three values go can hold', () => {
    expect(verdictFor(true)).toBe('GO')
    expect(verdictFor(false)).toBe('NO-GO')
    expect(verdictFor(null)).toBe('UNKNOWN')
  })

  it('never returns CONDITIONAL', () => {
    // CONDITIONAL exists in the design but not in the server contract.
    // Deriving it from `suitability` would be the UI computing a verdict.
    const all = [true, false, null].map(verdictFor)
    expect(all).not.toContain('CONDITIONAL')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd web && npm test -- verdict`
Expected: FAIL — cannot resolve `./verdict`

- [ ] **Step 3: Implement**

`web/src/api/verdict.ts`:

```ts
/**
 * The single place verdict naming happens.
 *
 * The server returns `go: boolean | null`. This is a 1:1 relabel of that field
 * with no arithmetic — it is NOT a derivation. The design's CONDITIONAL state
 * has no server source, and synthesising it from `suitability` would mean the UI
 * computing a verdict from a threshold, which this project forbids. See
 * docs/handback-to-seestar-ai.md item 6.
 */
export type Verdict = 'GO' | 'NO-GO' | 'UNKNOWN'

export function verdictFor(go: boolean | null): Verdict {
  if (go === true) return 'GO'
  if (go === false) return 'NO-GO'
  return 'UNKNOWN'
}

/** Maps a verdict to its token family: pass / reject / marginal. */
export function verdictTone(verdict: Verdict): 'pass' | 'reject' | 'marginal' {
  if (verdict === 'GO') return 'pass'
  if (verdict === 'NO-GO') return 'reject'
  return 'marginal'
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd web && npm test -- verdict`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add web/src/api/verdict.ts web/src/api/verdict.test.ts
git commit -m "feat(web): verdict mapping with CONDITIONAL deliberately unrendered"
```

---

## Task 8: API client

**Files:**
- Create: `web/src/api/client.ts`, `web/src/api/client.test.ts`

**Interfaces:**
- Consumes: schemas (Task 6)
- Produces: `fetchConditions()`, `fetchPlan(limit?)`, `fetchSite()`, `fetchHealth()`, each `Promise<T>`; `ApiError`

- [ ] **Step 1: Write the failing test**

`web/src/api/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, fetchConditions } from './client'
import { recordedConditions } from '../test/fixtures'

const mockFetch = (body: unknown, status = 200) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  }))

afterEach(() => vi.unstubAllGlobals())

describe('api client', () => {
  it('parses a good response', async () => {
    mockFetch(recordedConditions())
    expect((await fetchConditions()).go).toBe(false)
  })

  it('raises ApiError with the sidecar message on 502', async () => {
    mockFetch({ ok: false, error: 'subprocess died' }, 502)
    await expect(fetchConditions()).rejects.toThrow(/subprocess died/)
  })

  it('raises ApiError when the payload fails schema validation', async () => {
    mockFetch({ ok: true, go: 'yes' })
    await expect(fetchConditions()).rejects.toBeInstanceOf(ApiError)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd web && npm test -- client`
Expected: FAIL — cannot resolve `./client`

- [ ] **Step 3: Implement**

`web/src/api/client.ts`:

```ts
import type { ZodType } from 'zod'
import {
  ConditionsSchema,
  HealthSchema,
  PlanTargetsSchema,
  SiteProfileSchema,
  type Conditions,
  type Health,
  type PlanTargets,
  type SiteProfile,
} from './schemas'

export class ApiError extends Error {}

async function get<T>(path: string, schema: ZodType<T>): Promise<T> {
  let response: Response
  try {
    response = await fetch(path)
  } catch (cause) {
    throw new ApiError(`sidecar unreachable at ${path}`, { cause })
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${response.status}`
    throw new ApiError(detail)
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    // Loud, not silent: a shape change should be visible, not a blank card.
    throw new ApiError(`unexpected payload from ${path}: ${parsed.error.message}`)
  }
  return parsed.data
}

export const fetchConditions = (): Promise<Conditions> =>
  get('/api/assess_conditions', ConditionsSchema)

export const fetchPlan = (limit = 3): Promise<PlanTargets> =>
  get(`/api/plan_targets?limit=${limit}`, PlanTargetsSchema)

export const fetchSite = (): Promise<SiteProfile> =>
  get('/api/get_site_profile', SiteProfileSchema)

/** Drives the top bar's "fixtures — not live" indicator. */
export const fetchHealth = (): Promise<Health> => get('/api/health', HealthSchema)
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd web && npm test -- client`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.ts web/src/api/client.test.ts
git commit -m "feat(web): typed API client with loud schema-mismatch errors"
```

---

## Task 9: Top bar

**Files:**
- Create: `web/src/shell/TopBar.tsx`, `web/src/shell/TopBar.module.css`, `web/src/shell/TopBar.test.tsx`

**Interfaces:**
- Consumes: `SiteProfile` (Task 6)
- Produces: `<TopBar site={SiteProfile | null} replay={boolean} />`

**Spec** (`docs/design/README.md` § Top bar): 52px tall, `padding: 0 18px`, `border-bottom: 1px solid var(--border-subtle)`, `background: var(--bg-chrome)`, `gap: 16px`. Wordmark `seestar` Sans 600/14px/`-.01em`, beside `mcp 0.1.0` Mono 400/10px/`text/faint`, gap 9px. Then a `1px × 20px` divider in `--border-default`.

**Slice-1 honesty:** the three connection pills (`bridge :5555`, `S50 fw 7.75`, `alt-az`) are real state fed by `get_status` / `get_device_state`, which are **not routed in slice 1**. The handoff is explicit: *"a stale green dot on a dead bridge is worse than no dot."* So render the pills' container with a single neutral pill reading `telemetry in slice 3` in `--text-faint`, no dot. Do not render green dots.

- [ ] **Step 1: Write the failing test**

`web/src/shell/TopBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TopBar } from './TopBar'
import { SiteProfileSchema } from '../api/schemas'
import { recordedSite } from '../test/fixtures'

const site = SiteProfileSchema.parse(recordedSite())

describe('TopBar', () => {
  it('shows the wordmark and server version', () => {
    render(<TopBar site={site} replay={false} />)
    expect(screen.getByText('seestar')).toBeInTheDocument()
    expect(screen.getByText('mcp 0.1.0')).toBeInTheDocument()
  })

  it('never shows a healthy connection dot before telemetry is routed', () => {
    const { container } = render(<TopBar site={site} replay={false} />)
    expect(container.querySelectorAll('[data-dot="pass"]')).toHaveLength(0)
    expect(screen.getByText(/slice 3/)).toBeInTheDocument()
  })

  it('surfaces replay mode so fixtures are never mistaken for live data', () => {
    render(<TopBar site={site} replay />)
    expect(screen.getByText(/fixtures/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd web && npm test -- TopBar`
Expected: FAIL — cannot resolve `./TopBar`

- [ ] **Step 3: Implement**

`web/src/shell/TopBar.module.css`:

```css
.bar {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 52px;
  flex: 0 0 52px;
  padding: 0 18px;
  background: var(--bg-chrome);
  border-bottom: 1px solid var(--border-subtle);
}

.brand { display: flex; align-items: baseline; gap: 9px; }

.wordmark {
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 14px;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.version {
  font-family: var(--font-mono);
  font-weight: 400;
  font-size: 10px;
  color: var(--text-faint);
}

.divider { width: 1px; height: 20px; background: var(--border-default); }

.pill {
  padding: 4px 9px;
  border: 1px solid var(--border-default);
  border-radius: 5px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-dim);
}

.spacer { flex: 1; }

.facts {
  display: flex;
  gap: 18px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dimmer);
}

.factValue { color: var(--text-primary); }

.replay {
  padding: 4px 9px;
  border: 1px solid var(--marginal-callout-border);
  border-radius: 5px;
  background: var(--marginal-callout-bg);
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--marginal);
}
```

`web/src/shell/TopBar.tsx`:

```tsx
import type { SiteProfile } from '../api/schemas'
import styles from './TopBar.module.css'

interface Props {
  site: SiteProfile | null
  replay: boolean
}

/**
 * The handoff specifies three live connection pills fed by get_status /
 * get_device_state. Neither is routed in slice 1, and the handoff is explicit
 * that "a stale green dot on a dead bridge is worse than no dot" — so we render
 * an honest placeholder rather than a decorative healthy state.
 */
export function TopBar({ site, replay }: Props) {
  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <span className={styles.wordmark}>seestar</span>
        <span className={styles.version}>mcp 0.1.0</span>
      </div>
      <div className={styles.divider} />
      <span className={styles.pill}>telemetry in slice 3</span>
      <div className={styles.spacer} />
      {site && (
        <div className={styles.facts}>
          <span>
            site <span className={styles.factValue}>{site.profile.name}</span>
          </span>
          <span>
            bortle{' '}
            <span className={styles.factValue}>{site.profile.bortle ?? '—'}</span>
          </span>
        </div>
      )}
      {replay && <span className={styles.replay}>fixtures — not live</span>}
    </header>
  )
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd web && npm test -- TopBar`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add web/src/shell/
git commit -m "feat(web): top bar with honest placeholders for unrouted telemetry"
```

---

## Task 10: Sidebar

**Files:**
- Create: `web/src/shell/Sidebar.tsx`, `web/src/shell/Sidebar.module.css`, `web/src/shell/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `SiteProfile` (Task 6), `Verdict` (Task 7)
- Produces: `<Sidebar site={SiteProfile | null} verdict={Verdict | null} />`

**Spec** (§ Sidebar): 214px wide, `border-right: 1px solid var(--border-subtle)`, `background: var(--bg-chrome)`, `padding: 14px 10px`, column flex. Eyebrow `Session` (Mono 500/10px/`.12em`/uppercase/`text/fainter`), `padding: 0 8px 10px`. Nav buttons: full width, `9px 8px`, radius 6px, `2px` bottom margin, `gap: 10px`, Sans 500/12.5px, left-aligned; active = `--bg-hover` + `--text-primary`, inactive = transparent + `--text-dim`. Layout `[6px dot] [label flex:1] [meta Mono 400 10px --text-fainter]`.

**Slice-1 states.** Only Tonight is implemented; the other three render disabled with meta `slice 2–4`. The Tonight dot takes the verdict tone. The Site profile block must reflect **real** data: `min_altitude_deg` and `field_rotation_ceiling_deg` come from the profile, never hardcoded; `horizon_mask: []` renders `mask off`, not "3 arcs"; and `location.matched === null` turns the confident `pass` row into a `marginal` warning carrying `location.warning` verbatim.

- [ ] **Step 1: Write the failing test**

`web/src/shell/Sidebar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Sidebar } from './Sidebar'
import { SiteProfileSchema } from '../api/schemas'
import { recordedSite } from '../test/fixtures'

const site = SiteProfileSchema.parse(recordedSite())

describe('Sidebar', () => {
  it('reads floor and ceiling from the profile, not constants', () => {
    render(<Sidebar site={site} verdict="NO-GO" />)
    // Recorded profile is floor 20, ceiling 60 — the design's 25 must not appear.
    expect(screen.getByText(/floor 20°/)).toBeInTheDocument()
    expect(screen.getByText(/ceiling 60°/)).toBeInTheDocument()
    expect(screen.queryByText(/floor 25°/)).not.toBeInTheDocument()
  })

  it('renders an empty horizon mask as off', () => {
    render(<Sidebar site={site} verdict="NO-GO" />)
    expect(screen.getByText(/mask off/)).toBeInTheDocument()
    expect(screen.queryByText(/3 arcs/)).not.toBeInTheDocument()
  })

  it('shows the site name and Bortle from the profile', () => {
    render(<Sidebar site={site} verdict="NO-GO" />)
    expect(screen.getByText('Example Observatory (scope GPS)')).toBeInTheDocument()
    expect(screen.getByText(/Bortle 8/)).toBeInTheDocument()
  })

  it('marks screens that are not in slice 1 as unavailable', () => {
    render(<Sidebar site={site} verdict="NO-GO" />)
    expect(screen.getByRole('button', { name: /Tonight/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Live session/ })).toBeDisabled()
  })

  it('renders without a profile', () => {
    render(<Sidebar site={null} verdict={null} />)
    expect(screen.getByText('Session')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd web && npm test -- Sidebar`
Expected: FAIL — cannot resolve `./Sidebar`

- [ ] **Step 3: Implement**

`web/src/shell/Sidebar.module.css`:

```css
.rail {
  display: flex;
  flex-direction: column;
  width: 214px;
  flex: 0 0 214px;
  padding: 14px 10px;
  background: var(--bg-chrome);
  border-right: 1px solid var(--border-subtle);
}

.eyebrow {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-fainter);
  padding: 0 8px 10px;
}

.nav {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-bottom: 2px;
  padding: 9px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 12.5px;
  text-align: left;
  color: var(--text-dim);
  cursor: pointer;
}

.navActive { background: var(--bg-hover); color: var(--text-primary); }
.nav:disabled { cursor: default; opacity: 0.55; }

.dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 6px; }
.dotPass { background: var(--pass); }
.dotReject { background: var(--reject); }
.dotMarginal { background: var(--marginal); }
.dotIdle { background: var(--text-ghost); }

.label { flex: 1; }

.meta {
  font-family: var(--font-mono);
  font-weight: 400;
  font-size: 10px;
  color: var(--text-fainter);
}

.spacer { flex: 1; }

.site { border-top: 1px solid var(--border-subtle); padding: 12px 8px 2px; }

.siteName {
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--text-primary);
}

.siteMeta {
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--text-dimmer);
}

.warnRow {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 1.4;
  color: var(--marginal);
}

.warnDot { width: 5px; height: 5px; border-radius: 50%; margin-top: 5px; flex: 0 0 5px; background: var(--marginal); }
```

`web/src/shell/Sidebar.tsx`:

```tsx
import type { SiteProfile } from '../api/schemas'
import { verdictTone, type Verdict } from '../api/verdict'
import styles from './Sidebar.module.css'

interface Props {
  site: SiteProfile | null
  verdict: Verdict | null
}

const TONE_CLASS = {
  pass: styles.dotPass,
  reject: styles.dotReject,
  marginal: styles.dotMarginal,
} as const

export function Sidebar({ site, verdict }: Props) {
  const profile = site?.profile
  const tone = verdict ? TONE_CLASS[verdictTone(verdict)] : styles.dotIdle

  return (
    <nav className={styles.rail}>
      <div className={styles.eyebrow}>Session</div>

      <button className={`${styles.nav} ${styles.navActive}`}>
        <span className={`${styles.dot} ${tone}`} />
        <span className={styles.label}>Tonight's plan</span>
        <span className={styles.meta}>{verdict ?? '—'}</span>
      </button>

      {[
        ['Live session', 'slice 3'],
        ['Review & QA', 'slice 4'],
        ['Projects', 'slice 2'],
      ].map(([label, meta]) => (
        <button key={label} className={styles.nav} disabled>
          <span className={`${styles.dot} ${styles.dotIdle}`} />
          <span className={styles.label}>{label}</span>
          <span className={styles.meta}>{meta}</span>
        </button>
      ))}

      <div className={styles.spacer} />

      {profile && (
        <div className={styles.site}>
          <div className={styles.eyebrow}>Site profile</div>
          <div className={styles.siteName}>{profile.name}</div>
          <div className={styles.siteMeta}>
            {profile.lat_deg.toFixed(3)} N · {Math.abs(profile.lon_deg).toFixed(3)} W
          </div>
          <div className={styles.siteMeta}>
            Bortle {profile.bortle ?? '—'} · floor {profile.min_altitude_deg}° · ceiling{' '}
            {profile.field_rotation_ceiling_deg}°
          </div>
          <div className={styles.siteMeta}>
            mask {profile.horizon_mask.length > 0
              ? `on (${profile.horizon_mask.length} arcs)`
              : 'off'}
          </div>
        </div>
      )}
    </nav>
  )
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd web && npm test -- Sidebar`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add web/src/shell/Sidebar.tsx web/src/shell/Sidebar.module.css web/src/shell/Sidebar.test.tsx
git commit -m "feat(web): sidebar reading site geometry from the profile, never constants"
```

---

## Task 11: Verdict banner

**Files:**
- Create: `web/src/screens/tonight/VerdictBanner.tsx`, `.module.css`, `.test.tsx`

**Interfaces:**
- Consumes: `Conditions` (Task 6), `verdictFor`/`verdictTone` (Task 7)
- Produces: `<VerdictBanner conditions={Conditions} />`

**Spec** (§ Verdict banner): card with a `4px` full-height left spine in the verdict colour; inner padding `20px 22px`, `gap: 26px`, centered items. Verdict word Sans 600/38px, with `verdict` beneath in Mono 400/10px/`text/faint`. A `1px` vertical divider, `align-self: stretch`. Prose Sans 400/14.5px/`text/body`. Right: four stats in a `repeat(4,auto)` grid, `gap: 0 26px` — micro-label Mono 400/9.5px/`.08em`/`text/faint` above, Mono 500/17px value below.

**Absent data:** the design's PRECIP tile has no server field (hand-back item 3). Render the label with an em-dash value in `--text-ghost` and a `title` explaining why. Do **not** parse the percentage out of `reasons[]`.

**On NO-GO,** `reasons[]` is the actionable content — promote it into the banner body rather than the design's single prose line, which assumed a GO night.

- [ ] **Step 1: Write the failing test**

`web/src/screens/tonight/VerdictBanner.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VerdictBanner } from './VerdictBanner'
import { ConditionsSchema } from '../../api/schemas'
import { goConditions, recordedConditions, unknownConditions } from '../../test/fixtures'

const recorded = ConditionsSchema.parse(recordedConditions())
const go = ConditionsSchema.parse(goConditions())
const unknown = ConditionsSchema.parse(unknownConditions())

describe('VerdictBanner', () => {
  it('renders the real recorded night as NO-GO', () => {
    render(<VerdictBanner conditions={recorded} />)
    expect(screen.getByText('NO-GO')).toBeInTheDocument()
  })

  it('lists every server reason on a NO-GO', () => {
    render(<VerdictBanner conditions={recorded} />)
    for (const reason of recorded.reasons) {
      expect(screen.getByText(reason)).toBeInTheDocument()
    }
  })

  it('renders GO and UNKNOWN from their fixtures', () => {
    const { unmount } = render(<VerdictBanner conditions={go} />)
    expect(screen.getByText('GO')).toBeInTheDocument()
    unmount()
    render(<VerdictBanner conditions={unknown} />)
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument()
  })

  it('shows cloud, moon and dew from real fields', () => {
    render(<VerdictBanner conditions={recorded} />)
    expect(screen.getByText('99%')).toBeInTheDocument()   // cloud_cover_pct
    expect(screen.getByText('98%')).toBeInTheDocument()   // moon_illum_frac
    expect(screen.getByText('high')).toBeInTheDocument()  // dew_risk
  })

  it('shows precipitation as absent, never a fabricated number', () => {
    render(<VerdictBanner conditions={recorded} />)
    const precip = screen.getByTestId('stat-precip')
    expect(precip).toHaveTextContent('—')
    expect(precip).not.toHaveTextContent('%')
  })

  it('renders null-valued stats as em-dashes on the UNKNOWN fixture', () => {
    render(<VerdictBanner conditions={unknown} />)
    expect(screen.getByTestId('stat-cloud')).toHaveTextContent('—')
  })

  it('never shows MOON 0% on a weather outage', () => {
    // _unknown() zeroes moon_illum_frac rather than nulling it, so a naive
    // render reports a 0% moon that was never measured.
    render(<VerdictBanner conditions={unknown} />)
    const moon = screen.getByTestId('stat-moon')
    expect(moon).toHaveTextContent('—')
    expect(moon).not.toHaveTextContent('0%')
  })

  it('shows the honest "unknown" dew string rather than blanking it', () => {
    render(<VerdictBanner conditions={unknown} />)
    expect(screen.getByTestId('stat-dew')).toHaveTextContent('unknown')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd web && npm test -- VerdictBanner`
Expected: FAIL — cannot resolve `./VerdictBanner`

- [ ] **Step 3: Implement**

`web/src/screens/tonight/VerdictBanner.module.css`:

```css
.card {
  display: flex;
  align-items: center;
  gap: 26px;
  position: relative;
  padding: 20px 22px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  overflow: hidden;
}

.spine { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; }
.spinePass { background: var(--pass); }
.spineReject { background: var(--reject); }
.spineMarginal { background: var(--marginal); }

.word { font-family: var(--font-sans); font-weight: 600; font-size: 38px; line-height: 1; letter-spacing: -0.02em; }
.wordPass { color: var(--pass); }
.wordReject { color: var(--reject); }
.wordMarginal { color: var(--marginal); }

.caption { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); margin-top: 6px; }

.divider { width: 1px; align-self: stretch; background: var(--border-subtle); }

.body { flex: 1; }

.reasons { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }

.reason {
  font-family: var(--font-sans);
  font-size: 14.5px;
  line-height: 1.5;
  color: var(--text-body);
}

.warning {
  margin-top: 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--marginal);
}

/* The handoff specifies `repeat(4,auto)` with `gap: 0 26px`. A flex row of
   label/value columns is visually identical and avoids relying on grid
   auto-placement to interleave eight children into two rows correctly. */
.stats { display: flex; gap: 26px; }
.stat { display: flex; flex-direction: column; }

.statLabel {
  font-family: var(--font-mono);
  font-size: 9.5px;
  line-height: 1;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}

.statValue { font-family: var(--font-mono); font-weight: 500; font-size: 17px; line-height: 1; margin-top: 7px; }
.statAbsent { color: var(--text-ghost); }
.statPass { color: var(--pass); }
```

`web/src/screens/tonight/VerdictBanner.tsx`:

```tsx
import type { Conditions } from '../../api/schemas'
import { verdictFor, verdictTone } from '../../api/verdict'
import styles from './VerdictBanner.module.css'

const SPINE = { pass: styles.spinePass, reject: styles.spineReject, marginal: styles.spineMarginal } as const
const WORD = { pass: styles.wordPass, reject: styles.wordReject, marginal: styles.wordMarginal } as const

const pct = (fraction: number) => `${Math.round(fraction * 100)}%`

function Stat({ id, label, value, tone }: {
  id: string
  label: string
  value: string | null
  tone?: 'pass'
}) {
  const absent = value === null
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div
        data-testid={`stat-${id}`}
        className={`${styles.statValue} ${absent ? styles.statAbsent : ''} ${
          tone === 'pass' && !absent ? styles.statPass : ''
        }`}
        title={absent ? 'not returned by assess_conditions — see handback item 3' : undefined}
      >
        {value ?? '—'}
      </div>
    </div>
  )
}

export function VerdictBanner({ conditions }: { conditions: Conditions }) {
  const verdict = verdictFor(conditions.go)
  const tone = verdictTone(verdict)
  // On a weather outage the server's _unknown() fallback zeroes moon_illum_frac
  // rather than nulling it (weather.py:166). Rendering "MOON 0%" there would be
  // a fabricated measurement, so UNKNOWN forces it absent. dew_risk needs no
  // such guard — the server sets the honest string "unknown".
  const unknown = verdict === 'UNKNOWN'

  return (
    <section className={styles.card}>
      <div className={`${styles.spine} ${SPINE[tone]}`} />
      <div>
        <div className={`${styles.word} ${WORD[tone]}`}>{verdict}</div>
        <div className={styles.caption}>verdict</div>
      </div>
      <div className={styles.divider} />
      <div className={styles.body}>
        <ul className={styles.reasons}>
          {conditions.reasons.map((reason) => (
            <li key={reason} className={styles.reason}>{reason}</li>
          ))}
        </ul>
        {conditions.location.warning && (
          <div className={styles.warning}>{conditions.location.warning}</div>
        )}
      </div>
      <div className={styles.stats}>
        <Stat id="cloud" label="CLOUD"
          value={conditions.cloud_cover_pct === null ? null : `${Math.round(conditions.cloud_cover_pct)}%`} />
        {/* Precipitation is scored on server-side and gates `go`, but is not a
            returned field — it appears only as prose inside reasons[]. Parsing
            it out would put server logic in the UI. See handback item 3. */}
        <Stat id="precip" label="PRECIP" value={null} />
        <Stat id="moon" label="MOON"
          value={unknown ? null : pct(conditions.moon_illum_frac)} />
        <Stat id="dew" label="DEW" value={conditions.dew_risk}
          tone={conditions.dew_risk === 'low' ? 'pass' : undefined} />
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd web && npm test -- VerdictBanner`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add web/src/screens/tonight/VerdictBanner*
git commit -m "feat(web): verdict banner with reasons promoted and precip shown absent"
```

---

## Task 12: Sweet-band timeline

**Files:**
- Create: `web/src/screens/tonight/timeline.ts`, `timeline.test.ts`, `SweetBandTimeline.tsx`, `.module.css`, `.test.tsx`

**Interfaces:**
- Consumes: `Conditions`, `PlanTarget` (Task 6)
- Produces: `buildScale(darkWindow: [string, string]): Scale`, `spanToPercent(scale, [string, string]): {left: number; width: number}`, `<SweetBandTimeline conditions plan />`

**Why a computed scale:** the handoff hardcodes a 19:00→05:00 local, 600-minute axis. Real dark windows move with the season — the recorded night is `19:49–03:54 UTC`. The axis must derive from `dark_window_utc`, padded one hour each side and rounded outward to the hour, or the bars will not fit the strip.

**Absent data:** the grey above-floor rail (`chart/rail`) needs an above-floor span the server does not return (hand-back item 2). Omit both the rail **and** its legend entry, so the legend never describes something absent.

- [ ] **Step 1: Write the failing scale test**

`web/src/screens/tonight/timeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildScale, spanToPercent } from './timeline'

describe('timeline scale', () => {
  const scale = buildScale(['2026-09-24T19:49:29.005', '2026-09-25T03:54:29.005'])

  it('pads an hour each side and rounds outward to the hour', () => {
    expect(scale.startMs).toBe(Date.parse('2026-09-24T18:00:00Z'))
    expect(scale.endMs).toBe(Date.parse('2026-09-25T05:00:00Z'))
  })

  it('places the dark window inside the padded axis', () => {
    const { left, width } = spanToPercent(scale, [
      '2026-09-24T19:49:29.005',
      '2026-09-25T03:54:29.005',
    ])
    expect(left).toBeGreaterThan(0)
    expect(left + width).toBeLessThan(100)
  })

  it('clamps a span that runs past the axis', () => {
    const { left, width } = spanToPercent(scale, [
      '2026-07-28T00:00:00.000',
      '2026-07-28T12:00:00.000',
    ])
    expect(left).toBe(0)
    expect(width).toBe(100)
  })

  it('produces one hourly tick per hour of the axis', () => {
    expect(scale.ticks).toHaveLength(12) // 18:00 through 05:00 inclusive, across midnight
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd web && npm test -- timeline`
Expected: FAIL — cannot resolve `./timeline`

- [ ] **Step 3: Implement the scale**

`web/src/screens/tonight/timeline.ts`:

```ts
/**
 * The handoff pins the timeline to a 19:00→05:00 local, 600-minute axis. That
 * only works for the night it was drawn: real dark windows move with the season
 * (the recorded night is 19:49–03:54 UTC). The axis is therefore derived from
 * dark_window_utc — padded an hour each side, rounded outward to the hour.
 */
const HOUR_MS = 3_600_000

export interface Scale {
  startMs: number
  endMs: number
  ticks: number[]
}

const parse = (iso: string): number =>
  Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`)

export function buildScale([darkStart, darkEnd]: [string, string]): Scale {
  const startMs = Math.floor((parse(darkStart) - HOUR_MS) / HOUR_MS) * HOUR_MS
  const endMs = Math.ceil((parse(darkEnd) + HOUR_MS) / HOUR_MS) * HOUR_MS
  const ticks: number[] = []
  for (let t = startMs; t <= endMs; t += HOUR_MS) ticks.push(t)
  return { startMs, endMs, ticks }
}

export function spanToPercent(
  scale: Scale,
  [from, to]: [string, string],
): { left: number; width: number } {
  const total = scale.endMs - scale.startMs
  const clamp = (value: number) => Math.min(100, Math.max(0, value))
  const left = clamp(((parse(from) - scale.startMs) / total) * 100)
  const right = clamp(((parse(to) - scale.startMs) / total) * 100)
  return { left, width: Math.max(0, right - left) }
}

/** Local wall-clock HH:MM. The handoff labels these "local"; the browser's zone
 *  is used, which matches the site only when the user is at the site. */
export const localHhMm = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
```

- [ ] **Step 4: Run the scale tests and confirm they pass**

Run: `cd web && npm test -- timeline`
Expected: PASS — 4 tests

- [ ] **Step 5: Write the failing component test**

`web/src/screens/tonight/SweetBandTimeline.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SweetBandTimeline } from './SweetBandTimeline'
import { ConditionsSchema, PlanTargetsSchema } from '../../api/schemas'
import { recordedConditions, recordedPlan } from '../../test/fixtures'

const conditions = ConditionsSchema.parse(recordedConditions())
const plan = PlanTargetsSchema.parse(recordedPlan())

describe('SweetBandTimeline', () => {
  it('renders one lane per ranked target', () => {
    render(<SweetBandTimeline conditions={conditions} targets={plan.targets} />)
    for (const target of plan.targets) {
      expect(screen.getByText(target.id)).toBeInTheDocument()
    }
  })

  it('labels each sweet band with its duration in minutes', () => {
    render(<SweetBandTimeline conditions={conditions} targets={plan.targets} />)
    expect(screen.getByText(`${Math.round(plan.targets[0].sweet_band_min)} min`)).toBeInTheDocument()
  })

  it('omits the above-floor rail and its legend entry', () => {
    const { container } = render(
      <SweetBandTimeline conditions={conditions} targets={plan.targets} />,
    )
    expect(container.querySelectorAll('[data-rail]')).toHaveLength(0)
    expect(screen.queryByText(/above floor/i)).not.toBeInTheDocument()
  })

  it('positions every sweet band within the axis', () => {
    const { container } = render(
      <SweetBandTimeline conditions={conditions} targets={plan.targets} />,
    )
    for (const band of container.querySelectorAll<HTMLElement>('[data-band]')) {
      expect(parseFloat(band.style.left)).toBeGreaterThanOrEqual(0)
      expect(parseFloat(band.style.left) + parseFloat(band.style.width)).toBeLessThanOrEqual(100.01)
    }
  })
})
```

- [ ] **Step 6: Implement the component**

`web/src/screens/tonight/SweetBandTimeline.module.css`:

```css
.card { padding: 18px 20px 14px; background: var(--bg-card); border: 1px solid var(--border-default); border-radius: var(--radius-card); }
.head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
.eyebrow { font-family: var(--font-mono); font-weight: 500; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-fainter); }
.legend { display: flex; align-items: center; gap: 7px; font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
.swatch { width: 16px; height: 3px; background: var(--accent); }

.strip {
  position: relative;
  height: 14px;
  border-radius: 3px;
  background: var(--twilight-strip);
}

.bracket { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--chart-rail-empty); border-right: 1px solid var(--chart-rail-empty); }
.bracketLabels { position: relative; height: 14px; font-family: var(--font-mono); font-size: 9.5px; color: var(--text-dimmer); }
.bracketLabel { position: absolute; top: 0; }
.bracketLabelEnd { transform: translateX(-100%); }

.lane { display: flex; align-items: center; gap: 12px; padding: 5px 0; }
.laneName { width: 74px; font-family: var(--font-sans); font-weight: 500; font-size: 12px; color: var(--text-secondary); }
.laneTrack { position: relative; flex: 1; height: 20px; border-radius: 4px; background: var(--bg-track-alt); }
.laneWindow { width: 78px; text-align: right; font-family: var(--font-mono); font-size: 10.5px; color: var(--text-dimmer); }

.band {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 4px;
  background: var(--accent);
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 10px;
  color: var(--accent-on-accent-alt);
  white-space: nowrap;
  overflow: hidden;
}

.axis { display: flex; justify-content: space-between; padding: 8px 86px 0; font-family: var(--font-mono); font-size: 9.5px; color: var(--text-ghost); }
```

`web/src/screens/tonight/SweetBandTimeline.tsx`:

```tsx
import type { Conditions, PlanTarget } from '../../api/schemas'
import styles from './SweetBandTimeline.module.css'
import { buildScale, localHhMm, spanToPercent } from './timeline'

interface Props {
  conditions: Conditions
  targets: PlanTarget[]
}

/**
 * The sweet band is the core idea of the product: on an alt-az mount, usable
 * integration is only the span between the altitude floor and the field-rotation
 * ceiling — not the whole time a target is up.
 *
 * The handoff contrasts that accent bar against a grey "above floor" rail. The
 * server returns only dark_minutes_above_floor — an integrated duration with no
 * start/end — so the rail and its legend entry are both omitted rather than
 * faked. See docs/handback-to-seestar-ai.md item 2.
 */
export function SweetBandTimeline({ conditions, targets }: Props) {
  const scale = buildScale(conditions.dark_window_utc)
  const dark = spanToPercent(scale, conditions.dark_window_utc)

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>Tonight · sweet-band windows</span>
        <span className={styles.legend}>
          <span className={styles.swatch} /> sweet band
        </span>
      </div>

      <div className={styles.bracketLabels}>
        <span className={styles.bracketLabel} style={{ left: `${dark.left}%` }}>
          {localHhMm(Date.parse(`${conditions.dark_window_utc[0]}Z`))} dark
        </span>
        <span
          className={`${styles.bracketLabel} ${styles.bracketLabelEnd}`}
          style={{ left: `${dark.left + dark.width}%` }}
        >
          {localHhMm(Date.parse(`${conditions.dark_window_utc[1]}Z`))} dawn
        </span>
      </div>

      <div className={styles.strip}>
        <div className={styles.bracket} style={{ left: `${dark.left}%`, width: `${dark.width}%` }} />
      </div>

      {targets.map((target) => {
        const band = spanToPercent(scale, target.best_window_utc)
        const [from, to] = target.best_window_utc
        return (
          <div key={target.id} className={styles.lane}>
            <span className={styles.laneName}>{target.id}</span>
            <div className={styles.laneTrack}>
              <div
                data-band
                className={styles.band}
                style={{ left: `${band.left}%`, width: `${band.width}%` }}
              >
                {Math.round(target.sweet_band_min)} min
              </div>
            </div>
            <span className={styles.laneWindow}>
              {localHhMm(Date.parse(`${from}Z`))}–{localHhMm(Date.parse(`${to}Z`))}
            </span>
          </div>
        )
      })}

      <div className={styles.axis}>
        {scale.ticks.map((tick) => (
          <span key={tick}>{localHhMm(tick).slice(0, 2)}</span>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 7: Run and confirm it passes**

Run: `cd web && npm test -- SweetBandTimeline timeline`
Expected: PASS — 8 tests

- [ ] **Step 8: Commit**

```bash
git add web/src/screens/tonight/timeline* web/src/screens/tonight/SweetBandTimeline*
git commit -m "feat(web): sweet-band timeline on a scale derived from the real dark window"
```

---

## Task 13: Plan cards, screen assembly and wiring

**Files:**
- Create: `web/src/screens/tonight/PlanCard.tsx`, `.module.css`, `.test.tsx`, `web/src/screens/tonight/TonightScreen.tsx`, `.module.css`, `.test.tsx`, `web/src/shell/AppShell.tsx`, `.module.css`
- Modify: `web/src/App.tsx`, `web/src/main.tsx`

**Interfaces:**
- Consumes: everything from Tasks 6–12
- Produces: `<PlanCard target={PlanTarget} />`, `<TonightScreen />`, `<AppShell>`

**Spec** (§ Ranked shortlist): `repeat(3, 1fr)` grid, `gap: 14px`. Each card is a column flex with bordered bands — head (`14px 15px`, `gap: 14px`), two-up stats (`1fr 1fr`, `1px` internal divider), reasons (`flex: 1`), actions (`12px 15px`, `gap: 8px`). Target ID Sans 600/16px nowrap; score Mono 500/18px `--accent` beside the word `score` Mono 400/9.5px `--text-faint`; common name Sans 400/11.5px `--text-dimmer`.

**Absent data in this card:** the `64 × 88` thumbnail (hand-back 8) and the filter chip (hand-back 5) have no source. Omit the thumbnail and collapse its space; render only the neutral type chip. The `Hand to run-session` button is disabled with a title pointing at slice 3, because motion requires an approval gate that does not exist yet.

**Reason curation:** the ranker's first reason duplicates `best_window_utc` verbatim (`"best window 2026-09-24T19:49:29.757–… UTC"`). It is already shown as the window label, so drop reasons starting with `best window ` — a display concern, not a data transform.

- [ ] **Step 1: Write the failing PlanCard test**

`web/src/screens/tonight/PlanCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlanCard } from './PlanCard'
import { PlanTargetsSchema } from '../../api/schemas'
import { recordedPlan } from '../../test/fixtures'

const [target] = PlanTargetsSchema.parse(recordedPlan()).targets

describe('PlanCard', () => {
  it('shows the id, name and score', () => {
    render(<PlanCard target={target} />)
    expect(screen.getByText(target.id)).toBeInTheDocument()
    expect(screen.getByText(target.name)).toBeInTheDocument()
    expect(screen.getByText(String(target.score))).toBeInTheDocument()
  })

  it('drops the reason that merely repeats the window', () => {
    render(<PlanCard target={target} />)
    expect(screen.queryByText(/^best window /)).not.toBeInTheDocument()
    expect(screen.getByText(/sweet-band time/)).toBeInTheDocument()
  })

  it('renders no thumbnail and no filter chip, since neither has a source', () => {
    const { container } = render(<PlanCard target={target} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByText(/^LP /)).not.toBeInTheDocument()
    expect(screen.getByText(target.type)).toBeInTheDocument()
  })

  it('disables the hand-off action until the approval gate exists', () => {
    render(<PlanCard target={target} />)
    expect(screen.getByRole('button', { name: /Hand to run-session/ })).toBeDisabled()
  })

  it('shows recommended subs and exposure', () => {
    render(<PlanCard target={target} />)
    expect(
      screen.getByText(`${target.recommended_subs} × ${target.recommended_exposure_s} s`),
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd web && npm test -- PlanCard`
Expected: FAIL — cannot resolve `./PlanCard`

- [ ] **Step 3: Implement PlanCard**

`web/src/screens/tonight/PlanCard.module.css`:

```css
.card { display: flex; flex-direction: column; background: var(--bg-card); border: 1px solid var(--border-default); border-radius: var(--radius-card); overflow: hidden; }
.head { padding: 14px 15px; border-bottom: 1px solid var(--border-subtle); }
.titleRow { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.id { font-family: var(--font-sans); font-weight: 600; font-size: 16px; white-space: nowrap; color: var(--text-primary); }
.scoreWrap { display: flex; align-items: baseline; gap: 5px; }
.score { font-family: var(--font-mono); font-weight: 500; font-size: 18px; line-height: 1; color: var(--accent); }
.scoreLabel { font-family: var(--font-mono); font-size: 9.5px; color: var(--text-faint); }
.name { margin-top: 4px; font-family: var(--font-sans); font-size: 11.5px; color: var(--text-dimmer); }
.chips { display: flex; gap: 6px; margin-top: 9px; }
.chip { padding: 3px 7px; border: 1px solid var(--border-default); border-radius: var(--radius-chip); font-family: var(--font-mono); font-size: 9.5px; color: var(--text-dimmer); }

.stats { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--border-subtle); }
.stat { padding: 11px 15px; }
.stat + .stat { border-left: 1px solid var(--border-subtle); }
.statLabel { font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.08em; color: var(--text-faint); }
.statValue { margin-top: 6px; font-family: var(--font-mono); font-weight: 500; font-size: 13px; color: var(--text-primary); }

.reasons { flex: 1; padding: 12px 15px; border-bottom: 1px solid var(--border-subtle); }
.reasonList { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.reasonRow { display: flex; gap: 8px; font-family: var(--font-sans); font-size: 11.5px; line-height: 1.45; color: var(--text-muted); }
.plus { color: var(--accent); }

.actions { display: flex; gap: 8px; padding: 12px 15px; }
.primary { flex: 1; padding: 9px 13px; border: 0; border-radius: var(--radius-control); background: var(--accent); color: var(--accent-on-accent); font-family: var(--font-sans); font-weight: 500; font-size: 12px; white-space: nowrap; cursor: pointer; }
.primary:disabled { opacity: 0.45; cursor: default; }
.secondary { padding: 9px 13px; border: 1px solid var(--border-control); border-radius: var(--radius-control); background: transparent; color: var(--text-muted); font-family: var(--font-sans); font-weight: 500; font-size: 12px; cursor: pointer; }
```

`web/src/screens/tonight/PlanCard.tsx`:

```tsx
import type { PlanTarget } from '../../api/schemas'
import { localHhMm } from './timeline'
import styles from './PlanCard.module.css'

/**
 * The reason tags are the point of the screen — a bare score is not trustworthy,
 * so the ranker shows its work. These strings come from ranker.py, not from the
 * client.
 *
 * Two elements of the handoff card are absent by design: the thumbnail (no tool
 * returns imagery, handback 8) and the LP filter chip (lp_fit is computed
 * server-side but not returned, handback 5). Neither is faked.
 */
export function PlanCard({ target }: { target: PlanTarget }) {
  const [from, to] = target.best_window_utc
  const reasons = target.reasons.filter((r) => !r.startsWith('best window '))

  return (
    <article className={styles.card}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <span className={styles.id}>{target.id}</span>
          <span className={styles.scoreWrap}>
            <span className={styles.score}>{target.score}</span>
            <span className={styles.scoreLabel}>score</span>
          </span>
        </div>
        <div className={styles.name}>{target.name}</div>
        <div className={styles.chips}>
          <span className={styles.chip}>{target.type}</span>
        </div>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>BEST WINDOW</div>
          <div className={styles.statValue}>
            {localHhMm(Date.parse(`${from}Z`))}–{localHhMm(Date.parse(`${to}Z`))}
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>RECOMMENDED</div>
          <div className={styles.statValue}>
            {target.recommended_subs} × {target.recommended_exposure_s} s
          </div>
        </div>
      </div>

      <div className={styles.reasons}>
        <div className={styles.statLabel}>WHY — REASON TAGS</div>
        <ul className={styles.reasonList}>
          {reasons.map((reason) => (
            <li key={reason} className={styles.reasonRow}>
              <span className={styles.plus}>+</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.primary}
          disabled
          title="Motion requires the approval gate — slice 3"
        >
          Hand to run-session
        </button>
        <button className={styles.secondary}>Detail</button>
      </div>
    </article>
  )
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd web && npm test -- PlanCard`
Expected: PASS — 7 tests

- [ ] **Step 5: Write the failing screen test**

`web/src/screens/tonight/TonightScreen.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TonightScreen } from './TonightScreen'
import { recordedConditions, recordedPlan, recordedSite } from '../../test/fixtures'

function stubApi(overrides: Record<string, unknown> = {}) {
  const bodies: Record<string, unknown> = {
    '/api/assess_conditions': recordedConditions(),
    '/api/plan_targets?limit=3': recordedPlan(),
    '/api/get_site_profile': recordedSite(),
    '/api/health': { ok: true, replay: false },
    ...overrides,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => bodies[url] })),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('TonightScreen', () => {
  it('shows a loading state first', () => {
    stubApi()
    render(<TonightScreen />)
    expect(screen.getByTestId('tonight-loading')).toBeInTheDocument()
  })

  it('renders the verdict, timeline and cards once loaded', async () => {
    stubApi()
    render(<TonightScreen />)
    await waitFor(() => expect(screen.getByText('NO-GO')).toBeInTheDocument())
    expect(screen.getByText('M76')).toBeInTheDocument()
    expect(screen.getByText(/sweet-band windows/i)).toBeInTheDocument()
  })

  it('shows an error banner when the sidecar is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    render(<TonightScreen />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/unreachable/i)
  })
})
```

- [ ] **Step 6: Implement the screen and shell**

`web/src/screens/tonight/TonightScreen.module.css`:

```css
.screen { display: flex; flex-direction: column; gap: 14px; }
.header { display: flex; align-items: baseline; justify-content: space-between; }
.eyebrow { font-family: var(--font-mono); font-weight: 500; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-fainter); }
.heading { margin: 4px 0 0; font-family: var(--font-sans); font-weight: 600; font-size: 19px; line-height: 1.2; letter-spacing: -0.01em; color: var(--text-primary); }
.source { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.skeleton { height: 96px; border-radius: var(--radius-card); background: var(--bg-card-sunken); border: 1px solid var(--border-quiet); }
.error { padding: 14px 16px; border: 1px solid var(--reject-btn-border); border-radius: var(--radius-card); background: var(--reject-btn-bg); color: var(--reject); font-family: var(--font-sans); font-size: 13px; }
.empty { padding: 16px; border: 1px solid var(--border-quiet); border-radius: var(--radius-card); background: var(--bg-card-sunken); color: var(--text-dimmer); font-family: var(--font-sans); font-size: 12.5px; }
```

`web/src/screens/tonight/TonightScreen.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { fetchConditions, fetchHealth, fetchPlan, fetchSite } from '../../api/client'
import type { Conditions, Health, PlanTargets, SiteProfile } from '../../api/schemas'
import { verdictFor } from '../../api/verdict'
import { Sidebar } from '../../shell/Sidebar'
import { TopBar } from '../../shell/TopBar'
import { AppShell } from '../../shell/AppShell'
import { PlanCard } from './PlanCard'
import { SweetBandTimeline } from './SweetBandTimeline'
import { VerdictBanner } from './VerdictBanner'
import styles from './TonightScreen.module.css'

interface Data {
  conditions: Conditions
  plan: PlanTargets
  site: SiteProfile
  health: Health
}

export function TonightScreen() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchConditions(), fetchPlan(3), fetchSite(), fetchHealth()])
      .then(([conditions, plan, site, health]) => {
        if (!cancelled) setData({ conditions, plan, site, health })
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const verdict = data ? verdictFor(data.conditions.go) : null

  return (
    <AppShell
      topBar={<TopBar site={data?.site ?? null} replay={data?.health.replay ?? false} />}
      sidebar={<Sidebar site={data?.site ?? null} verdict={verdict} />}
    >
      <div className={styles.screen}>
        <div className={styles.header}>
          <div>
            <div className={styles.eyebrow}>Observing planner · assess_conditions</div>
            <h1 className={styles.heading}>
              {new Date().toLocaleDateString([], {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              })}
            </h1>
          </div>
          {data && <div className={styles.source}>source: {data.conditions.source}</div>}
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        {!data && !error && (
          <div data-testid="tonight-loading">
            <div className={styles.skeleton} />
          </div>
        )}

        {data && (
          <>
            <VerdictBanner conditions={data.conditions} />
            {data.plan.targets.length > 0 ? (
              <>
                <SweetBandTimeline
                  conditions={data.conditions}
                  targets={data.plan.targets}
                />
                <div className={styles.grid}>
                  {data.plan.targets.map((target) => (
                    <PlanCard key={target.id} target={target} />
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.empty}>
                No target clears the sweet band tonight. The ranker drops targets with
                zero clean sweet-band time; it does not report which — see
                docs/handback-to-seestar-ai.md item 4.
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
```

`web/src/shell/AppShell.module.css`:

```css
.root { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.body { display: flex; flex: 1; min-height: 0; }
.content { flex: 1; overflow-y: auto; padding: 22px 24px 40px; }
```

`web/src/shell/AppShell.tsx`:

```tsx
import type { ReactNode } from 'react'
import styles from './AppShell.module.css'

interface Props {
  topBar: ReactNode
  sidebar: ReactNode
  children: ReactNode
}

/** Only the content column scrolls. */
export function AppShell({ topBar, sidebar, children }: Props) {
  return (
    <div className={styles.root}>
      {topBar}
      <div className={styles.body}>
        {sidebar}
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  )
}
```

`web/src/App.tsx`:

```tsx
import { TonightScreen } from './screens/tonight/TonightScreen'

export default function App() {
  return <TonightScreen />
}
```

- [ ] **Step 7: Run the full suite**

Run: `cd web && npm test`
Expected: PASS — all tests from Tasks 5–13

- [ ] **Step 8: Verify end-to-end against the real server**

Terminal 1: `cd sidecar && uv run uvicorn seestar_sidecar.main:create_app --factory --port 8000`
Terminal 2: `cd web && npm run dev`

Open `http://localhost:5173`. Expected: NO-GO banner with the five real reasons, the GPS-unverified warning, the sweet-band timeline with three lanes, and three plan cards. Confirm no green connection dot, no precip percentage, and no thumbnail placeholder box.

- [ ] **Step 9: Commit**

```bash
git add web/
git commit -m "feat(web): Tonight screen wired end-to-end through the sidecar"
```

---

## Self-Review

**Spec coverage.** §4 architecture → Tasks 1–13. §5.1 allowlist → Task 1. §5.2 replay → Task 4. §5.3 error shape → Tasks 4, 8. §6 verdict mapping → Task 7. §7.1 tokens → Task 5. §7.2 real states: NO-GO → Task 11; UNKNOWN → Tasks 7, 11; GPS-unverified → Tasks 10, 11; empty mask → Task 10; absent fields → Tasks 11, 12, 13; above-floor rail omitted → Task 12; loading → Task 13; sidecar unreachable → Task 13. §8 gate → Tasks 1, 2, 4, 5, 6. §9 hand-back doc → already written and committed.

**One gap found and accepted:** the spec's §7.2 lists the *excluded-by-ranker* card. Since the server returns no excluded targets at all (hand-back 4), there is nothing to render — Task 13 covers the related empty-shortlist case with a message naming the hand-back item, and no dedicated component is built. Building an empty card that can never populate would be worse than omitting it.

**Placeholder scan:** no TBD/TODO. Every code step carries runnable content. Task 5 Step 4 names all 52 tokens explicitly rather than abbreviating.

**Type consistency:** `verdictTone` is named identically in Task 7's interface block, its implementation, and its consumers in Tasks 10 and 11. `McpConnection.call`, `load_fixture`, `buildScale`/`spanToPercent`/`localHhMm`, and the three `fetch*` client functions match across every task that consumes them.

---

## Known risks

1. **Task 2 payload extraction** — whether the MCP SDK surfaces the tool dict in `content[0].text` or `structuredContent` for a `-> dict` FastMCP tool. Pinned by the stub test in Step 3; fix `_extract_payload` if it fails, not the test.
2. **Timezone** — `localHhMm` uses the browser's zone. That matches the site only when the user is at the site. Acceptable for slice 1; revisit if the site profile ever carries a timezone.
3. **Fixture staleness** — `plan_targets` output changes nightly with the sky. The contract test validates *shape*, not values, so this is safe; but `test_recorded_night_is_a_no_go` pins one value deliberately and will need updating if fixtures are re-recorded on a clear night.
