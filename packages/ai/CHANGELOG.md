## [Unreleased]


### Breaking Changes

- The environment API-key helpers (`getEnvApiKey`, `getEnvApiKeyName`, and `listProvidersWithEnvKey`) are no longer exported from `@linxiraos/pi-ai/stream`; import them from `@linxiraos/pi-ai` or `@linxiraos/pi-ai/env-api-key` instead.
- `TranscriptionRequest.audio` now accepts `Uint8Array | Blob`. Consumers must handle `Blob` values when reading transcription requests.

### Added

- `oauth.refresh(id, signal, { reason: "auth-recovery" })` forwards provider-401 recovery intent to a delegated (auth broker) refresh, and `AuthStorageOptions.refreshOAuthCredentialMints` marks a `refreshOAuthCredential` hook that exchanges tokens itself so its tokens are reused for auth recovery ([#14752](https://github.com/can1357/oh-my-pi/pull/14752) by [@will-bogusz](https://github.com/will-bogusz))
- `SessionsApi.inherit` accepts an optional filter, called with each provider and whether the source's affinity is an explicit user pin, to copy only the affinities it accepts ([#14749](https://github.com/can1357/oh-my-pi/pull/14749) by [@will-bogusz](https://github.com/will-bogusz))

### Changed

- Improved CPU and memory efficiency across streamed model responses, including Cursor, Devin, Codex, OpenAI Responses, and GitLab Duo Workflow.
- Improved request and authentication performance, including account ranking, OAuth preflight, credential rate-limit checks, credential synchronization, and auth gateway requests.
- Improved tool-call parsing performance for long calls and Apple Foundation Models requests.
- Improved Cloudflare AI Gateway request performance and AWS credential-source detection.
- Reduced memory usage when handling generated images and usage reports.
- `AuthApiKeyOptions.accountIds` also matches the login email, or else the project id, of credentials that carry no account id (see `oauthAccountKey`), so Antigravity requests prefer accounts that serve the requested model ([#14924](https://github.com/can1357/oh-my-pi/issues/14924)).

### Fixed

- Fixed false thinking-loop detections for Gemini, DeepSeek, and Grok when responses contain repetitive code or markup such as VRML, SVG, or JSON; valid output is no longer discarded and retried.
- Fixed the Cursor provider retaining request resources after requests completed.
- Fixed session-affinity pins growing without bound in long-lived gateways; pins are now capped at 256 sessions per provider.
- Fixed Anthropic sessions failing every request with HTTP 400 ("role 'system' must precede an 'assistant' message") after a tool change coincided with compaction or an interrupted or failed reply; sessions already stuck this way recover on the next message ([#14746](https://github.com/can1357/oh-my-pi/issues/14746)).
- Fixed Google Gemini and Cloud Code Assist (Antigravity) requests failing when tool schemas contain unsupported JSON Schema keywords or fields that allow multiple types.
- Fixed auth broker account selection and usage-limit enforcement to consistently use the selected account’s quota when multiple accounts are present.
- Fixed Anthropic-family model streaming so encoded marker tokens are decoded correctly in text, tool-call updates, partial messages, and completed tool calls.
- Fixed accounts sitting exactly at their `reservePct` (e.g. 70% used with a 30% reserve) still being picked and reported healthy instead of being held in reserve ([#14765](https://github.com/can1357/oh-my-pi/pull/14765) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `oauth.accessById` with `forceRefresh` returning the stored token unchanged while it was still valid; it now re-mints that one account (through the auth broker when configured) and returns that account's token even if another row is removed meanwhile ([#14752](https://github.com/can1357/oh-my-pi/pull/14752) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `omp -p` and other short-lived auth-broker clients missing from `omp usage clients`: usage still waiting for the 10-second report batch is now sent to the broker before the process exits ([#14899](https://github.com/can1357/oh-my-pi/pull/14899) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Cursor web fetches that were cut off by a dropped connection disappearing from resumed and rebuilt sessions; they now show as interrupted ([#14819](https://github.com/can1357/oh-my-pi/pull/14819) by [@jchanghong023](https://github.com/jchanghong023))
- Anthropic hosted web search can honor custom providers' OAuth-style request shaping and configured headers consistently with conversations ([#14919](https://github.com/can1357/oh-my-pi/pull/14919) by [@farnoy](https://github.com/farnoy))

## [1.1.24] - 2026-10-03

- 网关身份头统一 `x-zeta-*`（消费方同步）；新增 `extractHttpStatusFromError`/`extractRetryHint` 导出。

### Fixed

- Fixed Antigravity chat and image requests sending an outdated client version when the model list came from cache, which could make newer models such as Claude Opus 5.5 unavailable.
- When a DeepSeek model writes a broken DSML tool call (for example with the opening `<｜DSML｜tool_calls>` and `<｜DSML｜invoke>` tags missing), its closing tags are now kept in the streamed text instead of being dropped. This lets the agent remove exactly the broken call while keeping any text after it ([#14202](https://github.com/can1357/oh-my-pi/pull/14202) by [@H4vC](https://github.com/H4vC)).

Older entries are archived in [packages/ai/CHANGELOG.md@a20cc0d04b64](https://github.com/can1357/oh-my-pi/blob/a20cc0d04b64f4a68fcc559cbd258743d984c50e/packages/ai/CHANGELOG.md).
