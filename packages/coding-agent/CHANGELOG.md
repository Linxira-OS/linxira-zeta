## [Unreleased]


### Added

- 新增 tea 工具套件：面向自托管 Gitea（及 gitea.com）的 `tea` CLI 集成，提供仓库/议题/拉取请求/检出/合并/发行版等 op（`repo_view`、`repo_create`、`issue_*`、`pr_*`、`release_*`），创建类操作一律 API 回读验证（`tea repo create` 有静默失败史）；通过 `gitea.enabled` 启用，默认关闭。
- Added per-session Git worktree support with `worktree.onStart` and `worktree.onExit` settings to create an isolated worktree for each session and clean it up when the session ends.
- Expanded xAI web search with X post search, including X-only and author-specific queries, author exclusions, date and recency filters, and automatic xAI routing when credentials are available.
- Added xAI-powered reading of X posts, threads and replies, profiles, searches, and hashtags when logged in, replacing the unavailable Nitter mirrors.
- Added per-model auto-compaction points: the `/models` preview shows where each model compacts, and in the Roles view `k` (or the **Compaction limit** button) sets it for the selected role's or fallback's model (`90000`, `90k`, `1M`, `80%`; empty resets). Also configurable as `compaction.modelThresholds` with `provider/model-id` or `provider/*` keys ([#14952](https://github.com/can1357/oh-my-pi/pull/14952) by [@H4vC](https://github.com/H4vC))
- Added WeChat `/api/v1/wechat` login (QR + status polling) with legacy iLink fallback, persisted peer→context_token bindings in `web.yml` (`channels.wechat.peerTokens`), and a `POST /api/channels/wechat/unbind` gateway route that resets the channel and clears credentials.

### Changed

- OTLP 遥测导出改为**硬关闭**：删除 `telemetry.otlpExportEnabled` 设置（原先默认开启），产品启动改由写死的 `TELEMETRY_EXPORT_ENABLED = false` 门控。我们没有遥测服务端，任何 `OTEL_EXPORTER_OTLP*` 端点都不会导出，且不存在任何开启入口（无设置项、无环境变量、无命令行开关）。等我们自建采集端后再有意识地加回。门控由 `brand-check` 的 MUST_CONTAIN/MUST_NOT_CONTAIN 守卫锁定，上游合并改不回来。OTLP `service.name` 兜底值同时由 `oh-my-pi` 改为 `zeta`。
- 命令行的标准指令名定为 `zetacode`（四件套标准名：zetawork / zetacode / zetaide / zetaeditor，无连字符）：`--help` 用法与示例、`update` 横幅、`--resume` 提示、profile alias 生成、各命令说明与文档全部改用标准名。`zeta-c`/`zeta-cli`/`zeta-ide`/`zeta-i`/`zeta-editor`/`zeta-e`/`zeta-work` 仍是 npm bin 兼容别名，行为不变；垫片与资产文件名（`zeta-c.cmd` 等）不受影响。
- Web search now prefers an authenticated `xai-oauth` login over an `xai` API key when both are available, unless `modelProviderOrder` specifies a different order.
- **上游品牌残留全量清除**：把产品对外暴露的每一个上游标识换成 Zeta 名，包括操作系统/浏览器层面可见的部分 —— macOS bundle id 与 App 名（`dev.zeta.oauth-callback.*` / `Zeta OAuth Callback.app`）、Windows HKCU 注册表事务名、Linux desktop entry 与 `zeta-auth` 协议、文件描述符 URL 协议（`zeta-descriptor://`）、文件锁前缀、XDG 状态目录；进程标题（`zetacode lsp mux`）、IDA 守护进程名（`zeta.ida.*`）、命名管道与 socket 路径、User-Agent、AWS STS `RoleSessionName`、遥测指标与 TUI 语义 role、导出 HTML 的自定义元素名。会话录制格式扩展名 `.ompcast` → `.zetacast`。开发期 wrapper 与链接脚本改为 `scripts/zetacode` / `scripts/link-zetacode.sh`，不再往全局 bin 写入 `omp`。
- **⚠️ 存储键命名空间变更（需要迁移）**：Redis 会话存储的默认键前缀由 `omp:sessions:` 改为 `zeta:sessions:`，SQL 会话存储的默认表名由 `omp_session_files` 改为 `zeta_session_files`。已有部署若沿用默认值，历史数据将不可见 —— 迁移方式是把旧键/旧表重命名到新名字，或在配置中显式写回旧前缀。两者都是纯改名，不涉及格式变化。
- **⚠️ OAuth 回调协议处理器改名**：macOS LaunchServices、Windows 注册表与 Linux desktop entry 中可能残留旧标识（`dev.omp.oauth-callback.*` / `omp OAuth Callback` / `omp-auth`）的注册项，它们指向的路径已不存在。升级后首次执行一次 OAuth 登录即可写入新注册；如系统里仍有旧条目，可在系统的"默认应用/协议关联"设置中移除。
- **SDK 更名（无兼容别名）**：`sdk/go/omp-rpc`、`sdk/python/omp-rpc`、`sdk/rust/omp-rpc` 改名为 `zeta-rpc`，Python 包名 `omp_rpc` → `zeta_rpc`，Go 包名 `omprpc` → `zetarpc`。三者均为 `gen:rpc` 的入库生成产物，版本 0.1.0（pre-1.0），此前未发布到任何 registry，因此不提供 `omp-rpc` 过渡别名。顺带修正 Go module 路径：此前误指向上游仓库 `github.com/can1357/oh-my-pi/sdk/go/...`，现为 `github.com/Linxira-OS/linxira-zeta/sdk/go/zeta-rpc`。

### Fixed

- Fixed `read` serving a stale archive listing when an archive was rewritten in place with the same size and a restored mtime: the reader cache identified files by inode/mtime/ctime/size only, and on filesystems whose timestamps advance in steps coarser than the gap between the two writes the inode reports the same ctime, so the rewrite was invisible. The cache now also fingerprints the head and tail of the file.
- 终端 tab 标题在无会话名时不再回退为 `omp`，改为 `zeta`。
- 协作（collab）replication 快照恢复上游 v18.8.4 的 no-copy 契约（live header + entries），宿主与哨兵同步。
- 去重 CHANGELOG 中重复的 `[1.1.27]` 节头，修复 changelog 解析。
- Fixed judge-gated features continuing to use a stale model chain after switching judge roles.
- Improved Anthropic prompt-cache reuse when pruning tool results from long conversations.
- Fixed resumed Claude sessions losing earlier thinking context and prompt-cache reuse when extensions or MCP tools were registered before the first message.
- Fixed subagent advisors configured with `@advisor` using the built-in `slow` model instead of the configured advisor role.
- Fixed the `/switch` command and alternate model picker crashing when stored model speed statistics contained an unnamed model.
- Fixed `lsp` and `generate_image` attempting to read FIFO, terminal, or unbounded device paths, which could hang or exhaust memory.
- Fixed aside messages from extensions being blocked behind a running wait operation.
- Fixed extensions importing `@oh-my-pi/pi-tui/native/*` failing to load in compiled `omp` binaries.
- Fixed raw token markers appearing instead of Nerd Font icons in Anthropic idle recaps, `/btw` and `/omfg` replies, and streaming previews.
- Fixed sessions moved with `/wt` disappearing from resume lists; sessions in Git worktrees now remain discoverable and can be resumed or relocated if their worktree was removed.
- Fixed live config reload ignoring edits made during startup or right after a config symlink was retargeted, until the next unrelated edit.
- Fixed `omp usage` reporting an account exactly at its reserve (e.g. 30% left with a 30% reserve) as eligible instead of inside reserve ([#14765](https://github.com/can1357/oh-my-pi/pull/14765) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed the todo reminder pushing the agent to keep working after it offered options and asked the user to choose ([#14800](https://github.com/can1357/oh-my-pi/pull/14800) by [@mrmans0n](https://github.com/mrmans0n))
- Fixed the todo reminder telling the model to keep working right after it asked the user a bolded or italicised question ([#12051](https://github.com/can1357/oh-my-pi/issues/12051), [#14353](https://github.com/can1357/oh-my-pi/pull/14353) by [@F0Rextasy](https://github.com/F0Rextasy))
- Fixed short model selectors such as `p/a:max` or `a:max` dropping their explicit thinking level when a role was reassigned or used for image questions; a model whose ID literally ends in `:max` or `:auto` is still treated as that model ([#14554](https://github.com/can1357/oh-my-pi/pull/14554) by [@xiangnan0811](https://github.com/xiangnan0811))
- Fixed starting a subagent switching the parent session's later language servers from shared to private ([#14628](https://github.com/can1357/oh-my-pi/pull/14628) by [@jorgoose](https://github.com/jorgoose))
- Fixed a finishing subagent cancelling local tiny-model requests (titles, task labels, judgments) still running for the parent or other subagents ([#14629](https://github.com/can1357/oh-my-pi/pull/14629) by [@jorgoose](https://github.com/jorgoose))
- Fixed rust-analyzer on Windows not running through a running lspmux server, as it already did on Linux and macOS ([#14630](https://github.com/can1357/oh-my-pi/pull/14630) by [@jorgoose](https://github.com/jorgoose))
- Fixed a malformed or unreadable project `plugin-overrides.json` being ignored silently, which re-enabled project-disabled plugins without a trace; omp now logs a warning naming the file ([#14518](https://github.com/can1357/oh-my-pi/issues/14518), [#14573](https://github.com/can1357/oh-my-pi/pull/14573) by [@oleg494](https://github.com/oleg494))
- Fixed Claude Opus 5.5 and Sonnet 5.5 disappearing with mixed-access Google Antigravity accounts; models now route to accounts that serve them, and revoked accounts no longer block catalog refresh ([#14924](https://github.com/can1357/oh-my-pi/issues/14924)).
- Fixed clipboard-pasted image chips opening a nonexistent file instead of the image, including after `/move` ([#14927](https://github.com/can1357/oh-my-pi/issues/14927)).
- Fixed clipboard-pasted image chips opening the auto-resized copy sent to the model instead of the image as pasted ([#14929](https://github.com/can1357/oh-my-pi/pull/14929))
- Fixed `omp token <provider> --account N --force-refresh` printing the stored token unchanged while it was still valid; it now re-mints that account. Security scans pinned to one account, including Codex Security cloud requests, refresh it after a 401 and may reuse a still-usable token minted in the previous five minutes, as `omp auth-broker serve` now also may for its clients' 401 recovery ([#14752](https://github.com/can1357/oh-my-pi/pull/14752) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed revived subagents moving to the parent's automatically chosen account and re-writing their whole prompt cache instead of staying on the account that served their earlier turns; a parent's explicit `/session pin` still moves them ([#14749](https://github.com/can1357/oh-my-pi/pull/14749) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed a fallback chain switching back to a usage-limited primary model every 30 minutes, failing a request each time, when the provider's usage report showed a later reset; the session now stays on the fallback until that reset ([#14757](https://github.com/can1357/oh-my-pi/pull/14757) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed `/usage`, the status line usage segment and `/logout` treating every Google Antigravity account (and every Codex Team seat in one workspace) as the session's account, and `omp usage` not listing such an account when its usage fetch failed ([#14900](https://github.com/can1357/oh-my-pi/pull/14900) by [@will-bogusz](https://github.com/will-bogusz))
- Fixed Tern showing an agent as finished when automatic context maintenance ends partway through a turn; omp now keeps reporting the turn's working state until the turn actually ends ([#14917](https://github.com/can1357/oh-my-pi/pull/14917) by [@wolfiesch](https://github.com/wolfiesch))
- Fixed the terminal title and Tern busy state staying in the working state after an interrupt cancels a scheduled retry or continuation before it starts ([#14917](https://github.com/can1357/oh-my-pi/pull/14917) by [@wolfiesch](https://github.com/wolfiesch))
- Fixed Anthropic web search through a custom `anthropic-messages` provider sending a plain API-key request even though the provider's conversations use Claude Code request shaping; search now honors the model's `isOAuth` like the main conversation, so keys that only work with that shaping no longer fail with HTTP 429 `rate_limit_error` ([#14919](https://github.com/can1357/oh-my-pi/pull/14919) by [@farnoy](https://github.com/farnoy))
- Fixed Anthropic web search spreading the model's configured headers under its own without the main conversation's case-insensitive merge and enforced-header filtering, so a configured `authorization` header could replace the credential or join it comma-separated on the wire ([#14919](https://github.com/can1357/oh-my-pi/pull/14919) by [@farnoy](https://github.com/farnoy))
- Published tarballs now carry real dependency versions instead of Bun's `catalog:` protocol (1.1.0 installs failed with "Unsupported URL Type catalog:").

### Removed

- Removed the `PI_SUBPROCESS_CMD` environment variable; subagents run in-process and never read it ([#14632](https://github.com/can1357/oh-my-pi/pull/14632) by [@jorgoose](https://github.com/jorgoose))

## [1.1.27] - 2026-10-07

### Added

- Write-tool previews now render as files stream: SVG files appear as images, and Mermaid files (`.mmd` and `.mermaid`) appear as diagrams. Tern also previews supported 3D model formats (`.obj`, `.ply`, `.wrl`, `.x3dv`, `.stl`, `.gltf`, and `.usda`) and renders SVG writes as SVG figures.
- Added the `title.icons` setting to show session title cards with a Nerd Font glyph and emoji fallback (`nf+emoji`, default), always the emoji (`emoji`), or as plain titles (`boring`).
- Added the `title.generator` setting to name sessions from a fork of the reply (`fork`, default) or with the title model only (`tiny`).

### Changed

- Session titles are generated using the session's model when possible, with a fallback to the lightweight title model; `TITLE_SYSTEM.md` continues to override the title prompt.
- Session titles now include a card index, icon, and short code, with appropriate Nerd Font rendering in Tern panes.
- When Nerd Font symbols are unavailable, session titling requests only an emoji.
- Subagent completion indicators now advance to 99% when the subagent submits its result.
- In Tern panes, headed and headless browser opens are shown in Tern picture-in-picture by default; set `app.tern: false`, `browser.tern`, or `PI_BROWSER_TERN=0` to open Chromium instead.
- In Tern panes, `/fork` opens the fork in a neighboring pane while preserving the original session.
- Tern's empty composer now shows the session title, or “What are we cooking?” when no title is available.
- Tern todo cards now display their checklist by default and can be collapsed by clicking the card header.
- Improved performance across browser extraction, web and document fetching, file tools, search, session handling, LSP/DAP, MCP, subagents, SSH file operations, image processing, voice and dictation, collaboration, and large-output or large-file workflows.
- Prompt history search now updates shortly after typing stops while Enter and mouse selections use the latest query.
- Improved responsiveness and reduced resource usage for long sessions, large files and documents, streaming evaluations, terminal graphics, live voice calls, and other high-volume workflows.
- Hosts that are not supported Mastodon, Lemmy, or Discourse instances are no longer repeatedly probed for those services, improving URL-fetch performance.

### Fixed

- Fixed a message sent while an earlier title request was still running never getting its own try at naming the session when that request came back empty.
- Fixed `/new` incorrectly carrying plan mode, its plan-specific model, or goal mode into the new session.
- Fixed todo lists failing to auto-clear while subagents streamed progress.
- Fixed memory growth during ACP client-terminal commands.
- Fixed freezes after large pastes containing unclosed tags.
- Fixed slowdowns when processing long evaluation output, large Python kernel results, compiler/linter output, and ephemeral side-channel replies.
- Fixed documents served as `application/octet-stream` being downloaded twice.
- Fixed collaboration guests rebuilding the transcript excessively during streaming.

## [1.1.24] - 2026-10-03

### Added

- Skills in nested router trees (up to 3 levels, e.g. `.agents/skills` router → category → leaf) are now all discoverable, and `skills.enableOfficial` actually toggles the bundled official skills.

### Changed

- Usage/help strings across `config`/`plugin`/`setup`/`update`/`login`/`shell`/`web-search` and the docs corpus show canonical bin names only (`zetacode`/`zetaide`/`zetaeditor`); spaced forms like "zeta code" no longer appear anywhere user-visible.

### Fixed

- Session exit tips and every command example now name the coding CLI (`zeta-c`) instead of the workbench `zeta` — following the old `zeta --resume <id>` hint silently opened the Zetawork workbench and did nothing.
- `--resume` ids pasted with a trailing `/` (or a `.jsonl` suffix) resolve as session ids again; an explicit transcript path that does not exist now errors with a usage hint instead of silently minting an empty session.
- `update` on Windows no longer writes or retires the workbench `zeta` shims (it manages only this package's `zeta-c`/`zeta-cli`/`zetacode`), and its GitHub/mise fallbacks point at Linxira-OS/linxira-zeta.
- npm source installs no longer silently miss the bundled official skills, and reseeding the official-skills embed prunes stale files.
- Plugins get a per-plugin storage contract: `pi.storage` (`dataDir`/`cacheDir`/`stateDir` under `~/.zeta/plugins/`) is injected into every extension factory, with `adoptLegacyFileOnce` as the one-time migration primitive — plugins no longer need to invent their own paths in the user data tree.
- Models already configured in upstream OMP (`~/.zeta/agent/models.yml` providers and `/login` API keys) now appear in the model list automatically, badged "来自 OMP" — read-only mapping, keys reused in memory, Zeta-local config always wins; nothing is written back to the upstream install.

## [1.1.16] - 2026-09-19

- 上游 v18.2.5 同步:streaming CLI 命令、热路径记忆化(工具 schema/stamp/which 缓存)、TUI 主题与覆盖层组件迁移至 pi-tui、Astra 上下文确定性策略、eval 判定桥与 Python prelude 维护。
- 修复 bun 1.4.0 bytecode 编译产物启动崩溃(desktop smoke 全平台)。
- 设置项新增 Stream 分区与 stencil.so 流式认证。

## [1.1.13] - 2026-09-10

- 上游 v18.1.16 同步:任务执行器 AgentBusyError、事件循环 keepalive、idle 封装截止时间、上下文笔记等。
- 修复中文界面设置布尔项无法关闭的问题(显示文案误入机器值匹配)。
- `/language` 切换后斜杠命令描述即时刷新,无需重启。
- Plan/Plan-ultra/Vibe/Goal 模式横幅与 attach 模式提示接入 i18n;`/loop`、`/rename` 描述进目录。

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

## [1.1.2] - 2026-08-25

### Fixed

- Republished as 1.1.2 to reset the `latest` tag after the broken 1.1.0 (no functional change over 1.1.1).

## [1.1.0] - 2026-08-25

### Changed

- TUI 渲染升级至上游 v18.0.3 架构（provider window + resize 重绘），终端尺寸变化即时重绘。

## [1.0.10] - 2026-08-19

### Added

- Added a web gateway `enter_plan_mode` command and a session `enterPlanMode` path so the web-ui `/plan` slash command actually enters plan mode (plan file, `write` tool, plan-approval wiring, optional initial prompt) instead of forwarding a literal message.
- Added an interactive confirm to `zeta update` before installing a new version (default no on non-TTY input); `--yes`/`-y` skips it.

### Changed

- WeChat login now prefers the new `/api/v1/wechat` endpoints (endpoint host configurable via `channels.wechat.endpoint`); older hosts fall back to the legacy iLink QR flow.

### Fixed

- Fixed the transcript collapsing into a compact no-spacing layout whenever the prompt, todo HUD, or other below-transcript chrome grew a few rows; the live tail now scrolls off the top instead.
- Fixed transcript layout and rebuilding issues that could collapse blank rows, leave tool calls displayed on one line, or show stale fragments after navigation, display changes, or compaction ([#12177](https://github.com/can1357/oh-my-pi/pull/12177) by [@shivamklr](https://github.com/shivamklr)).
- Fixed the `security-reviewer` agent so valid findings with anchors and remediation details are accepted.
- Stopping a subagent from Agent Hub now settles and reports its parent background job instead of leaving `hub wait` blocked indefinitely.
- Fixed prewalk handoff detection after edits or writes dispatched through Code Mode eval cells.
- Reduced main-thread stalls while streaming large edits by deferring AST-based matching until the edit is complete.
- Corrected the `/handoff` description so it accurately reflects that the command creates a handoff document and compacts the current session.
- Deferred misleading cold-cache `retry.fallbackChains` warnings until provider discovery completes.
- Fixed `--prewalk-into @default` so an explicitly selected startup model does not replace the configured default role, including ordered fallbacks and discovery-backed candidates.
- A corrupted or externally modified session file no longer leaves the session impossible to close; a subsequent Ctrl+C exits without rewriting the session log.
- Fixed silent MCP requests being terminated by an undeclared idle timeout; closing a legacy SSE connection now also cancels pending requests and notifications.
- Fixed browser reuse for Chromium installed behind Linux wrapper scripts and prevented duplicate launches when a profile is locked ([#12236](https://github.com/can1357/oh-my-pi/pull/12236) by [@shivamklr](https://github.com/shivamklr)).

Older entries are archived in [packages/coding-agent/CHANGELOG.md@5ae2ef3569ca](https://github.com/can1357/oh-my-pi/blob/5ae2ef3569ca9299b7eb101ad7ef0d316d30f551/packages/coding-agent/CHANGELOG.md).

Older entries are archived in [packages/coding-agent/CHANGELOG.md@1e3cc3ab94d0](https://github.com/can1357/oh-my-pi/blob/1e3cc3ab94d05617e79fb12d95711d58161747d3/packages/coding-agent/CHANGELOG.md).
