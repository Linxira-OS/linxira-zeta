# Changelog

## [Unreleased]

## [1.1.27] - 2026-10-07

- 版本线推进至 1.1.27；本版无独立用户可见变化。
## [18.7.0] - 2026-10-06

### Added

- Added Mistral Large 4 with reasoning support, image input, a 1M-token context window, and preview pricing.
- Added configurable thinking levels from low through maximum for MiniMax-M3.1-Flash-Preview; because the model always reasons, requests that disable thinking use the low level.
- Added Google Antigravity pricing and model support for Claude Opus 5.5 and Sonnet 5.5.

### Changed

- MiniMax Token Plan providers (`minimax-code` and `minimax-code-cn`) now use MiniMax's recommended Anthropic-compatible API for model requests and login key validation.
- Google Antigravity now exposes Claude Opus 5.5 and Sonnet 5.5 once each, with selectable low, medium, and high thinking levels.

### Fixed

- Added the correct published pricing for GPT-6 Astra's Ultrafast service tier: a 6× multiplier on the OpenAI API and an 8× multiplier on the Codex card.

## [18.6.3] - 2026-10-06

### Added

- Added an optional `statefulResponses` compat field for OpenAI Responses models, kept through OpenRouter's Responses dispatch ([#13686](https://github.com/can1357/oh-my-pi/pull/13686) by [@alphastorm](https://github.com/alphastorm)).
- Added 15 Snowflake Cortex models with account-specific endpoints, Cortex compatibility rules, and estimated account-billed pricing ([#14507](https://github.com/can1357/oh-my-pi/pull/14507) by [@jorgoose](https://github.com/jorgoose)).
- Added the `image-tokenization` axis, which declares how GPT-5.2+, Claude and Gemini 3 lines bill input images on every host, with wire-API fallback rules for other models, plus `imageTokens()` to price one image ([#14286](https://github.com/can1357/oh-my-pi/pull/14286) by [@will-bogusz](https://github.com/will-bogusz)).

### Changed

- Changed OpenAI Responses endpoints other than OpenAI, Azure OpenAI, and Codex (custom and local servers, proxies including `azure`/`openai-codex` providers pointed at a non-Azure/non-Codex `baseUrl`, OpenRouter) to default `supportsImageDetailOriginal` to `false`, so snapcompact frames and computer screenshots go out as `detail: "auto"` instead of failing on servers that reject `original`; set `compat.supportsImageDetailOriginal: true` to opt a host in ([#13687](https://github.com/can1357/oh-my-pi/pull/13687) by [@alphastorm](https://github.com/alphastorm)).
- Muse Code can now store Responses results on Meta's side (`store-responses`), so a turn whose connection drops can be recovered instead of re-run. Storage is opt-in via the omp setting `providers.muse-code.storeResponses` or `PI_MUSE_STORE_RESPONSES=1` ([#14293](https://github.com/can1357/oh-my-pi/pull/14293) and [#14534](https://github.com/can1357/oh-my-pi/pull/14534) by [@abilliontokens](https://github.com/abilliontokens)).

## [1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- xai-oauth 模型目录对账（移除 v18.4.11 regen 未入种条目）；bundled==seeded 一致性测试加固。

## [1.1.22] - 2026-09-30

- 随 1.1.22 版本线发布;无面向用户的行为变化。
