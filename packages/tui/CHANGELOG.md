# Changelog

## [Unreleased]

## [1.1.14] - 2026-09-12
## [18.1.17] - 2026-09-10

### Added

- Editor history can retain local draft snapshots with their paste expansions and host-owned attachment restoration, without writing them to persistent history ([#11524](https://github.com/can1357/oh-my-pi/pull/11524) by [@camjac251](https://github.com/camjac251)).
- Added an optional Vim-style modal editing layer to `Editor`, off unless `setVimMode(true)` is called: Insert, Normal, and Visual/Visual-Line with motions, count prefixes, and operators. `j`/`k` keep Vim's desired column, so passing over a shorter line does not collapse it, and `$` sticks to end-of-line. `p`/`P` paste from an internal register; yanks are surfaced to the host through `onYank` so it can route them to the system clipboard.
- Vim mode now exposes its chrome to hosts: `Editor.vimEnabled`, `Editor.vimPending` (the half-typed command, e.g. `2d`), and `Editor.vimSelectedLines` (Visual selection height). `onVimModeChange` additionally fires when the pending command or selection size changes, not only on mode switches.
- Vim mode now understands text objects: `iw`/`aw` (and `W`), quotes `i"`/`a'`/`` a` ``, bracket pairs `i(`/`a{`/`i[`/`a<` (nesting-aware and multi-line), and paragraphs `ip`/`ap`. They work under an operator (`diw`, `ca(`) and in Visual mode (`viw`), with counts (`d2aw`). Previously `i` after an operator fell through to Insert mode, so `diw` typed text instead of deleting a word.
- Vim mode's `c` operator now actually enters Insert mode (`cw`, `cip`, `c` in Visual); it also follows Vim's `cw`-acts-like-`ce` quirk and parks the cursor correctly when the changed range is empty (`ci"` between bare quotes).
- Added `Terminal.setCursorShape()` (DECSCUSR), restored to the terminal's configured shape on teardown and crash cleanup.

### Changed

- The software cursor now reflects the Vim mode: a reverse-video block in Normal/Visual and an underline in Insert. Both occupy one cell, so layout is unchanged, and non-modal editors keep the reverse-video block they always had.

## [18.1.15] - 2026-09-08

- 随 1.1.14 版本线发布:bazel 构建面(crates/*/BUILD.bazel)版本号纳入一致性检查,CI 原生构建与桌面冒烟守卫修复。

## [1.1.13] - 2026-09-10

- SettingsList 新增 `valueLabel`/`valueLabels`:布尔设置的显示文案与机器值分离,中文界面可本地化显示 开/关 且不再破坏循环切换匹配。

## [1.1.11] - 2026-09-08

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
