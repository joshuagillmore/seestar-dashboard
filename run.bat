@echo off
rem Double-click target for the SeeStar Console: runs the sidecar, which
rem serves both the API and the built frontend on one port. See README.md.
rem
rem Drag this file to the desktop (right-click -> Send to -> Desktop, create
rem shortcut) for a one-click launch icon. Extra arguments pass straight
rem through, e.g.:  run.bat --port 8080

cd /d "%~dp0sidecar"
uv run seestar-dashboard %*

rem "pause" keeps the window open on both exit paths: a port conflict exits
rem immediately with a one-line message (see launcher.py), and without this
rem a double-clicked .bat would flash that message and close before anyone
rem could read it. A normal run only reaches here after Ctrl+C.
echo.
pause
