## [Unreleased]

### Breaking Changes

- The environment API-key helpers (`getEnvApiKey`, `getEnvApiKeyName`, and `listProvidersWithEnvKey`) are no longer exported from `@linxiraos/pi-ai/stream`; import them from `@linxiraos/pi-ai` or `@linxiraos/pi-ai/env-api-key` instead.
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

## [1.1.27] - 2026-10-07
## [1.1.24] - 2026-10-03

- 网关身份头统一 `x-zeta-*`（消费方同步）；新增 `extractHttpStatusFromError`/`extractRetryHint` 导出。

### Fixed

- Fixed Antigravity chat and image requests sending an outdated client version when the model list came from cache, which could make newer models such as Claude Opus 5.5 unavailable.
- When a DeepSeek model writes a broken DSML tool call (for example with the opening `<｜DSML｜tool_calls>` and `<｜DSML｜invoke>` tags missing), its closing tags are now kept in the streamed text instead of being dropped. This lets the agent remove exactly the broken call while keeping any text after it ([#14202](https://github.com/can1357/oh-my-pi/pull/14202) by [@H4vC](https://github.com/H4vC)).

Older entries are archived in [packages/ai/CHANGELOG.md@a20cc0d04b64](https://github.com/can1357/oh-my-pi/blob/a20cc0d04b64f4a68fcc559cbd258743d984c50e/packages/ai/CHANGELOG.md).
