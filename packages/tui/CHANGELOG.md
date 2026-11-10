## [Unreleased]

### Fixed

- The resume picker draws a full-width, muted rule between project groups in the all-projects scope, so a long list no longer runs one repository's conversations into the next project's header. The dim rule under each project header and every workspace row stay as they were.

## [1.5.1] - 2026-11-10

### Added

- `/channels` opens the IM operator surface in the TUI: list configured channels and their live health (`state`, `detail`, `lastError`, `since`, `lastInboundAt`), run `login`/`status`/`logout`/`unbind`, and take a per-channel pairing lock so two processes cannot pair the same account at once. The command is refused on a backend-attached client, where the owning process owns pairing.
- `/cd` is a session command with a folder-only picker: real Windows volumes (drive type and volume label; A:/B: only when the system reports them) or POSIX mount points from `/proc/mounts`, pinned folders, type-to-filter, keyboard and mouse selection, `Ctrl+P` to pin, and `Ctrl+R` to open `/resume` on the highlighted folder instead of switching to it. A `/cd <path>` argument moves directly like `/move`.

### Changed

- Large transcript replays on resume now hydrate a bounded window instead of the whole session, so a multi-thousand-entry transcript no longer freezes the TUI before the first frame; scrolling past the window pages the rest in on demand.
- Starting in the home directory keeps the `~/tmp` (or OS temp) workspace and reports the switch in a startup notice instead of failing silently.

### Fixed

- A `task` batch coalesces spawn progress into at most one cumulative snapshot per 100 ms (matching the subagent HUD cadence), so a wide fan-out no longer rebuilds and deep-sanitizes the transcript card once per spawn report on the TUI thread; terminal spawn snapshots still publish immediately.

## [8.4.1] - 2026-01-25

### Added

- Added fuzzy match function for autocomplete suggestions

## [8.4.0] - 2026-01-25

### Fixed

- Terminal gracefully handles write failures by marking dead instead of exiting the process

## [8.2.0] - 2026-01-24

### Added

- Added mermaid diagram rendering engine (renderMermaidToPng) with mmdc CLI integration

### Fixed

- Fixed crash when terminal becomes unavailable (EIO errors) by exiting gracefully instead of throwing

## [6.8.3] - 2026-01-21

### Added

- Added undo support in the editor via `Ctrl+-`

### Changed

- Improved fuzzy matching to handle alphanumeric swaps

## [5.6.7] - 2026-01-18

### Changed

- Updated tab bar rendering to wrap text across multiple lines when content exceeds available width

### Fixed

- Fixed key detection for shifted symbol characters

## [5.1.0] - 2026-01-14

### Changed

- Changed `OverlayOptions` to use `SizeValue` type for `width`, `maxHeight`, `row`, and `col` properties

### Fixed

- Fixed numbered list items showing "1." for all items when code blocks break list continuity

## [4.6.0] - 2026-01-12

### Added

- Add fuzzy matching module (`fuzzyMatch`, `fuzzyFilter`) for command autocomplete

## [4.2.1] - 2026-01-11

### Fixed

- Fixed editor redraw glitch when canceling autocomplete suggestions

## [4.1.0] - 2026-01-10

### Added

- Added persistent prompt history storage support via `setHistoryStorage()` method, allowing history to be saved and restored across sessions

## [3.32.0] - 2026-01-08

### Fixed

- Fixed text wrapping allowing long whitespace tokens to exceed line width

## [3.20.0] - 2026-01-06

### Fixed

- Fixed Shift+Enter detection in legacy terminals that send ESC+CR sequence

## [1.500.0] - 2026-01-03

### Added

- Added `getText()` method to Text component for retrieving current text content

## [1.337.0] - 2026-01-02

