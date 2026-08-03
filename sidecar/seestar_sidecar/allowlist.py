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
        "list_projects",
        "recommend_projects",
        # --- slice 3 (Live session screen) — each verified read-only against
        # SeeStar-AI/src/seestar_mcp/server.py before adding, not assumed from
        # its name (see docs/superpowers/specs/2026-07-30-slice-3-live-session.md
        # D3). All six only ever append to the shared provenance audit log the
        # same way every tool above already does — that is not a "write" in
        # the sense this allowlist cares about (telescope motion, session
        # artifacts, stored data); it is the audit trail every already-listed
        # tool call produces regardless of route.
        "get_view_state",  # stacked/dropped counts, plate-solve state, stage
        "get_status",  # pointing + tracking/slewing state
        "check_night_guardrails",  # "Read-only: gathers live device health +
        # weather and returns a verdict" (server.py) — no motion, no write
        # beyond the shared provenance log.
        "qa_tier1",  # "Poll firmware telemetry once ... Read-only." Flags are
        # health signals, not quality verdicts — never render as a QA verdict.
        "get_focuser_position",  # "Read the current focuser position.
        # Read-only." — reads, does not move, the focuser.
        "get_target_observability",  # "Read-only, offline (deterministic
        # astropy ephemeris)" — the sweet-band gauge's altitude/rotation data.
        "get_run_state",  # "Read-only; makes no device call" (server.py) —
        # verified at source, not taken from the name or the note announcing
        # it: the controller method reads data/run_state.json via
        # run_state.read_run_state() and nothing else. read_run_state only
        # stat/reads the path and never raises; write_run_state and
        # clear_run_state exist in the same module but are not reachable from
        # this tool. No Alpaca call, so unlike get_status/get_view_state this
        # one costs the bridge nothing and does not compete with the control
        # link — which is precisely why it can be polled on the idle path
        # where those two cannot.
        # --- slice 4 (Review & QA screen) — see docs/superpowers/specs/
        # 2026-07-31-slice-4-review-qa.md.
        "qa_tier2",  # "Read-only FITS analysis (photutils)" (server.py:1600)
        # — scores RAW subs into PASS/MARGINAL/REJECT, no motion, no write.
        # Verified against source, same as every entry above. UNLIKE every
        # other tool in this set, it has NO literal `/api/qa_tier2` route —
        # see NO_DIRECT_ROUTE_TOOLS immediately below for why, and
        # qa_analysis.py for the only path allowed to call it.
    }
)

#: Allowlisted (so call_tool's guard permits it, and it IS read-only — see
#: qa_tier2's own comment above) but deliberately given no literal
#: `/api/<tool>` passthrough route, unlike every other ALLOWED_TOOLS member.
#: `qa_tier2` is minutes-long over a real target's 200-1400 subs (measured;
#: see the slice-4 spec §1c) — a direct 1:1 passthrough would be exactly the
#: "synchronous route that takes four minutes" the spec calls unacceptable.
#: The only caller allowed to invoke it is qa_analysis.start_analysis(),
#: wired to /api/qa_analysis_start (see SIDECAR_ROUTES below), which runs it
#: on a background asyncio.Task rather than awaiting it inline in a request
#: handler. Kept out of the route-set invariant test via this set (see
#: test_allowlist.py's `_expected_routes()`) rather than accepted into
#: ALLOWED_TOOLS bare — the alternative would force a literal `/api/qa_tier2`
#: route into existence just to satisfy that invariant, undoing the whole
#: point of this carve-out.
NO_DIRECT_ROUTE_TOOLS = frozenset({"qa_tier2"})

#: Rejected, not merely unlisted: `pi_get_info` is NOT an MCP tool at all —
#: there is no `@mcp.tool()` wrapper for it anywhere in server.py. It is a
#: native Alpaca RPC method (`self.alpaca.method_sync("pi_get_info")`) that
#: check_night_guardrails calls INTERNALLY to read battery, and that verdict
#: does not surface the raw percentage — only a reason string, and only when
#: the battery floor actually trips. Routing a bare tool name through
#: McpConnection.call() that the MCP session never registered would raise
#: (not degrade), so this cannot be added to ALLOWED_TOOLS regardless of how
#: convenient the guardrails card would find a raw number. The battery
#: reading this screen wants genuinely has no read-only route today — see
#: the slice-3 report / hand-back notes, not a bug in this allowlist.

