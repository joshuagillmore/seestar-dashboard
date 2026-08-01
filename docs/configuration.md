# Configuration

The sidecar is entirely configured through environment variables — there is
no config file. This page documents every one of them: what it's for, what
happens when it's unset, and an example for Windows, macOS and Linux.

**None of these have a personal-machine default any more.** Earlier builds of
this repo defaulted `SEESTAR_ARCHIVE_DIR` and `SEESTAR_AI_DIR` to one
developer's own OneDrive/checkout paths, which meant a checkout on any other
machine silently found nothing instead of failing loudly — the empty result
looked identical to "you have no data" rather than "you have not configured
this". Both are unset by default now, and the sidecar reports that as an
honest "not configured" state instead of guessing.

## Setting these variables: `.env`, not just the shell

A real environment variable only lasts for the shell session that exported
it, which doesn't fit either audience this app has: it has to be re-exported
in every new terminal, and the documented Windows launch path is a desktop
shortcut with no shell to have exported anything into in the first place.

The sidecar loads a `.env` file from the repo root at startup
(`sidecar/seestar_sidecar/env.py`), before any of the variables below are
read, using [`python-dotenv`](https://pypi.org/project/python-dotenv/) — a
`.env` parser has more edge cases (quoting, escape sequences, comments) than
are worth re-deriving by hand, and this is a small, dependency-free, widely
used library rather than a novel one.

**Copy [`.env.example`](../.env.example) to `.env` and fill in what you
need.** `.env` is gitignored (never commit your real one — these are paths,
not secrets, but the file is still machine-specific, and it's exactly where
a real secret would end up later if this app ever grows one — see
`CLAUDE.md` for this repo's actual secret-handling convention, age+sops,
which this does not replace).

A real environment variable always wins over `.env` — it's a convenience
for a checkout, never an override of something deliberately set elsewhere
(`load_dotenv(..., override=False)`, python-dotenv's own default).

**Do not wrap a path in quotes in `.env`.** Quoting isn't needed even for a
path containing spaces, and a double-quoted value undergoes escape
processing — `\n` becomes an actual newline, `\t` a tab — which can silently
corrupt a Windows path if a directory name happens to start with one of
those letters right after a backslash (`C:\Users\nick\...` is fine
unquoted; the identical path double-quoted turns `\n` into a line break).
Unquoted values are taken completely literally, backslashes and all.
Prefer forward slashes for every path regardless of OS (`C:/Users/you/...`)
— this project's own code already follows that convention, and it sidesteps
the whole question.

## SEESTAR_ARCHIVE_DIR

Where the Seestar photo archive lives on disk — the directory holding one
`<target>/` (stacked results) and `<target>-sub/` (individual sub-frames)
pair per imaged target. Read by `sidecar/seestar_sidecar/archive.py`.

**Unset:** the sidecar still boots and serves everything that doesn't depend
on the archive — `/api/list_projects`, `/api/plan_targets` without imagery,
etc. `/api/projects_combined` reports the store's data alone and its
`archive_status` field reads `{"configured": false, "path": null, "exists":
false, "target_count": 0}`.

**Set, but the path doesn't exist** (a typo, an unmounted drive, a OneDrive
sync that hasn't run yet): same graceful degrade, but `archive_status` reads
`{"configured": true, "path": "<the path>", "exists": false, "target_count":
0}` — distinguishable from "never configured" so a screen can say "check
this path" instead of "set this up".

**Set, and the path exists but currently holds nothing recognisable:**
`archive_status` reads `{"configured": true, "path": "...", "exists": true,
"target_count": 0}` — "genuinely empty", the third state, distinct from both
of the above.

| OS | Example |
|---|---|
| Windows (PowerShell) | `$env:SEESTAR_ARCHIVE_DIR = "D:\Astro\SeeStar"` |
| Windows (cmd) | `set SEESTAR_ARCHIVE_DIR=D:\Astro\SeeStar` |
| macOS / Linux | `export SEESTAR_ARCHIVE_DIR=/home/you/Astro/SeeStar` |

## SEESTAR_AI_DIR

The path to a local `seestar-mcp` checkout — the sidecar spawns
`uv --directory $SEESTAR_AI_DIR run python -m seestar_mcp.server` as a stdio
subprocess. Read by `sidecar/seestar_sidecar/main.py` (and duplicated in
`sidecar/record.py`, the one-shot fixture-recording script — see its own
docstring for why that's a separate copy, not an import).

**Unset:** the sidecar still boots. No subprocess is spawned at all (rather
than being spawned with a literal `None` directory, which would raise before
ever producing a readable error). Every tool-backed route — everything
except `/api/health` and the sidecar-computed views that only need the
archive/catalogue — returns a 502 naming the missing variable:

```json
{"ok": false, "error": "SEESTAR_AI_DIR is not set, so the sidecar has nowhere to run the seestar-mcp server from. Set it to your seestar-mcp checkout, or run with SEESTAR_REPLAY=1 to serve recorded fixtures instead — see docs/configuration.md."}
```

If you don't have a `seestar-mcp` checkout at all yet, use `SEESTAR_REPLAY=1`
(below) instead — the whole UI works against recorded fixtures with no
telescope, and no `SEESTAR_AI_DIR`, involved.

| OS | Example |
|---|---|
| Windows (PowerShell) | `$env:SEESTAR_AI_DIR = "C:\Users\you\seestar-mcp"` |
| Windows (cmd) | `set SEESTAR_AI_DIR=C:\Users\you\seestar-mcp` |
| macOS / Linux | `export SEESTAR_AI_DIR=/home/you/seestar-mcp` |

## SEESTAR_LIVE_SHARE_DIR

The Seestar's OWN SMB share on the LAN (typically reachable as `\\Seestar\...`
or `\\seestar.local\...` — see `docs/seestar-mcp-design.md`) — where the Live
session screen's preview card reads a live stacked thumbnail or the newest
per-sub thumbnail from. Read by
`sidecar/seestar_sidecar/live_preview.py`.

**This is a DIFFERENT directory from `SEESTAR_ARCHIVE_DIR` above.**
`SEESTAR_ARCHIVE_DIR` is a periodic export (OneDrive, in this build's own
case) — useful for browsing past sessions, but confirmed **not live**: its
newest file was 24 days old with nothing written in the preceding five days.
`SEESTAR_LIVE_SHARE_DIR` should point at the scope's share itself, which is
updated in near-real-time while a session runs. Pointing both variables at
the same path will make the preview card show stale, once-a-session data
without telling you why.

**Only ever polled while a session is confirmed running** (via `get_view_state`
— see `live_preview.py`'s module docstring) and only thumbnails are ever
read — never the full-resolution stacked JPEG (measured ~476 KB) and never a
raw FITS sub (measured ~4 MB). A directory scan is also bounded by a short
timeout (`live_preview.SHARE_SCAN_TIMEOUT_SECONDS`) so a share that goes quiet
mid-scan (the scope rebooting, Wi-Fi dropping) fails fast instead of hanging
a request.

**Unset:** the sidecar still boots; `GET /api/live_preview` reports
`{"source": null, "reason": "not_configured", ...}` rather than guessing at a
path. This is the default — no personal-path guess is baked in, the same
discipline `SEESTAR_ARCHIVE_DIR`/`SEESTAR_AI_DIR` already hold themselves to.

### Prerequisite: `AllowInsecureGuestAuth`

A Seestar's SMB share typically offers only anonymous/guest access — it has
no facility for the NTLM/Kerberos authentication a modern Windows client
expects by default. Recent Windows versions **block guest SMB access
out of the box** as a security hardening measure (guest sessions have no real
authentication, so Windows now refuses them unless a machine explicitly opts
back in). Without this setting, Windows will simply fail to reach the share
at all — `GET /api/live_preview` would report `share_unreachable` even with
`SEESTAR_LIVE_SHARE_DIR` correctly set and the scope observing.

**This is a host-wide relaxation, not something this repo enables for you.**
It lowers a real (if narrow) security bar on the machine running the
sidecar: anonymous SMB guest access, wherever else it might be offered on
your network, is allowed through once this is set — not scoped to the
Seestar's share specifically. Only enable it if you understand and accept
that trade-off for this machine; this project's own dev machine already had
it enabled for unrelated reasons, so this feature did not have to change
that machine's stance itself.

To check/enable it (elevated PowerShell — requires a local Group Policy or
registry change, and typically a restart of the Workstation service or a
reboot to take effect):

```powershell
# Check the current setting
Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters" -Name AllowInsecureGuestAuth -ErrorAction SilentlyContinue

# Enable it (requires an elevated/Administrator prompt)
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters" -Name AllowInsecureGuestAuth -Value 1 -Type DWord
```

| OS | Example |
|---|---|
| Windows (PowerShell) | `$env:SEESTAR_LIVE_SHARE_DIR = "\\Seestar\EMMC Images"` |
| macOS / Linux | Mount the share first (`mount_smbfs`/`mount -t cifs`), then point this at the local mount point, e.g. `/Volumes/EMMC Images` or `/mnt/seestar` — `AllowInsecureGuestAuth` is a Windows-specific setting; other OSes have their own guest-SMB posture and are untested here. |

## SEESTAR_PROVENANCE_PATH

The path to SeeStar-AI's provenance log (`data/provenance.jsonl` in a
`seestar-mcp` checkout) — the operator panel's read-only activity feed
(`GET /api/session_activity`) tails this file. Read by
`sidecar/seestar_sidecar/session_activity.py`.

**Read-only in the strict sense:** the server owns this file and is
appending to it live while the sidecar reads it. This route never writes,
rotates, truncates or locks it, and a partially-written final line (the
server mid-write) is treated as normal, not corruption.

**Unset:** defaults to `<SEESTAR_AI_DIR>/data/provenance.jsonl` (the real
layout of a `seestar-mcp` checkout) when `SEESTAR_AI_DIR` is set, or `None`
— "not configured" — when neither is set. `/api/session_activity` reports
`{"source_configured": false, "records": [], ...}` rather than guessing at
a path.

**Set, but the file doesn't exist yet** (a fresh checkout with no tool calls
logged, or a typo): the same graceful degrade, `records: []`, but
`source_configured: true` — distinguishable from "never configured", the
same discipline `SEESTAR_ARCHIVE_DIR`'s `archive_status` already holds
itself to.

Only set this explicitly if your SeeStar-AI checkout's `data/` directory
isn't where `SEESTAR_AI_DIR` would suggest — otherwise the default already
finds it.

| OS | Example |
|---|---|
| Windows (PowerShell) | `$env:SEESTAR_PROVENANCE_PATH = "C:\Users\you\seestar-mcp\data\provenance.jsonl"` |
| macOS / Linux | `export SEESTAR_PROVENANCE_PATH=/home/you/seestar-mcp/data/provenance.jsonl` |

## SEESTAR_IMAGE_CACHE_DIR

Where fetched sky-survey cutouts (DSS2, via CDS's hips2fits — see
`docs/ATTRIBUTION-DSS.md`) are cached, keyed by target id and pixel size, so
a repeat request never re-hits the network. Read by
`sidecar/seestar_sidecar/imagery.py`.

**Unset:** defaults to `sidecar/.cache/target_images` — a path computed
relative to the installed package (`Path(__file__).resolve().parents[1] /
".cache" / "target_images"`), not a personal path, and already portable:
it's writable wherever the checkout itself is (the same assumption `uv sync`
already makes), on Windows, macOS and Linux alike. Only override this if you
want the cache to live somewhere else, e.g. outside the repo checkout.

