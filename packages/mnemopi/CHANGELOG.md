# Changelog

## [Unreleased]

## [1.1.23] - 2026-10-01
## [18.4.4] - 2026-09-29

### Added

- Added per-instance `polyphonicRecall` and `enhancedRecall` options to `Mnemopi` and `BeamMemory`, so memories opened side by side can use different recall policies; `configureRecallFeatures` remains the process-wide default and the env vars still win

### Fixed

- Fixed `MNEMOPI_POLYPHONIC_RECALL` / `polyphonicRecall` having no effect: `recallEnhanced` now fuses its ranking with the vector, graph, fact and temporal voices, and extracted subject/predicate/object facts are consolidated so the fact voice has data ([#2323](https://github.com/can1357/oh-my-pi/issues/2323))
- Fixed `MNEMOPI_ENHANCED_RECALL` / `enhancedRecall` having no effect: `recallEnhanced` now caches results, keyed on every recall option so a different limit, fact inclusion, channel, query time or bank never reuses another call's ranking, and any database write clears it ([#2323](https://github.com/can1357/oh-my-pi/issues/2323))
- Fixed polyphonic recall's graph voice taking seconds on densely linked banks (`proactiveLinking`): it now walks from at most 16 seeds in one batched edge query per hop and reports at most 64 memories, and `recallEnhanced` no longer drops rows below `topK` to a token budget
- Fixed a failed `consolidated_facts` backfill never being retried; backfill and fact consolidation failures are now logged

## [18.4.1] - 2026-09-28

## [1.1.22] - 2026-09-30

- 随 1.1.22 版本线发布;无面向用户的行为变化。

## [1.1.19] - 2026-09-22

- 版本线推进;本版无独立用户可见变化。

## [1.1.18] - 2026-09-22

- 包元数据:author/maintainer 更新为 Linxira-OS,LICENSE 追加 Linxira-OS 版权行(发行面变更)。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 维护同步。

## [1.1.13] - 2026-09-10

- 上游 v18.1.16 同步,内部修复。

## [1.1.12] - 2026-09-10

- 品牌与合并工具链维护版本;无本包用户可见变更。

## [1.1.11] - 2026-09-08

- OMP v18.1.13 + v18.1.14 dual-tag sync baseline; no package-specific user-visible changes.

## [1.1.10] - 2026-09-07

- OMP v18.1.11 sync baseline (`e3106be68f`); no package-specific user-visible changes.

## [1.1.9] - 2026-09-05

- v18.1.10 sync baseline; embeddings requests send the zeta User-Agent again.

## [1.1.8] - 2026-09-04

- OMP sync v18.1.2–v18.1.5: memory-backend plumbing aligned with the upstream mnemopi updates.

## [1.1.7] - 2026-09-01

- 同步上游 OMP v18.0.11（`b8ce33a58911c26bed1d84f0db9a5e2e727c49a2`）。

## [1.1.6] - 2026-08-30

- 同步上游 OMP v18.0.9（`cc14e04f075d`）。

## [1.1.5] - 2026-08-26

- 随 1.1.5 版本线对齐发布：OMP v18.0.6 同步未触及本包，无独立功能变更。

## [1.1.4] - 2026-08-26

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
