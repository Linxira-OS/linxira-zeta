# Changelog

## [Unreleased]

## [1.1.14] - 2026-09-12

- 随 1.1.14 版本线发布:bazel 构建面(crates/*/BUILD.bazel)版本号纳入一致性检查,CI 原生构建与桌面冒烟守卫修复。

## [1.1.13] - 2026-09-10

- 上游 v18.1.16 同步,内部修复。

## [1.1.12] - 2026-09-10

- 同步 worker 选择器与主 CLI 的 `__zeta_worker_*` 家族对齐,修复 stats 子系统无法启动的问题。

## [1.1.11] - 2026-09-08

- OMP v18.1.13 + v18.1.14 dual-tag sync baseline; no package-specific user-visible changes.

## [1.1.10] - 2026-09-07

- OMP v18.1.11 sync baseline (`e3106be68f`); no package-specific user-visible changes.

## [1.1.9] - 2026-09-05

- v18.1.10 sync baseline (stats tracking panel updates).

## [1.1.8] - 2026-09-04

- OMP sync v18.1.2–v18.1.5: `/trace` tracking panel, compaction summary persistence, and stats-sync worker alignment.

## [1.1.5] - 2026-08-26

- 随 1.1.5 版本线对齐发布：OMP v18.0.6 同步未触及本包，无独立功能变更。

## [1.1.4] - 2026-08-26
## [18.1.17] - 2026-09-10

### Fixed

- Fixed historical cost estimates after a scheduled price change: usage is estimated at the request's own time, and charges recorded at the time are preserved.
- Fixed legacy requests that recorded no cost at all being stored as free usage: they are estimated at their request timestamp, and requests without a recoverable timestamp stay unpriced instead of being billed as 1970.
- Fixed a legacy entry whose malformed token counter was summed into an inflated request total; counters that are not finite numbers now count as absent.
- Fixed requests whose timestamp could not be recovered being reported as free usage: they now count as unpriced (`N/A`) rather than `$0`, in both the aggregates and the per-request list, and an existing database re-parses its sessions once so rows stored before this change are repaired.
- Fixed the trace summary showing `$0` instead of `N/A` for legacy scheduled requests that omit their token total: the total is derived from the token buckets before classifying unpriced usage.

## [18.1.3] - 2026-09-02

### Changed

- 同步 1.1.4 发布线（与 1.1.3 无功能差异）。

## [1.1.3] - 2026-08-25

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

- 同步上游 OMP v18.0.3 / v18.0.4（内部运行时与构建改进，无独立用户可见变更）。

## [1.0.0] - 2026-08-13

### Changed

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.
