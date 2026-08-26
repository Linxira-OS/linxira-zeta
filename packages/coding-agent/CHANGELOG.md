# Changelog

## [Unreleased]
### Fixed

- 修复 `/language` 与 `/tracking` 指令在 OMP v18.0.3 合并后未注册的问题（输入被当作普通消息；现已恢复注册并加合并护栏测试）。
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
