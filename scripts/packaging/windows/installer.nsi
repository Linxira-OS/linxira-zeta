; zetawork per-user installer (NSIS 3).
;
; Built by `scripts/package-desktop-archives.ts windows-installer`, which
; stages these files into SOURCE_DIR:
;
;   zetawork-gui.exe      the desktop shell
;   zetacode.exe          companion CLI (resolved beside the GUI)
;   zetaide.exe           companion IDE
;   zetawork.exe          the TUI command
;   WebView2Loader.dll    dynamic import of the GUI's PE
;
; All of them land beside each other — `main/crates/zetawork-gui/src/
; zetacode.rs` resolves the companions from the GUI's own directory and never
; consults PATH.
;
; Per-user install: no UAC prompt, no machine-wide state.
; `%LOCALAPPDATA%\Programs\zetawork`, Start Menu shortcut, uninstall entry.
; No network access anywhere in this script.

Unicode true
RequestExecutionLevel user

!include "FileFunc.nsh"

!ifndef APP_VERSION
  !define APP_VERSION "0.0.0"
!endif
!ifndef SOURCE_DIR
  !define SOURCE_DIR "."
!endif
!ifndef OUT_FILE
  !define OUT_FILE "zetawork-setup-x64.exe"
!endif

!define PRODUCT_NAME "zetawork"
!define PRODUCT_PUBLISHER "Zeta"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\zetawork"

Name "${PRODUCT_NAME} ${APP_VERSION}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\zetawork"
InstallDirRegKey HKCU "Software\zetawork" "InstallDir"
BrandingText "${PRODUCT_NAME}"
ShowInstDetails show
ShowUninstDetails show

; The first page offers the optional desktop shortcut section unchecked, so the
; default install touches only the Start Menu.
Page directory
Page components
Page instfiles

UninstPage uninstConfirm
UninstPage instfiles

Section "-PreInstall"
  ; A running shell holds the exe open and File would fail. taskkill without
  ; /IM match is a no-op returning non-zero; ignore the exit code.
  nsExec::ExecToLog 'taskkill /F /IM zetawork-gui.exe'
  Pop $0
  Sleep 300
SectionEnd

Section "zetawork (required)" SEC_CORE
  SectionIn RO
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File "${SOURCE_DIR}/zetawork-gui.exe"
  File "${SOURCE_DIR}/zetacode.exe"
  File "${SOURCE_DIR}/zetaide.exe"
  File "${SOURCE_DIR}/zetawork.exe"
  File "${SOURCE_DIR}/WebView2Loader.dll"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  CreateDirectory "$SMPROGRAMS"
  CreateShortcut "$SMPROGRAMS\zetawork.lnk" "$INSTDIR\zetawork-gui.exe"

  WriteRegStr HKCU "Software\zetawork" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\zetawork-gui.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" "$0"
SectionEnd

Section /o "Desktop shortcut" SEC_DESKTOP
  SetShellVarContext current
  CreateShortcut "$DESKTOP\zetawork.lnk" "$INSTDIR\zetawork-gui.exe"
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog 'taskkill /F /IM zetawork-gui.exe'
  Pop $0
  Sleep 300

  SetShellVarContext current
  Delete "$SMPROGRAMS\zetawork.lnk"
  Delete "$DESKTOP\zetawork.lnk"

  Delete "$INSTDIR\zetawork-gui.exe"
  Delete "$INSTDIR\zetacode.exe"
  Delete "$INSTDIR\zetaide.exe"
  Delete "$INSTDIR\zetawork.exe"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\zetawork"
SectionEnd
