# Changelog

## [Unreleased]

## [1.1.20] - 2026-09-23
## [18.2.7] - 2026-09-21

### Added

- Added `renderMermaidAscii`, a native Mermaid-to-ASCII/Unicode renderer supporting flowcharts, state, sequence, class, ER, and xychart diagrams with color modes, themes, and direction overrides.
- Added a `default` package export condition so CommonJS consumers, including bytecode bundles, can load the native bindings.

### Changed

- Improved Mermaid flowchart rendering to respect dependency order, reduce crossings, align branches, and wrap long labels without truncation.

### Fixed

- Fixed Mermaid rendering issues involving arrowhead alignment and duplicate edge junctions around mixed-width node shapes.
- Fixed sloppy edit grammar compatibility with Codex constrained decoding.

## [18.2.1] - 2026-09-15

- 版本线推进;`crates/*/BUILD.bazel` 版本属性同步(setter 正则改为匹配任意缩进),修复 9 个 crate 自 1.1.17 起的版本漂移。

## [1.1.19] - 2026-09-22

- 版本线推进;本版无独立用户可见变化。

## [1.1.18] - 2026-09-22

- 包元数据:author/maintainer 更新为 Linxira-OS,LICENSE 追加 Linxira-OS 版权行(发行面变更)。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 维护同步(原生哨兵版本线不变)。

## [1.1.13] - 2026-09-10

- 版本线对齐 1.1.13(natives 哨兵同步)。

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
