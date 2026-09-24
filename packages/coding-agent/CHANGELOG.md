# Changelog

## [Unreleased]

- **agent ↔ editor 双向切换**:`/editor` 命令与右上角圆角按钮写 handoff(cwd/gitRoot/sessionFile/file:line:col)后 detached spawn editor;配套 `editor.autoInstall` / `editor.handoffSession` 设置键(挂 interaction→Agent 组)。
- **`/teamagent` 指令**:crew 角色 → 标准 AgentDefinition 写 `<project|user>/.zeta/agents`,含 add/remove/agents/roles/status/profile.list/charter.show 七动词。
## [1.1.20] - 2026-09-23
## [18.3.0] - 2026-09-24

### Breaking Changes

- The `hub` tool is deprecated; use `wait`, `write`, and the `proc://` protocols instead.
- The `irc.timeoutMs` configuration setting has been removed.
- The edit mode syntax now uses `*** Edit File:`, `*** Find`, and `*** Replace` headers instead of `SM:` headers.
- Cancelling a process through `write` now requires an explicit `proc://<id>/kill` target; other write targets validate content normally.

### Added

- Added `omp://` documentation scopes for `find` and `omp find`. Search all embedded harness documentation with `omp://` or a specific document with `omp://<file>.md`; results are returned as canonical URLs that `read` can open, including range selectors.
- Added extension support for ephemeral, `/btw`-style side turns through `ctx.runEphemeralTurn()`, with optional tool suppression and output/context limits without adding the turn to session history.
- Added background job and service management through the `wait` tool and `proc://` URLs, including supervised services in `bash` and direct agent messaging through `agent://` write targets.
- Added `*** Insert Before` and `*** Insert After` edit operations for adding lines without replacing existing code.
- Added the `toks` command for offline token counting, including support for Jev (TypeSafe Jev 1.13) encodings.
- Added automatic discovery of Apple Foundation Models on supported Apple silicon devices.
- Added `/changelog last [N]` for viewing the latest release or a selected number of recent releases.
- Added terminal-based OAuth authentication with `omp login`, including browser-assisted login, account and organization details, and automatic model discovery refresh. Added provider support for `org-scoped-identity`, `oauth-token-env`, and per-account OAuth priority/reserve policies through `auth.accountPolicies`, with policy state shown by `omp usage`.
- Added the `daybreak` badge to `omp usage` for enabled accounts.
- Added `/export` and `/usage` to focused subagent views for exporting a focused transcript and viewing account usage without returning to the main session.
- Pasted clipboard images are now saved in the session artifact directory, allowing agents to read, copy, or upload them by file path.
- Added `/annotate` for attaching notes to diffs, replies, session messages, files, or quoted text and inserting or sending those notes in prompts and reviews.
- Added configurable MCP startup behavior through `MCP_STARTUP_TIMEOUT_MS`/`mcp.startupTimeoutMs` and `OMP_MCP_REQUIRE_READY=1`, allowing headless runs to require MCP servers to become ready before the first turn.
- Added native judgment usage reporting, including error stop reasons and messages, and added `openrouter/~typesafe/jev-latest` as a native judge candidate.

### Changed

- Session compaction now supports native Anthropic snapshot branches and rewinds.
- The default `bash.autoBackground.strategy` is now `catalog`.
- The `Launch` configuration group has been renamed to `Services`.
- Terminal OAuth behavior is now consistent between `omp login` and `omp auth-broker login`.
- Judgment fallback now uses only native candidates, preventing prompted models from replacing failed native judges.
- Browser screenshot comparisons now tolerate minor rasterizer differences.

### Fixed

- Fixed credential-aware API key resolution during authentication rotation.
- Fixed comma-separated line selectors in `read`, `grep` paths, and `fetch`; selectors now read the requested range, while a bare number selects only that line.
- Fixed `write` reporting JavaScript character counts instead of UTF-8 byte counts.
- Fixed background job and service status reporting, including incorrect durations, reused job IDs, stale logs after named-service restarts, and foreground calls incorrectly appearing as background jobs.
- Fixed `wait` and agent messaging so completed subagent results and peer messages are delivered reliably, including when a wait is interrupted by an incoming message.
- Fixed headless print mode dropping or silently ignoring MCP servers that start slowly; it now waits within the configured timeout and warns when a server is not ready.
- Fixed reader-mode `fetch` sending inline SVG icons and base64 images as unreadable model input; alt text is retained instead.
- Fixed long non-Latin judged TTSR output exceeding token limits by applying token-aware truncation.

## [18.2.11] - 2026-09-23

### Fixed

- Fixed nested `eval` Todo updates not being reflected by the Todo tracker, including cases where a cell fails after committing an update.
- Fixed strict-mode structured-output validation for JSON Schemas without a root `type`, preserving their `items` and `required` keywords.
- Improved streamed TTSR whole-buffer matching to avoid repeated scans from the beginning of the buffer.
- Fixed plural browser queries when compiled binaries provide shallow stack traces.
- Fixed browser `tab.fill` timing out on pages whose animation frames stall.
- Fixed the first LSP diagnostics request returning no results while a newly started language server is still analyzing.
- `/shake thinking` now reports the number of tokens freed.

## [18.2.10] - 2026-09-22

### Added

- Added live benchmark results table with real-time model ranking and per-kind performance metrics
- Added dedicated prefill throughput reporting for prefill-focused benchmarks
- Added `/record` slash command to capture terminal sessions as replayable `.ompcast` files
- Added `omp play` CLI for terminal-based playback of session recordings
- Added intent descriptions to judgment batching
- Added live progress tracking for judgment batches in the TUI

### Changed

- Refined AI-assisted git staging verification to reduce false positives
- Updated `omp bench` default profile to `chat` and improved CLI flag documentation
- Coalesced judgment batch drain operations for better performance under high load

## [18.2.9] - 2026-09-22

### Added

- Added Claude saved resets to usage views and `/usage reset`, with automatic blocked-limit recovery and expiring-reset redemption controlled by `claudeResets`.
- Added support for searching embedded harness documentation with `find` and `omp find` using `omp://` scopes, including file-specific searches and `:start-end` selectors; results open directly through canonical `omp://` URLs.

### Changed

- Updated server-side fallback documentation and logic to target claude-opus-5-5
- Added support for claude-opus-5-5 to model priority registry
- Updated the read tool guidance to decode images inline by default and require an explicit `:img` selector for SVG rendering.
- Improved model discovery and fallback behavior: authentication failures are surfaced in the `/models` hub, and models without a matching role-specific fallback now use the default fallback chain.
- Improved resilience for subagents by retrying provider stream failures that occur after partial output and preserving configured ordered model fallbacks at startup.
- MCP OAuth with Google issuers now requests offline access so refresh tokens can be issued; repeated auth-broker token rotations also preserve the required refresh and client metadata.
- MCP servers from omp-plugins now expand `${CLAUDE_PLUGIN_ROOT}` and `${OMP_PLUGIN_ROOT}` in commands, arguments, and working directories.
- `/review` now uses the session's current working directory after `/move` or `/wt`.
- Pasted and dragged image files now retain their original filesystem paths so the agent can act on the source files directly.
- Custom sessions can now be moved across filesystems without losing transcripts or artifacts.
- `hub jobs` now returns a compact, non-consuming status summary instead of replaying completed output or consuming pending auto-delivery.
- The display-reset shortcut now works while the ask dialog has keyboard focus, and `tab.press()` provides a clear error for the legacy argument order.
- Wayland keyboard input now follows the compositor's active XKB layout instead of assuming a US layout.
- LSP diagnostics now refresh when watched files are created or deleted and after a server reload.
- Compiled bytecode binaries now start correctly when bundled dependencies use `import.meta.resolve`.

### Fixed

