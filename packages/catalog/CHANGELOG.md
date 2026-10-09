## [1.1.28] - 2026-10-09

### Breaking Changes

- `googleAntigravityModelManagerOptions` takes `resolveAccounts` instead of `oauthToken`, and `fetchAntigravityDiscoveryModels` returns a roster or credential-rejection result instead of a bare list ([#14924](https://github.com/can1357/oh-my-pi/issues/14924)).

### Added

- Added prompt-cache lookback support for Claude models across all hosts, including the public `prompt-cache-lookback` catalog axis and `resolvePromptCacheLookback` API.

### Changed

- Improved catalog performance by speeding up model cache reads and repeated catalog-wide model builds, especially for large catalogs.

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
