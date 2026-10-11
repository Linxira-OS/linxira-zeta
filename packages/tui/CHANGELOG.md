## [Unreleased]


### Added

- SVG and Mermaid files now render as images or diagrams beneath their file cards, with SVG previews updating while the file streams and Mermaid previews appearing when the file is complete.
- Native tool cards can open expanded regardless of the transcript’s expansion state; the todo checklist uses this behavior.
- Added a **Compacts at** fact to the model hub preview and a Roles-view **Compaction limit** action (`k`) that edits the selected row's model limit through the new `ModelBrowserSource.compactionPointFor` and `ModelHubCallbacks.onCompactionPointChange` hooks ([#14952](https://github.com/can1357/oh-my-pi/pull/14952) by [@H4vC](https://github.com/H4vC))

### Changed

- TSP composer placeholders now appear as the composer title in italicized curly quotes, with “What are we cooking?” used when no title is provided.
- TSP image transfers are more efficient across reconnects and multiple surfaces: images are sent once per connection, existing terminal blobs are detected before upload, and images in the Tern blob cache can be reused without crossing the terminal pty.
- Improved performance and responsiveness across the TUI, including large TSP messages and Markdown documents, streaming output, tool-result cards, debug logs, raw SSE and Git diff views, path and model searches, session and settings lists, plan review, agent transcripts, status updates, assistant links, Kitty images, and large prompt or evaluation content.
- Large debug logs and plan-review histories now retain bounded history to keep the interface responsive, while preserving the newest log entries.
- Improved rendering performance for streaming long Markdown lists while preserving nested items, numbering, and reference links.

### Fixed

