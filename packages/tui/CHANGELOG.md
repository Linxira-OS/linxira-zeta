# Changelog

## [Unreleased]

## [1.1.8] - 2026-09-04
## [18.1.9] - 2026-09-04

### Added

- Added Markdown hyperlink target resolution while preserving the displayed URL text.

## [18.1.6] - 2026-09-03

### Fixed

- Fixed the band composer layout so the status line remains visible and no longer causes the prompt to shift unexpectedly when the top border is empty.

## [18.1.5] - 2026-09-03

- Restored the sidebar gutter engine + `SidebarComponent` + `/sidebar` command (Zeta-only surface dropped by an earlier upstream merge).
- OMP sync v18.1.2–v18.1.5: sub-frame history ownership (the frame provider owns history), CoW worktree cloning support, and renderer fixes.

## [1.1.3] - 2026-08-25

### Fixed

- Republished as 1.1.3 to reset the latest tag after the broken 1.1.2 (no functional change over 1.1.1).

## [1.1.2] - 2026-08-25

### Fixed

- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).

## [1.1.1] - 2026-08-25

### Fixed

- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").