Initial release under @oh-my-pi scope. See previous releases at [badlogic/pi-mono](https://github.com/badlogic/pi-mono).

## [1.5.0] - 2026-11-09

### Added

- Added the Team Hub overlay: a database-backed roster of rooms, PMs and engineers with room events, real-member posting, filtering and keyboard navigation.
- Added the HTML form dialog used by `ask` and extension `ui.formDialog`: paginated terminal forms with keyboard navigation, images and inline SVG, free-text "Other" answers, and partial submission on inactivity timeout.
- Added undo support to Editor with Ctrl+- hotkey. Undo coalesces consecutive word characters into one unit (fish-style). ([#831](https://github.com/badlogic/pi-mono/pull/831) by [@Perlence](https://github.com/Perlence))
- Hardware cursor positioning for IME support in `Editor` and `Input` components. The terminal cursor now follows the text cursor position, enabling proper IME candidate window placement for CJK input. ([#719](https://github.com/badlogic/pi-mono/pull/719))
- `Focusable` interface for components that need hardware cursor positioning. Implement `focused: boolean` and emit `CURSOR_MARKER` in render output when focused.
- `CURSOR_MARKER` constant and `isFocusable()` type guard exported from the package

### Changed

- Changed Editor component to use proper box borders with vertical side borders instead of horizontal-only borders

### Fixed

- Decode Kitty CSI-u printable sequences in the editor so shifted symbol keys (e.g., `@`, `?`) work in terminals that enable Kitty keyboard protocol ([#779](https://github.com/badlogic/pi-mono/pull/779) by [@iamd3vil](https://github.com/iamd3vil))
- Keyboard shortcuts (Ctrl+C, Ctrl+D, etc.) now work on non-Latin keyboard layouts (Russian, Ukrainian, Bulgarian, etc.) in terminals supporting Kitty keyboard protocol with alternate key reporting ([#718](https://github.com/badlogic/pi-mono/pull/718) by [@dannote](https://github.com/dannote))

## [1.4.13] - 2026-11-08

- Released as part of Zeta 1.4.13.

## [1.4.12] - 2026-11-08

- Synced with upstream OMP v18.18.0.
- Released as part of Zeta 1.4.12; no package-specific user-visible changes.

### Added

- Added configurable editor padding via `editorPaddingX` theme option
- Added `inputCursor` symbol for customizing the text input cursor character

### Changed

- Settings list descriptions now wrap to the available width instead of truncating

### Fixed

- TUI now filters out key release events by default, preventing double-processing of keys in editors and other components

## [1.4.11] - 2026-11-06

- Released as part of Zeta 1.4.11; no package-specific user-visible changes.

## [1.4.10] - 2026-11-05

- Released as part of Zeta 1.4.10; no package-specific user-visible changes.

## [1.4.9] - 2026-11-03

- Synced with upstream OMP v18.18.0.

## [1.4.7] - 2026-10-30

- Synced with upstream OMP v18.18.0.

## [1.4.5] - 2026-10-28

- Synced with upstream OMP v18.18.0.

## [1.4.4] - 2026-10-26

- Released as part of Zeta 1.4.4; no package-specific user-visible changes.

## [1.4.3] - 2026-10-25

- Released as part of Zeta 1.4.3; no package-specific user-visible changes.

## [1.4.2] - 2026-10-24

- Version alignment with the 1.4.2 release line (no behavioral changes).

## [1.4.1] - 2026-10-23

- An attached TUI renders the backend's builtin-command output (`command_output`) in its status line and keeps client-only commands, pickers and mirrored switches local

## [1.4.0] - 2026-10-21

- Added a `zetawork` terminal id that resolves to the Kitty image protocol from the environment alone, so images render in the desktop app's own terminal

## [1.3.2] - 2026-10-19

- Version line moves to 1.3.2 with the rest of the suite; no user-visible change in this package.

## [1.3.1] - 2026-10-19

### Added

- Added `ComposerPreferences.completeScrollback` (default `false`): rows a growing HUD or dialog pushes off screen go straight to scrollback instead of being held back until it shrinks ([#15692](https://github.com/can1357/oh-my-pi/pull/15692) by [@Ilm-Alan](https://github.com/Ilm-Alan))

### Fixed

- Fixed table charts picking the wrong label and measure columns when numbers group thousands with spaces (`1 988`, `17 083`); they now read like `1,988` ([#16175](https://github.com/can1357/oh-my-pi/issues/16175))
- Fixed terminal capability replies relayed through win32-input-mode appearing as typed input in WSL terminals ([#16137](https://github.com/can1357/oh-my-pi/issues/16137))
- Fixed the status-bar activity spinner and turn timer freezing until the next keypress when the working-row loader is stopped mid-turn; an open turn window now repaints the status line on its own timer ([#16109](https://github.com/can1357/oh-my-pi/pull/16109) by [@tommymorgan](https://github.com/tommymorgan)).
- Fixed pasting sometimes inserting a block of base64 text instead of the pasted text in terminals that deliver pastes through the Kitty clipboard protocol (OSC 5522), most often with dictation apps that paste for you; a slow paste now arrives whole, and keys typed while a paste never finishes are given back instead of lost ([#16170](https://github.com/can1357/oh-my-pi/pull/16170) by [@H4vC](https://github.com/H4vC))
- Fixed a streaming table bouncing everything below it up and down while its last cell was still being written ([#16116](https://github.com/can1357/oh-my-pi/pull/16116) by [@galtamam-cmyk](https://github.com/galtamam-cmyk))
- Fixed inline images in iTerm2 being sized for the wrong cell shape, which left charts smeared or offset ([#16118](https://github.com/can1357/oh-my-pi/pull/16118) by [@galtamam-cmyk](https://github.com/galtamam-cmyk))

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

## [0.45.6] - 2026-01-13

### Added

- `OverlayOptions` API for overlay positioning and sizing with CSS-like values: `width`, `maxHeight`, `row`, `col` accept numbers (absolute) or percentage strings (e.g., `"50%"`). Also supports `minWidth`, `anchor`, `offsetX`, `offsetY`, `margin`. ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))

### Fixed

- Overlay compositing crash when rendered lines exceed terminal width due to complex ANSI/OSC sequences (e.g., hyperlinks in subagent output) ([#667](https://github.com/badlogic/pi-mono/pull/667) by [@nicobailon](https://github.com/nicobailon))

## [0.31.1] - 2026-01-02

Older entries are archived in [packages/tui/CHANGELOG.md@fa14205f838f](https://github.com/can1357/oh-my-pi/blob/fa14205f838f282fcea048c64fca74026789a492/packages/tui/CHANGELOG.md).

Older entries are archived in [packages/tui/CHANGELOG.md@89ad0a77d575](https://github.com/can1357/oh-my-pi/blob/89ad0a77d575f01398d3c0a57bc3a22111bef36a/packages/tui/CHANGELOG.md).
- Fixed ED3-risk unknown-viewport renders repainting offscreen structural edits over stale native scrollback, which could duplicate or shift rows when async blocks collapsed or middle rows were deleted.
- Fixed ED3-risk foreground streams committing mutable live-region rows into native scrollback, which could leave a stale `pending` tool box above the `running` box after the preview re-rendered.
- Fixed TUI shutdown leaving paint-time terminal state and Kitty image data behind by restoring synchronized-output/autowrap modes and purging all transmitted Kitty image ids on stop.
- Fixed stdin buffering splitting surrogate-pair text into UTF-16 halves and reduced timing sensitivity for incomplete escape sequences.
- Fixed terminal content not reflowing after a resize on terminals using DEC 2048 in-band resize (kitty/Ghostty/iTerm2/WezTerm). `ProcessTerminal.columns`/`rows` returned the last cached in-band report even after the OS already knew the new size, so a SIGWINCH whose in-band report was dropped or malformed (split past the stdin flush window, `:`-subparameter fields) re-rendered the whole transcript at the stale width. OS resize events now reconcile cached in-band geometry against the live `process.stdout` dimensions, dropping a stale cached value so the next render uses the true size; a valid in-band report still re-seeds pixel sizing.
- Fixed focus-changing in-place menus leaving stale Working/menu rows and parking the hardware cursor in the old menu viewport on terminals without a scroll-position oracle.
- Fixed redundant terminal cursor updates so repeated renders that do not change the cursor row, column, or visibility no longer emit ANSI move/hide sequences
- Fixed repeated cursor updates during no-op re-renders by reusing the last known cursor state, preventing unnecessary cursor position changes and hide/show sequences
- Fixed the kitty keyboard progressive-enhancement probe to honor the `CSI ? <flags> u` reply even when the terminal answers the DA1 sentinel first. Previously the kitty reply was discarded once the DA1-driven `modifyOtherKeys` fallback engaged, so terminals like Superset/xterm-on-Electron stayed on the fallback and delivered Shift+Enter as a bare `\r` ([#2042](https://github.com/can1357/oh-my-pi/issues/2042)).
- Bounded TUI line fitting for oversized raw rows so ANSI-heavy subagent output and zero-width-heavy text cannot grow render buffers independently of the viewport or hide visible suffix text ([#2045](https://github.com/can1357/oh-my-pi/issues/2045)).
- Fixed tmux offscreen-shrink frames to skip repainting when the visible tail is unchanged, avoiding intermittent blank/refresh flashes in pane terminals ([#2046](https://github.com/can1357/oh-my-pi/issues/2046)).
- Fixed Windows ConPTY hosts (Windows Terminal, Tabby, Hyper, VS Code) parking the viewport at the top of a full paint after a `/resume` or any long-session repaint. `ProcessTerminal#safeWrite` now splits oversized writes into ≤ 8 KiB pieces at line boundaries on `win32` and inside WSL (where stdout still crosses ConPTY at the `wslhost` boundary) so each underlying `WriteFile` stays below the ~32 KiB threshold where ConPTY stops tracking the cursor; the data was always delivered, but the host UI's scroll position would not follow until any focus event forced a re-query. ([#2034](https://github.com/can1357/oh-my-pi/issues/2034))

Older entries are archived in [packages/tui/CHANGELOG.md@bdbb5c920f69](https://github.com/can1357/oh-my-pi/blob/bdbb5c920f693caff287c50996c116e42e37992b/packages/tui/CHANGELOG.md).