- Fixed slow Markdown processing for certain LaTeX environments and incomplete delimiters.
- Fixed excessive slowdown when formatting long semicolon-free JavaScript evaluations.
- Fixed prompt-editor lag in large drafts containing magic keywords.
- Added package exports for the native Tern/TSP modules, allowing extensions in compiled `omp` binaries to import them.
- Fixed the Tern `/model` picker's Roles tab so typing and Backspace consistently edit the search field without triggering role commands.
- Fixed the session picker so sessions retain and display their directory when switching between the current folder and all-project views.
- Fixed `/usage` dashboard cards reordering their limit rows by usage; rows now keep the provider's window order (e.g. 5 hour → weekly → monthly) ([#14953](https://github.com/can1357/oh-my-pi/pull/14953) by [@H4vC](https://github.com/H4vC))
- Fixed Cmd+A, Cmd+C, Cmd+X and Shift+arrow selection doing nothing in the Tern prompt while Vim mode is in Insert mode ([#14954](https://github.com/can1357/oh-my-pi/pull/14954) by [@H4vC](https://github.com/H4vC))

## [9.8.0] - 2026-02-01

### Changed

- Moved `wrapTextWithAnsi` export to `@linxiraos/pi-natives` package

### Fixed

- Improved Kitty terminal key sequence parsing to correctly handle text field codepoints in CSI-u sequences
- Fixed handling of private use Unicode codepoints (U+E000 to U+F8FF) in Kitty key decoding to prevent invalid character interpretation

## [9.7.0] - 2026-02-01

### Breaking Changes

- Removed `Key` helper object from public API; use string literals like `"ctrl+c"` instead of `Key.ctrl("c")`
- Removed `KeyEventType` export from public API

### Changed

- Migrated key parsing and matching logic to native implementation for improved performance
- Simplified `isKeyRelease()` and `isKeyRepeat()` to use regex pattern matching instead of string inclusion checks

## [9.6.2] - 2026-02-01

### Changed

- Renamed `EllipsisKind` enum to `Ellipsis` for clearer API naming
- Changed hardcoded ellipsis character from theme-configurable to literal "…" in editor truncation
- Refactored `visibleWidth` function to use caching wrapper around new `visibleWidthRaw` implementation for improved performance

### Removed

- Removed `truncateToWidth`, `sliceWithWidth`, and `extractSegments` functions from public API (now re-exported directly from @linxiraos/pi-natives)
- Removed `ellipsis` property from `SymbolTheme` interface
- Removed `extractAnsiCode` function from public API

## [9.6.1] - 2026-02-01

### Changed

- Improved performance of key ID parsing with optimized cache lookup strategy
- Simplified `visibleWidth` calculation to use consistent Bun.stringWidth approach for all string lengths

### Removed

- Removed `visibleWidth` benchmark file in favor of Kitty sequence benchmarking

## [9.5.0] - 2026-02-01

### Changed

- Improved fuzzy file search performance by using native implementation instead of spawning external process
- Replaced external `fd` binary with native fuzzy path search for `@`-prefixed autocomplete

## [9.4.0] - 2026-01-31

### Added

- Exported `padding` utility function for creating space-padded strings efficiently

### Changed

- Optimized padding operations across all components to use pre-allocated space buffer for better performance

## [9.2.2] - 2026-01-31

### Added

- Added setAutocompleteMaxVisible() configuration (3-20 items)
- Added image detection to terminal capabilities (containsImage method)
- Added stdin monitoring to detect stalled input events and log warnings

### Changed

- Improved blockquote rendering with text wrapping in Markdown component
- Restructured terminal capabilities from interface-based to class-based model
- Improved table column width calculation with word-aware wrapping
- Refactored text utilities to use native WASM implementations for strings >256 chars with JS fast path

### Fixed

- Simplified terminal write error handling to mark terminal as dead on any write failure
- Fixed multi-line strings in renderOutputBlock causing width overflow
- Fixed slash command autocomplete applying stale completion when typing quickly

### Removed

- Removed TUI layout engine exports from public API (BoxNode, ColumnNode, LayoutNode, etc.)

## [8.12.7] - 2026-01-29

### Fixed

- Fixed slash command autocomplete applying stale completion when typing quickly

## [8.4.1] - 2026-01-25

### Added

- Added fuzzy match function for autocomplete suggestions

## [8.4.0] - 2026-01-25

### Changed

- Added Ctrl+Backspace as a delete-word-backward keybinding and improved modified backspace matching

### Fixed

- Terminal gracefully handles write failures by marking dead instead of exiting the process
- Reserved cursor space for zero padding and corrected end-of-line cursor rendering to prevent wrap glitches
- Corrected editor end-of-line cursor rendering assertion to use includes() instead of endsWith()

## [8.2.0] - 2026-01-24

### Added

- Added mermaid diagram rendering engine (renderMermaidToPng) with mmdc CLI integration
- Added terminal graphics encoding (iTerm2/Kitty) for mermaid diagrams with automatic width scaling
- Added mermaid block extraction and deduplication utilities (extractMermaidBlocks)

### Changed

- Updated TypeScript configuration for better publish-time configuration handling with tsconfig.publish.json
- Migrated file system operations from synchronous to asynchronous APIs in autocomplete provider for non-blocking I/O
- Migrated node module imports from named to namespace imports across all packages for consistency with project guidelines

### Fixed

- Fixed crash when terminal becomes unavailable (EIO errors) by exiting gracefully instead of throwing
- Fixed potential errors during emergency terminal restore when terminal is already dead
- Fixed autocomplete race condition by tracking request ID to prevent stale suggestion results

## [6.8.3] - 2026-01-21

### Added

- Added undo support in the editor via `Ctrl+-`
- Added `Alt+Delete` as a delete-word-forward shortcut
- Added configurable code block indentation for Markdown rendering
- Added undo support in the editor via `Ctrl+-`.
- Added configurable code block indentation for Markdown rendering.
- Added `Alt+Delete` as a delete-word-forward shortcut.

### Changed

- Improved fuzzy matching to handle alphanumeric swaps
- Normalized keybinding definitions to lowercase internally
- Improved fuzzy matching to handle alphanumeric swaps.
- Normalized keybinding definitions to lowercase internally.

### Fixed

- Added legacy terminal support for `Ctrl+` symbol key combinations
- Added legacy terminal support for `Ctrl+` symbol key combinations.

## [6.8.1] - 2026-01-20

### Fixed

- Fixed viewport tracking after partial renders to prevent autocomplete list artifacts

## [5.6.7] - 2026-01-18

### Added

- Added configurable editor padding via `editorPaddingX` theme option
- Added `setMaxHeight()` method to limit editor height with scrolling
- Added Emacs-style kill ring for text deletion operations
- Added `Alt+D` keybinding to delete words forward
- Added `Ctrl+Y` keybinding to yank from kill ring
- Added `waitForRender()` method to await pending renders
- Added Focusable interface and hardware cursor marker support for IME positioning
- Added support for shifted symbol keys in keybindings

### Changed

- Updated tab bar rendering to wrap text across multiple lines when content exceeds available width
- Expanded Kitty keyboard protocol coverage for non-Latin layouts and legacy Alt sequences
- Improved cursor positioning with safer bounds checking
- Updated editor layout to respect configurable padding
- Refactored scrolling logic for better viewport management

### Fixed

- Fixed key detection for shifted symbol characters
- Fixed backspace handling with additional codepoint support
- Fixed Alt+letter key combinations for better recognition

## [5.3.1] - 2026-01-15

### Fixed

- Fixed rendering issues on Windows by preventing re-entrant renders

## [5.1.0] - 2026-01-14

### Added

- Added `pageUp` and `pageDown` key support with `selectPageUp`/`selectPageDown` editor actions
- Added `isPageUp()` and `isPageDown()` helper functions
- Added `SizeValue` type for CSS-like overlay sizing (absolute or percentage strings like `"50%"`)
- Added `OverlayHandle` interface with `hide()`, `setHidden()`, `isHidden()` methods for overlay visibility control
- Added `visible` callback to `OverlayOptions` for dynamic visibility based on terminal dimensions
- Added `pad` parameter to `truncateToWidth()` for padding result with spaces to exact width

### Changed

- Changed `OverlayOptions` to use `SizeValue` type for `width`, `maxHeight`, `row`, and `col` properties
- Changed `showOverlay()` to return `OverlayHandle` for controlling overlay visibility
- Removed `widthPercent`, `maxHeightPercent`, `rowPercent`, `colPercent` from `OverlayOptions` (use percentage strings instead)

### Fixed

- Fixed numbered list items showing "1." for all items when code blocks break list continuity
- Fixed width overflow protection in overlay compositing to prevent TUI crashes

## [4.7.0] - 2026-01-12

### Fixed

- Remove trailing space padding from Text, Markdown, and TruncatedText components when no background color is set (fixes copied text including unwanted whitespace)

## [4.6.0] - 2026-01-12

### Added

- Add fuzzy matching module (`fuzzyMatch`, `fuzzyFilter`) for command autocomplete
- Add `getExpandedText()` to editor for expanding paste markers
- Add backslash+enter newline fallback for terminals without Kitty protocol

### Fixed

- Remove Kitty protocol query timeout that caused shift+enter delays
- Add bracketed paste check to prevent false key release/repeat detection
- Rendering optimizations: only re-render changed lines
- Refactor input component to use keybindings manager

## [4.4.4] - 2026-01-11

### Fixed

- Fixed Ctrl+Enter sequences to insert new lines in the editor

## [4.2.1] - 2026-01-11

### Changed

- Improved file autocomplete to show directory listing when typing `@` with no query, and fall back to prefix matching when fuzzy search returns no results

### Fixed

- Fixed editor redraw glitch when canceling autocomplete suggestions
- Fixed `fd` tool detection to automatically find `fd` or `fdfind` in PATH when not explicitly configured

## [4.1.0] - 2026-01-10

### Added

- Added persistent prompt history storage support via `setHistoryStorage()` method, allowing history to be saved and restored across sessions

## [4.0.0] - 2026-01-10

### Added

- `EditorComponent` interface for custom editor implementations
- `StdinBuffer` class to split batched stdin into individual sequences
- Overlay compositing via `TUI.showOverlay()` and `TUI.hideOverlay()` for `ctx.ui.custom()` with `{ overlay: true }`
- Kitty keyboard protocol flag 2 support for key release events (`isKeyRelease()`, `isKeyRepeat()`, `KeyEventType`)
- `setKittyProtocolActive()`, `isKittyProtocolActive()` for Kitty protocol state management
- `kittyProtocolActive` property on Terminal interface to query Kitty protocol state
- `Component.wantsKeyRelease` property to opt-in to key release events (default false)
- Input component `onEscape` callback for handling escape key presses

### Changed

- Terminal startup now queries Kitty protocol support before enabling event reporting
- Default editor `newLine` binding now uses `shift+enter` only

### Fixed

- Key presses no longer dropped when batched with other events over SSH
- TUI now filters out key release events by default, preventing double-processing of keys
- `matchesKey()` now correctly matches Kitty protocol sequences for unmodified letter keys
- Crash when pasting text with trailing whitespace exceeding terminal width through Markdown rendering

## [3.32.0] - 2026-01-08

### Fixed

- Fixed text wrapping allowing long whitespace tokens to exceed line width

## [3.20.0] - 2026-01-06

### Added

- Added `isCapsLock` helper function for detecting Caps Lock key press via Kitty protocol
- Added `isCtrlY` helper function for detecting Ctrl+Y keyboard input
- Added configurable editor keybindings with typed key identifiers and action matching
- Added word-wrapped editor rendering for long lines

### Changed

- Settings list descriptions now wrap to the available width instead of truncating

### Fixed

- Fixed Shift+Enter detection in legacy terminals that send ESC+CR sequence

## [3.15.1] - 2026-01-05

### Fixed

- Fixed editor cursor blinking by allowing terminal cursor positioning when enabled.

## [3.15.0] - 2026-01-05

### Added

- Added `inputCursor` symbol for customizing the text input cursor character
- Added `symbols` property to `EditorTheme`, `MarkdownTheme`, and `SelectListTheme` interfaces for component-level symbol customization
- Added `SymbolTheme` interface for customizing UI symbols including cursors, borders, spinners, and box-drawing characters
- Added support for custom spinner frames in the Loader component

## [3.9.1337] - 2026-01-04

### Added

- Added `setTopBorder()` method to Editor component for displaying custom status content in the top border
- Added `getWidth()` method to TUI class for retrieving terminal width
- Added rounded corner box-drawing characters to Editor component borders

### Changed

- Changed Editor component to use proper box borders with vertical side borders instead of horizontal-only borders
- Changed cursor style from block to thin blinking bar (▏) at end of line

## [1.500.0] - 2026-01-03

### Added

- Added `getText()` method to Text component for retrieving current text content

## [1.337.1] - 2026-01-02

### Added

- TabBar component for horizontal tab navigation
- Emergency terminal restore to prevent corrupted state on crashes
- Overhauled UI with welcome screen and powerline footer
- Theme-configurable HTML export colors
- `ctx.ui.theme` getter for styling status text with theme colors

### Changed

- Forked to @oh-my-pi scope with unified versioning across all packages

### Fixed

- Strip OSC 8 hyperlink sequences in `visibleWidth()`
- Crash on Unicode format characters in `visibleWidth()`
- Markdown code block syntax highlighting

## [1.337.0] - 2026-01-02

Initial release under @oh-my-pi scope. See previous releases at [badlogic/pi-mono](https://github.com/badlogic/pi-mono).

## [1.5.0] - 2026-01-03

### Added

- Added `getText()` method to Text component for retrieving current text content

## [1.1.26] - 2026-10-03

- 版本线推进至 1.1.26；本版无独立用户可见变化。

## [1.1.25] - 2026-10-03

- Hyperlinks (OSC 8) are now emitted when running inside Zetawork workbench panes: the `ZETA_WORKBENCH=1` probe unlocks `fileHyperlink` output, so file links stay clickable and titles update live in the workbench's embedded terminals.

## [1.1.24] - 2026-10-03

- 语义角色清扫补全（omp.*→zeta.*，106 文件）；agent-hub 空态提示还原 `omp-dev`；notifications OSC 99 对齐 zeta app id。

## [1.1.19] - 2026-09-22

- 版本线推进;本版无独立用户可见变化。

## [1.1.18] - 2026-09-22

- 新增宿主可注入文本层:`setTuiTextSource` / `tuiText` / `tuiTextFmt`——内联英文为永久 fallback,宿主(coding-agent)注入活翻译代理,面板文本随 `/language` 即时切换;pi-tui 独立使用零依赖。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 同步:每击键/每帧渲染浪费削减、billing 摘要重构、stream 状态分段、paint-listener 通知管线。
- 主题、覆盖层、chat、工具渲染器与 apps 组件自 coding-agent 迁入本包(模块迁移)。

## [0.50.0] - 2026-01-26

### Added

- Added `fullRedraws` readonly property to TUI class for tracking full screen redraws
- Added `PI_TUI_WRITE_LOG` environment variable to capture raw ANSI output for debugging

### Fixed

- Fixed appended lines not being committed to scrollback, causing earlier content to be overwritten when viewport fills ([#954](https://github.com/badlogic/pi-mono/issues/954))
- Slash command menu now only triggers when the editor input is otherwise empty ([#904](https://github.com/badlogic/pi-mono/issues/904))
- Center-anchored overlays now stay vertically centered when resizing the terminal taller after a shrink ([#950](https://github.com/badlogic/pi-mono/pull/950) by [@nicobailon](https://github.com/nicobailon))
- Fixed editor multi-line insertion handling and lastAction tracking ([#945](https://github.com/badlogic/pi-mono/pull/945) by [@Perlence](https://github.com/Perlence))
- Fixed editor word wrapping to reserve a cursor column ([#934](https://github.com/badlogic/pi-mono/pull/934) by [@Perlence](https://github.com/Perlence))
- Fixed editor word wrapping to use single-pass backtracking for whitespace handling ([#924](https://github.com/badlogic/pi-mono/pull/924) by [@Perlence](https://github.com/Perlence))
- Fixed Kitty image ID allocation and cleanup to prevent image ID collisions between modules

## [0.49.3] - 2026-01-22

### Added

- `codeBlockIndent` property on `MarkdownTheme` to customize code block content indentation (default: 2 spaces) ([#855](https://github.com/badlogic/pi-mono/pull/855) by [@terrorobe](https://github.com/terrorobe))
- Added Alt+Delete as hotkey for delete word forwards ([#878](https://github.com/badlogic/pi-mono/pull/878) by [@Perlence](https://github.com/Perlence))

### Changed

- Fuzzy matching now scores consecutive matches higher and penalizes gaps more heavily for better relevance ([#860](https://github.com/badlogic/pi-mono/pull/860) by [@mitsuhiko](https://github.com/mitsuhiko))

### Fixed

- Autolinked emails no longer display redundant `(mailto:...)` suffix in markdown output ([#888](https://github.com/badlogic/pi-mono/pull/888) by [@terrorobe](https://github.com/terrorobe))
- Fixed viewport tracking and cursor positioning for overlays and content shrink scenarios
- Autocomplete now allows searches with `/` characters (e.g., `folder1/folder2`) ([#882](https://github.com/badlogic/pi-mono/pull/882) by [@richardgill](https://github.com/richardgill))
- Directory completions for `@` file attachments no longer add trailing space, allowing continued autocomplete into subdirectories

## [0.49.1] - 2026-01-18

### Added

- Added undo support to Editor with Ctrl+- hotkey. Undo coalesces consecutive word characters into one unit (fish-style). ([#831](https://github.com/badlogic/pi-mono/pull/831) by [@Perlence](https://github.com/Perlence))
- Added legacy terminal support for Ctrl+symbol keys (Ctrl+\, Ctrl+], Ctrl+-) and their Ctrl+Alt variants. ([#831](https://github.com/badlogic/pi-mono/pull/831) by [@Perlence](https://github.com/Perlence))

## [0.49.0] - 2026-01-17

### Added

- Added `showHardwareCursor` getter and setter to control cursor visibility while keeping IME positioning active. ([#800](https://github.com/badlogic/pi-mono/pull/800) by [@ghoulr](https://github.com/ghoulr))
- Added Emacs-style kill ring editing with yank and yank-pop keybindings. ([#810](https://github.com/badlogic/pi-mono/pull/810) by [@Perlence](https://github.com/Perlence))
- Added legacy Alt+letter handling and Alt+D delete word forward support in the editor keymap. ([#810](https://github.com/badlogic/pi-mono/pull/810) by [@Perlence](https://github.com/Perlence))

## [0.48.0] - 2026-01-16

### Added

- `EditorOptions` with optional `paddingX` for horizontal content padding, plus `getPaddingX()`/`setPaddingX()` methods ([#791](https://github.com/badlogic/pi-mono/pull/791) by [@ferologics](https://github.com/ferologics))

### Changed

- Hardware cursor is now disabled by default for better terminal compatibility. Set `PI_HARDWARE_CURSOR=1` to enable (replaces `PI_NO_HARDWARE_CURSOR=1` which disabled it).

### Fixed

- Decode Kitty CSI-u printable sequences in the editor so shifted symbol keys (e.g., `@`, `?`) work in terminals that enable Kitty keyboard protocol ([#779](https://github.com/badlogic/pi-mono/pull/779) by [@iamd3vil](https://github.com/iamd3vil))

## [0.47.0] - 2026-01-16

### Breaking Changes

- `Editor` constructor now requires `TUI` as first parameter: `new Editor(tui, theme)`. This enables automatic vertical scrolling when content exceeds terminal height. ([#732](https://github.com/badlogic/pi-mono/issues/732))

### Added

- Hardware cursor positioning for IME support in `Editor` and `Input` components. The terminal cursor now follows the text cursor position, enabling proper IME candidate window placement for CJK input. ([#719](https://github.com/badlogic/pi-mono/pull/719))
- `Focusable` interface for components that need hardware cursor positioning. Implement `focused: boolean` and emit `CURSOR_MARKER` in render output when focused.
- `CURSOR_MARKER` constant and `isFocusable()` type guard exported from the package
- Editor now supports Page Up/Down keys (Fn+Up/Down on MacBook) for scrolling through large content ([#732](https://github.com/badlogic/pi-mono/issues/732))
- Expanded keymap coverage for terminal compatibility: added support for Home/End keys in tmux, additional modifier combinations, and improved key sequence parsing ([#752](https://github.com/badlogic/pi-mono/pull/752) by [@richardgill](https://github.com/richardgill))

### Fixed

- Editor no longer corrupts terminal display when text exceeds screen height. Content now scrolls vertically with indicators showing lines above/below the viewport. Max height is 30% of terminal (minimum 5 lines). ([#732](https://github.com/badlogic/pi-mono/issues/732))
- `visibleWidth()` and `extractAnsiCode()` now handle APC escape sequences (`ESC _ ... BEL`), fixing width calculation and string slicing for strings containing cursor markers
- SelectList now handles multi-line descriptions by replacing newlines with spaces ([#728](https://github.com/badlogic/pi-mono/pull/728) by [@richardgill](https://github.com/richardgill))

## [0.46.0] - 2026-01-15

### Fixed

- Keyboard shortcuts (Ctrl+C, Ctrl+D, etc.) now work on non-Latin keyboard layouts (Russian, Ukrainian, Bulgarian, etc.) in terminals supporting Kitty keyboard protocol with alternate key reporting ([#718](https://github.com/badlogic/pi-mono/pull/718) by [@dannote](https://github.com/dannote))

## [0.45.6] - 2026-01-13

### Added

- `OverlayOptions` API for overlay positioning and sizing with CSS-like values: `width`, `maxHeight`, `row`, `col` accept numbers (absolute) or percentage strings (e.g., `"50%"`). Also supports `minWidth`, `anchor`, `offsetX`, `offsetY`, `margin`. ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))
- `OverlayOptions.visible` callback for responsive overlays - receives terminal dimensions, return false to hide ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))
- `showOverlay()` now returns `OverlayHandle` with `hide()`, `setHidden(boolean)`, `isHidden()` for programmatic visibility control ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))
- New exported types: `OverlayAnchor`, `OverlayHandle`, `OverlayMargin`, `OverlayOptions`, `SizeValue` ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))
- `truncateToWidth()` now accepts optional `pad` parameter to pad result with spaces to exactly `maxWidth` ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))

### Fixed

- Overlay compositing crash when rendered lines exceed terminal width due to complex ANSI/OSC sequences (e.g., hyperlinks in subagent output) ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))

## [0.44.0] - 2026-01-12

### Added

- `SettingsListOptions` with `enableSearch` for fuzzy filtering in `SettingsList` ([#643](https://github.com/badlogic/pi-mono/pull/643) by [@ninlds](https://github.com/ninlds))
- `pageUp` and `pageDown` key support with `selectPageUp`/`selectPageDown` editor actions ([#662](https://github.com/badlogic/pi-mono/pull/662) by [@aliou](https://github.com/aliou))

### Fixed

- Numbered list items showing "1." for all items when code blocks break list continuity ([#660](https://github.com/badlogic/pi-mono/pull/660) by [@ogulcancelik](https://github.com/ogulcancelik))

## [0.43.0] - 2026-01-11

### Added

- `fuzzyFilter()` and `fuzzyMatch()` utilities for fuzzy text matching
- Slash command autocomplete now uses fuzzy matching instead of prefix matching

### Fixed

- Cursor now moves to end of content on exit, preventing status line from being overwritten ([#629](https://github.com/badlogic/pi-mono/pull/629) by [@tallshort](https://github.com/tallshort))
- Reset ANSI styles after each rendered line to prevent style leakage

## [0.42.5] - 2026-01-11

### Fixed

- Reduced flicker by only re-rendering changed lines ([#617](https://github.com/badlogic/pi-mono/pull/617) by [@ogulcancelik](https://github.com/ogulcancelik))
- Cursor position tracking when content shrinks with unchanged remaining lines
- TUI renders with wrong dimensions after suspend/resume if terminal was resized while suspended ([#599](https://github.com/badlogic/pi-mono/issues/599))
- Pasted content containing Kitty key release patterns (e.g., `:3F` in MAC addresses) was incorrectly filtered out ([#623](https://github.com/badlogic/pi-mono/pull/623) by [@ogulcancelik](https://github.com/ogulcancelik))

## [0.39.0] - 2026-01-08

### Added

- **Experimental:** Overlay compositing for `ctx.ui.custom()` with `{ overlay: true }` option ([#558](https://github.com/badlogic/pi-mono/pull/558) by [@nicobailon](https://github.com/nicobailon))

## [0.38.0] - 2026-01-08

### Added

- `EditorComponent` interface for custom editor implementations
- `StdinBuffer` class to split batched stdin into individual sequences (adapted from [OpenTUI](https://github.com/anomalyco/opentui), MIT license)

### Fixed

- Key presses no longer dropped when batched with other events over SSH ([#538](https://github.com/badlogic/pi-mono/pull/538))

## [0.37.8] - 2026-01-07

### Added

- `Component.wantsKeyRelease` property to opt-in to key release events (default false)

### Fixed

- TUI now filters out key release events by default, preventing double-processing of keys in editors and other components

## [0.37.7] - 2026-01-07

### Fixed

- `matchesKey()` now correctly matches Kitty protocol sequences for unmodified letter keys (needed for key release events)

## [0.37.6] - 2026-01-06

### Added

- Kitty keyboard protocol flag 2 support for key release events. New exports: `isKeyRelease(data)`, `isKeyRepeat(data)`, `KeyEventType` type. Terminals supporting Kitty protocol (Kitty, Ghostty, WezTerm) now send proper key-up events.

## [0.37.0] - 2026-01-05

### Fixed

- Crash when pasting text with trailing whitespace exceeding terminal width through Markdown rendering ([#457](https://github.com/badlogic/pi-mono/pull/457) by [@robinwander](https://github.com/robinwander))

## [0.34.1] - 2026-01-04

### Added

- Symbol key support in keybinding system: `SymbolKey` type with 32 symbol keys, `Key` constants (e.g., `Key.backtick`, `Key.comma`), updated `matchesKey()` and `parseKey()` to handle symbol input ([#450](https://github.com/badlogic/pi-mono/pull/450) by [@kaofelix](https://github.com/kaofelix))

## [0.34.0] - 2026-01-04

### Added

- `Editor.getExpandedText()` method that returns text with paste markers expanded to their actual content ([#444](https://github.com/badlogic/pi-mono/pull/444) by [@aliou](https://github.com/aliou))

## [0.33.0] - 2026-01-04

### Breaking Changes

- **Key detection functions removed**: All `isXxx()` key detection functions (`isEnter()`, `isEscape()`, `isCtrlC()`, etc.) have been removed. Use `matchesKey(data, keyId)` instead (e.g., `matchesKey(data, "enter")`, `matchesKey(data, "ctrl+c")`). This affects hooks and custom tools that use `ctx.ui.custom()` with keyboard input handling. ([#405](https://github.com/badlogic/pi-mono/pull/405))

### Added

- `Editor.insertTextAtCursor(text)` method for programmatic text insertion ([#419](https://github.com/badlogic/pi-mono/issues/419))
- `EditorKeybindingsManager` for configurable editor keybindings. Components now use `matchesKey()` and keybindings manager instead of individual `isXxx()` functions. ([#405](https://github.com/badlogic/pi-mono/pull/405) by [@hjanuschka](https://github.com/hjanuschka))

### Changed

- Key detection refactored: consolidated `is*()` functions into generic `matchesKey(data, keyId)` function that accepts key identifiers like `"ctrl+c"`, `"shift+enter"`, `"alt+left"`, etc.

## [0.32.2] - 2026-01-03

### Fixed

- Slash command autocomplete now triggers for commands starting with `.`, `-`, or `_` (e.g., `/.land`, `/-foo`) ([#422](https://github.com/badlogic/pi-mono/issues/422))

## [0.32.0] - 2026-01-03

### Changed

- Editor component now uses word wrapping instead of character-level wrapping for better readability ([#382](https://github.com/badlogic/pi-mono/pull/382) by [@nickseelert](https://github.com/nickseelert))

### Fixed

- Shift+Space, Shift+Backspace, and Shift+Delete now work correctly in Kitty-protocol terminals (Kitty, WezTerm, etc.) instead of being silently ignored ([#411](https://github.com/badlogic/pi-mono/pull/411) by [@nathyong](https://github.com/nathyong))

## [0.31.1] - 2026-01-02

### Fixed

- `visibleWidth()` now strips OSC 8 hyperlink sequences, fixing text wrapping for clickable links ([#396](https://github.com/badlogic/pi-mono/pull/396) by [@Cursivez](https://github.com/Cursivez))

Older entries are archived in [packages/tui/CHANGELOG.md@9caccab691ce](https://github.com/can1357/oh-my-pi/blob/9caccab691ce575007f4b6bcbaf8f944723d5457/packages/tui/CHANGELOG.md).
Older entries are archived in [packages/tui/CHANGELOG.md@58141d4e5fa8](https://github.com/can1357/oh-my-pi/blob/58141d4e5fa892166024e2168866c45e0baacde3/packages/tui/CHANGELOG.md).

Older entries are archived in [packages/tui/CHANGELOG.md@fa14205f838f](https://github.com/can1357/oh-my-pi/blob/fa14205f838f282fcea048c64fca74026789a492/packages/tui/CHANGELOG.md).
