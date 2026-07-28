# Claude Code as the Brain for a ZWO Seestar S50: Technical Design + Ready-to-Paste Build Prompt

## TL;DR
- **Build it as a dedicated Python MCP server (FastMCP) running on an NVIDIA Jetson Orin 24/7, wrapping seestar_alp's ASCOM Alpaca HTTP API (port 5555) — with Claude Code as the CLI "brain" running on the Jetson, which you drive from the Claude app via the built-in Remote Control feature.** seestar_alp is the mature, actively maintained choice (~272 stars, v3.2.2 May 2026); indi-seestar is alpha (~2 stars) and only worth it if you need INDI/Ekos autoguiding.
- **The Seestar exposes only standard ASCOM Alpaca endpoints (≈48/52 GET methods work), so the MCP server uses two layers: standard Alpaca verbs for mount/camera state, and seestar_alp's `method_sync`/`method_async` action tunnel to reach native JSON-RPC (`iscope_start_view`, `start_auto_focuse`, `start_solve`, etc.).** Pull RAW subs off the device (HTTP :80 / SMB :445) and score them with a two-tier QA pipeline (firmware telemetry first, then astropy/photutils FITS analysis: HFR/FWHM, SNR, eccentricity, background, plate-solve residuals).
- **Use MCP + Skills together:** the MCP server is the *access* layer (telescope control + QA tools); Claude Code Skills encode the *procedural* layer (session checklists, QA scoring policy, anomaly response). Treat the whole thing as a supply-chain-audited project: pin dependencies, sandbox the daemon, log every command for provenance.
- **Remote access is solved by Claude Code Remote Control, not by you.** Because the Claude app talks to Anthropic's API and the Jetson only makes outbound HTTPS, there is **no VPN, no SSH, no tmux, no port forwarding, and no inbound network exposure** to design for. Everything runs on your local LAN; the phone is just a window into the local session.

## Operating model with Claude Code Remote Control

This is the workflow that replaces the entire VPN/SSH/tmux/mosh/ntfy stack from a typical headless-agent design.

- **What Remote Control is:** a synchronization layer between the Claude Code session running on your Jetson and the Claude iOS/Android app (or claude.ai/code). The session — and all tool execution, files, MCP servers, and env — stays on the Jetson the entire time. The phone shows the conversation, diffs, and approval prompts. Your code/data never moves to the cloud; only chat messages and tool results flow over an encrypted bridge.
- **Security model:** the Jetson makes **outbound HTTPS only** and polls for work; **no inbound ports are opened** on your machine. Traffic rides the Anthropic API over TLS with short-lived, single-purpose credentials. This is why no VPN or port forwarding is needed.
- **The operating sequence (important — order matters):**
  1. On the Jetson: ensure seestar_alp is running (:5555) and register the `seestar-mcp` server in Claude Code.
  2. Start the Claude Code session and enable Remote Control (`claude` then `/remote-control "Seestar"`, or set `/config` → enable Remote Control for all sessions). Scan the QR/open the URL once to pair the app.
  3. Drive the session from the Claude app: kick off a session, monitor stacking/QA, approve actions, redirect.
- **Hard constraints to design around:**
  - **MCP servers must be registered before the Remote Control session starts.** Remote Control preserves full local context including MCP, but you **cannot add a new MCP server mid-session from the phone**. If you add tools, re-register and restart Claude Code locally.
  - **One Remote Control session per machine** (research preview; occasional jank reported). Fine for a single scope. Multi-scope would use `claude remote-control` server mode, but don't design for that now.
  - **Plan availability:** Remote Control is in research preview and documented as available on all plans (Team/Enterprise off until an admin enables the toggle). Confirm it's live on your account before building the workflow around it.
- **Notifications:** "Claude needs input" / task-complete prompts surface natively in the Claude app — no self-hosted ntfy required.

## Key Findings

