# Changelog

## [Unreleased]

## [1.1.26] - 2026-10-03
## [18.5.1] - 2026-10-03

### Fixed

- Fixed macOS computer-use scrolling so takeover and desktop scroll actions move iPhone Mirroring and other pixel-forwarding windows reliably, with smooth mouse-like wheel steps.
- Fixed macOS computer-use value entry for date and time controls, including Calendar date pickers, with support for ISO 8601 dates and date-times and clear validation for unsupported formats.
- Fixed macOS computer-use value entry for popup buttons, allowing options to be selected by title with confirmation and reporting available options when a title is not found.
- Fixed macOS accessibility values for checkboxes, radio buttons, and radio groups so snapshots, attributes, and window information return usable numbers, titles, and referenced element values instead of debug representations.

## [18.5.0] - 2026-10-03

### Fixed

- Fixed Ctrl+V on Windows sometimes pasting text with a few characters replaced by unrelated glyphs (for example `https://` turning into `՞ttp缀難//`); clipboard reads and writes no longer run at the same time ([#14144](https://github.com/can1357/oh-my-pi/pull/14144) by [@H4vC](https://github.com/H4vC))

## [18.4.10] - 2026-10-02

- 版本线推进至 1.1.26；本版无独立用户可见变化。

## [1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- linux-x64/win32-x64 平台二进制随 v18.4.11 源码重编（新增 `commit_tree` 等 vcs 绑定）；版本线对齐。

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
