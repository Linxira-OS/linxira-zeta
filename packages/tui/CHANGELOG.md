# Changelog

## [Unreleased]

## [1.1.6] - 2026-08-30
## [18.0.11] - 2026-08-29

### Added

- Added `setTerminalHyperlinks()` to let hosts control OSC 8 hyperlink behavior in rendered Markdown links.

### Fixed

- Fixed inline color swatches appearing for words with hex-like prefixes, such as `#each`; swatches now appear only when the entire word is a valid color.

## [18.0.10] - 2026-08-28

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
