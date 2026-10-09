## [Unreleased]

## [1.1.28] - 2026-10-09

### Changed

- Improved dashboard responsiveness and efficiency by reducing unnecessary data refreshes and re-rendering, speeding up session synchronization, database access, package imports, and usage, model, and time-series requests, and avoiding repeated downloads of unchanged traces.
- Dashboard requests are now cancelled when no longer needed, improving responsiveness when switching sessions or closing trace views during loading.

## [1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- 临时目录过滤保持（测试垃圾不入库）；stats-cli 摘要测试种子适配非 temp 编码目录。

## [1.1.22] - 2026-09-30

- CLI bin 命名(zeta-c)相关提示文案对齐;`omp stats` 面板不受影响。

## [1.1.19] - 2026-09-22

- 版本线推进;本版无独立用户可见变化。

## [1.1.18] - 2026-09-22

- 包元数据:author/maintainer 更新为 Linxira-OS,LICENSE 追加 Linxira-OS 版权行(发行面变更)。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 同步:统计聚合遍历熔断(withStatsSyncLock 文件锁重写)。

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
