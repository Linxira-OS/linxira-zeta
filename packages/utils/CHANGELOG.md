## [Unreleased]

### Added

- Added `ZipPackage` to `@linxiraos/pi-utils/ar` for lazily reading ZIP-based document packages with a configurable total-inflation limit, plus `DocxImage.readBytes()` for accessing raw DOCX image data.

### Changed

- Improved DOCX conversion to inflate only the package contents it needs, reducing unnecessary work and memory use.
- Improved performance across HTML-to-Markdown conversion, Readability extraction, Markdown lexing, terminal emulation, terminal styling, streaming tool-argument parsing, and log writing. Large-page processing and terminal workloads now use substantially less time and memory.

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
