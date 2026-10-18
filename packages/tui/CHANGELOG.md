## [Unreleased]

## [1.3.0] - 2026-10-18

### Breaking Changes

- Removed `RuntimeChildrenOptions.transient` and `Component.retireDisplacedTranscript`: the composer now bills all chrome below the transcript at the smallest height it has rendered, so no root opts in or out ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- `FindStats.errors` is replaced by `failed` (judge requests that failed) and `unanswered` (unusable answers), and `FindToolDetails` requires a `coverage` status; the find renderer shows `N/M requests failed` ([#15744](https://github.com/can1357/oh-my-pi/issues/15744))
- `numberedCode`, `readContentCode` and `nativeDiff` take the file's path (`path`) instead of a language, and `describeGroupedOutput` drops its `lang` option: Tern picks the grammar of file contents from their path
- Removed `KeyEventType` export from public API
- `Editor` constructor now requires `TUI` as first parameter: `new Editor(tui, theme)`. This enables automatic vertical scrolling when content exceeds terminal height. ([#732](https://github.com/badlogic/pi-mono/issues/732))

### Added

- `AssistantMessageComponent`'s native turn footer leads with a Copy icon (`zeta.turn.copy`) and a dot instead of the clock icon; it copies the answer's text and shows when the host handles transcript actions
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

### Changed

- `UserMessageComponent`'s native hover toolbar (`zeta.user.tools`) leads with Copy and Rewind icon buttons (`copy`, `rewind`) instead of text labels, then a dot and the time, like the turn usage footer
- `ContextUsageView`'s native body (on terminals with `meter`) leads with the tokens used and the room left before auto-compaction, then one stacked bar ticked at the threshold, the breakdown as rows (`zeta.context.cat`, `.cat.free`, `.cat.buffer`: swatch, name, tokens, share; the exact count in the row's `title`) and the snapcompact estimate as labelled rows (`zeta.context.snap`); the blocks meter and legend `kv` are gone, and `contextUsageHead` no longer repeats the window size
- `AskDialogComponent`'s native root is `zeta.editor.ask` (collapsed: `zeta.editor.ask.hidden`, the countdown, the question as `zeta.ask.summary`, Skip and Show): a chosen answer is the `accent`-toned row (a check also carries the check icon) instead of the highlighted one; multi-select Other… is `zeta.ask.other.check`; the question tabs check answered questions and say their keys in the strip's `title`; the countdown moves from the head to the action bar beside Hide; the preview is `zeta.ask.preview`; the Review tab leads with `zeta.ask.notice` and lists answers (`zeta.ask.answers`) by question name with inline code mono and no `(Recommended)` suffix; option descriptions run inline code mono, notes ride the row's detail as `em`; Submit/Next's tooltip names only Enter (and Space on a multi-select)
- `MCPAddWizard`'s native sheet asks one question per step: a phase strip (`zeta.mcpAdd.progress` of `zeta.mcpAdd.phase`, toned done/current/upcoming and `neutral` when no auth was needed), the question and its lead (`zeta.mcpAdd.title`, `zeta.mcpAdd.tag` for optional fields, `zeta.mcpAdd.lead`), then a mono field with a placeholder and its rule or refusal (`zeta.mcpAdd.field`, `tone: "error"`; `zeta.mcpAdd.note`), choice rows with icons and mono tags (`zeta.mcpAdd.choices`), status lines (`zeta.mcpAdd.status`, `zeta.mcpAdd.checks`, `zeta.mcpAdd.error`) or the review rows (`zeta.mcpAdd.summary`). Cancel, Back and Continue / Save server buttons run Ctrl+C, Esc and Enter instead of a key-hint strip. The connection test shows its own busy step, the OAuth client secret field is masked, and the review saves on Enter (no Yes/No choice)
- `ReportPanel`'s native body carries the role `zeta.report.body`
- `HookInputComponent` describes a dock sheet (`zeta.overlay.hook-input` col) like `HookEditorComponent`'s: the title's first line (`zeta.hook-input.title`, the countdown as `zeta.hook-input.timer`) over its further lines (`zeta.hook-input.detail`), the field (`zeta.hook-input.field`, `tone: "error"` while a submit was refused) with its placeholder, and Cancel / Submit buttons that run Esc / Enter; the key legend under the field is terminal-only
- `JobsSheet`'s native body is a master–detail split (`zeta.jobs.split`: `zeta.jobs.master` | `zeta.jobs.detail`): the job list grouped Running / Recent (`zeta.jobs.group` labels), each row a type icon tinted by status with its duration, beside the selected job's status pill, live elapsed and Cancel job (`zeta.jobs.status`), its task title or command (`zeta.jobs.title` / `zeta.jobs.command`), facts (`zeta.jobs.facts`: agent, directory, pids, exit code, artifact) and output (`zeta.jobs.out`, `zeta.jobs.nooutput`); the footer counts running and recent jobs (`zeta.jobs.summary`), and no jobs shows an empty state (`zeta.jobs.empty`). Task jobs no longer draw an `agent` node here
- `BtwHistoryPanel`'s native sheet is centered and reads like a mail reader: the questions as two-line rows (`zeta.btw.history`, list `zeta.btw.list` / `zeta.btw.list.idle` while the answer has the keys) beside the selected thread (`zeta.btw.reader` › `zeta.btw.thread` › `zeta.btw.turn`: `zeta.btw.question` / `zeta.btw.followup`, `zeta.btw.meta`, `zeta.btw.answer`, `zeta.btw.error`), the follow-up field under the last answer (`zeta.btw.composer`), and footer buttons Stop answer, Copy answer, Close and Follow up (Cancel and Send while composing) in place of the focus labels and key-hint strip; an empty history is an `md` sheet (`zeta.btw.empty`)
- The `OMP_TUI_DEBUG` control socket now uses the native IPC transport: it is owner-only and no longer replaces a socket another live process is serving.
- Transcript rows pushed aside by an open dialog, report or HUD now reach scrollback when it closes or newer output pushes them out, instead of while it is open ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- A transcript block straddling the top of the screen now sends only its off-screen rows to scrollback; the rest stays live ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- The `wait` tool's native job rows (`zeta.wait.job`) are a single `row`: badge, id and label, progress and clock, without the output preview or capture notice beneath
- The native bash run foot reads In background with a live clock (`zeta.run.time` without `stopped`) while a parked job's frames stream (`details.async.state === "running"`, partial), instead of Running
- Native model pickers (/model, the quick switch and the advisor's) mark providers with their logo (`mark.icon: "provider:<id>"`, initials where the terminal has none), and every model row leads with its provider's mark
- Updated model picker to offer manual effort selection for unverified models instead of automatic mode
- Improved nested tool status line rendering: moved preview content into a dedicated collapsible code block when expanded and limited field widths on the one-line summary
- Suppressed typo highlighting for the word currently being typed to avoid distracting inline markers while composing
- `ApprovalDialogComponent` shows a choice list (Approve, an optional `session` row, Deny): the arrow keys move between them and Enter (armed after `APPROVE_ARM_MS`) takes the highlighted one; while a composer draft holds Enter the highlight sits on Deny, relabeled "Deny and send message"; Tern clicks on a choice take it; Page Up/Down scroll the details
- Advisor notes in Tern read as a callout tinted by their worst severity: its icon and a tally (`Concern`, `1 blocker · 2 concerns`) head the card with the advisor's name at the end, and several notes each lead with their own severity icon
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

### Fixed

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
- Fixed images rendering blank inside tmux on Kitty-capable terminals when tmux's `allow-passthrough` is off (the default); omp now falls back to SIXEL or the text placeholder instead of sending Kitty graphics tmux drops
- Fixed Tern drawing tool cards' file contents (write, read, edit, grep, find, ast-grep, ast-edit) plain or in the wrong language when omp did not know the file's extension (`.ptx`) or mapped it to a neighbor (`.cu` as C++); omp now sends the file's path and Tern picks the grammar
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

### Removed

- Removed `Composer.pinInputToBottom()`; the composer keeps the input on the bottom row by itself ([#15405](https://github.com/can1357/oh-my-pi/pull/15405) by [@H4vC](https://github.com/H4vC))
- `SingleResult` (and the task tool's settled payload) carries the failure diagnostics an agent-driven model switch needs: optional `failureClass` (`usage-limit` / `auth` / `account-policy` / `context-overflow` / `transient` / `aborted` / `unknown`), optional `fallbackCandidates` (other selectors this session could run), and optional `modelChange` (`{ source: "spawn-param" | "wake-param", from?, to }`) recording that a caller-supplied model replaced the default one. All three stay absent unless a run actually reports them.
- The welcome/splash brand art is now generated with the standard FIGlet tool instead of being drawn by hand: `ZETA_LOGO` renders the mark `Z` (the ASCII form of `Ζ`), `ZETA_WORDMARK` renders `Zeta` (both in the standard `ANSI Shadow` font) and `ZETA_SUBLINE` renders the `Linxira-Zeta` identity line in `mini`, with the version under the wordmark. `bun scripts/brand/generate-logo-art.ts` regenerates the three constants from the vendored fonts, and the brand guard fails on any hand-edited glyph.
- Removed the unused `app.tree.foldOrUp` / `app.tree.unfoldOrDown` keybinding ids, which no longer did anything.
- Added `parksAsBackground(toolName, details)`, `asyncJobState(details)`, `isSettledJobFrame(details)` and `settleWithJobFrame(component, frame, toolCallId)` (`chat/tool-execution`): whether a returned call's card stays live for its background job's frames (`task` always; `bash` and `eval` under native rendering), the job state a frame reports, and settling the card with the job's last frame (a cancelled job keeps its output and seals as cancelled)
- `BashToolDetails.async.state` and `EvalToolDetails.async.state` gain `cancelled` for a job killed before it finished
- Removed `tools/eval-format/code-mode-declarations` (`generateCodeModeDeclarations`), which only served Codex Code Mode.
- Removed `ellipsis` property from `SymbolTheme` interface
- Removed `extractAnsiCode` function from public API
- Removed TUI layout engine exports from public API (BoxNode, ColumnNode, LayoutNode, etc.)

## [9.8.0] - 2026-02-01

### Fixed

- Improved Kitty terminal key sequence parsing to correctly handle text field codepoints in CSI-u sequences
- Fixed handling of private use Unicode codepoints (U+E000 to U+F8FF) in Kitty key decoding to prevent invalid character interpretation

## [9.7.0] - 2026-02-01

### Breaking Changes

- Removed `Key` helper object from public API; use string literals like `"ctrl+c"` instead of `Key.ctrl("c")`

## [9.6.2] - 2026-02-01

### Changed

- Renamed `EllipsisKind` enum to `Ellipsis` for clearer API naming
- Changed hardcoded ellipsis character from theme-configurable to literal "…" in editor truncation

## [9.6.1] - 2026-02-01

### Removed

- Removed `visibleWidth` benchmark file in favor of Kitty sequence benchmarking

## [9.5.0] - 2026-02-01

### Changed

- Improved fuzzy file search performance by using native implementation instead of spawning external process

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

### Fixed

- Simplified terminal write error handling to mark terminal as dead on any write failure
- Fixed multi-line strings in renderOutputBlock causing width overflow
- Fixed slash command autocomplete applying stale completion when typing quickly

## [8.12.7] - 2026-01-29

### Fixed

- Fixed slash command autocomplete applying stale completion when typing quickly

## [8.4.1] - 2026-01-25

### Added

- Added fuzzy match function for autocomplete suggestions

## [8.4.0] - 2026-01-25

### Fixed

- Terminal gracefully handles write failures by marking dead instead of exiting the process
- Reserved cursor space for zero padding and corrected end-of-line cursor rendering to prevent wrap glitches

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

## [5.3.1] - 2026-01-15

### Fixed

- Fixed rendering issues on Windows by preventing re-entrant renders

## [5.1.0] - 2026-01-14

### Added

- Added `pageUp` and `pageDown` key support with `selectPageUp`/`selectPageDown` editor actions

### Changed

- Changed `OverlayOptions` to use `SizeValue` type for `width`, `maxHeight`, `row`, and `col` properties

### Fixed

- Fixed numbered list items showing "1." for all items when code blocks break list continuity
- Fixed width overflow protection in overlay compositing to prevent TUI crashes

## [4.6.0] - 2026-01-12

### Added

- Add fuzzy matching module (`fuzzyMatch`, `fuzzyFilter`) for command autocomplete
- Add `getExpandedText()` to editor for expanding paste markers

### Fixed

- Remove Kitty protocol query timeout that caused shift+enter delays
- Add bracketed paste check to prevent false key release/repeat detection
- Rendering optimizations: only re-render changed lines
- Refactor input component to use keybindings manager

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
- Added legacy terminal support for Ctrl+symbol keys (Ctrl+\, Ctrl+], Ctrl+-) and their Ctrl+Alt variants. ([#831](https://github.com/badlogic/pi-mono/pull/831) by [@Perlence](https://github.com/Perlence))

## [0.48.0] - 2026-01-16

### Fixed

- Decode Kitty CSI-u printable sequences in the editor so shifted symbol keys (e.g., `@`, `?`) work in terminals that enable Kitty keyboard protocol ([#779](https://github.com/badlogic/pi-mono/pull/779) by [@iamd3vil](https://github.com/iamd3vil))

## [0.47.0] - 2026-01-16

### Added

- Hardware cursor positioning for IME support in `Editor` and `Input` components. The terminal cursor now follows the text cursor position, enabling proper IME candidate window placement for CJK input. ([#719](https://github.com/badlogic/pi-mono/pull/719))
- `Focusable` interface for components that need hardware cursor positioning. Implement `focused: boolean` and emit `CURSOR_MARKER` in render output when focused.
- `CURSOR_MARKER` constant and `isFocusable()` type guard exported from the package
- Editor now supports Page Up/Down keys (Fn+Up/Down on MacBook) for scrolling through large content ([#732](https://github.com/badlogic/pi-mono/issues/732))

### Fixed

- Editor no longer corrupts terminal display when text exceeds screen height. Content now scrolls vertically with indicators showing lines above/below the viewport. Max height is 30% of terminal (minimum 5 lines). ([#732](https://github.com/badlogic/pi-mono/issues/732))

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

## [0.43.0] - 2026-01-11

### Fixed

- Cursor now moves to end of content on exit, preventing status line from being overwritten ([#629](https://github.com/badlogic/pi-mono/pull/629) by [@tallshort](https://github.com/tallshort))

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

## [0.37.6] - 2026-01-06

### Added

- Kitty keyboard protocol flag 2 support for key release events. New exports: `isKeyRelease(data)`, `isKeyRepeat(data)`, `KeyEventType` type. Terminals supporting Kitty protocol (Kitty, Ghostty, WezTerm) now send proper key-up events.

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

## [0.32.2] - 2026-01-03

### Fixed

- Slash command autocomplete now triggers for commands starting with `.`, `-`, or `_` (e.g., `/.land`, `/-foo`) ([#422](https://github.com/badlogic/pi-mono/issues/422))

## [0.31.1] - 2026-01-02

Older entries are archived in [packages/tui/CHANGELOG.md@fa14205f838f](https://github.com/can1357/oh-my-pi/blob/fa14205f838f282fcea048c64fca74026789a492/packages/tui/CHANGELOG.md).

Older entries are archived in [packages/tui/CHANGELOG.md@89ad0a77d575](https://github.com/can1357/oh-my-pi/blob/89ad0a77d575f01398d3c0a57bc3a22111bef36a/packages/tui/CHANGELOG.md).
