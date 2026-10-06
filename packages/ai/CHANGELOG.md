# Changelog

## [Unreleased]

- 版本线推进至 1.1.27；本版无独立用户可见变化。

## [1.1.27] - 2026-10-06

### Changed

- Reduced CPU spent on thinking-loop detection while streaming long reasoning ([#14284](https://github.com/can1357/oh-my-pi/pull/14284) by [@abilliontokens](https://github.com/abilliontokens)).
- Added `recordAffinity: false` to credential resolution options, selecting as the session would without pinning the choice to that session ([#14512](https://github.com/can1357/oh-my-pi/pull/14512) by [@will-bogusz](https://github.com/will-bogusz))

### Fixed

- Fixed replayed Responses and Codex history, including persisted Codex user/developer and assistant items, sending `detail: "original"` images to endpoints whose `supportsImageDetailOriginal` is off ([#13687](https://github.com/can1357/oh-my-pi/pull/13687) by [@alphastorm](https://github.com/alphastorm)).
- Fixed thinking in turns kept after Anthropic native compaction being rejected or dropped on the next request ([#14251](https://github.com/can1357/oh-my-pi/pull/14251) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Claude usage being re-polled every 10 seconds while Anthropic rate-limits the account; a failed refresh now waits a minute before trying again ([#14515](https://github.com/can1357/oh-my-pi/pull/14515) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Devin requests skipping the `onPayload` hook, so payload capture now sees each Devin chat request and a returned replacement is what gets sent ([#14506](https://github.com/can1357/oh-my-pi/pull/14506) by [@will-bogusz](https://github.com/will-bogusz))
- An OpenAI Responses turn whose connection drops mid-stream can now recover the finished answer from the provider (on hosts that store results, such as Muse Code) instead of re-running the whole turn and discarding the reasoning already done. Storage is opt-in: pass `storeResponses: true`, set `PI_MUSE_STORE_RESPONSES=1`, or set a process-wide default with `configureProviderStoreResponses` ([#14293](https://github.com/can1357/oh-my-pi/pull/14293) and [#14534](https://github.com/can1357/oh-my-pi/pull/14534) by [@abilliontokens](https://github.com/abilliontokens)).
- Fixed the auth broker exiting when a background OAuth refresh sweep cannot read the credential store; the failure is now logged and the next sweep retries ([#14538](https://github.com/can1357/oh-my-pi/issues/14538))
- Fixed Anthropic OAuth billing headers changing during developer-first sessions and side turns, preserving the prompt-cache prefix ([#14495](https://github.com/can1357/oh-my-pi/issues/14495)).
- Fixed OpenAI-compatible chat-completions gateways recording completed turns as client-cancelled because the connection closed before their `[DONE]` sentinel arrived ([#14481](https://github.com/can1357/oh-my-pi/issues/14481)).

## [1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- 网关身份头统一 `x-zeta-*`（消费方同步）；新增 `extractHttpStatusFromError`/`extractRetryHint` 导出。

### Fixed

- Fixed Antigravity chat and image requests sending an outdated client version when the model list came from cache, which could make newer models such as Claude Opus 5.5 unavailable.
- When a DeepSeek model writes a broken DSML tool call (for example with the opening `<｜DSML｜tool_calls>` and `<｜DSML｜invoke>` tags missing), its closing tags are now kept in the streamed text instead of being dropped. This lets the agent remove exactly the broken call while keeping any text after it ([#14202](https://github.com/can1357/oh-my-pi/pull/14202) by [@H4vC](https://github.com/H4vC)).

Older entries are archived in [packages/ai/CHANGELOG.md@a20cc0d04b64](https://github.com/can1357/oh-my-pi/blob/a20cc0d04b64f4a68fcc559cbd258743d984c50e/packages/ai/CHANGELOG.md).
