Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
	Where-Object { $_.CommandLine -like '*next*dist*bin*next*dev*' -or $_.CommandLine -like '*next\dist\bin*' } |
	ForEach-Object {
		Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
		Write-Output ("killed " + $_.ProcessId + " :: " + $_.CommandLine.Substring(0, [Math]::Min(90, $_.CommandLine.Length)))
	}
Write-Output 'sweep-done'
