# Changelog

## [Unreleased]

### 修复
## [1.1.20] - 2026-09-23
## [1.1.19] - 2026-09-22
## [1.1.18] - 2026-09-22
## [1.1.16] - 2026-09-19
## [1.1.21-omp15.11.1] - 2026-06-11

### Changed

- Exported `resolveAnthropicMetadataUserId` so non-streaming Anthropic Messages consumers (e.g. the coding-agent web search provider) can produce the same Claude-Code-shaped `metadata.user_id` as the main streaming path.

### Fixed

- Preserved Anthropic `stop_details` on assistant messages so refusal and sensitive classifier stops remain structurally visible to callers. ([#2290](https://github.com/can1357/oh-my-pi/issues/2290))
- Fixed OpenAI Responses, Azure OpenAI Responses, and OpenAI Completions streams hanging until the 120s idle watchdog errored the turn when a provider delivers the terminal frame but never sends `[DONE]` nor closes the connection. `processResponsesStream` now breaks out of the event loop on `response.completed`/`response.incomplete` (mirroring the Codex websocket/SSE terminal break), and the completions consumer breaks once `finish_reason` plus a usage payload arrived — or, for hosts that never send usage, ends the stream cleanly via a short post-finish grace window (`iterateWithTerminalGrace`) that aborts the transport to release the socket.

Older entries are archived in [packages/ai/CHANGELOG.md@d58593a30902](https://github.com/can1357/oh-my-pi/blob/d58593a3090258473304608d68ffd1f620e6b695/packages/ai/CHANGELOG.md).