### 1. The control stack is mature and well-documented
- **seestar_alp** (github.com/smart-underworld/seestar_alp) is the reference community project: "Complete Control and Automation for Seestar S50." As of June 2026 it has ~272 stars, ~64 forks, ~1,895 commits, latest release **v3.2.2 (May 6, 2026)**, Python 71%. It runs a Falcon/WSGI **ASCOM Alpaca server on port 5555**, an experimental web front-end ("SSC") on **5432**, Alpaca UDP discovery on **32227**, and a Bruno API collection in `bruno/Seestar Alpaca API/`. It runs standalone (Windows/Mac/Linux/Raspberry Pi) or from source (`./device` and `./front`).
- **The Seestar supports NO custom Alpaca actions** — every feature uses standard ASCOM Alpaca endpoints. Independent testing (gordtulloch/indi-seestar, README last updated Feb 3 2026) confirms **48 of 52 GET methods work (92%)** on firmware v1.1.2-1; the bare-telescope's *ASCOM-standard* action-extension mechanism returns error 1036, Alt/Az slewing is unsupported (`canslewaltaz=false`), and `SiteElevation` throws. **Important nuance:** seestar_alp itself *does* expose a working `action` endpoint — `PUT /api/v1/telescope/{n}/action` with form body `Action=method_sync&Parameters={"method":"...","params":[...]}&ClientID=1&ClientTransactionID=999` (verbatim per the repo's `Bruno_notes`) — which it translates into the Seestar's native line-delimited TCP JSON-RPC on port 4700. This is the key control lever for everything beyond standard mount verbs. seestar_alp also exposes higher-level named actions (e.g. `goto_target`, `start_stack`, `start_solve`, `set_wheel_position`, `pi_shutdown`) and a scheduler on the :5432 front-end (`/schedule/refresh` and friends), but for programmatic automation the stable surface is the :5555 Alpaca action tunnel.
- **indi-seestar** (gordtulloch/indi-seestar) is an INDI driver alternative built on generic Alpaca base drivers (port 32323). It adds, for **firmware v1.1.2-1+ (Dec 2025)**: PulseGuide + IsPulseGuiding (autoguiding/dithering), adjustable guide rates, Park/Unpark, dew-heater control via Switch module, and S30 Pro dual camera/focuser (device 0=tele, 1=wide). It is **alpha quality (~2 stars, no releases)** and currently only the telescope driver is mature; CCD/focuser/filterwheel drivers are "planned." Use it only if you specifically need Ekos/KStars autoguiding and dithering; otherwise seestar_alp is the safer brain-facing target.
- **seestar_run** (github.com/smart-underworld/seestar_run, ~59 stars, Jupyter/Python) is a scripted-session CLI: `python seestar_run.py <ip> <target_name> <ra> <dec> <is_use_LP_filter> <session_time> <RA_panel> <Dec_panel> <RA_offset> <Dec_offset>`. RA/Dec accept floats or `hr:mm:ss` strings; a negative RA uses the current Sky Atlas/target set in the app. It supports mosaics and batch/scheduled imaging via shell scripts with `sleep`. It is useful as a *reference for command sequencing* but the Alpaca action API is the cleaner programmatic lever.

