# Changelog

## [Unreleased]

- 版本线推进至 1.1.27；本版无独立用户可见变化。

## [1.1.27] - 2026-10-06

- 版本线推进至 1.1.27；本版无独立用户可见变化。

## [14.9.9] - 2026-05-12

### Breaking Changes

- Removed `projfsOverlayProbe`, `projfsOverlayStart`, and `projfsOverlayStop` overlays APIs and `ProjfsOverlayProbeResult` type from the public natives interface

### Added

- Added unified isolation APIs `isoBackend`, `isoProbe`, `isoResolve`, `isoStart`, `isoStop`, `isoDiff`, and `isoIsUnavailableError` for selecting, probing, resolving, starting, stopping, and diffing isolated filesystems
- Added `IsoBackendKind`, `IsoChangeKind`, `IsoDiff`, `IsoFileChange`, `IsoProbeResult`, and `IsoResolveResult` type exports to describe isolation backend capabilities and diff outcomes

### Changed

- Changed `native` exports to remove the platform-specific ProjFS-only overlay surface in favor of generic isolation controls

## [14.9.5] - 2026-05-12

### Fixed

- Fixed shell cancellation occasionally killing the harness. The `pi_shell` descendant tracker harvested every descendant's `pgid` into the kill set, so any subprocess that inherited the harness's pgid (any helper spawned via APIs that do not call `setpgid` — sibling LSP/MCP processes, etc.) dragged `harness.pgid` into the list and the follow-up `kill(-harness.pgid, SIGTERM)` terminated the harness alongside the targets. The classifier now only adopts a `pgid` when its leader is itself one of the new descendants, and `kill_process_group` refuses the harness's own process group as a last-line defense.
- Fixed macOS process-tree termination silently doing nothing. The descendant walk relied on `proc_listchildpids`, which on recent darwin kernels (25.4+) returns no entries when a process queries its own children, so `Process::descendants` came back empty and tree-kill cleanup never reached grandchildren. The walk now builds a one-shot `ppid → [pid]` map from `proc_listallpids` + `proc_pidinfo`, matching the approach already used by `find_by_path` and the Windows Toolhelp path.

### Changed

- Removed the 20 Hz background descendant tracker that scanned the harness's process tree for the entire lifetime of every shell command. Cancellation now does a small rescan-and-signal loop on demand (up to three waves — SIGTERM, then SIGKILL, then SIGKILL — with early exit as soon as no descendants remain). The previous tracker existed to pin process identities against PID reuse races, but `Process::from_pid` already pins identity by kernel start time / pidfd, so the constant scanning paid for nothing and added meaningful syscall load on macOS where each scan now does `proc_listallpids` + `proc_pidinfo` per pid.

## [14.9.3] - 2026-05-10

### Added

- Added `idle`, `system`, and `user` options to `MacOSPowerAssertion` so callers can request specific macOS sleep-prevention modes (`caffeinate -i`, `-s`, and `-u`) in addition to the existing `display` option
- Added support for combining multiple macOS power assertion flags in a single `MacOSPowerAssertion` handle

### Changed

- Changed `MacOSPowerAssertion.stop()` documentation to indicate it releases all held assertions and is safe to call repeatedly as a no-op

## [14.9.2] - 2026-05-10

### Added

- Added `listWorkspace`, a native single-pass workspace walker that returns bounded tree entries and AGENTS.md directory-context candidates together.

## [14.7.1] - 2026-05-06

### Added

- Added `size` property to `GlobMatch` for regular files to expose their byte size

### Changed

- Sped up native `grep` files-with-matches searches by stopping after the first match per file, reading small files without mmap overhead, and relying on grep-searcher binary detection instead of a separate full-file NUL scan.

### Fixed

- Fixed native `grep` `filesWithMatches` mode so `totalMatches` reports the number of matching files rather than line-match totals
- Fixed native `grep` count-mode limits applying to files instead of matches, and restored timeout/abort cancellation checks for small native filesystem scans.

## [14.7.0] - 2026-05-04

### Added

- Added `summarizeCode` function to expose native code summarization with `kind`, `startLine`, `endLine`, and optional `text` segments plus parse/elision metadata
- Added `minBodyLines` and `minCommentLines` options to `summarizeCode` to control when function/body and multiline comment elision is applied
- Added `SummaryOptions` and `SummaryResult` TypeScript definitions for typed `summarizeCode` input and output

