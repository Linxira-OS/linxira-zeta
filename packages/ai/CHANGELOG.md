# Changelog

## [Unreleased]

### 修复

- Anthropic 提示缓存头基线随记忆召回刷新而重置：系统断点现锚定最后稳定段而非易变 recall 后缀（[18.2.6] 上游契约）。
- auth-broker 在 Windows 读 token/config.yml 静默失败：改用 `node:fs` 而非 `Bun.file`（[18.2.6] 上游契约）。

## [1.1.20] - 2026-09-23

## [1.1.19] - 2026-09-22

- 版本线推进;本版无独立用户可见变化。

## [1.1.18] - 2026-09-22

- 包元数据:author/maintainer 更新为 Linxira-OS,LICENSE 追加 Linxira-OS 版权行(发行面变更)。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 同步:stencil.so OAuth 认证回调、流式 JSON 代理解析优化。
