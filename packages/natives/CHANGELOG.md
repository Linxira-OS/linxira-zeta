## [Unreleased]

## [1.1.27] - 2026-10-07

- 版本线推进至 1.1.27；本版无独立用户可见变化。
## [18.8.1] - 2026-10-07

### Added

- Added the `PI_NATIVES_DIR` configuration option to control where compiled native addons are extracted. The version-specific subdirectory remains appended, allowing separate `HOME` environments to share the same native addon copy without sharing other data.

### Fixed

- Fixed background shell builtins and other in-process commands so they terminate when their subshell exits and can be stopped with `kill %N`, matching the behavior of external commands.

## [18.7.0] - 2026-10-06

### Breaking Changes

- Renamed the `linux-all` Bazel target (`//:natives-linux-all`) to `all` (`//:natives-all`); the renamed target now includes Darwin addons.
- Removed the `gen:native` and `gen:native:reset` scripts. Standalone binary builds now embed the native addon archive and manifest instead of writing them to `native/`.

### Added

- Enhanced `rasterizeSvg` with optional scaling and terminal-cell padding, allowing SVGs to render larger while preserving 1:1 display in terminals.
- Added `OMP_NATIVE_FEATURES` for passing extra Cargo features to local native addon builds; Bazel builds ignore this setting.
- Added support for cross-compiling macOS native addons from Linux hosts.

### Changed

- macOS addon release stamping now works on any host by refreshing the addon's ad-hoc signature automatically.

### Fixed

