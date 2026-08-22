param(
	[Parameter(Mandatory = $true)][ValidateSet("install", "remove")]
	[string] $Action,
	[Parameter(Mandatory = $true)]
	[string] $Entry
)

# Adds or removes one PATH entry from the CURRENT USER environment, preserving
# REG_EXPAND_SZ semantics as far as .NET allows and never duplicating entries.
$marker = [regex]::Escape($Entry.TrimEnd('\'))
$current = [Environment]::GetEnvironmentVariable("Path", "User")
if ($null -eq $current) { $current = "" }

$parts = $current.Split(';') | Where-Object { $_ -and ($_ -notmatch "^$marker\\?$") }

if ($Action -eq "install") {
	$parts = @($parts) + $Entry
}

$new = ($parts -join ';')
if ($new -ne $current) {
	[Environment]::SetEnvironmentVariable("Path", $new, "User")
}