| OS | Example |
|---|---|
| Windows (PowerShell) | `$env:SEESTAR_IMAGE_CACHE_DIR = "C:\Users\you\AppData\Local\seestar-dashboard\images"` |
| macOS | `export SEESTAR_IMAGE_CACHE_DIR=$HOME/Library/Caches/seestar-dashboard/images` |
| Linux | `export SEESTAR_IMAGE_CACHE_DIR=$HOME/.cache/seestar-dashboard/images` |

## SEESTAR_PORT

The port `uv run seestar-dashboard` serves on. Read by
`sidecar/seestar_sidecar/launcher.py`.

**Unset:** defaults to `8787`, chosen to sit clear of the ports most likely to
be in use already (8000, 8080, 8888, 5000, 3000). The default was 8000 until it
collided with Docker Desktop and an unrelated local app on the same machine.
If the port is taken, the launcher prints which one is blocked and exits
cleanly — `--port` on the command line overrides this the same way the env var
does.

The Vite dev server reads the same variable (`web/vite.config.ts`), so one
change moves both the API and the dev proxy. Nothing needs editing in two
places.

| OS | Example |
|---|---|
| Windows (PowerShell) | `$env:SEESTAR_PORT = "9001"` |
| macOS / Linux | `export SEESTAR_PORT=9001` |

