# Changelog

## [Unreleased]

## [1.1.15] - 2026-09-16

- 同步时对转录文件做事务性孤儿行修剪(messages/file_offsets 等按路径键控的表不再累积失效行)。
- 摄入过滤:跳过位于系统临时目录的转录文件夹(测试/评估产物不再污染面板)。
- 面板品牌与主题对齐 Zeta(明暗两套色板 token)。

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

