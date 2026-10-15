## [Unreleased]

### Changed

- Raised the default context window for `openai-codex/gpt-6.1-sol` and `gpt-6.1-sol-wm` from 272K to 500K, matching OpenAI's new Codex default; extended context still opens 922K ([#15421](https://github.com/can1357/oh-my-pi/issues/15421))
- Updated model definitions and compatibility rules for provider metadata
- Google Antigravity, xAI and Cursor requests keep up to 60 images, 20 for Claude on Antigravity and Cursor, up from 5; this counts snapcompact frames and live screenshots together ([#15449](https://github.com/can1357/oh-my-pi/pull/15449) by [@will-bogusz](https://github.com/will-bogusz))
- Snapcompact sizes archives at the frame prices measured for Antigravity Gemini (a fixed 1,089 tokens), Grok 4.6 to 4.20, and Claude Sonnet 4.6's standard tier ([#15449](https://github.com/can1357/oh-my-pi/pull/15449) by [@will-bogusz](https://github.com/will-bogusz))

### Added

- Added the `honors-claude-code-beta-kill-switch` axis (`compat.honorsClaudeCodeBetaKillSwitch`), on for the `anthropic` provider, so a rule or `models.yml` override decides which providers honor `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` ([#15458](https://github.com/can1357/oh-my-pi/pull/15458) by [@H4vC](https://github.com/H4vC))
- Added Muse Wonder (`muse-wonder-1.0`) to Meta and Muse Code with its `minimal`–`max` effort ladder and pricing
- Added the `thinking-unverified` rule axis: on hosts whose model list carries no capability metadata (Meta, Muse Code), unrecognized models now offer an opt-in thinking ladder (`ThinkingConfig.unverified`) instead of none
- Added `thinking-unverified` axis for offering reasoning ladders on unclassified model IDs
- Added `Muse Wonder 1.0` model definition to Meta provider
- Added the opt-in `snapcompact-image-reads` axis: snapcompact images a fresh `read` result only for readers whose rule sets it; Claude Opus 5.5 and later opt in ([#14249](https://github.com/can1357/oh-my-pi/pull/14249) by [@will-bogusz](https://github.com/will-bogusz))
- Added the `image-count-budget` rule for how many images one request may carry (Anthropic 90, Codex 200, other hosts unchanged) and the `official-image-count-budget` override that applies only on the official endpoint: Anthropic 600 (100 on 200k-window Claude models), Codex 2,000 ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))
- Added a 24 MB inline-image byte budget for the Codex backend, which now counts as its official endpoint at its default URL and at paths under it such as `/codex/responses` ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))
- Added `isOfficialCodexApiUrl` to `wire/codex`, moved from pi-ai ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))
- Added `verified` to `image-tokenization` rules, marking the Claude 4.7+ high-res tier and the GPT-5.5 to 6.1 and gpt-6-astra rules as matching measured provider billing ([#15442](https://github.com/can1357/oh-my-pi/pull/15442) by [@will-bogusz](https://github.com/will-bogusz))
- Added the `image-max-edge` axis and `resolveImageMaxEdge()` for hosts that shrink images before the model reads them; Cursor's Claude and GPT models and its `default` (Auto) route fit 1024×1024 ([#15448](https://github.com/can1357/oh-my-pi/pull/15448) by [@will-bogusz](https://github.com/will-bogusz))
- Added the `thinking-replay-tokens` axis; Claude lines set it to `output` on every host, since a replayed signed thinking block bills the turn's full reasoning, not the signature's bytes ([#15446](https://github.com/can1357/oh-my-pi/pull/15446) by [@will-bogusz](https://github.com/will-bogusz))
- Added a KDL opt-in for sibling subagent prompt-cache sharing, enabled for Muse Code's Spark 1.3, Wonder 1.0, and Wonder Full 1.0 variants over the Responses API ([#15467](https://github.com/can1357/oh-my-pi/pull/15467) by [@iliaal](https://github.com/iliaal))

### Breaking Changes

- `resolveInlineImageByteBudget(model, officialEndpoint)` and `resolveImageCountBudget(model, officialEndpoint)` take whether the request reaches the official endpoint instead of reading `compat.officialEndpoint`, which misses request-time reroutes such as `ANTHROPIC_BASE_URL`; pass pi-ai's `reachesOfficialEndpoint(model)` ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))

### Fixed

- Applied `max-image-dimension` and `max-image-payload-bytes` to Google API models, and declared the 5 MiB per-image limit of Claude on Google Antigravity ([#15444](https://github.com/can1357/oh-my-pi/pull/15444) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed local token counts for OpenAI GPT-5 and later models (Codex, OpenAI, Azure, OpenRouter, Copilot and other hosts) reading about 12% low: their text is now counted with o200k_base instead of a bytes/4 estimate ([#15447](https://github.com/can1357/oh-my-pi/pull/15447) by [@will-bogusz](https://github.com/will-bogusz))

## [1.2.0] - 2026-10-12

- 版本线推进至 1.2.0；本版无独立用户可见变化。

## [1.1.27] - 2026-10-07

- 版本线推进至 1.1.27；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- xai-oauth 模型目录对账（移除 v18.4.11 regen 未入种条目）；bundled==seeded 一致性测试加固。

## [1.1.22] - 2026-09-30

- 随 1.1.22 版本线发布;无面向用户的行为变化。
