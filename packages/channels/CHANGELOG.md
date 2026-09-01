# Changelog

## [Unreleased]

## [1.1.7] - 2026-09-01

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

## [1.0.11] - 2026-08-22

### Added

- IM channel adapters extracted from @linxiraos/zeta: WeChat (ClawBot / iLink), Feishu / Lark, and Telegram channels plus the `ChannelHost` coordinator bridge, session router, workspace router, IM control, plan approval, and plan image helpers. The channel runtime now lives in its own publishable package.
