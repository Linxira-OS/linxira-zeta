# Changelog

## [Unreleased]

## [1.1.4] - 2026-08-26
## [18.0.6] - 2026-08-26

### Added

- Added the `backgroundIdleMs` option to customize how long background auth-broker activity remains active before automatically parking.

### Fixed

- Fixed auth-broker background activity keeping processes alive unnecessarily, so unused broker-backed auth storage now parks automatically and no longer prevents CLI exit.

## [18.0.5] - 2026-08-25

### Breaking Changes

- Renamed the exported stream-retry helper from `withEmptyCompletionRetry` to `withReplaySafeStreamRetry` and added retry policy options for empty completions and provider errors. Consumers using the old helper must migrate.

### Added

- Added browser-based Sign in with OpenRouter using OAuth PKCE, while retaining support for pasted OpenRouter API keys and redirect URLs for remote sessions.
- Added `/login` API-key authentication for DeepInfra and Yolo-Auto, including validation against each provider before the credentials are accepted.

### Fixed

- Fixed DeepSeek vision models from losing image input while keeping image parts stripped for text-only DeepSeek endpoints.
- Fixed OpenAI-compatible gateways that report uppercase completion reasons such as `STOP` or `MAX_TOKENS`; these are now classified correctly, including mapping `MAX_TOKENS` to a length limit.
- Fixed provider message-count limit errors being treated as unrecoverable payload errors instead of recoverable context overflows.
- Improved Codex WebSocket continuations so rate limits, throttling, and compatible mode changes preserve valid response continuations instead of unnecessarily replaying the full context.
- Fixed Codex WebSocket cleanup failures caused by already-closed sockets.
- Added safe retries for transient mid-stream socket closures across OpenAI Responses, Chat Completions, Azure OpenAI Responses, and Codex SSE when no replay-unsafe output has been emitted.
- Fixed usage and cost reporting for OpenAI-compatible gateways backed by Vertex AI or Gemini by recognizing cached prompt tokens reported through `cachedContentTokenCount`.

## [18.0.4] - 2026-08-24

### Fixed

- Fixed Cursor tool calls through OpenAI-compatible authentication gateways losing arguments when complete argument maps are sent without streaming deltas ([#9479](https://github.com/can1357/oh-my-pi/issues/9479)).
- Fixed Cursor plan entitlement refusals repeatedly selecting ineligible accounts by scoping credential blocks to the requested model during rotation ([#9488](https://github.com/can1357/oh-my-pi/issues/9488)).
- Improved HTTP 413 error classification to accurately distinguish between payload/media size limits and token context window overflows, preventing inappropriate token compaction attempts and routing to correct recovery/fallback strategies ([#9235](https://github.com/can1357/oh-my-pi/issues/9235)).
- Fixed Cursor conversation rotation after aborts or mid-turn restarts to properly replay the last user message on a fresh conversation.

## [18.0.3] - 2026-08-23

### Fixed

- Fixed a Fireworks-hosted model aborting mid-generation with an HTTP 400 `Floating point NaN (not-a-number) is detected in generation` killing the turn instead of retrying; this model-side numerical fault is now classified transient and retried, matching the existing treatment of Copilot fleet-skew 400s ([#9458](https://github.com/can1357/oh-my-pi/issues/9458)).

## [18.0.2] - 2026-08-23

### Fixed

- Fixed OpenAI-compatible completions hosts that stream content then terminate with the `[DONE]` sentinel while omitting (or `null`ing) `finish_reason` failing every turn with `OpenAI completions stream closed before a finish_reason was received`; a `[DONE]`-terminated stream now finalizes as a clean stop and only a genuine transport EOF (no `[DONE]`, no finish reason) surfaces the incomplete-stream error ([#9433](https://github.com/can1357/oh-my-pi/issues/9433)).

## [18.0.1] - 2026-08-23

### Changed

- 同步 1.1.4 发布线（与 1.1.3 无功能差异）。

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

## [1.0.1] - 2026-08-14

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.

## [1.0.0] - 2026-08-13

### Changed

- Reset the version to 1.0.0 and republished under the `@linxiraos/*` scope, breaking from the `@linxiraos` version lineage.
