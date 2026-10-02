# Changelog

## [Unreleased]

## [1.1.23] - 2026-10-01
## [18.4.4] - 2026-09-29

### Fixed

- Fixed `computer.window(id).ax()` and `find()` failing with `AxFailed` on macOS sheets, popovers and open menus that `computer.windows()` lists, such as TextEdit's Save sheet or a Calendar event popover ([#13659](https://github.com/can1357/oh-my-pi/pull/13659) by [@will-bogusz](https://github.com/will-bogusz)).
- Fixed macOS 26 background scrolls moving twice the requested distance; background hovers, scrolls and right or middle clicks are now delivered once ([#13739](https://github.com/can1357/oh-my-pi/pull/13739) by [@will-bogusz](https://github.com/will-bogusz)).
- Fixed macOS `takeover` clicks and scrolls failing with `AX action 'AXRaise' failed (AXError(-25205))` on covered windows that do not support `AXRaise`, such as iPhone Mirroring, even when activation brings them forward; a window that stays covered still refuses before any input is sent ([#13737](https://github.com/can1357/oh-my-pi/pull/13737) by [@will-bogusz](https://github.com/will-bogusz)).
- Fixed `ps -r` in the in-process `ps` builtin: it now sorts by CPU usage, highest first, as on macOS/BSD, instead of filtering to running processes. Also added `ps -m`, which sorts by memory usage.
- Fixed process states on macOS in the `ps`, `top`, and `pgrep`/`pkill -r` builtins: idle processes showed as running (`R`), which made `ps r` list nearly every process. States now come from each process's threads, as Apple `ps` does.
- Removed the procps-only `l` (multithreaded) STAT flag from `ps` on macOS; Apple `ps` doesn't print it.

## [18.4.3] - 2026-09-28

## [1.1.22] - 2026-09-30

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
