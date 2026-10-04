# Changelog

## [Unreleased]

## [1.1.26] - 2026-10-03
## [18.5.1] - 2026-10-03

### Added

- Added utilities for detecting and scanning own-line display-math blocks in growing text, including identifying possible openers and closers efficiently.
- Added an option to `TerminalQueryResponder` that lets PTY hosts provide cursor-position reports themselves.
- Added `refreshShellConfigCache()` to rebuild the cached shell spawn environment from the current process environment.

### Fixed

- Fixed the Markdown lexer dropping text preceding U+2028 or U+2029 line-separator characters.

## [18.5.0] - 2026-10-03

### Added

- Added the public `getSessionOwnersDir()` utility, which returns the profile-independent `~/.omp/run/session-owners` directory that names session ownership leases ([#14095](https://github.com/can1357/oh-my-pi/pull/14095) by [@andrebrait](https://github.com/andrebrait))

### Fixed

- Fixed SQLite error messages doubling every backslash in Windows database paths
- Fixed corrupt-database recovery failing with `EBUSY` on Windows when several in-process openers of the same store failed at once

## [18.4.12] - 2026-10-02

### Fixed

- Fixed multi-second temp directory removal stalls on Windows by forcing a major GC before the first deletion retry ([#13044](https://github.com/can1357/oh-my-pi/pull/13044) by [@jchanghong023](https://github.com/jchanghong023)).

## [18.4.11] - 2026-10-02

- 版本线推进至 1.1.26；本版无独立用户可见变化。

## [1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- v18.4.11 集成：dirs.ts XDG 解析增量（skill-descriptions/predict/global daemon）+ 插件存储契约（`pi.storage` 三目录、`adoptLegacyFileOnce` 公共化）；插件锁文件名保持上游兼容。

## [1.1.18] - 2026-09-22

- 包元数据:author/maintainer 更新为 Linxira-OS,LICENSE 追加 Linxira-OS 版权行(发行面变更)。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 同步:JSON 与缓存逻辑流线化重构、which 缓存改字符串键重写。
- Optimized model configuration command execution by deduplicating requests and adding failure backoff
- Prevented unnecessary credential command execution when runtime API keys are configured
- Retained `readLines()` results no longer change when later chunks reuse the internal buffer.
- Long sleeps honor elapsed time and re-arm after premature timer wakes without overflowing native timer delays.