#: Sidecar-computed read views that live under /api/* but are NOT MCP tools —
#: no tool by this name exists on the server, so they can never belong in
#: ALLOWED_TOOLS (record.py and the replay fixtures are keyed by real tool
#: names, and calling one of these through the MCP connection would be a
#: KeyError, not a route). Kept as its own set so the allowlist invariant
#: test can still assert registered /api/* paths equal an EXACT union —
#: {health} | ALLOWED_TOOLS | SIDECAR_ROUTES — rather than being loosened to
#: "at least contains the allowlist" the first time a route exists that
#: doesn't correspond to a tool. Same read-only discipline applies: a route
#: here must only ever compose calls to ALLOWED_TOOLS plus local read-only
#: computation (e.g. the archive scan), never a write.
#:
#: "target_image/{target_id}" carries its FastAPI path template literally
#: (matching `route.path`, not the URL a client actually requests) because
#: the invariant test below builds `{f"/api/{name}" for name in
#: SIDECAR_ROUTES}` and compares it against registered route paths, which
#: keep `{target_id}` unsubstituted. It is still read-only and
#: path-constrained, not a general static mount: see imagery.py's
#: `is_plausible_target_id()` and routes.py's target_image handler — the
#: bytes served always come from either an archive path scan_stacked_images()
#: itself found, or this sidecar's own image cache, never an arbitrary path
#: built from client input.
#:
#: "live_preview" and "live_preview/image" (slice 3) are the same shape as
#: "target_image": no MCP tool by either name exists — live_preview.py's own
#: directory scan of SEESTAR_LIVE_SHARE_DIR is the only thing either route
#: reads, plus (for the metadata route only) a single already-allowlisted
#: get_view_state call to decide whether the scope is even observing. Neither
#: route accepts a path from the client at all — see live_preview.py's module
#: docstring for why that makes this simpler than target_image's id-validation
#: case, not just similar to it.
#:
#: "session_activity" (operator panel) tails SeeStar-AI's provenance.jsonl
#: directly off disk — read-only in the strict sense (never writes, rotates,
#: truncates or locks a file the server itself is actively appending to; see
#: session_activity.py). No MCP tool by this name exists either. Each
#: returned record is classified agent/ambiguous/unknown — see
#: session_activity.py's module docstring for why that classification is
#: deliberately NOT a mechanical function of ALLOWED_TOOLS's tool-name
#: strings alone. NOTE (2026-08-03): that classifier now rests on a false
#: premise. Hand-back item 10 has landed — every provenance record carries
#: `client`, and ours reads "console" — so the tag-matching heuristic is both
#: unnecessary and, since the `alpaca.put.action` tag it keys on is no longer
#: emitted, wrong. Nothing here changes until the classifier is rewritten to
#: read `client`; this note exists so the next reader does not trust it.
#:
#: "qa_targets" / "qa_analysis_start" / "qa_analysis_status" (slice 4,
#: Review & QA screen — see docs/superpowers/specs/
#: 2026-07-31-slice-4-review-qa.md) are none of them a literal tool call:
#: each composes the archive scan (already read for projects_combined) with
#: qa_analysis.py's on-disk cache and in-memory job registry. `qa_tier2` is
#: the one tool any of them ever calls, and only via qa_analysis.
#: start_analysis()'s background asyncio.Task — never awaited inline in a
#: request handler (see NO_DIRECT_ROUTE_TOOLS above for why there is no
#: bare `/api/qa_tier2`).
#:
#: "qa_analysis_start" is the one route in this app with a deliberate,
#: expensive side effect (kicking off a multi-minute analysis) rather than
#: being purely a read. **It is POST, and the method is part of the
#: guarantee** — it began as a GET, on the precedent target_image's GET sets
#: for a cache-populating network fetch (see imagery.py), and that was wrong:
#: a bare `<img src="…/qa_analysis_start?target=M31">` on any page the user
#: happened to have open could spawn minutes of CPU here. CORS does not stop
#: the request being sent, only the response being read, and per-target
#: idempotency is no defence when target ids are guessable. It now also
#: requires the `x-seestar-client` header and checks Origin (see routes.
#: _reject_untrusted_caller). test_allowlist.py declares this path's method
#: set literally, so turning it back into a GET fails the invariant rather
#: than quietly widening the surface.
#:
#: It is idempotent per target: a job already running, or a job/cache hit for
#: the CURRENT sub set, is returned as-is, never re-run (see qa_analysis.
#: start_analysis()). It is also never called on a page load — only from an
#: explicit user action on the client, per CLAUDE.md and the spec's "Do not
#: start an analysis on a page load, ever."
#: "last_stack" and "last_stack/image" (the Live screen's second panel) are
#: the same shape as "live_preview"/"live_preview/image": no MCP tool by
#: either name exists — last_stack.py's own directory scan of
#: SEESTAR_LIVE_SHARE_DIR (the SAME share live_preview.py reads, not a new
#: variable) is the only thing either route reads, plus (for the metadata
#: route only) the same already-allowlisted get_view_state call to find the
#: active target and confirm the scope is observing. Neither route accepts a
#: path from the client either — see last_stack.py's module docstring.
SIDECAR_ROUTES = frozenset(
    {
        "projects_combined",
        "target_image/{target_id}",
        "live_preview",
        "live_preview/image",
        "session_activity",
        "qa_targets",
        "qa_analysis_start",
        "qa_analysis_status",
        # The Seestar's own per-sub JPEG thumbnail, so a Review & QA row can be
        # looked at as well as read. Serves a file the scope already wrote
        # (`<stem>_thn.jpg`, ~15 KB) — no FITS decoding, and nothing is handed
        # to the OS to open. Neither path component is used to build a
        # filesystem path: see the handler.
        "sub_image/{target_id}/{sub_name}",
        "last_stack",
        "last_stack/image",
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
