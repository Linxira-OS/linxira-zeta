# Changelog

## [Unreleased]

## [1.1.7] - 2026-09-01
## [18.1.0] - 2026-09-01

### Fixed

- Improved terminal stability when resuming image-heavy sessions, preventing large transcript repaints from being mistaken for stalled output or exceeding the terminal output limit.
- Fixed inline images leaving blank rows in Herdr panes when resuming or rendering sessions in nested terminals.
- Fixed the TUI crashing on reference-style Markdown links whose labels match JavaScript built-in names; these links now render safely as plain text.
- Fixed fatal cleanup leaving the cursor inside a focused input before error output is displayed.
- Fixed resumed sessions showing stale background bands until the next keypress in WSL and Windows Terminal.

## [18.0.11] - 2026-08-29

- 同步上游 OMP v18.0.11（`b8ce33a58911c26bed1d84f0db9a5e2e727c49a2`）。

## [1.1.6] - 2026-08-30

- 同步上游 OMP v18.0.10（`33cc6b9a043a`）。
- 同步上游 OMP v18.0.9（`cc14e04f075d`）。

## [1.1.3] - 2026-08-25

### Fixed

- Republished as 1.1.3 to reset the latest tag after the broken 1.1.2 (no functional change over 1.1.1).

## [1.1.2] - 2026-08-25

### Fixed

- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).

## [1.1.1] - 2026-08-25

### Fixed

- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").
