# Changelog

## [Unreleased]

## [1.1.8] - 2026-09-04

- OMP sync v18.1.2–v18.1.5: pi-vcs index-refresh path (`load_index_or_head`/`status_with_fresh_index`) and natives surface updates.

## [1.1.7] - 2026-09-01

- 同步上游 OMP v18.0.11（`b8ce33a58911c26bed1d84f0db9a5e2e727c49a2`）。

## [1.1.6] - 2026-08-30

- 同步上游 OMP v18.0.10（`33cc6b9a043a`）：新增原生进程替换（支持 CLI `/restart`）与 `VcsGitRepo.mergeBase(a, b)`。
- 修复：加载原生 addon 后 Tokio 共享运行时未安装（loader 调用名与 crate 导出不一致），异步原生操作静默回退默认运行时。

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：新增 rasterizeSvg，SHA-2/SHA-3 ARM64 加速。

## [1.1.1] - 2026-08-25

### Fixed

- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").

## [1.1.0] - 2026-08-25
## [18.1.9] - 2026-09-04

### Added

- Added native Sixel-to-PNG decoding for terminal graphics returned by shell commands.
- Added transactional native OAuth callback registration with one-shot callback delivery on macOS, Linux desktops, and Windows.

### Fixed

- Fixed native version-control cleanup to respect ignore rules and path boundaries while safely handling symlinks, nested repositories, and submodules.

## [18.1.7] - 2026-09-03

### Added

- Added Windows ARM64 native addon support, including platform-specific npm packages.

## [18.1.6] - 2026-09-03

### Breaking Changes

- Renamed `MacOSPowerAssertion` to `PowerAssertion` and `MacOSPowerAssertionOptions` to `PowerAssertionOptions`; the options and handle shapes are unchanged.

### Added

- Added edit-session and edit-store types and utilities for managing edit states, snapshots, hashline operations, edit modes, edit descriptions, editable notebook text, and inline sloppy regions.
- Added cross-platform sleep inhibition to `PowerAssertion` on Linux and Windows.

### Changed

- `PowerAssertion.start` now reports acquisition failures on Linux and Windows instead of returning a handle that silently does nothing; platforms without an implementation continue to receive a no-op handle.

### Fixed

- Fixed native `git add` so staging an empty file list no longer stages macOS filename-normalization duplicates of tracked paths or files ignored only by a nested `.gitignore`.

## [18.1.5] - 2026-09-03

### Changed

- npm 包 repository 字段指向 linxira-zeta（修正上游 OMP 仓库 URL）。
- 同步上游 OMP v18.0.3 / v18.0.4（native 绑定与构建改进）。

## [1.0.4] - 2026-08-18

### Added

- Restored the `pdfToMarkdown` export in the published npm package. The `@linxiraos/pi-natives@1.0.2` npm publish predated the v17.3.5 merge and shipped neither the export nor the matching native symbol, so npm-installed zeta crashed at load with `SyntaxError: Export named 'pdfToMarkdown' not found`. This release bumps the package (with the `__piNativesV1_0_4` sentinel) so the rebuilt addons and bindings reach npm; omptype/wire stay at 1.0.2.

## [1.0.1] - 2026-08-14

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.

## [1.0.0] - 2026-08-13

### Changed

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.
