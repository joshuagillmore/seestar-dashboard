repo: OrangeAgente/SeeStar-AI
branch: main

## Last sync

date: 2026-07-27T16:03:31Z

### Updated in this project

- Read the repo end to end: no UI exists (Python MCP server + Claude Code skills), so the dashboard is designed from the real data model rather than recreated.
- Screens grounded in the actual tool surface: `assess_conditions` / `plan_targets` (Tonight), `qa_tier1` + `get_view_state` (Live), `qa_session_report` + qa-policy thresholds (Review), `list_projects` (Projects).
- Verdict thresholds, metric names and defaults lifted verbatim from `src/seestar_mcp/config.py` and `skills/qa-policy/SKILL.md`.
- Frame geometry, 10 s alt-az exposure cap, GRBG/1080×1920 portrait subs and filter naming (`_LP_` / `_IRCUT_`) taken from `docs/seestar-s50-specs.md` and `skills/run-session/SKILL.md`.

## Screen map

| Screen | Repo files |
|---|---|
| Tonight (plan) | skills/observing-planner/SKILL.md, README.md (planning tools), src/seestar_mcp/config.py |
| Live session | skills/run-session/SKILL.md, docs/seestar-s50-specs.md, README.md (control/QA tools) |
| Review (QA) | skills/qa-policy/SKILL.md, src/seestar_mcp/config.py (SEESTAR_QA_* defaults), README.md (seestar-refine) |
| Projects | README.md (projects/history tools) |
| Mobile | skills/run-session/SKILL.md (Remote Control operating assumptions) |
