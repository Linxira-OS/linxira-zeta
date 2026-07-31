# Symlink the zeta extension package into ~/.pi/agent/extensions/ for local dev.
# Uses a directory junction (no admin rights needed on Windows).

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot "packages\zeta-extensions"
$targetDir = Join-Path $env:USERPROFILE ".pi\agent\extensions"
$target = Join-Path $targetDir "zeta-extensions"

if (-not (Test-Path -LiteralPath $source)) {
	throw "Source extension package not found: $source"
}

New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

if (Test-Path -LiteralPath $target) {
	$item = Get-Item -LiteralPath $target
	if ($item.LinkType -eq "Junction" -or $item.LinkType -eq "SymbolicLink") {
		Write-Host "Removing existing link: $target"
		Remove-Item -LiteralPath $target -Force
	} else {
		throw "Refusing to overwrite non-link path: $target"
	}
}

New-Item -ItemType Junction -Path $target -Target $source | Out-Null
Write-Host "Linked: $target -> $source"
Write-Host "Restart pi (or /reload) to pick up the extension."
