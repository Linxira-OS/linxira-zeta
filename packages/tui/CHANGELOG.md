# Changelog

## [Unreleased]

## [1.1.4] - 2026-08-26
## [18.0.6] - 2026-08-26

### Added

- Added `Markdown.getLastRenderStableText()` to expose the stable prefix of streamed Markdown text for append-only transcript publication.

## [18.0.5] - 2026-08-25

### Breaking Changes

- Renamed the public `TerminalFrameProvider.resetHistory` method to `beginHistoryReplay`.

### Added

- Loader messages can now be provided as a function, allowing dynamic labels such as live countdowns to update on each spinner tick while preserving the existing behavior for static strings.

### Changed

- Improved history replay and terminal output handling so replayed content is rendered efficiently and complete replay results are written together.

### Fixed

- Fixed graceful shutdown so finalized output is correctly retired before handing control back to the shell.
- Fixed terminal scrollback corruption during shutdown, tmux pane zoom and resize, and destructive screen resets, preventing duplicated frames, lost history, and stale transcript re-streaming.
- Fixed streaming Markdown rendering at chunk boundaries to preserve CommonMark emphasis behavior for Unicode text and correctly recognize GFM tables as they are completed.

## [18.0.4] - 2026-08-24

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
