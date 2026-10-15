## [Unreleased]

## [1.2.0] - 2026-10-12
## [18.10.3] - 2026-10-12

### Breaking Changes

- `isOfficialCodexApiUrl` moved from `@oh-my-pi/pi-ai` to `@oh-my-pi/pi-catalog/wire/codex`, next to `CODEX_BASE_URL`, so the catalog's compat resolver classifies Codex endpoints with the same check ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))

### Added

- Added `withoutUnverifiedThinking` utility to filter reasoning capability from models when no effort is requested
- Added `reachesOfficialEndpoint(model)`: whether a request to the model reaches the official endpoint its compat was built for, following `ANTHROPIC_BASE_URL` and Foundry's `FOUNDRY_BASE_URL` reroutes of first-party Anthropic models ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))
- Added `AssistantMessage.elidedOutputTokens`, the visible output tokens a history rewrite (shake) has removed from the turn, which `usage.output` still counts ([#15446](https://github.com/can1357/oh-my-pi/pull/15446) by [@will-bogusz](https://github.com/will-bogusz))
- Exported `shouldDropTruncatedThinkingOnlyAssistant` from `providers/transform-messages`, `isColdReplayableResponsesTurn` from `providers/openai-shared` and the new `openAIResponsesReplaysNativeHistory` from `providers/openai-responses`, so local token estimates can follow which turns replay drops and whether a session replays native history ([#15447](https://github.com/can1357/oh-my-pi/pull/15447) by [@will-bogusz](https://github.com/will-bogusz))

### Fixed

- Fixed Claude on Google Antigravity failing every turn with "image exceeds 5 MB maximum" once a large image entered the conversation; images are now downscaled to the host's limits before sending, as on the Anthropic API ([#15444](https://github.com/can1357/oh-my-pi/pull/15444) by [@will-bogusz](https://github.com/will-bogusz))

## [18.10.2] - 2026-10-12

### Added

- Added support for `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` on the `anthropic` provider: when set, requests omit pre-release fields (`context_management`, beta tool fields such as `strict` and `defer_loading`, task budgets, structured-output format, `thinking.block_binding`, and Anthropic server compaction) along with their beta headers, so `ANTHROPIC_BASE_URL` gateways that reject them keep working ([#15458](https://github.com/can1357/oh-my-pi/pull/15458) by [@H4vC](https://github.com/H4vC))

## [18.9.2] - 2026-10-11

- 版本线推进至 1.2.0；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- 网关身份头统一 `x-zeta-*`（消费方同步）；新增 `extractHttpStatusFromError`/`extractRetryHint` 导出。

### Fixed

- Fixed Antigravity chat and image requests sending an outdated client version when the model list came from cache, which could make newer models such as Claude Opus 5.5 unavailable.
- When a DeepSeek model writes a broken DSML tool call (for example with the opening `<｜DSML｜tool_calls>` and `<｜DSML｜invoke>` tags missing), its closing tags are now kept in the streamed text instead of being dropped. This lets the agent remove exactly the broken call while keeping any text after it ([#14202](https://github.com/can1357/oh-my-pi/pull/14202) by [@H4vC](https://github.com/H4vC)).

Older entries are archived in [packages/ai/CHANGELOG.md@a20cc0d04b64](https://github.com/can1357/oh-my-pi/blob/a20cc0d04b64f4a68fcc559cbd258743d984c50e/packages/ai/CHANGELOG.md).
