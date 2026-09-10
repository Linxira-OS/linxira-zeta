# Changelog

## [Unreleased]

## [1.1.13] - 2026-09-10

- 上游 v18.1.16 同步:任务执行器 AgentBusyError、事件循环 keepalive、idle 封装截止时间、上下文笔记等。
- 修复中文界面设置布尔项无法关闭的问题(显示文案误入机器值匹配)。
- `/language` 切换后斜杠命令描述即时刷新,无需重启。
- Plan/Plan-ultra/Vibe/Goal 模式横幅与 attach 模式提示接入 i18n;`/loop`、`/rename` 描述进目录。

## [1.1.12] - 2026-09-10

- Brand token sweep across the shipped VM protocol families: eval JS/Python kernel symbols (`__zeta_prelude__`, `__zeta_display__`, `__zeta_magic`/`__zeta_shell`), browser/computer bridge protocol names, and the shell snapshot helper now use the zeta naming; retained interop surfaces (`.omp-plugin`, `mcp__omp__`, the persisted silent-abort marker, `__ompInstallTokioRuntime`) are unchanged per the brand registry.
- Fixed legacy-pi extension hot reload on Windows: module specifiers now keep the `?mtime` cache-busting query (plain slash paths), so edited extension source takes effect on reload instead of being pinned to the first load.
- Web UI sidebar: default off with persisted toggle state, overlap with the status line fixed, plus running-session pin, usage line, and quick actions.

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

- Fixed edit and write results to report the formatted bytes actually committed by LSP writethrough.

### Added

- OMP v18.1.12 sync baseline: `memory://` now resolves against the session that issued it: a caller's own memory backend answers `memory://<id>`, so co-located sessions no longer read each other's memory rows, and a caller whose session is no longer live fails closed instead of being answered by a peer. Prompt completion binds to the same caller, so `memory://<memory-id>` stays on offer while a subagent shares the working directory. Advisors retain their owning session's memory access even without a session file.
- OMP v18.1.11 sync baseline (`e3106be68f`): `retry.waitForUsageReset` — when a provider reports usage-limit exhaustion with a reset time (5-hour or weekly quota windows), the session sleeps until the reset instead of failing fast past `retry.maxDelayMs`; opt-in `bash.allowCompoundCommands` approval evaluates conservative literal `&&` chains per segment (requires a POSIX-quoting shell; whole-chain denies take precedence over earlier prompts).

### Changed

- Ranged reads of text without bracket characters skip unnecessary lexical context scanning.
- Muse Code sessions send a compact hashline edit description (~3 KB less per request); all other models keep the full prompt.
- Transcript usage row now shows the prompt-to-yield time as a bare delta, keeping the clock icon for time to first token only.

### Fixed

- Fixed GPT-6 Astra extended-context support and preserved maximum context windows reported by OpenAI Codex discovery ([#10980](https://github.com/can1357/oh-my-pi/pull/10980) by [@H4vC](https://github.com/H4vC)).
- Fixed GPT-6 Astra requiring `/extended-context` for its full context window: it now keeps the documented 1.05M-token window with the setting on or off, and explicit per-model `contextWindow` overrides still win.
- Subagent `yield` no longer rejects a valid `data` payload because a non-strict OpenAI-compatible backend filled the optional `error` field with `""`; previously the worker retried the identical call until the invalid-yield cap and the parent received nothing.
- Fixed fullscreen `/copy` outlining only a lazily created grouped Read card, so Enter copies the assistant yield instead of tool output.
- Fullscreen `/copy` now opens on the recent tail of the branch instead of replaying the whole session, so it appears immediately and steps without lag on long sessions (`a` loads the earlier turns). Both it and the esc-esc rewind selector also cache each transcript row set instead of re-stripping it every frame.
- Fixed the fullscreen `/copy` and esc-esc rewind selectors repainting the whole frame for a wheel notch that cannot move the viewport; because both open scrolled to the newest turn, wheeling down there made the frame twitch.
- Oversized selected lines that cannot fit after read context are reported with a working raw recovery selector instead of a looping continuation hint.
- WorkPool child sessions no longer crash during startup while constructing their incremental `yield` tool schema.
- The default `omp commit` agent now uses its displayed COMMIT model and honors `--model` instead of silently running on SMOL ([#10991](https://github.com/can1357/oh-my-pi/issues/10991)).
- Fixed JavaScript `eval` `completion()`/`agent()` handles so the documented immediate-handle pattern works: `h.wait()`, `h.status()`, and the other handle methods now work on the un-awaited factory result ([#10986](https://github.com/can1357/oh-my-pi/issues/10986)).

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
- Fixed RPC `prompt` responses for `/skill:*` commands arriving only after the entire prompt-dispatch pipeline finished (usage preflight, compaction, provider calls): under provider stress that outlasts any client prompt timeout, so hosts reported the prompt as rejected while the turn was in fact running. The skill branch now builds the skill prompt eagerly (preserving the immediate error for an unreadable skill file) and dispatches the expensive pipeline asynchronously after answering, matching plain prompts; when the dispatch is cancelled before a turn starts (e.g. an abort overtakes usage preflight), the session now reports it through the non-invoked  completion frame instead of leaving hosts waiting for an  that never comes ([#10249](https://github.com/can1357/oh-my-pi/pull/10249) by [@cwr250](https://github.com/cwr250)).
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
