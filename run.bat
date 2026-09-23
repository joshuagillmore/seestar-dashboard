@echo off
rem Double-click target for the SeeStar Console: runs the sidecar, which
rem serves both the API and the built frontend on one port. See README.md.
rem
rem Drag this file to the desktop (right-click -> Send to -> Desktop, create
rem shortcut) for a one-click launch icon. Extra arguments pass straight
rem through, e.g.:  run.bat --port 8080

cd /d "%~dp0sidecar"
rem WARNING: arguments in %* go straight to the server. "--host 0.0.0.0" (or
rem any LAN address) makes this machine's console reachable from the whole
rem network, and the API has NO authentication - anyone there can read your
rem site and projects and start QA analyses. Leave --host off to stay on
rem 127.0.0.1. See docs/configuration.md, "Network exposure".
uv run seestar-dashboard %*

rem "pause" keeps the window open on both exit paths: a port conflict exits
rem immediately with a one-line message (see launcher.py), and without this
rem a double-clicked .bat would flash that message and close before anyone
rem could read it. A normal run only reaches here after Ctrl+C.
echo.
pause
