# Changelog

## [Unreleased]

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
