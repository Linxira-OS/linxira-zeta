## [Unreleased]

## [1.1.27] - 2026-10-07

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
