$env:ZETA_WEB_GATEWAY_URL = 'http://127.0.0.1:30145'
Start-Process -FilePath 'E:\Program Files\nodejs\node.exe' `
	-ArgumentList 'node_modules\next\dist\bin\next', 'dev', '-p', '30144' `
	-WorkingDirectory 'C:\Users\ETPau\Documents\GITHUB\zeta-slash\web-ui' `
	-RedirectStandardOutput 'C:\Users\ETPau\Documents\GITHUB\zeta-slash\.tmp-e2e\next.log' `
	-RedirectStandardError 'C:\Users\ETPau\Documents\GITHUB\zeta-slash\.tmp-e2e\next.err' `
	-WindowStyle Hidden
Write-Output 'launched-turbopack'
