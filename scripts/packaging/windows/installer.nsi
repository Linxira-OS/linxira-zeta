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
;   web-ui/               the browser UI `zetacode serve` hosts
;
; All of them land beside each other — `main/crates/zetawork-gui/src/
; zetacode.rs` resolves the companions from the GUI's own directory and never
; consults PATH.
;
; Per-user install: no UAC prompt, no machine-wide state.
; `%LOCALAPPDATA%\Programs\Linxira Zeta`, Start Menu shortcut, uninstall entry.
; No network access anywhere in this script.
;
; Silent contract (`/S`): nothing is created on the desktop and no autostart
; task is registered unless `/DESKTOP=1` / `/AUTOSTART=1` are passed. Package
; managers and scripts silent-install us and have no UI to ask with, so the
; safe default is "no side effects outside the install directory".

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
!define MUI_LANGDLL_REGISTRY_KEY "Software\LinxiraZeta"
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

; `SOURCE_DIR` comes from `Bun.mkdtemp`: `/tmp/...` on Linux and `\tmp\...`
; on Windows. NSIS resolves only the host separator, so probe the staged GUI
; once and keep one spelling for every `File`/icon directive.
!if /FileExists "${SOURCE_DIR}/zetawork-gui.exe"
  !define SRC "${SOURCE_DIR}/"
!else
  !define SRC "${SOURCE_DIR}\"
!endif

!define PRODUCT_NAME "Linxira Zeta"
!define PRODUCT_PUBLISHER "Linxira OS"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\LinxiraZeta"

Name "${PRODUCT_NAME} ${APP_VERSION}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Linxira Zeta"
InstallDirRegKey HKCU "Software\LinxiraZeta" "InstallDir"
BrandingText "${PRODUCT_NAME}"
ShowInstDetails show
ShowUninstDetails show

; Icon for the installer itself and its Add/Remove entry. The packaging
; script stages it beside the executables (`SOURCE_DIR`).
!define MUI_ICON "${SRC}zetawork.ico"
!define MUI_UNICON "${SRC}zetawork.ico"
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

LangString SEC_CORE_NAME ${LANG_ENGLISH} "Linxira Zeta (required)"
LangString SEC_CORE_NAME ${LANG_SIMPCHINESE} "Linxira Zeta（必需）"
LangString SEC_DESKTOP_NAME ${LANG_ENGLISH} "Desktop shortcut"
LangString SEC_DESKTOP_NAME ${LANG_SIMPCHINESE} "桌面快捷方式"
LangString DESC_CORE ${LANG_ENGLISH} "zetawork, its terminal, the coding agent and the IDE, installed side by side for this user."
LangString DESC_CORE ${LANG_SIMPCHINESE} "zetawork、终端、编码代理与 IDE，安装到当前用户目录。"
LangString DESC_DESKTOP ${LANG_ENGLISH} "Put a Linxira Zeta shortcut on the desktop."
LangString DESC_DESKTOP ${LANG_SIMPCHINESE} "在桌面创建 Linxira Zeta 快捷方式。"
LangString SEC_AUTOSTART_NAME ${LANG_ENGLISH} "Start the backend at login (recommended)"
LangString SEC_AUTOSTART_NAME ${LANG_SIMPCHINESE} "开机自动启动后台服务（推荐）"
LangString DESC_AUTOSTART ${LANG_ENGLISH} "A per-user scheduled task starts the backend three minutes after you sign in, so terminals and browsers can reach it without opening the app. You can turn it off in Settings."
LangString DESC_AUTOSTART ${LANG_SIMPCHINESE} "登录后三分钟由当前用户的计划任务启动后台服务，终端与浏览器无需先打开应用即可连接。可在设置里关闭。"
LangString SILENT_NOTE ${LANG_ENGLISH} "Silent install: no desktop shortcut or autostart entry unless /DESKTOP=1 and /AUTOSTART=1 are passed."
LangString SILENT_NOTE ${LANG_SIMPCHINESE} "静默安装：除非显式传入 /DESKTOP=1 与 /AUTOSTART=1，否则不创建桌面快捷方式与开机自启。"

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
  File "${SRC}zetawork-gui.exe"
  File "${SRC}zetacode.exe"
  File "${SRC}zetaide.exe"
  File "${SRC}zetawork.exe"
  File "${SRC}WebView2Loader.dll"
  File "${SRC}zetawork.ico"
  File "${SRC}THIRD-PARTY-NOTICES.txt"
  File "${SRC}MapleMono-OFL.txt"
  ; The browser UI `zetacode serve` hosts, in the layout it resolves from its
  ; own directory (`web-ui/.next/standalone/server.js`).
  File /r "${SRC}web-ui"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  CreateDirectory "$SMPROGRAMS"
  CreateShortcut "$SMPROGRAMS\zetawork.lnk" "$INSTDIR\zetawork-gui.exe" "" "$INSTDIR\zetawork.ico" 0

  WriteRegStr HKCU "Software\LinxiraZeta" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\zetawork.ico"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" "$0"
SectionEnd

; Checked by default: a desktop app that leaves no desktop icon is not
; discoverable, and the section is still there for anyone who wants it off.
; Silent installs create nothing unless /DESKTOP=1 was passed — a package
; manager or a script silent-installing us must not decorate the desktop.
Section "$(SEC_DESKTOP_NAME)" SEC_DESKTOP
  ${If} ${Silent}
    ${GetOptions} $CMDLINE "/DESKTOP=" $0
    ${If} $0 != "1"
      Goto done_desktop
    ${EndIf}
  ${EndIf}
  SetShellVarContext current
  CreateShortcut "$DESKTOP\zetawork.lnk" "$INSTDIR\zetawork-gui.exe" "" "$INSTDIR\zetawork.ico" 0
  done_desktop:
SectionEnd

; The OS autostart component the bundle is allowed to own (see
; `zetacode daemon install-autostart`): a per-user scheduled task, three
; minutes after login, gated by the `backend.autostart` setting it also writes.
Section "$(SEC_AUTOSTART_NAME)" SEC_AUTOSTART
  ${If} ${Silent}
    ${GetOptions} $CMDLINE "/AUTOSTART=" $0
    ${If} $0 != "1"
      Goto done_autostart
    ${EndIf}
  ${EndIf}
  nsExec::ExecToLog '"$INSTDIR\zetacode.exe" daemon install-autostart'
  Pop $0
  done_autostart:
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_CORE} $(DESC_CORE)
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESKTOP} $(DESC_DESKTOP)
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_AUTOSTART} $(DESC_AUTOSTART)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  nsExec::ExecToLog 'taskkill /F /IM zetawork-gui.exe'
  Pop $0
  Sleep 300

  ; Remove the OS autostart component before its binary goes away.
  nsExec::ExecToLog '"$INSTDIR\zetacode.exe" daemon uninstall-autostart'
  Pop $0

  SetShellVarContext current
  Delete "$SMPROGRAMS\zetawork.lnk"
  Delete "$DESKTOP\zetawork.lnk"

  Delete "$INSTDIR\zetawork-gui.exe"
  Delete "$INSTDIR\zetacode.exe"
  Delete "$INSTDIR\zetaide.exe"
  Delete "$INSTDIR\zetawork.exe"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\zetawork.ico"
  Delete "$INSTDIR\THIRD-PARTY-NOTICES.txt"
  Delete "$INSTDIR\MapleMono-OFL.txt"
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR\web-ui"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\LinxiraZeta"
SectionEnd
