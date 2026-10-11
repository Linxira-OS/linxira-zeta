## [Unreleased]

- Added `getNativeGrammarsDir()`, where the native addon loads downloaded tree-sitter grammars from (`~/.zeta/natives/grammars`).
## [18.9.0] - 2026-10-11

### Breaking Changes

- Renamed `takeRecentLoopPhase()` to `takeLoopPhaseAttribution()`. The new API returns a `LoopPhaseAttribution` object (`{ label, ms }`) and reports a label only when it accounts for more time than unlabeled work within an armed measurement window.

### Added

- Added `withLoopPhase(label, fn)` for attributing synchronous work to a named loop phase, with automatic cleanup even when the callback throws.

### Changed

- Improved streaming JSON parsing performance for long tool-argument payloads.

### Fixed

- Fixed archive extraction on Windows systems without symlink privileges by allowing symlink entries to be extracted using supported fallbacks, while skipping unresolvable dangling links instead of failing the entire archive.

## [18.8.9] - 2026-10-10

### Added

- Added `hueDistance`, the angular distance between two OKLCH hues

## [18.8.8] - 2026-10-10

### Fixed

- Fixed `formatDuration` printing `60.0s` for durations just under a minute; they now read `1m` ([#15121](https://github.com/can1357/oh-my-pi/pull/15121) by [@H4vC](https://github.com/H4vC))

## [18.8.7] - 2026-10-09

### Added

- Added `ZipPackage` to `@linxiraos/pi-utils/ar` for lazily reading ZIP-based document packages with a configurable total-inflation limit, plus `DocxImage.readBytes()` for accessing raw DOCX image data.

### Changed

- Improved DOCX conversion to inflate only the package contents it needs, reducing unnecessary work and memory use.
- Improved performance across HTML-to-Markdown conversion, Readability extraction, Markdown lexing, terminal emulation, terminal styling, streaming tool-argument parsing, and log writing. Large-page processing and terminal workloads now use substantially less time and memory.

- Fixed the virtual terminal misreading private CSI sequences such as kitty keyboard `CSI < u` and modifyOtherKeys `CSI > 4;1 m` as cursor restores or text styling, which garbled replayed PTY output.
- Fixed `formatDuration` printing `60.0s` for durations just under a minute; they now read `1m` ([#15121](https://github.com/can1357/oh-my-pi/pull/15121) by [@H4vC](https://github.com/H4vC))
### Fixed

- Fixed memory growth in long-lived child processes, streaming readers, prompt template compilation, and retried HTTP requests by releasing buffers, cache entries, and discarded response bodies promptly.
- Fixed prompt templates rejecting `{{else if …}}` chains as unclosed blocks; a chain now closes with its opening block's single closing tag, as in Handlebars.

## [1.1.27] - 2026-10-07

- 版本线推进至 1.1.27；本版无独立用户可见变化。

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