### 2. The raw JSON-RPC protocol is reverse-engineered and stable
- The Seestar exposes 5 TCP ports: **4700** (JSON-RPC command/control), **4554/4555** (RTSP H.264 viewfinder, tele/wide), **4800/4804** (binary live-stacked image stream, tele/wide). The control protocol is line-delimited JSON-RPC 2.0: `{"id":N,"method":"...","params":{...}}\r\n`.
- Documented native methods (community packet captures + the third-party `seestarpy` library, v0.4.1 May 2026): `iscope_start_view` (params `{mode, target_ra_dec, target_name, lp_filter}`), `iscope_stop_view` (arg `"Stack"`/`"ContinuousExposure"`), `iscope_start_stack`, `get_view_state`, `get_device_state`, `scope_get_equ_coord`, `scope_get_track_state`, `scope_move_to_horizon`, `scope_sync`, `scope_park`, `start_auto_focuse` (note the firmware's "e" spelling; seestar_alp normalizes to `start_auto_focus`), `stop_auto_focuse`, `get_focuser_position` (params `{ret_obj:true}`), `start_solve`/`get_solve_result`, `start_polar_align` (EQ mode), `start_create_dark`, `get_setting`/`set_setting`, `get_stack_setting`, `set_wheel_position` (LP/IR-Cut/Dark), `pi_shutdown`, `pi_reboot`.
- **Firmware 7.18+ added a mandatory RSA challenge-response handshake** on port 4700 (`get_verify_str` → sign challenge with SHA-1/PKCS#1 v1.5 → `verify_client` → `pi_is_verified`). The RSA private key is a single global key embedded in the official APK (identical across versions), not per-device. seestar_alp and seestarpy handle this transparently; on firmware <7.18 the handshake is skipped (error 103). **This is a recurring breakage vector — keep the wrapper's auth path updatable.**

### 3. Data and data-quality: the device stores real FITS subs you can pull and score
- Storage: 64 GB internal eMMC. The app's **"Save each frame in enhancing"** toggle (Advanced Settings) makes the Seestar write **individual ~12 MB FITS subs** to a per-target `<Target>_sub` folder alongside the stacked `DSO_Stacked_*.fit` and JPEG previews. Files carry rich FITS headers (RA/Dec, filter, GPS, time). Naming: `DSO_Stacked_<N>_<Target>_<exp>s_<date>_<time>.fit`.
- Three ways to retrieve subs: (a) **USB-C cable** → mass-storage on Windows (Linux support flaky); (b) **station mode** → SMB share `\\Seestar` / `\\seestar.local` on the LAN; (c) **programmatically**: seestarpy's `data` module lists folders via JSON-RPC (:4700), downloads via the device's built-in HTTP server (:80), deletes via SMB (:445). You can pull subs *while a session is running.*
- Live-stack image stream (ports 4800/4804): 34-byte big-endian header (magic `0x03C3`=963) embeds live focus telemetry including **hfd_x, hfd_y, and an hfd (half-flux-diameter) focus-quality value** per frame, followed by a deflate-compressed 16-bit RGB payload. This is a Tier-1 telemetry source for focus quality without downloading full FITS.

### 4. QA techniques and libraries are well-established
- **Tier 1 (trust firmware telemetry):** poll `get_view_state`/`get_device_state` for live stacking count, rejected-frame count, plate-solve state, focus position; read the per-frame HFD from the 4800-port header. The Seestar itself already rejects star-trailed frames (commonly after ~15 min in Alt-Az due to field rotation, and on tracking errors), so the rejected-frame count is a free session-health signal.
- **Tier 2 (own FITS analysis):** detect sources with `photutils` (DAOStarFinder/SourceCatalog), measure per-star **FWHM** (`SourceCatalog.fwhm`, from 2D-Gaussian second moments), **eccentricity/roundness** (`SourceCatalog.eccentricity`, where roundness = FWHM_y/FWHM_x), **HFR** (half-flux radius via aperture growth), **SNR** (source flux vs sigma-clipped annulus background, `astropy.stats`), **background level/gradient**, and **plate-solve RMS residuals** against Gaia (via `astropy.wcs` + a local solver). `ccdproc` handles calibration bookkeeping.
- **Benchmark thresholds** mirror PixInsight SubframeSelector / Siril: reject subs by FWHM (e.g. > median + Nσ) and by **eccentricity**. Per Chaotic Nebula's "PixInsight Subframe Selector – A Comprehensive Guide," the canonical Approval expression "will automatically reject any subframe where the eccentricity is not less than 0.575" (PixInsight reference docs add that distortion with "an eccentricity less than about 0.42 is not perceptible to most people"). Siril's **weighted FWHM (wFWHM)** — FWHM weighted by star count — is the single best session-quality scalar because a frame with clouds/poor transparency shows both higher FWHM and fewer detected stars. Siril exposes this via `seqstat` and weights stacking by number-of-stars, wFWHM, noise, or integration time. Replicating wFWHM in photutils is the recommended scoring metric for the QA module.

### 5. Compute host: Jetson Orin wins for the 24/7 daemon
- The telescope-control daemon + FITS QA is I/O- and light-CPU-bound, not training-bound. Per NVIDIA, **Jetson AGX Orin modules deliver up to 275 TOPS of AI performance with power configurable between 15 W and 60 W** (note 275 TOPS is sparse INT8; dense networks deliver ~170 INT8 TOPS), with up to 64 GB of 256-bit LPDDR5 at 204.8 GB/s — far more than enough for star detection, plate-solving, and even local VLM-based image sanity checks. This contrasts sharply with the **RTX 4090's 450 W TDP** (NVIDIA published spec), which requires active cooling and is unsuited to fanless/embedded always-on use.
- **Recommendation: run the persistent MCP server + seestar_alp + the Claude Code session on the Jetson.** Keep the RTX 4090 (if present) as an *optional, on-demand* batch node for heavy local inference (e.g., running a local model for image classification or large mosaic stacking), reachable over the LAN but not required for nightly operation. This matches the constraint that the Jetson is better for the 24/7 daemon and the 4090 for occasional heavy inference.

### 6. MCP vs Skills: use both, deliberately
- **MCP = access** (external systems Claude can't reach: the telescope, the FITS files, the QA computations). **Skills = specialization/procedure** (how to run a session, what thresholds mean, the anomaly playbook). Anthropic's own framing, from "Extending Claude's capabilities with skills and MCP" (Dec 2025): "Model Context Protocol (MCP) connects Claude to third-party tools, and skills teach Claude how to use them well… an MCP server gives Claude access to your external systems, services, and platforms, while skills provide the context Claude needs to use those connections effectively."
- MCP context cost is real. Per Anthropic's "Introducing advanced tool use" (Nov 20, 2025), tool definitions "can sometimes consume 50,000+ tokens before an agent reads a request"; the Tool Search feature delivers "an 85% reduction in token usage while maintaining access to your full tool library" (internal benchmark ~134K→~5K tokens) and raised MCP-eval accuracy (Opus 4 from 49% to 74%; Opus 4.5 from 79.5% to 88.1%). So keep the Seestar MCP server **lean and single-purpose** (one domain server, ~12–18 tools) and push verbose procedure into Skills (≈100 tokens each until invoked). This is the recommended combination.

## Details

### System architecture

```
   ┌─────────────┐   Claude Remote Control     ┌──────────────────────────────────────┐
   │  Claude App │◀── (Anthropic API, TLS) ───▶│  Jetson Orin (24/7, dedicated host)   │
   │  (phone)    │   outbound HTTPS only;       │                                        │
   │  window into│   no inbound ports,          │   Claude Code CLI (the "brain")        │
   │  the session│   no VPN, no port-forward    │         │ MCP stdio/HTTP                 │
   └─────────────┘                              │         ▼                                │
                                                │   seestar-mcp (FastMCP, Python)         │
                                                │     • control tools → Alpaca :5555      │
                                                │     • data tools → HTTP:80 / SMB:445    │
                                                │     • QA tools → astropy/photutils      │
                                                │   + Claude Code Skills (procedures)     │
                                                │         │ HTTP (Alpaca)                  │
                                                │         ▼                                │
                                                │   seestar_alp (Falcon, :5555 + :5432)   │
                                                └───────────────────┬────────────────────┘
                                                                    │ TCP JSON-RPC :4700
                                                                    │ binary :4800 / RTSP :4554
                                                                    ▼  (same LAN)
                                                            ┌──────────────┐
                                                            │ Seestar S50  │
                                                            │ (station mode│
                                                            │  DHCP resv.) │
                                                            └──────────────┘
```

The phone never touches the LAN. It reaches the local session only through Anthropic's API; the Jetson reaches the Seestar over the LAN. This is why no tunnel is required.

### Component choices (with justification)
| Decision | Choice | Why |
|---|---|---|
| Brain | Claude Code CLI on the Jetson | Persistent, scriptable; driven from the app via Remote Control |
| Remote access | **Claude Code Remote Control** | Native sync layer; outbound HTTPS only, no VPN/SSH/tmux/port-forward |
| Compute host | **Jetson Orin** (4090 optional batch node) | 15–60 W fanless 24/7 vs 450 W; QA workload is light |
| Control backend | **seestar_alp** (:5555 Alpaca) | Mature (~272★, v3.2.2), Bruno-documented, action tunnel to JSON-RPC |
| INDI alternative | indi-seestar | Only if Ekos autoguiding/dithering needed; alpha quality |
| Extension model | **MCP + Skills** | MCP=access (telescope/FITS), Skills=procedure (session/QA policy) |
| Network | Seestar + Jetson on the same LAN; Seestar on a DHCP reservation | Stable IP; no bridging/tunnel needed |

### MCP server tool schema (proposed)
A single FastMCP server, `seestar-mcp`, exposing a lean tool set. Control tools wrap standard Alpaca verbs where they exist and fall back to the `method_sync` action tunnel otherwise:

**Control / state**
- `connect_telescope()` → PUT `…/telescope/0/connected`
- `get_status()` → GET `rightascension`, `declination`, `tracking`, `slewing` + action `get_device_state`
- `get_view_state()` → action `method_sync` `get_view_state` (stacking count, rejected count, solve state)
- `goto_target(name, ra, dec, use_lp_filter)` → action `iscope_start_view`
- `start_stack()` / `stop_view(stage)` → actions `iscope_start_stack` / `iscope_stop_view`
- `run_autofocus()` → action `start_auto_focus`; `get_focuser_position()`
- `plate_solve()` → action `start_solve` + `get_solve_result`
- `set_filter(position)` / `set_dew_heater(pct)` / `park()` / `shutdown()`

**Data**
- `list_folders()` / `list_subs(target, filetype="fit")` (JSON-RPC :4700)
- `download_subs(target, dest, since=None)` (HTTP :80 or SMB :445)

**QA**
- `qa_tier1(target)` → returns firmware telemetry snapshot (stack count, rejects, solve RMS, focus pos, per-frame HFD)
- `qa_tier2(fits_path|target)` → returns per-sub {FWHM, HFR, eccentricity, SNR, background, n_stars, wFWHM, verdict}
- `qa_session_report(target)` → aggregates, flags focus drift / dew / cloud / transparency / guiding trends, emits a provenance-logged JSON+Markdown report

### Two-tier QA pipeline design
- **Tier 1 — trust telemetry (cheap, real-time):** poll `get_view_state` every N seconds during a session. Watch (a) **stacking count not increasing** → clouds/tracking loss; (b) **rising rejected-frame count** → field rotation/trailing (expected late in Alt-Az sessions), dew, or wind; (c) **plate-solve failures** → pointing/transparency; (d) **focus position drift** → temperature change (refocus). Per-frame HFD from the :4800 header gives a focus-quality trend without downloading FITS. Surface alerts in the Claude session (visible in the app).
- **Tier 2 — own FITS analysis (authoritative, batch or near-real-time):** pull new subs, run photutils source detection, compute per-star FWHM/HFR/eccentricity/SNR + background, aggregate to per-sub medians and a Siril-style **wFWHM** (FWHM weighted by star count). Score and tag each sub PASS/MARGINAL/REJECT against thresholds (FWHM > median+Nσ; eccentricity ≥ 0.575; SNR below floor; star count collapse = clouds). Detect session-level problems: monotonic FWHM rise (focus/dew), step changes in background (light pollution/moonrise), star-count drops (cloud/transparency), eccentricity bursts (tracking/guiding). Output a report + a "keep list" for re-stacking in Siril (`OSC_Preprocessing_WithoutDBF.ssf`).

### Provenance & audit logging design
- Every MCP tool call logs a structured JSON event: timestamp (UTC), tool, arguments, the literal Alpaca/JSON-RPC request sent, `ClientTransactionID`/`ServerTransactionID` returned by Alpaca, response code, and a hash of any FITS file touched. Append-only (e.g., JSONL + daily rotation), optionally signed.
- Map this to ASCOM's own design: Alpaca devices return a `ServerTransactionID` on every response specifically so client and device logs can be correlated — exploit that for end-to-end provenance.
- Keep a per-session manifest: target, hardware/firmware version, every command, every sub's QA verdict, and the final keep-list. This is the auditable chain of custody from photons to processed stack.

### Security / code-review considerations (for a classified-environment practitioner)
- **Remote access risk is largely handled by the Remote Control model:** the Jetson opens **no inbound ports**, makes **outbound HTTPS only**, and uses short-lived, single-purpose credentials over TLS. There is no VPN, SSH surface, or tunnel for you to harden. Your residual remote-access concern is account security (protect the Claude account/MFA, since pairing the app grants session control) and the research-preview status of the feature.
- **MCP-specific risk surface (OWASP MCP Top 10, mid-2025):** tool poisoning (hidden instructions in tool descriptions/schemas), prompt injection via tool output, over-permissioned tools, supply-chain compromise (rug-pulls/typosquats), insufficient sandboxing, SSRF, insecure update mechanisms, and logging gaps. Multiple CVSS 9.0+ MCP CVEs landed in H1 2026 (e.g., CVE-2026-33032, an unauthenticated command-exec flaw in nginx-ui's MCP). Anthropic's reference MCP implementation also had a disclosed design issue (declined as "expected behavior") — so you must add controls yourself.
- **Concrete controls:** (1) **pin every dependency to exact versions**, commit lockfiles, generate/diff an SBOM (syft/cyclonedx) on each build; (2) run the MCP server and seestar_alp as an **unprivileged, sandboxed service** (systemd hardening / container with dropped caps, no host FS beyond the data dir); (3) **least privilege** — the MCP server only reaches the Seestar's IP and the local data dir, nothing else; (4) keep secrets (the RSA APK key, any tokens) out of config files and in a secrets store; (5) scan the server with `mcp-scan`/Cisco `mcp-scanner` in CI (non-blocking first, then blocking); (6) **never expose the MCP/Alpaca ports beyond the LAN** — bind them to localhost/the Jetson and let Claude Code reach them locally; (7) audit-log every tool call (above) for incident reconstruction; (8) human-readable, reviewable tool descriptions (no obfuscated instructions). Because seestar_alp is GPL-3.0 and you're building a *new* dedicated wrapper, you can vendor and review the exact commit you depend on rather than tracking `main`.

### Network topology
- The Seestar operates either as its own **WiFi AP** (`S50_xxxxxx`, default for first setup) or in **station mode** joined to your network. For a 24/7 host, use **station mode** with a **DHCP reservation** so the IP is stable, and point the MCP server / seestar_alp at that fixed IP.
- Community reports: **2.4 GHz is markedly more stable than 5 GHz** for the S50 (5 GHz frequently fails to connect; 2.4 GHz can be slow but reliable).
- **No tunnel or bridge is required**, because the phone reaches the session via Anthropic's API, not the LAN — the Jetson and Seestar simply share the local network. Optionally, you can still place the Seestar on a dedicated IoT VLAN/SSID with client isolation as pure network hygiene (allowing only the Jetson to reach it), but this is now optional rather than a connectivity requirement. The Seestar works fully offline (its hotspot is self-contained); allow internet egress only if you want its weather/almanac data.
- Firmware updates only break things, so gate them: snapshot the working firmware/app combination and update deliberately (the v2.4 firmware famously broke seestar_alp startup, goto, autofocus, and polar align — issue #613).

### Known gotchas & edge cases
- **Remote Control: register MCP before starting the session.** You cannot add a new MCP server mid-session from the phone; re-register and restart Claude Code locally if you add tools. Only one Remote Control session per machine (research preview). Confirm the feature is enabled on your plan.
- **Firmware updates break community tools.** EQ-mode firmware (v2.4/app 2.4.1, firmware 4.43) and the 7.18+ auth handshake both broke third-party access until patched. Pin a known-good firmware/app pair; keep the wrapper's auth and command maps updatable.
- **Alt-Az field rotation** causes rising frame rejection after ~15 min and a spiral border on stacks; EQ mode (needs a wedge + polar align) allows 30 s subs but can still drop frames on tracking error. Your QA must treat late-session rejection spikes as *expected* in Alt-Az, not always a fault.
- **Dark-frame validity:** the S50 builds darks at startup; turning on the dew heater or imaging before thermal acclimation invalidates them (sensor noise is temperature-linked). Let it cool 10–15 min; re-run enhancement after enabling the dew heater.
- **Data pull quirks:** Linux USB mass-storage is flaky; SMB/station-mode or the HTTP-on-:80 path is more reliable for headless automation.
- **Action API casing/format:** Alpaca paths are lowercase and case-sensitive; the action body is `application/x-www-form-urlencoded` with the JSON-RPC payload as a *string* in `Parameters`, not a raw JSON body. Decimal points must be `.` (invariant culture).
- **Device numbering:** seestar_alp's `config.toml` numbers the first scope `device_num = 1`, but Alpaca telescope endpoints are addressed as device `0` in examples — verify the mapping.

### Phased implementation plan
1. **Phase 0 — host & network:** Flash the Jetson; install Claude Code; put the Seestar in station mode with a DHCP reservation on the same LAN; verify the Jetson can reach the Seestar's IP. (No VPN/SSH/tmux setup needed — Remote Control handles phone access.)
2. **Phase 1 — backend:** Install/pin seestar_alp at a reviewed commit; bring up Alpaca :5555 (bound to localhost/LAN, not public); validate with the Bruno collection (`get_device_state`, goto, autofocus). Snapshot working firmware/app versions.
3. **Phase 2 — MCP server:** Scaffold `seestar-mcp` (FastMCP), implement control + data tools, wire the `method_sync` action tunnel, add structured audit logging. Test with MCP Inspector, then register in Claude Code.
4. **Phase 3 — QA pipeline:** Implement Tier 1 (telemetry polling + in-session alerts) and Tier 2 (photutils FITS scoring + wFWHM + session report). Validate against a night of known-good and known-bad subs.
5. **Phase 4 — Skills:** Author Claude Code Skills for session run-book, QA scoring policy, and anomaly playbook.
6. **Phase 5 — operating model:** Register the MCP server, start the Claude Code session, enable Remote Control, pair the Claude app, and run an end-to-end session from the phone. Verify the pre-registration and one-session-per-machine constraints in practice.
7. **Phase 6 — security pass:** SBOM, dependency pinning, mcp-scan in CI, systemd/container sandboxing, secrets store, account MFA, log review. Tabletop a firmware-update break and a tool-poisoning scenario.

## Recommendations
1. **Start with seestar_alp + a lean FastMCP server on the Jetson now; defer indi-seestar.** Only adopt indi-seestar if you later need Ekos-grade autoguiding/dithering. Re-evaluate if indi-seestar reaches beta and gains a CCD driver.
2. **Make the MCP server single-purpose and ~12–18 tools.** Push procedure into Skills to keep context cost low (Anthropic's Tool Search can claw back ~85% of tool-definition tokens if your library grows). If you find yourself adding many always-on tools, move them behind Tool Search or convert to Skills.
3. **Bake the Remote Control operating sequence into your run-book:** seestar_alp up → register `seestar-mcp` → start Claude Code → enable Remote Control → pair app. Because MCP can't be added mid-session, treat "register before start" as a hard step.
4. **Implement Tier 1 QA before Tier 2.** Firmware telemetry catches most session failures (clouds, focus drift, tracking loss) for near-zero cost; Tier 2 is for sub-selection quality and post-hoc reporting.
5. **Gate firmware updates.** Treat any Seestar app/firmware update as a potential breaking change; test on a non-critical window, keep a rollback note. Benchmark to change course: if a firmware update breaks the auth handshake or action tunnel, freeze and wait for seestar_alp/seestarpy to patch.
6. **Treat the build as classified-grade supply chain:** pin + SBOM + sandbox + localhost/LAN-only port binding + account MFA + full audit logging from day one. **Threshold that changes the plan:** if mcp-scan/SBOM diff flags an unreviewed dependency change or a tool-description mutation, block the deploy.
7. **Run offline-capable.** Don't depend on the Seestar's internet egress; the system should function on the local LAN with the Jetson talking to the scope and the Claude app reaching the session via Anthropic's API. (Note: Remote Control itself requires the Jetson to have outbound internet to Anthropic; if you ever need a truly air-gapped run, you'd drive Claude Code locally on the Jetson instead of via the app.)

## Caveats
- Several specifics (exact native method spellings, the 48/52 GET count, port roles, the action-tunnel body format) come from community reverse-engineering and one AI-indexed wiki (DeepWiki) rather than vendor docs; verify against the live seestar_alp source and Bruno collection before relying on any single command name. The `start_auto_focuse` vs `start_auto_focus` spelling discrepancy is a concrete example.
- **Remote Control is a research-preview feature** (launched Feb 2026); behavior, plan availability, and the one-session-per-machine limit may change. Confirm current state before relying on it operationally. It also requires the Jetson to have outbound internet to Anthropic — it is *not* an air-gap-compatible access method.
- The RSA-key extraction for firmware 7.18+ auth raises interoperability/legal questions; seestarpy's docs argue it's lawful reverse engineering for interoperability (DMCA 1201(f), EU Software Directive Art. 6) but this is not legal advice — confirm your own posture, especially in a government context.
- indi-seestar capabilities (PulseGuide, dew heater) depend on Dec-2025+ firmware and are alpha; don't design hard dependencies on them yet.
- Performance numbers for Jetson vs 4090 come from NVIDIA specs and benchmark-aggregator sites (MLPerf-derived); the qualitative conclusion (Jetson for low-power 24/7) is robust regardless of exact figures.

---

## Ready-to-paste Claude Code prompt

> **Paste this into Claude Code running on the Jetson host.**

```
You are building a NEW, dedicated, security-audited project called `seestar-mcp`:
an MCP server + Claude Code Skills that let me control a ZWO Seestar S50 smart
telescope and run data-quality assurance on its astrophotography output. I am a
senior engineer who builds for classified/air-gapped environments; prioritize
auditability, provenance, least privilege, and reproducible/pinned dependencies.

OPERATING MODEL (do not build remote-access plumbing)
- This runs on a Jetson on my local LAN. I reach the Claude Code session from the
  Claude phone app via the built-in Remote Control feature, which is a sync layer
  over Anthropic's API (outbound HTTPS only, no inbound ports, no VPN/SSH/tmux/port
  forwarding). Do NOT add any tunnel, VPN, SSH, tmux, ntfy, or port-forwarding setup.
- MCP servers must be registered BEFORE the Remote Control session starts; they
  cannot be added mid-session from the phone. The README must document the exact
  startup order: (1) start seestar_alp, (2) register seestar-mcp in Claude Code,
  (3) start the Claude Code session and enable Remote Control, (4) pair the app.
- Bind seestar-mcp and seestar_alp to localhost/LAN only; never expose them publicly.

CONTEXT YOU MUST RESPECT
- The telescope is reached via `seestar_alp` (github.com/smart-underworld/seestar_alp),
  which runs an ASCOM Alpaca HTTP server on http://127.0.0.1:5555. Assume it is
  already installed and running at a pinned commit I will provide.
- The Seestar supports ONLY standard ASCOM Alpaca endpoints. For anything beyond
  standard mount verbs, use seestar_alp's action tunnel:
  PUT /api/v1/telescope/0/action with form body:
  Action=method_sync&Parameters={"method":"<native_method>","params":[...]}&ClientID=1&ClientTransactionID=<n>
  Native JSON-RPC methods include: iscope_start_view {mode,target_ra_dec,target_name,lp_filter},
  iscope_start_stack, iscope_stop_view ("Stack"/"ContinuousExposure"), get_view_state,
  get_device_state, scope_get_equ_coord, scope_get_track_state, scope_move_to_horizon,
  start_auto_focus, get_focuser_position {ret_obj:true}, start_solve, get_solve_result,
  set_wheel_position, start_polar_align, start_create_dark, get_setting/set_setting,
  pi_shutdown, pi_reboot.
- RAW data: enable "Save each frame in enhancing" on the device. Subs are ~12MB FITS
  in <Target>_sub folders. List via JSON-RPC (:4700), download via the device HTTP
  server (:80) or SMB (:445). Pull subs while a session runs.

PROJECT STRUCTURE TO SCAFFOLD
seestar-mcp/
  pyproject.toml            # pinned exact deps: mcp[cli] (FastMCP), httpx, astropy,
                            #   photutils, ccdproc, numpy, pydantic; lockfile committed
  src/seestar_mcp/
    server.py               # FastMCP server; registers all tools below
    alpaca_client.py        # thin Alpaca client; standard verbs + method_sync/async tunnel;
                            #   logs ClientTransactionID/ServerTransactionID
    data_client.py          # list/download subs via :4700 / :80 / :445
    qa_tier1.py             # firmware telemetry: stacking count, rejected count, solve RMS,
                            #   focus pos, per-frame HFD trend; threshold alerts
    qa_tier2.py             # photutils FITS analysis: per-star FWHM, HFR, eccentricity,
                            #   SNR, background, star count; per-sub medians + Siril-style
                            #   weighted FWHM (wFWHM = FWHM weighted by star count); PASS/
                            #   MARGINAL/REJECT verdict; session-level anomaly detection
                            #   (focus drift, dew, cloud, transparency, guiding)
    provenance.py           # append-only JSONL audit log: ts, tool, args, literal request,
                            #   transaction IDs, response code, FITS hash; per-session manifest
    config.py               # pydantic settings; no secrets in code
  skills/                   # Claude Code Skills (SKILL.md each)
    run-session/SKILL.md    # run-book: connect, autofocus, goto, stack, monitor
    qa-policy/SKILL.md      # what the thresholds mean and how to score/keep subs
    anomaly-playbook/SKILL.md # cloud/dew/focus-drift/tracking responses
  tests/                    # pytest; mock Alpaca with httpx; FITS fixtures (good+bad subs)
  SECURITY.md               # threat model + controls (below)
  README.md                 # MUST document the Remote Control startup order above

MCP TOOLS TO IMPLEMENT (lean, ~15 tools; clear non-obfuscated descriptions)
control: connect_telescope, get_status, get_view_state, goto_target, start_stack,
  stop_view, run_autofocus, get_focuser_position, plate_solve, set_filter,
  set_dew_heater, park, shutdown
data:   list_subs, download_subs
qa:     qa_tier1, qa_tier2, qa_session_report

REQUIREMENTS
1. Use FastMCP (@mcp.tool decorators; type hints -> JSON schema). Async httpx for Alpaca.
2. Alpaca calls: standard verbs (connected, rightascension, declination, tracking,
   slewing, slewtotarget, abortslew) where they exist; method_sync tunnel otherwise.
   Form-urlencode bodies; JSON-RPC payload as a STRING in Parameters; lowercase paths;
   "." decimal separator. Handle the 48/52-GET-method reality gracefully (some GETs
   may NotImplemented).
3. qa_tier2 must compute FWHM, HFR, eccentricity (roundness=FWHMy/FWHMx), SNR (sigma-
   clipped annulus background), background level, star count, and wFWHM; flag subs by
   FWHM>median+Nsigma and eccentricity>=0.575 (configurable); output a keep-list and a
   Markdown+JSON report.
4. Provenance: every tool call appends a structured audit record. Every QA verdict and
   the final keep-list go into a per-session manifest. Never log secrets.
5. SECURITY PASS (do this and write SECURITY.md): pin exact dependency versions + commit
   a lockfile; generate an SBOM (cyclonedx/syft) build step; design the server to run as
   an unprivileged sandboxed systemd service (or container with dropped caps) that can
   ONLY reach the Seestar IP and the local data dir; least-privilege tool scoping; keep
   the firmware-7.18+ RSA key and any tokens in a secrets store, not config; add a CI
   step that runs an MCP security scanner (mcp-scan or Cisco mcp-scanner) as a non-
   blocking check; document the OWASP MCP Top 10 mitigations (tool poisoning, prompt
   injection via tool output, over-permissioned tools, supply-chain, sandboxing, SSRF,
   insecure updates, logging); bind all local ports to localhost/LAN only (never public).
   Note that remote phone access is handled by Claude Code Remote Control (outbound
   HTTPS only) so there is no inbound network surface to harden beyond the local ports.
6. TESTS: unit-test the Alpaca client against a mocked server (success + NotImplemented +
   error 1036 paths), and qa_tier2 against good and bad FITS fixtures with known FWHM/
   eccentricity. Include a smoke test that exercises a full mocked session end-to-end.
7. GOTCHAS to handle in code/comments: Alt-Az field-rotation rejection spikes are EXPECTED
   late in a session (don't false-alarm); dark frames invalidate if dew heater toggled or
   before thermal acclimation; firmware updates may break the action tunnel/auth (make the
   auth + command map a single updatable module); device_num mapping (config=1 vs Alpaca=0).

DELIVERABLES
- The scaffolded repo with working code, passing tests, README (including the Remote
  Control startup order), SECURITY.md.
- A `make run` (or uv) target to launch the MCP server, and the exact line to register it
  in Claude Code, followed by the command to start a Remote-Control-enabled session.
  Start by proposing the file tree and pyproject.toml with pinned versions, wait for my
  approval, then implement module by module with tests. Do a self-review pass for the
  OWASP MCP Top 10 before finishing.
```
