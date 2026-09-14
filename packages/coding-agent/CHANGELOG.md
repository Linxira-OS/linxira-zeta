# Changelog

## [Unreleased]

## [1.1.14] - 2026-09-12

- Web 网关新增模型目录三端点(`/api/models-config/catalog|discover|metadata`),ModelsConfig 支持在线模型目录、按 API 类型的发现与元数据;补 `/api/agent/running` 字面路由。
- CLI 侧边栏改为插件式 widget 注册表(`ctx.ui.registerSidebarWidget`),第三方 widget 由 `tui.sidebarWidgets` 开关控制(默认关);移除与状态行重复的 Session 面板。
- `/settings reset [confirm|<key>]`:支持全部重置(二次确认)与单键重置。

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
## [18.1.21] - 2026-09-14

### Fixed

- Fixed Flatpak Chromium launcher executables (including `com.google.Chrome`, `org.chromium.Chromium`, and `io.github.ungoogled_software.ungoogled_chromium`) so `app.path` is treated as a browser and gets managed Chromium profile handling
- Fixed Chromium `--user-data-dir` handling by normalizing `--user-data-dir <dir>` and relative profile paths to absolute `--user-data-dir=...` values before launch
- Browser automation now works alongside an already-running Chrome using an isolated profile, keeps requested profiles separate, and never kills reused browser processes.
- First-use Chromium installation and browser operations no longer consume Eval's runtime timeout or reset its kernel while waiting.
- Browser startup reuses a successful system-Chrome fallback instead of retrying an unavailable download during the same open.
- Browser clicks and other interactions no longer stall when OMP-owned tabs are in the background, including after worker timeout recovery.

## [18.1.20] - 2026-09-13

### Added

