# Changelog

## [Unreleased]

### 修复
## [1.1.20] - 2026-09-23
## [1.1.19] - 2026-09-22
## [1.1.18] - 2026-09-22

- 包元数据:author/maintainer 更新为 Linxira-OS,LICENSE 追加 Linxira-OS 版权行(发行面变更)。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 同步:stencil.so OAuth 认证回调、流式 JSON 代理解析优化。
### Fixed

- Fixed Anthropic prompt-cache head re-baselining on every memory recall refresh: the system breakpoint now anchors on the last stable segment instead of the volatile recall suffix, and the stable-system fingerprint ignores recall blocks, so a recall refresh re-bills only the suffix instead of the whole tools+system head.
- Fixed auth-broker client config resolution failing silently on Windows when reading the token file or `config.yml`; reads now use `node:fs` instead of `Bun.file`.

