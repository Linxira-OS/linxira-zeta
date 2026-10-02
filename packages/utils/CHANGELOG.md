# Changelog

## [Unreleased]

## [1.1.23] - 2026-10-01
## [1.1.22] - 2026-09-30
## [18.4.11] - 2026-10-02

### Added

- Added XDG-aware utility paths for skill descriptions and prediction state, with automatic adoption of legacy data when XDG locations are first resolved.

### Fixed

- Fixed machine-global daemon runtime paths so brokers such as text prediction use the shared XDG state location across profiles and custom agent directories.

## [18.4.10] - 2026-10-02

### Added

- Added `startFrom(src, from)` to inline Markdown tokenizer extensions: a start hint that returns the first match at or after `from` (or `undefined`), so long paragraphs stay linear ([#13961](https://github.com/can1357/oh-my-pi/pull/13961) by [@sjawhar](https://github.com/sjawhar)).
- Added `this.source` and `this.end` for inline Markdown tokenizer extensions: the whole inline source and where the text being lexed ends in it, with one `this` per source that the link labels and emphasis inside it share, so a tokenizer can remember what it already scanned ([#13961](https://github.com/can1357/oh-my-pi/pull/13961) by [@sjawhar](https://github.com/sjawhar)).
- Added `mathSpanInContext` and `MathSpans` to `math-delimiters`, which find math spans without rescanning a run of unclosed openers ([#13961](https://github.com/can1357/oh-my-pi/pull/13961) by [@sjawhar](https://github.com/sjawhar)).

### Fixed

- Fixed long Markdown paragraphs lexing slowly: a 44 KB paragraph with no blank line now parses in about 3 ms instead of 100 ms ([#13961](https://github.com/can1357/oh-my-pi/pull/13961) by [@sjawhar](https://github.com/sjawhar)).
- Fixed Markdown paragraphs with many unclosed `[`, `*` or `_`, or with a long address-like word and no dotted domain, lexing slowly: a 40 KB paragraph of each now lexes in 4-24 ms instead of 2-12 s ([#13961](https://github.com/can1357/oh-my-pi/pull/13961) by [@sjawhar](https://github.com/sjawhar)).
- Fixed Markdown paragraphs of deeply nested emphasis, links or images lexing slowly: 32 KB now lexes in about 50 ms instead of 7 s, and a long word inside every level no longer costs its length once per level, except in nested image labels that hold a backslash escape ([#13961](https://github.com/can1357/oh-my-pi/pull/13961) by [@sjawhar](https://github.com/sjawhar)).
- Fixed Markdown paragraphs with long or many unclosed runs of backticks, or `<http://` autolinks with no space or `>` after them, lexing slowly: 80 KB of each now lexes in about 50-60 ms instead of seconds (40 KB of one unclosed run took 10 s) ([#13961](https://github.com/can1357/oh-my-pi/pull/13961) by [@sjawhar](https://github.com/sjawhar)).
- Fixed Markdown paragraphs of nested brackets, URLs with long trailing punctuation, or unclosed HTML tags or comments lexing slowly: 80 KB of each now lexes in under 40 ms instead of 4-30 s ([#13961](https://github.com/can1357/oh-my-pi/pull/13961) by [@sjawhar](https://github.com/sjawhar)).
- Fixed deeply nested Markdown links and emphasis overflowing the stack early: in a fresh process links now nest about three times as deep before a stack overflow, and emphasis twice as deep ([#13961](https://github.com/can1357/oh-my-pi/pull/13961) by [@sjawhar](https://github.com/sjawhar)).

## [18.4.9] - 2026-10-01

### Added

- Added `tryAcquireFileLock`, a non-blocking file-lock helper that returns `null` when the lock is already held.
- Added an `unref` option to `AsyncDrain`, allowing applications to use long batch windows without keeping the process alive.

### Changed

- Improved logging efficiency and configurability by batching routine file writes, flushing urgent records promptly, adding on-demand `logger.flush()` support, and allowing file log levels to be limited with `OMP_LOG_LEVEL`. Log files are created only when needed, and obsolete log and audit files are cleaned up automatically.

## [18.4.4] - 2026-09-29

- **CLI bin 命名**:新增 `CLI_BIN_NAME`(zeta-c),Usage/进程标题/补全驱动统一;配置根 `.zeta`、`ZETA_*`、`APP_NAME` 不变。

## [1.1.18] - 2026-09-22

- 包元数据:author/maintainer 更新为 Linxira-OS,LICENSE 追加 Linxira-OS 版权行(发行面变更)。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 同步:JSON 与缓存逻辑流线化重构、which 缓存改字符串键重写。
- Optimized model configuration command execution by deduplicating requests and adding failure backoff
- Prevented unnecessary credential command execution when runtime API keys are configured
- Retained `readLines()` results no longer change when later chunks reuse the internal buffer.
- Long sleeps honor elapsed time and re-arm after premature timer wakes without overflowing native timer delays.