- Added `collab.autoStart` (`off` | `view` | `control`): every local interactive session hosts itself as it starts and rotates its room on `/new`, `/resume`, fork, or branch, so a phone or dashboard can reach any running session without running `/collab` first ([#11908](https://github.com/can1357/oh-my-pi/pull/11908) by [@alphastorm](https://github.com/alphastorm) and [@sorphwer](https://github.com/sorphwer)).
- Added `omp collab list [--json]` and `/collab list` to enumerate every live local Collab host (instance, generation, session, cwd, model, participants, relay/attention state, access) without exposing links, plus `omp collab link <instanceId|pid> [--view]` to fetch one generation-bound browser URL from a private per-room Unix socket/named pipe registry; room keys, write tokens, and URLs never touch disk ([#6099](https://github.com/can1357/oh-my-pi/issues/6099); [#11908](https://github.com/can1357/oh-my-pi/pull/11908) by [@alphastorm](https://github.com/alphastorm) and [@sorphwer](https://github.com/sorphwer)).

### Changed

- Documented that native JS/TS hook factories must live in `.omp/hooks/pre/` or `.omp/hooks/post/` (not directly in `.omp/hooks/`), and cross-linked the hooks and extension-loading docs ([#11942](https://github.com/can1357/oh-my-pi/issues/11942)).

### Fixed

- The hidden notice announcing a mid-session tool-availability change now states that it lists only what changed, so an additions-only notice no longer reads as the complete tool set and the model keeps using tools that are still callable ([#11824](https://github.com/can1357/oh-my-pi/issues/11824) by [@camjac251](https://github.com/camjac251)).
- TTSR stream buffers now reset at every assistant message boundary, not only at turn start, so a `scope: text` or tool-argument rule can no longer fire on a later message because of text streamed by an earlier response in the same turn ([#11957](https://github.com/can1357/oh-my-pi/pull/11957) by [@srobroek](https://github.com/srobroek)).
- Eval `completion()` calls now use configured retry fallback chains when their role model fails ([#11989](https://github.com/can1357/oh-my-pi/issues/11989)).
- Eval `completion()` fallback chains now also apply to unqualified role models, walk into a failed fallback's own model chain, stop at `retry.maxRetries`, and resolve session-sticky credentials with the session id ([#11989](https://github.com/can1357/oh-my-pi/issues/11989)).
- Eval `completion()` fallbacks now keep depth-first chain order, inherit the failed candidate's effort for bare nested entries, and skip keyless candidates without spending `retry.maxRetries` budget ([#11989](https://github.com/can1357/oh-my-pi/issues/11989)).
- Eval `completion()` fallbacks reached at different efforts now each walk their shared descendants instead of truncating the later effort's path ([#11989](https://github.com/can1357/oh-my-pi/issues/11989)).
- Fixed ranged grep rejecting existing files with glob characters in their names ([#11977](https://github.com/can1357/oh-my-pi/issues/11977)).
- Notified Collab guests when admitted prompts are discarded, including room retirement during a session change ([#11908](https://github.com/can1357/oh-my-pi/pull/11908) by [@alphastorm](https://github.com/alphastorm)).
- Preserved pending Collab dialog answers across session-switch rollback without accepting them after commit, stop, or writer departure ([#11908](https://github.com/can1357/oh-my-pi/pull/11908) by [@alphastorm](https://github.com/alphastorm)).
- Fixed prompts awaiting setup crossing a fork, branch, or tree-navigation commit, multi-question extension dialogs moving later questions to a replacement Collab room, and stale rooms blocking `/collab` or `/join` after a failed session change ([#11908](https://github.com/can1357/oh-my-pi/pull/11908) by [@alphastorm](https://github.com/alphastorm)).
- Fixed background task cards missing their final completion or failure after an early result or live-session focus replay.
- Ranged reads on Windows no longer intermittently open the selector-suffixed path when filesystem probes return transient errors ([#11284](https://github.com/can1357/oh-my-pi/issues/11284)).

## [18.1.19] - 2026-09-12

- Fixed `--mode json` returning exit 0 on a turn-fatal provider/auth/network error ([#11498](https://github.com/can1357/oh-my-pi/issues/11498)).

### Added

- Added default-off speculative execution for validated local reads, including reads projected from nested JavaScript and Python eval cells.
- `/usage` now shows prepaid credit balances (e.g. Charm Hyper's `100 credits left`) on the provider cards and account summaries instead of `no data` ([#11656](https://github.com/can1357/oh-my-pi/pull/11656) by [@oldschoola](https://github.com/oldschoola)).
- Retry fallback chains now support per-model reasoning efforts: a fallback entry may carry an explicit thinking suffix (`"default": ["openai/gpt-5-mini:low"]`), and pressing `t` on a fallback row in `/models` sets or clears it. Bare entries keep inheriting the failing turn's effort. ([#11842](https://github.com/can1357/oh-my-pi/pull/11842) by [@H4vC](https://github.com/H4vC)).
- Added `task.agentServiceTierOverrides` for sparse exact-name service-tier overrides on task/eval agents, so selected agents can use priority/Fast mode without accelerating every subagent ([#9668](https://github.com/can1357/oh-my-pi/pull/9668) by [@alphastorm](https://github.com/alphastorm)).
- Added session-local `/btw` history with persistent answers and follow-ups; bare `/btw` reopens history, Escape cancels running answers before closing, and new questions no longer replace an in-progress answer.
- Added `f follow up` in BTW history to continue a selected side conversation with an English input prompt, persistent multi-turn history, and no changes to the main conversation.
- Completed inline BTW answers now support `f follow up` directly; history uses `Tab` for pane navigation and `Enter` or `f` to start a follow-up.
- Codex web search now accepts valid email-only OAuth credentials without requiring or fabricating a `ChatGPT-Account-Id` header ([#11847](https://github.com/can1357/oh-my-pi/pull/11847) by [@nguyennguyenit](https://github.com/nguyennguyenit)).
- Sessions now stay alive when their working directory is removed instead of crashing while preparing shell tools ([#11828](https://github.com/can1357/oh-my-pi/issues/11828)).
- MCP tool calls spelled with the Claude Code doubled separator (`mcp__server__tool`) now reach their registered tool ([#11516](https://github.com/can1357/oh-my-pi/issues/11516) by [@oldschoola](https://github.com/oldschoola)).
- MCP HTTP reconnects now release obsolete tool generations instead of growing session memory on every reconnect ([#11784](https://github.com/can1357/oh-my-pi/issues/11784)).
- `/debug` memory reports now keep large heap snapshots out of JavaScript strings and reject empty snapshots instead of saving zero-byte files ([#11785](https://github.com/can1357/oh-my-pi/issues/11785)).
- Sloppy-mode edits now drop a copied `[N more lines in ...]` read notice the same way they already drop the other read-metadata rows, so a pasted projection can no longer leak into the matched pattern or the written text ([#11797](https://github.com/can1357/oh-my-pi/pull/11797) by [@vasyza](https://github.com/vasyza)).
- `/usage` now honors a provider's configured `baseUrl` when checking credentials before any model has been discovered, so a proxy-scoped API key is no longer sent to the provider's canonical host ([#11656](https://github.com/can1357/oh-my-pi/pull/11656) by [@oldschoola](https://github.com/oldschoola)).

### Fixed

- Fixed automatic custom-tool loading trying to execute package metadata and declarative files, including metadata shadowing an executable tool with the same name ([#11864](https://github.com/can1357/oh-my-pi/pull/11864) by [@moodiness](https://github.com/moodiness)).
- Fixed successful Python kernel shutdowns being reported as unconfirmed and leaving spawned child processes running ([#11865](https://github.com/can1357/oh-my-pi/pull/11865) by [@moodiness](https://github.com/moodiness)).
- Fixed completed tool cards reverting to pending after refocusing live sessions, and tool output collapsing behind finished reasoning segments ([#11868](https://github.com/can1357/oh-my-pi/pull/11868) by [@serverinspector](https://github.com/serverinspector)).
- Invalid `WATCHDOG.yml` entries now produce startup/editor warnings while healthy advisors remain available ([#11882](https://github.com/can1357/oh-my-pi/pull/11882) by [@olegpulatov](https://github.com/olegpulatov)).
- Claude Code session imports now preserve typed user text stored alongside tool results ([#11854](https://github.com/can1357/oh-my-pi/issues/11854)).
- Extension commands now settle BTW writes before creating, switching, or branching sessions, preventing side requests from outliving their source session ([#11335](https://github.com/can1357/oh-my-pi/pull/11335) by [@Ant39140](https://github.com/Ant39140)).
- Session selection and active-session deletion now settle BTW writes before switching or removing history, preventing stale saves from blocking the next session ([#11335](https://github.com/can1357/oh-my-pi/pull/11335) by [@Ant39140](https://github.com/Ant39140)).
- Escape now cancels BTW follow-ups that are still waiting for startup writes, without launching a model request ([#11335](https://github.com/can1357/oh-my-pi/pull/11335) by [@Ant39140](https://github.com/Ant39140)).
- BTW history now rejects out-of-range timestamps instead of failing during display ([#11335](https://github.com/can1357/oh-my-pi/pull/11335) by [@Ant39140](https://github.com/Ant39140)).
- BTW follow-ups now preserve separate user/assistant messages and reuse an isolated topic-specific provider session for prompt caching; cancellation or failure starts a fresh transport generation.
- Restored Escape cancellation for running BTW answers and removed the separate `x` shortcut; cancelled output stays visible, and closing another history entry returns to any still-running BTW panel instead of hiding it.
- BTW history now rejects stale cross-process writes and protects running topics with an OS-backed lease, preventing one instance from erasing another instance's follow-ups.
- Copying a BTW topic now falls back to its most recent nonempty answer after an empty failed or cancelled follow-up.
- Invalid or cancelled `/move` operations no longer cancel BTW requests; busy side conversations block relocation, and stalled history writes stop session operations with a bounded error instead of hanging indefinitely.
- Session shutdown now shows closing progress before waiting for live commands or BTW history writes, and stops progress updates when cleanup completes or fails.
- Failed BTW terminal saves now block session operations while retaining the answer for copying and safe retry, instead of being treated as a successful flush.
- Standalone `!cd` now shares the BTW relocation guard with `/move` and `/wt`, refusing before shell execution when a side conversation is active or unsaved.
- `/wt` now checks BTW migration availability before creating a branch or checkout, preventing unused worktrees when a side conversation is busy.
- `/move` now checks BTW migration availability before confirming or creating a missing target directory, preventing leftover directories after a refused move.
- BTW errors now shorten embedded home paths and sanitize control characters and oversized text before display, while retaining original diagnostic errors.
- Speculative reads now open the authorized resolved target while rendering the requested path, so enabling speculation no longer changes read output for symlinks; video targets are declined at authorization ([#11892](https://github.com/can1357/oh-my-pi/pull/11892) by [@h4vc](https://github.com/h4vc)).
- JavaScript speculation now verifies the retained tool-bridge dispatcher and string-coercion intrinsic identities before projecting reads ([#11892](https://github.com/can1357/oh-my-pi/pull/11892) by [@h4vc](https://github.com/h4vc)).
- Speculative eval sessions are now discarded at reconciliation when a hook or transform appends source the stream never verified, instead of releasing reads planned from the original code ([#11892](https://github.com/can1357/oh-my-pi/pull/11892) by [@h4vc](https://github.com/h4vc)).
- Speculative reads now classify format and rendering by the requested path while opening the resolved target, so symlinks with a different extension read exactly like ordinary reads ([#11892](https://github.com/can1357/oh-my-pi/pull/11892) by [@h4vc](https://github.com/h4vc)).
- JavaScript speculation now validates coercion intrinsics used by `String()` and `.join()` inputs, not just template and `+` operands ([#11892](https://github.com/can1357/oh-my-pi/pull/11892) by [@h4vc](https://github.com/h4vc)).
- Speculative reads now infer the summary language from the requested path while reading the resolved target, so cross-language symlinks summarize exactly like ordinary reads (by [@h4vc](https://github.com/h4vc)).
- The structural summary cache now keys on the parser language path, so one file read through different extensions no longer reuses a stale summary (by [@h4vc](https://github.com/h4vc)).
- Fixed the Windows installer failing on Windows PowerShell 5.1: OS architecture detection no longer depends on the .NET `RuntimeInformation` type that only resolves reliably on PowerShell 7, and the script now requires PowerShell 5.1+ with a clear upgrade message instead of failing cryptically ([#11905](https://github.com/can1357/oh-my-pi/pull/11905) by [@h4vc](https://github.com/h4vc)).
- Speculative reads now infer the summary language from the requested path while reading the resolved target, so cross-language symlinks summarize exactly like ordinary reads ([#11892](https://github.com/can1357/oh-my-pi/pull/11892) by [@h4vc](https://github.com/h4vc)).
- The structural summary cache now keys on the parser language path, so one file read through different extensions no longer reuses a stale summary ([#11892](https://github.com/can1357/oh-my-pi/pull/11892) by [@h4vc](https://github.com/h4vc)).

## [18.1.18] - 2026-09-11

### Added

- Enable `tui.mouse` to focus live subagent cards and jump-list rows by clicking them, with a hover highlight on the target; native selection becomes Shift+drag while on ([#11737](https://github.com/can1357/oh-my-pi/pull/11737) by [@H4vC](https://github.com/H4vC)).
- The pinned `Subagents` block now lists every live agent, collapsed to a few rows with a click expander by default; `display.pinnedAgents` switches it to `full` or `off` ([#11737](https://github.com/can1357/oh-my-pi/pull/11737) by [@H4vC](https://github.com/H4vC)).
- The `remote` compaction method now covers Claude: Anthropic server-side compaction (`compact-2026-01-12` beta) runs behind the existing `compaction.methodOrder` / `compaction.remoteEnabled` gates for first-party Anthropic models, persists its plain-text summary with a native replay payload that later Anthropic turns send back as a `compaction` block, and falls through to the next configured method on failure like OpenAI server compaction.

### Changed

- The `providers.cacheRetention` `auto` setting now keeps Anthropic OAuth subscriber sessions on 1h prompt-cache retention and API keys on 5m, instead of 5m for both ([#11667](https://github.com/can1357/oh-my-pi/pull/11667) by [@camjac251](https://github.com/camjac251)).

### Fixed

- Provider-native compaction (OpenAI Responses compact, Anthropic server-side compaction) re-issues the system prompt the live turn actually sent — a per-turn `before_agent_start` override included — instead of the rebuilt base prompt, and advisor compaction sends the advisor's own prompt instead of the generic summarizer prompt, so the request reads the live request's cached prefix.
- The `set_steering_mode`, `set_follow_up_mode`, and `set_interrupt_mode` RPC commands are now session-scoped, so a short-lived RPC client no longer silently writes queue-mode fields to the machine-global `config.yml`. The setters still persist by default, so the settings panel and existing callers are unaffected ([#11555](https://github.com/can1357/oh-my-pi/issues/11555)).
- Hand-authored `*.openapi.json` files can now be edited without disabling generated-file protection globally ([#11674](https://github.com/can1357/oh-my-pi/issues/11674)).
- `models.yml` now validates the per-model `compat.stripImageInput` opt-out, so a wrong-typed value is rejected like every other declared compat key instead of being silently accepted ([#11697](https://github.com/can1357/oh-my-pi/issues/11697)).
- `/mcp reload` now distinguishes servers still connecting after the bounded reload window instead of reporting a healthy asynchronous reload as zero active servers ([#11639](https://github.com/can1357/oh-my-pi/issues/11639)).
- Fixed isolated tasks dropping nested-repo work: nested diffs persist as `<agent>.nested-*.patch` before cleanup, `apply=false` lists each file, isolated agents report as non-resumable, and runs needing manual recovery report failed ([#11343](https://github.com/can1357/oh-my-pi/pull/11343) by [@grapexy](https://github.com/grapexy)).
- Fixed the Windows PowerShell installer (`install.ps1`) aborting on Windows PowerShell 5.1 when bun or git wrote normal progress to stderr: native commands now run with `$ErrorActionPreference` scoped to `Continue` and success is gated on the process exit code, so `$ErrorActionPreference = "Stop"`'s stderr-as-terminating-error behavior no longer kills the install ([#11675](https://github.com/can1357/oh-my-pi/issues/11675)).
- Eval cell timeouts no longer fatally terminate the session when a browser tab worker is being recycled ([#11707](https://github.com/can1357/oh-my-pi/issues/11707)).
- Models whose images are stripped on the wire (`compat.stripImageInput`) now trigger the `describeForTextModels` vision fallback and are skipped when resolving the vision model, instead of silently dropping images ([#9697](https://github.com/can1357/oh-my-pi/issues/9697)).
- Hiding tool activity (its shortcut or `display.hideToolActivity` in `/settings`) now replays native history, so blocks already retired to the terminal hide on the same keypress instead of waiting for another display toggle ([#11734](https://github.com/can1357/oh-my-pi/pull/11734) by [@notnotype](https://github.com/notnotype)).
- `#readProjectSettings` now logs capability warnings when a project `.claude/settings.json` fails to parse, instead of silently dropping them ([#11570](https://github.com/can1357/oh-my-pi/issues/11570)).
- A malformed project `.claude/settings.json` now produces a warning instead of being silently ignored ([#11570](https://github.com/can1357/oh-my-pi/issues/11570)).
- Reduced memory usage during long responses while thinking is hidden ([#11632](https://github.com/can1357/oh-my-pi/pull/11632) by [@redsolver](https://github.com/redsolver)).

## [18.1.17] - 2026-09-10

### Added

- Unsent prompts cleared with Ctrl+C can now be recalled with Up, including pastes and images; disable Recall Cleared Drafts in settings to discard future clears instead ([#11524](https://github.com/can1357/oh-my-pi/pull/11524) by [@camjac251](https://github.com/camjac251)).
- Added `tui.vimMode`, an opt-in modal editing layer for the prompt, off by default ([#3299](https://github.com/can1357/oh-my-pi/issues/3299)). Escape leaves Insert; Normal mode has `hjkl`, `0`, `^`, `$`, `w`, `b`, `e`, `gg`, `G`, count prefixes, `x`/`D`/`C`, `dd`/`yy`, `p`/`P` and `u`; `v`/`V` start a Visual selection that `y` copies and `d` deletes.
- Added a `vim` status-line segment showing the current Vim mode (`NORMAL`/`INSERT`/`VISUAL`/`V-LINE`), the half-typed command beside it (Vim's `showcmd`, e.g. `2d`), and the Visual selection height (`V-LINE 4L`). Included in every built-in preset and hidden entirely unless `tui.vimMode` is on; `custom` preset users can add `"vim"` to `statusLine.leftSegments`.
- The cursor now changes shape with the Vim mode: block in Normal/Visual, thin/underline in Insert. Applies to the software cursor, and to the real terminal cursor (DECSCUSR) when `PI_HARDWARE_CURSOR` is set.
- Added the `tui.vimModeDisplay` setting (`text` / `icon` / `none`) controlling how the Vim mode appears in the status line: the full mode name, a single glyph per mode, or nothing. Shown in `/settings` only while Vim mode is on.
- Added `icon.vimNormal`, `icon.vimInsert`, `icon.vimVisual`, and `icon.vimVisualLine` symbols, so the Vim mode icons follow the active symbol preset like every other status-line icon — Nerd Font (fa-square / fa-pencil / fa-eye / fa-bars), Unicode (`■` `▎` `◉` `≡`), or ascii (`N`/`I`/`V`/`L`) — and can be overridden per theme via the `symbols` map.
- Added peak `↑` / off-peak `↓` indicators to the cost display for models with scheduled pricing (DeepSeek), refreshed automatically when the tariff changes.
- Added plan autosave: enable `plan.autosave` to automatically save approved plans to `<project>/.omp/plans/` when plan mode completes (customize with `plan.autosaveDir`, which accepts `~`, absolute, and cwd-relative paths) ([#11599](https://github.com/can1357/oh-my-pi/pull/11599) by [@H4vC](https://github.com/H4vC)).

### Changed

- Toggling `tui.vimMode` or `tui.vimModeDisplay` in `/settings` now takes effect immediately instead of requiring a restart; the editor, prompt border, status-line segment, and cursor shape all switch in place.
- The prompt border now colors Insert mode too (green), instead of falling through to the session accent. Normal and Visual were already colored, so Insert was the one mode the border could not distinguish — on themes whose accent matches the session accent it was indistinguishable from Normal. Borders outside Vim mode are unchanged.

### Fixed

- Marketplace plugins that share a repository root now load only their declared skills instead of every skill in the repository ([#11513](https://github.com/can1357/oh-my-pi/issues/11513)).
- Fixed collab host UI requests raised before a writable guest joins being lost; up to 64 pending asks now replay only to writable guests, and already-aborted asks no longer consume request IDs ([#9031](https://github.com/can1357/oh-my-pi/pull/9031) by [@alphastorm](https://github.com/alphastorm)).
- Collab hosts now acknowledge a writable guest's `ui-response` for an already-settled request with a targeted `ui-request-end`, so a guest that reconnected after the broadcast and resent its answer no longer waits forever ([#11561](https://github.com/can1357/oh-my-pi/pull/11561) by [@alphastorm](https://github.com/alphastorm)).
- Streaming edit guard (`edit.streamingAbort`) no longer aborts on no-op preview results when replacement content produces no file changes, and carries the native patch diagnostic through the abort reason on genuine preview failures.
- Repeated soft compaction now includes messages retained by the previous pass instead of silently dropping them from model context.
- Fixed the ask dialog splattering option descriptions and previews one word per row when a model injects `\r` runs into tool-call string values (observed with GLM via OpenRouter); stray carriage returns are now sanitized in ask params, the live dialog, and ask transcript rendering ([#11167](https://github.com/can1357/oh-my-pi/pull/11167) by [@Giardi77](https://github.com/Giardi77)).
- `omp models` now reports whether a model's images actually reach the provider, so an id stripped by a text-only catalog rule no longer shows `images: yes` ([#9697](https://github.com/can1357/oh-my-pi/issues/9697)).
- Custom `Other` answers are now applied before the Ask dialog becomes interactive again, so the next Enter is no longer discarded ([#11558](https://github.com/can1357/oh-my-pi/pull/11558) by [@schickling-assistant](https://github.com/schickling-assistant)).
- Explicit per-model price overrides retain their configured flat rates instead of inheriting time-based pricing.
- Fixed wrong-typed `compat.stripImageInput` in `models.yml` being silently accepted, so the documented vision opt-out is now validated like its neighbours ([#11697](https://github.com/can1357/oh-my-pi/issues/11697)).

## [18.1.16] - 2026-09-09

### Added

- `/rename` without a title now generates a session name from recent conversation using the configured tiny model.
- Added opt-in experimental notes-backed context windows with persistent branch-local notes, searchable original session history, retained latest user requests, and a model-callable rollover tool, including in Code Mode.
- The `/resume` picker (Ctrl+L when bound to `app.session.resume`) marks the live session with a `current` label on its metadata line and focuses that row on open. ([#11381](https://github.com/can1357/oh-my-pi/pull/11381) by [@tkossak](https://github.com/tkossak))
- `/loop` accepts `--until '<cmd>'` / `--while '<cmd>'` to gate each iteration on a shell command's exit status, so a loop can stop on real project state instead of only a count or duration. ([#10858](https://github.com/can1357/oh-my-pi/pull/10858) by [@andyhite](https://github.com/andyhite))

### Fixed

- Fixed automatic recovery from proxied Python HTTP/2 stream resets and HTTP/1.1 chunked response interruptions, including continuation after completed tool calls ([#11160](https://github.com/can1357/oh-my-pi/pull/11160) by [@cyriusweng](https://github.com/cyriusweng)).
- Read error and preview rendering now sanitizes tabs and Windows-style CRLF (e.g. ssh host-key failures, tab-indented fetched content) so raw output can no longer tear the result frame.
- Unset `tiny` model roles now honor the configured `@smol` fallback in direct execution and the `/models` Roles view ([#11311](https://github.com/can1357/oh-my-pi/issues/11311)).
- Extension Control Center (`/extensions`) search now accepts `j` and `k`, so extensions like `jira`/`json` are searchable; bare `j`/`k` no longer move the list selection (use arrow keys or the configured `tui.select.up`/`down`) ([#11350](https://github.com/can1357/oh-my-pi/issues/11350)).
- Codex turns interrupted before terminal completion now auto-continue after resolved tool calls instead of stopping ([#11349](https://github.com/can1357/oh-my-pi/issues/11349)).
- Fixed the status line's `pi` brand/working segment double-padding the first separator, so every gap around a separator is a single space ([#11103](https://github.com/can1357/oh-my-pi/issues/11103)).
- `/handoff` no longer leaves the TUI in a running state when completion races with delayed session events ([#11263](https://github.com/can1357/oh-my-pi/issues/11263)).
- Fixed legacy Pi extensions failing to load when calling `ctx.isProjectTrusted()` in an event handler; the extension context now exposes it (always `true`, since OMP applies no project-trust gating) ([#7955](https://github.com/can1357/oh-my-pi/issues/7955)).
- Fixed Ctrl+Z jobs exiting successfully after `fg` instead of restarting the TUI because terminal teardown left Bun without a referenced event-loop handle while waiting for `SIGCONT` ([#8585](https://github.com/can1357/oh-my-pi/issues/8585)).
- Extensions loaded by the npm CLI now apply settings overrides to the active session, so generated agents and model choices remain isolated between sessions ([#11047](https://github.com/can1357/oh-my-pi/pull/11047) by [@mgpai22](https://github.com/mgpai22)).
- Live task dispatch now reloads added, changed, removed, and deleted project task and retry settings before resolving subagents ([#11191](https://github.com/can1357/oh-my-pi/issues/11191)).
- Reset `/loop` iterations combined with `--while` / `--until` no longer keep submitting without resetting when vibe mode is enabled while the condition command is still running; the loop now disables itself instead ([#10858](https://github.com/can1357/oh-my-pi/pull/10858)).
- Returning from a focused agent (Agent Hub) now re-renders the main session's queued steering/follow-up block instead of leaving it blank until the next repaint ([#11379](https://github.com/can1357/oh-my-pi/issues/11379)).

## [18.1.15] - 2026-09-08

### Added

- Added the `retry.waitForUsageReset` setting: when a provider reports usage-limit exhaustion with a reset time (5-hour or weekly quota windows on any provider), the session sleeps until the reset instead of failing fast past `retry.maxDelayMs`.
- Added `advisor.maxNotesPerUpdate` setting and `WATCHDOG.yml` configuration (default `4`): allows reasoning verifiers to batch findings in a single review update without being rate-limited.
- Headless browser tabs now freeze when a turn settles so idle animated/WebGL pages stop burning CPU/GPU, resuming automatically on next use; tabs idle past `browser.idleCloseSec` (default 30 minutes) are closed. `persist: true` on `browser.open` opts a tab out of both ([#8246](https://github.com/can1357/oh-my-pi/issues/8246) by [@H4vC](https://github.com/H4vC)).

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
- Task descriptions containing tabs no longer misalign or overflow task rows; tabs are expanded before measuring and rendering.
- GitHub Copilot model-policy 403s (plan, model policy, org restriction) no longer delete stored credentials, so the provider stays listed in `/model` after a per-model access denial instead of disappearing until the next `/login` ([#11280](https://github.com/can1357/oh-my-pi/pull/11280) by [@H4vC](https://github.com/H4vC)).
- Bash results no longer replace a failing command's output with the shell minimizer's lossy summary when the original capture cannot be persisted as an artifact; the raw diagnostics are kept so a failure stays actionable ([#11081](https://github.com/can1357/oh-my-pi/issues/11081)).
- Fixed worker subprocesses failing to declare themselves as worker hosts before dispatching selectors, which prevented nested thread worker spawns during `/usage` stats sync on multi-core systems.
- Fixed `/usage` displaying a misleading generic database read failure when activity loading fails; the error detail is now sanitized, collapsed to a single line with shortened paths, and surfaced in the dashboard.
- Advisor notes now report rate limiting accurately, blockers always interrupt even after a lower-severity note in the same update, and deferred notes flush when the primary run completes, including after advisor quota exhaustion ([#11062](https://github.com/can1357/oh-my-pi/issues/11062)).
- Fixed the built-in clangd registration omitting CUDA source and header files (`.cu` and `.cuh`) ([#10782](https://github.com/can1357/oh-my-pi/pull/10782) by [@alphastorm](https://github.com/alphastorm)).
- Fixed `ast_grep` skipping CUDA headers and ignoring an explicit `lang` override for ambiguous file extensions ([#10782](https://github.com/can1357/oh-my-pi/pull/10782) by [@alphastorm](https://github.com/alphastorm)).
- Python cells are no longer replayed automatically after a kernel crash, preventing duplicate side effects; the next call starts a fresh kernel.
- Session rewrites preserve open-reader snapshots and replacement identity when a rename needs an EPERM fallback.
- Fixed WorkPool children retaining a stale Gemini-formatted `yield` declaration when pooled items were installed or cleared.
- Preserve effective context and output limits when model overrides change unrelated settings, such as thinking effort levels.

## [1.1.10] - 2026-09-07

- Fixed edit and write results to report the formatted bytes actually committed by LSP writethrough.

### Added

- OMP v18.1.12 sync baseline: `memory://` now resolves against the session that issued it: a caller's own memory backend answers `memory://<id>`, so co-located sessions no longer read each other's memory rows, and a caller whose session is no longer live fails closed instead of being answered by a peer. Prompt completion binds to the same caller, so `memory://<memory-id>` stays on offer while a subagent shares the working directory. Advisors retain their owning session's memory access even without a session file.
- OMP v18.1.11 sync baseline (`e3106be68f`): `retry.waitForUsageReset` — when a provider reports usage-limit exhaustion with a reset time (5-hour or weekly quota windows), the session sleeps until the reset instead of failing fast past `retry.maxDelayMs`; opt-in `bash.allowCompoundCommands` approval evaluates conservative literal `&&` chains per segment (requires a POSIX-quoting shell; whole-chain denies take precedence over earlier prompts).
- Added `/prewalk restart` to return an active session to its `@default` model and re-arm the one-shot handoff to `@smol`.

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
- Fixed frame skips while streaming long markdown Write previews ([#10955](https://github.com/can1357/oh-my-pi/issues/10955)).
- LiteLLM discovery no longer caches an empty catalog after a timed-out run: a rich-metadata timeout now falls back to `/v1/models`, and a discovery failure with no prior catalog leaves the cache untouched so the next launch retries immediately instead of hiding discovery-only models ([#10964](https://github.com/can1357/oh-my-pi/issues/10964)).
- Searching `free` in the model picker now finds every zero-cost model, not just the ones with `free` in their id.

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

## [17.2.9] - 2026-08-05

### Breaking Changes

- Renamed `compareVersions` to `compareChangelogEntries` in `@oh-my-pi/pi-coding-agent/utils/changelog`. The function signature and behavior are unchanged; update imports to use the new name.

### Added

- Added automatic detection of common Ungoogled Chromium Linux installations for the browser tool.

### Changed

- Restored the legacy project-scoped session directory naming scheme and removed its automatic migration ([#7646](https://github.com/can1357/oh-my-pi/issues/7646)).
- Routed Bun install-cache pruning in `update-cli` through the shared `compareVersions` utility (`@oh-my-pi/pi-utils`), removing a duplicate local comparator that rounded large numeric version identifiers via `Number`.

### Fixed

- Retried concurrent-request caps with a short backoff without deleting valid Copilot credentials or rotating through sibling accounts.
- Fixed the default `textVerbosity` setting being forwarded to OpenAI Codex requests unless the user explicitly configures it, preserving Codex's native response-control defaults. ([#4949](https://github.com/can1357/oh-my-pi/issues/4949))
- Reduced streaming CPU usage by coalescing the cumulative `message_update` deltas of a turn at the event-controller dispatch boundary: at most one streaming-state rebuild runs per ~33ms window instead of one per token, cutting the per-token handler work that dominated the CPU profile of streaming sessions (especially at high token rates) while preserving per-delta speech output. Subscriber dispatch is serialized so a rapid stream tail (`message_update` → `message_end` → `agent_end`) cannot overtake the coalesced flush. ([#7443](https://github.com/can1357/oh-my-pi/issues/7443))
- Fixed translated MCP importers (Claude Code, Cursor, Gemini CLI, Windsurf, VS Code) silently dropping a server's `enabled: false` flag, so a server disabled at the source config stayed mounted; the flag is now propagated and honored like Codex, OpenCode, and native `mcp.json`. These importers now also load project entries before same-named user entries (matching native/Codex) so a project `enabled: false` suppresses a same-named user server ([#7652](https://github.com/can1357/oh-my-pi/issues/7652)).
- Removed the per-call `model` override from the eval `agent()` helper (all runtimes), completing the earlier task-tool removal (`9f8aa87dbf`). Subagents always use their selected agent's frontmatter model and settings; a legacy `model` argument is silently ignored, so an explicit `model: "default"` can no longer route children onto the parent session model ([#6438](https://github.com/can1357/oh-my-pi/issues/6438)).
- Fixed legacy Pi extension validation rejecting plugins such as `remote-pi` that import the package-root `convertToPng` image helper. ([#7610](https://github.com/can1357/oh-my-pi/issues/7610))
- Fixed the legacy session-directory migration silently deleting a live session's transcript when its filename collided with an existing entry in the destination: colliding entries are now preserved in place, the legacy directory is only removed when empty, and collisions/migration failures are logged ([#7593](https://github.com/can1357/oh-my-pi/issues/7593)).
- Fixed `PUPPETEER_EXECUTABLE_PATH` being ignored when a system Chrome installation was detected, preventing Windows users from selecting a compatible headless browser for the shared browser daemon ([#7601](https://github.com/can1357/oh-my-pi/issues/7601)).
- Fixed `openai-models-list` discovery ignoring server-advertised input modalities, so custom virtual tier IDs absent from the bundled catalog showed `images: no` even when the `/v1/models` response reported `input: ["text","image"]` ([#7583](https://github.com/can1357/oh-my-pi/issues/7583)).
- Exposed exact source line counts in read results when selector-based reads reach EOF, allowing protocol bridges to distinguish a returned slice from the complete file ([#7590](https://github.com/can1357/oh-my-pi/issues/7590)).
- Fixed `grep`/`glob` silently collapsing a semicolon-delimited `path` list to one literal path when the joined string was too long for the OS to name (`ENAMETOOLONG`) — a list of bare filenames past `NAME_MAX` or absolute paths past `PATH_MAX` failed with `Path not found: <whole list>` even though every entry existed. The multipath probe now treats `ENAMETOOLONG` as a definitively non-existent single path so the split proceeds, and `glob` surfaces a clean `Path not found` instead of leaking the raw errno ([#7597](https://github.com/can1357/oh-my-pi/issues/7597)).
- Fixed `--mode json` (and text) print mode truncating a large final record (e.g. a multi-MB `agent_end`) when the process exited before stdout drained, while still exiting 0. Per-event writes are now serialized on their own completion callbacks and shutdown blocks on the last one, so the terminal record is delivered in full ([#7635](https://github.com/can1357/oh-my-pi/issues/7635)).
- Fixed text print mode treating buffered partial responses as replay-unsafe, allowing transient mid-stream connection failures to retry without exposing duplicated output ([#7625](https://github.com/can1357/oh-my-pi/issues/7625)).
- Fixed Hindsight `autoRecall` intermittently not reaching the model: two recall paths shared the `hasRecalledForFirstTurn` flag, and the `agent_start` event path could consume it first and inject only via an unawaited background prompt rebuild that a fast turn outran. `beforeAgentStartPrompt` (awaited before the turn builds) is now the sole injection path ([#7568](https://github.com/can1357/oh-my-pi/issues/7568)).
- Fixed `read memory://<id>` returning a confusing "Unknown memory namespace" error under `memory.backend=hindsight` (Hindsight stores memories server-side and has no `memory://` addressing); the handler now returns a corrective pointer to `recall`/`reflect` so a stray read — steered by the shared `recall` tool description — self-corrects in one turn ([#7587](https://github.com/can1357/oh-my-pi/issues/7587)).
- Fixed extension/custom/hook tool wrappers stripping schema methods off `parameters`: `applyToolProxy` bound every callable property, and binding a schema (a plain function carrying `toJsonSchema`/`assert`) dropped those properties, breaking wire-schema detection and crashing the status-line token estimator with `JSON.stringify(schema) === undefined`. Prototype methods are still bound; own data properties and schema callables now pass through untouched.
- Fixed bug where `agent()` calls in eval cells ignored turn cancellation and continued running indefinitely
- Fixed the built-in `tail` printing `tail: Broken pipe` and failing when a downstream pipeline reader exited early (e.g. `tail -c N file.jsonl | jq …` with jq aborting on a parse error); it now exits silently with 141 (128+SIGPIPE) like a real tail, in every output path including `--follow`.
- Fixed the in-process ps shell builtin rejecting common procps/BSD format specifiers (`ps -o tpgid,...` failed with `unknown output format specifier`); added `tpgid`, `pri`, `flags`, real/effective user and group columns, `wchan`, fault counters, `sz`, and the STAT `+` foreground flag.
- Fixed Herdr rejecting the macOS development launcher because its foreground process was reported as `bun` instead of `omp`.
- Completed usage-aware model fallback across startup, queued turns, same-turn tool continuations, ACP/TUI confirmation cancellation, eligible account reselection, cooldown restoration, and isolated subagent settings so low-usage handoffs remain lossless and cannot consume cancelled queued work.
- Fixed Agent Hub opening and selection becoming O(all rows) on large rosters: row rendering is now lazy around the selected viewport, and observer lookup is O(1) by id instead of copy-sorting every session per row.
- Fixed the bash interceptor blocking `grep`/`cat`/`find` used as a downstream pipeline stage (e.g. `printf 'x\n' | grep x`); a stage consuming piped stdin cannot be replaced by a path-based dedicated tool, so it is no longer matched, while standalone and first-stage searches stay intercepted ([#7496](https://github.com/can1357/oh-my-pi/issues/7496)).
- Fixed floating rejections from cmux browser guest JavaScript terminating the main process and every active session; attributable rejections now fail the browser run as tool errors while unrelated process rejections retain the fatal path ([#7365](https://github.com/can1357/oh-my-pi/issues/7365)).
- Fixed the Windows bash tool silently taking down the whole omp process when a command blocked until its timeout: cancelling a timed-out run walked the spawned child's descendant tree from raw `th32ParentProcessID` links, and a recycled pid matching the harness's stale recorded parent pid could enumerate omp as a false descendant and `TerminateProcess` it, killing the session with no `session_exit` record. Run-cancellation sweeps now refuse to signal the harness or any process collected beneath it, while still reaping the timed-out target when it owns a recycled ancestor pid ([#7452](https://github.com/can1357/oh-my-pi/issues/7452)).
- Fixed the unexpected-stop guard (`features.unexpectedStopDetection`) never firing for thinking-only stops: `isUnexpectedStopCandidate` only counted non-whitespace `text` blocks, so a `stopReason: "stop"` turn whose sole content was a signed `thinking` block (a trapped response or a truncated reasoning fragment from reasoning models) bypassed classification and silently ended the turn mid-task. Such stops are now candidates and are classified on their thinking text ([#7499](https://github.com/can1357/oh-my-pi/issues/7499)).
- Fixed Task cancellation hanging forever when a child ignored abort or stalled during cleanup ([#7483](https://github.com/can1357/oh-my-pi/issues/7483)).
- Fixed LSP diagnostics being dropped when servers normalize file URI percent-encoding or Windows path casing.
- Fixed WSL sessions missing Agent Skills stored in the Windows host profile's `.agents/skills` directory. ([#3779](https://github.com/can1357/oh-my-pi/issues/3779))
- Fixed `omp setup python` to validate the same configured or discovered interpreter used by the Python eval runtime.
- Fixed self-update misclassifying glibc Linux hosts with an installed musl loader as musl hosts, which could download an unusable musl binary instead of the glibc release.
- Fixed a crash where opening the Agent Hub after a resume and moving the selection triggered an unbounded `ExtensionExitError` unhandled-rejection storm and exit 129. The postmortem module bound the native hard-exit at first evaluation; when the bundler deferred that evaluation into a `withHostGuard` window it froze the guard's throwing replacement, poisoning every later signal/fatal exit. The native exit is now resolved per call, and the guard stamps its replacement with the native primitive it shadows so mid-guard signals still exit ([#7393](https://github.com/can1357/oh-my-pi/issues/7393)).

## [17.2.8] - 2026-08-04

### Changed

- Upgraded the bundled omptype schema engine: intersection and pipe operators, bigint and RegExp literals in the string DSL, Standard Schema V1 interop, JSON Schema import via fromJsonSchema(), and richer union/collection error reporting.

## [17.2.7] - 2026-08-03

### Changed

- Replaced arktype with @oh-my-pi/omptype for tool parameter and config schemas, significantly improving startup performance with ~100x faster schema construction. Config schema errors are now reported via OmpErrors using the same path/problem structure.

### Fixed

- Fixed an issue where custom, extension, or hook tool wrappers stripped schema methods off parameters, causing wire-schema detection failures and status-line token estimator crashes.
- Fixed a bug where agent() calls in evaluation cells ignored turn cancellation and continued running indefinitely.
- Fixed the built-in tail command to exit silently with code 141 (SIGPIPE) instead of failing with a "Broken pipe" error when a downstream pipeline reader exits early.
- Fixed the in-process ps shell builtin to support common procps/BSD format specifiers, including tpgid, pri, flags, real/effective user/group columns, wchan, fault counters, sz, and the STAT + foreground flag.
- Fixed install.sh falsely reporting success on musl-based systems (such as Alpine Linux) when the binary fails to start; the installer now smoke-tests the binary, exits non-zero on failure, and provides remediation steps.
- Fixed Codex config.toml discovery incorrectly importing MCP servers that are configured with enabled = false.
- Fixed bash.patterns allow rules rejecting valid commands when quoted arguments contained shell metacharacters (such as Cargo benchmark regex filters).

## [17.2.6] - 2026-08-03

### Added

- Added the `/reset` slash command to reset the conversation context in place: it drops the live messages, queued turns, and pending tool calls (and cancels the turn's async jobs, post-prompt continuations, and checkpoint/plan runtime state) while keeping the session id, title, cwd, model, and on-disk transcript. It records a durable reset boundary so the live transcript stays cleared across rebuilds (theme change, focus attach, `/shake`, resume) instead of resurrecting the pre-reset messages, while the full pre-reset history stays on disk ([#3580](https://github.com/can1357/oh-my-pi/issues/3580)).

### Fixed

- Fixed extension slash commands appearing as user prompts after being handled locally.
- Preserved explicit session titles when branching from an earlier conversation turn.
- Fixed an issue where unhandled JavaScript rejections in the browser guest could crash the main process and active sessions, converting them into tool errors instead.
- Fixed a critical issue on Windows where cancelling a timed-out bash tool command could mistakenly terminate the main process due to PID recycling.
- Fixed an issue where supervised processes reaching a terminal state failed to notify their launching session, requiring polling; the broker now actively notifies the session upon process completion.
- Fixed crashes on macOS when using PCRE2-only grep patterns with Bun by defaulting to the interpreted PCRE2 engine instead of JIT, and introduced the `OMP_PCRE2_JIT` environment variable to manually control JIT compilation.
- Fixed issues with `/btw` branch promotion where branches could park behind active turns, cut from outdated session leaves, or leave rejected branch keys indistinguishable from composer input.
- Fixed database bloat by ensuring archived main and nested session rows are properly cleaned up from `stats.db` during garbage collection.
- Fixed startup hanging during local model discovery when a timed-out transport left its request pending, which blocked the CLI before OAuth login could finish ([#7482](https://github.com/can1357/oh-my-pi/issues/7482)).

## [17.2.5] - 2026-08-03

### Breaking Changes

- Replaced the computer tool's coordinate-batch schema with persistent JavaScript runs, and removed computer.backend and model-specific controller switching.
- Changed the edit tool's replace mode from a multi-edit batch schema to a single-edit schema ({ path, old_string, new_string, replace_all? }).

### Added

- Added a relay browser mode to drive local Chrome tabs via the OMP Browser Relay extension, supporting automatic daemon startup and tab grouping.
- Added a scriptable desktop session featuring window-targeted capture and input, native accessibility trees, clipboard access, and streamed screenshots.
- Added broker-shared language servers (controlled by the lsp.shared setting) to multiplex LSP servers across multiple instances in a project, reducing cold-start times and resource usage.
- Added optional timeoutMs to discovery configuration in provider options to configure custom HTTP probe timeouts for llama.cpp, Ollama, and OpenAI-compatible endpoints.
- Added a cross-platform, in-process ps shell builtin with custom columns, sorting, and process metrics.
- Added the --service-tier flag to override the OpenAI service tier for a session.
- Added a configurable per-request web search timeout via providers.webSearchTimeoutSeconds.
- Added turn-aware /tree navigation shortcuts (Alt+Up/Alt+Down, Home/End, PageUp/PageDown) to traverse user and assistant turns.
- Added display.hideToolActivity and a Ctrl+Shift+O shortcut to toggle the visibility of model-initiated tool calls and results.

### Changed

- Exposed the script-driven computer schema to all models, including those with provider-native Computer Use support.
- Reduced omp --help cold-start latency and memory usage by rendering lightweight command metadata.

### Fixed

- Fixed durability of session transcripts to prevent data loss on process crashes.
- Fixed a bug on Windows where a timed-out bash command could terminate the main omp process.
- Fixed headless runs hanging or leaving background workers alive after completion.
- Fixed a crash when opening the Agent Hub after resuming a session.
- Fixed /mcp reauth environment variable expansion and token validation.
- Fixed fuzzy replace-all edits re-matching replacement text indefinitely, which could freeze the TUI.
- Fixed inspect_image ignoring configured thinking effort for vision models.
- Fixed compiled binaries dropping certain extensions with complex CommonJS/ESM dependency graphs.
- Fixed template argument substitution executing recursive placeholder expansion when positional arguments contain literal $@ or $ARGUMENTS tokens.
- Fixed project-scoped session directories using leading-hyphen names and collapsing distinct paths.
- Fixed manual /shake leaving the context budget anchored to stale pre-shake token counts.
- Fixed Mnemopi scoped recall reporting "No relevant memories found" when individual targets fail internally.
- Fixed skill:// resolution ignoring custom directories when a same-named skill exists in a default path.
- Fixed image paste failing on Wayland-only Linux sessions.
- Fixed prewalk switching to the fast model during read-only investigations.
- Fixed self-update misclassifying glibc Linux hosts with an installed musl loader as musl hosts.
- Fixed omp setup python to validate the correct interpreter used by the Python eval runtime.
- Fixed the terminal-tab title dropping to idle while an unsuppressed async job was still running.
- Fixed redirected stdin being ignored when Bun reports a pipe with an undefined isTTY.
- Fixed a literal API key configured via /login being hijacked on Windows by case-differing system environment variables.
- Fixed Esc during a streaming /loop iteration pausing the loop instead of aborting the current turn.
- Fixed heavily branched conversation trees shifting linear continuations into disconnected columns.
- Fixed plugin installation validation failures for legacy compatibility shims.
- Removed hard-coded references to disabled or absent agents in system and tool prompts.

## [17.2.4] - 2026-08-01

### Added

- Added `requestIdFormat` (`"string"` | `"number"`, default `"number"`) to MCP server config, honored by the stdio, HTTP, and SSE transports. JSON-RPC 2.0 permits both id shapes, but Apple's `xcrun mcpbridge` decodes `id` as an integer only and silently drops string ids (`mcpbridge.DecodeError Code=1`), hanging every request until it times out. The option is OMP-specific, so set it in an OMP-owned config (`.omp/mcp.json`, `~/.omp/agent/mcp.json`, a project `mcp.json`/`.mcp.json`, or an OMP plugin); servers imported from another tool's config ignore it ([#7053](https://github.com/can1357/oh-my-pi/issues/7053)).
- Fixed Anthropic web search sending unsupported temperature parameters to sampling-restricted Claude models ([#7195](https://github.com/can1357/oh-my-pi/pull/7195) by [@will-bogusz](https://github.com/will-bogusz)).
- Fixed mid-turn steering/peer-interrupt tool skips rendering as errors (red ✘, red border/text) in the TUI; pending and in-flight interrupt placeholders now render as neutral info cards while preserving whether `tool.execute` started ([#7199](https://github.com/can1357/oh-my-pi/issues/7199)).
- Added `Shift+Up` as a second default for the message dequeue, so the shortcut is reachable in macOS Terminal.app where Option is consumed for character composition.
- Added in-process `pgrep`, `pkill`, `pidwait`, and `top` shell builtins with cross-platform process discovery, BSD/procps-style filters, pidfile handling, signal selection, waiting, and snapshots.

### Changed

- Headless hosts (print/RPC/ACP/eval/SDK) now use a 1s SQLite `busy_timeout` for the session-critical databases (agent.db, history.db, stats.db), so lock contention no longer freezes the protocol loop for the full interactive 5s timeout; interactive hosts keep the 5s timeout. The interactive-host flag is now declared before settings load so the first database opens see the correct timeout.
- The model picker (`/switch`, alt+p) no longer blocks models whose context window is smaller than the live session: over-context rows stay grayed but selectable, and picking one compacts with the current model first, then switches. A cancelled or failed compaction keeps the current model.
- MCP JSON-RPC request ids now default to per-connection sequential integers instead of snowflake strings, matching the wider MCP ecosystem and making integer-only decoders like Apple's `xcrun mcpbridge` work without configuration; set `requestIdFormat: "string"` per server to restore collision-resistant string ids ([#7053](https://github.com/can1357/oh-my-pi/issues/7053)).
- `secret-placeholder.key` now resolves under XDG state (`$XDG_STATE_HOME/omp/secret-placeholder.key`) instead of the agent config directory, so it follows the same XDG layout as other state files.
- Daemon runtime directories (`run/daemons/<hash>`) and provider in-flight tracking (`run/provider-inflight`) now resolve under XDG state (`$XDG_STATE_HOME/omp/run/`) instead of the config root, keeping ephemeral runtime state out of `~/.config`.
- `marketplaces.json` now resolves under XDG data (`$XDG_DATA_HOME/omp/marketplaces.json`) instead of the config root, aligning with the XDG data category for user-scoped registry files.
- Existing XDG installs keep their placeholder key and marketplace registry: the legacy `~/.omp/agent/secret-placeholder.key` and `~/.omp/marketplaces.json` are copied to their XDG locations on first resolution.

### Fixed

- Fixed sessions without a granted `write` tool hiding discoverable and MCP tools behind the unusable `xd://` transport; those sessions now disable device mounting and expose the tools directly without gaining write access.
- Fixed collab guest prompts being sent to models as unframed developer context, so guest messages now retain their transcript attribution while reaching the model as prioritized user interjections ([#7288](https://github.com/can1357/oh-my-pi/issues/7288)).
- Fixed `/memory stats` and `/memory diagnose` showing "Memory stats is not available for the off backend" when memory is off, in both the TUI and ACP/RPC slash-command handlers; the off backend now says memory is off directly instead of naming itself as an unsupported backend ([#7251](https://github.com/can1357/oh-my-pi/pull/7251) by [@KennethHoff](https://github.com/KennethHoff)).
- Fixed `/reload-plugins` retaining stale context-file contents and activation state in the current system prompt ([#7258](https://github.com/can1357/oh-my-pi/issues/7258)).
- Fixed compiled binaries failing to import nested wildcard export subpaths such as `@oh-my-pi/pi-coding-agent/slash-commands/helpers/active-oauth-account`. Node matches `*` in an `exports` pattern across `/`, but the bundled registry enumerated only the top level and skipped any key containing a slash, so such an import resolved from source and died under bunfs — reproducible on the published 17.2.1 binary.
- Fixed concurrent session appends during `/move` recreating an orphaned `.jsonl` fragment in the old session directory ([#7270](https://github.com/can1357/oh-my-pi/issues/7270)).
- Fixed interactive launches hanging silently when a host project or its `.env` sets `NODE_ENV=test` or `BUN_ENV=test` ([#7261](https://github.com/can1357/oh-my-pi/issues/7261)).
- Fixed a subagent killed from the Agent Hub (`x`) reappearing as a `parked` row after closing and reopening the hub in a local session; the kill now leaves the ref registered as terminal `aborted` instead of unregistering it, so the persisted-subagent rescan no longer re-adopts the surviving transcript ([#7250](https://github.com/can1357/oh-my-pi/issues/7250)).
- Fixed manual and automatic Codex compaction dropping the configured OpenAI WebSocket preference ([#7198](https://github.com/can1357/oh-my-pi/issues/7198)).
- Fixed two remaining tool-card double renders: a superseded assistant turn no longer leaves its never-run cards above the re-run's fresh cards (a TTSR rewind retracts them immediately; an auto-retry removes the synthetic-settled failure cards when it supersedes the turn — while a genuinely terminal failure keeps its card visible), and a successful read whose persisted result wins a transcript-rebuild race no longer creates a fallback read group when its delayed live completion arrives ([#6879](https://github.com/can1357/oh-my-pi/issues/6879)).
- Fixed a tool card rendering twice when the provider rewrites a streamed tool call's id mid-stream — GitHub Copilot's `call_id|id` transport, or any stream that delivers the tool name/arguments before the id — so the block appears first with an empty or partial id and is populated in a later delta. The transcript keyed the live card by that mutable id, so the changed id spawned a second card: the old-id card orphaned as a blue pending preview while the new-id card took the result. Streamed tool cards are now re-keyed in place when their id changes, using the block's position in the streaming message as a stable identity ([#6879](https://github.com/can1357/oh-my-pi/issues/6879)).
- Withheld advisor nits and concerns while the primary turn is explicitly marked in progress, while still allowing blockers for unrecoverable active side effects.
- Preserved explicit `-e`/`--extension` and `--hook` packages under
  `--no-extensions` while excluding ambient extension factories and sibling
  capabilities from settings or installed OMP packages.
- Fixed explicit `thinking` metadata in `models.yml` custom definitions and `modelOverrides` being replaced by canonical catalog policy during model rebuilding. ([#7307](https://github.com/can1357/oh-my-pi/issues/7307))
- Fixed the auto-titler installing a model's whole answer as the session title when the tiny title model ignored the titling task and answered the first user message instead. `normalizeGeneratedTitle` now rejects overlong output (>80 chars or >12 words) so the caller defers titling to the next user turn rather than accepting a full sentence ([#7303](https://github.com/can1357/oh-my-pi/issues/7303)).
- Fixed the in-process `kill` builtin to validate signals, preserve negative PID operands, signal every process in pipeline jobs, continue after bad targets, and refuse non-probe signals aimed at the host process or process group.

## [17.2.3] - 2026-08-01

### Changed

- Tightened the system prompt notation: the legend now defines `⟺`, `≠`, `∉`/`∌`, and operator binding order; replaced undefined symbols (`⊭`, `≢`) in prompt bodies; removed delegation guidance duplicated between the eager-tasks preamble and the delegation gates.

### Fixed

- Fixed headless browser launch storms and orphaned Chromium process trees: omp processes now attach to one project-shared Chromium owned by the daemon broker (tabs per session; Chrome dies with the last omp client in the project), concurrent browser opens in one process share a single launch, and concurrent daemon `start` requests for one name can no longer spawn duplicate untracked processes.
- Fixed Bash auto-background leaving a live `Bun.sleep` threshold timer scheduled after a command completes (or abort/steering wins) first, which could keep the event loop alive and delay SDK/headless shutdown until the threshold expired ([#7235](https://github.com/can1357/oh-my-pi/issues/7235)).
- Fixed ephemeral side turns and native compaction bypassing an explicit or fork-inherited prompt cache key ([#7218](https://github.com/can1357/oh-my-pi/issues/7218)).
- Fixed the live Ask dialog crashing the whole session with a `replaceTabs` TypeError when a question reached `AskDialogComponent` without a string `question` field; questions are now normalized at dialog entry, mirroring the transcript renderer ([#7211](https://github.com/can1357/oh-my-pi/issues/7211)).
- Fixed Codex web search collapsing backend errors to `Codex error (): Unknown error`; the SSE error parser now preserves the backend code and message from top-level, nested `error`, and `response.error` envelopes ([#7200](https://github.com/can1357/oh-my-pi/issues/7200)).

## [17.2.2] - 2026-07-31

### Added

- Added an app.live.toggle keybinding (default Ctrl+L) to start or stop live voice mode.
- Added ctx.invokeTool(params, options?) to extension contexts, allowing wrappers to run native tools while inheriting context, abort signals, and progress updates.

### Changed

- Moved the display-reset default keybinding (app.display.reset) from Ctrl+L to Alt+L to accommodate the new live-mode toggle.
- Updated the hashline edit tool, streaming preview, and plan-mode guidance to support the unified PUT/CUT grammar, .= ranges, and named registers.
- Improved startup performance by moving subagent model-registry refresh and session-file opening off the launch critical path.
- Optimized session file writing performance by batching same-turn file-session appends.
- Rewrote the Codex saved-reset auto-redeem algorithm to be pool-wide, window-exact, and expiry-aware, ensuring banked resets are automatically and reliably redeemed across multi-account setups before they expire.

### Fixed

- Fixed a crash in Kitty terminals when rendering non-PNG tool-result images if PNG conversion fails.
- Fixed subagent evaluation resets (reset: true) wiping the shared kernel inherited from the parent session; resets from non-exclusive owners now fork into a private per-owner kernel.
- Fixed the copy selector and ask dialog rendering raw key IDs instead of human-readable keybinding labels.
- Fixed CLI positional initial messages bypassing automatic session-title generation.
- Fixed the environment-variable reference omitting Kitty Unicode placeholder controls and tmux placement caveats.
- Fixed extension validation failures during omp plugin install for extensions importing compact from @earendil-works/pi-coding-agent by adding the missing re-export.
- Fixed Bash interceptor rules to inspect unquoted/unescaped compound command fragments (e.g., &&, ||, ;, |, &, and newlines) instead of only matching the complete command input.
- Fixed ExtensionContext.cwd staying pinned to the initial session directory; it now dynamically tracks the active session's current working directory.
- Fixed the web-search provider picker description for xAI/Grok to clarify that it supports SuperGrok/X Premium+ OAuth sign-ins.
- Fixed /reload-plugins failing to reconnect MCP servers or refresh MCP tool and prompt-command registries.
- Enforced the centralized artifact spill threshold on oversized read results, persisting them as recoverable session artifacts.
- Fixed DuckDuckGo web search under-returning results above the first-page limit by automatically submitting continuation forms.
- Fixed DuckDuckGo web search ignoring after: and before: date bounds by correctly parsing and filtering result timestamps.
- Fixed env-driven OTLP trace export ignoring OTEL_RESOURCE_ATTRIBUTES.
- Fixed a fresh session with deferred MCP discovery injecting the newly mounted xd:// tool catalog twice into the first model request.
- Fixed the bash tool failing with EACCES permission errors on multi-user machines by scoping the snapshot directory per user ID.
- Fixed LSP write batching replaying stale whole-file snapshots over newer external changes made before the batch flushed.
- Fixed ctx.ui.editor() in ACP mode always resolving to undefined by routing it through the elicitation bridge.
- Fixed omp commit failing to resolve extension-provided models in both agentic and legacy pipelines.
- Fixed RPC hosts receiving no subagent lifecycle or progress frames when an IRC message revives an idle or parked keep-alive subagent.
- Fixed copied fenced-code body rows in assistant messages retaining component and container margins.
- Fixed mid-turn auto-compaction repeating dead-end rescue work and warnings at every tool boundary within a single oversized turn.
- Fixed automatic terminal appearance changes clearing native scrollback and snapping readers away from their current scroll position.
- Fixed exact-match edits failing on files containing credential-shaped tokens when secrets.enabled is active by using reversible placeholders instead of irreversible redactions.
- Fixed context usage collapsing to the latest response size for Cursor models that omit prompt-token usage.
- Fixed the browser tool crashing with EBUSY errors on Windows when a headless Chromium profile is locked during cleanup.
- Fixed the Python RPC client dropping context, compaction, OAuth URL, and terminal-settlement fields.
- Fixed the browser tool ignoring the url parameter when opening a new tab on an attached browser.
- Fixed browser automation disrupting attached browsers by adopting the active foreground tab and avoiding raising new tabs during screenshots.

## [17.2.1] - 2026-07-30

### Added

- Added `--from-claude` and `--from-codex` session imports, also available from `/resume @claude` and `/resume @codex`.
- Added an opt-in OMP-native software-security workflow (`security.enabled`, default off) with immutable scan plans, exact-account Codex subscription affinity, native task-worker review, canonical findings/coverage/SARIF publication, project-scoped history, explicit dispositions, producer-differential comparison, and the read-only `security://` resource namespace. Generic SARIF and official Codex Security bundles normalize into the same OMP-owned store.
- Added explicit Codex Security cloud operations to the opt-in security workflow: list and start account-pinned cloud scans, inspect their progress, and import current findings into OMP's canonical store and `security://` namespace without changing the native scan engine or spoofing official runtime attribution.

### Changed

- Reserved `security://` from RPC host URI shadowing so vendor adapters cannot replace OMP's canonical security-analysis namespace.

### Fixed

- Fixed remote or LAN local-engine endpoints being ignored during model discovery: the llama.cpp and Ollama probes used timeouts tuned for loopback, so a host reached over the network could exceed them and return no models, while changing `OLLAMA_BASE_URL`/`OLLAMA_HOST` could keep reusing a fresh cache from the previous endpoint. Non-loopback hosts now get a generous discovery timeout, and Ollama cache rows are scoped to the normalized endpoint ([#7087](https://github.com/can1357/oh-my-pi/issues/7087)).
- Fixed `omp install` failing extension validation for pi extensions that import `createEditTool` or `createWriteTool` (e.g. gentle-pi) — the legacy `@oh-my-pi/pi-coding-agent` shim exported the read/bash/grep/find/ls tool factories but omitted the edit and write ones, so a named import threw Bun's static "Export named X not found" error. Added `createEditTool`/`createEditToolDefinition` and `createWriteTool`/`createWriteToolDefinition` to match the upstream pi surface ([#7094](https://github.com/can1357/oh-my-pi/issues/7094)).
- Fixed Python eval's loopback tool bridge being routed through macOS system HTTP proxies, which caused `parallel()` tool reads to fail with `ConnectionRefusedError` after a local proxy stopped.

Older entries are archived in [packages\coding-agent\CHANGELOG.md@66783f3c68ba](https://github.com/can1357/oh-my-pi/blob/66783f3c68ba682828e684c33070fa2c905a55a4/packages\coding-agent\CHANGELOG.md).
