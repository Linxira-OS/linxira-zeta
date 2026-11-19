## [Unreleased]

### Breaking Changes

- `TtyWriter` now requires a drain threshold and callback and only supports independently reopenable TTYs. Its pending UTF-8 byte bounds are reported conservatively.
- Changed lsTree() to return { path, mode } entries instead of bare paths; mode matches git ls-tree output (for example, 100755 or 120000).

### Added

- Added the `PhononTts` binding for on-device Phonon text-to-speech.
- Added `Shell.adopt(fork)` to apply variables, functions, aliases, options, and traps from a completed fork back to its parent shell. When both shells set a name, the value from the command that finished last is retained.
- Added noVerify to commitCreate() options to skip the pre-commit and commit-msg hooks, matching git commit --no-verify.
- Added optimistic concurrency and alternate-index support to commitCreate(), allowing commits to use a separate index and reject stale commits when HEAD has changed.
- Improved grep() and glob() performance for ovnfs checkouts by using the serving daemon when available while preserving native fallback behavior and existing streaming, filtering, and link-following options.

### Changed

- Large terminal repaints are handled more efficiently, reducing JavaScript-thread work and releasing oversized buffers after output drains.
- Improved shell search across local and network filesystems: local searches avoid unexpectedly traversing network mounts, network-backed searches perform more directory operations concurrently, and fd supports parallel traversal together with ignore, pruning, depth, worker, and error-reporting options.

### Fixed

- Fixed Bazel host builds of the Linux addon with GNU linkers. Shipping Zig builds keep the single N-API export.
- On Unix, external commands now honor explicit nonstandard descriptor closures even when the host has an inheritable descriptor at the same number.
- Fixed stalled terminal writers continuing to emit output or leaking file descriptors after shutdown.
- Fixed terminal output preserving Unicode across chunk boundaries and safely replacing malformed surrogate sequences.
- Fixed concurrent `commitCreate()` calls incorrectly overwriting each other’s commit subject and body.
- Committing or writing trees now correctly reports unresolved index conflicts instead of silently omitting conflicted files.
- Fixed shell compatibility with GNU `grep` for end-of-line-anchored patterns, including `-o` and `-z` modes, and corrected `sed` substitutions on multibyte-character lines.
- Fixed native diff and patch handling for filenames containing spaces and other characters requiring quoting, including binary changes.
- Fixed binary patches produced by diffText({ binary: true }) and diffNoIndex(…, true) for non-UTF-8 text, such as Latin-1, so patches preserve the original bytes and apply correctly.
- Fixed SVG rendering when a generic font family refers to an unavailable font, preventing <text> elements from disappearing.
- Fixed worktree add for source checkouts containing read-only files or directories, including cases where tracked directories are replaced by symlinks.
- Fixed cancelled and timed-out Shell.run calls so they terminate only jobs started by that invocation while preserving the shell session for later runs.
- Reduced memory usage when visualizing long multi-line shell commands.
- Fixed the shell cp builtin so symlink-following options work correctly with archive and directory-copy modes without disabling recursion or attribute preservation.
- Replaced built-in shell crashes on very long -a/-o chains in [ ] and test expressions with a clear error for excessively deep expressions.

## [1.5.2] - 2026-11-13

### Changed

- Released as part of Zeta 1.5.2 asset review; no package-specific user-visible changes.

### Breaking Changes