## [14.6.1] - 2026-05-02

### Changed

- Changed the native package loader from CommonJS analyzer-visible assignments to a template-rendered ESM entry point with explicit named exports

## [14.5.13] - 2026-05-01

### Changed

- Stopped overriding `CARGO_TARGET_DIR` with an internal `target/napi-build/...` directory during native builds, so Cargo now uses the default or caller-provided target directory
- Simplified native build profile suffix formatting without changing `local` and `ci` values
- Changed the native build output behavior to avoid setting an isolated Cargo target directory automatically

### Removed

- Removed the host Zig CPU contract wrapper (`zig-safe-wrapper.ts`) and its `ZIG`/`PI_NATIVE_REAL_ZIG`/`PI_NATIVE_ZIG_TARGET`/`PI_NATIVE_ZIG_CPU` env handling, since the `zlob` Rust dependency that required Zig is gone
- Removed the `ci-release-verify-natives` script and its AVX-512 marker scan from the release pipeline

## [14.5.12] - 2026-04-30

### Breaking Changes

- Changed `waitForExit` to accept a single options object instead of a numeric timeout argument

### Added

- Added a `signal` option to `terminate` for cancelling termination while waiting for process shutdown
- Added abort `signal` support to `waitForExit` via `ProcessWaitOptions`
- Added a `ProcessWaitOptions` type and updated `waitForExit` to accept an options object

## [14.5.9] - 2026-04-30

### Fixed

- Fixed shell minimizer output so successful commands whose noise is fully stripped still return `OK` instead of an artifact-only result

## [14.5.6] - 2026-04-29

### Added

- Added shell minimizer support for CMake, CTest, Ninja, GoogleTest binaries, and Bun/Bunx wrappers that run those tools

## [14.5.2] - 2026-04-26

### Changed

- Changed local native build profile from `dev` to `local` for non-CI builds, updating the profile used by the build and local build output label

## [14.4.2] - 2026-04-26

### Removed

- Removed the `chunk` napi module (`ChunkState`, chunk schema, chunk rendering, chunk edit) and dropped `generate_chunk_schema()` from the build script

## [14.3.0] - 2026-04-25

### Added

- Added `text` to `MinimizerResult` so consumers can replace rewritten output with the minimized replacement text
- Added `settingsHash` to `MinimizerOptions` to verify the minimizer `settingsPath` contents against a xxHash64 digest before applying them
- Added `minimized` output telemetry via `MinimizerResult` on `ShellExecuteResult` and `ShellRunResult`, exposing the applied minimizer filter and original/minimized byte counts when output is rewritten
- Added a new `minimizer` option to `ShellExecuteOptions` and `ShellOptions` to configure per-command output minimization
- Added the `MinimizerOptions` API with controls for enabling minimization, overriding settings via `settingsPath`, allow/deny lists (`only`, `except`), and `maxCaptureBytes` capture limits

### Changed

- Changed the shell output minimizer to more aggressively compact successful test runs, git output, large listings, grep/find results, source reads, and dependency manifests
- Changed compound and piped shell commands to bypass output minimization entirely, keeping minimization limited to eligible whole-command output after the command exits

### Fixed

- Fixed chunk edit batches so later operations can reuse an initially validated checksum after an earlier operation changes that same chunk

### Removed

- Removed `PI_DEV` loader diagnostic env var and associated console logging in the native addon loader

### Security

- Added trust-gated loading for minimizer settings by requiring a matching `settingsHash` before accepting a settings file

## [14.2.0] - 2026-04-23

### Added

