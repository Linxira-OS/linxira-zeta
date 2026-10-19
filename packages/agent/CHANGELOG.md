## [Unreleased]

## [1.3.1] - 2026-10-19

### Changed

- The failed-tool-call correction sent to DeepSeek models now also covers chat-template tool-call tokens written out as text, not only malformed DSML ([#16216](https://github.com/can1357/oh-my-pi/pull/16216) by [@H4vC](https://github.com/H4vC))

### Fixed

- Fixed Ollama chat history estimates counting stripped native thinking and missing foreign thinking replayed as text, which skewed compaction after model switches ([#16164](https://github.com/can1357/oh-my-pi/issues/16164))

## [9.2.2] - 2026-01-31

### Added

- Added toolChoice option to AgentPromptOptions for controlling tool selection

## [8.2.0] - 2026-01-24

### Changed

- Updated TypeScript configuration for better publish-time configuration handling with tsconfig.publish.json

## [8.0.0] - 2026-01-23

### Added

- Added `nonAbortable` option to tools to ignore abort signals during execution

## [6.8.0] - 2026-01-20

### Changed

- Updated proxy stream processing to use utility function for reading lines

## [6.2.0] - 2026-01-19

### Added

- Enhanced getToolContext to receive tool call batch information including batchId, index, total count, and tool call details

## [5.6.7] - 2026-01-18

### Fixed

- Added proper tool result messages for tool calls that are aborted or error out
- Ensured tool_use/tool_result pairing is maintained when tool execution fails

## [4.6.0] - 2026-01-12

### Changed

- Modified assistant message handling to split messages around tool results for improved readability when using Cursor tools

### Fixed

- Fixed tool result ordering in Cursor mode by buffering results and emitting them at the correct position within assistant messages

## [4.3.0] - 2026-01-11

### Added

- Added `cursorExecHandlers` and `cursorOnToolResult` options for local tool execution with cursor-based streaming
- Added `emitExternalEvent` method to allow external event injection into the agent state

## [4.0.0] - 2026-01-10

### Added

- Added `popLastSteer()` and `popLastFollowUp()` methods to remove and return the last queued message (LIFO) for dequeue operations
- `thinkingBudgets` option on `Agent` and `AgentOptions` to customize token budgets per thinking level
- `sessionId` option on `Agent` to forward session identifiers to LLM providers for session-based caching

### Fixed

- `minimal` thinking level now maps to `minimal` reasoning effort instead of being treated as `low`

## [3.33.0] - 2026-01-08

### Fixed

- Ensured aborted assistant responses always include an error message for callers.
- Filtered thinking blocks from Cerebras request context to keep multi-turn prompts compatible.

## [3.21.0] - 2026-01-06

### Changed

- Switched from local `@linxiraos/pi-ai` to upstream `@mariozechner/pi-ai` package

### Added

- Added `sessionId` option for provider caching (e.g., OpenAI Codex session-based prompt caching)
- Added `sessionId` getter/setter on Agent class for runtime session switching

## [3.20.0] - 2026-01-06

### Breaking Changes

- Replaced `queueMessage`/`queueMode` with steering + follow-up queues: use `steer`, `setSteeringMode`, and `getSteeringMode` for mid-run interruptions, and `followUp`, `setFollowUpMode`, and `getFollowUpMode` for post-turn messages
- Agent loop callbacks now use `getSteeringMessages` and `getFollowUpMessages` instead of `getQueuedMessages`

### Added

- Added follow-up message queue support so new user messages can continue a run after the agent would otherwise stop
- Added `RenderResultOptions.spinnerFrame` for animated tool-result rendering

### Changed

- `prompt()` and `continue()` now throw when the agent is already streaming; use steering or follow-up queues instead

## [3.4.1337] - 2026-01-03

### Added

- Added `popMessage()` method to Agent class for removing and retrieving the last message
- Added abort signal checks during response streaming for faster interruption handling

### Fixed

- Fixed abort handling to properly return aborted message state when stream is interrupted mid-response

## [1.341.0] - 2026-01-03

### Added

- Added `interruptMode` option to control when queued messages interrupt tool execution.
- Implemented "immediate" mode (default) to check queue after each tool and interrupt remaining tools.
- Implemented "wait" mode to defer queue processing until the entire turn completes.
- Added getter and setter methods for `interruptMode` on Agent class.

## [1.337.1] - 2026-01-02

### Changed

- Forked to @oh-my-pi scope with unified versioning across all packages

## [1.337.0] - 2026-01-02

Initial release under @oh-my-pi scope. See previous releases at [badlogic/pi-mono](https://github.com/badlogic/pi-mono).

## [1.3.0] - 2026-10-18

### Fixed

- Fixed Cursor turns failing with `PROVIDER_ERROR` when a follow-up (a finished background job, a late diagnostic, a reminder) arrived while the previous turn was still streaming ([#15821](https://github.com/can1357/oh-my-pi/pull/15821) by [@robfeldmann](https://github.com/robfeldmann))
- Cancelling an `ask` after a background job finishes now reports the user cancellation instead of telling the model to retry a skipped tool ([#15985](https://github.com/can1357/oh-my-pi/issues/15985))
- Fixed a Cursor tool call re-sent by the server persisting two results under one id; the re-run's result replaces the first ([#15749](https://github.com/can1357/oh-my-pi/issues/15749))
- Fixed compaction keeping more recent history than `keepRecentTokens` when the latest Claude turn on the Anthropic Messages API ended its tool calls on `stop` or `length`: the replay keeps that turn's signed reasoning, but the cut point counted only its visible blocks ([#15791](https://github.com/can1357/oh-my-pi/pull/15791) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Claude context counts reading Opus 5.5 requests about 55% over their billed input: a replayed thinking turn now counts at the output size Claude billed for it, not its signature's bytes ([#15446](https://github.com/can1357/oh-my-pi/pull/15446) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed screenshots and other non-frame images being counted at the OpenAI rate for every model instead of the reading model's own; Claude billed them about 16% higher ([#15446](https://github.com/can1357/oh-my-pi/pull/15446) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed OpenAI Responses and Codex context estimates leaving out replayed reasoning: each turn whose encrypted reasoning actually replays now counts its reported reasoning tokens (its ciphertext when the backend reports none), and none while a cold session rebuilds it out of the request, so compaction and snapcompact sizing match billing; branch summaries no longer budget for encrypted reasoning they never send ([#15447](https://github.com/can1357/oh-my-pi/pull/15447) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed a Claude compaction or branch summarizer receiving assistant reasoning from a snapcompact archive rendered under another model, which Claude refuses (`reasoning_extraction`) ([#15436](https://github.com/can1357/oh-my-pi/pull/15436) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed native (OpenAI/Codex) remote compaction refusing or truncating sessions that fit the window: its preflight counted the JSON-escaped request, inflating quote-, backslash- and newline-heavy tool output such as disassembly by ~10–20%; it now counts text as the model reads it ([#15712](https://github.com/can1357/oh-my-pi/pull/15712) by [@H4vC](https://github.com/H4vC))
- Fixed OpenAI V1/V2 remote compaction failing outright when the history, kept tail included, exceeds the context window (a large final response or tool output after the last check); it retries on the history before the kept tail ([#15712](https://github.com/can1357/oh-my-pi/pull/15712) by [@H4vC](https://github.com/H4vC))
- Fixed fitted output caps overflowing the context window on strict hosts (llama.cpp-family) after turns with many parallel tool results; chat-template framing is now charged per locally counted message ([#15699](https://github.com/can1357/oh-my-pi/issues/15699))
- Fixed leaked DeepSeek DSML markup reaching saved history from reasoning blocks and from turns that also made a valid tool call ([#15485](https://github.com/can1357/oh-my-pi/issues/15485))

### Added

- `prepareQueuedMessages` receives which queue (`steering` or `followUp`) a batch came from ([#16026](https://github.com/can1357/oh-my-pi/pull/16026))
- `agent_start` carries `resumedToolCallIds` when a continued run first executes the calls of an unpaired assistant tail
- `Tokenizer.countLatestTurn`: counts a message as the transcript's latest assistant turn, which an Anthropic Messages replay keeps byte-for-byte ([#15791](https://github.com/can1357/oh-my-pi/pull/15791) by [@will-bogusz](https://github.com/will-bogusz))
- `Agent.prioritizeSteering`: moves given pending steering messages ahead of older ones so one-at-a-time delivery takes them first ([#15642](https://github.com/can1357/oh-my-pi/pull/15642))
- Added `AgentLoopConfig.onDetachedToolUpdate`: a tool's `onUpdate` frames that arrive after its run's event stream ended (a returned call whose background job keeps reporting) reach it instead of being dropped; `Agent` forwards them to its subscribers as `tool_execution_update` events
- `AgentTool.formatApprovalDetails` receives `ApprovalDetailsOptions`; `compact: true` asks for untruncated bodies so a compact approval prompt can count their lines ([#15550](https://github.com/can1357/oh-my-pi/pull/15550) by [@H4vC](https://github.com/H4vC))
- `AgentTool.delegationGuidance`: instructions a same-name extension replacement inherits in its description when it delegates to the native tool ([#15477](https://github.com/can1357/oh-my-pi/pull/15477) by [@iliaal](https://github.com/iliaal))
- `CompactionPreparation.lastSummarizedEntryId` and `CompactionResult.providerReplayThroughEntryId`: a remote compaction that could only fit the history before the kept tail reports the last entry its native history covers; later entries replay normally ([#15712](https://github.com/can1357/oh-my-pi/pull/15712) by [@H4vC](https://github.com/H4vC))

### Breaking Changes

- Removed `estimateImageContentTokens()` from `@linxiraos/pi-agent-core/image-tokens`; use `Tokenizer.imageTokens(size, detail)`, which prices with the reading model's catalog image rule ([#15446](https://github.com/can1357/oh-my-pi/pull/15446) by [@will-bogusz](https://github.com/will-bogusz))
- `applyShakeRegion()` and `applyShakeRegions()` take the replacement's token count (`replacementTokens`); a block rewrite of an assistant turn adds the tokens it removes to `elidedOutputTokens`, so a replayed Claude turn's count stays lowered after a reload ([#15446](https://github.com/can1357/oh-my-pi/pull/15446) by [@will-bogusz](https://github.com/will-bogusz))
- Removed `ApprovalDetailsOptions`; `formatApprovalDetails` takes only `args` again, since the compact approval prompt no longer shows tool details ([#15642](https://github.com/can1357/oh-my-pi/pull/15642) by [@H4vC](https://github.com/H4vC))

### Changed

- Before-model-call hooks now receive the loop context as a second argument, and `buildProviderContext` receives the summarizer model ([#15436](https://github.com/can1357/oh-my-pi/pull/15436) by [@will-bogusz](https://github.com/will-bogusz))

## [1.2.0] - 2026-10-12

- 版本线推进至 1.2.0；本版无独立用户可见变化。

## [1.1.27] - 2026-10-07

- 版本线推进至 1.1.27；本版无独立用户可见变化。

## [1.1.25] - 2026-10-03

- 版本线推进至 1.1.25；本版无独立用户可见变化。

## [1.1.24] - 2026-10-03

- 上游 v18.4.11 集成：goal 命令与 Zeta goal/vibe mode 共存（GoalRuntime 共享）；跨面 token 对双端清扫（统一 `__zeta_worker_*`）。

## [1.1.19] - 2026-09-22

- 版本线推进;本版无独立用户可见变化。

## [1.1.18] - 2026-09-22

- 包元数据:author/maintainer 更新为 Linxira-OS,LICENSE 追加 Linxira-OS 版权行(发行面变更)。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 同步:工具 schema 注入 stamp 记忆化、代理工具调用流式 JSON 解析。

## [0.38.0] - 2026-01-08

### Added

- `thinkingBudgets` option on `Agent` and `AgentOptions` to customize token budgets per thinking level ([#529](https://github.com/badlogic/pi-mono/pull/529) by [@melihmucuk](https://github.com/melihmucuk))

## [0.37.3] - 2026-01-06

### Added

- `sessionId` option on `Agent` to forward session identifiers to LLM providers for session-based caching.

## [0.37.0] - 2026-01-05

### Fixed

- `minimal` thinking level now maps to `minimal` reasoning effort instead of being treated as `low`.

## [0.32.0] - 2026-01-03

### Breaking Changes

- **Queue API replaced with steer/followUp**: The `queueMessage()` method has been split into two methods with different delivery semantics ([#403](https://github.com/badlogic/pi-mono/issues/403)):
   - `steer(msg)`: Interrupts the agent mid-run. Delivered after current tool execution, skips remaining tools.
   - `followUp(msg)`: Waits until the agent finishes. Delivered only when there are no more tool calls or steering messages.
- **Queue mode renamed**: `queueMode` option renamed to `steeringMode`. Added new `followUpMode` option. Both control whether messages are delivered one-at-a-time or all at once.
- **AgentLoopConfig callbacks renamed**: `getQueuedMessages` split into `getSteeringMessages` and `getFollowUpMessages`.
- **Agent methods renamed**:
   - `queueMessage()` → `steer()` and `followUp()`
   - `clearMessageQueue()` → `clearSteeringQueue()`, `clearFollowUpQueue()`, `clearAllQueues()`
   - `setQueueMode()`/`getQueueMode()` → `setSteeringMode()`/`getSteeringMode()` and `setFollowUpMode()`/`getFollowUpMode()`

### Fixed

- `prompt()` and `continue()` now throw if called while the agent is already streaming, preventing race conditions and corrupted state. Use `steer()` or `followUp()` to queue messages during streaming, or `await` the previous call.

## [0.31.0] - 2026-01-02

### Breaking Changes

- **Transport abstraction removed**: `ProviderTransport`, `AppTransport`, and `AgentTransport` interface have been removed. Use the `streamFn` option directly for custom streaming implementations.
- **Agent options renamed**:
   - `transport` → removed (use `streamFn` instead)
   - `messageTransformer` → `convertToLlm`
   - `preprocessor` → `transformContext`
- **`AppMessage` renamed to `AgentMessage`**: All references to `AppMessage` have been renamed to `AgentMessage` for consistency.
- **`CustomMessages` renamed to `CustomAgentMessages`**: The declaration merging interface has been renamed.
- **`UserMessageWithAttachments` and `Attachment` types removed**: Attachment handling is now the responsibility of the `convertToLlm` function.
- **Agent loop moved from `@linxiraos/pi-ai`**: The `agentLoop`, `agentLoopContinue`, and related types have moved to this package. Import from `@linxiraos/pi-agent` instead.

### Added

- `streamFn` option on `Agent` for custom stream implementations. Default uses `streamSimple` from pi-ai.
- `streamProxy()` utility function for browser apps that need to proxy LLM calls through a backend server. Replaces the removed `AppTransport`.
- `getApiKey` option for dynamic API key resolution (useful for expiring OAuth tokens like GitHub Copilot).
- `agentLoop()` and `agentLoopContinue()` low-level functions for running the agent loop without the `Agent` class wrapper.
- New exported types: `AgentLoopConfig`, `AgentContext`, `AgentTool`, `AgentToolResult`, `AgentToolUpdateCallback`, `StreamFn`.

### Changed

- `Agent` constructor now has all options optional (empty options use defaults).
- `queueMessage()` is now synchronous (no longer returns a Promise).