- Fixed JavaScript `eval` assignments in cells containing top-level `await` so they persist into subsequent cells.
- Fixed skill hints becoming out of sync with the active prompt after discarded rebuilds and in advisor sessions.
- Restored `pi.pi.askToolRenderer` for extensions that replace the built-in ask tool, preserving native rendering.
- Fixed npm plugin upgrades and reinstalls leaving stale or duplicate manifest entries that could break `bun install`.
- Fixed `eval` waits longer than approximately 24.8 days returning immediately because of native timer overflow.
- Fixed deleted sessions being resurrected from stale rewrite backups.
- Fixed `/collab` relay connections honoring `HTTPS_PROXY` and `NO_PROXY`.
- Fixed sessions remaining blocked by queued turns or Hindsight auto-recall after disposal or cancellation.
- Fixed edits to auto-generated files aborting the entire turn; they now return a tool-scoped error.
- Fixed Edit handling of invalid overlapping selections in multibyte text so the worker reports a match error instead of panicking.
- Fixed local memory consolidation on case-insensitive filesystems when project path casing changes between launches.
- Fixed first-time Xcode MCP connections on macOS by allowing the signed `omp` binary to request Apple Events permission.
- Fixed stale or duplicated TTSR trigger events during streaming.
- Fixed MCP OAuth credentials retaining their refresh endpoint and client metadata across repeated token rotations.
- Fixed local model and provider retry behavior for streamed and partially buffered failures.
- Fixed memory and session cleanup issues that could leave stale artifacts or inconsistent state.
- `lsp.formatOnWrite` now prefers a dedicated `isLinter` formatter server when a type-checker also claims the file ([#12847](https://github.com/can1357/oh-my-pi/pull/12847) by [@roboomp](https://github.com/roboomp)).
- `/extensions` no longer shows OMP-installed marketplace capabilities as disabled behind the foreign-plugin opt-in gate ([#12849](https://github.com/can1357/oh-my-pi/pull/12849) by [@roboomp](https://github.com/roboomp)).

### Removed

- Removed support for image query parameters (`?q=`) and bare image paths in the read tool.
- Custom models now honor provider-level `transport: pi-native` and send requests to the native gateway ([#12845](https://github.com/can1357/oh-my-pi/pull/12845) by [@joshrzemien](https://github.com/joshrzemien)).
- Fixed live models that match no `retry.fallbackChains` role primary (e.g. Fable after `/model`) resolving no chain, so a wait longer than `retry.maxDelayMs` aborted the session instead of walking `default` ([#12421](https://github.com/can1357/oh-my-pi/issues/12421)).
- Fixed skill hints drifting from the active prompt after discarded rebuilds or in advisor sessions ([#12148](https://github.com/can1357/oh-my-pi/pull/12148) by [@jerome-benoit](https://github.com/jerome-benoit)).
- Restored `askToolRenderer` on the extension namespace (`pi.pi.askToolRenderer`) after the pi-tui renderer migration dropped it, so extensions that shadow the built-in ask tool can keep the native rendering again. ([#12694](https://github.com/can1357/oh-my-pi/pull/12694) by [@xiechimon](https://github.com/xiechimon))
- Model discovery rejected with 401/403 now surfaces an authentication error in the /models hub instead of a silently empty model list. ([#12436](https://github.com/can1357/oh-my-pi/pull/12436) by [@xiechimon](https://github.com/xiechimon))
- Pasted or dragged image files now reach the agent with their original filesystem path, so it can read and act on the source file directly; clipboard screenshots keep working unchanged. ([#12404](https://github.com/can1357/oh-my-pi/pull/12404) by [@xiechimon](https://github.com/xiechimon))
- `/review` now runs VCS operations against the live session cwd after `/move` or `/wt` instead of the session-start checkout ([#12712](https://github.com/can1357/oh-my-pi/pull/12712) by [@F0Rextasy](https://github.com/F0Rextasy)).
- Reinstalling or upgrading an npm plugin no longer leaves stale or duplicate manifest edges that broke `bun install` ([#12727](https://github.com/can1357/oh-my-pi/pull/12727) by [@F0Rextasy](https://github.com/F0Rextasy)).
- TTSR now emits one `ttsr_triggered` event per streamed violation instead of one per evaluation pass ([#12729](https://github.com/can1357/oh-my-pi/pull/12729) by [@F0Rextasy](https://github.com/F0Rextasy)).
- Eval `wait()` timeouts above ~24.8 days no longer overflow the native timer and return immediately ([#12731](https://github.com/can1357/oh-my-pi/pull/12731) by [@F0Rextasy](https://github.com/F0Rextasy)).
- MCP OAuth against Google issuers now requests `access_type=offline` so refresh tokens are issued ([#12737](https://github.com/can1357/oh-my-pi/pull/12737) by [@F0Rextasy](https://github.com/F0Rextasy)).
- Deleting a session now also removes its stale `.bak` rewrite backups so the picker cannot resurrect it ([#12746](https://github.com/can1357/oh-my-pi/pull/12746) by [@F0Rextasy](https://github.com/F0Rextasy)).
- `/collab` relay WebSockets now honor `HTTPS_PROXY`/`NO_PROXY` like other transports ([#12762](https://github.com/can1357/oh-my-pi/pull/12762) by [@jacobcolyvan](https://github.com/jacobcolyvan)).
- `tab.press()` now rejects the inverted `press(selector, key)` call with a hint naming the corrected `(key, { selector })` form, instead of the key parser's opaque `Unknown key: <selector>` ([#12136](https://github.com/can1357/oh-my-pi/issues/12136)) ([#12266](https://github.com/can1357/oh-my-pi/pull/12266) by [@danilouchoa](https://github.com/danilouchoa)).
- The display-reset shortcut (`app.display.reset`, `alt+l` by default) now fires while the ask dialog holds keyboard focus, instead of being dropped silently; the #11215 global-listener promotion covered the other four editor display actions but missed this one ([#12217](https://github.com/can1357/oh-my-pi/issues/12217)) ([#12262](https://github.com/can1357/oh-my-pi/pull/12262) by [@danilouchoa](https://github.com/danilouchoa)).
- Custom sessions can move across filesystems without losing their transcript or artifacts ([#12360](https://github.com/can1357/oh-my-pi/issues/12360), [#12378](https://github.com/can1357/oh-my-pi/pull/12378) by [@Dante-dan](https://github.com/Dante-dan)).
- Fixed `hub jobs` replaying full output for every settled job and consuming pending auto-delivery; it now returns a compact non-consuming status summary ([#12547](https://github.com/can1357/oh-my-pi/pull/12547) by [@pedropaulovc](https://github.com/pedropaulovc)).
- Compiled bytecode binaries now start correctly when bundled dependencies use `import.meta.resolve` ([#12133](https://github.com/can1357/oh-my-pi/pull/12133) by [@andrebrait](https://github.com/andrebrait)).
- Subagents now retry provider stream errors that arrive after buffered partial output, and such failures are reported as transport errors instead of schema-invalid results ([#12752](https://github.com/can1357/oh-my-pi/pull/12752) by [@bse-ai](https://github.com/bse-ai)).
- Edits targeting auto-generated files now return a tool-scoped rejection instead of aborting the whole turn ([#12499](https://github.com/can1357/oh-my-pi/pull/12499) by [@Dante-dan](https://github.com/Dante-dan)).
- Subagents with an ordered model fallback keep it reachable on startup when the parent default role shares the same primary model ([#12377](https://github.com/can1357/oh-my-pi/pull/12377) by [@Dante-dan](https://github.com/Dante-dan)).
- omp-plugins MCP servers now substitute `${CLAUDE_PLUGIN_ROOT}`/`${OMP_PLUGIN_ROOT}` in `command`, `args`, and `cwd` ([#12801](https://github.com/can1357/oh-my-pi/pull/12801) by [@holny](https://github.com/holny)).

## [18.2.8] - 2026-09-21

### Added

- Added comprehensive browser automation tools for accessibility auditing, React inspection, console and network monitoring, performance tracing, semantic DOM queries, tab management, screen recording with cursor overlays, downloads, custom initialization scripts, persistent storage, and WebMCP cross-frame tool discovery.
- Added support for buffered cloud transcription with OpenAI-compatible models.
- Added visual change detection for video processing, including FFMPEG analysis and SVG overlays.
- Added support for declaring native judges through custom providers using the `typesafe` and `openrouter-decisions` API values, with configurable base URLs, API keys, and headers.

### Changed

- Expanded browser security and resilience controls with configurable HTTPS error handling, domain allow-listing, and automatic tab recycling when security-sensitive state changes.
- Updated background job notifications to deliver output as follow-up messages and discourage unnecessary polling.
- Expanded the bash tool's documented auxiliary utilities and removed its truncation footer notice.

### Fixed

- Improved responsiveness in long sessions by significantly reducing the time required to scan provider context for credential patterns.
- Fixed native judges failing to honor configured request headers, enabling authenticated and header-routed judge providers to work as configured.
- Fixed LSP requests hanging when aborted while waiting for an earlier write to complete.

## [18.2.7] - 2026-09-21

- 斜杠命令描述跟随 `/language` 实时切换(此前 import 时快照固化,切换只重建列表、文字停留 OS 语言);`/language` 文本模式补 `refreshCommands()`,ACP/RPC 客户端重新广告命令列表。

## [1.1.19] - 2026-09-22

- 内嵌 TTT 编辑器修复:无按键移动不再自动弹出右键菜单(按下沿检测,免疫终端 SGR release 残留位);About/--help 品牌面清理(上游链接移除);内嵌终端鼠标按钮映射与 tcell v3 语义对齐。

## [1.1.18] - 2026-09-22

- 全面板 i18n:宿主可注入 tuiText 文本层,约 700 个 key 覆盖全部 TUI 面板、设置、setup 场景与聊天/状态栏;`/language` 切换即时生效,无需重启。
- Tracking v2:`tracking_update` 新增 `sync_todo`(todo 阶段镜像进 status.json,阶段推进记录 phase_complete);全局追踪索引升级为对象行(含阶段/进度/最近会话);INDEX.md 首次使用自动落三读者模板;批准的 plan 镜像至 tracking/plans/;todo 阶段完成后自动提醒同步追踪文档。
- Web 网关新增 `GET /api/plan` 白名单端点(仅限当前会话 plan 文件),`/api/tracking` 追加压缩摘要与 plan 镜像列表,agent 状态暴露实时 todo 阶段。
- 修复 i18n 覆盖后 todo 警告选项丢失与测试语言钉扎问题。

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 同步:streaming CLI 命令、热路径记忆化(工具 schema/stamp/which 缓存)、TUI 主题与覆盖层组件迁移至 pi-tui、Astra 上下文确定性策略、eval 判定桥与 Python prelude 维护。
- 修复 bun 1.4.0 bytecode 编译产物启动崩溃(desktop smoke 全平台)。
- 设置项新增 Stream 分区与 stencil.so 流式认证。

## [1.1.13] - 2026-09-10

- 上游 v18.1.16 同步:任务执行器 AgentBusyError、事件循环 keepalive、idle 封装截止时间、上下文笔记等。
- 修复中文界面设置布尔项无法关闭的问题(显示文案误入机器值匹配)。
- `/language` 切换后斜杠命令描述即时刷新,无需重启。
- Plan/Plan-ultra/Vibe/Goal 模式横幅与 attach 模式提示接入 i18n;`/loop`、`/rename` 描述进目录。

## [1.1.11] - 2026-09-08

### Added

- Muse Code provider support end to end: subscription sign-in with credential refresh, inference, live account-scoped model discovery, and quota reporting in `/usage` with durable rate-limit backoff; Muse Code sessions send a compact hashline edit description (~3 KB less per request), all other providers keep the full prompt.

### Changed

- The startup update notice now counts every change in a release: bullets above a `###` heading count under Other, `+`/`*` markers and lightly indented bullets count like `-`, and standalone `* * *` / `- - -` separator lines no longer count as changes.

### Fixed

- GPT-6 Astra keeps its documented 1.05M-token window with `/extended-context` on or off; explicit per-model `contextWindow` overrides still win. Codex Astra defaults to 272K and clamps explicit overrides to the server-honored ceiling; the extended window bills at the documented 2x input / 1.5x output long-context tier above 272K input, while the Codex subscription route stays exempt with free cache writes.
- Fixed Extended Context silently enabling without a settings source (SDK embedding, early boot); it now matches the off default until opted in.
- Fixed fullscreen `/copy` link captions showing Markdown delimiters for formatted labels and splitting across two rows for multiline labels; it also outlines grouped Read cards correctly so Enter copies the assistant yield.
- Fixed Ask custom answers requiring another submission after paste or stalling on multi-select questions; pending clipboard text is preserved, single-question multi-select still goes through review.
- Fixed `/loop` replacing the repeating prompt with a mid-turn interjection: steering while the agent runs is one-off, and only an idle submission becomes the new loop body.
- `memory://` resolves against the session that issued it: a caller's own memory backend answers `memory://<id>`, co-located sessions no longer read each other's memory rows, and a dead caller fails closed; prompt completion binds to the same caller.
- Subagent `yield` no longer rejects a valid `data` payload when a non-strict OpenAI-compatible backend fills the optional `error` field with `""`.
- Zeta merge adaptation: the `/plan-ultra` command and its registry entry, plus localized slash-command descriptions, are guarded against being dropped by upstream merges (i18n contract test now enforces M.* keys).

## [1.1.10] - 2026-09-07
- Fixed `edit` auto-repair waiting up to 60 seconds when the `smol` model does not respond; it now times out after 20 seconds and reports repair start and timeout details.
- Fixed subagents leaving queued parent messages behind after tool interruptions.
- Fixed a subagent burning its whole run on `yield` calls that never finish it: an incremental-only `yield` turn no longer bypasses the request budget, and the forced final `yield` ends the run ([#12351](https://github.com/can1357/oh-my-pi/pull/12351) by [@pedropaulovc](https://github.com/pedropaulovc)).
- Fixed `browser.open({ app: { relay: true } })` waiting for the full tool timeout when no relay extension is installed or reachable; it now fails promptly with an actionable error while preserving the wait for a connected extension to recover.
- Fixed `edit` handling of ellipsis markers, inline closing tags, copy-ready corrections, and retries, including cases that could insert literal markers, misreport matches, omit the file target, or panic.
- Enabled `edit.enforceSeenLines` by default to reject hashline edits anchored to content that was not displayed, and prevented stale-tag recovery from applying edits to a structurally different duplicate construct ([#12369](https://github.com/can1357/oh-my-pi/pull/12369) by [@pedropaulovc](https://github.com/pedropaulovc)).
- Fixed startup failures when the plugins directory or its manifest cannot be read; inaccessible plugin roots are now skipped with a warning.
- Fixed generation token-rate displays for subagents and restored the main session's reading after switching focus.
- Fixed subagent HUD labels and plan filenames being populated with example prompt text on smaller models.
- Improved shell, file, session, and persistence operations to avoid unnecessary repeated work, improving responsiveness and resource usage.

## [1.1.9] - 2026-09-05

### Added

- OMP v18.1.10 sync baseline (`f241301c8372`): native Rust edit engine (EditStore/EditSession/DiffStream) behind the `edit` tool, `skillful` setting + `/skillful` per-session skill listing, agent emoji reactions (`tui.reactions`), plan-aware read window preserved for plan files, upstream security-scan command family rebranded, extension/agent discovery hardening.
- TUI settings page fully localized (zh): tabs, group headings, option values, footer hints, preview chrome and slash-command descriptions now follow the configured language; `/language` applies live.

### Fixed

- Sidebar renders again in production sessions: the gutter engine was anchored to the fallback render path after the upstream frame-provider refactor, so `tui.sidebar=true` drew nothing; provider frames now respect the reserved main width and paint the right gutter column. Sidebar content rebuilt to stop duplicating the status line (session header, todo/plan progress, subagent states, MCP health; empty panels hide).
- Channel tools (`channel_send`/`workspace_run`/`im_control`) are once again exclusive to top-level sessions — nested subagents can no longer relay to IM even when the tool names are requested explicitly; `tracking_update` gating restored.
- Windows installer (`install.ps1`) restored to the Zeta package/repo/binary names after the merge pulled the upstream OMP form back in.
- Base system prompt refresh only re-applies on byte-level changes, keeping the inherited provider prompt-cache key stable across explicit refreshes.
- i18n: zh catalog no longer carries OMP self-references; `/security` descriptions use the clean Zeta keys.
- Idle compaction now starts or reschedules when its enabled state, threshold, or delay changes while a session is already idle ([#10242](https://github.com/can1357/oh-my-pi/issues/10242)).
- Fixed `todo` and other tools called through eval rejecting optional `None`/`null` arguments that direct tool calls accept.
- Report oversized selected lines that cannot fit after read context, with a working raw recovery selector instead of a looping continuation hint ([#10775](https://github.com/can1357/oh-my-pi/issues/10775)).
- Approved plan content is now inlined into approve-and-execute prompts instead of forcing the executor to re-read the durable plan file ([#10923](https://github.com/can1357/oh-my-pi/issues/10923)).
- Fixed WorkPool child sessions crashing during startup while constructing their incremental `yield` tool schema.
- Commit summaries written in Vietnamese, Korean, and other accented scripts are no longer rejected for exceeding the length limit, and keep their accents as typed.
- Tool-scoped TTSR rules now match finalized arguments reliably when providers stream short or throttled tool calls ([#10910](https://github.com/can1357/oh-my-pi/issues/10910)).
- Restored `getSupportedThinkingLevels` in the legacy `pi-ai` shim so extensions importing it from `@earendil-works/pi-ai` (e.g. `@companion-ai/feynman`) pass Bun's named-export check and load ([#10800](https://github.com/can1357/oh-my-pi/issues/10800)).

## [1.1.6] - 2026-08-30

- Fixed prewalk conflicting with `todo.eager=always`: the forced eager-todo prelude ("call todo first this turn") was injected alongside the prewalk plan nudge ("write a complete plan first, then todo"), giving the model contradictory instructions; the eager-todo prelude is now suppressed only when prewalk will perform a handoff ([#10510](https://github.com/can1357/oh-my-pi/issues/10510)).
- Fixed `authHeader: true` + command-backed `apiKey` discovery providers (no explicit `headers:` block) resending a stale bearer after a 401 force-refresh; discovered models now re-derive `Authorization` from the live `apiKey` each request ([#10551](https://github.com/can1357/oh-my-pi/issues/10551)).
- Fixed the embedded shell's `command -v`/`-V` honoring only the first operand: it now iterates every name like bash/zsh, printing one line per resolved name and skipping misses ([#10544](https://github.com/can1357/oh-my-pi/issues/10544)).
- Fixed hard-killed subagents vanishing from the agent registry under concurrent fan-out: `AgentLifecycleManager.release` now applies the terminal `aborted` transition before awaiting the tombstone sidecar write, closing a race where the dying session's own dispose-path unregister deleted the ref instead of leaving it as a tombstone ([#10531](https://github.com/can1357/oh-my-pi/issues/10531)).
- `omp commit` now keeps extension-provided model credentials available in its nested commit-agent session ([#10528](https://github.com/can1357/oh-my-pi/issues/10528)).
- MCP tool results now surface `structuredContent`: servers that return their payload in the structured channel while keeping `content` a terse ack (e.g. rhizome-mcp) are no longer data-less to the model ([#10522](https://github.com/can1357/oh-my-pi/issues/10522)).
- Fixed the Agent Hub roster shuffling erratically while open: rows no longer re-sort on every agent heartbeat, so the list stays stable and navigable with many active agents ([#10524](https://github.com/can1357/oh-my-pi/issues/10524)).
- Exiting Vibe mode now removes its restrictions from subsequent model turns, including restored sessions ([#10500](https://github.com/can1357/oh-my-pi/issues/10500)).
- Fixed all-sessions listing (`Tab` in session picker) and cross-project resume failing when sessions are stored under `XDG_DATA_HOME`; `listAllSessions` now scans the active `getSessionsDir()` root instead of hardcoding `~/.zeta/agent/sessions`.
- Fixed the Nerd Font context icon showing a Windows logo instead of a generic window ([#10476](https://github.com/can1357/oh-my-pi/pull/10476) by [@erickmazer](https://github.com/erickmazer)).
- The debug terminal snapshot now reports Herdr (and CMUX) as the multiplexer wrapping the session, matching the TUI's pane-identity detection instead of only tmux/screen/zellij.
- Fixed vibe mode becoming un-exitable after branching a session (including via `/btw`), which previously failed with "Vibe parent session changed before mode exit could be persisted." ([#10468](https://github.com/can1357/oh-my-pi/issues/10468)).
- Fixed HTML session exports reordering interleaved assistant text, thinking, images, and tool calls in the transcript, and split matching text/tool sidebar rows with block-accurate navigation. ([#10253](https://github.com/can1357/oh-my-pi/pull/10253) by [@realcoderandom](https://github.com/realcoderandom))
- Fixed the built-in `grep` and `sed` treating a basic regular expression as an extended one: a bare `+` is now the literal and `\+` the operator, patterns like `^+` or `s/^\+/` no longer match every line, `^` anchors inside `\(…\)` and after `\|`, and a repetition operator with nothing to repeat is reported instead of silently selecting the whole file ([#10298](https://github.com/can1357/oh-my-pi/pull/10298) by [@mruangutai](https://github.com/mruangutai)).
- Fixed RPC `prompt` responses for `/skill:*` commands arriving only after the entire prompt-dispatch pipeline finished (usage preflight, compaction, provider calls): under provider stress that outlasts any client prompt timeout, so hosts reported the prompt as rejected while the turn was in fact running. The skill branch now builds the skill prompt eagerly (preserving the immediate error for an unreadable skill file) and dispatches the expensive pipeline asynchronously after answering, matching plain prompts; when the dispatch is cancelled before a turn starts (e.g. an abort overtakes usage preflight), the session now reports it through the non-invoked completion frame instead of leaving hosts waiting for an that never comes ([#10249](https://github.com/can1357/oh-my-pi/pull/10249) by [@cwr250](https://github.com/cwr250)).
- Fixed stale `omp-plugins.lock.json` entries loading leftover `node_modules` trees for plugins no longer declared in an existing `package.json` — the orphaned copy double-loaded its extensions. Lockfile-only plugins remain supported for manifest-less roots and symlinked packages (`omp plugin link`, marketplace runtime packages); stale entries are skipped with a warning.

## [1.1.5] - 2026-08-26

- 同步上游 OMP v18.0.5 / v18.0.6：git TUI 内置 conventional commit 生成与 `if-bench` 基准、`commit --legacy` 统一生成、`:img` 选择器渲染 SVG、新增 Yolo-Auto / OpenRouter 浏览器登录与 DeepInfra image_gen/tts。

### Fixed

- 修复 `/language` 与 `/tracking` 指令在 OMP v18.0.3 合并后未注册的问题（输入被当作普通消息；现已恢复注册并加合并护栏测试）。

## [1.1.4] - 2026-08-26

### Changed

- release 资产命名系统化：CLI 二进制统一为 `zeta-cli-*`，桌面安装包统一为 `zeta-desktop-<version>-<os>-<arch>`。

### Fixed

- 修复中文系统下 CLI 汉化自动检测失效（`language` 默认值不再顶掉环境检测，中文系统自动切换中文界面）。

## [1.1.3] - 2026-08-25

### Fixed

- Republished as 1.1.3 to reset the latest tag after the broken 1.1.2 (no functional change over 1.1.1).

## [1.1.2] - 2026-08-25

### Fixed

- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).

## [1.1.1] - 2026-08-25

### Fixed

- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").

## [1.1.0] - 2026-08-25

### Changed

- TUI 渲染升级至上游 v18.0.3 架构（provider window + resize 重绘），终端尺寸变化即时重绘。
- `zeta update` 改为异步增量更新，慢盘/大文件不再阻塞交互。
- Streaming edit guard 改为异步增量验证，大文件编辑不再卡顿。

### Fixed

- Julia 内核可用性探测加固（超时上限 + 进程组击杀），冷启动不再误判为不可用。
- 中文界面本地化覆盖（zh overlay，随 v18.0.4 合并）。

### Removed

- 配置目录统一 `.zeta`，移除 `.zeta` 兼容别名路径。

## [1.0.10] - 2026-08-19

### Added

- Added a web gateway `enter_plan_mode` command and a session `enterPlanMode` path so the web-ui `/plan` slash command actually enters plan mode (plan file, `write` tool, plan-approval wiring, optional initial prompt) instead of forwarding a literal message.
- Added an interactive confirm to `zeta update` before installing a new version (default no on non-TTY input); `--yes`/`-y` skips it.
- Added WeChat `/api/v1/wechat` login (QR + status polling) with legacy iLink fallback, persisted peer→context_token bindings in `web.yml` (`channels.wechat.peerTokens`), and a `POST /api/channels/wechat/unbind` gateway route that resets the channel and clears credentials.
- Added Feishu `bot_p2p_chat_entered` handling: the first private-chat contact gets an onboarding reply.
- Added `channels.allowedPeers` web-config allowlist: when non-empty, only listed peers may reach the agent.
- Added `ui:` metadata to `shellPath`, `retry.enabled`, `stt.language`, `searxng.categories/language/safesearch`, `compaction.reserveTokens/keepRecentTokens`, and `skills.enabled` so they are editable from the web settings panel.

### Changed

- WeChat login now prefers the new `/api/v1/wechat` endpoints (endpoint host configurable via `channels.wechat.endpoint`); older hosts fall back to the legacy iLink QR flow.
- Reworked the Ctrl+S Agent Hub into a responsive fullscreen roster and selected-agent inspector, featuring aggregate status/usage metrics, detailed per-agent views (task, model, activity, usage, lineage), roster and spawn-tree views, stable ordering, asynchronous persisted-session discovery, restored historical metadata, and improved keyboard and mouse navigation.
- Replaced `arktype` with `@linxiraos/omptype` for all tool parameter and configuration schemas, resulting in significantly faster startup times. Configuration schema errors are now reported via `OmpErrors` entries using the standard `path`/`problem` format.

### Fixed

- Fixed panel commands (such as `/usage` and `/advisor status`) appearing unresponsive during active turns by flushing the deferred-panel queue at every settle, terminal or not. The deferral itself stays silent: mounting a status line into the transcript mid-turn re-renders rows below the live block and duplicates them in native scrollback (issues #4806/#6767).
- Fixed the bundled `ts-no-tiny-functions` rule failing to match one-line arrow functions in files with trailing newlines.
- Fixed advisor refusals skipping the model fallback chain, and bounded refusal recovery to a single attempt per model to prevent infinite fallback loops.
- Fixed repeated `/mcp reauth` commands getting stuck by ensuring new reauthorization requests cancel and clean up any pending MCP OAuth login flows.
- Fixed WSL host-home resolution to build `/mnt/<drive>/...` fallback paths using POSIX semantics regardless of the host platform.
- Fixed Python evaluation shell helpers (`!cmd`, `%%bash`, `%pip`) letting child processes inherit the runner's stdin, which previously caused deadlocks on Windows. Additionally, `%%bash` now correctly resolves Git Bash on Windows.
- Fixed subagents spawned via model-role aliases incorrectly falling back to the `default` role's retry chain instead of their own configured role chain.
- Fixed Linux/X11 clipboard reads failing when `xclip` is missing but `xsel` is available.
- Hardened Linux Chromium executable detection to filter out non-executable files, invalid wrappers, and candidates that hang during version probes.
- Fixed Bash command preview crashes caused by malformed tool arguments containing non-string environment values.
- Fixed UI rendering in the model browser and model hub where `nerd`-preset role chips would overlap and obscure the first character of labels.
- Fixed Codex web search sending incompatible request shapes to certain models, which caused the hosted `web_search` tool to ignore them.
- Fixed resumed or rebuilt sessions incorrectly applying stale rewind reports from previous checkpoint cycles to new checkpoints.
- Fixed the `read` tool incorrectly parsing semicolon-delimited internal URLs (such as batched `skill://` resources) as a single invalid resource.
- Fixed `pi.getAllTools()` returning bare strings instead of `ToolInfo[]` objects, restoring compatibility with extensions built against the upstream contract.
- Fixed legacy extensions failing to load in compiled binaries when resolving bundled dependencies via dynamic `createRequire` factories.
- Fixed Wayland window activation and native input handling by correctly reporting them as unavailable rather than attempting unsupported foreground-delivery paths.
- Fixed live execution progress being hidden in the conversation view after approving a plan in the fullscreen Plan Review.
- Fixed `omp -r` failing to discover sessions created under the temporary hashed project-directory scheme by adding a one-way migration back to legacy path-based names.
- Prevented the `read` tool from advertising or resolving `memory://` URIs when the memory backend is disabled.
- Fixed the Shift-Tab thinking mode UI rendering the `off` state as a blank label, which made it appear that reasoning could not be disabled.
- Fixed parsing of POSIX `$EDITOR` commands that contain quoted arguments or executable paths with spaces.
- Fixed persisted Agent Hub rows losing the explicit caller model role when a subagent used a model override, preserving role provenance across restarts.
- Fixed unobserved promise rejections in browser helpers (such as `tab.waitForResponse()`) causing tab workers to hang or crash.
- Improved edit-tool error guidance for operations missing the `»` separator, identifying redundant context-only operations
- Fixed OAuth provider `modifyModels` projections being silently dropped after a discovery refresh introduced live-config headers.
- Edit-tool `＋`/`－` line operations now match their anchors leniently across whitespace drift (indentation, blank-line miscounts) instead of failing with a byte-for-byte error; a note reports the lenient match.
- Fixed an edit-tool REWRITE consisting only of `＋` add lines silently replacing (deleting) the matched text; it now inserts after the kept MATCH.
- Edit-tool no-match errors now name MATCH lines that exist nowhere in the file and suggest marking them with `＋`, and errors without a located region no longer append a misleading file-head "closest match" preview.
- Fixed ordinary CLI startup eagerly loading the computer worker graph (native desktop addon and early environment), restoring lazy startup and profile `.env` ordering.
- Fixed online auto-thinking classifier usage being omitted from session token and cost totals.
- Fixed image generation with custom provider endpoints when using `openai-codex` credentials and a non-OpenAI chat model.
- Fixed custom hook UI factories not receiving the documented `keybindings` argument.
- Fixed MCP OAuth token exchange for authorization endpoints that use a different resource indicator.
- Fixed custom extension `web_search` tools being shadowed by the built-in search tool.
- Fixed Agent Hub task boards collapsing to summary rows after returning from a focused session.
- Improved Linux ARM64 browser startup messaging when managed Chrome for Testing builds are unavailable, with guidance for using system Chromium or `PUPPETEER_EXECUTABLE_PATH`.
- Fixed resuming image-heavy sessions that previously terminated while replaying transcripts.
- Fixed custom agents declaring `hub` being incorrectly treated as read-only.
- Restored compatibility for legacy Pi extensions that import `calculateContextTokens` or use the synchronous `SettingsManager.create()` API.
- Fixed custom model overrides being lost during configuration updates.
- Clarified that the default task-delegation setting follows the selected model's policy.
- Fixed `/rename` without a title interrupting active session activity.
- Fixed the Nerd Font notification persisting incorrectly after theme configuration.
- Fixed sampling parameter errors with newer Anthropic models.
- Long OpenCode Go usage-limit waits now switch replay-safe turns to a configured alternate provider when the delay exceeds `retry.maxDelayMs`.
- Fixed OpenAI Codex Responses tool results being lost when composite and plain tool-call identifiers did not match.
- Fixed `/tan` background agents failing to resolve credentials for providers supplied by extensions.
- Fixed Mnemopi saving session transcripts on exit when automatic retention is disabled.
- Fixed configuration writes through chained symlinks so the final target and intermediate links are preserved.
- Fixed direct tool calls using full `xd://` device URLs.
- Fixed command-backed headers in custom discovery providers being resolved for discovered models.
- Fixed Windows drive paths pasted under WSL being resolved through their `/mnt/<drive>` mounts for images and file reads.
- Improved sloppy/SPARSE edit no-match guidance so low-confidence matches are clearly presented without unsafe copy-ready operations.
- Fixed agents in Hub wait loops failing to respond to user steering messages.
- Fixed `/tan` sessions inheriting parent costs and overstating subagent totals.
- Fixed prompt action labels being truncated.
- Fixed assistant text being truncated when a tool call begins during streaming.
- Fixed the advisor dropping concerns when catching up on multiple turns and improved review context with bounded tool-result excerpts plus complete `ask` exchanges.
- Fixed bash command timeouts being delayed by child processes holding output pipes open, while improving timeout reporting and cleanup.
- Fixed retry countdowns and capped-wait errors displaying floating-point noise in millisecond durations.
- Prevented browser `app.path` from terminating existing same-executable applications when no reusable CDP endpoint is available.
- Fixed top-level errors overwriting the active composer before terminal restoration.
- Fixed Enter being ignored during the first turn when omp starts with an initial prompt.
- Fixed idle compaction discarding context while the session was still waiting on a backgrounded async job ([#10223](https://github.com/can1357/oh-my-pi/pull/10223) by [@mattwilkinsonn](https://github.com/mattwilkinsonn)).
- Fixed LSP idle timeout clobbering in multi-workspace sessions and unmanaged timer spawning on pure config reads ([#10237](https://github.com/can1357/oh-my-pi/pull/10237) by [@harshaygadekar](https://github.com/harshaygadekar)).

## [18.0.11] - 2026-08-29

### Added

- Added gallery previews for composer and status-line components, with CLI filters for browsing by surface, composer, or segment.

### Changed

- The status line now displays the thinking level as a compact icon alongside the model name by default; set `statusLine.compactThinkingLevel` to `false` to restore the previous display.

### Fixed

- Fixed MCP OAuth discovery for shared API gateways and authorization servers with nested paths, including Keycloak realms, so authentication targets the correct resource issuer and supports endpoint and dynamic client-registration discovery.
- Fixed credential rotation for HTTP 402 payment-required responses so sibling credentials are tried before model fallback without misclassifying informative non-quota errors.
- Transport errors after a complete, non-executed tool call can now retry through configured retry budgets and fallback chains when it is safe to do so, instead of ending the turn prematurely.
- Improved handling of truncated or otherwise undecodable images so they produce an actionable error and no longer permanently block subsequent requests or resumed sessions.
- Fixed Sharpshooter consolidation preserving memory files and queued changes when an empty replacement is returned.
- Fixed `omp plugin features` so it discovers marketplace-installed plugins.
- Fixed Escape handling when closing the `/session` information panel; the panel now retains focus until dismissed.
- Fixed the thinking-block visibility toggle so streamed reasoning is correctly hidden when thinking blocks are set to hidden.
- Reduced high idle CPU usage while the agent is working.
- Fixed resumed advisor subscription usage being displayed as a dollar amount instead of as a subscription.
- Fixed relative API addresses whose names end in image extensions being pasted as text instead of incorrectly treated as missing local image files.
- Fixed chat Markdown links and bare URLs so they become clickable OSC 8 hyperlinks when `tui.hyperlinks=always` is enabled.
- Fixed unreadable composer text on light terminal backgrounds when using transparent composer styles.
- Fixed `retry.fallbackChains` warnings for valid selectors from providers whose model discovery is still pending; validation now updates after discovery completes.
- Fixed visible browser windows launched by OMP so page content resizes with the operating-system window.
- Fixed Python evaluation hanging on Windows when importing native-extension modules such as NumPy.
- Fixed subagent extension context helpers so `ctx.getContextUsage()` and `ctx.compact()` operate on the child session.
- Fixed `lsp diagnostics` incorrectly reporting success for project-aware pull-diagnostic servers when diagnostics time out or fail.
- Corrected labels under `Settings > Context > Compaction Token Limit`.
- Fixed orphaned pages, iframes, and workers accumulating in the shared headless browser after abnormal OMP session termination.

## [18.0.10] - 2026-08-28

### Added

- Added the Sharpshooter memory backend for tracking friction-earned project decisions, with `/memory queue` and `/memory sync` controls.
- Added `/restart` to relaunch omp with its original launch flags and resume the current session in place.
- Added the `band` composer shape, a flush powerline status band above the prompt; it is now the default while existing `composer.shape` settings remain unchanged.
- Added in-place retry for interrupted or failed tool calls: use F5, Alt+R (`app.retry`), or `/retry` to replay an intact failed batch without an additional model round trip.
- Improved the working status display with a timed braille spinner, streamed intent, session accent colors across relevant status elements, and theme-aware session accent generation.
- Updated the `unicode` and `ascii` symbol presets to use `π`/`pi` for the brand icon, avoiding tofu on fonts without the nerd-font glyph.

### Changed

- The `/review` command's PR-style comparison now uses the merge base against the current branch, excluding commits that exist only on the base branch; selecting the current branch reports no changes.
- Prompt history is now persisted immediately when submitted, and session database state is checkpointed on exit to improve durability and prevent unbounded WAL growth.

### Fixed

- Fixed edit-tool parsing of `－`-prefixed MATCH lines so they correctly represent whole-line deletions and can be replaced by a following `＋` run.
- Fixed interrupted and failed Python evaluation cells being reported as successful results instead of errors, improving model handling, telemetry, retries, and background-job failure reporting.
- Fixed native-extension imports such as `numpy` hanging indefinitely in the Python evaluation tool on Windows.
- Fixed a macOS composer display issue where undercurl could remain attached to stale text after rapid typing.
- Improved `xd://` MCP failure messages with actionable transport stages, failure categories, server and tool context, retryability, trace IDs, and redacted JSON-RPC details.
- Fixed ACP `read` tool-call locations so clients such as Zed Follow receive the resolved filesystem path rather than the OMP line-range selector.

## [18.0.9] - 2026-08-28

### Breaking Changes

- Removed the `git` and `jj` wrapper modules from the SDK surface. VCS operations are now available through `@linxiraos/pi-natives/vcs`, including native handles and typed `VcsError` support; the package continues to re-export the `github` (gh CLI) helpers.

### Changed

- `extendedContext` now defaults to off: models with premium long-context pricing tiers (e.g. GPT-5.6 1M) stay capped at their standard-pricing window unless the setting or `/extended-context on` enables the extended window.

### Fixed

- Improved terminal readability on light backgrounds by ensuring TUI surfaces use contrasting foreground colors.
- Coalesced simultaneous autonomous continuation requests to prevent repeated calls while the agent is busy, with clearer continuation diagnostics.
- Fixed Snapcompact so it skips or falls back when compaction would not reduce context size, and now compacts text in mixed tool results while preserving all source images.
- Added Google Antigravity daily quota usage to the status line.
- Fixed status-line background-work counts so queued tasks and evaluation jobs remain visible without double-counting running subagents.
- Fixed nested subagent visibility in RPC subscriptions, the subagent HUD, `get_subagents`, `subagent_*` events, and `get_subagent_messages`.
- Fixed `omp token` refreshing local MCP OAuth credentials without blocking or losing rotating refresh tokens, and preserved OpenCode MCP OAuth configuration during discovery.
- Prevented process crashes caused by socket-closed errors and unhandled promise rejections during concurrent subagent shutdowns, timeouts, and MCP transport disconnects.
- Fixed automatic startup model selection so ambient AWS credentials do not incorrectly select an unavailable Amazon Bedrock model over a provider the user has authenticated with.
- Kept embedded context usage visible in the status line when long session names or paths consume available space.
- Added a status message when `CTRL-O` toggles tool-output expansion.
- Fixed `omp usage` to report Codex Chat and Spark capacity meters separately when they share a usage window.

## [18.0.8] - 2026-08-27

### Added

- Transcript usage rows now show the total prompt-to-yield time (Δ + clock, including tool calls) after the turn timestamp, opt-in via `display.showTurnTime` (off by default).
- `omp usage` now shows Z.AI GLM Coding Plan credit quotas (5h + weekly) with the subscribed plan tier.
- The usage status line now labels untiered quota windows with the report's plan tier, surfacing Z.AI Coding Plan (`pro`) and Codex plan names next to the 5h/7d percentages.

### Fixed

- Fixed corrupt session headers silently overwriting recoverable transcripts during resume ([#9915](https://github.com/can1357/oh-my-pi/issues/9915)).
- Fixed a startup race that left a new session with almost no tools and an empty skill inventory. An early reconcile could commit a small live tool set as the permanent enabled set. The enabled set is now seeded from the construction-time tool slate, and `reconcileCodeMode` samples it inside the registry mutation lock.
- Fixed `snapcompact` compaction frames larger than the persistence limit being truncated into invalid image base64 on session resume, which made the provider reject every subsequent request with HTTP 400; already-corrupted archives now resume from their retained source text instead ([#9901](https://github.com/can1357/oh-my-pi/issues/9901)).
- Fixed prompts hanging when a successful automatic retry ended through an early terminal path such as `yield`.
- Fixed `hub` `send await:true` blocking for the full IRC timeout when the awaited agent finished without replying; the send now settles as soon as the peer stops ([#9913](https://github.com/can1357/oh-my-pi/issues/9913)).
- Fixed workspace symbol searches reporting success when every configured language server failed; partial failures now remain visible alongside successful results ([#8387](https://github.com/can1357/oh-my-pi/issues/8387)).
- Handle denied working-directory changes without crashing resume, move, or startup flows.
- Fixed Cursor-only sessions becoming permanently unusable after replaying orphaned async tool results.
- Fixed `!command` config values (`auth.broker.url`, `auth.broker.token`, custom headers) passing inherited file descriptors to the resolution command; on POSIX these commands now run under `/bin/sh` (Windows keeps the built-in shell and is unchanged)
- Fixed `providers.amazon-bedrock` guardrail, transport, and header settings being dropped for models referenced by an inference-profile ARN.
- Fixed the welcome screen staying at its original width after a terminal resize; a settled rebuild now recomposes it at the new width like the rest of the transcript.
- Fixed `omp if-bench` ending an Anthropic model's run on a transient `Refusal (cyber)` classification; the cyber classifier is stochastic near the threshold, so a refused turn is now retried with a fresh session (up to 3 attempts) before it is scored as a run-ending provider failure.
- Fixed streamed assistant responses crashing when a later provider delta revised earlier Markdown; assistant output now stays mutable until finalization.
- Fixed an orphaned foreground tool card surviving a later agent turn and pinning the entire transcript outside native scrollback; new turns now seal abandoned cards while preserving background-task updates.
- Fixed resize and display replays to include naturally emitted active-head rows in one atomic bottom-first transaction without rewinding lifecycle state, while graceful shutdown still drains every eligible final suffix.
- Fixed terminal resizes lagging on large transcripts: the transient resize repaint now renders only the visible tail instead of the entire committed transcript per resize event.
- Fixed cache-miss dividers crashing completed streamed assistant messages after stable rows had entered native history; cache-miss status now trails the assistant output.
- Fixed quitting re-streaming the entire committed transcript when a resize-triggered scrollback replay was still pending; shutdown now flushes only genuinely un-retired rows.
- Fixed fast tool completions leaving a permanent running summary that blocked transcript retirement and squeezed later tool output.
- Fixed `omp git` hunk navigation (`alt+↓`/`alt+↑`) appearing to do nothing while the file sidebar had focus: the diff cursor band now stays visible (dimmed) when the pane is unfocused.
- Fixed the git TUI sidebar jumping back to the top of the file list after staging or unstaging a file; selection now stays on the nearest remaining row
- Fixed the `aarch64-linux` `nix build` output segfaulting in the dynamic loader before startup by repointing the stale `DT_VERDEF` that `patchelf` leaves behind when it grows `.dynamic`, and surfaced smoke-test signal deaths in the build log instead of masking them ([#9881](https://github.com/can1357/oh-my-pi/issues/9881)).
- Added custom RPC launcher builders so embedded clients can transport omp RPC through SSH and remote process managers.

## [18.0.7] - 2026-08-26

### Added

- Git and Jujutsu operations now run in-process (gitoxide/jj-lib) instead of spawning `git`/`jj` subprocesses — faster status lines, diffs, staging, and worktree operations. The git binary is only used for credential-bound network transfers (push/fetch/clone) and reftable repositories.
- Status lines, footers, reviews, project identity, cleanse, and autoresearch reads now work in pure Jujutsu workspaces as well as Git checkouts.
- Include token usage statistics in inspect_image tool output
- Pressing the session model shortcut (alt+p) again inside the picker toggles a red Task mode that switches the Task subagent's model for this session instead.
- Git TUI: an AI staging wand next to "Stage All" asks "What should we stage?" and stages only the matching changes — the tiny/smol model picks the matching files from the whole change list, then filters their hunks in parallel; file-scoped requests ("git stuff") stage the picked files whole, content-scoped ones ("all comment changes") stage only the matching hunks.
- Added nonblocking shared model-catalog refresh with cached startup hydration and source freshness diagnostics, allowing newly published models for known providers to appear without a binary release.
- Added `omp usage clients` to report per-client token usage recorded by the auth broker, including the machine and application responsible for usage by provider. Supports `--days` and `--json` output.

### Changed

- Enforce a 5-minute timeout and 8 MiB output limit for GitHub CLI operations
- Apply a 30-minute timeout for marketplace plugin repository cloning
- Improve large file handling with blob streaming and explicit truncation support
- Improved `omp git` responsiveness by streaming file contents, rendering complete lines promptly, progressively applying syntax highlighting, and deferring large commit statistics until after the first interactive frame.
- Expanded `omp git` navigation and editing shortcuts: refresh with `r`, stage or unstage files and directories with `s`, `u`, or `space`, navigate hunks and files with keyboard shortcuts, use Vim-style motions in both panes, select diff views with `1`–`4`, and open the commit form with `c`.
- Standardized completed edit results across edit modes with hashline-style paths and numbered previews.
- Documented browser relay behavior more clearly, including that `browser.relay` can enable relay access independently of `app.relay` and that a relayed session operates in the user's logged-in browser.
- Clarified the computer tool documentation: `desktop.window()` must be awaited, and `win.ax()` returns a textual accessibility-tree snapshot rather than a structured node list.

### Fixed

- Fixed the VCS status line counting every file inside an untracked directory instead of collapsing it to one entry like `git status`.
- Fixed git TUI sidebar wheel scrolling snapping back to the selected row after staging or collapsing entries; the list now follows the selection only when it actually changes.
- Fixed `inspect_image` selecting a text-only vision/default role when an image-capable model was available on the active provider.
- Improved unexpected-stop recovery for reasoning-only stalls by requiring the next concrete tool action instead of repeated analysis.
- The edit tool now repairs a stray closing marker typed in place of the divider in a selection (`old⟫new` inside one selection instead of `old│new`) and applies the intended replacement with a note, instead of failing with an unmatched-marker error.
- Fixed hub process waits being incorrectly prolonged or satisfied by a replacement process after an automatic restart.
- Preserved an explicitly empty `tools: []` configuration for agent definitions instead of adding default work tools.
- Corrected MCP per-tool approval configuration documentation and behavior to use registered tool names for deny policies.
- Made `/branch` consistently open the branch-from-message selector regardless of the `doubleEscapeAction` setting.
- Improved ACP behavior when prompting during an active turn by returning a typed `session_busy` JSON-RPC error instead of an opaque internal error.
- Fixed `--model <id>:<effort>` losing its effort setting when cycling back to the `default` role; an explicit `--thinking` setting continues to take precedence.
- Fixed extension-registered Codex models configured with `preferWebsockets: false` from attempting a WebSocket connection.
- Fixed stale command-generated provider and model-override credentials after HTTP 401 responses by refreshing credentials before retrying.
- Fixed extensions configured in `.zeta/config.yml` not exposing their bundled skills, hooks, tools, commands, rules, prompts, and MCP configuration for discovery.
- Fixed compiled extensions that could not import public coding-agent registry modules.
- Fixed extension-provided environment variables being lost in user shell commands and prevented environment changes from one hook from affecting later commands.
- Fixed imported and legacy sessions with missing usage metadata from dropping RPC lifecycle events.
- Fixed GitHub and GitHub Enterprise issue, pull-request, and tool lookups to preserve and use the repository's actual host.
- Fixed binary installation when GitHub returns minified release metadata.
- Fixed `omp bench` and `omp if-bench` resolving credential-scoped dynamic models already listed by `omp models`.
- Fixed checkpoint and rewind recovery in Codex Code Mode.
- Fixed truncated `ask` questions being displayed incorrectly when expanded with Ctrl+O.
- Fixed the welcome screen and transcript layout not adapting correctly after terminal resizes.
- Made `omp if-bench` retry transient Anthropic cyber-safety refusals before treating them as run-ending failures.
- Fixed streamed assistant responses when later provider updates revise earlier Markdown.
- Fixed abandoned foreground tool cards and fast tool completions from blocking transcript scrolling or later output.
- Improved transcript replay and shutdown behavior so terminal resizes and exits do not duplicate, lose, or unnecessarily re-render committed output.
- Fixed cache-miss status messages from disrupting completed streamed assistant responses.
- Fixed YAML rewrites for settings, migrated configuration, and keybindings from adding trailing spaces to nested mapping headers.
- Fixed `/model` role-cycle icons overlapping their ordinal on terminals with full-width icon rendering.
- Improved `/collab` QR-code fallbacks so the browser join URL remains visible when the code is clipped or cannot fit.
- Fixed hub and child peer listings from exposing parked agents as active model context, while restoring accurate running, idle, parked, shown, and truncated counts.
- Fixed browser relay clients hanging when enabling the Runtime domain on a tab shared with another client.
- Fixed browser relay sessions leaving Chrome's debugging infobar attached after the last client releases a tab.
- Fixed interactive TTSR interruptions being displayed as errors when the rule injection succeeded.
- Fixed cold interactive launches duplicating the welcome header in Windows console scrollback.
- Fixed Git TUI hunk navigation and sidebar selection after staging or unstaging files, including correct handling of CRLF files on Windows.
- Fixed long sessions becoming unrecoverable when a provider rejects histories that exceed its message-count limit.
- Improved `/dump` output with readable titles for system notices and fenced XML payloads.
- Fixed kernel session recovery when a dead kernel reports cancellation.
- Applied advisor tool-call loop limits to advisor runs as well as regular model runs.
- Fixed `lsp rename_file` error handling for unreadable source paths and destination checks.
- Fixed LSP clients with different process arguments, initialization options, or settings from incorrectly sharing one process; `lsp reload *` now replaces superseded clients.
- Fixed auto-retry countdowns appearing frozen during long provider-specified waits.
- Fixed the Todo HUD after viewing a subagent and returning to the main session.
- Fixed child task results from linking unreadable artifacts and from replaying result bodies that had already been delivered.
- Fixed `omp update` showing a Unix reinstall command on Windows after a package-rename migration verification failure.
- Preserved `thinking.requiresEffort: false` in custom model configuration so supported local models can explicitly disable thinking.
- Prevented incompatible non-object values in shared project settings from silently replacing an entire settings group; such values are dropped with a warning.
- Jina Reader now uses configured credentials for authenticated rate limits while remaining available anonymously.
- Improved advisor session recovery and listing performance for large advisor transcripts.
- Fixed failed `browser.open` calls from leaving OMP-spawned application processes running when no tab could be acquired.
- Browser handles now fail fast with a specific per-operation timeout error instead of hanging an entire browser cell.
- Fixed autonomous runs becoming idle when a thinking-only length stop overlaps speculative handoff and compaction recovery.
- Kept completed assistant replies visible when viewport pressure prevents older active content from being retired.
- Accelerated SHA-2 and SHA-3 checksum builtins on supported ARM64 hardware.
- Fixed joined collaboration guests becoming inconsistent with the host after host-side compaction.
- Fixed `hub list` and child peer rosters counting parked agents from stale root sessions; the persisted roster now scopes to the current root, retries transient filesystem faults, and renders live rows through the production subagent prompt template with a truthful omitted count.

## [18.0.6] - 2026-08-26

### Added

- Added fast, cached conventional commit message generation to the git TUI and `omp commit --legacy`, including automatic handling of whitespace-only changes, clearer commit scopes, and improved grammar and tense in generated summaries.
- The git TUI sidebar now supports collapsing and expanding the Unstaged and Staged sections, with keyboard shortcuts to stage or unstage an entire section.
- Long streaming thinking and reasoning output now continues into terminal scrollback during a turn instead of remaining clipped to the viewport.

### Changed

- `omp commit --legacy` now uses the same conventional commit message generation as the git TUI.
- The git TUI sidebar now groups new files separately from tracked changes in the Unstaged section, while Staged and commit file lists use a unified status-based view.
- Improved resilience when streaming output changes during rendering, preventing incomplete blocks from causing further display updates to fail.

### Fixed

- Commit-message generation errors in the git TUI now remain visible in the status bar instead of disappearing and returning to an idle state.
- Fixed `omp update` leaving standalone Windows binaries on the old version when stale Bun launcher metadata was present, and preserved launchers installed by a newer concurrent update during binary repair ([#9806](https://github.com/can1357/oh-my-pi/issues/9806)).
- Quitting `omp git` during commit-message generation now exits cleanly without leaving the process running.

## [18.0.5] - 2026-08-25

### Added

- Added append-only transcript declarations and stable-row APIs for components with immutable history prefixes.
- Added the `:img` read selector to rasterize local SVG and SVGZ files for vision input.
- Added side-by-side image and SVG previews to `omp git`, including Git LFS object resolution and clear placeholders for unavailable or unsupported binary content.
- Added the `omp if-bench` command for zero-tool instruction-following and working-memory benchmarking across models, with live progress and ranked results.
- Added `q` to quit the git TUI.
- Added advanced whitespace filtering to the git TUI, including formatting-only changes and import-only changes in TypeScript, JavaScript, Rust, and Go.
- Improved the git TUI sidebar by compressing single-child directory chains and separating new or untracked files from tracked changes.
- Added Yolo-Auto to `/login` and documented the `YOLO_AUTO_API_KEY` environment variable.
- Updated the OpenRouter `/login` flow to support browser-based sign-in and automatic API-key provisioning, while retaining support for pasted `sk-or-…` keys.
- Added DeepInfra support for the `image_gen` and `tts` tools, including provider selection and MP3 or WAV output for text-to-speech.

### Changed

- Standardized completed edit results with hashline-style paths and numbered previews across edit modes.
- Improved `omp git` responsiveness with immediate file rendering, progressive syntax highlighting, and deferred large-commit statistics.
- Documented that `retry.maxDelayMs: 0` permits provider-requested quota waits to continue until automatic retry, rather than enforcing a wait ceiling.
- Expanded git TUI navigation and file-management shortcuts, including refresh, stage/unstage, directory operations, hunk and file navigation, pane movement, diff-view selection, commit-form access, and paging.

### Fixed

- Fixed race condition where tunnel startup was incorrectly reported as failure on quick process exit
- Fixed Obsidian theme task instructions and usage-limit text becoming unreadable against dark backgrounds.
- Fixed marketplace-installed plugins failing to discover their `rules/` directories.
- Fixed advisor notes in `/tree` displaying internal XML wrappers instead of readable text.
- Fixed successful agent and subagent results being discarded when cleanup exceeded its deadline.
- Fixed exiting plan mode mid-turn so the active turn now stops immediately.
- Fixed Windows workstation context reporting a virtual display adapter instead of the physical GPU.
- Fixed numbered selector menus such as `/review` ignoring digit-key selection.
- Fixed the welcome screen failing to reflow after terminal resizing.
- Fixed transcript layout issues that could clip assistant text, leave stale tool cards, disrupt scrolling, or make large-session rendering and shutdown unreliable.
- Fixed streamed assistant responses failing when later provider updates revised earlier Markdown.
- Fixed cache-miss status placement after streamed assistant output.
- Fixed `/model` role-cycle icons overlapping their ordinal on full-width terminals.
- Fixed constrained `/collab` QR codes rendering as empty rows; the browser URL hint is now shown instead.
- Fixed `hub list` and child peer rosters incorrectly including parked agents in model context and restored accurate status counts.
- Fixed browser relay clients hanging when enabling the Runtime domain on a shared tab.
- Fixed interactive TTSR interruptions being displayed as errors after successful rule injection.
- Fixed fast tool completions leaving a persistent running summary that obstructed later output.
- Fixed the Windows console welcome header being duplicated after cold launch.
- Fixed git TUI hunk navigation feedback when the sidebar has focus and preserved file selection after staging or unstaging.
- Fixed long sessions becoming unrecoverable when providers reject histories exceeding message-count limits.
- Improved `/dump` output with readable system-notice titles and XML-fenced raw payloads.
- Fixed kernel sessions failing to recover when cancellation was reported by a dead kernel.
- Applied advisor tool-call loop limits to prevent repeated failing calls from continuing without bound.
- Fixed `lsp rename_file` incorrectly reporting inaccessible paths as nonexistent and mishandling uncertain destination checks.
- Fixed LSP clients with different launch or initialization configurations incorrectly sharing one process; reloading now replaces superseded clients.
- Fixed the browser relay leaving Chrome's debugging infobar attached after the last client released a tab.
- Fixed auto-retry countdowns appearing frozen during long provider-requested waits.
- Fixed the Todo HUD becoming stale after viewing a subagent and returning to the main session.
- Fixed child-task artifact links and duplicate `hub jobs` result bodies.
- Fixed `omp update` showing a POSIX reinstall command on Windows after a package-rename migration failure.
- Preserved `thinking.requiresEffort: false` in custom model configuration so supported local Qwen templates can disable thinking explicitly.
- Fixed project settings from shared capability files being able to replace an entire settings group when a conflicting non-object value is present; the conflicting value is now ignored with a warning.
- Jina Reader requests now use configured credentials for higher authenticated rate limits while remaining available anonymously.
- Fixed advisor session persistence and loading performance for repeated retries and unusually large advisor transcripts.
- Fixed failed `browser.open` calls leaving OMP-spawned application processes running when no tab could be acquired.
- Improved browser-handle failures with prompt, operation-specific timeout errors instead of waiting for the entire browser cell.
- Fixed autonomous runs becoming idle after thinking-only length stops during speculative handoff.
- Fixed completed assistant replies disappearing from the live transcript under viewport pressure.
- Accelerated SHA-2 and SHA-3 checksums on supported ARM64 hardware.
- Fixed large MCP tool payloads being stored redundantly on disk.

## [18.0.4] - 2026-08-24

### Added

- Added the `omp git` command (and `/git` slash command): an interactive, fullscreen repository TUI featuring a split/inline/hunk diff viewer with minimap scrollbar, syntax highlighting, a staging sidebar with line-level staging, commit composer with amend support, and author avatars. Supports keyboard navigation, full mouse interaction, and pinning views to specific commits via `omp git <revision>`.
- Overhauled the `/extensions` Extension Control Center into a fullscreen alternate-screen dashboard with mouse support, tab navigation, unified inspector views across extension types, live MCP connection management, and expandable details (`Ctrl+O`).
- Added support for live syntax highlighting in streaming markdown code blocks.
- Added an immediately editable startup composer for interactive launches, preserving drafts typed while session initialization is in progress.

### Changed

- Improved streaming markdown and thinking block rendering performance on long sessions by batching token updates and eliminating redundant re-processing.
- Optimized streaming edit verification and session restoration for large files and history-heavy sessions.

### Fixed

- Fixed invalid streamed edit patches occasionally reaching the edit tool instead of being stopped early.
- Fixed `!` shell commands on zsh/fish by running them inside a real PTY, resolving terminal option errors and preserving ANSI color formatting.
- Fixed transcript layout corruption and viewport compression caused by interrupted streams, empty blocks, or collapsed wrapped diff lines.
- Fixed transcript scrollback loss where output below sticky cards (such as hub-wait or todo) failed to commit to terminal history.
- Improved HTTP 413 error handling: accurately distinguish between true token-context overflows and provider byte/media budget limits, persist terminal errors across sessions, and enable proper fallback-chain model switching.
- Fixed discovery-backed session models failing to restore when resuming sessions with `omp --resume` or `--continue`.
- Fixed browser tool initial launch timeouts on slow or cold host environments.
- Fixed eval runtime probes hanging on Windows due to inherited stdin handles.
- Fixed Claude models replaying partial thinking blocks as conversation text when interrupted mid-turn.
- Fixed image request failures with Kimi Code and Moonshot models by ensuring inline base64 image delivery.
- Fixed SQLite WAL-mode databases without sidecars failing to open in the Read tool.
- Fixed pasted image thumbnail rendering in the composer attachment preview.
- Fixed Linux startup event loop delays caused by legacy extension cache fsync churn.
- Fixed subagent advisors abandoning reviews on the final yield turn during session teardown.
- Fixed `/todo` expand/collapse commands and corrected `/shake thinking` reporting.

## [18.0.3] - 2026-08-23

### Added

- Added opt-in edit auto-repair (`edit.autoRepair.enabled`): when an edit breaks a file's AST parse, the smol model repairs the broken region in place — validated by re-parse, revert-rejected, and surfaced as a diff in the tool result — instead of only warning.

### Fixed

- Resolved cursor drift and text duplication caused by overlapping or out-of-bounds spelling ranges
- Squeezed transcript tool rows no longer render as a bare unstyled `╭─ Hub` frame: a squeezed block keeps its real render whenever it fits the allocated rows, and blocks that genuinely overflow fold to a themed frame that names the tool's activity (e.g. `Hub · send → Main`).
- Python/Ruby/Julia eval cells that hit their wall-clock timeout during a `parallel()`/`agent()`/`tool.*` fan-out no longer get their kernel force-killed (losing all session state): the timeout now aborts in-flight bridge calls so the runner unwinds as a clean KeyboardInterrupt and the kernel survives.
- Multi-select ask options whose labels end in `(Recommended)` now show their checked state and avoid duplicate recommendation suffixes ([#9452](https://github.com/can1357/oh-my-pi/issues/9452)).

## [18.0.2] - 2026-08-23

### Added

- Added update channels: `omp update --canary` installs canary prereleases from the npm `canary` dist-tag and `omp update --stable` switches back; the chosen channel persists and drives the startup update check.

### Changed

- Unexpected Stops now offers None, Mechanical (default), and Smart modes; Smart adds small-model classification to recover text-only stops.

### Fixed

- Fixed crash during update output when theme configuration is missing
- Fixed flickering typo undercurls while typing by projecting state during revalidation
- Fixed self-update on Windows leaving the `omp` command missing or stuck on the previous version when package-manager reinstalls fail on running files
- Ctrl+T now toggles every thinking block in the transcript, including blocks already retired to terminal history ([#9440](https://github.com/can1357/oh-my-pi/issues/9440)).
- Copilot Grok 4.6 Responses streams that repeatedly close after thinking now stop after one same-model retry instead of consuming the full retry budget ([#9427](https://github.com/can1357/oh-my-pi/issues/9427)).
- `/mcp test` now reports cancellation immediately when Esc is pressed during a slow config lookup, instead of staying suspended until the read settles ([#9419](https://github.com/can1357/oh-my-pi/issues/9419)).
- Fixed remote browser relay endpoints advertising a client-local CDP WebSocket URL: `/json/version` now reflects a valid request `Host` and falls back to the relay's loopback address when it is absent or unusable.
- Restored red/green and syntax highlighting in edit-tool result bodies ([#9439](https://github.com/can1357/oh-my-pi/issues/9439)).
- Fixed goal mode failing to start (`No such tool: xd://goal`) when `goal.enabled` was turned on after the session had already started; the `goal` tool is now registered lazily on goal-mode entry ([#9444](https://github.com/can1357/oh-my-pi/issues/9444)).

## [18.0.1] - 2026-08-23

### Added

- Plan review can save a plan to a chosen path and start a new session.
- Edit results now warn when an edit leaves a previously parsing file unparseable, independent of the `edit.blackbox.enabled` recorder.
- Added provider-wide Amazon Bedrock guardrail settings to models configuration, including custom models.
- Added the `/pin` slash command to pin and unpin sessions so they stay at the top of the `--resume` picker UI.
- Optional edit parse-regression capture appends the before/after content, model, variant, and arguments to `~/.zeta/agent/edit-blackbox.jsonl` when `edit.blackbox.enabled` is enabled.

### Changed

- Bash commands now automatically transition to the background by default when exceeding the threshold
- Transcript blocks now retire to terminal history as explicit ordered batches, active tools collapse to compact indicators under viewport pressure, and the `tui.scrollbackRebuild` and `tui.resizeScrollback` settings were removed.
- Transcript retirement is now capacity-driven: finalized blocks (and the welcome header) stay live in the viewport — reflowing to the current width on resize and visible the instant a message is submitted — and only commit to immutable terminal history when the screen runs out of room.
- Resizing no longer duplicates the editor and status rows: the settled repaint recovers its anchor from the terminal's own cursor-position report after reflow.
- The Advisor agent's guidance now prioritizes concrete technical risks and transcript-evident execution failures, while strictly prohibiting meta-advice on user intent, ceremony, or workflow narration.
- Edit-tool inline selections whose text contains the divider character itself (box-drawing code) are now resolved instead of failing the batch: a trailing divider reads as a deletion, an odd count splits at the middle divider, an even count reads as a deletion of the selected text, each with an advisory note.
- The welcome screen's recent-sessions list no longer content-scans every session file in the project directory: session titles are indexed in history.db as they are created/renamed, and startup resolves the newest files by mtime with a per-file scan fallback that backfills the index (cuts the pre-input startup transition by ~250ms per 10k sessions).
- Interactive startup no longer re-runs slash-command discovery: the composer's autocomplete reuses the discovery pass that session construction already performed.
- Interactive startup now reuses the prepaint composer's in-flight recent-session load, starts custom-command discovery with the other independent filesystem scans, and overlaps auth-cache/config reads with settings initialization instead of repeating or serializing them.
- Interactive startup now commits the complete composer frame synchronously before `session_start` hooks, lazily materializes only cached model providers needed by the configured default role, and starts cache-aware online runtime-provider discovery after the first UI paint.
- Advisor criteria for `concern` and `blocker` levels are expanded to better identify serializing independent tasks, bypassing specialized tools, ignoring verified sources, and premature yielding before convergence.
- The Advisor is now explicitly instructed to promote clean code cutovers (deleting obsolete paths and tests) unless backwards compatibility is required by the user or project rules.
- The advisor now flags transcript-evident execution failures—missed parallelism, overplanning, ungrounded assumptions, unnecessary abstraction, incomplete scope, stubs, and thin verification—before they force user steering.
- Slash-command autocomplete now collapses skills into a single `/skill:` row; the individual skills list once the prefix reaches `/skill:` (accepting the row with Tab/Enter expands it in place).
- `omp cleanse` and `/cleanse` now dispatch repair subagents while checkers are still running: diagnostics stream in (parsed from partial checker output every 5s), new files spawn workers up to the agent cap with least-loaded batching, and late diagnostics for a file being repaired are steered into the owning worker's chat instead of waiting for the full diagnostic pass.
- Suggested plan save filenames now come from a dedicated 1-3 word topic prompt instead of the sentence-length session title (e.g. `PYO3_METHODS_PLAN.md` instead of `SPLIT_PYENVIRONMENTBACKEND_REQUEST_INTO_PYO3_METHODS_PLAN.md`), with verbose fallbacks trimmed at a word boundary.
- Subagents in a shared working tree no longer run formatters, linters, or project-wide builds/test suites unless their assignment asks for it; validation runs once by the main agent.
- Context file deduplication now checks paragraph containment instead of byte-exact matching: a less-authoritative file whose normalized paragraphs appear contiguously within a more authoritative file is omitted, reducing redundant prompt context.
- Context file containment dedup now sorts by depth descending internally, treating files without a depth as least authoritative, so concatenated multi-root or user-level context cannot drop a closer-to-cwd file.
- Paragraph splitting for containment comparison is now fenced-code-block-aware: text inside a fenced example in a more authoritative file no longer counts as a contained instruction, preventing active context rules from being discarded.

### Fixed

- Fixed UI jitter in the edit tool gutter by reserving space for line counts
- Edit-tool add lines written directly above a `` gap now insert under their anchor line instead of splicing at the post-gap anchor, often mid-line without a newline.
- Edit-tool add lines may contain literal selection-marker glyphs; such payloads previously failed with an unusable corrected payload.
- A bare edit selection whose REWRITE restates the whole line now replaces the full line instead of duplicating the line's prefix and suffix around the span.
- A mid-line `…` in an edit REWRITE no longer re-emits a multi-line capture, so literal ellipses inside strings survive.
- Fixed double-Esc (session tree / branch selector) appearing dead on long sessions: opening it no longer replays the entire transcript through the terminal (which blocked for tens of seconds on PTY backpressure and cleared native scrollback), only the viewport repaints.
- Fixed prompt history whitespace duplicates: prompts are normalized on save (CRLF folded, per-line trailing padding stripped) so terminal-copy resubmissions upsert instead of adding a near-identical row, and a one-time pass collapses existing padded duplicates keeping the latest submission's metadata.
- Fixed prompt history duplicates: each prompt is now stored once with its latest project path, session ID, and submission time, and session resume or transcript rebuilds no longer repopulate persistent history.
- `/models` no longer shows dead sidebar tabs for unconfigured Ollama, llama.cpp, and LM Studio endpoints; explicitly configured endpoints remain visible for diagnosis ([#2761](https://github.com/can1357/oh-my-pi/issues/2761)).
- Fixed prompt input lag under CPU load while file and macOS spelling completions are active.
- Fixed blank `mnemopi.dbPath` settings silently creating volatile memory banks instead of using persistent agent storage ([#9360](https://github.com/can1357/oh-my-pi/issues/9360)).
- Fixed legacy Pi extensions being reparsed on every startup because their persistent parse cache could not be created ([#9339](https://github.com/can1357/oh-my-pi/pull/9339) by [@walodayeet](https://github.com/walodayeet)).
- Fixed Kitty text-sized Markdown headings activating before `tui.textSizing` is enabled.
- Fixed terminal-title updates racing the TUI's off-thread output pump, which could tear an escape sequence mid-frame and print the title (e.g. `0;π ∴ <session title>`) into the editor line as if typed.
- Fixed the edit tool corrupting files on unified-diff-shaped payloads: missing-separator recovery no longer hijacks `-`/`+` bodies (which deleted matched anchors and duplicated the surrounding block); they now flow to the unified-diff reinterpretation.
- Fixed the edit tool writing literal `…` lines: a whole-line rewrite gap with no captured MATCH gap now fails closed with guidance instead of splicing an ellipsis into the file.
- Fixed status text retaining hidden DCS, PM, and APC payloads after escape-sequence sanitization.
- Fixed extension load errors truncating explicitly excluded package import specifiers.
- Fixed subagents crashing before their first turn when an extension contributed a tool or skill without a `description`; the context-breakdown token estimate now coalesces missing descriptions and system-prompt sections instead of passing `undefined` to the tokenizer ([#9331](https://github.com/can1357/oh-my-pi/issues/9331)).
- Clarified that Mnemopi `/memory enqueue` only promotes working memories older than the configured consolidation gate (12 hours by default) and that normal shutdown does not run bank sleep ([#9356](https://github.com/can1357/oh-my-pi/issues/9356)).
- Fixed asynchronous V2 remote compaction dropping user and tool messages added after its speculative snapshot ([#9351](https://github.com/can1357/oh-my-pi/issues/9351)).
- Fixed startup crashes when temporary Git worktrees point to repository metadata that the current user cannot access.
- Hidden custom tools (`hidden: true`) stay out of the parent session's active set and `/tools` unless `--tools` or an agent `tools:` list names them. They used to be always-included.
- Hidden custom tools (`hidden: true`) stay out of the parent session's active set and the TUI's `/tools` list unless `--tools` or an agent `tools:` list names them. They used to be always-included.
- Fixed edit retries suggesting the same invalid payload and permission prompts showing unknown paths for sloppy edits ([#9350](https://github.com/can1357/oh-my-pi/issues/9350)).
- Fixed Agent Hub aborted rows failing to open their read-only transcript when selected with Enter.
- Fixed `/mcp test` leaving a stale "(esc to cancel)" hint after the test finished and swallowing Esc presses during the grace window; the hint now stops advertising Esc once the test settles, a late Esc shows an "already finished" status instead of silently doing nothing, and one Esc press consumes the cancellation ownership so the next Esc reaches the running turn ([#9173](https://github.com/can1357/oh-my-pi/issues/9173)).
- Fixed MCP request timeouts surfacing as `Unexpected end of JSON input` instead of `Request timeout after Nms` when the abort lands mid-JSON-body read, including when the caller's signal aborts after the timer fires ([#9048](https://github.com/can1357/oh-my-pi/issues/9048)).
- Fixed streamed `xd://` device writes (including MCP tools) looking like a hung in-flight call while the model is still thinking; they now show as queued until the tool actually starts.
- Fixed `/clear` and `/new` keeping a stale `AGENTS.md` (and other context files) in the system prompt; a new session now re-reads them from disk ([#9273](https://github.com/can1357/oh-my-pi/issues/9273)).
- Auto-continue turns that die mid-tool-call with `OpenAI completions stream closed before a finish_reason was received` (and the Responses/Azure "closed before a terminal response event" variants): premature gateway stream closes now classify like idle stalls and HTTP/2 resets, so a resolved tool turn is continued after its preserved partial output instead of surfacing the error.
- Todo tool schemas now identify `items` as valid for single-phase `init` and `append`.
- Fixed Todo tool guidance to clarify that blocked tasks never auto-promote after state-changing operations (#8121).
- Fixed timed-out or interrupted glob searches keeping native filesystem workers alive and blocking subsequent agent turns.
- Fixed legacy Pi extensions being re-parsed on every launch instead of using the persistent cache ([#9170](https://github.com/can1357/oh-my-pi/pull/9170) by [@fmguerreiro](https://github.com/fmguerreiro)).
- `/mcp reload` now picks up external edits to `mcp.json`.
- Fixed `lsp reload` clearing active language-server settings instead of reapplying them.
- Fixed workspace diagnostics skipping lower-priority languages in polyglot project roots ([#8385](https://github.com/can1357/oh-my-pi/issues/8385)).
- Fixed isolated task cleanup deleting the only branch that retained an agent's commits after apply-back failed ([#9216](https://github.com/can1357/oh-my-pi/pull/9216), thanks [@Mustaqeem66](https://github.com/Mustaqeem66)).
- Fixed bare `hub wait` calls reporting nothing to wait for while an already-queued bus message remained unread.
- Fixed Code Mode activating for sessions whose caller never enabled `eval`, which handed restricted subagents an unrestricted JS runtime; the eval transport must now be part of the caller's own tool set.
- Fixed Code Mode dropping `write` from the direct surface when plan mode starts, and dropping `task` delegation guidance from the plan prompt once `task` is reachable only through the eval bridge.
- Fixed the eval tool advertising bridged declarations for tools the model can still call directly, such as a plan-mode transport `write`, by reading the partition the session actually applied.
- Fixed Code Mode turn metadata resolving a wire-name collision by tool registry order, and mishandling tools named after `Object.prototype` members or after the eval bridge's own internal operations (`__agent__`, `__budget__`, `__completion__`, `__concurrency__`).
- Fixed generated Code Mode declarations rendering an array of a union as `"a" | "b"[]`, which models read as a scalar-or-array type and submitted invalid arguments against.
- Fixed SDK sessions with a custom agent directory inheriting process-global model overrides instead of loading that directory's own `models.yml`.
- Fixed Eval guidance that implied `agent()` children share parent kernel state and advertised them when spawning was disabled.
- Fixed Bash guidance that implied raising `timeout` extends foreground execution beyond the auto-background threshold.
- Fixed Bash and Eval guidance that implied raising `timeout` extends foreground execution beyond the auto-background threshold ([#9155](https://github.com/can1357/oh-my-pi/pull/9155) by [@MikeeI](https://github.com/MikeeI)).
- Status-line usage no longer combines quota windows scoped to different models or tiers ([#9138](https://github.com/can1357/oh-my-pi/issues/9138)).
- Fixed `PI_PROXY` being ignored outside provider streams: the CLI now installs it on the process-wide `fetch` at startup, so OAuth token refresh/login, usage probes, and model discovery are proxied too. Combined with the Anthropic transport fix in `pi-ai`, a region-blocked machine reaching Anthropic through a proxy no longer fails with `403 Request not allowed`.
- Subagent failures now name the resolved provider and model that produced the error ([#9137](https://github.com/can1357/oh-my-pi/pull/9137) by [@Mustaqeem66](https://github.com/Mustaqeem66))
- Fixed read-only subagents (`scout`, restricted-tool custom agents) crashing before their first prompt when extensions register callable tool schemas.
- Fixed smart paste dropping text from X11 clipboard owners whose image read fails instead of reporting no image.
- Fixed `formatContent` silently swallowing formatter errors: the empty `catch {}` was replaced with per-server error tracking, and failed formatter requests now surface as `FileFormatResult.FAILED` instead of being misclassified as unchanged ([#8388](https://github.com/can1357/oh-my-pi/issues/8388)).
- Fixed `formatContent` reporting no-formatter as unchanged: when no configured server supports formatting, the result is now correctly classified as `FileFormatResult.UNSUPPORTED` ([#8388](https://github.com/can1357/oh-my-pi/issues/8388)).
- Fixed MCP request timeouts surfacing as `Unexpected end of JSON input` instead of `Request timeout after Nms` when the abort lands mid-JSON-body read.
- Fixed CJS modules being misclassified as ESM when imported from an ESM parent module. The extension loader now identifies unshadowed CommonJS syntax from Babel's parsed AST before deferring to the importer's module kind. This resolves `SyntaxError: Missing 'default' export` for packages with conditional exports (e.g. playwright-core) where an ESM wrapper re-exports from a CJS entry, while ambiguous files continue to inherit their importer's classification.

Older entries are archived in [packages/coding-agent/CHANGELOG.md@3642216898e4](https://github.com/can1357/oh-my-pi/blob/3642216898e473f6a4472e78f792e641891c6d62/packages/coding-agent/CHANGELOG.md).
