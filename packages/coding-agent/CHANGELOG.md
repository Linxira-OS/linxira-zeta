# Changelog

## [Unreleased]

## [1.1.7] - 2026-09-01
### Fixed

- Claude marketplace MCP servers now resolve environment placeholders in stdio environment values instead of passing strings such as `${NAME:-}` literally ([#10481](https://github.com/can1357/oh-my-pi/pull/10481) by [@mrexodia](https://github.com/mrexodia)).
## [1.1.6] - 2026-08-30

- 同步上游 OMP v18.0.10（`33cc6b9a043a`）。
- 新增 Sharpshooter 记忆后端（`/memory queue`、`/memory sync`）与 `/restart` 原地重启并恢复当前会话。
- 新增 `band` composer 状态带（默认启用，原 `composer.shape` 设置保持兼容）与失败工具调用原地重试（F5 / Alt+R / `/retry`）。
- 工作状态显示升级：计时盲文 spinner、流式意图、会话强调色；`/review` PR 式对比改用 merge base；提示历史提交即持久化、退出时 checkpoint 会话数据库。
- 修复 Windows 上 Python 评估导入 `numpy` 等原生扩展无限挂起、编辑工具 `－` 前缀 MATCH 行解析、macOS 快速输入下划线残留、`xd://` MCP 失败信息缺失上下文、ACP `read` 工具位置解析等问题。

### Fixed

- 修复扩展发现读不到项目级配置：原生扩展根解析把项目配置目录写死为 `.omp`，`<project>/.zeta/` 下的 `config.yml`/`settings.json` 扩展注册失效。
- 修复 v18.0.9 合并后 web/desktop 外部客户端不可用：恢复 AgentSession 会话层 mode API（plan/goal/vibe 进入退出、状态版本、plan 文件读取、IRC 自动回复），CLI 不受影响。
- 修复 IM 频道工具（`channel_send`/`workspace_run`/`im_control`/`tracking_update`）在合并后从工具表消失的问题。

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

- 配置目录统一 `.zeta`，移除 `.omp` 兼容别名路径。

## [1.0.11] - 2026-08-22

### Added

- Session ModeController: `AgentSession` now owns plan/goal/vibe mode mechanics (`enterMode`/`exitMode`/`getModeState`, `stateVersion`, pre-mode tool/model snapshots, deferred model switches) so the CLI and external clients drive identical mode behavior.
- Generic gateway mode protocol: `mode_enter`/`mode_exit`/`set_model_role` commands plus `mode_changed`/`state_changed` SSE events; `AgentState` v2 exposes `modes`, `modelRole`, `activeToolNames`, `autoCompactionEnabled`, `autoRetryEnabled`, and `stateVersion`.
- `zeta serve` now always hosts a shared coordinator session (`GET /api/agent/current`), the default target for the web UI's default chat and the new `zeta attach` REPL (state snapshot, SSE mode banners, `/plan` `/exit-plan` `/goal` `/vibe` `/set-role`).
- Web UI: persistent plan/goal/vibe mode banners with exit/complete/drop controls, `/plan` `/exit-plan` `/goal` `/vibe` slash commands with visible transcript messages, and a `modelRoles` role→model editor in the settings panel (plus context/shell/providers/memory/tasks tabs now fully editable).
- Web Models panel: providers defined in `models.yml` always render their full editor (they were previously hidden behind an auth-only API-key card when the provider had a `models.yml` `apiKey`); the model editor now covers the full schema — the `thinking` block (mode + supported efforts + default level, i.e. 思考强度), per-model/provider headers, `compat` JSON, per-model base URL, `supportsTools`, `premiumMultiplier`, and `omitMaxOutputTokens` — all persisted to the same `models.yml` the CLI reads.
- Remote workspace relay: `zeta serve` now routes IM messages per chat — a persisted `remote.sessionMappings` binding or a channel default `channels.<id>.workspaceRoot` sends a chat **direct** to its bound workspace; everything else goes through the relay coordinator, which delegates to other repositories with the `workspace_run` tool. Workspaces carry user-facing aliases (`remote.workspaces: [{alias, path}]`, `*<alias>` shortcuts, `@workspace use/relay/bind/unbind/bindings/rename` commands), and direct-mode replies return to the originating chat. Docs: `docs/remote-workspaces.md`.
- `GET /api/channels/status` reports which IM channels are running; remote plan approvals now expire after 30 minutes instead of waiting forever.
- IM command grammar is IME-robust: full-width punctuation (`！`/`＠`/`＊`/full-width space) is normalized before parsing, and a categorized `!help` plus a zero-token `!status` overview (channels / routing / workspaces / language / model) are available.
- Default-space multi-session (`!session`): the relay coordinator is registered as an undeletable `relay` session in `web.yml` (`remote.botSessions`); `!session new/use/rename/delete` manage additional bot/draft sessions with their own transcripts, and each chat keeps an active-session pointer (`remote.sessionMappings[].sessionId`). Bot sessions route IM messages directly and return replies to the originating chat; deleting a session removes its transcript and falls back to the relay.
- Per-chat reply language (`!lang <zh|en>`, persisted in `remote.sessionMappings[].lang`): applied as a system-prompt line on bot sessions and as a `[Language: …]` message prefix on the shared relay.
- Model switching from IM (`!model` / `!model <p>-<m>`): lists available models grouped by provider with stable numbering and switches the chat's target session (bot session or relay).
- Explicit task dispatch (`!work workspace:<alias> <task>` routes direct; `!draft <task>` runs a one-off task in a fresh draft session).
- Remote plan approvals now target the session that produced the plan (relay coordinator or a bot session), so `!plan` on a bot session is approved/executed there; the same plan stays approvable from the web UI's PlanApproval card.
- Web session list tags default-space sessions (`tag: relay|bot|draft` from the bot-session registry) and hides relay/bot sessions by default (`remote.showBotSessions: true` shows them with labels); deleting the relay session via the API returns 400.
- The serve process logs a prominent warning when bound to a non-loopback hostname (`ZETA_SERVE_HOSTNAME`): a configured `remote.token` is mandatory or every API request is rejected.
- IM listings use a uniform read format: all numbering is `{n}` / `{p-m}` and names (model provider, workspace alias, session id) are `[name]`. `!workspace list` now enumerates every workspace **and its sessions** (`{n} [alias]`, `{n-m} [session]`); `!model` and `!session list` use the same style, and selectors accept the braced forms (`!session use {2}`, `!model {1-1}`).
- Natural-language IM control: the coordinator and bot sessions expose an `im_control` tool so users can manage workspaces / sessions / language / model in plain language (any language) instead of typing `!` commands — it reuses the existing `SessionRouter`/`WebConfig` operations and the `{n}`/`[name]` listings, and ordinary task messages are never intercepted.
- Web settings: the Web tab has a **Show hidden bot sessions** toggle (`remote.showBotSessions`), and every settings tab shows a banner naming which config it edits (Bot/Web `web.yml` vs CLI `config.yml` / `models.json`) plus the config object (`remote.*`, `channels.*`, `settings.<tab>`, …).

### Fixed

- Web settings secret inputs (Feishu App Secret, Telegram Bot Token, remote token) no longer clear after saving: a stored secret now renders as masked dots, and blurring a masked field never re-commits the placeholder.
- WeChat login QR renders even when the flow returns a page URL instead of an image (the legacy iLink `liteapp.weixin.qq.com` QR is HTML): the panel falls back to rendering a QR code of that URL.
- `next dev` rewrites now route `/api/web-config`, `/api/channels/*`, `/api/open/*`, `/api/update/*`, and `/api/docs/*` to the gateway (production `zeta serve` already handled them in-process).
- WeChat QR login now speaks the documented `/api/v1/wechat` shape: reads the status token from `data.qrcode` (not a flat `token`), polls `qrcode/status` with `{ qrcode }`, and reads `data.status`/`data.credentials`/`data.baseurl` — the v1 flow previously mis-parsed the response, always falling back to legacy iLink endpoints and never surfacing a QR.
- Toggling an IM channel in the web settings now restarts the running channel set immediately (stop + re-start against the fresh `web.yml`), so enabling WeChat starts the QR login without a serve restart.

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
- Replaced `arktype` with `@oh-my-pi/omptype` for all tool parameter and configuration schemas, resulting in significantly faster startup times. Configuration schema errors are now reported via `OmpErrors` entries using the standard `path`/`problem` format.

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

