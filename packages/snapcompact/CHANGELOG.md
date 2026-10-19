## [Unreleased]

## [1.3.1] - 2026-10-19

- 版本线推进至 1.3.1；本版无独立用户可见变化。

## [1.3.0] - 2026-10-18

### Breaking Changes

- `providerImageBudget(provider)` and `providerFrameBudget(provider)` became `providerImageBudget(model)` and `providerFrameBudget(model)`, and `maxFramesForDataBudget(shape)` became `maxFramesForDataBudget(shape, budget)` with a required byte budget ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))
- Removed `PROVIDER_IMAGE_BUDGETS` and `FRAME_DATA_BYTES_BUDGET`: image counts come from the catalog's `image-count-budget` rules, and frame byte budgets from `frameDataBytesBudget(model)` (`DEFAULT_FRAME_DATA_BYTES_BUDGET` where the host has none) ([#15434](https://github.com/can1357/oh-my-pi/pull/15434) by [@will-bogusz](https://github.com/will-bogusz))

### Added

- Added `plannedFrameTokens` and `Shape.frameTokensVerified`: archive sizing charges a frame its own price when the reader's `image-tokenization` rule is `verified`, and at least `FRAME_TOKEN_ESTIMATE` otherwise ([#15442](https://github.com/can1357/oh-my-pi/pull/15442) by [@will-bogusz](https://github.com/will-bogusz))
- Added `viewWithoutThinking()`, `textWithoutThinking()`, `readerIncludesThinking()` and an optional `Archive.withoutThinking` variant, so an archive rendered with reasoning can be read by a model that must not see it; without a stored variant the view keeps only reasoning-free text and no frames ([#15436](https://github.com/can1357/oh-my-pi/pull/15436) by [@will-bogusz](https://github.com/will-bogusz))

### Fixed

- Fixed snapcompact frames for Claude and GPT on Cursor, including its `default` (Auto) route, being drawn at 1568–1932px, which Cursor shrank to 1024px before the model read them; frames now render at the host's catalog `image-max-edge` ([#15448](https://github.com/can1357/oh-my-pi/pull/15448) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed re-rendering an archive without reasoning keeping every paragraph after the first of a multi-paragraph `¶think:` section ([#15436](https://github.com/can1357/oh-my-pi/pull/15436) by [@will-bogusz](https://github.com/will-bogusz))

## [1.2.0] - 2026-10-12

- 版本线推进至 1.1.28；本版无独立用户可见变化。

## [1.1.27] - 2026-10-07

- 版本线推进至 1.1.27；本版无独立用户可见变化。

### Breaking Changes

- `maxFramesForDataBudget()` now takes the frame shape instead of a byte budget, so the default 1568px shapes get 26 frames instead of 17 ([#14277](https://github.com/can1357/oh-my-pi/pull/14277) by [@will-bogusz](https://github.com/will-bogusz)).

### Added

- Added `frameBilling`, `frameTokens` and `frameBillingKey`, which price a rendered frame at what the model reading it is billed ([#14291](https://github.com/can1357/oh-my-pi/pull/14291) by [@will-bogusz](https://github.com/will-bogusz))

### Fixed

- Fixed snapcompact frame token estimates following the gateway instead of the model reading the frames, which mispriced Claude behind OpenRouter or Vertex and Claude 4.6 and older ([#14286](https://github.com/can1357/oh-my-pi/pull/14286) by [@will-bogusz](https://github.com/will-bogusz)).

## [1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- 上游 v18.4.11 集成；本轮无用户可见变更。

## [1.1.22] - 2026-09-30

- 随 1.1.22 版本线发布;无面向用户的行为变化。

## [1.1.19] - 2026-09-22

- 版本线推进;本版无独立用户可见变化。

## [1.1.18] - 2026-09-22

- 包元数据:author/maintainer 更新为 Linxira-OS,LICENSE 追加 Linxira-OS 版权行(发行面变更)。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 维护同步。