- Added Dart support to `astGrep` and `astEdit` through the native tree-sitter Dart grammar ([#748](https://github.com/can1357/oh-my-pi/pull/748) by [@0fflineuser](https://github.com/0fflineuser))

## [14.1.1] - 2026-04-14

### Added

- Added support for honoring the `ZIG` environment variable when resolving the Zig executable for native builds

### Removed

- Removed the `SearchDb` API from the natives type declarations
- Removed the optional `db` parameter from `fuzzyFind`, `glob`, and `grep`
- Removed the `fuzzyFind`, `glob`, and `grep` cache database argument previously used for search state

## [14.0.5] - 2026-04-11

### Breaking Changes

- Made `tabWidth` parameter required (no longer optional) for `visibleWidth`, `truncateToWidth`, `wrapTextWithAnsi`, `sliceWithWidth`, and `extractSegments`
- Removed `getIndentation`, `getDefaultTabWidth`, and `setDefaultTabWidth` (moved to `@linxiraos/pi-utils`)
- `visibleWidth`, `truncateToWidth`, `wrapTextWithAnsi`, `sliceWithWidth`, and `extractSegments` now require an explicit `tabWidth` argument

## [14.0.4] - 2026-04-10

### Added

- Added `normalizeIndent` option to `EditParams` to control indentation normalization for response rendering and inserted content
- Added `hasConflicts()` method to detect unresolved merge conflicts in parsed files
- Added `conflictCount()` method to count unresolved merge conflicts in the chunk tree

## [14.0.2] - 2026-04-09

### Added

- Added `Decl` variant to `ChunkRegion` enum for accessing semantic declarations without leading trivia
- Added `check:types` script for explicit TypeScript type checking
- Added `lint` script for running Biome linter
- Added `fmt` script for code formatting with Biome
- Added package exports field with typed entry point configuration
- Added turbo.json configuration for build task caching and optimization

### Changed

- Renamed `build:native` script to `build` for simpler invocation
- Updated `check` script to separately call `check:types` for type checking
- Modified tsconfig.json to extend `tsconfig.workspace.json` instead of `tsconfig.base.json`

## [14.0.0] - 2026-04-08

### Breaking Changes

- Changed `ChunkRegion.Inner` enum value to `ChunkRegion.Body` to align with region semantics
- Changed `ChunkRegion` enum values from `Container`, `Prologue`, `Body`, `Epilogue` to `Head`, `Inner`, `Tail` with updated semantics for region targeting
- Replaced `ChunkEditOp` enum values — `AppendChild`, `PrependChild`, `AppendSibling`, `PrependSibling`, and `ReplaceBody` are now `Before`, `After`, `Prepend`, and `Append` with updated semantics for region-scoped operations
- Removed `ReplaceBody` operation — use `Replace` with `region: ChunkRegion.Body` to replace only chunk body content
- Moved package entry point from `src/index.ts` to `native/index.js` — consumers must update imports to use the new native module path
- Removed TypeScript source files from `src/` directory — all APIs now exported from auto-generated `native/index.js` with types in `native/index.d.ts`
- Changed enum exports to runtime objects — `const enum` values are now available at runtime via generated enum exports in `native/index.js`

### Added

- Added `ChunkRegion` enum with `Container`, `Prologue`, `Body`, and `Epilogue` values for targeting specific regions within chunks
- Added `region` parameter to `EditOperation` to specify which chunk region to target (defaults to `Container`)
- Added `UnsupportedRegion` status to `ChunkReadStatus` enum to indicate when a chunk does not support the requested region
- Added `normalizeIndent` parameter to `RenderParams` and `ReadRenderParams` to normalize displayed indentation to canonical tabs
- Added `ReplaceBody` chunk edit operation to replace only the inner body of a chunk while preserving signature and closing delimiter
- Added `ChunkFocusMode` enum with `Expanded`, `Collapsed`, and `Container` modes for controlling chunk participation in focus-scoped render passes
- Added `FocusedPath` interface to pair paths with focus modes for the N-API boundary
- Added `focusedPaths` parameter to `RenderParams` to restrict rendering to specified chunks with their focus modes
- Generated native module bindings in `native/index.js` and `native/index.d.ts` from napi-rs build output
- Added `gen-enums.ts` script to extract and export runtime enum values from TypeScript const enums
- Added `embedded-addon.js` for managing embedded native addon variants and metadata
- Added `MacOSPowerAssertion` for session-scoped macOS idle-sleep prevention without shelling out

### Changed

- Changed `ChunkInfo.name` field to optional `identifier` field — now provides bare chunk identifier without kind prefix instead of display name
- Updated `region` parameter documentation in `EditOperation` to clarify full chunk targeting when omitted instead of container-scoped default
- Updated `ChunkEditOp` documentation to reflect region-scoped semantics — operations now target specific regions rather than chunk structure positions
- Changed `ChunkEditOp.Replace` documentation to clarify substring replacement via `find` parameter instead of line-based replacement
- Changed `EditOperation` interface to use `find` parameter for scoped find/replace operations instead of `line` and `endLine` parameters
- Changed `EditParams` documentation to remove mention of scheduling reordering for line-scoped groups
- Simplified native build pipeline by removing `--dev` flag support; debug builds no longer available through npm scripts
- Updated native module loader to check `XDG_DATA_HOME` environment variable for native addon location before falling back to `~/.zeta/natives`
- Removed native binding validation function that checked for required exports at load time
- Refactored build pipeline to use napi-rs generated bindings instead of hand-written TypeScript wrappers
- Updated `build-native.ts` to generate runtime enum exports after native compilation
- Updated `embed-native.ts` to output JavaScript instead of TypeScript for embedded addon metadata

### Removed

- Removed `dev:native` npm script — use `build:native` for all build scenarios
- Removed inline pi-utils helpers and dependency on `@linxiraos/pi-utils` from native module loader
- Removed `logger.time()` wrapper calls from native module loading
- Removed all TypeScript wrapper modules from `src/` directory (appearance, ast, chunk, clipboard, glob, grep, highlight, html, image, keys, projfs, ps, pty, shell, text, work)
- Removed `src/bindings.ts` and `src/index.ts` entry points
- Removed `src/search-db.ts` and `src/search-db-types.ts`

## [13.16.1] - 2026-03-27

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

## [1.1.27] - 2026-10-06

### Breaking Changes

- `isoResolve` now returns a Promise and runs off the JavaScript thread; a backend found available is not re-probed ([#14528](https://github.com/can1357/oh-my-pi/pull/14528) by [@H4vC](https://github.com/H4vC))

### Added

- Added `warmBlockParse`, which parses a file for block context off the JavaScript thread so later block-context lookups answer from the cache; files over 4 MiB, which the cache does not keep, are skipped ([#14520](https://github.com/can1357/oh-my-pi/pull/14520) by [@H4vC](https://github.com/H4vC))
- Added native screenshot region capture without replacing the full-frame coordinate reference, native cancellation generations, and cross-process input/focus ownership.
- Added operation-scoped physical Escape cancellation on macOS.
- Added native application discovery/launch, background menus, combined image/AX observations, display targets, bounded held input, task control ownership, and macOS Space movement.

### Changed

- Replaced per-screenshot macOS subprocesses and intermediate PNGs with a persistent ScreenCaptureKit main-loop worker on macOS 14+ and in-process CoreGraphics on macOS 12/13.
- Read macOS window metadata from one coherent Quartz snapshot instead of re-enumerating the desktop for each window property.
- Defaulted desktop capture to the focused window's monitor, retaining explicit all-display and display-ID selection.
- Removed legacy desktop-addon emulation; computer use now requires the current native capture/cancellation API.
- Sped up the embedded shell on command output that is not valid UTF-8: decoding is linear, so commands printing binary data no longer stall (1 MiB took 14 s), and captured output is decoded once ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Sped up edit previews while edit arguments stream: diffs, fuzzy matching and hashline parsing no longer redo or copy all their work for every streamed chunk ([#14520](https://github.com/can1357/oh-my-pi/pull/14520) by [@H4vC](https://github.com/H4vC))
- Sped up `fuzzyFind`: a cached scan is scored in place instead of being copied on every call ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Sped up applying multi-hunk patches and `astEdit` calls with many edits ([#14521](https://github.com/can1357/oh-my-pi/pull/14521) by [@H4vC](https://github.com/H4vC))
- Sped up `countTokens` on long runs of one kind of character, such as whitespace or letters ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Sped up builtins that print many lines (`ls`, `find`, `paste`, `diff`, `cmp`, `wc`, `echo`, `ts`), `while read` and `mapfile` loops over files, and `sed` scripts using `N` ([#14522](https://github.com/can1357/oh-my-pi/pull/14522) by [@H4vC](https://github.com/H4vC))
- Sped up flowchart and state diagram rendering in `renderMermaidAscii`; a 40-node flowchart renders about 14× faster, with identical output ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Sped up `find -type`, `rm -r`, `mkdir -p`, `ls` and `stat`, especially on Windows ([#14523](https://github.com/can1357/oh-my-pi/pull/14523) by [@H4vC](https://github.com/H4vC))
- Sped up `sed` scripts that use regular expressions, `printf` output, and `sort -`, which now reads standard input directly instead of copying it to a temporary file ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Sped up `cp` and `mv` of directory trees; `mv` within one filesystem no longer walks the moved tree first ([#14524](https://github.com/can1357/oh-my-pi/pull/14524) by [@H4vC](https://github.com/H4vC))
- Staging files or hunks keeps the git index's file stat cache, so the next status check no longer re-reads every tracked file; staging many files rewrites the index once ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- `pidwait` and PTY sessions wait for process exit and cancellation events instead of polling ([#14526](https://github.com/can1357/oh-my-pi/pull/14526) by [@H4vC](https://github.com/H4vC))
- Applying a patch to the worktree reads only the files the patch touches ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Sped up `listWorkspace`, `fuzzyFind` with followed symlinks, and `fd`; the file-mention scan cache releases expired entries sooner ([#14527](https://github.com/can1357/oh-my-pi/pull/14527) by [@H4vC](https://github.com/H4vC))
- Sped up parsing of large hashline edits ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Sped up copy-on-write task isolation setup on reflink (Linux) and ReFS (Windows) volumes ([#14528](https://github.com/can1357/oh-my-pi/pull/14528) by [@H4vC](https://github.com/H4vC))
- `Process.waitForExit()` on a single process waits for the operating system's exit notification instead of polling every 50 ms ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Reduced memory and copying in `renderMermaidAscii`, snapcompact rendering and single-display desktop screenshots ([#14529](https://github.com/can1357/oh-my-pi/pull/14529) by [@H4vC](https://github.com/H4vC))
- `DesktopSession.capabilities` no longer blocks behind a running capture or input operation: while one runs, it answers from the capabilities read by the latest capture or capabilities call; otherwise it reads them live ([#14529](https://github.com/can1357/oh-my-pi/pull/14529) by [@H4vC](https://github.com/H4vC))
- Native OAuth logins are detected as soon as the browser redirects, without polling every 20 ms ([#14531](https://github.com/can1357/oh-my-pi/pull/14531) by [@H4vC](https://github.com/H4vC))
- Reduced the memory used by the local completion model's tokenizer ([#14533](https://github.com/can1357/oh-my-pi/pull/14533) by [@H4vC](https://github.com/H4vC))
- Long lines cut by the lint, gt and system output minimizers now end in `…[+N]`, showing how many characters were dropped ([#14532](https://github.com/can1357/oh-my-pi/pull/14532) by [@H4vC](https://github.com/H4vC))
- Reduced the memory used by tokenizer tables and by counting Claude tokens on long inputs ([#14530](https://github.com/can1357/oh-my-pi/pull/14530) by [@H4vC](https://github.com/H4vC))

### Fixed

- Rejected stale display-layout coordinates before pointer input and zoom, and preserved the previous coordinate frame when a capture is canceled.
- Released held input on cancellation and refused competing native mutations before dispatch.
- Fixed `umask` in the embedded shell changing the host process's umask; the mask now belongs to the shell, applies to files created by redirections, builtins such as `touch`, `mkdir` and `cp`, and external commands, and a subshell's `umask` no longer leaks out ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Fixed diff hunk headers sometimes naming a different enclosing function than `git diff` does ([#14521](https://github.com/can1357/oh-my-pi/pull/14521) by [@H4vC](https://github.com/H4vC))
- Fixed `enable exec` and `enable suspend` restoring builtins that replace or stop the host process ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Fixed `ls -t` and `ls -S` listing entries with equal times or sizes in arbitrary order, and `ls --group-directories-first` scrambling entries within each group; ties now sort by name as in GNU `ls` ([#14523](https://github.com/can1357/oh-my-pi/pull/14523) by [@H4vC](https://github.com/H4vC))
- Fixed `rm -r` and `rm -d` on Windows failing on a directory that has the read-only attribute ([#14523](https://github.com/can1357/oh-my-pi/pull/14523) by [@H4vC](https://github.com/H4vC))
- Fixed `declare -r` listing only readonly variables that were also traced, and `declare -t` listing every variable ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Fixed `sed` regular expressions treating `\b` as a backspace instead of a word boundary ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Fixed `mv` between filesystems losing modification times, modes, ownership, subdirectory extended attributes and hard links, failing on sockets, and removing source symlinks when copying an entry failed ([#14524](https://github.com/can1357/oh-my-pi/pull/14524) by [@H4vC](https://github.com/H4vC))
- Fixed `sort` reading standard input again for each repeated `-` operand ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Fixed `sort` collating text only on its first run in a session and taking its collation order, decimal point and thousands separator from omp's own locale instead of the shell's `LC_ALL`, `LC_COLLATE`, `LC_NUMERIC` and `LANG`, and `sort --parallel` changing the host's thread pool: `--parallel=N` now limits that sort to N threads and rejects invalid counts as GNU sort does ([#14525](https://github.com/can1357/oh-my-pi/pull/14525) by [@H4vC](https://github.com/H4vC))
- Fixed `tac` crashing omp when the file it read was truncated at the same time ([#14525](https://github.com/can1357/oh-my-pi/pull/14525) by [@H4vC](https://github.com/H4vC))
- Fixed `tail -f` piped into a command that exits early (such as `grep -m1`) never stopping, including when following provider-backed paths ([#14525](https://github.com/can1357/oh-my-pi/pull/14525) by [@H4vC](https://github.com/H4vC))
- Fixed run cancellation on Windows terminating an unrelated older process when the cancelled command reused the process ID of that process's exited parent ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Fixed staging hunks and stashing clearing the index's skip-worktree flags, so files outside a sparse checkout no longer show as deleted afterwards ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Fixed the `psql` output minimizer listing every table row whose first column began with a word like `ERROR` above the table, instead of applying the row limit ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Fixed a PTY command hanging forever when its output callback stopped consuming output; the bridge now disconnects after the stall timeout like the shell bridge ([#14526](https://github.com/can1357/oh-my-pi/pull/14526) by [@H4vC](https://github.com/H4vC))
- Fixed `Process.args()` on Windows returning an empty list for elevated processes when the caller is not elevated ([#14526](https://github.com/can1357/oh-my-pi/pull/14526) by [@H4vC](https://github.com/H4vC))
- Fixed strings passed to native functions sometimes losing their last characters when they ended in non-ASCII text (seen as `highlightCode` dropping the end of long lines) ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Fixed `renderMermaidAscii` hanging and running out of memory on an `xychart` axis whose range is finer than floating-point precision ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Fixed copied task isolation trees on Windows turning directory symlinks into file symlinks ([#14528](https://github.com/can1357/oh-my-pi/pull/14528) by [@H4vC](https://github.com/H4vC))
- Fixed `getWorkProfile()` attributing async work to the wrong region or dropping it ([#14454](https://github.com/can1357/oh-my-pi/pull/14454) by [@H4vC](https://github.com/H4vC))
- Fixed `read` and `mapfile` in the embedded shell treating Ctrl-C and Ctrl-D bytes in a file or pipe as an interrupt or end of input (`printf 'a\003b\n' | read -r x` failed, `printf '\004x\n' | mapfile` stored nothing); they are keys only when standard input is a terminal ([#14522](https://github.com/can1357/oh-my-pi/pull/14522) by [@H4vC](https://github.com/H4vC))
- Fixed `read` storing each byte of UTF-8 input as a separate character (`é` became `Ã©`); `read -n` and `read -N` now count characters instead of bytes, as bash does ([#14522](https://github.com/can1357/oh-my-pi/pull/14522) by [@H4vC](https://github.com/H4vC))
- Fixed `read -d` with a multibyte delimiter never matching; it stops at the delimiter's first byte, as bash does ([#14522](https://github.com/can1357/oh-my-pi/pull/14522) by [@H4vC](https://github.com/H4vC))
- Fixed `echo -e -E` expanding escapes; the later option wins, as in bash ([#14522](https://github.com/can1357/oh-my-pi/pull/14522) by [@H4vC](https://github.com/H4vC))
- Fixed `mapfile -O` writing into a readonly array; it now fails before reading any input, as bash does ([#14522](https://github.com/can1357/oh-my-pi/pull/14522) by [@H4vC](https://github.com/H4vC))
- Fixed `computer` element refs expiring after two `ax()` reads of a window while the element was still there: an element now keeps its `[ref=eN]` across `ax()` and `find()` reads, even after missing a single snapshot. An element whose role or label changes gets a new ref, and its old ref keeps working until it expires; on Windows, an element that reuses a gone element's `RuntimeId` gets a new ref, and one whose `RuntimeId` cannot be read gets a new ref on every read ([#14485](https://github.com/can1357/oh-my-pi/pull/14485) by [@will-bogusz](https://github.com/will-bogusz))

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
