# Changelog

## [Unreleased]

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：新增 rasterizeSvg，SHA-2/SHA-3 ARM64 加速。

## [1.1.3] - 2026-08-25
## [18.0.9] - 2026-08-28

### Breaking Changes

- Replaced the Git-specific `watchHead` and `headWatchTarget` API with the backend-neutral `watch` and `VcsRepo.watchTarget` APIs.

### Added

- Added portable repository discovery and read operations through `VcsRepo`, `repo()`, and `require()`, with support for Git and Jujutsu and explicit capability checks for staged and revision diffs.
- Added the `Vcs*` API for repository operations across Git and Jujutsu, including repository discovery, refs and status, diffs, staging, commits, branches, worktrees, patch application, stash, cherry-pick, and CLI-backed push, fetch, and clone operations with cancellation support.

### Fixed

- Fixed Git intent-to-add files so they appear correctly as unstaged additions in `statusPorcelain` and are handled correctly when staging or applying patches.

## [18.0.8] - 2026-08-27

### Fixed

- Large session histories no longer leave macOS Terminal unresponsive during repaint.
- Bounded the interactive PTY reader→JS queue (64 × ≤64 KiB) and forward chunks through a separate `call_async` pump so a fast child plus a stalled JS consumer cannot accumulate unbounded output in-process, without freezing PTY input/resize/kill. After a finite child exit, wait until accepted output reaches `on_chunk`; only a permanently open slave skips that wait. Cancel, timeout, and that stuck-open path abort the pump before `start()` resolves. Same defect class as the non-PTY bash bridge (#4078).

## [18.0.6] - 2026-08-26

### Fixed

- Republished as 1.1.3 to reset the latest tag after the broken 1.1.2 (no functional change over 1.1.1).

## [1.1.2] - 2026-08-25

### Fixed

- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).

## [1.1.1] - 2026-08-25

### Fixed

- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").

## [1.1.0] - 2026-08-25

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
