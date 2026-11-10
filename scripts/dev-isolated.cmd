@echo off
setlocal
where bun >nul 2>nul
if errorlevel 1 (
    echo dev-isolated: bun is required on PATH ^(https://bun.sh^) 1>&2
    exit /b 1
)
bun "%~dp0dev-isolated.ts" %*
exit /b %ERRORLEVEL%
