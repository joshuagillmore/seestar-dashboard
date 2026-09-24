# Parking lot

Ideas deliberately deferred: worth doing, not scheduled. Each entry records why it
was parked and what has to be decided before anyone picks it up, so the reasoning
doesn't have to be rediscovered.

## Unify the stack in containers (parked 2026-09-23)

**Today nothing SeeStar-related runs in a container.**
- The dashboard runs on the host: `run.bat` → `uv run seestar-dashboard` serves the
  API and the built web app on `127.0.0.1:8787`.
- The sidecar starts seestar-mcp as child processes over stdio: one for general
  calls, one dedicated to `qa_tier2`.
- The telescope bridge (`seestar_alp`) also runs on the host, on `127.0.0.1:5555`.

SeeStar-AI already has a compose design in `deploy/docker/` that the dashboard has
no place in:
- The `seestar-alp` bridge is a long-lived container on a private `seestar_net`
  network. Alpaca `:5555` stays internal to that network.
- seestar-mcp is an image Claude Code launches per session with `docker run -i`
  over stdio. It is not a standing service.

**Why parked:** it touches both repos, and nothing should change while live hardware
sessions and the v1.2.0 contract merge are in flight.

**Decide before starting:**
1. **How the sidecar reaches seestar-mcp.** Today it spawns it over stdio. The
   cleanest option is one dashboard image that contains both the sidecar and
   seestar-mcp from a pinned checkout, joined to `seestar_net` so it reaches
   `seestar-alp:5555` directly. The alternative, a sidecar that launches
   `docker run -i` from inside a container, is worse.
2. **One projects store, not two.** Host-run seestar-mcp uses `SeeStar-AI/data`,
   while the compose design uses a `seestar-data` volume. If the dashboard's MCP and
   the Claude sessions' MCP read different stores, projects diverge silently.
3. **The live-view share.** The Live screen reads the scope's SMB share. Getting a
   Windows network share into a Docker Desktop container is the fiddliest part.
   The archive folder is an ordinary bind mount.
4. **Bridge location.** If the bridge stays on the host, the container reaches it
   through `host.docker.internal`. The sidecar's Host-header check already allows a
   port published on `127.0.0.1`, and `SEESTAR_ALLOWED_HOSTS` covers anything else
   (see `docs/configuration.md`).

This is joint work: items 1 and 2 need the SeeStar-AI session.
