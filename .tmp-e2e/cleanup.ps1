Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
	Where-Object { $_.CommandLine -like '*next\dist\bin*' } |
	ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output ("killed node " + $_.ProcessId) }
Get-CimInstance Win32_Process -Filter "Name='bun.exe'" |
	Where-Object { $_.CommandLine -like '*gateway.mjs*' } |
	ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output ("killed bun " + $_.ProcessId) }
Write-Output 'runtime-sweep-done'
