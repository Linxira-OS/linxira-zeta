# Changelog

## [Unreleased]

## [1.1.5] - 2026-08-26
## [18.0.9] - 2026-08-28

### Fixed

- Fixed error handling so unrelated aborted requests and closed-connection failures are no longer silently suppressed.

## [18.0.8] - 2026-08-27

### Added

- Added the Linux `subreaper` spawn option to retain reparented descendants for process-tree cleanup.

### Fixed

- Keep project-directory state unchanged when changing directories fails.
- Fixed `ptree` timeout cleanup and output capture so timed commands retain their deadline through descendant-held pipes and untimed commands read output to EOF.

## [18.0.7] - 2026-08-26

### Added

- Added `math-delimiters`, the LaTeX span/block delimiter grammar (`mathStartIndex`, `mathOpenerAt`, `mathSpanAt`, `mathBlockAt`) shared by every Markdown renderer: pandoc's anti-currency rules for `$…$`, own-line display blocks, and delimiters matched by backslash parity, so an escaped `\$x$` stays literal and a TeX row break cannot end a span early.
- Added `RequestError.sessionBusy(message, data)` to represent ACP session-busy errors (`-32003`) through the shared JSON-RPC transport.
- Exported `getComposerCacheDir` for resolving the per-project Composer cache directory, including support for `XDG_CACHE_HOME`.

### Fixed

- Fixed OMP sessions unexpectedly exiting during socket cleanup or optional-worker communication on Bun.

## [18.0.6] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：新增 browsers / json 工具，SHA-2/SHA-3 在 ARM64 上加速。

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
