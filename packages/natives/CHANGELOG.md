## [Unreleased]

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

- Added automatic extraction of embedded native addon to `~/.zeta/natives/<version>` on first run for compiled binaries
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
- Embedded native addon payload for compiled binaries and extract to `~/.zeta/natives/<version>` on first run

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
