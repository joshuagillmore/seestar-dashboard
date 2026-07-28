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
