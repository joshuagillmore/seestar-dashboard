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
    }
)

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
SIDECAR_ROUTES = frozenset({"projects_combined", "target_image/{target_id}"})

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
