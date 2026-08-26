# Changelog

## [Unreleased]

## [1.1.4] - 2026-08-26
## [18.0.6] - 2026-08-26

### Fixed

- Improved TypeScript and TSX syntax highlighting, including correct handling of type annotations and template literals.

## [18.0.5] - 2026-08-25

### Added

- Added asynchronous, size-bounded SVG-to-PNG rasterization for terminal media previews.
- Added the `DiffStream` API for processing text and byte input incrementally, opening files asynchronously, reporting stable-prefix progress, generating exact unified diffs, and warming syntax grammars asynchronously.

## [18.0.3] - 2026-08-23

### Fixed

- `macOSCheckSpelling` no longer reports the whole checked string as misspelled: automatic language identification returns an orthography result spanning the entire text, which leaked through as a typo range overlapping the real word span (doubling editor text under the undercurl and drifting the cursor).

## [18.0.1] - 2026-08-23

### Fixed

- Native macOS spellchecker now honors all active system dictionaries: misspelling detection uses automatic language identification and completions/guesses/corrections select the per-word language, so non-English text (e.g. Russian) is checked instead of only the shared checker's current language ([#9334](https://github.com/can1357/oh-my-pi/issues/9334)).
- Fixed PTY command cancellation leaking zombie child processes: a race where cancellation after spawn only attempted a single non-blocking reap could miss processes still being reaped by the kernel, and an early heartbeat check that bailed out without killing or reaping the child. On Unix, cancellation now polls for the child briefly and hands any straggler to a detached reaper, so the process is always waited on without an unbounded wait.
- Fixed installed CLIs losing desktop capture when the resolved prebuilt addon still exposes the pre-parity `DesktopSession` ABI. That ABI is now adapted behind the current session contract, legacy error codes are translated, and the adapter ships in the published native core package.

## [18.0.0] - 2026-08-22

### Added

- Added native macOS spellchecker APIs (`macOSAutocorrectWord`, `macOSCheckSpelling`, `macOSCompleteWord`, `macOSSpellingGuesses`, and `macOSSpellCheckerAvailable`) that run asynchronously without blocking the JavaScript thread.
- Added `HighlightStream`, a stateful incremental syntax highlighter that supports chunked highlighting while maintaining parser state.
- Added `TtyWriter`, an off-thread terminal output writer that performs non-blocking writes and tracks backlog metrics for renderer frame skipping.

### Changed

- 同步 1.1.4 发布线（与 1.1.3 无功能差异）。

## [1.1.3] - 2026-08-25

### Fixed

- Republished as 1.1.3 to reset the latest tag after the broken 1.1.2 (no functional change over 1.1.1).

## [1.1.2] - 2026-08-25

### Fixed

- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).

## [1.1.1] - 2026-08-25

### Fixed

- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").

## [1.1.0] - 2026-08-25

### Changed

- npm 包 repository 字段指向 linxira-zeta（修正上游 OMP 仓库 URL）。
- 同步上游 OMP v18.0.3 / v18.0.4（native 绑定与构建改进）。

## [1.0.4] - 2026-08-18

### Added

- Restored the `pdfToMarkdown` export in the published npm package. The `@linxiraos/pi-natives@1.0.2` npm publish predated the v17.3.5 merge and shipped neither the export nor the matching native symbol, so npm-installed zeta crashed at load with `SyntaxError: Export named 'pdfToMarkdown' not found`. This release bumps the package (with the `__piNativesV1_0_4` sentinel) so the rebuilt addons and bindings reach npm; omptype/wire stay at 1.0.2.

## [1.0.1] - 2026-08-14

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.

## [1.0.0] - 2026-08-13

### Changed

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.
