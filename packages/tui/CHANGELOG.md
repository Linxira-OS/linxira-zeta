# Changelog

## [Unreleased]

## [1.1.10] - 2026-09-07
## [1.1.10-omp18.1.12] - 2026-09-06

### Fixed

- Fixed notifications never arriving in a Herdr pane. Herdr multiplexes panes like tmux but swallows bare OSC 9 / OSC 99 and has no passthrough envelope, so a backgrounded pane got no signal at all; delivery now goes through `herdr notification show` (a waiting question or an error rings `request`, a settled turn rings `done`), and the in-band write stays as the fallback when the pane id or the `herdr` binary is missing.
- Avoid inserting a trailing space when auto-completing directory paths with `@`, and keep autocomplete open when accepting a directory with Tab or Enter.
- Horizontal wheel reports (the sideways drift of a two-finger trackpad scroll) no longer decode as a vertical wheel direction, so fullscreen selectors such as `/copy` and the rewind picker stop jumping up and back down at the end of a scroll gesture.

## [1.1.10-omp18.1.9] - 2026-09-04

- OMP v18.1.11 sync baseline (`e3106be68f`); no package-specific user-visible changes.

## [1.1.9] - 2026-09-05

- Sidebar gutter: provider-render frames now honor the reserved main width and paint the right gutter column (sidebar was dead code in production since the frame-provider refactor); overlay close clears the painted column.

## [1.1.3] - 2026-08-25

### Fixed

- Republished as 1.1.3 to reset the latest tag after the broken 1.1.2 (no functional change over 1.1.1).

## [1.1.2] - 2026-08-25

### Fixed

- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).

## [1.1.1] - 2026-08-25

### Fixed

- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").
