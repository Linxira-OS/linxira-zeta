# Changelog

## [Unreleased]

- 随 1.1.14 版本线发布:bazel 构建面(crates/*/BUILD.bazel)版本号纳入一致性检查,CI 原生构建与桌面冒烟守卫修复。

## [1.1.13] - 2026-09-10

- 上游 v18.1.16 同步:retry 提示解析升级为 longest-wins 合并(账号重置 + 追加 retry-after 同时出现时取更长窗口);`retry-after-ms` 支持 `:`/` =` 分隔形式;provider 明确要求立即重试(=0 或已过期时间戳)时返回 0 而非 undefined,避免误用启发式退避。

## [1.1.12] - 2026-09-10

- worker 宿主选择器族统一为 `__zeta_worker_*` 前缀(与主 CLI 对齐)。

## [1.1.10] - 2026-09-07

### Fixed

- Fixed `extractRetryHint` dropping the longer timing signal when an error body carries both an account reset and an appended retry hint: competing signals now merge by longest window instead of first match, so retries honor the provider's full backoff.

## [1.1.9] - 2026-09-05

- USER_AGENT constant restored to zeta/<version> (the v18.1.10 merge re-introduced the upstream omp/ UA on every provider request); brand wording in path-resolver docs corrected; profile validation error message Zeta'd.

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
