## [Unreleased]

## [18.9.1] - 2026-10-11

### Added

- Added the `supports-thinking-binding-controls` axis to Bedrock Converse models (on by default) so a rule or `models.yml` override can turn off Claude thinking-binding controls on hosts that reject them ([#15316](https://github.com/can1357/oh-my-pi/pull/15316) by [@harshaygadekar](https://github.com/harshaygadekar))

## [18.9.0] - 2026-10-11

### Fixed

- Fixed GLM-5.3-FlashX on Zhipu Coding Plan so bundled context, image, and reasoning-level capabilities are reported correctly.
- Fixed OpenRouter Decisions endpoint derivation when the chat base URL has a trailing slash.
- Fixed GPT-6.1 Sol Ultrafast usage pricing to apply OpenAI's published premium rates for the OpenAI API and Codex included usage.
- Fixed GPT-6 Sol, GPT-6.1 Sol, and GPT-6 Luna so changing reasoning effort preserves prompt caching.

## [18.8.8] - 2026-10-10

### Added

- Added the `connection-bound-native-history` rule axis for Responses hosts that reject native history items from an earlier connection, set for GitHub Copilot ([#15148](https://github.com/can1357/oh-my-pi/pull/15148) by [@will-bogusz](https://github.com/will-bogusz))

### Fixed

- Fixed Devin's discovered models not marking the account's default model, the one Devin's own CLI starts the account on (SWE-2 High on Pro, SWE-1.6 Slow on Free); when it is an effort lane of a family, the family starts at that effort. Cursor's discovered models no longer carry that marker, so Cursor keeps its existing startup selection ([#15115](https://github.com/can1357/oh-my-pi/pull/15115) by [@will-bogusz](https://github.com/will-bogusz))

## [18.8.7] - 2026-10-09

### Added

- Added built-in CoralBricks support with `/login`, live model discovery, per-model reasoning levels and off controls, and bundled offline fallbacks. ([#14146](https://github.com/can1357/oh-my-pi/pull/14146) by [@ryan-brosas](https://github.com/ryan-brosas))
- Added `gen:models --provider <id>` to update one provider without changing other providers' catalog snapshots. ([#14146](https://github.com/can1357/oh-my-pi/pull/14146) by [@ryan-brosas](https://github.com/ryan-brosas))

### Fixed

- Fixed Claude Haiku 5.5 thinking Off to request explicitly disabled thinking on every host serving its adaptive thinking ([#14996](https://github.com/can1357/oh-my-pi/pull/14996) by [@bse-ai](https://github.com/bse-ai)).

## [18.8.6] - 2026-10-08

### Added

- Added prompt-cache lookback support for Claude models across all hosts, including the public `prompt-cache-lookback` catalog axis and `resolvePromptCacheLookback` API.

### Fixed

- Fixed model discovery when providers publish models before they are recognized by the catalog; unsupported models are now skipped with a warning so other available models remain discoverable.

## [18.8.5] - 2026-10-08

### Breaking Changes

- `googleAntigravityModelManagerOptions` takes `resolveAccounts` instead of `oauthToken`, and `fetchAntigravityDiscoveryModels` returns a roster or credential-rejection result instead of a bare list ([#14924](https://github.com/can1357/oh-my-pi/issues/14924)).

- Added built-in CoralBricks support with `/login`, live model discovery, per-model reasoning levels and off controls, and bundled offline fallbacks. ([#14146](https://github.com/can1357/oh-my-pi/pull/14146) by [@ryan-brosas](https://github.com/ryan-brosas))
- Added `gen:models --provider <id>` to update one provider without changing other providers' catalog snapshots. ([#14146](https://github.com/can1357/oh-my-pi/pull/14146) by [@ryan-brosas](https://github.com/ryan-brosas))
- Added the `connection-bound-native-history` rule axis for Responses hosts that reject native history items from an earlier connection, set for GitHub Copilot ([#15148](https://github.com/can1357/oh-my-pi/pull/15148) by [@will-bogusz](https://github.com/will-bogusz))
### Added

- Added prompt-cache lookback support for Claude models across all hosts, including the public `prompt-cache-lookback` catalog axis and `resolvePromptCacheLookback` API.

### Changed

- Improved catalog performance by speeding up model cache reads and repeated catalog-wide model builds, especially for large catalogs.

- Fixed Claude Haiku 5.5 thinking Off to request explicitly disabled thinking on every host serving its adaptive thinking ([#14996](https://github.com/can1357/oh-my-pi/pull/14996) by [@bse-ai](https://github.com/bse-ai)).
- Fixed Devin's discovered models not marking the account's default model, the one Devin's own CLI starts the account on (SWE-2 High on Pro, SWE-1.6 Slow on Free); when it is an effort lane of a family, the family starts at that effort. Cursor's discovered models no longer carry that marker, so Cursor keeps its existing startup selection ([#15115](https://github.com/can1357/oh-my-pi/pull/15115) by [@will-bogusz](https://github.com/will-bogusz))
### Fixed

- Fixed model discovery when providers publish models before they are recognized by the catalog; unsupported models are now skipped with a warning so other available models remain discoverable.
- Fixed Claude Haiku 5.5 on Cursor showing as unpriced; it now uses Cursor's $0.10/$0.50 rate card and 5x long-context tier above 100K input tokens ([#14890](https://github.com/can1357/oh-my-pi/pull/14890) by [@eggpeat](https://github.com/eggpeat)).
- Fixed Claude Haiku 5.5 on GitHub Copilot pricing cache reads and writes at $0 on both the standard and `-1m` long-context rows, and the `-1m` row billing the 5x long-context band a second time above 100K input tokens ([#14890](https://github.com/can1357/oh-my-pi/pull/14890) by [@eggpeat](https://github.com/eggpeat)).

## [1.1.27] - 2026-10-07

- 版本线推进至 1.1.27；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- xai-oauth 模型目录对账（移除 v18.4.11 regen 未入种条目）；bundled==seeded 一致性测试加固。

## [1.1.22] - 2026-09-30

- 随 1.1.22 版本线发布;无面向用户的行为变化。
