## [Unreleased]

## [1.1.27] - 2026-10-07
## [18.8.3] - 2026-10-07

### Added

- Added `OAuthRefreshUnavailableError`, a retryable error that `keys.getWithCredential` and `oauth.access` reject with when every usable OAuth credential failed to refresh transiently; `keys.get` resolves `undefined` instead so availability probes move on to their next candidate ([#14843](https://github.com/can1357/oh-my-pi/pull/14843) by [@H4vC](https://github.com/H4vC))

### Fixed

- Fixed a single transient OAuth token-refresh failure (network blip, timeout, 5xx) ending a running session, including subagents restricted to an account pool, with a non-retryable "No API key for provider" error while the stored credential was still valid; the refresh error now surfaces and the request is retried ([#14843](https://github.com/can1357/oh-my-pi/pull/14843) by [@H4vC](https://github.com/H4vC))

## [18.8.1] - 2026-10-07

### Added

- Added session restrictions for OAuth account pools via `AuthStorage.sessions.restrict`, limiting selection, fallback, rotation, and authentication to specified accounts until the returned lease is released with `sessions.unrestrict`. API keys and other accounts are not used when a session is restricted.
- Exported `resolveCredentialIdentityKey` for determining the identity key used to match credentials with broker account pools and session restrictions.

### Fixed

- Fixed Codex Fast (`priority`) and Ultrafast usage being recorded, billed, and reported as Standard when the backend echoed a default service tier; the requested tier is now preserved in usage and performance records.

## [18.8.0] - 2026-10-07

### Breaking Changes

- The environment API-key helpers (`getEnvApiKey`, `getEnvApiKeyName`, and `listProvidersWithEnvKey`) are no longer exported from `@oh-my-pi/pi-ai/stream`; import them from `@oh-my-pi/pi-ai` or `@oh-my-pi/pi-ai/env-api-key` instead.
- `TranscriptionRequest.audio` now accepts `Uint8Array | Blob`. Consumers must handle `Blob` values when reading transcription requests.

### Changed

- Improved CPU and memory efficiency across streamed model responses, including Cursor, Devin, Codex, OpenAI Responses, and GitLab Duo Workflow.
- Improved request and authentication performance, including account ranking, OAuth preflight, credential rate-limit checks, credential synchronization, and auth gateway requests.
- Improved tool-call parsing performance for long calls and Apple Foundation Models requests.
- Improved Cloudflare AI Gateway request performance and AWS credential-source detection.
- Reduced memory usage when handling generated images and usage reports.

### Fixed

- Fixed false thinking-loop detections for Gemini, DeepSeek, and Grok when responses contain repetitive code or markup such as VRML, SVG, or JSON; valid output is no longer discarded and retried.
- Fixed the Cursor provider retaining request resources after requests completed.
- Fixed session-affinity pins growing without bound in long-lived gateways; pins are now capped at 256 sessions per provider.
- Fixed Anthropic sessions failing every request with HTTP 400 ("role 'system' must precede an 'assistant' message") after a tool change coincided with compaction or an interrupted or failed reply; sessions already stuck this way recover on the next message ([#14746](https://github.com/can1357/oh-my-pi/issues/14746)).

## [18.7.0] - 2026-10-06

### Added

- Added `getOAuthCredentialProvider()` to resolve login aliases, such as `openai-codex-device`, to the provider where their credentials are stored.

### Fixed

- Fixed Ultrafast service-tier billing and usage accounting: GPT-6 Astra now applies its published premium rates—6× on the OpenAI API and 8× included usage on Codex—and is counted toward the premium-request limit.
- Fixed Vertex AI authentication on Windows when credentials are created with `gcloud auth application-default login`.
- Fixed selecting Cursor accounts by email through `auth.accountPolicies` and `/session pin`; newly refreshed and existing accounts now retain the account email.

1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- 网关身份头统一 `x-zeta-*`（消费方同步）；新增 `extractHttpStatusFromError`/`extractRetryHint` 导出。

### Fixed

- Fixed Antigravity chat and image requests sending an outdated client version when the model list came from cache, which could make newer models such as Claude Opus 5.5 unavailable.
- When a DeepSeek model writes a broken DSML tool call (for example with the opening `<｜DSML｜tool_calls>` and `<｜DSML｜invoke>` tags missing), its closing tags are now kept in the streamed text instead of being dropped. This lets the agent remove exactly the broken call while keeping any text after it ([#14202](https://github.com/can1357/oh-my-pi/pull/14202) by [@H4vC](https://github.com/H4vC)).

Older entries are archived in [packages/ai/CHANGELOG.md@a20cc0d04b64](https://github.com/can1357/oh-my-pi/blob/a20cc0d04b64f4a68fcc559cbd258743d984c50e/packages/ai/CHANGELOG.md).