- Fixed `tail` failing to print files, or omitting their first 64 KiB, when file sizes were exact multiples of 64 KiB.
- Fixed `tail` printing nothing, or dropping lines from the file's first 64 KiB, when the file size is an exact multiple of 64 KiB ([#14264](https://github.com/can1357/oh-my-pi/pull/14264) by [@jchanghong023](https://github.com/jchanghong023))
- Fixed native `sed` and `jq` killing the host process with SIGBUS when an input file is truncated while they read it ([#14613](https://github.com/can1357/oh-my-pi/issues/14613))
- Fixed `tail -f` piped into a command that exits early (such as `head -n 1` or `grep -m1`) never stopping on macOS ([#14614](https://github.com/can1357/oh-my-pi/issues/14614))
- Native `sort -u` keeps punctuation-distinct paths under UTF-8 locales instead of silently dropping records ([#14606](https://github.com/can1357/oh-my-pi/issues/14606)).

13.16.1] - 2026-03-27

### Added

- Exported `SearchDb` class from main package entry point for direct instantiation
- Added `SearchDb` class for stateful shared search database instances to improve performance across multiple search operations
- Added optional `db` parameter to `grep()`, `glob()`, and `fuzzyFind()` functions to enable database-backed searching

### Changed

- Updated `grep()`, `glob()`, and `fuzzyFind()` function signatures to accept optional `db` parameter for database-backed searching

## [13.12.0] - 2026-03-14

### Breaking Changes

- Changed `abort()` method signature: removed optional `reason` parameter and changed return type from `void` to `Promise<void>`

## [13.4.0] - 2026-03-01

### Breaking Changes

- Changed `AstFindOptions.pattern` to `patterns` (now accepts array of strings instead of single string)
- Replaced `AstReplaceOptions.pattern` and `rewrite` with single `rewrites` option (Record<string, string>)

### Added

- `astGrep` now accepts multiple patterns in a single call; results from all patterns are merged and sorted by file path then position before offset/limit are applied
- `astEdit` now accepts a `rewrites` map (`Record<string, string>`) and applies all patterns per file in a single pass, compiling them once upfront
- Result ordering in `astGrep` is now deterministic: sorted by path, line, column using `BTreeSet`/`BTreeMap`

## [13.3.8] - 2026-02-28

### Added

- Added `astFind()` function for structural code search using AST patterns with support for language-specific matching, selectors, and meta-variable extraction
- Added `astReplace()` function for structural code rewriting with dry-run mode, replacement limits, and parse error handling
- Added `./ast` export path for accessing AST search and rewrite functionality

## [12.18.0] - 2026-02-21

### Changed

- Replaced custom `TextDecoder` usage with native `toString('utf-8')` for buffer decoding
- Replaced custom debug logging with structured `logger.time()` calls for startup performance tracking

## [12.17.1] - 2026-02-21

### Added

- Expanded package exports to support subpath imports for clipboard, glob, grep, highlight, html, image, keys, ps, pty, shell, text, and work modules
- Added wildcard export patterns (`./*`) for all submodules to enable flexible import paths

### Changed

- Updated package description to clarify native bindings for grep, clipboard, image processing, syntax highlighting, PTY, and shell operations
- Expanded package keywords to include clipboard, image, pty, shell, and syntax-highlighting for better discoverability
- Added README.md to package distribution files

## [12.10.0] - 2026-02-18

### Changed

- Updated addon filename resolution to include default filename fallback in both modern and baseline variant paths

## [12.8.2] - 2026-02-17

### Breaking Changes

- Removed `getSystemInfo()` and `SystemInfo` from package exports, breaking consumers that imported system info APIs from this package

## [12.8.0] - 2026-02-16

### Added

- Added support for x64 CPU variant selection with `TARGET_VARIANT` environment variable (modern/baseline) during build to optimize for specific ISA levels
- Added automatic AVX2 detection on Linux, macOS, and Windows to select optimal native addon variant at runtime
- Added `PI_NATIVE_VARIANT` environment variable to override CPU variant selection at runtime
- Added support for multiple native addon variants per platform (modern with AVX2, baseline without AVX2) for improved performance portability

### Changed

- Changed native addon filename scheme to include CPU variant suffix for x64 builds (e.g., `pi_natives.linux-x64-modern.node`)
- Changed embedded addon structure to support multiple variant files per platform instead of single file
- Changed native addon loader to automatically select appropriate variant based on CPU capabilities or explicit override
- Changed build output to include variant information in console messages

### Removed

- Removed fallback untagged `pi_natives.node` binary creation for native builds; platform-tagged variants are now required

### Fixed

- Fixed regex patterns containing literal braces (e.g. `${platform}`) failing with "repetition quantifier expects a valid decimal" by escaping `{`/`}` that don't form valid repetition quantifiers

## [12.5.0] - 2026-02-15

### Added

- Added `recursive` option to `GlobOptions` to control whether simple patterns match recursively (defaults to true)

### Changed

- Changed default glob pattern behavior to always use recursive matching for simple patterns instead of requiring explicit `**/` prefix
- Updated `fileType` filter documentation to clarify that symlinks match file/dir filters based on their target type

## [12.4.0] - 2026-02-14

### Added

- Exported `sanitizeText` function to strip ANSI codes, remove binary garbage, and normalize line endings in text output

## [12.1.0] - 2026-02-13

### Added

- Added `cache` option to `glob()`, `grep()`, and `fuzzyFind()` to enable shared filesystem scan caching
- Added `invalidateFsScanCache()` function to manually invalidate filesystem scan cache entries

## [11.14.0] - 2026-02-12

### Added

- Added `PtySession` class for PTY-backed interactive command execution with streaming output
- Added `PtyStartOptions` interface to configure pseudo-terminal sessions with command, working directory, environment variables, and terminal dimensions
- Added `PtyRunResult` interface to report command exit code, cancellation, and timeout status
- Added `write()` method to send raw input to PTY stdin
- Added `resize()` method to dynamically adjust PTY column and row dimensions
- Added `kill()` method to force-terminate active commands

## [11.3.0] - 2026-02-06

### Added

- OSC 52 fallback for clipboard operations over SSH/mosh connections
- Termux support with `termux-clipboard-set` integration
- Headless environment guards to prevent clipboard errors when no display server is available
- Async clipboard API with improved error handling and fallback strategies

### Changed

- OSC 52 clipboard emission now only occurs in real terminal environments (when stdout is a TTY), preventing unnecessary output in piped or headless contexts
- Improved error handling for OSC 52 writes to gracefully handle EPIPE errors when stdout is closed or piped to processes that exit early
- Clipboard functions now return promises for better async handling
- Native clipboard operations are now best-effort with graceful degradation

## [11.0.0] - 2026-02-05

### Removed

- Removed legacy type aliases `WasmMatch` and `WasmSearchResult`

## [10.6.0] - 2026-02-04

### Changed

- Added separate grep context before/after options in bindings

## [10.2.2] - 2026-02-02

### Added

- Exported `getWorkProfile` function and `WorkProfile` type for work profiling capabilities

## [10.2.0] - 2026-02-02

### Breaking Changes

- Replaced `find()` with `glob()` - update imports and function calls
- Changed file type filtering from string values to `FileType` enum
- Removed `abortShellExecution()` function - use `Shell.abort()` method instead
- Removed `RequestOptions` parameter from `htmlToMarkdown()` - pass options directly

### Added

- Added `glob()` function for file discovery with glob pattern matching and .gitignore support
- Added `Cancellable` interface for timeout and abort signal support across async operations
- Added `FileType` enum to filter glob results by file type (File, Dir, Symlink)
- Added `signal` parameter to shell operations for cancellation via AbortSignal

### Changed

- Renamed `find()` to `glob()` for file discovery operations
- Renamed `FindMatch` to `GlobMatch` and `FindOptions` to `GlobOptions`
- Moved timeout and abort signal handling into unified `Cancellable` interface across grep, glob, and shell modules
- Updated `Shell.abort()` to accept optional abort reason parameter
- Simplified `htmlToMarkdown()` signature by removing `RequestOptions` parameter

### Removed

- Removed `RequestOptions` type and `wrapRequestOptions()` utility function
- Removed `abortShellExecution()` function; use `Shell.abort()` instead
- Removed `executionId` parameter from `ShellExecuteOptions`

## [10.1.0] - 2026-02-01

### Breaking Changes

- Changed `executionId` parameter type from `string` to `number` in `abortShellExecution()` and `ShellExecuteOptions`
- Removed `sessionKey` field from `ShellExecuteOptions`

### Added

- Added `getWorkProfile()` function to retrieve work scheduling profiling data from a circular buffer of recent activity
- Added `WorkProfile` type with folded stack format, markdown summary, SVG flamegraph, and sample metrics for profiling results

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
