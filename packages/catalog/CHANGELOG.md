## [Unreleased]

## [1.1.27] - 2026-10-07

- 版本线推进至 1.1.27；本版无独立用户可见变化。
## [18.8.2] - 2026-10-07

### Fixed

- Fixed Anthropic requests carrying too many inline screenshot bytes by exposing a provider image-byte budget, applied only on the official endpoint ([#14453](https://github.com/can1357/oh-my-pi/issues/14453)).

## [18.8.1] - 2026-10-07

### Fixed

- Fixed Codex Fast (`priority`) pricing to use OpenAI’s 2.5× included-usage rate for supported models, excluding GPT-5.5 and GPT-6 Astra.
- Fixed GitHub Copilot models with tier-specific prompt limits incorrectly defaulting to the long-context window.

## [18.8.0] - 2026-10-07

### Changed

- Improved catalog performance by speeding up model cache reads and repeated catalog-wide model builds, especially for large catalogs.

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

1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- xai-oauth 模型目录对账（移除 v18.4.11 regen 未入种条目）；bundled==seeded 一致性测试加固。

## [1.1.22] - 2026-09-30

- 随 1.1.22 版本线发布;无面向用户的行为变化。
