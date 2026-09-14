# Changelog

## [Unreleased]

## [1.1.14] - 2026-09-12
## [18.1.19] - 2026-09-12

### Added

- Added `Agent.getPendingToolResults()` for reconstructing live displays before buffered tool results are persisted ([#11868](https://github.com/can1357/oh-my-pi/pull/11868) by [@serverinspector](https://github.com/serverinspector)).
- Added opt-in host authorization and exact-once streamed child execution for discard-safe local reads.

### Changed

- `Tool <name> not found` now also suggests mounted `xd://` devices, not just the advertised tool set, via the new `suggestFallbackToolNames` option ([#11516](https://github.com/can1357/oh-my-pi/issues/11516), [#10109](https://github.com/can1357/oh-my-pi/issues/10109) by [@oldschoola](https://github.com/oldschoola)).

### Fixed

- Speculative stream sessions are now discarded when a hook or argument transform replaces a call's arguments while keeping its ID, instead of releasing deferred work planned from the original code ([#11889](https://github.com/can1357/oh-my-pi/pull/11889) by [@h4vc](https://github.com/h4vc)).

## [18.1.18] - 2026-09-11

### Added

- Anthropic server-side compaction as a `remote` compaction backend: model lines the beta supports (`compat.supportsServerCompaction`, rule-owned in the catalog: Opus 4.6+, Sonnet 4.6+, Fable/Mythos 5) on the official endpoint, resolved the way the provider routes requests, plus Anthropic-compatible routes with `remoteCompaction.enabled`, compact by re-issuing the live turn's own request — same system prompt, tools, and history, so it reads the prompt cache the last turn wrote — with the `compact_20260112` edit paused after the summary and the harness summary prompt as `instructions`. The instructions name where the retained tail begins so the summary covers only the history the rebuilt context drops. The API's summary is stored as the entry text and as `preserveData.anthropicCompaction`, replayed natively on later Anthropic requests and read as plain text by every other provider; the retained tail comes from session entries as with a local summary. Contexts below 55k tokens (the API trigger floor plus margin) keep summarizing locally, and a response without a summary is a native failure, like the OpenAI lanes. An aborted compaction response is the abort (a cancellation, never a native failure) and an error response keeps its HTTP status, so auth and timeout classification match the OpenAI lanes; the block's opaque `encrypted_content` is persisted as `preserveData.anthropicCompaction.encryptedContent` and replayed verbatim.

### Fixed

- `compact()` now forwards the caller's `oneshotRetry` opt-out to every summarization oneshot; auto-compaction's outer retry loop no longer multiplies with the inner transient-failure retries.

## [18.1.17] - 2026-09-10

### Changed

- `Tool <name> not found` now names a plausible intended target when the advertised set contains one, e.g. `Tool mcp__abc123__xyz789_read not found. Did you mean read?`. A model that mis-transcribes a long opaque tool name reliably keeps the trailing segment, which is the only part carrying meaning, so the miss becomes recoverable in the same turn instead of costing a round trip. Purely advisory — the suggestion is only ever a string in the error, never a dispatch target, so an unrecognized name still fails ([#10109](https://github.com/can1357/oh-my-pi/issues/10109) by [@oldschoola](https://github.com/oldschoola)).

### Fixed

- Fixed the token estimator counting developer messages as free and ignoring images in user content, which let context budgeting, pruning and the compaction trigger read a transcript as far smaller than the one sent to the provider.
- Fixed repeated local compaction omitting messages retained before the previous compaction record, while preserving original entry IDs and `/clear` boundaries.
- Raised remote compaction request timeout from 3 minutes to 5 minutes so long Codex/gpt-6-astra compact streams can finish before the watchdog aborts them.
- Fixed proxy responses dropping the cost the server reported; recorded costs are kept instead of being recomputed.

## [18.1.10] - 2026-09-04

- 随 1.1.14 版本线发布:bazel 构建面(crates/*/BUILD.bazel)版本号纳入一致性检查,CI 原生构建与桌面冒烟守卫修复。

## [1.1.13] - 2026-09-10

- 上游 v18.1.16 同步:运行时版本对齐与内部修复。

## [1.1.12] - 2026-09-10

- 品牌与合并工具链维护版本;无本包用户可见变更。

## [1.1.11] - 2026-09-08

- OMP v18.1.13 + v18.1.14 dual-tag sync baseline; no package-specific user-visible changes.

## [1.1.10] - 2026-09-07

- OMP v18.1.11 sync baseline (`e3106be68f`); no package-specific user-visible changes.

## [1.1.9] - 2026-09-05

- v18.1.10 sync baseline (compaction and tool-arg stream updates).

## [1.1.8] - 2026-09-04

- OMP sync v18.1.2–v18.1.5: Agent Hub activity stream groundwork, declarative provider auth registry, and tool-roster notice plumbing shared with the session layer.
- Fixed the session extension rebinding path so freshly prepared extensions bind without re-evaluating the module.

## [1.1.7] - 2026-09-01

- 同步上游 OMP v18.0.11（`b8ce33a58911c26bed1d84f0db9a5e2e727c49a2`）。

## [1.1.6] - 2026-08-30

- 同步上游 OMP v18.0.10（`33cc6b9a043a`）。
- 同步上游 OMP v18.0.9（`cc14e04f075d`）。

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6（内部运行时与构建改进）。

## [1.1.0] - 2026-08-25

### Changed

- 同步上游 OMP v18.0.3 / v18.0.4（内部运行时与构建改进，无独立用户可见变更）。

## [1.0.0] - 2026-08-13

### Changed

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.
