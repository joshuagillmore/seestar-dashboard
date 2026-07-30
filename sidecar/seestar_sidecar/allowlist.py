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
    }
)

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
SIDECAR_ROUTES = frozenset(
    {"projects_combined", "target_image/{target_id}", "live_preview", "live_preview/image"}
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