- `typeText` and `axType` resolve to `{ unconfirmed, focusReturn }` on every platform instead of the takeover focus report; only Windows takeover typing sets `unconfirmed`, saying why the target was not seen reading the typed text ([#19037](https://github.com/can1357/oh-my-pi/pull/19037) by [@will-bogusz](https://github.com/will-bogusz))

### Added

- `DirectoryWatcher` watches a directory on Windows through `ReadDirectoryChangesW` on its own thread and reports changes in batches with their action (added, removed, modified, renamed) and lost-change signals, without dropping changes during bursts as `fs.watch` does there ([#18964](https://github.com/can1357/oh-my-pi/pull/18964) by [@H4vC](https://github.com/H4vC))
- `DirectoryWatcher` changes say whether their entry is a directory, and `close()` returns without waiting for the watcher thread to cancel its reads (a network round trip on shares)

### Fixed

- Fixed `grep()` so directly named files containing NUL bytes are searched as text, and directory or glob searches list skipped binary files whose content matches in `GrepResult.binaryMatches` ([#18988](https://github.com/can1357/oh-my-pi/pull/18988) by [@alphastorm](https://github.com/alphastorm))
- Fixed `computer.apps.open` on macOS returning `window: null` for an HTML file with its own `<title>`, or a page's window still titled with the previous tab: it now returns the browser window once it shows the page, with the page's title, including without Accessibility permission or when AX window/subrole reads fail; a hidden file-extension display name no longer selects an unchanged unrelated window, and root folders retain immediate display-name matching ([#18743](https://github.com/can1357/oh-my-pi/pull/18743) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed the macOS `computer` tool typing into or pressing a different control than the ref named, and reporting success, once the app reused the control's element (Contacts put the city in the street field): the call now sends nothing and fails with `StaleRef`, naming the control that now reads as the ref did when there is one ([#18892](https://github.com/can1357/oh-my-pi/pull/18892) by [@will-bogusz](https://github.com/will-bogusz))
- macOS relabelled-ref recovery also works for refs read from the desktop and searches the owning window once. Ref checks ignore unrelated identity-read failures, skip unused action-name queries, and refuse background input if the user brings its app forward during the check or a later window lookup ([#18892](https://github.com/can1357/oh-my-pi/pull/18892) by [@will-bogusz](https://github.com/will-bogusz))
- Windows `setValue()` now detects readable value mismatches and notifies the app for native combo changes without repeating unchanged selections. Hidden or unavailable read-back retains success after a successful write; unsupported combos and unsafe message dispatch are refused, and native messages are timeout-bounded ([#18915](https://github.com/can1357/oh-my-pi/pull/18915) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed the Linux `computer` tool hanging for the rest of the session, and freezing the app, once a `press()` or `menu.select()` opened a modal dialog in a GTK 3 app such as Audacity: reads of an app that does not answer now fail with `Timeout` after 5 s while screenshots and input keep working ([#18914](https://github.com/can1357/oh-my-pi/pull/18914) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed responsive Linux AT-SPI windows disappearing when enumeration takes longer than 5 s in total: the timeout now applies to each application reply, not the whole window scan ([#18914](https://github.com/can1357/oh-my-pi/pull/18914) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed responsive Linux AT-SPI focus, window-ownership and hit-test scans timing out in aggregate; traversal replies are now bounded individually while single-element reads and mutations retain their operation budgets ([#18914](https://github.com/can1357/oh-my-pi/pull/18914) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Wayland desktop accessibility reads selecting a shell surface when the focused application did not answer: shell-only candidates now require confirmed keyboard focus before bypassing the skipped application's timeout ([#18914](https://github.com/can1357/oh-my-pi/pull/18914) by [@will-bogusz](https://github.com/will-bogusz))
- X11 takeover now observes the first quiet interval, waits for held keys and pointer buttons to be released, drains intervention events before admission, focus changes and further input as well as through focus hand-back, and advertises itself unavailable if observation fails; physical Escape remains observable during keyboard grabs ([#18784](https://github.com/can1357/oh-my-pi/pull/18784) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed X11 takeover taking a typing user's keys: a window or element takeover now waits, without holding the input lock, until you have pressed no key or button for 5 s (failing `UserIntervened` if you are still at it near the run's timeout), and stops with `UserIntervened` at your first key or click once it has activated its target ([#18784](https://github.com/can1357/oh-my-pi/pull/18784) by [@will-bogusz](https://github.com/will-bogusz))
- X11 takeover activation failures now ask the window manager to put your window back even when its active-window property has not caught up with core focus, and a press or Escape just after the activation request is sent no longer leaves the window manager switching to the target after the call returns; pointer hand-back no longer warps after your press or while a button is held ([#18784](https://github.com/can1357/oh-my-pi/pull/18784) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed X11 window screenshots showing whatever was on screen over the window: under a compositing manager they come from the window's own pixels with its own menus and tooltips, cut to their shapes, and otherwise a covered window is reported covered instead of returning the window on top ([#18783](https://github.com/can1357/oh-my-pi/pull/18783) by [@will-bogusz](https://github.com/will-bogusz))
- macOS relabelled-ref recovery also works for refs read from the desktop or a display and searches the owning window once. Ref checks ignore unrelated identity-read failures, skip queries for unused action names or child labels, and refuse background input if the user brings its app forward during the check or a later window lookup ([#19054](https://github.com/can1357/oh-my-pi/pull/19054) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Linux `setValue` losing its empty-field warning when a masked field was cleared and the replacement write timed out or was cancelled ([#19050](https://github.com/can1357/oh-my-pi/pull/19050) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Linux `setValue()` with a number reporting success when the control clamped, rounded or ignored it, such as 150 on a 0-100 slider; it now reads the value back and fails naming what the control holds and any bound crossed, without printing an unbounded limit ([#19047](https://github.com/can1357/oh-my-pi/pull/19047) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Linux `menu.select()` refusing every path below a Qt 5 or Qt 6 menu bar ("path traverses a command rather than a submenu") and `menu.items()` refusing a Qt menu: Qt holds a menu bar item's items in a popup menu, which is now read as that item's submenu, so `menu.select(["File", "Save"])` presses the item with no menu opened ([#19046](https://github.com/can1357/oh-my-pi/pull/19046) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed a macOS takeover click on a suggestion list, such as Safari's password autofill dropdown, refusing without saying what works: pointer refusals now name the window the list is attached to and say a click without takeover reaches it, without suggesting a click for refused key input ([#19027](https://github.com/can1357/oh-my-pi/pull/19027) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `setValue` on macOS failing with `AxFailed` when a password field read back as a mask exactly as long as the text written, although the text had landed (KeePassXC's Qt field); it now succeeds. Typing into such a field by accessibility insertion (`el.type`, `win.type`) no longer fails either. A mask of another length still fails ([#19026](https://github.com/can1357/oh-my-pi/pull/19026) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed X11 clicks, holds, drags and scrolls on a window, in the background and in takeover, reporting success while that app had a popup menu open, such as one an earlier session opened and left: the menu took the press and closed, and nothing reached the window. Such a call now fails with nothing sent, naming the popup (`BackgroundUnavailable` in the background, `InputFailed` in takeover); a press inside the popup or its submenus still goes through ([#19044](https://github.com/can1357/oh-my-pi/pull/19044) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Linux X11 background keys and clicks going into the window you were using, while reported delivered, after a screen lock or a switch to another virtual terminal and back ([#19023](https://github.com/can1357/oh-my-pi/pull/19023) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Windows takeover typing handing the foreground back before the target had read the typed keys, which sent the end of the text to the user's window while reporting success (a Chrome field kept 218 to 237 of 2,000 characters); typing now waits up to 5 s for the focused control's thread to read them, and `unconfirmed` says why when it could not see that ([#19037](https://github.com/can1357/oh-my-pi/pull/19037) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `setValue` errors on macOS and Linux repeating the written text, which could expose a password typed into a field that did not report itself as a password field ([#18989](https://github.com/can1357/oh-my-pi/pull/18989) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed clicking an element of a macOS suggestion list, such as a row of Safari's password autofill dropdown, failing with `AxFailed: AX element has no identifiable owning window` ([#19004](https://github.com/can1357/oh-my-pi/pull/19004) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS desktop capabilities claiming `globalEscape` while Secure Event Input is on (a focused password field, an authentication dialog, a terminal's secure keyboard entry), when macOS hides every key from the Escape and user-input monitors; capabilities now report `secureInput` and the holding app in `secureInputApp` ([#18982](https://github.com/can1357/oh-my-pi/pull/18982) by [@will-bogusz](https://github.com/will-bogusz))
- Windows computer use now reports a locked, disconnected or secure desktop instead of leaving failed captures and undelivered input unexplained ([#18947](https://github.com/can1357/oh-my-pi/pull/18947) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS key presses on non-US keyboard layouts pressing the wrong key: on French AZERTY `cmd+a` quit the app and `cmd+z` closed the window; shortcuts now use the keys your layout puts those letters on, and a failed layout read stops before sending keys ([#18897](https://github.com/can1357/oh-my-pi/pull/18897) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Windows background shortcuts such as `ctrl+s` and `ctrl+a`, and Ctrl- or Shift-clicks, reporting success while classic Win32, WinForms and Qt apps got the plain key or click; background input holding Ctrl, Alt, Shift or the Windows key now throws `BackgroundUnavailable` with nothing sent, and the default `backgroundFallback` reruns it in takeover ([#18895](https://github.com/can1357/oh-my-pi/pull/18895) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed your running Qt 6.5+ apps crashing on Linux X11 when a `computer` session that used background window input ended or was cancelled, or after an omp process using it was killed ([#18825](https://github.com/can1357/oh-my-pi/pull/18825) by [@will-bogusz](https://github.com/will-bogusz))
- Limited retained X11 background-input master pairs to two per display, clearing dead holders' focus even while their slaves unplug, reusing free pairs with keyboard locks and latches cleared, and falling back or refusing when both are busy without disabling later attempts; legacy pairs are neither adopted nor counted toward this limit because older omp versions can still remove them ([#18825](https://github.com/can1357/oh-my-pi/pull/18825) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed X11 background typing reporting success after losing keys during an X server stall; incomplete typing now fails and disables further background input for the session ([#18828](https://github.com/can1357/oh-my-pi/pull/18828) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Windows element typing and key presses that ran in takeover, such as `el.type()` into a Chrome, Electron or WPF field, leaving the target window in front instead of handing focus back to the user's window; a user window switch before element focus now stops delivery instead of taking focus back ([#18919](https://github.com/can1357/oh-my-pi/pull/18919) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS `press()` on a disabled control reporting success while the control ignored it; it now fails and says the control is disabled ([#18898](https://github.com/can1357/oh-my-pi/pull/18898) by [@will-bogusz](https://github.com/will-bogusz))
- Windows menu selections that open a modal dialog no longer report a delivery timeout when the new dialog is responsive ([#18922](https://github.com/can1357/oh-my-pi/pull/18922) by [@will-bogusz](https://github.com/will-bogusz))
- `menu.select()` and `menu.items()` on macOS, Linux and Windows now name the items a menu offers, escaping labels and marking disabled items and submenus, when a label in the path is not found; macOS waits for menu revalidation after activation before listing states ([#18923](https://github.com/can1357/oh-my-pi/pull/18923) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Linux `press()` refusing with "AT-SPI action 'press' is unavailable" on Chromium and Electron menu items, list options and tabs, and on page elements whose only action is `doDefault`: a press now takes their `select` or `doDefault` action, as it already took `click` and `activate` ([#18921](https://github.com/can1357/oh-my-pi/pull/18921) by [@will-bogusz](https://github.com/will-bogusz))
- macOS input from a second omp process no longer refuses with `UserIntervened` after the first process takes over a click in the same app; hardware clicks still pause input in that app ([#18896](https://github.com/can1357/oh-my-pi/pull/18896) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `omp worktree add` — and the bash tool's `git worktree add` rewrite — exiting 1 with `git: 'hook' is not a git command` on Git older than 2.36 (such as Git 2.34 on Ubuntu 22.04) after the worktree had already been created ([#18935](https://github.com/can1357/oh-my-pi/pull/18935) by [@Bensonluo](https://github.com/Bensonluo))


## [9.8.0] - 2026-02-01

### Breaking Changes

- Removed `resize()` function; use `PhotonImage.resize()` method instead
- Removed `terminateImageWorker()` function
- Changed `PhotonImage.new_from_byteslice()` to `PhotonImage.parse()`
- Changed `PhotonImage.get_bytes()` to `encode(ImageFormat.PNG, 100)`
- Changed `PhotonImage.get_bytes_jpeg(quality)` to `encode(ImageFormat.JPEG, quality)`
- Removed `get_width()` and `get_height()` methods; use `width` and `height` properties instead
- Removed manual resource management via `free()` and `Symbol.dispose`

### Added

- Added `embed:native` build script to embed platform-specific native addon payloads into compiled binaries
- Exported `Shell` class for creating persistent shell sessions with `run()` method and session options
- Exported `ShellOptions`, `ShellRunOptions`, and `ShellRunResult` types for shell session management
- Exported `find()` function for file discovery with glob patterns and .gitignore support
- Exported `FindOptions`, `FindMatch`, and `FindResult` types for file search operations
- Exported `ImageFormat` enum for specifying output formats (PNG, JPEG, WEBP, GIF) in image encoding
- Added `ImageFormat` enum for specifying output format (PNG, JPEG, WEBP, GIF) in `encode()` method
- Added `SamplingFilter` as exported enum instead of object
- Added `Shell` class with persistent session options (`sessionEnv`, `snapshotPath`) and a `run()` command API
- Exported `getSystemInfo()` function and `SystemInfo` type for retrieving system information including distro, kernel, CPU, and disk details
- Exported `copyToClipboard()` and `readImageFromClipboard()` functions for clipboard operations
- Exported `ClipboardImage` type for clipboard image data with MIME type information
- Added `wrapTextWithAnsi()` function to wrap text to a visible width while preserving ANSI escape codes across line breaks
- Added native clipboard helpers for copying text and reading images via arboard

### Changed

- Enhanced native addon loading to prioritize extracted embedded addon for compiled binaries before falling back to system paths
- Improved error messages to provide platform-specific guidance for addon loading failures, including manual download instructions for compiled binaries
- Reorganized native bindings into modular type files with declaration merging via `NativeBindings` interface
- Moved type definitions from implementation files to dedicated `types.ts` modules for better separation of concerns
- Enhanced `SystemInfo` type with additional fields: `os`, `arch`, `hostname`, `shell`, `terminal`, `de`, `wm`, and `gpu`
- Refactored module exports to use direct destructuring from native bindings instead of wrapper functions
- Changed `PhotonImage` API to use instance methods (`resize()`, `encode()`) instead of standalone functions
- Changed `PhotonImage` to use property accessors for `width` and `height` instead of getter methods

## [9.7.0] - 2026-02-01

### Added

- Exported `killTree` function to kill a process and all its descendants using platform-native APIs
- Exported `listDescendants` function to list all descendant PIDs of a process
- Added `dev:native` npm script to build debug native binaries with `--dev` flag
- Added `OMP_DEV` environment variable support for loading and debugging development native builds
- Exported keyboard parsing and matching functions: `parseKey`, `parseKittySequence`, `matchesLegacySequence`, and `matchesKey` for terminal input handling
- Exported `KeyEventType` enum and `ParsedKittyResult` type for Kitty keyboard protocol support
- Added `parseKey` function to parse terminal input and return normalized key identifiers (e.g., "ctrl+c", "shift+tab")
- Added `parseKittySequence` function to parse Kitty keyboard protocol sequences with codepoint, modifier, and event type information
- Added `matchesLegacySequence` function to match legacy escape sequences for specific keys
- Added `matchesKey` function to match input against key identifiers with support for modifiers and Kitty protocol

### Changed

- Modified native binary build process to support both debug and release builds via `--dev` flag
- Updated native binary search to prioritize platform-tagged builds and separate debug/release candidates
- Changed debug builds to output to `pi_natives.dev.node` instead of mixing with release artifacts
- Improved native binary installation to use atomic rename operations and better fallback handling for Windows DLLs
- Reordered native binary search candidates to prioritize platform-tagged builds and avoid loading stale cross-compiled binaries
- Enhanced cross-compilation detection to prevent installing wrong-platform fallback binaries during cross-compilation builds

### Fixed

- Fixed potential issue where cross-compiled binaries could overwrite platform-specific native builds with incorrect architecture binaries

## [9.6.4] - 2026-02-01

### Breaking Changes

- Changed callback signature for `find()` and `grep()` streaming callbacks to receive `(error, match)` instead of `(match)` for proper error handling

## [9.6.2] - 2026-02-01

### Breaking Changes

- Renamed `EllipsisKind` enum to `Ellipsis`
- Changed `TextInput` type parameter to `string` in `truncateToWidth()`, `visibleWidth()`, `sliceWithWidth()`, and `extractSegments()` functions—Uint8Array is no longer accepted
- Removed `TextInput` type export from public API

### Added

- Added `visibleWidth()` function to measure the visible width of text, excluding ANSI codes

### Changed

- Reordered native module search paths to prioritize repository build artifacts
- Improved JSDoc documentation for `truncateToWidth()` with clearer parameter descriptions and behavior details
- Added early return optimization in `truncateToWidth()` to skip native call when text fits within maxWidth and padding is not requested
- Added early return optimization in `sliceWithWidth()` to return empty result when length is zero or negative

### Removed

- Removed validation checks for `PhotonImage` and `SamplingFilter` native exports
- Removed early return optimization in `truncateToWidth()` when text fits within maxWidth

## [9.6.1] - 2026-02-01

### Added

- Added `matchesKittySequence` function to match Kitty protocol sequences for codepoint and modifier

### Removed

- Removed `visibleWidth` function from text utilities

## [9.6.0] - 2026-02-01

### Added

- Support for cross-compilation via `CARGO_BUILD_TARGET` environment variable
- Support for overriding platform and architecture detection via `TARGET_PLATFORM` and `TARGET_ARCH` environment variables

### Changed

- Native build script now searches for release artifacts in target-specific directories when cross-compiling

## [9.5.0] - 2026-02-01

### Added

- Added `sortByMtime` option to `FindOptions` to sort results by modification time (most recent first) before applying limit
- Added streaming callback support to `grep()` function via optional `onMatch` parameter for real-time match notifications
- Exported `RequestOptions` type for timeout and abort signal configuration across native APIs
- Exported `fuzzyFind` function for fuzzy file path search with gitignore support
- Exported `FuzzyFindOptions`, `FuzzyFindMatch`, and `FuzzyFindResult` types for fuzzy search API
- Added `fuzzyFind` export for fuzzy file path search with gitignore support

### Changed

- Changed `grep()` and `fuzzyFind()` to support timeout and abort signal handling via `RequestOptions`
- Updated `GrepOptions` and `FuzzyFindOptions` to extend `RequestOptions` for consistent timeout/cancellation support
- Refactored `htmlToMarkdown()` to support timeout and abort signal handling

### Removed

- Removed `grepDirect()` function (use `grep()` instead)
- Removed `grepPool()` function (use `grep()` instead)
- Removed `terminate()` export from grep module
- Removed `terminateHtmlWorker` export from html module

### Fixed

- Fixed potential crashes when updating native binaries by using safe copy strategy that avoids overwriting in-memory binaries

## [1.5.0] - 2026-11-09

- Released as part of Zeta 1.5.0; no package-specific user-visible changes.

## [1.4.13] - 2026-11-08

- Released as part of Zeta 1.4.13.

## [1.4.12] - 2026-11-08

- Synced with upstream OMP v18.18.0.
- Released as part of Zeta 1.4.12; no package-specific user-visible changes.

## [1.4.11] - 2026-11-06

- Released as part of Zeta 1.4.11; no package-specific user-visible changes.

## [1.4.10] - 2026-11-05

- Released as part of Zeta 1.4.10; no package-specific user-visible changes.

## [1.4.9] - 2026-11-03

- Synced with upstream OMP v18.18.0.

### Added

- Added automatic extraction of embedded native addon to `~/.zeta/natives/<version>` on first run for compiled binaries

### Changed

- Embedded native addon payload for compiled binaries and extract to `~/.zeta/natives/<version>` on first run

## [1.4.6] - 2026-10-28

### Breaking Changes

- Removed the `invalidateFsScanCache` API and the associated filesystem scan cache environment variables (`FS_SCAN_CACHE_TTL_MS`, `FS_SCAN_EMPTY_RECHECK_MS`, `FS_SCAN_CACHE_MAX_ENTRIES`, and `FS_SCAN_CACHE_MAX_BYTES`); filesystem listing caches are now managed automatically.

### Added

- Added a built-in `rsync` implementation to the bash tool, compatible with rsync 3.5.1 and protocol versions 29–33 across Linux, macOS, and Windows. It supports local copies, SSH remote shells via `-e`, and `rsync://` daemons without requiring an installed binary; daemon serving is not supported, and `PI_DISABLE_UUTILS_DESTRUCTIVE` continues to use the system `rsync`.
- Added built-in `ast-grep` (also available as `sg`) support to the bash tool for structural code search and rewriting, including pattern matching, rewrites, context, headings, and JSON output.

### Changed

- Improved native filesystem search performance, including faster globbing and more efficient grep, fuzzy finding, workspace listing, and structural search/edit operations, while preserving deterministic result ordering and streaming behavior.
- Native search and the bash tool's built-in `rg`, `grep`, `fd`, `find`, and `ast-grep` now stop filesystem work promptly when cancelled or timed out, including searches over JavaScript-provided filesystems and searches interrupted while reading large files.
- The bash tool's built-in `rg` and recursive `grep` now search files in parallel while retaining path-ordered output; `grep` can also stop promptly after reaching `maxCount`.
- Enabled safe reuse of unchanged directory listings when `cache: true`, with timestamp validation to prevent stale results.

### Fixed

- Fixed cancelled native directory searches leaving filesystem-provider requests running during startup.
- Fixed built-in bash commands such as `cat`, `grep`, `head`, `wc`, `read`, and `mapfile` hanging at the end of FIFO input on macOS; `read -t` now returns at EOF.
- Fixed ANSI text wrapping for styled underlines, background colours, and colon-form RGB colours.
- Fixed clicking in native audio playback when the queue runs dry mid-waveform by smoothly fading output to silence and back.

## [1.4.5] - 2026-10-28

- Synced with upstream OMP v18.18.0.

## [1.4.4] - 2026-10-26

- Released as part of Zeta 1.4.4; no package-specific user-visible changes.

## [1.4.3] - 2026-10-25

- Released as part of Zeta 1.4.3; no package-specific user-visible changes.

## [1.4.2] - 2026-10-24

- Version alignment with the 1.4.2 release line (no behavioral changes).

## [1.4.1] - 2026-10-23

- Version alignment with the 1.4.1 release line (no behavioral changes).

## [1.4.0] - 2026-10-21

- Version line moves to 1.4.0 with the rest of the suite; no user-visible change in this package.

## [1.3.2] - 2026-10-19

- Version line moves to 1.3.2 with the rest of the suite; no user-visible change in this package.

## [1.3.1] - 2026-10-19

### Added

- Added a `refuseMenu` option to `click`, `drag` and `holdMouse`: a macOS background left click on a menu button or popup button, or a drag or hold starting on one, throws `BackgroundUnavailable` before anything is sent ([#15191](https://github.com/can1357/oh-my-pi/pull/15191) by [@will-bogusz](https://github.com/will-bogusz))
- Added a `returnFocus` option for window input with `takeover`: on macOS the takeover hands focus back to your app even if you clicked meanwhile, and only a third app you switched to keeps focus ([#15191](https://github.com/can1357/oh-my-pi/pull/15191) by [@will-bogusz](https://github.com/will-bogusz))
- Added `DesktopSession.axSelectText` (macOS) to select text in an accessibility element's value by UTF-16 range, refusing missing or ambiguous matches and returning the selection read back ([#15175](https://github.com/can1357/oh-my-pi/pull/15175) by [@will-bogusz](https://github.com/will-bogusz))
- Added a `menu` item path to `click` options and `axPerform`: a macOS click or action that opens a menu chooses that item, submenus included, and leaves no menu open ([#15185](https://github.com/can1357/oh-my-pi/pull/15185) by [@will-bogusz](https://github.com/will-bogusz))
- Added `DesktopSession.axType` and `axKeyChord`, which type into or press keys in one accessibility element; on macOS a field that does not report keyboard focus gets nothing and the error names what has focus; on Windows background input goes straight to the element's own control window and refuses a windowless element ([#15563](https://github.com/can1357/oh-my-pi/pull/15563) by [@will-bogusz](https://github.com/will-bogusz))
- Added `DesktopSession.escapeStops` and `desktopEscapeStops(key)`, counting takeover input you stopped with physical Escape on macOS, Windows and X11, apart from host cancels ([#15564](https://github.com/can1357/oh-my-pi/pull/15564) by [@will-bogusz](https://github.com/will-bogusz))
- Added `UserIntervened` on macOS: keys and clicks stop at your first key or click in the app they go to, and input to an app you used since it was last read waits up to 5 s for you to pause, then fails without sending (needs Input Monitoring) ([#15562](https://github.com/can1357/oh-my-pi/pull/15562) by [@will-bogusz](https://github.com/will-bogusz))

### Changed

- Reduced Mermaid XY-chart rendering overhead while preserving chart colors and layout ([#16214](https://github.com/can1357/oh-my-pi/pull/16214) by [@kyle-elliott](https://github.com/kyle-elliott)).
- Reading recent commit subjects in a long Git history now reads only the commits requested instead of walking the whole history ([#16210](https://github.com/can1357/oh-my-pi/pull/16210) by [@kyle-elliott](https://github.com/kyle-elliott)).
- Improved AST search and edit performance in directories containing many unsupported files ([#16213](https://github.com/can1357/oh-my-pi/pull/16213) by [@kyle-elliott](https://github.com/kyle-elliott)).
- Faster numbered source formatting for hashline reads ([#16211](https://github.com/can1357/oh-my-pi/pull/16211) by [@kyle-elliott](https://github.com/kyle-elliott)).
- Improved word-diff performance for inline change highlighting ([#16212](https://github.com/can1357/oh-my-pi/pull/16212) by [@kyle-elliott](https://github.com/kyle-elliott)).
- Window input calls, element `axClick`, `axType` and `axKeyChord` included, resolve to a `DesktopFocusReturn` (`handedBack`, `previousPid`, `frontPid`) when a macOS takeover ran, and to `null` otherwise ([#15191](https://github.com/can1357/oh-my-pi/pull/15191) by [@will-bogusz](https://github.com/will-bogusz))
- `BackgroundUnavailable` and partial-delivery errors no longer tell the caller to retry with `takeover:true`; they say whether any input was sent ([#15191](https://github.com/can1357/oh-my-pi/pull/15191) by [@will-bogusz](https://github.com/will-bogusz))
- Reduced allocation overhead for uncached, result-limited file searches in large directory trees ([#16115](https://github.com/can1357/oh-my-pi/pull/16115) by [@kyle-elliott](https://github.com/kyle-elliott)).
- Desktop window input with `takeover` omitted is now background on every platform even while task control is held; only `takeover: true` selects foreground delivery ([#15173](https://github.com/can1357/oh-my-pi/pull/15173) by [@will-bogusz](https://github.com/will-bogusz))
- Computer use's physical Escape stop now watches the keyboard only during takeover input (`takeover: true`, held control, desktop-level input, raises); without held control, an Escape the user presses in their own app no longer cancels background window input, which the host interrupt still stops ([#15176](https://github.com/can1357/oh-my-pi/pull/15176) by [@will-bogusz](https://github.com/will-bogusz))
- macOS background keys, typing, left clicks and menu commands now refuse with `BackgroundUnavailable` when aimed at a non-key window of the app you are using, or once you have come to the target app, instead of moving your typing there; keys sent while another window of the target app becomes key stop with `InputFailed` ([#15184](https://github.com/can1357/oh-my-pi/pull/15184) by [@will-bogusz](https://github.com/will-bogusz))
- macOS `win.menu.items` now makes the window key within its app before reading, so it takes the input lock and throws `InputBusy` while another operation holds it ([#15184](https://github.com/can1357/oh-my-pi/pull/15184) by [@will-bogusz](https://github.com/will-bogusz))
- macOS background drags and holds on sliders, scroll bars, splitters and steppers, modified clicks, right-clicks, Electron scrolls and Tk 8.5 clicks now run without bringing the app forward; drags that could pick up files or text still throw `BackgroundUnavailable` ([#15185](https://github.com/can1357/oh-my-pi/pull/15185) by [@will-bogusz](https://github.com/will-bogusz))

### Fixed

- Fixed macOS `UserIntervened` missing your input during element writes (`axSelectText`, `setValue`, native-field typing, AX actions and popups), a reused Open/Save panel process id counting another app's input, and an event tap started during exit staying live ([#15562](https://github.com/can1357/oh-my-pi/pull/15562))
- Fixed macOS remote-screen `press`/`holdKeys` landing in a Screen Sharing window you brought forward during the layout read, iPhone Mirroring dropping a press right after a release, and a modifier two characters need being pressed twice ([#15193](https://github.com/can1357/oh-my-pi/pull/15193))
- Fixed the macOS focus guard missing switches while a click hit-test stalled and missing an app the action brought forward 200–500 ms after its last send; background actions now keep guarding for that window before returning ([#15195](https://github.com/can1357/oh-my-pi/pull/15195))
- Fixed macOS key rerouting sending your keys to the app you had left after you switched to a third app, letting a menu that still held the keyboard from an earlier action take your keys, and dropping a theft when key focus could not be read ([#16140](https://github.com/can1357/oh-my-pi/pull/16140))
- Fixed macOS keys and mouse buttons staying down when omp is killed or its native input code panics mid-gesture; a key or button you are physically holding is left for you to release ([#15192](https://github.com/can1357/oh-my-pi/pull/15192) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS and X11 background input throwing `BackgroundUnavailable` ("nothing was sent") after part of the call was already sent; it now throws `InputFailed`, and on macOS a call stopped because you came to the target app throws `UserIntervened` ([#15191](https://github.com/can1357/oh-my-pi/pull/15191) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS takeover `InputFailed` naming only the target window when another held focus; it now names the app's focused window, such as an alert or sheet, or the app that stayed in front ([#15191](https://github.com/can1357/oh-my-pi/pull/15191) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed a macOS `takeover: true` click or key that opened a document or closed a sheet or panel leaving its app in front for good; focus now returns to your app unless you clicked or pressed a shortcut during the takeover ([#15191](https://github.com/can1357/oh-my-pi/pull/15191) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed the in-process `cksum --check` panicking on a tagged checksum line that starts with `(` (for example `(file)= <hash>`) instead of reporting it as an invalid checksum line ([#16142](https://github.com/can1357/oh-my-pi/pull/16142) by [@jchanghong023](https://github.com/jchanghong023))
- Fixed `grep --path-separator` leaving `\` separators untouched in printed paths on Windows, so displayed paths no longer mix `\` with the configured separator ([#16143](https://github.com/can1357/oh-my-pi/pull/16143) by [@jchanghong023](https://github.com/jchanghong023))
- Fixed macOS computer use reporting a working physical Escape stop (`globalEscape: true`) when Input Monitoring was turned off and the stop could not see keys; `inputPermission` now reports event-posting access, and permission errors name the terminal or IDE to grant ([#15157](https://github.com/can1357/oh-my-pi/pull/15157) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed a persistent `Shell` session discarding its variables, functions, and options when a command ran `exit` or stopped under `set -e`; those now end only the command, and only a failed run resets the session ([#16153](https://github.com/can1357/oh-my-pi/pull/16153) by [@alphastorm](https://github.com/alphastorm))
- Fixed a macOS element-ref `StaleRef` giving no lead when the app destroyed the element and put an identical one in its place: the error now names the one element of the window with the fields the ref was read with, registered as a new ref, and sends nothing to it ([#15574](https://github.com/can1357/oh-my-pi/pull/15574) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS takeover input sending the user back to their previous app when they clicked in the takeover target as the input ended, and keeping the target in front for good when they merely kept typing while takeover held it: a click, a shortcut (any key with Command or Control, such as Command-Tab or Control-Up, a function key or a Globe shortcut), or a switch to another app now leaves the front app to the user, and macOS refuses the hand-back if one came after the takeover's own input; plain typing alone no longer does, once Input Monitoring lets omp tell it apart ([#15176](https://github.com/can1357/oh-my-pi/pull/15176) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS background input taking keyboard focus from your app, which then dropped pastes and shortcuts until clicked again, and the focus guard sending your app back to the front just after you picked the target yourself ([#15184](https://github.com/can1357/oh-my-pi/pull/15184) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS background input doing nothing or landing in the wrong place for Chrome pages, apps with several windows, Finder, sheets, popovers, inline editors such as Finder's rename field, and system Open/Save panels; keys for a window behind its own focused sheet now throw `InvalidTarget` naming the sheet ([#15184](https://github.com/can1357/oh-my-pi/pull/15184) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed TextEdit and Script Editor freezing after a background ⌘S, and background shortcuts reporting success when the app stopped answering; they now throw `InputFailed` saying the outcome is unknown ([#15184](https://github.com/can1357/oh-my-pi/pull/15184) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS `win.menu.items` and `win.menu.select` treating commands such as Font Book's File ▸ New Collection as disabled while the app was in the background or had not yet caught up with an edit ([#15184](https://github.com/can1357/oh-my-pi/pull/15184) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS `openApplication` leaving a hidden running app without a window and bringing Notes or Contacts to the front; it now shows the app behind yours and returns its first window ([#15184](https://github.com/can1357/oh-my-pi/pull/15184) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS background and takeover input refusing while your front app showed no window, as Finder does after a click on the desktop ([#15184](https://github.com/can1357/oh-my-pi/pull/15184) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed a macOS background AX action that failed yet brought its app forward, such as `AXOpen` in Chrome's Open panel, leaving that app in front of yours ([#15184](https://github.com/can1357/oh-my-pi/pull/15184) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS background right-clicks, menu button presses and popup `setValue` leaving a menu open in the target app, which took your keyboard; the menu now closes, and a right-click or press that opened one throws `InputFailed` ([#15185](https://github.com/can1357/oh-my-pi/pull/15185) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed a macOS `menu` path or background `press()` on a popup in an Open or Save panel, such as Automator's Where: popup, failing to find its menu ([#15185](https://github.com/can1357/oh-my-pi/pull/15185) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed your typing landing in the macOS app a background action targets when that app brings itself to the front while you type ([#15195](https://github.com/can1357/oh-my-pi/pull/15195) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS background input sending you back to your previous app after you opened the target app from Spotlight during the action ([#15195](https://github.com/can1357/oh-my-pi/pull/15195) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed an app that a macOS background action opens something in, such as TextEdit after a background ⌘O in Finder, staying in front of your app; it is sent back like the target ([#15195](https://github.com/can1357/oh-my-pi/pull/15195) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed a key you typed on macOS reaching your app twice or more when a process holding a computer-use event tap exited; `closeDesktopEventTaps()` closes them first ([#15562](https://github.com/can1357/oh-my-pi/pull/15562) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS typing into Screen Sharing and iPhone Mirroring arriving as the wrong characters: it now presses your keyboard layout's keys, types unmodified text in the background and stops while you hold a modifier or Caps Lock is on, and iPhone Mirroring taps and scrolls land where aimed ([#15193](https://github.com/can1357/oh-my-pi/pull/15193) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed your keystrokes landing in the app a macOS background action targets, or vanishing into a menu it opened, when it takes the keyboard mid-action; they now reach your app ([#16140](https://github.com/can1357/oh-my-pi/pull/16140) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed computer use input that had already gone out, such as typed text, a shortcut or a click, reporting `Cancelled` when you stopped it moments later; the stop now ends the next call instead ([#16202](https://github.com/can1357/oh-my-pi/pull/16202) by [@will-bogusz](https://github.com/will-bogusz))

## [1.3.0] - 2026-10-18

### Fixed

- Fixed native memory growing without bound, and eventually crashing the process, when files in a downloaded (WASM) grammar language such as C# were parsed repeatedly ([#16067](https://github.com/can1357/oh-my-pi/issues/16067))
- Fixed `pwsh` code blocks rendering without PowerShell syntax colors ([#15008](https://github.com/can1357/oh-my-pi/issues/15008)).
- Fixed unnecessary worker scheduling overhead in `read` loops over regular files ([#15504](https://github.com/can1357/oh-my-pi/pull/15504) by [@mg-mg-mg](https://github.com/mg-mg-mg))
- Fixed `astGrep` and `astEdit` missing parse errors when Tree-sitter recovered by inserting a missing token, so edits could rewrite files that do not parse; such files are now reported and skipped ([#15530](https://github.com/can1357/oh-my-pi/issues/15530), [#15851](https://github.com/can1357/oh-my-pi/pull/15851) by [@glyahh](https://github.com/glyahh))
- Fixed `grep` and `astGrep` `glob` filters skipping the files under a directory the glob matches, so `{src,test}` or `sr?` found nothing; a matched directory now selects every file under it, so `dir/*` also matches files in `dir`'s subdirectories ([#15760](https://github.com/can1357/oh-my-pi/issues/15760))
- Fixed `grep()` and `search()` showing the start of a line wider than `maxColumns`, with no `column`, when the only match was an empty one at the end of the file (`$` or `\z` on a last line without a newline); they now show the end of the line and its column ([#15411](https://github.com/can1357/oh-my-pi/pull/15411) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed embedded-shell `xargs` failing with "Argument list too long" on large input lists instead of splitting them into executable batches ([#15708](https://github.com/can1357/oh-my-pi/pull/15708) by [@mg-mg-mg](https://github.com/mg-mg-mg))
- Fixed applying a submodule pin patch to the worktree failing with "does not exist" for a submodule directory or trying to write the pinned commit as a file; like `git apply`, the submodule's checkout is left untouched, an added pin creates its empty directory, and a removed one deletes only an empty (uninitialized) directory ([#15459](https://github.com/can1357/oh-my-pi/pull/15459))
- Fixed `diffText`/`numstat` showing a moved submodule as a delete plus an add instead of Git's 100% rename, and `applyPatch` now applies such rename patches ([#15459](https://github.com/can1357/oh-my-pi/pull/15459))
- Fixed `submodulePaths()` following `.gitmodules` paths that are absolute or contain `.`/`..`, which could point outside the repository or loop forever; like Git, such entries are ignored ([#15459](https://github.com/can1357/oh-my-pi/pull/15459))
- Fixed `copyGitObjects` exposing partially copied objects and packs to concurrent Git readers and permanently skipping a file truncated by an interrupted copy; each file is now published atomically ([#15459](https://github.com/can1357/oh-my-pi/pull/15459))
- Fixed embedded-shell `read` in a pipeline stage or async job queueing a second blocking worker while holding its own, which could hang every such read once the bounded blocking pool filled ([#15509](https://github.com/can1357/oh-my-pi/pull/15509))
- Fixed Mermaid labels decoding legacy references such as `&#128;` or `#150;` to invisible C1 controls instead of the browser's `€` and `–` ([#15621](https://github.com/can1357/oh-my-pi/pull/15621))
- Fixed macOS `setValue` on native text fields in background apps such as Contacts, Reminders, Calendar, Font Book and System Settings returning success for text the app showed but never stored: it now enters the text the way `win.type` does, and a mismatch names what the field reads ([#15293](https://github.com/can1357/oh-my-pi/pull/15293) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed a macOS desktop session keeping the display awake for the rest of the process after a native request hung; the request's timeout or `close()` now releases it ([#15414](https://github.com/can1357/oh-my-pi/pull/15414) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed the macOS `computer` tool sometimes reading an empty page on its first read of a Chrome window, and leaving Electron apps it read in screen-reader mode until they quit ([#15604](https://github.com/can1357/oh-my-pi/pull/15604) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed macOS `press()` on a scrolled-out row in a Mac Catalyst app reporting success while nothing happened: the element is asked to scroll into view first ([#15607](https://github.com/can1357/oh-my-pi/pull/15607) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed shell builtins on Windows resolving drive-relative paths (`C:`, `C:name`) against the agent process's start directory instead of the shell's working directory, which let `cd /c/Temp/x && rm -rf C:` delete the start directory; `rm` now also refuses a bare drive operand like `.` ([#15511](https://github.com/can1357/oh-my-pi/issues/15511))
- Fixed `renderMermaidAscii` printing character references in labels verbatim: HTML entities (`&lt;`, `&amp;`, `&#60;`, `&#x3C;`) and Mermaid entity codes (`#quot;`, `#60;`) now render as the characters they name ([#15619](https://github.com/can1357/oh-my-pi/issues/15619))
- Fixed `read` and `while read` hanging on process-substitution input ([#15501](https://github.com/can1357/oh-my-pi/issues/15501))
- Fixed standalone binaries extracting unused native addon variants on first launch ([#15462](https://github.com/can1357/oh-my-pi/issues/15462))
- Fixed Git diffs failing when staged or committed changes update a submodule pin ([#15457](https://github.com/can1357/oh-my-pi/issues/15457))
- Fixed `listWorkspace({ reportDirectoryErrors: true, maxDepth: 0 })` returning an empty result for an unreadable root instead of failing the scan ([#15789](https://github.com/can1357/oh-my-pi/pull/15789))
- Minimized cargo output now keeps one "Blocking waiting for file lock on …" line, so a build stuck behind another cargo process says why ([#14631](https://github.com/can1357/oh-my-pi/pull/14631) by [@jorgoose](https://github.com/jorgoose))
- Fixed `grep` ignoring `maxCountPerFile` when the path is a single file, and single-file count mode stopping at the `maxCount` content cap ([#14162](https://github.com/can1357/oh-my-pi/issues/14162), [#14327](https://github.com/can1357/oh-my-pi/pull/14327) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed Windows file-lock contention returning permission errors when an existing lease allows synchronization but not full mutex access ([#15930](https://github.com/can1357/oh-my-pi/pull/15930) by [@jchanghong023](https://github.com/jchanghong023)).
- Fixed SIXEL images dropping translucent details or showing dark, discolored edges when resized, while preserving fully transparent pixels ([#15891](https://github.com/can1357/oh-my-pi/pull/15891) by [@Bouska](https://github.com/Bouska)).

### Breaking Changes

- `encodeSixel` and `encodeSixelAsync` now require a fourth terminal-background RGB argument packed as `0xRRGGBB` ([#15891](https://github.com/can1357/oh-my-pi/pull/15891) by [@Bouska](https://github.com/Bouska)).

### Added

- Added `IpcServer`, `IpcConnection`, and `ipcEndpoint`: a local IPC transport over Unix sockets and Windows named pipes with owner-only access, single-instance binding, stale-endpoint takeover, and newline framing.
- Added in-process `env`, `du`, `chmod`, `fold`, `rmdir`, `od`, `df`, `uptime`, `id`, and `dd` shell builtins matching GNU coreutils 9.x options, output, and exit codes (`chmod` and `id` on Unix only; `dd` is disabled with the destructive set by `PI_DISABLE_UUTILS_DESTRUCTIVE`).
- Added an in-process `nl` shell builtin (ported from uutils coreutils 0.8.0, matching GNU `nl`), with header/body/footer numbering styles including `pBRE` regex styles, logical-page section delimiters, `-l` blank-line grouping, and `ln`/`rn`/`rz` number formats.
- Added `listWorkspace({ reportDirectoryErrors })`: an unreadable root fails the scan and unreadable subdirectories are returned in `unreadableDirectories` instead of being silently skipped ([#15769](https://github.com/can1357/oh-my-pi/issues/15769)).
- Added `parseCodeStatus` to check code syntax and its resolved language without generating a summary ([#15904](https://github.com/can1357/oh-my-pi/pull/15904) by [@iliaal](https://github.com/iliaal)).
- Added `DesktopSession.holdDisplayUntilReleased()` and `releaseDisplayAwake()` to keep the display awake until the caller releases it, rather than for 5 minutes after the last request ([#15762](https://github.com/can1357/oh-my-pi/pull/15762) by [@will-bogusz](https://github.com/will-bogusz))

### Changed

- Optimized transport performance with task-local write coalescing and batch-based newline processing
- Reduced idle memory on GNU/Linux: once native work has been quiet for 5 seconds, freed native heap pages are returned to the OS without evicting caches ([#15905](https://github.com/can1357/oh-my-pi/pull/15905) by [@iliaal](https://github.com/iliaal))
- Reduced memory held by cached code-structure parses: the cache now caps estimated syntax-tree memory instead of source size, keeps only a file's current and previous parse, and reparses edited files incrementally ([#15886](https://github.com/can1357/oh-my-pi/pull/15886) by [@H4vC](https://github.com/H4vC))
- Changed `warmBlockParse` to skip files over 2 MiB (was 4 MiB), the size above which a typical parse no longer fits the cache ([#15886](https://github.com/can1357/oh-my-pi/pull/15886) by [@H4vC](https://github.com/H4vC))
- Changed `encodeSixel` and `encodeSixelAsync` to drop a partial last 6-pixel band, so an image never extends below the requested height and the caller no longer has to shrink it to a multiple of 6 ([#16007](https://github.com/can1357/oh-my-pi/issues/16007))

## [1.2.0] - 2026-10-12

- 版本线推进至 1.2.0；本版无独立用户可见变化。

## [1.1.27] - 2026-10-07

- 版本线推进至 1.1.27；本版无独立用户可见变化。

## [1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- linux-x64/win32-x64 平台二进制随 v18.4.11 源码重编（新增 `commit_tree` 等 vcs 绑定）；版本线对齐。

## [1.1.11] - 2026-09-08

- OMP v18.1.13 + v18.1.14 dual-tag sync baseline; no package-specific user-visible changes.

## [1.1.10] - 2026-09-07

- OMP v18.1.11 sync baseline (`e3106be68f`); no package-specific user-visible changes.

## [1.1.9] - 2026-09-05

- v18.1.10 baseline: new Rust edit engine surface (EditStore/EditSession/DiffStream, editDescription) and hashline mode consolidated into crates/pi-edit; sentinel stays on the Zeta version line.

## [1.1.8] - 2026-09-04

- OMP sync v18.1.2–v18.1.5: pi-vcs index-refresh path (`load_index_or_head`/`status_with_fresh_index`) and natives surface updates.

## [1.1.7] - 2026-09-01

- 同步上游 OMP v18.0.11（`b8ce33a58911c26bed1d84f0db9a5e2e727c49a2`）。

## [1.1.6] - 2026-08-30

- 同步上游 OMP v18.0.10（`33cc6b9a043a`）：新增原生进程替换（支持 CLI `/restart`）与 `VcsGitRepo.mergeBase(a, b)`。
- 修复：加载原生 addon 后 Tokio 共享运行时未安装（loader 调用名与 crate 导出不一致），异步原生操作静默回退默认运行时。

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：新增 rasterizeSvg，SHA-2/SHA-3 ARM64 加速。