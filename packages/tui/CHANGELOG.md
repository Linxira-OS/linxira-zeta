# Changelog

## [Unreleased]

## [1.1.5] - 2026-08-26
## [18.0.9] - 2026-08-28

### Added

- Exported TuiDebugServer for programmatic headless control
- Added debug demonstration script to examples
- Added an `OMP_TUI_DEBUG` Unix socket for headless TUI driving and structured inspection.

### Changed

- Inline hex colors now render with VS Code-style colored backgrounds and automatically selected black or white text for readability, alongside the color swatch.
- LaTeX text formatting commands such as \textbf, \textit, \textsl, and \emph now render as terminal bold or italic text.

### Fixed

- Fixed inline color swatches rendering incorrectly inside highlighted lines.
- Fixed terminal resizing in tmux panes and Windows consoles duplicating the current in-progress turn in scrollback.

## [18.0.8] - 2026-08-27

### Added

- `ProcessTerminal` accepts a `conpty` option to force ConPTY-hosted behavior on or off, keeping terminal tests hermetic on WSL where live env detection would otherwise flip kitty-keyboard flags and write chunking ([#9887](https://github.com/can1357/oh-my-pi/issues/9887)).

### Fixed

- Fixed pending-work animations repeatedly composing expensive frames without applying their full render cost to CPU backpressure.
- Fixed unfinished live viewport rows entering tmux pane history and duplicating streamed output ([#9780](https://github.com/can1357/oh-my-pi/issues/9780)).

## [18.0.7] - 2026-08-26

### Breaking Changes

- Removed the `inlineMathSpanEnd` and `mathStartIndex` exports; the math delimiter grammar now lives in `@linxiraos/pi-utils/math-delimiters`.

### Fixed

- Math spans now end at the first unescaped delimiter, so a TeX row break no longer closes a span early: `\(a \\) b\)` renders as one equation, and an escaped `\$` no longer ends `$$…$$`.
- Fixed image previews displaying as garbled characters in Paseo terminals.
- Fixed terminal resizing from duplicating committed history in native scrollback.
- Fixed autocomplete suggestions for bare-name skills such as `/batch` when no command matches the prefix more strongly.

## [18.0.6] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：append-only transcript 声明与稳定行 API、markdown 渲染重构。

## [1.1.3] - 2026-08-25

### Fixed

- Republished as 1.1.3 to reset the latest tag after the broken 1.1.2 (no functional change over 1.1.1).

## [1.1.2] - 2026-08-25

### Fixed

- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).

## [1.1.1] - 2026-08-25

### Fixed

- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").
