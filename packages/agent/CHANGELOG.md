## [Unreleased]

- Added `Agent.setModelResolver()` to fit every model an agent adopts (via `setModel`, starting with the current one) before it is used ([#15048](https://github.com/can1357/oh-my-pi/pull/15048) by [@H4vC](https://github.com/H4vC))
- Added `CompactionSettings.baseWindowTokens`: when set, `resolveThresholdTokens()` scales its percentage or reserve-based threshold from that base instead of the full context window ([#15065](https://github.com/can1357/oh-my-pi/pull/15065) by [@H4vC](https://github.com/H4vC))
### Added

- Added support for warm-cache-aware conversation pruning, keeping pruned history within the model’s prompt-cache lookback window while preserving Anthropic prompt-cache efficiency.
- Added `AgentLoopConfig.hasQueuedAsides` (also available on `Agent`) to allow interruptible waits to detect queued asides without consuming them or signaling other tools.

### Changed

- Improved performance when pruning tool output and capturing telemetry messages during long-running sessions.

### Fixed
- Fixed OpenAI V1 remote compaction re-attaching a prior Anthropic native payload after a successful compact ([#15041](https://github.com/can1357/oh-my-pi/pull/15041) by [@PaleRoses](https://github.com/PaleRoses))
- Fixed `resolveThresholdTokens()` clamping a positive `thresholdTokens` to `baseWindowTokens`; a fixed threshold is checked against the real window, and the base only rescales the percentage and reserve policies ([#15074](https://github.com/can1357/oh-my-pi/pull/15074) by [@H4vC](https://github.com/H4vC))
- Fixed `resolveThresholdTokens()` clamping a fixed `thresholdTokens` at or past the context window to one token below it, so compaction fired only after the next request overflowed; it now clamps to the window less the reserve ([#15146](https://github.com/can1357/oh-my-pi/pull/15146) by [@will-bogusz](https://github.com/will-bogusz))

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
