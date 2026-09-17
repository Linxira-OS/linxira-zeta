; Zeta desktop — NSIS customizations.
; Adds the zeta-d shim directory (<install>\resources\bin) to the user PATH so
; `zeta-d` (bundled CLI/TUI) and `zeta-d -d` (desktop GUI) resolve from any
; shell. Bare `zeta` is never registered: it always belongs to the npm install.
; The actual registry edit lives in resources\bin\add-to-path.ps1 so the logic
; stays readable and testable outside NSIS.

!macro customInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\bin\add-to-path.ps1" -Action install -Entry "$INSTDIR\resources\bin"'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\bin\add-to-path.ps1" -Action remove -Entry "$INSTDIR\resources\bin"'
!macroend
