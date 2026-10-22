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
!include "MUI2.nsh"
!include "LogicLib.nsh"

; Two languages, picked by the installer UI (and by the user's Windows
; language on first run). Every page below is an MUI page so the strings —
; buttons, headings, the uninstall prompt — come from the language files
; instead of NSIS's built-in English.
!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "Software\zetawork"
!define MUI_LANGDLL_REGISTRY_VALUENAME "InstallerLanguage"

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

; Icon for the installer itself and its Add/Remove entry. The packaging
; script stages it beside the executables (`SOURCE_DIR`).
!define MUI_ICON "${SOURCE_DIR}\\zetawork.ico"
!define MUI_UNICON "${SOURCE_DIR}\\zetawork.ico"
!define MUI_ABORTWARNING

; Language selection is the language dialog MUI2 shows from .onInit (there is
; no language *page* macro); then the standard pages.
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

LangString SEC_CORE_NAME ${LANG_ENGLISH} "zetawork (required)"
LangString SEC_CORE_NAME ${LANG_SIMPCHINESE} "zetawork（必需）"
LangString SEC_DESKTOP_NAME ${LANG_ENGLISH} "Desktop shortcut"
LangString SEC_DESKTOP_NAME ${LANG_SIMPCHINESE} "桌面快捷方式"
LangString DESC_CORE ${LANG_ENGLISH} "zetawork, its terminal, the coding agent and the IDE, installed side by side for this user."
LangString DESC_CORE ${LANG_SIMPCHINESE} "zetawork、终端、编码代理与 IDE，安装到当前用户目录。"
LangString DESC_DESKTOP ${LANG_ENGLISH} "Put a zetawork shortcut on the desktop."
LangString DESC_DESKTOP ${LANG_SIMPCHINESE} "在桌面创建 zetawork 快捷方式。"

Function .onInit
  !insertmacro MUI_LANGDLL_DISPLAY
FunctionEnd

Section "-PreInstall"
  ; A running shell holds the exe open and File would fail. taskkill without
  ; /IM match is a no-op returning non-zero; ignore the exit code.
  nsExec::ExecToLog 'taskkill /F /IM zetawork-gui.exe'
  Pop $0
  Sleep 300
SectionEnd

Section "$(SEC_CORE_NAME)" SEC_CORE
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
  CreateShortcut "$SMPROGRAMS\zetawork.lnk" "$INSTDIR\zetawork-gui.exe" "" "$INSTDIR\zetawork-gui.exe" 0

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

; Checked by default: a desktop app that leaves no desktop icon is not
; discoverable, and the section is still there for anyone who wants it off.
Section "$(SEC_DESKTOP_NAME)" SEC_DESKTOP
  SetShellVarContext current
  CreateShortcut "$DESKTOP\zetawork.lnk" "$INSTDIR\zetawork-gui.exe" "" "$INSTDIR\zetawork-gui.exe" 0
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_CORE} $(DESC_CORE)
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESKTOP} $(DESC_DESKTOP)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

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
