#!/usr/bin/env pwsh
# Launch the source checkout under the developer isolation profile.
# Thin wrapper around scripts/dev-isolated.ts; see docs/dev-isolation.md.
$ErrorActionPreference = "Stop"
$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) {
    Write-Error "dev-isolated: bun is required on PATH (https://bun.sh)"
    exit 1
}
& $bun.Source (Join-Path $PSScriptRoot "dev-isolated.ts") @args
exit $LASTEXITCODE
