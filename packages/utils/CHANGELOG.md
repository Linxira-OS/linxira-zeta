# Changelog

## [Unreleased]

## [1.1.20] - 2026-09-23

## [1.1.19] - 2026-09-22

## [1.1.18] - 2026-09-22

- 包元数据:author/maintainer 更新为 Linxira-OS,LICENSE 追加 Linxira-OS 版权行(发行面变更)。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 同步:JSON 与缓存逻辑流线化重构、which 缓存改字符串键重写。
- Optimized model configuration command execution by deduplicating requests and adding failure backoff
- Prevented unnecessary credential command execution when runtime API keys are configured
- Retained `readLines()` results no longer change when later chunks reuse the internal buffer.
- Long sleeps honor elapsed time and re-arm after premature timer wakes without overflowing native timer delays.
