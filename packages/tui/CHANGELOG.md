## [Unreleased]

## [1.4.0] - 2026-10-21

- Added a `zetawork` terminal id that resolves to the Kitty image protocol from the environment alone, so images render in the desktop app's own terminal

## [9.5.0] - 2026-02-01

### Changed

- Improved fuzzy file search performance by using native implementation instead of spawning external process

## [9.4.0] - 2026-01-31

### Added

- Exported `padding` utility function for creating space-padded strings efficiently

### Changed

- Optimized padding operations across all components to use pre-allocated space buffer for better performance

## [8.4.1] - 2026-01-25

### Added

- Added fuzzy match function for autocomplete suggestions

## [8.4.0] - 2026-01-25

### Fixed

- Terminal gracefully handles write failures by marking dead instead of exiting the process

## [8.2.0] - 2026-01-24

### Added

- Added mermaid diagram rendering engine (renderMermaidToPng) with mmdc CLI integration
- Added terminal graphics encoding (iTerm2/Kitty) for mermaid diagrams with automatic width scaling

### Changed

- Updated TypeScript configuration for better publish-time configuration handling with tsconfig.publish.json

### Fixed

- Fixed crash when terminal becomes unavailable (EIO errors) by exiting gracefully instead of throwing

## [6.8.3] - 2026-01-21

### Added

- Added undo support in the editor via `Ctrl+-`

### Changed

- Improved fuzzy matching to handle alphanumeric swaps

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

### Fixed

- Fixed key detection for shifted symbol characters

## [5.3.1] - 2026-01-15

### Fixed

- Fixed rendering issues on Windows by preventing re-entrant renders

## [5.1.0] - 2026-01-14

### Changed

- Changed `OverlayOptions` to use `SizeValue` type for `width`, `maxHeight`, `row`, and `col` properties

### Fixed

- Fixed numbered list items showing "1." for all items when code blocks break list continuity
- Fixed width overflow protection in overlay compositing to prevent TUI crashes

## [4.6.0] - 2026-01-12

### Added

- Add fuzzy matching module (`fuzzyMatch`, `fuzzyFilter`) for command autocomplete

### Fixed

- Remove Kitty protocol query timeout that caused shift+enter delays
- Add bracketed paste check to prevent false key release/repeat detection

## [4.2.1] - 2026-01-11

### Fixed

- Fixed editor redraw glitch when canceling autocomplete suggestions

## [4.1.0] - 2026-01-10

### Added

- Added persistent prompt history storage support via `setHistoryStorage()` method, allowing history to be saved and restored across sessions

## [4.0.0] - 2026-01-10

### Added

- `EditorComponent` interface for custom editor implementations

### Fixed

- Key presses no longer dropped when batched with other events over SSH

## [3.32.0] - 2026-01-08

### Fixed

- Fixed text wrapping allowing long whitespace tokens to exceed line width

## [3.20.0] - 2026-01-06

### Added

- Added `isCapsLock` helper function for detecting Caps Lock key press via Kitty protocol

### Changed

- Settings list descriptions now wrap to the available width instead of truncating

### Fixed

- Fixed Shift+Enter detection in legacy terminals that send ESC+CR sequence

## [3.15.0] - 2026-01-05

### Added

- Added `inputCursor` symbol for customizing the text input cursor character
- Added `symbols` property to `EditorTheme`, `MarkdownTheme`, and `SelectListTheme` interfaces for component-level symbol customization

## [3.9.1337] - 2026-01-04

### Changed

- Changed Editor component to use proper box borders with vertical side borders instead of horizontal-only borders

## [1.500.0] - 2026-01-03

### Added

- Added `getText()` method to Text component for retrieving current text content

## [1.337.1] - 2026-01-02

### Added

- TabBar component for horizontal tab navigation

### Changed

- Forked to @oh-my-pi scope with unified versioning across all packages

### Fixed

- Strip OSC 8 hyperlink sequences in `visibleWidth()`
- Crash on Unicode format characters in `visibleWidth()`
- Markdown code block syntax highlighting

## [1.337.0] - 2026-01-02

