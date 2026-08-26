# Changelog

## [Unreleased]

## [1.1.4] - 2026-08-26
## [18.0.6] - 2026-08-26

### Added

- Added conventional commit generation with support for dependency, security, configuration, UX, and infrastructure commit types, plus configurable caching and large-diff analysis behavior.

## [18.0.5] - 2026-08-25

### Added

- Added `stableStringifyJson` for deterministic serialization of nested JSON-shaped data.

### Fixed

- Fixed managed Chrome-for-Testing installation failures when extracting the trusted browser download.

## [18.0.4] - 2026-08-24

### Added

- Exported `getAvatarCacheDir` to resolve the avatar cache directory path.

## [18.0.1] - 2026-08-23

### Fixed

- Fixed the Mermaid ASCII renderer throwing on left-to-right diagrams containing a `subgraph`, which made the fenced block fall back to raw source in the terminal. `offsetDrawingForSubgraphs` shifts every drawing coordinate to make room for subgraph borders that extend past the origin, but the canvas had already been sized from the pre-shift grid extents, so edges routed to the outermost column wrote past the allocation and `drawLine` threw on the missing column. The canvas and role canvas now grow by the same shift. ([#9340](https://github.com/can1357/oh-my-pi/issues/9340))
- Fixed child shell environments inheriting Bun-autoloaded `.env.<mode>.local` values from the launch directory. ([#9290](https://github.com/can1357/oh-my-pi/issues/9290))

## [17.4.2] - 2026-08-21

### Fixed

- Made malformed advanced-serialization frames from a worker subprocess non-fatal: Bun surfaces an undecodable IPC frame as a process-level `uncaughtException` in the parent (oven-sh/bun#37287), which the postmortem handler treated as fatal and tore down every active session and subagent. The handler now recognizes the decode failure and, keeping the session alive, faults the active advanced-IPC worker subsystems so their clients reject in-flight requests and recycle the subprocess instead of awaiting forever — mirroring the existing ipc-send EPIPE containment. ([#9158](https://github.com/can1357/oh-my-pi/issues/9158))

## [17.4.1] - 2026-08-21

### Added

- New unified archive API `@linxiraos/pi-utils/ar`, providing an `openArchive`/`ArchiveReader` interface across formats (including ZIP/ZIP64, tar with gz/bz2/xz/zst compression, ASAR, RAR 4/5, 7z, ISO 9660, CAB, cpio, RPM, Unix ar, Debian packages, LZH, ARJ, and single-stream compressed files) with lazy ranged reads for local files or HTTP range requests via `httpByteSource`, size limits, symlink-safe extraction, and deterministic archive creation for zip, tar, tar.gz, tar.zst, and asar.

## [17.3.8] - 2026-08-19

### Added

- Exported `BINARY_SNIFF_BYTES`, the header window `isProbablyBinary` sniffs, so a caller holding the whole file in memory can classify the identical prefix through `isProbablyBinaryHeader` instead of reopening the file.

## [17.3.5] - 2026-08-16

### Fixed

- Fixed the Markdown renderer incorrectly breaking into a raw code block when a 4-space-indented line (such as a box-drawing tree child under a └── branch) directly followed paragraph text; it now correctly stays part of the paragraph, matching standard Markdown behavior.

## [17.3.2] - 2026-08-13

### Fixed

- Fixed `fetchWithRetry()` aborts during retry backoff to preserve the documented `"Request was aborted"` error contract ([#8450](https://github.com/can1357/oh-my-pi/issues/8450)).

## [17.3.0] - 2026-08-13

### Fixed

- Optimized performance of partial JSON parsing for long streaming tool-call arguments.
- Fixed Mermaid ASCII multi-word edge labels where routed lines would show through spaces.

## [17.2.15] - 2026-08-12

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

- 同步上游 OMP v18.0.3 / v18.0.4（内部运行时与构建改进，无独立用户可见变更）。

## [1.0.0] - 2026-08-13

### Changed

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.
