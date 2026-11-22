; Zeta desktop — NSIS customizations.
; Adds the zeta-d shim directory (<install>\resources\bin) to the user PATH so
; `zeta-d` (bundled CLI/TUI) and `zeta-d -d` (desktop GUI) resolve from any
; shell. Bare `zeta` is never registered: it always belongs to the npm install.
; The actual registry edit lives in resources\bin\add-to-path.ps1 so the logic
; stays readable and testable outside NSIS.

!macro customInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\bin\add-to-path.ps1" -Action install -Entry "$INSTDIR\resources\bin"'
  ; electron-builder's shortcut update path preserves an existing .lnk when the
  ; target path is unchanged. Windows then cannot associate the window's
  ; runtime AppUserModelID with the taskbar shortcut, so repair both shortcuts
  ; explicitly on every install/update. Keep this in sync with
  ; app.setAppUserModelId("com.zeta.desktop") in src/main.ts.
  ${If} ${FileExists} "$APPDATA\Microsoft\Windows\Start Menu\Programs\Zeta.lnk"
    WinShell::SetLnkAUMI "$APPDATA\Microsoft\Windows\Start Menu\Programs\Zeta.lnk" "com.zeta.desktop"
  ${EndIf}
  ${If} ${FileExists} "$DESKTOP\Zeta.lnk"
    WinShell::SetLnkAUMI "$DESKTOP\Zeta.lnk" "com.zeta.desktop"
  ${EndIf}
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\bin\add-to-path.ps1" -Action remove -Entry "$INSTDIR\resources\bin"'
!macroend
