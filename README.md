# SeeStar Dashboard

A read-only web dashboard for a Seestar S50 telescope. It reads telemetry and
QA results from the `seestar-mcp` tools and presents them — it does not
control the telescope. See `CLAUDE.md` for the full scope and the read-only
discipline this repo follows.

## Run it

The sidecar serves both the API and the built frontend on one port — there is
no separate dev server to run in production.

```
cd web && npm install && npm run build
cd ../sidecar && uv sync
uv run seestar-dashboard
```

Then open **http://localhost:8000**.

On Windows, double-click **`run.bat`** at the repo root instead of typing the
last command — it `cd`s into `sidecar/` and runs the same thing. Drag it to
the desktop (right-click → Send to → Desktop, create shortcut) for a one-click
icon that doesn't require a terminal.

If `web/dist` hasn't been built yet, the sidecar still starts and `/api/*`
still works — `/` serves a plain-text reminder to run `npm run build` instead
of crashing.

### Options

Set these once by copying [`.env.example`](.env.example) to `.env` in the
repo root and filling in what you need — a real environment variable still
overrides `.env` if you set one, but `.env` is what makes the settings
persist across a new terminal, or a double-clicked `run.bat` shortcut with
no terminal at all. Full reference, including what happens when each is
unset and per-OS examples: [`docs/configuration.md`](docs/configuration.md).
Short version:

- **Port:** `uv run seestar-dashboard --port 8080`, or set `SEESTAR_PORT`.
  Port 8000 is intermittently held by Docker Desktop on some machines; if
  it's taken, the launcher prints which port is blocked and exits cleanly
  rather than a stack trace.
- **Offline / no telescope attached:** `SEESTAR_REPLAY=1 uv run seestar-dashboard`
  serves recorded fixtures (`fixtures/*.json`) instead of spawning the MCP
  server, and the UI's top bar shows a "fixtures — not live" indicator.
- **`seestar-mcp` checkout location:** set `SEESTAR_AI_DIR` to it — the
  sidecar spawns `seestar_mcp.server` from there. No personal-machine
  default: unset, the sidecar still boots, but every tool-backed route 502s
  with a message naming the variable until it's set (or you run with
  `SEESTAR_REPLAY=1` instead).
- **Photo archive location:** set `SEESTAR_ARCHIVE_DIR` to your Seestar
  archive directory. No personal-machine default here either: unset, the
  sidecar still boots and serves the store's own data — `/api/projects_combined`
  reports an `archive_status` field so the UI can tell "not configured" apart
  from "configured, but that path doesn't exist" and "configured and
  genuinely empty".

## Development

Two terminals, with live reload on the frontend:

```
cd sidecar && uv run uvicorn seestar_sidecar.main:create_app --factory --port 8000
cd web && npm run dev
```

Vite's dev server (`http://localhost:5173`) proxies `/api/*` to the sidecar
and the sidecar's CORS middleware allows that origin — neither is used once
`npm run build` + the single-process command above are in play.

### Tests

```
cd sidecar && uv run pytest
cd web && npm test && npm run build
```

Both `npm test` and `npm run build` must pass — `noUnusedLocals` means a green
test suite alone doesn't prove the build is clean.

## Repo layout

- `sidecar/` — FastAPI service proxying the MCP server over stdio behind a
  route allowlist (`seestar_sidecar/allowlist.py`). Never add a route for a
  tool with side effects.
- `web/` — React + TypeScript client, one screen so far (Tonight).
- `docs/design/` — the design system and per-screen specs (authority on
  tokens, layout and copy).
- `docs/superpowers/specs/` — approved implementation specs, one per slice.
- `docs/handback-to-seestar-ai.md` — server-side gaps this repo cannot fix
  itself (see the hand-back rule in `CLAUDE.md`).
- `docs/configuration.md` — every environment variable the sidecar reads,
  what happens when it's unset, and examples for Windows/macOS/Linux.

## Licences

IBM Plex Sans and IBM Plex Mono are self-hosted under
`web/public/fonts/` (SIL Open Font License 1.1 — see the `LICENSE.txt` next to
each family's files).
