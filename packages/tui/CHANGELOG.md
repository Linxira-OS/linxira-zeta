# Changelog

## [Unreleased]

### Fixed

- `extractMarkdownLinks()` returns one-row visible labels for formatted and multiline links, so `/copy` link captions no longer show Markdown delimiters or split across two rows.

## [1.1.10] - 2026-09-07

### Fixed

- Fixed notifications never arriving in a Herdr pane: delivery goes through `herdr notification show` (a waiting question or an error rings `request`, a settled turn rings `done`), with the in-band write as fallback when the pane id or the `herdr` binary is missing.
- Auto-completing directory paths with `@` no longer inserts a trailing space, and autocomplete stays open when accepting a directory with Tab or Enter.
- Horizontal wheel reports (sideways drift of a two-finger trackpad scroll) no longer decode as a vertical wheel direction, so fullscreen selectors such as `/copy` and the rewind picker stop jumping at the end of a scroll gesture.

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