Initial release under @oh-my-pi scope. See previous releases at [badlogic/pi-mono](https://github.com/badlogic/pi-mono).

## [1.3.2] - 2026-10-19

- Version line moves to 1.3.2 with the rest of the suite; no user-visible change in this package.

## [1.3.1] - 2026-10-19

### Breaking Changes

- Removed `KeyEventType` export from public API
- `Editor` constructor now requires `TUI` as first parameter: `new Editor(tui, theme)`. This enables automatic vertical scrolling when content exceeds terminal height. ([#732](https://github.com/badlogic/pi-mono/issues/732))
- Removed `Key` helper object from public API; use string literals like `"ctrl+c"` instead of `Key.ctrl("c")`
## [18.12.6] - 2026-10-21

### Changed

- In Tern, centered sheets (`/context`, reports, keyboard shortcuts, BTW history, session info, the pause screen) fill the pane when it is narrower than 100 columns instead of floating with margins ([#16676](https://github.com/can1357/oh-my-pi/pull/16676) by [@H4vC](https://github.com/H4vC))

### Fixed

- Fixed the `/agents` and `/models` hubs in Tern squeezing the left sidebar as long lines (such as a streaming new-agent draft) widen the body pane

## [18.12.4] - 2026-10-20

### Added

- Added `mergeLineRanges` and an optional `BareLineMode` argument to `parseLineRanges` (`"single"` reads a lone bare `N` as that one line) ([#16435](https://github.com/can1357/oh-my-pi/pull/16435) by [@will-bogusz](https://github.com/will-bogusz))

### Changed

- `selectorLineRanges()` reads a bare `N` compounded with `raw` (`17:raw`, `raw:17`) as the single line `N`; `parseLineRanges()` takes an optional `"single"` mode for the same rule ([#16438](https://github.com/can1357/oh-my-pi/pull/16438) by [@will-bogusz](https://github.com/will-bogusz))
- Collapsed `wait` cards show one row per finished job (or a single "waiting on N jobs" line) instead of re-printing the whole job tree on every poll; Ctrl+O shows the full tree ([#16486](https://github.com/can1357/oh-my-pi/pull/16486) by [@H4vC](https://github.com/H4vC))
- Bash cards show the elapsed time while a command runs, and wall time, timeout and backgrounded job in the bottom border instead of a separate `⟨…⟩` line ([#16486](https://github.com/can1357/oh-my-pi/pull/16486) by [@H4vC](https://github.com/H4vC))
- The terminal `/jobs` sheet shows the selected job's full command ([#16486](https://github.com/can1357/oh-my-pi/pull/16486) by [@H4vC](https://github.com/H4vC))
- Grep, glob, find, IRC message, and `proc://`/`agent://`/`cfg://` result rows start at the same column as other tool rows ([#16486](https://github.com/can1357/oh-my-pi/pull/16486) by [@H4vC](https://github.com/H4vC))

### Fixed

- Fixed Tern sessions logging `TSP: terminal stopped acknowledging frames` every 5 seconds for as long as the terminal stops acknowledging frames; it now warns once per stall and logs the stall's length when acknowledgements resume ([#16393](https://github.com/can1357/oh-my-pi/pull/16393) by [@will-bogusz](https://github.com/will-bogusz))
- `splitPathAndSel` and `splitInternalUrlSel` peel comma line lists that include a tail chunk (`:1-12,-15`) or repeat the colon after a comma (`:1-30,:-30`, also beside `:raw`); `splitPathAndSel(path, { foldListColons: false })` keeps the repeated colon in the path ([#16435](https://github.com/can1357/oh-my-pi/pull/16435) by [@will-bogusz](https://github.com/will-bogusz))
- Generic tool cards now reveal the complete result when expanded ([#15335](https://github.com/can1357/oh-my-pi/pull/15335) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- Added `footerMeta` to `OutputBlockOptions` and `ToolCardSnapshot` to draw short facts inside a frame's bottom border ([#16486](https://github.com/can1357/oh-my-pi/pull/16486) by [@H4vC](https://github.com/H4vC))
- Fixed markdown table rows shattering at narrow widths when a wide glyph sat in a one-cell column; the glyph is now clamped to its column instead of re-wrapping the row ([#16479](https://github.com/can1357/oh-my-pi/pull/16479) by [@adi-IL](https://github.com/adi-IL)).
- Fixed charts in answers drawing as blank bands, on screen and in scrollback, when iTerm2 drew them in a background tab; inline images now carry an explicit height in rows ([#16471](https://github.com/can1357/oh-my-pi/pull/16471) by [@galtamam-cmyk](https://github.com/galtamam-cmyk))
- Fixed an inline image (such as a table's chart) disappearing in iTerm2 when new output pushed it past the top of the screen; it now moves to scrollback whole ([#16467](https://github.com/can1357/oh-my-pi/pull/16467) by [@galtamam-cmyk](https://github.com/galtamam-cmyk))
- Fixed inline images, hyperlinks, notifications and styled underlines staying off in iTerm2 sessions reached over SSH, where the forwarded `LC_TERMINAL` marker was ignored ([#16450](https://github.com/can1357/oh-my-pi/pull/16450) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- Added Eval `mcp_progress` status events, updated in place per call and evictable under the status-event cap, plus `formatMCPProgress()` and `MCPToolDetails.progress` for MCP progress display ([#16431](https://github.com/can1357/oh-my-pi/pull/16431) by [@alphastorm](https://github.com/alphastorm))

## [18.12.3] - 2026-10-19

### Added

- Added `IrcMessage.broadcast`, set on each copy of an `agent://all` broadcast so recipients can tell it from a direct message ([#16312](https://github.com/can1357/oh-my-pi/pull/16312) by [@will-bogusz](https://github.com/will-bogusz))
- `AutocompleteItem.descriptionMatch` marks a slash command matched only through its description; `Editor` Enter no longer applies such a row unless the user moved the selection onto it ([#16265](https://github.com/can1357/oh-my-pi/issues/16265))
- `ApprovalDialogComponent` accepts `grants` and `onGrant`: grant choices above **Approve Once**, led by a toggle that keeps them across sessions ([#16049](https://github.com/can1357/oh-my-pi/pull/16049) by [@Peribunt](https://github.com/Peribunt))
- Added `describeJobWidget`/`renderJobWidgetLines` to draw a background job's widget natively and as terminal lines, `describeJobTiles`/`renderJobTileLines` to draw jobs as tiles (status, title, figure, widget), and `renderSparkline` (with `peakBuckets`/`fitSparkValues`) for one-row block sparklines

### Fixed

- Fixed transparent images with empty top rows disappearing inside Zellij ([#16346](https://github.com/can1357/oh-my-pi/pull/16346) by [@Bouska](https://github.com/Bouska))
- Fixed bash output rewritten by the output minimizer skipping the per-line column cap (`tools.outputMaxColumns`), so a line wider than the cap reached the model whole; the raw output stays in its artifact ([#16314](https://github.com/can1357/oh-my-pi/pull/16314) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed the composer caret drifting one cell left per pasted image or video chip in terminals that draw the chip icon as a wide emoji (JetBrains terminal); the `unicode` preset now uses `📷`/`🎬` chip icons ([#16270](https://github.com/can1357/oh-my-pi/issues/16270))
- Fixed Tern hiding user text sent with `/skill:<name>` inside a collapsed skill card; only the loaded skill prompt is hidden ([#16311](https://github.com/can1357/oh-my-pi/issues/16311))
- Fixed SIXEL charts and images overlapping following content when their top rows scroll out of the viewport ([#16245](https://github.com/can1357/oh-my-pi/pull/16245) by [@JustasMasiulis](https://github.com/JustasMasiulis)).

## [18.12.2] - 2026-10-18

### Added

- Added `ComposerPreferences.completeScrollback` (default `false`): rows a growing HUD or dialog pushes off screen go straight to scrollback instead of being held back until it shrinks ([#15692](https://github.com/can1357/oh-my-pi/pull/15692) by [@Ilm-Alan](https://github.com/Ilm-Alan))
- `AssistantMessageComponent`'s native turn footer leads with a Copy icon (`zeta.turn.copy`) and a dot instead of the clock icon; it copies the answer's text and shows when the host handles transcript actions
- Add backslash+enter newline fallback for terminals without Kitty protocol
- Overlay compositing via `TUI.showOverlay()` and `TUI.hideOverlay()` for `ctx.ui.custom()` with `{ overlay: true }`
- Kitty keyboard protocol flag 2 support for key release events (`isKeyRelease()`, `isKeyRepeat()`, `KeyEventType`)
- `setKittyProtocolActive()`, `isKittyProtocolActive()` for Kitty protocol state management
- `kittyProtocolActive` property on Terminal interface to query Kitty protocol state
- `Component.wantsKeyRelease` property to opt-in to key release events (default false)
- Input component `onEscape` callback for handling escape key presses
- Emergency terminal restore to prevent corrupted state on crashes
- Overhauled UI with welcome screen and powerline footer
- Theme-configurable HTML export colors
- `ctx.ui.theme` getter for styling status text with theme colors
- Added `PI_TUI_WRITE_LOG` environment variable to capture raw ANSI output for debugging
- Added legacy Alt+letter handling and Alt+D delete word forward support in the editor keymap. ([#810](https://github.com/badlogic/pi-mono/pull/810) by [@Perlence](https://github.com/Perlence))
- `showOverlay()` now returns `OverlayHandle` with `hide()`, `setHidden(boolean)`, `isHidden()` for programmatic visibility control ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))
- New exported types: `OverlayAnchor`, `OverlayHandle`, `OverlayMargin`, `OverlayOptions`, `SizeValue` ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))
- `truncateToWidth()` now accepts optional `pad` parameter to pad result with spaces to exactly `maxWidth` ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))
- **Experimental:** Overlay compositing for `ctx.ui.custom()` with `{ overlay: true }` option ([#558](https://github.com/badlogic/pi-mono/pull/558) by [@nicobailon](https://github.com/nicobailon))
- `EditorComponent` interface for custom editor implementations
- `StdinBuffer` class to split batched stdin into individual sequences (adapted from [OpenTUI](https://github.com/anomalyco/opentui), MIT license)
- `Editor.getExpandedText()` method that returns text with paste markers expanded to their actual content ([#444](https://github.com/badlogic/pi-mono/pull/444) by [@aliou](https://github.com/aliou))
- Added mermaid block extraction and deduplication utilities (extractMermaidBlocks)
- Added `Alt+Delete` as a delete-word-forward shortcut
- Added configurable code block indentation for Markdown rendering
- Added undo support in the editor via `Ctrl+-`.
- Added configurable code block indentation for Markdown rendering.
- Added `Alt+Delete` as a delete-word-forward shortcut.
- Added `isPageUp()` and `isPageDown()` helper functions
- Added `SizeValue` type for CSS-like overlay sizing (absolute or percentage strings like `"50%"`)
- Added `OverlayHandle` interface with `hide()`, `setHidden()`, `isHidden()` methods for overlay visibility control
- Added `visible` callback to `OverlayOptions` for dynamic visibility based on terminal dimensions
- Added `pad` parameter to `truncateToWidth()` for padding result with spaces to exact width
- `StdinBuffer` class to split batched stdin into individual sequences
- Added `isCtrlY` helper function for detecting Ctrl+Y keyboard input
- Added configurable editor keybindings with typed key identifiers and action matching
- Added word-wrapped editor rendering for long lines
- Added `getText()` method to Text component for retrieving current text content
- Added `fullRedraws` readonly property to TUI class for tracking full screen redraws
- Added `showHardwareCursor` getter and setter to control cursor visibility while keeping IME positioning active. ([#800](https://github.com/badlogic/pi-mono/pull/800) by [@ghoulr](https://github.com/ghoulr))
- Added Emacs-style kill ring editing with yank and yank-pop keybindings. ([#810](https://github.com/badlogic/pi-mono/pull/810) by [@Perlence](https://github.com/Perlence))
- `EditorOptions` with optional `paddingX` for horizontal content padding, plus `getPaddingX()`/`setPaddingX()` methods ([#791](https://github.com/badlogic/pi-mono/pull/791) by [@ferologics](https://github.com/ferologics))
- Expanded keymap coverage for terminal compatibility: added support for Home/End keys in tmux, additional modifier combinations, and improved key sequence parsing ([#752](https://github.com/badlogic/pi-mono/pull/752) by [@richardgill](https://github.com/richardgill))
- `OverlayOptions.visible` callback for responsive overlays - receives terminal dimensions, return false to hide ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))
- `pageUp` and `pageDown` key support with `selectPageUp`/`selectPageDown` editor actions ([#662](https://github.com/badlogic/pi-mono/pull/662) by [@aliou](https://github.com/aliou))
- `fuzzyFilter()` and `fuzzyMatch()` utilities for fuzzy text matching
- Slash command autocomplete now uses fuzzy matching instead of prefix matching
- Added setAutocompleteMaxVisible() configuration (3-20 items)
- Added image detection to terminal capabilities (containsImage method)
- Added stdin monitoring to detect stalled input events and log warnings
- Added `pageUp` and `pageDown` key support with `selectPageUp`/`selectPageDown` editor actions
- Add `getExpandedText()` to editor for expanding paste markers
- Added `SymbolTheme` interface for customizing UI symbols including cursors, borders, spinners, and box-drawing characters
- Added support for custom spinner frames in the Loader component
- Added `setTopBorder()` method to Editor component for displaying custom status content in the top border
- Added `getWidth()` method to TUI class for retrieving terminal width
- Added rounded corner box-drawing characters to Editor component borders
- Added legacy terminal support for Ctrl+symbol keys (Ctrl+\, Ctrl+], Ctrl+-) and their Ctrl+Alt variants. ([#831](https://github.com/badlogic/pi-mono/pull/831) by [@Perlence](https://github.com/Perlence))
- Kitty keyboard protocol flag 2 support for key release events. New exports: `isKeyRelease(data)`, `isKeyRepeat(data)`, `KeyEventType` type. Terminals supporting Kitty protocol (Kitty, Ghostty, WezTerm) now send proper key-up events.

### Changed

- `UserMessageComponent`'s native hover toolbar (`zeta.user.tools`) leads with Copy and Rewind icon buttons (`copy`, `rewind`) instead of text labels, then a dot and the time, like the turn usage footer
- `ContextUsageView`'s native body (on terminals with `meter`) leads with the tokens used and the room left before auto-compaction, then one stacked bar ticked at the threshold, the breakdown as rows (`zeta.context.cat`, `.cat.free`, `.cat.buffer`: swatch, name, tokens, share; the exact count in the row's `title`) and the snapcompact estimate as labelled rows (`zeta.context.snap`); the blocks meter and legend `kv` are gone, and `contextUsageHead` no longer repeats the window size
- `AskDialogComponent`'s native root is `zeta.editor.ask` (collapsed: `zeta.editor.ask.hidden`, the countdown, the question as `zeta.ask.summary`, Skip and Show): a chosen answer is the `accent`-toned row (a check also carries the check icon) instead of the highlighted one; multi-select Other… is `zeta.ask.other.check`; the question tabs check answered questions and say their keys in the strip's `title`; the countdown moves from the head to the action bar beside Hide; the preview is `zeta.ask.preview`; the Review tab leads with `zeta.ask.notice` and lists answers (`zeta.ask.answers`) by question name with inline code mono and no `(Recommended)` suffix; option descriptions run inline code mono, notes ride the row's detail as `em`; Submit/Next's tooltip names only Enter (and Space on a multi-select)
- `MCPAddWizard`'s native sheet asks one question per step: a phase strip (`zeta.mcpAdd.progress` of `zeta.mcpAdd.phase`, toned done/current/upcoming and `neutral` when no auth was needed), the question and its lead (`zeta.mcpAdd.title`, `zeta.mcpAdd.tag` for optional fields, `zeta.mcpAdd.lead`), then a mono field with a placeholder and its rule or refusal (`zeta.mcpAdd.field`, `tone: "error"`; `zeta.mcpAdd.note`), choice rows with icons and mono tags (`zeta.mcpAdd.choices`), status lines (`zeta.mcpAdd.status`, `zeta.mcpAdd.checks`, `zeta.mcpAdd.error`) or the review rows (`zeta.mcpAdd.summary`). Cancel, Back and Continue / Save server buttons run Ctrl+C, Esc and Enter instead of a key-hint strip. The connection test shows its own busy step, the OAuth client secret field is masked, and the review saves on Enter (no Yes/No choice)
- `ReportPanel`'s native body carries the role `zeta.report.body`
- `HookInputComponent` describes a dock sheet (`zeta.overlay.hook-input` col) like `HookEditorComponent`'s: the title's first line (`zeta.hook-input.title`, the countdown as `zeta.hook-input.timer`) over its further lines (`zeta.hook-input.detail`), the field (`zeta.hook-input.field`, `tone: "error"` while a submit was refused) with its placeholder, and Cancel / Submit buttons that run Esc / Enter; the key legend under the field is terminal-only
- `JobsSheet`'s native body is a master–detail split (`zeta.jobs.split`: `zeta.jobs.master` | `zeta.jobs.detail`): the job list grouped Running / Recent (`zeta.jobs.group` labels), each row a type icon tinted by status with its duration, beside the selected job's status pill, live elapsed and Cancel job (`zeta.jobs.status`), its task title or command (`zeta.jobs.title` / `zeta.jobs.command`), facts (`zeta.jobs.facts`: agent, directory, pids, exit code, artifact) and output (`zeta.jobs.out`, `zeta.jobs.nooutput`); the footer counts running and recent jobs (`zeta.jobs.summary`), and no jobs shows an empty state (`zeta.jobs.empty`). Task jobs no longer draw an `agent` node here
- `BtwHistoryPanel`'s native sheet is centered and reads like a mail reader: the questions as two-line rows (`zeta.btw.history`, list `zeta.btw.list` / `zeta.btw.list.idle` while the answer has the keys) beside the selected thread (`zeta.btw.reader` › `zeta.btw.thread` › `zeta.btw.turn`: `zeta.btw.question` / `zeta.btw.followup`, `zeta.btw.meta`, `zeta.btw.answer`, `zeta.btw.error`), the follow-up field under the last answer (`zeta.btw.composer`), and footer buttons Stop answer, Copy answer, Close and Follow up (Cancel and Send while composing) in place of the focus labels and key-hint strip; an empty history is an `md` sheet (`zeta.btw.empty`)
- The `wait` tool's native job rows (`zeta.wait.job`) are a single `row`: badge, id and label, progress and clock, without the output preview or capture notice beneath
- The native bash run foot reads In background with a live clock (`zeta.run.time` without `stopped`) while a parked job's frames stream (`details.async.state === "running"`, partial), instead of Running
- Moved `wrapTextWithAnsi` export to `@linxiraos/pi-natives` package
- Default editor `newLine` binding now uses `shift+enter` only
- Hardware cursor is now disabled by default for better terminal compatibility. Set `PI_HARDWARE_CURSOR=1` to enable (replaces `PI_NO_HARDWARE_CURSOR=1` which disabled it).
- Migrated key parsing and matching logic to native implementation for improved performance
- Simplified `isKeyRelease()` and `isKeyRepeat()` to use regex pattern matching instead of string inclusion checks
- Refactored `visibleWidth` function to use caching wrapper around new `visibleWidthRaw` implementation for improved performance
- Improved performance of key ID parsing with optimized cache lookup strategy
- Simplified `visibleWidth` calculation to use consistent Bun.stringWidth approach for all string lengths
- Replaced external `fd` binary with native fuzzy path search for `@`-prefixed autocomplete
- Restructured terminal capabilities from interface-based to class-based model
- Improved table column width calculation with word-aware wrapping
- Refactored text utilities to use native WASM implementations for strings >256 chars with JS fast path
- Added Ctrl+Backspace as a delete-word-backward keybinding and improved modified backspace matching
- Migrated file system operations from synchronous to asynchronous APIs in autocomplete provider for non-blocking I/O
- Migrated node module imports from named to namespace imports across all packages for consistency with project guidelines
- Normalized keybinding definitions to lowercase internally
- Improved fuzzy matching to handle alphanumeric swaps.
- Normalized keybinding definitions to lowercase internally.
- Changed `showOverlay()` to return `OverlayHandle` for controlling overlay visibility
- Removed `widthPercent`, `maxHeightPercent`, `rowPercent`, `colPercent` from `OverlayOptions` (use percentage strings instead)
- Improved file autocomplete to show directory listing when typing `@` with no query, and fall back to prefix matching when fuzzy search returns no results
- Terminal startup now queries Kitty protocol support before enabling event reporting
- Changed cursor style from block to thin blinking bar (▏) at end of line
- Editor component now uses word wrapping instead of character-level wrapping for better readability ([#382](https://github.com/badlogic/pi-mono/pull/382) by [@nickseelert](https://github.com/nickseelert))
- Renamed `EllipsisKind` enum to `Ellipsis` for clearer API naming
- Changed hardcoded ellipsis character from theme-configurable to literal "…" in editor truncation
- Improved blockquote rendering with text wrapping in Markdown component
- Expanded Kitty keyboard protocol coverage for non-Latin layouts and legacy Alt sequences
- Improved cursor positioning with safer bounds checking
- Updated editor layout to respect configurable padding
- Refactored scrolling logic for better viewport management

### Fixed

- Fixed table charts picking the wrong label and measure columns when numbers group thousands with spaces (`1 988`, `17 083`); they now read like `1,988` ([#16175](https://github.com/can1357/oh-my-pi/issues/16175))
- Fixed terminal capability replies relayed through win32-input-mode appearing as typed input in WSL terminals ([#16137](https://github.com/can1357/oh-my-pi/issues/16137))
- Fixed the status-bar activity spinner and turn timer freezing until the next keypress when the working-row loader is stopped mid-turn; an open turn window now repaints the status line on its own timer ([#16109](https://github.com/can1357/oh-my-pi/pull/16109) by [@tommymorgan](https://github.com/tommymorgan)).
- Fixed pasting sometimes inserting a block of base64 text instead of the pasted text in terminals that deliver pastes through the Kitty clipboard protocol (OSC 5522), most often with dictation apps that paste for you; a slow paste now arrives whole, and keys typed while a paste never finishes are given back instead of lost ([#16170](https://github.com/can1357/oh-my-pi/pull/16170) by [@H4vC](https://github.com/H4vC))
- Fixed a streaming table bouncing everything below it up and down while its last cell was still being written ([#16116](https://github.com/can1357/oh-my-pi/pull/16116) by [@galtamam-cmyk](https://github.com/galtamam-cmyk))
- Fixed inline images in iTerm2 being sized for the wrong cell shape, which left charts smeared or offset ([#16118](https://github.com/can1357/oh-my-pi/pull/16118) by [@galtamam-cmyk](https://github.com/galtamam-cmyk))
- Remove trailing space padding from Text, Markdown, and TruncatedText components when no background color is set (fixes copied text including unwanted whitespace)
- Fixed Ctrl+Enter sequences to insert new lines in the editor
- Fixed `fd` tool detection to automatically find `fd` or `fdfind` in PATH when not explicitly configured
- Fixed editor multi-line insertion handling and lastAction tracking ([#945](https://github.com/badlogic/pi-mono/pull/945) by [@Perlence](https://github.com/Perlence))
- Fixed editor word wrapping to reserve a cursor column ([#934](https://github.com/badlogic/pi-mono/pull/934) by [@Perlence](https://github.com/Perlence))
- Fixed editor word wrapping to use single-pass backtracking for whitespace handling ([#924](https://github.com/badlogic/pi-mono/pull/924) by [@Perlence](https://github.com/Perlence))
- Fixed Kitty image ID allocation and cleanup to prevent image ID collisions between modules
- Fixed viewport tracking and cursor positioning for overlays and content shrink scenarios
- Autocomplete now allows searches with `/` characters (e.g., `folder1/folder2`) ([#882](https://github.com/badlogic/pi-mono/pull/882) by [@richardgill](https://github.com/richardgill))
- Directory completions for `@` file attachments no longer add trailing space, allowing continued autocomplete into subdirectories
- `visibleWidth()` and `extractAnsiCode()` now handle APC escape sequences (`ESC _ ... BEL`), fixing width calculation and string slicing for strings containing cursor markers
- SelectList now handles multi-line descriptions by replacing newlines with spaces ([#728](https://github.com/badlogic/pi-mono/pull/728) by [@richardgill](https://github.com/richardgill))
- Reset ANSI styles after each rendered line to prevent style leakage
- Cursor position tracking when content shrinks with unchanged remaining lines
- TUI renders with wrong dimensions after suspend/resume if terminal was resized while suspended ([#599](https://github.com/badlogic/pi-mono/issues/599))
- Pasted content containing Kitty key release patterns (e.g., `:3F` in MAC addresses) was incorrectly filtered out ([#623](https://github.com/badlogic/pi-mono/pull/623) by [@ogulcancelik](https://github.com/ogulcancelik))
- `visibleWidth()` now strips OSC 8 hyperlink sequences, fixing text wrapping for clickable links ([#396](https://github.com/badlogic/pi-mono/pull/396) by [@Cursivez](https://github.com/Cursivez))

Older entries are archived in [packages/tui/CHANGELOG.md@9caccab691ce](https://github.com/can1357/oh-my-pi/blob/9caccab691ce575007f4b6bcbaf8f944723d5457/packages/tui/CHANGELOG.md).
Older entries are archived in [packages/tui/CHANGELOG.md@58141d4e5fa8](https://github.com/can1357/oh-my-pi/blob/58141d4e5fa892166024e2168866c45e0baacde3/packages/tui/CHANGELOG.md).
- Corrected editor end-of-line cursor rendering assertion to use includes() instead of endsWith()
- Fixed potential errors during emergency terminal restore when terminal is already dead
- Fixed autocomplete race condition by tracking request ID to prevent stale suggestion results
- Added legacy terminal support for `Ctrl+` symbol key combinations
- Added legacy terminal support for `Ctrl+` symbol key combinations.
- Fixed backspace handling with additional codepoint support
- Fixed Alt+letter key combinations for better recognition
- TUI now filters out key release events by default, preventing double-processing of keys
- `matchesKey()` now correctly matches Kitty protocol sequences for unmodified letter keys
- Crash when pasting text with trailing whitespace exceeding terminal width through Markdown rendering
- Slash command menu now only triggers when the editor input is otherwise empty ([#904](https://github.com/badlogic/pi-mono/issues/904))
- Center-anchored overlays now stay vertically centered when resizing the terminal taller after a shrink ([#950](https://github.com/badlogic/pi-mono/pull/950) by [@nicobailon](https://github.com/nicobailon))
- Shift+Space, Shift+Backspace, and Shift+Delete now work correctly in Kitty-protocol terminals (Kitty, WezTerm, etc.) instead of being silently ignored ([#411](https://github.com/badlogic/pi-mono/pull/411) by [@nathyong](https://github.com/nathyong))
- Improved Kitty terminal key sequence parsing to correctly handle text field codepoints in CSI-u sequences
- Fixed handling of private use Unicode codepoints (U+E000 to U+F8FF) in Kitty key decoding to prevent invalid character interpretation
- Simplified terminal write error handling to mark terminal as dead on any write failure
- Fixed multi-line strings in renderOutputBlock causing width overflow
- Fixed slash command autocomplete applying stale completion when typing quickly
- Reserved cursor space for zero padding and corrected end-of-line cursor rendering to prevent wrap glitches
- Fixed viewport tracking after partial renders to prevent autocomplete list artifacts
- Rendering optimizations: only re-render changed lines
- Refactor input component to use keybindings manager
- Fixed editor cursor blinking by allowing terminal cursor positioning when enabled.
- Editor no longer corrupts terminal display when text exceeds screen height. Content now scrolls vertically with indicators showing lines above/below the viewport. Max height is 30% of terminal (minimum 5 lines). ([#732](https://github.com/badlogic/pi-mono/issues/732))
- Cursor now moves to end of content on exit, preventing status line from being overwritten ([#629](https://github.com/badlogic/pi-mono/pull/629) by [@tallshort](https://github.com/tallshort))
- Slash command autocomplete now triggers for commands starting with `.`, `-`, or `_` (e.g., `/.land`, `/-foo`) ([#422](https://github.com/badlogic/pi-mono/issues/422))

### Removed

- `SingleResult` (and the task tool's settled payload) carries the failure diagnostics an agent-driven model switch needs: optional `failureClass` (`usage-limit` / `auth` / `account-policy` / `context-overflow` / `transient` / `aborted` / `unknown`), optional `fallbackCandidates` (other selectors this session could run), and optional `modelChange` (`{ source: "spawn-param" | "wake-param", from?, to }`) recording that a caller-supplied model replaced the default one. All three stay absent unless a run actually reports them.
- The welcome/splash brand art is now generated with the standard FIGlet tool instead of being drawn by hand: `ZETA_LOGO` renders the mark `Z` (the ASCII form of `Ζ`), `ZETA_WORDMARK` renders `Zeta` (both in the standard `ANSI Shadow` font) and `ZETA_SUBLINE` renders the `Linxira-Zeta` identity line in `mini`, with the version under the wordmark. `bun scripts/brand/generate-logo-art.ts` regenerates the three constants from the vendored fonts, and the brand guard fails on any hand-edited glyph.
- Removed `ellipsis` property from `SymbolTheme` interface
- Removed `extractAnsiCode` function from public API
- Removed TUI layout engine exports from public API (BoxNode, ColumnNode, LayoutNode, etc.)
- Removed `visibleWidth` benchmark file in favor of Kitty sequence benchmarking

## [1.3.0] - 2026-10-18

### Breaking Changes

- `numberedCode`, `readContentCode` and `nativeDiff` take the file's path (`path`) instead of a language, and `describeGroupedOutput` drops its `lang` option: Tern picks the grammar of file contents from their path
- Removed `RuntimeChildrenOptions.transient` and `Component.retireDisplacedTranscript`: the composer now bills all chrome below the transcript at the smallest height it has rendered, so no root opts in or out ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- `FindStats.errors` is replaced by `failed` (judge requests that failed) and `unanswered` (unusable answers), and `FindToolDetails` requires a `coverage` status; the find renderer shows `N/M requests failed` ([#15744](https://github.com/can1357/oh-my-pi/issues/15744))

### Changed

- Advisor notes in Tern read as a callout tinted by their worst severity: its icon and a tally (`Concern`, `1 blocker · 2 concerns`) head the card with the advisor's name at the end, and several notes each lead with their own severity icon
- The `OMP_TUI_DEBUG` control socket now uses the native IPC transport: it is owner-only and no longer replaces a socket another live process is serving.
- Transcript rows pushed aside by an open dialog, report or HUD now reach scrollback when it closes or newer output pushes them out, instead of while it is open ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- A transcript block straddling the top of the screen now sends only its off-screen rows to scrollback; the rest stays live ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- Native model pickers (/model, the quick switch and the advisor's) mark providers with their logo (`mark.icon: "provider:<id>"`, initials where the terminal has none), and every model row leads with its provider's mark
- Updated model picker to offer manual effort selection for unverified models instead of automatic mode
- Improved nested tool status line rendering: moved preview content into a dedicated collapsible code block when expanded and limited field widths on the one-line summary
- Suppressed typo highlighting for the word currently being typed to avoid distracting inline markers while composing
- `ApprovalDialogComponent` shows a choice list (Approve, an optional `session` row, Deny): the arrow keys move between them and Enter (armed after `APPROVE_ARM_MS`) takes the highlighted one; while a composer draft holds Enter the highlight sits on Deny, relabeled "Deny and send message"; Tern clicks on a choice take it; Page Up/Down scroll the details

### Fixed

- Fixed images rendering blank inside tmux on Kitty-capable terminals when tmux's `allow-passthrough` is off (the default); omp now falls back to SIXEL or the text placeholder instead of sending Kitty graphics tmux drops
- Fixed Tern drawing tool cards' file contents (write, read, edit, grep, find, ast-grep, ast-edit) plain or in the wrong language when omp did not know the file's extension (`.ptx`) or mapped it to a neighbor (`.cu` as C++); omp now sends the file's path and Tern picks the grammar
- `CountdownTimer`'s native `elapsed` no longer sends `stopped: 0`, which froze every native countdown (extension input, selector and editor prompts) at zero from the start
- The native backend's focus now reaches a field inside an `overlay`/`picker` sheet hoisted into the layer from a dock component (the MCP add wizard, login), so that field shows the live caret and focus ring
- `MCPAddWizard` keeps a refused name or URL in its field, clears a stale refusal on Back, ignores a connection test that settles after the user stepped back, and Edit OAuth settings after a failed sign-in opens the settings again instead of doing nothing
- Fixed blank rows opening under the editor after an ask or other inline dialog, command report or todo/loader HUD closed in a session that had filled the screen; the screen now refills with the transcript ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- Fixed the editor rising above blank rows when a live tool preview collapses under scrolled-off output; it now stays on the bottom row ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- Fixed blank rows opening inside a streamed answer when the working loader went away at the end of a turn ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- Fixed a split transcript block dropping punctuation-only rows it reveals after the split (such as a tool pane's rule line on expand); the seam now stops before them instead of treating them as already committed ([#15420](https://github.com/can1357/oh-my-pi/pull/15420) by [@H4vC](https://github.com/H4vC))
- Fixed a split transcript block fingerprinting measured rows instead of the bytes committed to scrollback, which could duplicate a SIXEL image prefix once its pending encode landed ([#15420](https://github.com/can1357/oh-my-pi/pull/15420) by [@H4vC](https://github.com/H4vC))
- Fixed a transcript block straddling the top of the screen losing its off-screen rows when the inline-image limit demoted its images to text in the same frame; those rows now reach scrollback as text
- Fixed the `snapcompact.shape` settings preview labelling variants `5x8-sent` and repeating the first variant's sample when the frame edge differs from the variant table (Claude and GPT on Cursor; `auto` on high-resolution Claude) ([#15448](https://github.com/can1357/oh-my-pi/pull/15448) by [@will-bogusz](https://github.com/will-bogusz))
- The model browser shows the price a model is billed at now, not the one current when its row was loaded: DeepSeek V4 Pro shows its $0.30 / $1.20 card in effect since 2026-09-14 instead of $1.32 / $3.96, and Gemini 4 Argon switches to $4 / $20 on 2026-12-01 ([#15620](https://github.com/can1357/oh-my-pi/pull/15620) by [@eggpeat](https://github.com/eggpeat))
- Clicking Copy answer in the `/btw` history (and Copy raw in the raw SSE viewer) on native terminals copies the answer instead of the button's label ([#15547](https://github.com/can1357/oh-my-pi/pull/15547) by [@H4vC](https://github.com/H4vC))
- Fixed image previews inside tmux showing as `SIXEL IMAGE (WxH)` placeholder text when the outer terminal lacks SIXEL; SIXEL is now enabled from tmux's DA1 reply only when tmux's terminal description for the attached client has `Sxl` ([#15513](https://github.com/can1357/oh-my-pi/issues/15513))
- Fixed transcript images not opening their file: image placeholders and native image nodes now link to the source file or a stored copy ([#15872](https://github.com/can1357/oh-my-pi/pull/15872) by [@H4vC](https://github.com/H4vC))
- A collapsing live block no longer leaves its slack as a band of blank rows between the retired history and the live rows: the slack falls below the transcript, so a streamed reply stays contiguous and the input keeps the bottom row ([#15499](https://github.com/can1357/oh-my-pi/pull/15499) by [@iacore](https://github.com/iacore))
- Fixed width-aware text on native (TSP) terminals truncating content two columns early ([#15806](https://github.com/can1357/oh-my-pi/pull/15806) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- Fixed Tab/right-arrow completion silently dismissing a selected `@"quoted path"` file suggestion when the path contains spaces ([#15698](https://github.com/can1357/oh-my-pi/pull/15698) by [@drawde-nadroj](https://github.com/drawde-nadroj))
- Bracketed pastes are now capped by their UTF-8 size, so a large multibyte paste no longer buffers past the byte limit ([#15803](https://github.com/can1357/oh-my-pi/pull/15803) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- Fixed OSC 66 text-sized spans bypassing truncation when their UTF-16 length was short enough to fit the fast-path guard ([#15802](https://github.com/can1357/oh-my-pi/pull/15802) by [@yuzu-octopus](https://github.com/yuzu-octopus))
- Updated the `ast_grep` result view's truncated-match note to suggest `skip` pagination instead of the schema's nonexistent `increase limit` flag ([#15532](https://github.com/can1357/oh-my-pi/issues/15532), [#15543](https://github.com/can1357/oh-my-pi/pull/15543) by [@peda-cos](https://github.com/peda-cos)).
- Fixed a streaming Edit preview with long wrapped lines growing past its row cap, because its tail was budgeted without the diff gutter its continuation rows hang under ([#15679](https://github.com/can1357/oh-my-pi/pull/15679))
- Fixed malformed base64 padding being accepted for chat image attachments before native image decoding ([#15765](https://github.com/can1357/oh-my-pi/pull/15765) by [@anatoli-tsinovoy](https://github.com/anatoli-tsinovoy)).
- Fixed Shift+Enter submitting and Ctrl+Enter inserting a newline in Windows Terminal 1.25–1.27 after closing any fullscreen view such as `/settings`; the terminal dropped omp's keyboard mode on leaving the alternate screen ([microsoft/terminal#20763](https://github.com/microsoft/terminal/issues/20763)), so omp now re-applies it ([#15868](https://github.com/can1357/oh-my-pi/pull/15868) by [@H4vC](https://github.com/H4vC)).
- Long lines in native (Tern) `read`, `write`, and code-cell source now wrap instead of scrolling each block sideways ([#15823](https://github.com/can1357/oh-my-pi/issues/15823)).
- Fixed long text pastes taking seconds to land in terminals that deliver a paste one key at a time, such as JetBrains' terminal on Windows; omp no longer writes to the terminal for every pasted key ([#15757](https://github.com/can1357/oh-my-pi/issues/15757))
- Fixed Shift+Enter submitting the prompt and Ctrl+Enter inserting a newline in WSL under Windows Terminal 1.24 and earlier, conhost, and other ConPTY hosts without kitty keyboard support; Shift+Enter now inserts a newline and Ctrl+Enter sends a follow-up, as on native Windows.
- Fixed streamed Markdown tables jumping around as each row arrives: the terminal UI fills the row being written in under the existing column widths, and native (TSP) terminals receive each row once its line is complete ([#15856](https://github.com/can1357/oh-my-pi/pull/15856) by [@H4vC](https://github.com/H4vC)).
- Fixed streamed links and inline math showing raw `[text](url` or LaTeX and then rewrapping the paragraph when they close, in the terminal UI and native (TSP) terminals: they now render in their closed form while they stream ([#15864](https://github.com/can1357/oh-my-pi/pull/15864) by [@H4vC](https://github.com/H4vC)).
- Paint-only overlays no longer swallow typing intended for the focused input beneath them ([#15793](https://github.com/can1357/oh-my-pi/issues/15793)).
- SVG fences in CRLF or CR-only assistant Markdown now render as figures instead of source code ([#15663](https://github.com/can1357/oh-my-pi/issues/15663)).
- Fixed clipboard-image and image-path pastes being dropped while the composer draft is edited beneath an ask or approval dialog ([#15642](https://github.com/can1357/oh-my-pi/pull/15642) by [@H4vC](https://github.com/H4vC))
- Fixed inline images inside tmux assuming Kitty graphics from the pane's `TERM`; the attached client is identified from tmux's terminal-type reply or its `TERM` (e.g. `xterm-kitty`), and unrecognized clients go to the SIXEL probe ([#15524](https://github.com/can1357/oh-my-pi/issues/15524)).
- Fixed ```svg fences rendering as their source code instead of a drawing when no theme was installed yet, e.g. in an extension rendering a message that opens with the fence ([#15660](https://github.com/can1357/oh-my-pi/issues/15660))
- Fixed pastes inside tmux 3.5a and older submitting line by line after another program turned bracketed paste off on the pane; omp now re-enables it on the next render or keypress ([#15596](https://github.com/can1357/oh-my-pi/issues/15596))
- Fixed assistant replies containing a table (on image-capable terminals with table charts on) publishing still-streaming rows to native scrollback, which froze the block's append-only retirement and could leave overwritten reply rows in scrollback ([#15693](https://github.com/can1357/oh-my-pi/issues/15693))
- Fixed streamed thinking publishing a line to native scrollback just before a code fence or `<!-- -->` sentinel split across deltas rewrote it with the prose-fold ellipsis ([#15693](https://github.com/can1357/oh-my-pi/issues/15693))
- Fixed streamed assistant text or thinking containing a tab stopping all later rows of the reply from retiring into native scrollback until the turn ended ([#15693](https://github.com/can1357/oh-my-pi/issues/15693))
- Fixed wrapped lines in Write, Read, Edit, Todo, Ask and LSP tool cards losing their alignment under line numbers, tree connectors, and option or code rails ([#15677](https://github.com/can1357/oh-my-pi/issues/15677))
- Fixed SIXEL images leaving their previous raster on screen, drawn again over itself, when the transcript moves them within the viewport ([#15657](https://github.com/can1357/oh-my-pi/issues/15657))
- Fixed double-clicking an extension switched off in `/extensions` in Tern not switching it back on
- Fixed the queued-messages badge in Tern showing a bare count that read as the first message's number; it now reads `N queued`
- Fixed table charts on TSP terminals to use SVG fences and respect terminal palette
- Fixed table charts in Tern's native view drawing in the other appearance's colors (light labels on a light page) when omp's light/dark detection disagreed with Tern; Tern now colors them in the theme it shows, like the prose around them
- Fixed the /btw history answer being stuck at the bottom while a follow-up is being written: Up/Down and Page Up/Down now scroll the answer without leaving the draft ([#15902](https://github.com/can1357/oh-my-pi/pull/15902) by [@H4vC](https://github.com/H4vC))
- Fixed macOS editor spelling assistance hanging silently when the spelling service stops responding; it now reports and disables itself instead ([#12084](https://github.com/can1357/oh-my-pi/issues/12084), [#14341](https://github.com/can1357/oh-my-pi/pull/14341) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed a chip toggled in a multi-select setting's open submenu leaving its row and its tab's changed badge showing the old selection until the submenu was closed ([#14444](https://github.com/can1357/oh-my-pi/pull/14444) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed `@` file autocomplete freezing when the project contains a symlink into a very large directory tree; the fuzzy walk now stops after 1.5 s and the popup falls back to the immediate-directory listing ([#12317](https://github.com/can1357/oh-my-pi/issues/12317), [#14330](https://github.com/can1357/oh-my-pi/pull/14330) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed omp in a Tern pane showing the classic CLI when a shell rc, dev shell or `.env` set `TERM` to a `screen*`/`tmux*` value with no multiplexer running; only a real tmux/screen/zellij/herdr/cmux/wmux session now keeps Tern's native view off
- omp inside devenv 2.x's reloading `devenv shell` now starts on the classic renderer instead of opening Tern's native view and abandoning it: devenv's terminal layer drops Tern's protocol, so the native view needs `devenv shell --no-reload`. The debug log now records why a Tern pane stays on the classic renderer
- Fixed large terminal paints on Windows being split mid-row, which let other output land inside a row; writes are now cut at row boundaries ([#14187](https://github.com/can1357/oh-my-pi/pull/14187) by [@mateusant13](https://github.com/mateusant13))
- Fixed `TUI.addStartListener()` hooks added after `start()` never running until the next stop/start cycle; a hook added to a running TUI now runs at once ([#15369](https://github.com/can1357/oh-my-pi/pull/15369) by [@LoneExile](https://github.com/LoneExile))
- Fixed the git viewer advertising stage, discard, select and commit keys while showing a clean tree's HEAD commit, where none of them do anything; the footer and sidebar now describe the commit view ([#14347](https://github.com/can1357/oh-my-pi/issues/14347), [#14480](https://github.com/can1357/oh-my-pi/pull/14480) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed the status line `pr` segment keeping the previous branch's PR after switching to the default branch, a detached HEAD, or a branch without a PR ([#15455](https://github.com/can1357/oh-my-pi/pull/15455) by [@ravshansbox](https://github.com/ravshansbox))
- Fixed the status-line footer total leaving out task subagent spend; it now reads the session's cumulative usage, the same source the interactive status line uses ([#14393](https://github.com/can1357/oh-my-pi/pull/14393) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed transcript rows disappearing from scrollback or reappearing out of order when bottom chrome stays taller after a turn, self-clearing HUDs close, or the composer shape changes ([#15820](https://github.com/can1357/oh-my-pi/pull/15820) by [@emmahyde](https://github.com/emmahyde))
- Fixed a streamed Markdown list keeping every item out of native scrollback until the turn ended, so rows that scrolled off screen were unreachable mid-stream; items in front of the newest one now retire as soon as it begins ([#13676](https://github.com/can1357/oh-my-pi/issues/13676), [#15993](https://github.com/can1357/oh-my-pi/pull/15993) by [@shgew](https://github.com/shgew))
- Fixed SIXEL charts and SVG figures being resampled before display, which softened their text, on terminals whose cell height is not a multiple of 6 such as Windows Terminal ([#16007](https://github.com/can1357/oh-my-pi/issues/16007))
- Fixed sessions run inside tmux silently falling back to the terminal's true-color profile when the client terminal-type probe answered slowly on a loaded machine ([#16020](https://github.com/can1357/oh-my-pi/pull/16020) by [@CharleoYang](https://github.com/CharleoYang))
- Fixed the `read` result notice printing the absolute resolved path, so a file under the home directory reads `Resolved path: ~/notes.txt` instead of `/home/you/notes.txt` ([#16055](https://github.com/can1357/oh-my-pi/pull/16055) by [@adi-IL](https://github.com/adi-IL)).
- Fixed grep/read previews and other tool cards passing raw escape sequences from file contents to the terminal, which could switch it to the alternate screen with mouse reporting on, live and again on every resume ([#15963](https://github.com/can1357/oh-my-pi/issues/15963))
- Fixed a final status-line render after shutdown scheduling another usage refresh ([#15845](https://github.com/can1357/oh-my-pi/issues/15845)).
- Fixed Ctrl+O on LSP status and other plain LSP responses still clipping every row at 80 columns; expanded rows now wrap to show the full text ([#15824](https://github.com/can1357/oh-my-pi/issues/15824))
- Fixed Ctrl+O leaving long rows clipped in expanded LSP, debug, MCP, web search fallback, yield, task and custom-tool results; expanded rows now wrap to show the full text, expanded LSP references list every location, and the LSP expand hint no longer appears when nothing is hidden ([#15824](https://github.com/can1357/oh-my-pi/issues/15824))
- Fixed jagged text and disappearing translucent details in SIXEL images, including re-encoding when the terminal reports a changed background color ([#15891](https://github.com/can1357/oh-my-pi/pull/15891) by [@Bouska](https://github.com/Bouska)).
- Fixed stale SIXEL backgrounds after terminal restarts, native appearance changes, and failed TSP handshakes, including background changes during the handshake, fixed themes, missing or invalid startup themes, or identical light/dark mappings ([#15891](https://github.com/can1357/oh-my-pi/pull/15891) by [@Bouska](https://github.com/Bouska)).

### Added

- Added the `app.ask.hide` keybinding (default `Alt+H`) and Hide/Show actions on `AskDialogComponent`, which collapse the dialog to a single line while its question stays pending ([#15400](https://github.com/can1357/oh-my-pi/pull/15400) by [@H4vC](https://github.com/H4vC))
- Added opt-in `/tree` branch navigation across visible branches and nested fork depths; bind `app.tree.previousBranch` / `app.tree.nextBranch` (e.g. to `Shift+Left` / `Shift+Right`) in `keybindings.yml` ([#12623](https://github.com/can1357/oh-my-pi/pull/12623) by [@azain47](https://github.com/azain47)).
- Added `ApprovalDialogComponent` and the `app.approval.approve` keybinding (default `Ctrl+Enter`, `Ctrl+Q`) ([#15548](https://github.com/can1357/oh-my-pi/pull/15548) by [@H4vC](https://github.com/H4vC))
- Plan review overlay can take a remote answer: it shows the remotely chosen execution tier and locks further input like a terminal approval ([#15552](https://github.com/can1357/oh-my-pi/pull/15552) by [@Shadorain](https://github.com/Shadorain))
- Added a tree layout to the background jobs sheet: subagents' jobs nest under the task job that runs them, busiest branches first, and Cancel appears only on the viewing agent's own jobs ([#15854](https://github.com/can1357/oh-my-pi/pull/15854) by [@H4vC](https://github.com/H4vC))
- Added native composer microphone controls with visible starting, recording and transcription states; a start still loading its model can be cancelled, and Enter and Send wait while dictation is recording or transcribing into the draft ([#15759](https://github.com/can1357/oh-my-pi/pull/15759) by [@daaximus](https://github.com/daaximus)).
- `ApprovalDialogComponent` takes a `draft` option that routes typing to the composer beneath it, so a message can be written while a tool call waits ([#15642](https://github.com/can1357/oh-my-pi/pull/15642) by [@H4vC](https://github.com/H4vC))
- `ApprovalDialogComponent` takes a `fullPrompt` option that the expand key (`app.tools.expand`) or a Details button swaps in for the summarized prompt; it replaces `wrapDetails` ([#15642](https://github.com/can1357/oh-my-pi/pull/15642) by [@H4vC](https://github.com/H4vC))
- Added selection-only session and model picker actions for `/seance`, so choosing a source or model leaves the active session and model unchanged ([#15036](https://github.com/can1357/oh-my-pi/pull/15036) by [@anatoli-tsinovoy](https://github.com/anatoli-tsinovoy))
- Added `pi.showProfile` to `StatusLineSegmentOptions`: `false` keeps the `pi` segment's bare glyph under a named profile, in the rendered bar and in `describe` ([#16063](https://github.com/can1357/oh-my-pi/pull/16063) by [@shgew](https://github.com/shgew))

### Removed

- Removed `Composer.pinInputToBottom()`; the composer keeps the input on the bottom row by itself ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- Removed the unused `app.tree.foldOrUp` / `app.tree.unfoldOrDown` keybinding ids, which no longer did anything.
- Added `parksAsBackground(toolName, details)`, `asyncJobState(details)`, `isSettledJobFrame(details)` and `settleWithJobFrame(component, frame, toolCallId)` (`chat/tool-execution`): whether a returned call's card stays live for its background job's frames (`task` always; `bash` and `eval` under native rendering), the job state a frame reports, and settling the card with the job's last frame (a cancelled job keeps its output and seals as cancelled)
- `BashToolDetails.async.state` and `EvalToolDetails.async.state` gain `cancelled` for a job killed before it finished
- Removed `tools/eval-format/code-mode-declarations` (`generateCodeModeDeclarations`), which only served Codex Code Mode.

## [1.2.1] - 2026-10-13

- The welcome box now resolves its labels, the `Tip:` label, the `[NEW]` tag, and every tip body through the host `tuiText` catalogue (`welcome*` and `tipN` keys, where `tipN` maps to `tips.txt` line N). The inline English stays as the permanent fallback, so rendering without a registered source is unchanged; a registered source localises the box and re-renders on a live language switch.
- Welcome banner restored to the upstream logo lockup: the ζ block mark sits beside a half-block `Zeta` wordmark with the version under it and the session tip below, replacing the two-column card. Model/provider labels, LSP servers and recent sessions are no longer rendered (the same removal upstream shipped in `1fb10d29bc1`), and the setup splash now reuses a cached water field, cell grid and per-frame gradient escapes with a skip hint that follows the live symbol preset.

## [1.2.0] - 2026-10-12

- Added cache-release hooks for TUI components and tool cards, allowing extensions to discard derived render data without rebuilding content ([#13632](https://github.com/can1357/oh-my-pi/pull/13632) by [@iliaal](https://github.com/iliaal)).

### Breaking Changes

- **Key detection functions removed**: All `isXxx()` key detection functions (`isEnter()`, `isEscape()`, `isCtrlC()`, etc.) have been removed. Use `matchesKey(data, keyId)` instead (e.g., `matchesKey(data, "enter")`, `matchesKey(data, "ctrl+c")`). This affects hooks and custom tools that use `ctx.ui.custom()` with keyboard input handling. ([#405](https://github.com/badlogic/pi-mono/pull/405))

### Removed

- Removed `truncateToWidth`, `sliceWithWidth`, and `extractSegments` functions from public API (now re-exported directly from @linxiraos/pi-natives)

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

### Fixed

- Fixed appended lines not being committed to scrollback, causing earlier content to be overwritten when viewport fills ([#954](https://github.com/badlogic/pi-mono/issues/954))

## [0.49.3] - 2026-01-22

### Added

- `codeBlockIndent` property on `MarkdownTheme` to customize code block content indentation (default: 2 spaces) ([#855](https://github.com/badlogic/pi-mono/pull/855) by [@terrorobe](https://github.com/terrorobe))
- Added Alt+Delete as hotkey for delete word forwards ([#878](https://github.com/badlogic/pi-mono/pull/878) by [@Perlence](https://github.com/Perlence))

### Changed

- Fuzzy matching now scores consecutive matches higher and penalizes gaps more heavily for better relevance ([#860](https://github.com/badlogic/pi-mono/pull/860) by [@mitsuhiko](https://github.com/mitsuhiko))

### Fixed

- Autolinked emails no longer display redundant `(mailto:...)` suffix in markdown output ([#888](https://github.com/badlogic/pi-mono/pull/888) by [@terrorobe](https://github.com/terrorobe))

## [0.49.1] - 2026-01-18

### Added

- Added undo support to Editor with Ctrl+- hotkey. Undo coalesces consecutive word characters into one unit (fish-style). ([#831](https://github.com/badlogic/pi-mono/pull/831) by [@Perlence](https://github.com/Perlence))

## [0.48.0] - 2026-01-16

### Fixed

- Decode Kitty CSI-u printable sequences in the editor so shifted symbol keys (e.g., `@`, `?`) work in terminals that enable Kitty keyboard protocol ([#779](https://github.com/badlogic/pi-mono/pull/779) by [@iamd3vil](https://github.com/iamd3vil))

## [0.47.0] - 2026-01-16

### Added

- Hardware cursor positioning for IME support in `Editor` and `Input` components. The terminal cursor now follows the text cursor position, enabling proper IME candidate window placement for CJK input. ([#719](https://github.com/badlogic/pi-mono/pull/719))
- `Focusable` interface for components that need hardware cursor positioning. Implement `focused: boolean` and emit `CURSOR_MARKER` in render output when focused.
- `CURSOR_MARKER` constant and `isFocusable()` type guard exported from the package
- Editor now supports Page Up/Down keys (Fn+Up/Down on MacBook) for scrolling through large content ([#732](https://github.com/badlogic/pi-mono/issues/732))

## [0.46.0] - 2026-01-15

### Fixed

- Keyboard shortcuts (Ctrl+C, Ctrl+D, etc.) now work on non-Latin keyboard layouts (Russian, Ukrainian, Bulgarian, etc.) in terminals supporting Kitty keyboard protocol with alternate key reporting ([#718](https://github.com/badlogic/pi-mono/pull/718) by [@dannote](https://github.com/dannote))

## [0.45.6] - 2026-01-13

### Added

- `OverlayOptions` API for overlay positioning and sizing with CSS-like values: `width`, `maxHeight`, `row`, `col` accept numbers (absolute) or percentage strings (e.g., `"50%"`). Also supports `minWidth`, `anchor`, `offsetX`, `offsetY`, `margin`. ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))

### Fixed

- Overlay compositing crash when rendered lines exceed terminal width due to complex ANSI/OSC sequences (e.g., hyperlinks in subagent output) ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))

## [0.44.0] - 2026-01-12

### Added

- `SettingsListOptions` with `enableSearch` for fuzzy filtering in `SettingsList` ([#643](https://github.com/badlogic/pi-mono/pull/643) by [@ninlds](https://github.com/ninlds))

### Fixed

- Numbered list items showing "1." for all items when code blocks break list continuity ([#660](https://github.com/badlogic/pi-mono/pull/660) by [@ogulcancelik](https://github.com/ogulcancelik))

## [0.42.5] - 2026-01-11

### Fixed

- Reduced flicker by only re-rendering changed lines ([#617](https://github.com/badlogic/pi-mono/pull/617) by [@ogulcancelik](https://github.com/ogulcancelik))

## [0.38.0] - 2026-01-08

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

## [0.37.0] - 2026-01-05

### Fixed

- Crash when pasting text with trailing whitespace exceeding terminal width through Markdown rendering ([#457](https://github.com/badlogic/pi-mono/pull/457) by [@robinwander](https://github.com/robinwander))

## [0.34.1] - 2026-01-04

### Added

- Symbol key support in keybinding system: `SymbolKey` type with 32 symbol keys, `Key` constants (e.g., `Key.backtick`, `Key.comma`), updated `matchesKey()` and `parseKey()` to handle symbol input ([#450](https://github.com/badlogic/pi-mono/pull/450) by [@kaofelix](https://github.com/kaofelix))

## [0.33.0] - 2026-01-04

### Added

- `Editor.insertTextAtCursor(text)` method for programmatic text insertion ([#419](https://github.com/badlogic/pi-mono/issues/419))
- `EditorKeybindingsManager` for configurable editor keybindings. Components now use `matchesKey()` and keybindings manager instead of individual `isXxx()` functions. ([#405](https://github.com/badlogic/pi-mono/pull/405) by [@hjanuschka](https://github.com/hjanuschka))

### Changed

- Key detection refactored: consolidated `is*()` functions into generic `matchesKey(data, keyId)` function that accepts key identifiers like `"ctrl+c"`, `"shift+enter"`, `"alt+left"`, etc.

## [0.31.1] - 2026-01-02

Older entries are archived in [packages/tui/CHANGELOG.md@fa14205f838f](https://github.com/can1357/oh-my-pi/blob/fa14205f838f282fcea048c64fca74026789a492/packages/tui/CHANGELOG.md).

Older entries are archived in [packages/tui/CHANGELOG.md@89ad0a77d575](https://github.com/can1357/oh-my-pi/blob/89ad0a77d575f01398d3c0a57bc3a22111bef36a/packages/tui/CHANGELOG.md).
- Fixed ED3-risk unknown-viewport renders repainting offscreen structural edits over stale native scrollback, which could duplicate or shift rows when async blocks collapsed or middle rows were deleted.
- Fixed ED3-risk foreground streams committing mutable live-region rows into native scrollback, which could leave a stale `pending` tool box above the `running` box after the preview re-rendered.
- Fixed TUI shutdown leaving paint-time terminal state and Kitty image data behind by restoring synchronized-output/autowrap modes and purging all transmitted Kitty image ids on stop.
- Fixed stdin buffering splitting surrogate-pair text into UTF-16 halves and reduced timing sensitivity for incomplete escape sequences.
- Fixed terminal content not reflowing after a resize on terminals using DEC 2048 in-band resize (kitty/Ghostty/iTerm2/WezTerm). `ProcessTerminal.columns`/`rows` returned the last cached in-band report even after the OS already knew the new size, so a SIGWINCH whose in-band report was dropped or malformed (split past the stdin flush window, `:`-subparameter fields) re-rendered the whole transcript at the stale width. OS resize events now reconcile cached in-band geometry against the live `process.stdout` dimensions, dropping a stale cached value so the next render uses the true size; a valid in-band report still re-seeds pixel sizing.

## [15.9.3] - 2026-06-05

### Fixed

- Fixed ED3-risk foreground streaming erasing the head of any block that alone overflows the viewport (a tall tool result drawn in one frame, or a multi-line assistant reply growing past the viewport as it streams). The live-region pin committed native scrollback only up to the sealed-prefix boundary (`liveRegionStart`), so rows of the live block that had physically scrolled above the viewport top were neither pushed into scrollback nor kept in the repainted viewport — they vanished. The commit boundary is now the viewport top: every row above the viewport enters scrollback (only the tail still visible in the viewport stays transient and deferred to the checkpoint).
- Fixed the same ED3-risk live-region pin duplicating already-committed scrollback rows when a foreground stream's live region collapsed mid-turn (a tool preview shrinking to its compact result, an assistant block re-wrapping shorter, a late tool completion). Because growth commits every row above the viewport top to native scrollback, a subsequent shrink moved the bottom-anchored viewport back across those committed rows and the repaint re-drew them into the viewport — so they appeared twice on scroll-up, and with no prompt-submit checkpoint to reconcile (autonomous multi-turn runs, or the session ending into the welcome screen) the duplicate was baked permanently into terminal history. The pinned repaint now separates commit geometry from repaint geometry: a collapse clamps the repaint to the committed sealed boundary (`min(#scrollbackHighWater, liveRegionStart)`) instead of re-exposing those rows, leaving native scrollback un-duplicated without emitting ED3 under a possibly-scrolled reader; stale mutable live-region saved lines still reconcile at the next checkpoint.
- Fixed hiding overlays during ED3-risk foreground streaming on unknown-viewport terminals leaving the overlay's transient rows in native scrollback. Overlay visibility reductions now bypass the streaming deferral path and rebuild once, so hidden dialog/notification sentinels are scrubbed immediately.
- Fixed ED3-risk / unknown-viewport terminals (including WSL fronted by Windows Terminal) keeping the foreground-stream eager-rebuild mode active after the stream had already settled. A later scrolled content shrink or resize-with-append could then bypass the anti-yank deferral and repaint from stale geometry, jumping the viewport or replaying the wrong rows. The eager opt-in now drops immediately when no teardown render is pending, and the one-frame post-checkpoint suffix-suppression path no longer overrides geometry reflow handling.

## [15.9.2] - 2026-06-05

### Changed

- Changed foreground-stream rendering on ED3-risk terminals (Ghostty/kitty/Alacritty/VTE/iTerm2 on POSIX) to defer native-scrollback commits for unpinned transient frames: while a turn streams, generic frames repaint only the viewport and suppress `\r\n` scroll growth, so transient output (spinner ticks, partial lines, status rows) never pollutes terminal history. Components that report a `NativeScrollbackLiveRegion` still commit newly sealed prefix rows while keeping the active suffix dirty for checkpoint replay. Native scrollback is reconciled in a single ED3 (`CSI 3 J`) + re-emit at the next checkpoint (prompt submit) or on an explicit user-input/IME opt-in; an erase is never emitted mid-stream under a possibly-scrolled reader. Non-ED3-risk terminals keep their eager live rebuild. ([#1895](https://github.com/can1357/oh-my-pi/pull/1895))

### Fixed

- Fixed ED3-risk foreground streaming dropping sealed transcript rows above the live block until the next prompt-submit checkpoint, which made scrollback beyond the viewport appear duplicated or out of order. The renderer restores native-scrollback live-region pinning so newly sealed rows are appended once while active live rows remain deferred.
- Fixed inline images (added in 15.9) rendering as a wall of empty PUA box glyphs and producing laggy scrolling on Kitty-protocol terminals that do not implement Unicode placeholders — most notably WezTerm (per upstream wezterm/wezterm#986, placeholder support is still unchecked) and the tmux/screen `getFallbackImageProtocol` path that forces Kitty mode even on non-supporting outer terminals (Terminal.app, etc.). `unicodePlaceholders` now defaults on only for `kitty` and `ghostty`; everything else falls back to direct `a=p,i=…,p=…` placement, which those paths already render correctly. `PI_NO_KITTY_PLACEHOLDERS=1` is still honored as a hard opt-out, and a new `PI_KITTY_PLACEHOLDERS=1` opts in on otherwise-unsupported terminals (e.g. a wezterm nightly that has merged placeholder support) ([#1877](https://github.com/can1357/oh-my-pi/issues/1877)).

## [15.9.1] - 2026-06-04

### Fixed

- Fixed the OSC 11 appearance poll re-querying every 2s forever on terminals that support Mode 2031 but never change theme, whose repeated OSC 11/DA1 writes cleared the user's active text selection (breaking copy every 2 seconds). The poll now stops as soon as DECRQM confirms Mode 2031 support, since push notifications make polling redundant.

## [15.9.0] - 2026-06-04

### Added

- Added Kitty `CSI 22 J` screen-to-scrollback clears for non-destructive full paints, while keeping ED3 for destructive history/session rebuilds.
- Added Kitty OSC 99 rich notification formatting and startup capability probing.
- Added Kitty OSC 66 text-sized Markdown H1 headings (2x scale) plus native text-width support for OSC 66 spans. Off by default and gated to Kitty (the only terminal implementing OSC 66) via the `TERMINAL.textSizing` capability; hosts enable it through `setTextSizing`.
- Added Kitty Unicode placeholder image rendering (`U=1` + U+10EEEE with explicit row/column diacritics): inline images are drawn as real text cells that carry the image id in their foreground color, so they survive horizontal slicing, reflow, and overlapping draws instead of relying on cursor-positioned `a=p` placements. Enabled by default on Kitty-family terminals; opt out with `PI_NO_KITTY_PLACEHOLDERS=1`, and falls back to direct placement when a grid exceeds the diacritic table's addressable range.
- Added Kitty temp-file image transmission (`t=t`): on local sessions, decoded PNG bytes are written to a `tty-graphics-protocol` temp file and the path is sent instead of in-band base64, gated behind a startup `a=q,t=t` support probe. Controlled by `PI_KITTY_IMAGE_TRANSMISSION=direct|temp-file|auto`; disabled over SSH unless explicitly forced.
- Added DECRQM capability detection for DEC private modes 2026 (synchronized output) and 2048 (in-band resize). Synchronized-output paint wrappers are dropped when the terminal reports 2026 unsupported (preserving the `PI_NO_SYNC_OUTPUT` override), and DEC 2048 in-band resize is enabled when supported — reported geometry and cell pixel size are updated from `CSI 48 ; rows ; cols ; yPx ; xPx t` reports, with SIGWINCH and `CSI 16 t` kept as fallbacks.
- Added an injectable render scheduler for TUI tests, allowing deterministic render drains without patching global clocks or event-loop timing.
- Added `ImageBudget`, an inline-image cap that keeps only the most recent N images as live terminal graphics and demotes older ones to their text fallback. Once a new image pushes the count past the cap, the renderer hides the oldest via a full redraw plus an explicit Kitty graphics purge (`a=d,d=I`) — text-clear escapes (`CSI 2 J`/`CSI 3 J`) do not remove Kitty images. Configure the cap via `TUI#setMaxInlineImages` (`0` disables it).
- Changed Kitty inline images to a transmit-once + placement scheme: the base64 data is sent a single time (`a=t`) keyed by a stable image id, then every repaint emits only the tiny placement (`a=p,i=…,p=…`). Repaints — including full redraws — no longer re-send image data or stack duplicate placements, and the diff/line buffers and render caches hold short placement strings instead of multi-KB base64. The `ImageBudget` doubles as the transmit store (it tracks which ids are loaded and re-transmits after a purge frees the data). iTerm2/Sixel, which have no addressable image store, keep sending inline data as before.
- Added a renderer-level DECCARA rectangular-SGR optimizer that paints solid background panels/rows (Box/Text/Markdown fills, status bars, any full-width `theme.bg` row) as a single coalesced rectangle escape (`CSI 2*x` / `CSI Pt;Pl;Pb;Pr;<sgr>$r` / `CSI *x`) instead of emitting a full-width run of background-styled spaces on every visible row. It operates at emit time on the final ANSI strings — components are unchanged — and strips only trailing padding it can prove sits under a single non-default background span, coalescing vertically adjacent identical fills into one rectangle and falling back to the original bytes whenever the rectangle would not save bytes. Enabled only on Kitty, which implements the SGR-background extension (`docs/deccara.rst`); **Ghostty is intentionally excluded** because its `CSI $r` is unimplemented (ghostty-org/ghostty#632) and would drop the background entirely. Scrollback-bound rows and the append/scroll paths always keep the padded representation so native history preserves colored cells, and the `PI_NO_DECCARA` kill switch (plus tmux/screen/zellij detection) forces the fallback.
- Added `CMUX_SURFACE_ID` environment variable support to `getTerminalId()`, so cmux terminal surfaces get a stable identifier alongside kitty, tmux, macOS Terminal.app, and Windows Terminal — enabling per-surface session breadcrumbs for `omp -c` in cmux.

### Changed

- Changed TUI tests to use Ghostty's VT engine (`ghostty-web`) instead of `@xterm/headless`.
- Changed the default inline-image live graphics budget from 3 to 8 images.

### Fixed

- Fixed the DECCARA background-fill optimizer rejecting or repainting the wrong cells when a trailing fill crossed from default-background spaces into colored spaces.
- Fixed DEC private-mode reports with DECRPM status 3/4 being treated as unsupported, so permanent 2026/2048 reports stay recognized.
- Fixed OSC 66 text-sizing width and slicing edge cases, including ZWJ emoji payloads and partial slices through scaled spans.
- Fixed focused `Input` components following `TUI#setShowHardwareCursor`, so single-line prompts render either the terminal cursor or software cursor consistently with the editor.
- Fixed the DECCARA background-fill optimizer painting fills on the wrong rows ("split into unaligned halves") in the differential repaint path. When a diff grew the transcript past the viewport, writing the rewritten rows scrolled the terminal, but the absolute DECCARA rectangle coordinates were derived from the pre-scroll viewport top, so every fill landed `scrollAmount` rows too low while the relatively-positioned text settled correctly; rows scrolled into history were also shortened, dropping their background padding from native scrollback. Rectangles now target the post-scroll rows and only rows remaining in the final viewport are optimized.
- Fixed native scrollback desynchronization after terminal width or height changes reflowed overflowing content while the viewport was not at the bottom
- Fixed a notification chip (or any injected block) rendering on top of an actively streaming tool render on ED3-risk terminals (Ghostty/kitty/Alacritty/iTerm2). While a foreground tool streams, its header's elapsed-time counter ticks every frame; once output scrolls the header above the viewport top, each tick is an offscreen edit that — because the eager scrollback-rebuild opt-in is gated off on these terminals — repaints the viewport in place and advances the rendered line count without committing the new overflow to native history. `#scrollbackHighWater` then lagged the logical viewport top, so a later content shrink whose changes landed in the visible region slipped past the shrink-across-boundary guard and reached the differential emitter, which is anchored to `#maxLinesRendered - height`: it rewrote only the suffix, dropped the newly exposed top row, and left a blank at the bottom, drifting every row below the edit one line up so it painted over the rows above. Such shrinks now re-anchor the bottom of the viewport with a non-destructive repaint, and the foreground-streaming shrink-across-boundary case repaints the live tail instead of padding and pinning the pre-shrink viewport.
- Fixed a terminal resize during foreground-tool streaming on an unknown-viewport / ED3-risk host (Ghostty/kitty/Alacritty/iTerm2/WSL) leaving native scrollback permanently out of sync, so scrolling back after the turn showed missing rows. A pure geometry resize (no content change) takes the in-place viewport-repaint path, which — unlike a content-bearing resize that rebuilds via the geometry branch — never flagged native history. Because the prompt-submit checkpoint (`refreshNativeScrollbackIfDirty`) only rebuilds when scrollback is marked dirty on these hosts, the discrepancy was never reconciled. Overflowing geometry repaints whose viewport is not known to be at the bottom now mark scrollback dirty so the next checkpoint rebuilds an exact copy of the transcript.

## [15.8.2] - 2026-06-03

### Added

- Added `PI_NO_SYNC_OUTPUT=1` to disable DEC 2026 synchronized-output wrappers for terminals whose implementation is buggy or visually worse, while keeping the renderer's autowrap guards active during paints ([#1765](https://github.com/can1357/oh-my-pi/issues/1765)).

### Fixed

- Fixed terminal resizes that land in the same render frame as streamed output splicing a phantom blank row into native scrollback and offsetting every later row by one. A height shrink (or width change carrying an append) with content overflowing the viewport fell through to the differential emitter, whose scroll math is anchored to the pre-resize viewport top and hardware-cursor row — both invalidated by the terminal's own resize reflow. Geometry-changed frames now rebuild native history when the viewport is at (or possibly at) the bottom, and defer non-destructively for a reader confirmed scrolled into history.
- Fixed Ghostty/kitty/Alacritty-style ED3-risk terminals freezing the prompt after a deferred shrink; focused keyboard input now uses the same explicit user-input viewport opt-in as autocomplete and can repaint immediately instead of waiting for a resize.
- Deferred eager live scrollback rebuilds under WSL fronted by Windows Terminal (`WT_SESSION` present in a Linux environment) so foreground streaming no longer emits ED3 (`CSI 3 J`) and yanks a reader scrolled into Windows Terminal's host scrollback; deferred rewrites still reconcile at the next prompt-submit checkpoint ([#1610](https://github.com/can1357/oh-my-pi/issues/1610)).
- Fixed tmux (and screen/zellij) pane history gaining a complete duplicate copy of the transcript every time a deferred offscreen edit was followed by another render. Multiplexer panes never receive a destructive scrollback clear, so the dirty-scrollback rebuild path only appended the full transcript on top of preserved pane history — repeatedly. Live frames inside multiplexers now keep repainting the viewport and leave history reconciliation to explicit checkpoints, which also removes the O(transcript) write amplification per frame.
- Fixed tmux pane viewports corrupting and pane history duplicating when a resize coincides with rendering: a resize racing a streamed append reached the stale-anchor diff emitters (phantom rows in the pane), a forced render racing a resize replayed the whole transcript into preserved pane history, and the prompt-submit checkpoint did the same after any deferred offscreen edit. Geometry-changed frames inside multiplexers now repaint the viewport in place, and forced-render geometry replays plus checkpoint replays are disabled there — tmux reflows its own pane grid and its history cannot be cleared, only duplicated.
- Fixed terminal resize events whose dimensions net out unchanged by render time (rapid SIGWINCH round trips during a window drag, coalesced into one 16ms frame) being invisible to the renderer. The terminal reflows its buffer on every resize event — rows move between the viewport and scrollback and can be evicted at the scrollback cap — so diffing against the pre-resize screen splices blank phantom rows into the viewport. The renderer now tracks the resize event itself, not just the dimension delta, and routes such frames through the geometry-change repaint/rebuild paths.
- Fixed Termux terminal resizes (screen rotation or software-keyboard toggles) displacing or hiding output after the viewport height changed. Content-bearing resizes were routed to the differential emitter, whose scroll math is anchored to the pre-resize viewport, so appended rows landed too low; pure height changes were treated as no-ops, exposing blank rows that later appends could fill without growing native scrollback. Termux resizes now repaint or rebuild at the new geometry like every other non-multiplexer terminal.
- Fixed the turn-end teardown frame freezing on ED3-risk terminals (Ghostty/kitty/Alacritty/iTerm2): disabling eager scrollback rebuild now takes effect only after the in-flight frame is classified, so the loader/status removal still paints instead of deferring and leaving a stale spinner until the next keystroke.
- Fixed non-WT ConPTY terminals on Windows (Tabby, Hyper, VS Code, conhost) clearing scrollback and yanking the viewport to the top whenever streaming output or a prompt-submit rebuild arrived while the user was scrolled up. The kernel32 viewport probe describes the ConPTY pseudo-console buffer — which is pinned to the visible grid, invisible to host-UI scrollback — so it reported "at bottom" no matter where the user had scrolled, and the [#1635](https://github.com/can1357/oh-my-pi/issues/1635) fix only distrusted it under `WT_SESSION`, which Tabby and other ConPTY hosts never set. The probe is now removed entirely: every Windows host is treated as viewport-unobservable, live mutations defer destructive rebuilds (no `\x1b[3J`, no viewport movement), and native scrollback reconciles at the prompt-submit checkpoint where the Enter keystroke has already pinned the host viewport to the bottom ([#1746](https://github.com/can1357/oh-my-pi/issues/1746)).
- Fixed emoji-presentation symbols (a default-text symbol followed by variation-selector-16 `U+FE0F`, e.g. `⚠️`, `ℹ️`, `❤️`, keycaps) measuring as 1 cell instead of 2 in the native width engine on macOS. The native scanner now keeps `UnicodeWidthStr` as the source of truth for multi-codepoint graphemes and applies only the local macOS Hangul Compatibility Jamo character-width delta, preserving VS16/keycap sequence widths without reintroducing jamo cursor drift.
- Deferred eager live scrollback rebuilds on macOS Terminal.app and iTerm2 so assistant/tool streaming no longer emits ED3 (`CSI 3 J`) while their native viewport position is unobservable, preserving readers scrolled into terminal history ([#1300](https://github.com/can1357/oh-my-pi/issues/1300)).
- Fixed width-shrink reflow leaving old-width rows in native history so later appends no longer undercount scrollback growth or duplicate wrapped content.
- Fixed hiding overlays after terminal reflow so stale dialog rows are scrubbed from native scrollback on non-multiplexer terminals.

### Removed

- Removed `shouldTrustNativeViewportProbe` and `ProcessTerminal`'s kernel32 `GetConsoleScreenBufferInfo` viewport probe. No Windows environment can answer "is the user's viewport at the bottom" truthfully — under ConPTY (every modern host) the pseudo-console buffer is pinned to the visible grid so the probe always read "at bottom", and under legacy conhost the window tracks the output cursor rather than the buffer tail so it always read "scrolled up" — so the probe and its trust gate are gone; `ProcessTerminal` no longer implements the optional `Terminal.isNativeViewportAtBottom`.

## [15.8.1] - 2026-06-02

### Fixed

- Deferred eager live scrollback rebuilds on VTE terminals so GNOME-style Linux terminals do not flash or erase readable scrollback during streaming ([#1719](https://github.com/can1357/oh-my-pi/issues/1719)).

## [15.8.0] - 2026-06-02

### Fixed

- Deferred eager live scrollback rebuilds on POSIX terminals where xterm ED3 (`CSI 3 J`, erase saved lines) can disturb scrolled-up readers during streaming, while keeping direct user-input and checkpoint rebuilds explicit ([#1682](https://github.com/can1357/oh-my-pi/issues/1682)).
- Fixed TUI shutdown placing the parent shell prompt one row below short rendered content instead of directly on the next line ([#1620](https://github.com/can1357/oh-my-pi/issues/1620)).
- Stopped painting inline color swatches for 4-digit hex runs in Markdown rendering. The `#RGBA` CSS form collides with hashline `#TAG` snapshot tags (4 hex digits, e.g. `#6C5E`), which were sprouting spurious RGB swatches in prose and codespans. Only `#RGB`, `#RRGGBB`, and `#RRGGBBAA` qualify now.

## [15.7.6] - 2026-06-01

### Fixed

- Fixed native Windows + Windows Terminal freezing the editor on the wrap keystroke, on `/plan`/`/resume`/model-switch/status-line toggles, and on any other offscreen structural mutation until the next prompt submit. The `15.7.5` `#1635` fix routed every viewport-saturating pure-append and structural mutation through `deferredMutation` (a literal no-op) whenever `isNativeViewportAtBottom()` returned `undefined` — which it always does under `WT_SESSION` because the kernel32 probe can't see WT host scrollback. The deferral was only ever meant for the *confirmed-scrolled* case; an unknown viewport now falls back to a non-destructive `viewportRepaint` instead, so the live UI keeps updating without emitting `\x1b[3J` and without yanking a possibly-scrolled reader. Confirmed-scrolled frames (probe returns `false`) still defer.
- Removed the hard-coded 20-result cap on `@`-prefixed fuzzy file completion in `CombinedAutocompleteProvider.#getFuzzyFileSuggestions`. The dropdown now honors the existing `maxResults: 100` ceiling already configured for `fuzzyFind`, so projects with many files sharing a common stem (e.g. `@controller`, `@test`) surface all relevant matches instead of being silently truncated. ([#1652](https://github.com/can1357/oh-my-pi/issues/1652))

## [15.7.5] - 2026-06-01

### Fixed

- Fixed native Windows + Windows Terminal scrollback being yanked to the top when a streaming response triggered a TUI full redraw. Under ConPTY the `kernel32` `GetConsoleScreenBufferInfo` probe answers about the pseudo-console (always at the buffer tail) and not about WT's host scrollback, so `isNativeViewportAtBottom()` falsely returned `true` while the user was scrolled up and the shrink-across-viewport branch issued a destructive `historyRebuild` (`\x1b[2J\x1b[H\x1b[3J`). The probe now short-circuits to `undefined` whenever `WT_SESSION` is set, letting the existing deferred-rebuild path keep streaming-time mutations non-destructive and reconcile native history at the next prompt-submit checkpoint. ([#1635](https://github.com/can1357/oh-my-pi/issues/1635))

## [15.7.3] - 2026-05-31

### Added

- Added `overflowSearch` to `SelectListLayoutOptions` to let consumers enable or disable type-to-filter search and search-status rendering per SelectList instance
- Added fuzzy type-to-filter search to overflowing `SelectList` pickers, with search status and result counts.
- Added `TUI.setEagerNativeScrollbackRebuild(enabled)` — while enabled, live render frames rebuild native scrollback on offscreen/structural changes even when the viewport position is unobservable (POSIX), instead of deferring to a non-destructive repaint. Trades the anti-yank guarantee for clean, duplicate-free history; intended for windows where output above the fold is actively re-laying out (e.g. a tool whose result is still streaming). A terminal that reports a known-scrolled viewport still defers.

### Changed

- Disabled interactive search filtering for editor autocomplete and slash-command `SelectList`s by passing `overflowSearch: false` in their layout options

### Fixed

- Preserved hidden tmux overlays in the live viewport by removing overlay content from view when an overlay was hidden while keeping pane history intact
- Preserved native scrollback when forced TUI renders coalesce with content growth, and deferred pure tail appends while readers are scrolled into history.
- Preserved existing terminal scrollback during forced and structural TUI renders so preexisting shell lines remained visible after component mutations
- Rebuilt native scrollback for safe bottom-anchored offscreen edits and high-water preview collapses instead of repainting only the viewport, preventing stale or duplicated rows above the live viewport.
- Stripped internal cursor marker sentinels from all rendered lines so offscreen focus markers no longer leak into terminal output
- Truncated all painted lines to terminal width during viewport repaints and append-tail updates so long content no longer overflows or wraps unexpectedly
- Fixed `tui.select.cancel` handling in `SelectList` so pressing Escape or Ctrl+C closes the list even when no matches are currently shown
- Fixed native scrollback corruption when an offscreen row edit and repeated-tail append land in one render frame; ambiguous appended tails now rebuild history instead of splicing stale rows into the buffer.
- Fixed scrolled-up readers being yanked back to the tail whenever streaming content arrived on POSIX terminals (macOS/Linux). Native viewport position is unobservable there (`isNativeViewportAtBottom()` returns `undefined`), and the planner optimistically treated "unknown" as "at bottom", so every offscreen streaming edit ran a destructive `historyRebuild` that cleared scrollback and snapped the view to the bottom. Live render frames now treat an unknown viewport as unsafe for a destructive rebuild — they defer to a non-destructive viewport repaint and reconcile native scrollback at the next explicit checkpoint (prompt submit). Resize and checkpoint replays keep the prior behavior.
- Fixed native scrollback not rewrapping when the terminal widens on POSIX. A width increase reflows the transcript to fewer lines, which the shrink-across-boundary branch intercepted and (after the unknown-viewport deferral) repainted only the viewport — leaving committed history wrapped at the old width and duplicated above the live viewport. Width changes now rebuild native scrollback at the new geometry even when the viewport position is unknown (a yank is acceptable on an explicit resize); a terminal that can report a scrolled viewport still defers.

## [15.7.0] - 2026-05-31

### Fixed

- Fixed slash-command autocomplete repainting when a Windows Terminal session cannot report native scrollback position; live input renders can now bypass the unknown-viewport deferral without weakening background scrollback protection. ([#1550](https://github.com/can1357/oh-my-pi/issues/1550))

## [15.6.0] - 2026-05-30

### Added

- Added autocomplete triggering for internal URL scheme tokens such as `local://` and `skill://` while typing in the editor

### Fixed

- Fixed streaming output staying invisible in Windows Terminal + WSL2 until the window was minimized + restored. The 15.5.14 WSL branch of `requiresNativeViewportProofForReplay` treated an unknown native viewport state as "scrolled into history" — but `ProcessTerminal.isNativeViewportAtBottom` can only return a real answer through `kernel32.dll` FFI, which a Linux user-space process inside WSL cannot load, so the probe was permanently `undefined`. Every row-inserting structural mutation (each new streaming token row above the bottom-anchored prompt) was therefore classified as `deferredMutation` and emitted zero bytes. Any geometry change (resize/minimize/restore) bypassed the gate via a different render intent, which is why the output became visible only on window resize. The WSL clause is removed; on platforms where the probe cannot answer, unknown is treated as at-bottom (the pre-15.5.14 behaviour) so the live render path runs again. Native Win32 keeps the conservative "assume scrolled when unknown" heuristic since `kernel32` FFI does succeed there and unknown means the probe transiently failed. ([#1534](https://github.com/can1357/oh-my-pi/issues/1534))

## [15.5.14] - 2026-05-29

### Added

- `Markdown` now renders a small color-chip swatch, painted with the referenced color, in front of CSS hex colors mentioned in prose, thinking traces, lists, tables, and blockquotes (e.g. `#C5FFD6` or `` `#C5FFD6` ``). The chip glyph comes from the theme's symbol set so it degrades across tiers (Nerd Font / Unicode `■` → ASCII `[]`) and is overridable via the `md.colorSwatch` symbol. Truecolor terminals get an exact 24-bit chip; others fall back to the nearest 256-color cell. Bare prose requires a hex letter for 3/4-digit forms so short issue/PR references (`#123`, `#1011`) don't sprout swatches; backticked codes are always treated as colors.

### Fixed

- Fixed the terminal hardware cursor disappearing in Ghostty. `resolveHardwareCursorPreference` force-hid the hardware cursor whenever it detected a Ghostty session (to fight bar-cursor afterimage "trails"), but the editor was simultaneously kept in terminal-cursor (marker-only) mode via `getUseTerminalCursorMarker()`, which renders no glyph and relies on the now-hidden hardware cursor — so Ghostty users had no visible caret at all, regardless of `PI_HARDWARE_CURSOR`. The Ghostty/`PI_FORCE_HARDWARE_CURSOR` override and the redundant `useTerminalCursorMarker` state are removed: `showHardwareCursor` is honored as-requested again (hardware cursor on by default), and disabling it cleanly falls back to the steady software-cursor glyph. The per-paint anti-trail mitigations (hide-cursor + autowrap-off inside the synchronized-output block) are retained, which is the actual trail fix.

## [15.5.12] - 2026-05-29

### Fixed

- Fixed terminal resizes corrupting native scrollback with duplicated rows. The 15.4.0 change that defers a destructive scrollback clear+replay (so a user scrolled into history is not yanked while a streaming tail cell mutates) also caught genuine width/height resizes: a resize reflows the terminal's own committed scrollback at the new geometry, but repainting only the viewport left the stale old-size rows in history, so every overflowed row showed up twice (old-size wrap + new-size copy) when scrolling back, until the next prompt submit cleaned it up. `#planRender` now rebuilds history synchronously when the frame's geometry actually changed (`widthChanged || heightChanged`) via the restored `historyRebuild` intent, and defers the rebuild only for pure content mutations where the user may be reading scrollback mid-stream.

## [15.5.0] - 2026-05-26

### Fixed

- Fixed `@` file mention autocomplete stalling for seconds when the query references something outside the project root (e.g. `@../`, `@~/`, `@/abs/`). `CombinedAutocompleteProvider` now short-circuits to plain immediate-directory prefix listing in those cases instead of dispatching a recursive `fuzzyFind` walk over a sibling directory full of unrelated projects. Inside-cwd queries keep the existing fuzzy-then-prefix behavior. ([#1395](https://github.com/can1357/oh-my-pi/issues/1395))
- Gated the Hangul Compatibility Jamo width correction (U+3131..U+318E → 1 cell, originally landed in 15.0.1 for the IME / hardware-cursor displacement bug) behind `process.platform === "darwin"` in the TS path and `cfg!(target_os = "macos")` in the `pi-natives` Rust path. macOS terminals (Ghostty / Terminal.app / iTerm2) render jamo as 1 cell despite UAX#11 classifying them as Wide, but WezTerm and most Linux terminals honor UAX#11 and render them as 2 cells. The unconditional correction therefore desynced the TUI's column bookkeeping from the terminal's actual rendering off-darwin, producing corrupted layout and broken Korean input on Linux. On non-darwin the helpers now defer entirely to `Bun.stringWidth` / `UnicodeWidthStr` (also a small perf win on the multi-char-grapheme path). ([#1410](https://github.com/can1357/oh-my-pi/issues/1410))

Older entries are archived in [packages/tui/CHANGELOG.md@ec051608a87a](https://github.com/can1357/oh-my-pi/blob/ec051608a87ad78d4930a46af7f5582192005ada/packages/tui/CHANGELOG.md).
