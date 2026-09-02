# Changelog

## [Unreleased]

## [1.1.7] - 2026-09-01
## [18.1.0] - 2026-09-01

### Added

- Added a declarative compatibility rules system for consistent model identification, capabilities, policies, and provider-specific behavior across model classes, families, and revisions.
- Added the compat-compiler CLI for managing model identity and capability rules through KDL configuration files.

### Changed

- Standardized model revision handling and compatibility resolution across model discovery and runtime behavior.

## [17.4.1] - 2026-08-21

- 版本线随 1.1.7 发布对齐（随本体 v18.0.11 同步与主题/网关更新），包内无独立变更。

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
