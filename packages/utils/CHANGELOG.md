# Changelog

## [Unreleased]

## [1.1.8] - 2026-09-04
## [18.1.7] - 2026-09-03

### Added

- Added the public `getTinyWorkerRuntimeDir()` utility, which returns the standard `~/.omp/run/tiny` directory for tiny-worker runtime data.

## [18.1.6] - 2026-09-03

### Added

- Added `IncomingDoc` (`@linxiraos/pi-utils/incoming-json`) for incrementally reading path-addressed JSON data as text arrives, including string chunks and lines, array elements, and keyed object values, with structured errors for missing, incomplete, aborted, malformed, or mismatched data.
- Added `Serial` for running asynchronous operations sequentially in call order.

### Fixed

- Fixed relaxed JSON parsing for single-quoted strings followed by line or block comments.

## [18.1.5] - 2026-09-03

- Added `symlinkDirectorySync` — Windows-correct directory links (junction) for tests and tooling that must link temp trees without elevation.
- Extended the temp-removal retry window to 7.5s: measured Windows handle-release latency after a child process dies reaches ~5s, and the previous 2s window flaked suites cleaning up trees containing SQLite databases.

## [1.1.6] - 2026-08-30

- 同步上游 OMP v18.0.10（`33cc6b9a043a`）。
- 同步上游 OMP v18.0.9（`cc14e04f075d`）。

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：新增 browsers / json 工具，SHA-2/SHA-3 在 ARM64 上加速。

## [1.1.2] - 2026-08-25

### Fixed

- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).

## [1.1.1] - 2026-08-25

### Fixed

- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").

## [1.1.0] - 2026-08-25

### Changed

- 同步上游 OMP v18.0.3 / v18.0.4（内部运行时与构建改进，无独立用户可见变更）。

## [1.0.0] - 2026-08-13

### Changed

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.
