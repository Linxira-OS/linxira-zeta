# Changelog

## [Unreleased]

## [1.1.23] - 2026-10-01
## [1.1.22] - 2026-09-30
## [18.4.10] - 2026-10-02

### Fixed

- Fixed the embedded shell sometimes hanging on a pipeline with a stage that stopped (for example with `kill -STOP $$`) before the shell began waiting on it; the pipeline now becomes a stopped job ([#14023](https://github.com/can1357/oh-my-pi/pull/14023) by [@sjawhar](https://github.com/sjawhar))

## [18.4.9] - 2026-10-01

### Added

- Added `readTextFromClipboard()` for reading plain text from the system clipboard without starting a subprocess.
- Added `Shell.pids()` to retrieve the IDs of still-running processes spawned by an in-flight shell command.

## [18.4.7] - 2026-10-01

### Fixed

- Fixed omp 18.4.3 and later crashing with a segmentation fault at startup on Apple silicon Macs running macOS older than 27; Apple Foundation Models support now loads only on macOS 27 and later

## [18.4.5] - 2026-09-30

### Fixed

- Fixed macOS spell checking and Apple word completion adding a duplicate terminal icon to the Dock for every omp session ([#12491](https://github.com/can1357/oh-my-pi/issues/12491))
- Fixed `computer.windows()` on macOS marking every window of the frontmost app as focused. One window is marked now: the app's accessibility focused window, or its frontmost window when Accessibility permission is not granted. With the permission, `computer.focusedWindow()` no longer returns a floating panel such as TextEdit's Fonts panel in front of the document ([#13673](https://github.com/can1357/oh-my-pi/pull/13673) by [@will-bogusz](https://github.com/will-bogusz)).
- Fixed non-Latin prompts that quote code in backticks or fences losing most of their prose score, which made the typing predictor's vocabulary refuse to learn them ([#13758](https://github.com/can1357/oh-my-pi/pull/13758) by [@jchanghong023](https://github.com/jchanghong023)).
- Fixed `computer.window(...).ax()` leaving out everything inside an unnamed container. On macOS, Reminders, Contacts, Notes and Font Book windows showed only their toolbar and window buttons, and Calendar lost its month grid; Windows and Linux trees now also keep content under unnamed containers such as custom panes, lists and fillers ([#13822](https://github.com/can1357/oh-my-pi/pull/13822) by [@will-bogusz](https://github.com/will-bogusz)).
- Fixed Wayland `computer.drag()` sending all waypoints in one burst, preventing HTML5 drag-and-drop targets from receiving `drop` ([#13860](https://github.com/can1357/oh-my-pi/issues/13860)).
- Fixed Wayland computer input staying unavailable after a cancelled RemoteDesktop permission prompt or a disconnected input session ([#13857](https://github.com/can1357/oh-my-pi/issues/13857)).
- Fixed Wayland `win.screenshot()` returning the top-left of the monitor for native Wayland windows whose position AT-SPI cannot report (Discord, Teams, Chromium); it now fails with `CaptureFailed` instead of capturing the wrong region ([#13854](https://github.com/can1357/oh-my-pi/issues/13854)).
- Fixed `computer.focusedElement()` failing with `AxFailed: atspi: null reference` on Linux while a Chromium or Electron app (Spotify, Discord, Steam, …) is running ([#13855](https://github.com/can1357/oh-my-pi/issues/13855)).

## [18.4.4] - 2026-09-29

- 版本线 1.1.22:sentinel `__piNativesV1_1_22` 与 committed bindings 同步。

## [1.1.11] - 2026-09-08

- OMP v18.1.13 + v18.1.14 dual-tag sync baseline; no package-specific user-visible changes.

## [1.1.10] - 2026-09-07

- OMP v18.1.11 sync baseline (`e3106be68f`); no package-specific user-visible changes.

## [1.1.9] - 2026-09-05

- v18.1.10 baseline: new Rust edit engine surface (EditStore/EditSession/DiffStream, editDescription) and hashline mode consolidated into crates/pi-edit; sentinel stays on the Zeta version line.

## [1.1.8] - 2026-09-04

- OMP sync v18.1.2–v18.1.5: pi-vcs index-refresh path (`load_index_or_head`/`status_with_fresh_index`) and natives surface updates.

## [1.1.7] - 2026-09-01

- 同步上游 OMP v18.0.11（`b8ce33a58911c26bed1d84f0db9a5e2e727c49a2`）。

## [1.1.6] - 2026-08-30

- 同步上游 OMP v18.0.10（`33cc6b9a043a`）：新增原生进程替换（支持 CLI `/restart`）与 `VcsGitRepo.mergeBase(a, b)`。
- 修复：加载原生 addon 后 Tokio 共享运行时未安装（loader 调用名与 crate 导出不一致），异步原生操作静默回退默认运行时。

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：新增 rasterizeSvg，SHA-2/SHA-3 ARM64 加速。
