@echo off
rem zeta-d — desktop bundle CLI/TUI entry. Re-enters the bundled zeta binary
rem with ZETA_DESKTOP_ENTRY=1; `zeta-d -d` opens the desktop GUI (handled by
rem src/cli/desktop-entry.ts). Bare `zeta` always belongs to the npm install.
setlocal
set "ZETA_DESKTOP_ENTRY=1"
"%~dp0..\zeta\zeta.exe" %*