## SEESTAR_REPLAY

Set to `1` to serve recorded fixtures (`fixtures/*.json`) instead of
spawning the real `seestar-mcp` server — no telescope, no `SEESTAR_AI_DIR`,
and no network access needed. Read by `sidecar/seestar_sidecar/routes.py`.
The UI's top bar shows a "fixtures — not live" indicator whenever this is
set. `record.py` is what (re-)generates the fixtures from a real, running
`seestar-mcp` — see its own docstring.

**Unset:** the default — live mode, spawning the real MCP server via
`SEESTAR_AI_DIR`.

| OS | Example |
|---|---|
| Windows (PowerShell) | `$env:SEESTAR_REPLAY = "1"; uv run seestar-dashboard` |
| macOS / Linux | `SEESTAR_REPLAY=1 uv run seestar-dashboard` |

## Not an environment variable: the DSO catalogue paths

`data/dso_catalog_extended.json` and `data/dso_aliases.json` are checked
into the repo (see `data/README.md`) and always read relative to the
package — there is no env var for these, because they aren't a
machine-specific external data source the way the archive or the
`seestar-mcp` checkout are. `catalog_path`/`aliases_path` exist as
`create_app()` parameters purely so tests can point at a small synthetic
fixture instead of the real 12,517-object file; production never overrides
them.
