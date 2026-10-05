# Changelog

## [Unreleased]

## [1.1.26] - 2026-10-03
## [18.6.1] - 2026-10-04

### Fixed

- Fixed compatibility with Command Code DeepSeek and other DeepSeek-family models by preserving the reasoning context required for warm OpenAI Responses sessions and correctly handling incomplete DSML tool-call wrappers in visible output.

## [18.6.0] - 2026-10-03

- 版本线推进至 1.1.26；本版无独立用户可见变化。

## [1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- 网关身份头统一 `x-zeta-*`（消费方同步）；新增 `extractHttpStatusFromError`/`extractRetryHint` 导出。
