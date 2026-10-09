## [Unreleased]


### Breaking Changes

- `googleAntigravityModelManagerOptions` takes `resolveAccounts` instead of `oauthToken`, and `fetchAntigravityDiscoveryModels` returns a roster or credential-rejection result instead of a bare list ([#14924](https://github.com/can1357/oh-my-pi/issues/14924)).

### Fixed

- Fixed Claude Haiku 5.5 on Cursor showing as unpriced; it now uses Cursor's $0.10/$0.50 rate card and 5x long-context tier above 100K input tokens ([#14890](https://github.com/can1357/oh-my-pi/pull/14890) by [@eggpeat](https://github.com/eggpeat)).
- Fixed Claude Haiku 5.5 on GitHub Copilot pricing cache reads and writes at $0 on both the standard and `-1m` long-context rows, and the `-1m` row billing the 5x long-context band a second time above 100K input tokens ([#14890](https://github.com/can1357/oh-my-pi/pull/14890) by [@eggpeat](https://github.com/eggpeat)).


### Fixed

- Fixed Claude Haiku 5.5 opening at its full 1M window on Amazon Bedrock, Google Vertex, and other non-Anthropic hosts: every priced host now carries the 5x pricing band above 100K input tokens, so the window stays at 100K unless extended context is on ([#14903](https://github.com/can1357/oh-my-pi/pull/14903) by [@H4vC](https://github.com/H4vC)).


### Added

- Added Claude Haiku 5.5 with adaptive thinking (low through max effort), image input, a 1M-token context window, 128K output, and its tiered pricing above 100K input tokens.


### Fixed

- Fixed Anthropic requests carrying too many inline screenshot bytes by exposing a provider image-byte budget, applied only on the official endpoint ([#14453](https://github.com/can1357/oh-my-pi/issues/14453)).


### Fixed

- Fixed Codex Fast (`priority`) pricing to use OpenAI’s 2.5× included-usage rate for supported models, excluding GPT-5.5 and GPT-6 Astra.
- Fixed GitHub Copilot models with tier-specific prompt limits incorrectly defaulting to the long-context window.


### Changed

- Improved catalog performance by speeding up model cache reads and repeated catalog-wide model builds, especially for large catalogs.

## [1.1.27] - 2026-10-07

- 版本线推进至 1.1.27；本版无独立用户可见变化。
## [1.1.24] - 2026-10-03

- xai-oauth 模型目录对账（移除 v18.4.11 regen 未入种条目）；bundled==seeded 一致性测试加固。

## [1.1.22] - 2026-09-30

- 随 1.1.22 版本线发布;无面向用户的行为变化。
