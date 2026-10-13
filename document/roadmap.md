# Zeta Development Roadmap

> **当前执行计划**（UI 迁移、编辑器/终端两端、team agent 接入）见
> [webui-desktop-overhaul-plan.md](./webui-desktop-overhaul-plan.md)（2026-10-02 起；carryover 未完成批次已收编其 §14）。本文档保留长期
> 路线与 Shipped 记录；执行细节以该计划为准。文档规范：旧计划随新计划生效
> 即删；未开发的后期规划登记在本文档。

Zeta is an OMP downstream distribution: the runtime tree, package layout, Bun
workflow, and internal `@linxiraos/*` names intentionally follow OMP so upstream
releases remain mergeable. This roadmap covers **Zeta-owned product surface
only** — capabilities built on top of the OMP runtime, never changes to the
sync tree itself.

## Upstream Position

Verified against `zeta-upstream` (can1357/linxira-zeta) and `pi-upstream`
(earendil-works/pi): **neither upstream has a product roadmap document** (pi
carries only a technical `tui-plan.md`). We track upstream release tags, not
feature plans; re-check for roadmaps at each release sync and adjust if the
upstream position changes.

## Shipped (Zeta-originated capabilities)

These exist today (headline capabilities are marked in the root `README.md`):

| Capability                                     | Where                                                                       | Notes                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Long-term tracking documents                   | `packages/coding-agent/src/tools/tracking.ts`                               | `tracking_update` tool writes `<project>/.zeta/tracking/`; Web UI TrackingPanel. **Default OFF** — gated by `tracking.enabled` (opt-in) since v1.0.6     |
| Experiment measurement (`autoresearch`)        | `packages/coding-agent/src/autoresearch/`                                   | Per-project SQLite experiments, metrics, baseline commits                                                                                                |
| TypeScript custom commands                     | `packages/coding-agent/src/extensibility/custom-commands/`                  | User commands from `~/.zeta/commands/` + project dirs, arktype/typebox/zod arg schemas, bundled `ci-green`/`review`                                      |
| Markdown command files                         | `src/discovery/builtin.ts` + `src/utils/command-args.ts`                    | `<config-dir>/commands/*.md` at user + project level, `$ARGUMENTS`/`$@`/`$1` substitution                                                                |
| Command marketplace (Bun-package distribution) | `slash-commands/builtin-marketplace.ts`                                     | Install/uninstall commands as Bun packages                                                                                                               |
| ACP collaboration builtins                     | `slash-commands/acp-builtins.ts`                                            | Agent Client Protocol session commands                                                                                                                   |
| Local stats dashboard                          | `zeta stats` (`packages/stats`)                                             | Local observability                                                                                                                                      |
| IM channels (WeChat / Feishu / Telegram)       | `packages/channels` + `src/channels/`                                       | `ChatChannel`/`ChannelHost` interface, session router, `channel_send`/`workspace_run`/`im_control` tools, WeChat iLink QR login                          |
| Remote token auth + LAN exposure               | `src/server/web-gateway.ts` (`authorizedForAccess`)                         | Non-loopback bind via `ZETA_SERVE_HOSTNAME` + `remote.token` (Bearer / `X-Zeta-Token` on every `/api/*`), CSRF origin guard, `docs/remote-workspaces.md` |
| Web-ui open-in-app buttons + update check      | `src/server/web-gateway/open.ts`, `web-ui/components/AppShell.tsx`          | `POST /api/open` (terminal / explorer / editors), `GET /api/open/options`, update check/download/install                                                 |
| Web-ui quick model import                      | `src/server/web-gateway/models.ts`                                          | `GET /api/models/import?base=<url>` OpenAI-compatible discovery into `models.yml`                                                                        |
| Web-ui stats iframe                            | `web-ui/components/StatsDashboard.tsx`                                      | AppShell Stats tab rendering `NEXT_PUBLIC_STATS_URL`                                                                                                     |
| Web-ui trajectory view                         | `web-ui/lib/trajectory.ts` + TrajectoryView/TrajectoryCell                  | Chat/Trajectory toggle, think/tool cells with duration + token counts, raw-entry inspector                                                               |
| Mermaid rendering (web + TUI)                  | `web-ui/components/MermaidBlock.tsx`, `packages/utils/src/mermaid-ascii.ts` | Web-ui strict-SVG render (`securityLevel: "strict"`); TUI ASCII render under `tui.renderMermaid` (default on)                                            |
| SVG fence rendering (web + TUI)                | `web-ui/components/SvgBlock.tsx`, `packages/tui/src/chat/svg-figure.ts`     | Web-ui draws closed ```svg fences as themed inline SVG (DOMPurify SVG-profile policy + `svg-figure` token aliases); TUI rasterizes them under `tui.renderSvg` (default on); serve/web-gateway sessions set `chatSvgRendering` so the prompt advertises them |
| Session sharing                                | `slash-commands/builtin-collaboration.ts`                                   | `/share` slash command + `zeta share` encrypted link                                                                                                     |

| Linux packaging lane (1.1.19)                  | `document/release.md` (`### Linux downstream packaging contract`)           | Repo-side contract frozen as the release-asset PKGBUILD lane; asset name `zeta-desktop-<version>-linux-x64.tar.gz` (Linxira-OS `[linxira]` repo)         |
| Plan-mode detail ceiling (length-bound plans)  | `packages/coding-agent/src/plan-mode/plan-protection.ts`                    | `readTargetsPlan` wired into the read tool: plan files get the full default read window so long plans are never amended blind                            |
| Web-ui settings coverage + reload button       | `POST /api/settings/reload` + `web-ui/lib/settings-client.ts`               | SettingsPanel mirrors the full settings schema (all tabs/groups from `GET /api/settings`); "Reload config" button wired to the reload endpoint           |
| Full-surface CLI i18n                          | `packages/tui/src/i18n.ts` + `src/i18n/wire-tui.ts`                         | Host-injectable `tuiText` layer, `settings-zh.ts` overlay; ~700 keys across all TUI panels; `scripts/check-i18n-consistency.ts` guards en/zh parity      |
| Plan-surface completion A+B                    | `webui-desktop-overhaul-plan.md` §14                                        | Shell wrap-up, command palette (Ctrl+K), Shiki, windowed searchable settings, gateway plan endpoint + sidebar Plan card, Tracking v2, U2 (9e7c4e4251f)   |
| `ssh_exec` remote command tool (v1.1.17)       | `src/ssh/` + `ctx.registerTool`                                             | Wraps the retained connection manager (`zeta ssh` CLI, `/ssh`); PR #34                                                                                   |

## Priorities

### P0 - Web workbench foundation and desktop handoff

The delivery-order items have landed: Web UI typecheck plus desktop/Web CI
restored (item 1), project grouping and concurrent-session status preserved
through the visual recomposition (item 2), the desktop file-manager/editor
bridge (item 3), AppImage packaging + Linux CI artifact validation (item 5),
and the workbench visual recomposition (item 6 — see Shipped). These landed on
the locked design/typography/port-boundary contracts; the full spec stays in
`document/webui-desktop-overhaul-plan.md` §14. One item remains open:

- **Cross-client provenance (item 4)**: session/run provenance must record the
  initiating client — `cli`, `web`, `desktop`, or non-interactive `automation`
  — rather than letting another UI infer it from a cwd or URL (no
  `initiatedBy`/`clientKind` field exists yet). Define it as durable metadata
  or a compatible event before adding presentation badges.

### P0 — Compaction as a service (not a command)

OpenCode evolved `/compact` from a markdown command (V1) into a first-class
service: `SessionCompaction` handles planning, execution, and progress events,
and a dedicated **compaction agent** produces the summary
(`packages/core/src/session/compaction.ts` in opencode-v2). Zeta currently has
streaming compaction in `packages/agent/src/compaction/` but the same
service/agent split is not complete.

- **Status**: the shared manual/auto pipeline and the session `promptCacheKey`
  reuse are done (`session-maintenance.ts`, `compaction-v2-streaming.ts`).
- **Remaining acceptance**: a dedicated compaction agent split, and granular
  per-phase progress events (today only `auto_compaction_start`/`_end`).

### P0 — Long-term tracking document + prompt-cache contract

The rule (encoded in `src/tools/tracking.ts` + `src/prompts/tools/tracking.md`): **before the provider
caches the conversation, the model must have written current state into the
long-term tracking document**. Anything that would mutate the cached prefix
(hidden reminders, injected updates, tracking nudges) must go through the
document or a tool instead of the conversation. The standing system guidance
stays byte-stable so DeepSeek/Anthropic prefix caches survive long sessions,
and compaction resumes with the same cached prefix.

- **Status**: the tool, its `tracking.enabled` opt-in gate, and compaction's
  session cache-key sharing are done; the cache-write ordering rule itself is
  still unbuilt.
- **Remaining acceptance**: any dynamic injection path either lands in the
  tracking document before cache write or is rejected by review.

### P1 — Migrate OpenCode's official commands (all three categories)

OpenCode commands fall into three kinds; migrate them in that order:

1. **Mechanism-triggering** (run code): e.g. compaction triggers, session
   operations — implemented as code, not text.
2. **Prompt-substitution** (expand to a prompt): `/init` and `/update` have
   shipped (`cmdInitGenerateAgentsMd` bundled zh overlay; CLI `/update`);
   manage remaining prompt-substitution gaps together with the user-defined
   commands gaps below. (`/review` and `/share` already shipped as
   bundled/builtin commands.)
3. **Combined** (template + arguments), using V2's command schema
   (`template`/`description`/`agent`/`model`) as reference.

### P1 — User-defined commands, remaining gaps

Zeta already has the TypeScript command layer and markdown command files
(`<config-dir>/commands/*.md` at user + project level with `$ARGUMENTS`
substitution). Remaining gaps vs OpenCode:

- **Hot reload**: OpenCode V2 reloads commands from `config.changes` with a
  debounce window; Zeta loads commands at startup (`/reload-plugins` is manual).
- **`agent` field on commands** so a command can pin which agent/agent model
  runs it.

### P2 — Embedded MCP recognition

Recognize and configure project-analysis MCP servers automatically:

- **CodeGraph** (`@colbymchenry/codegraph`): local code-graph database
  (`.codegraph/`, SQLite + FTS5); one `codegraph_explore` call answers
  structural questions (call paths, blast radius, dynamic dispatch), file
  watcher auto-syncs. Same goal as `/init` (project cognition) but sustained —
  complementary, can stack.
- OpenCode's official MCP packages (fetch/playwright experiments) where they
  fit.
- **Name-collision/priority rules** for embedded MCP tools vs builtin tools.

### P3 — Tool-schema token budget

OpenCode's `autotools` lesson: a huge tool schema set costs large token
overhead (multi-ten-thousand-token tool definitions) and forced two-phase tool
decision. Right-size Zeta's tool schemas and consider two-phase selection.

### P1 — Context-file and prompt hot updates (agent-doc awareness)

Today the session system prompt is a signature-driven snapshot
(`session-tools.ts`): active tool names, tool labels/descriptions, MCP
projection, and MCP instruction text form a signature, and the prompt is only
rebuilt when that signature changes (or on explicit `refreshBaseSystemPrompt`
calls: model/agent switch, memory ops, commands). The provider request tools
list is dynamic per turn, but **AGENTS.md and other context files change is
not watched**: editing them mid-session does not reach the model until some
other trigger rebuilds the prompt.

- **Acceptance**: context-file changes (AGENTS.md/CLAUDE.md/…, custom prompts)
  are detected and diffed against the rendered base prompt; when the rendered
  bytes change, rebuild and clear the provider prompt-cache key per the P0
  tracking contract (a changing prefix means the old cache no longer applies —
  never ship a stale prefix).
- Distinct from full config hot-reload (V2-style debounced watchers for
  commands/agents) — that stays a later item.

### P3 — Compaction fidelity (QA detail retention)

Compacted summaries lose specifics that later turns need. Design distillation
with the tracking document as the durable store, so compaction never
singlesources context that must survive long sessions.

* ~~P2 — Mermaid/SVG chat rendering: remaining gaps~~ 已解决（1.2.0 / PR #114）：web-ui 现在把**闭合的** ```svg 围栏渲染为主题化内联 SVG（`SvgBlock.tsx`、DOMPurify SVG-profile 消毒、`svg-figure` 令牌别名），TUI 早已在 `tui.renderSvg` 下栅格化；提示词侧新增不可变 `chatSvgRendering`（serve/web-gateway 会话置真，CLI 保持关闭），模板分支原本就在。`render_mermaid` 工具不需要；将来真要 `render_svg` 工具，走 surface-scoped sink 契约。

* ~~P0 — Channel tool sink wiring regression~~ 已解决（1.1.9）：`sdk.ts` sinks 接线 + 顶层会话门控随 v18.1.10 同步落地。

* ~~P1 — pi-vcs restage race: apply-to-index silently no-ops for new files~~ 已解决：restage race 已修复，`issue-966-repro.test.ts` 隔离解除（文件内已无 skip，恢复为守卫）。

### P1 — Memory stability track (Windows OOM / render retention)

Background: v18-era Windows crashes — the process commits 64–72 GB until the
system commit limit breaks, then whichever native thread allocates first
panics with os error 1455 and the process dies with no traceback
(`document/v18-gix-status-oom-triage.md` has the full evidence chain). The
gix status spike is fixed upstream (c901f632fa, shipped in 18.1.1; arrived via
the v18.1.10 sync, PR #8). What remains is Zeta-owned validation and
self-protection on the Bun 1.4 base (Rust rewrite: mimalloc-backed JSC,
`process.on("memoryPressure")` on Windows, smaller binaries). Local dev
machines are already on Bun 1.4 (done out-of-band); the remaining work is
repo-side:

1. **Lockfile**: regenerate `bun.lock` under Bun 1.4 (lockfileVersion 1 →
   2). The CI bun-version pin concern is resolved — CI derives its bun
   floor from `packageManager` (`bun@>=1.4` already set); no
   `bun-version` pin remains to bump.
2. **Memory profiling harness**: a bounded soak script (scripted long session:
   large tool outputs + resize sequences) sampling rss/heap plus Windows
   commit; A/B matrix — Bun 1.3-built vs 1.4-built binaries, 18.0.x vs 18.1.x
   baseline, PowerShell vs third-party terminals. Evidence before tuning.
3. **memoryPressure shed hook**: subscribe on Windows; on system memory
   pressure, shed render caches (transcript render retention, markdown cache)
   — degrade to a smaller UI instead of dying at 1455. Contract test: the
   shed fires, caches shrink, re-render restores full state.
4. **Transcript render memory bound**: port the upstream farm fix f6a646d305
   (bounded retained transcript render memory: weighted markdown cache
   entries by retained bytes, release finalized blocks after native scrollback
   commits) if the v18.1.x sync does not carry it — that fix is still unmerged
   upstream.
5. **CI memory guardrails**: (a) unit-level retained-bytes caps for
   transcript/markdown caches; (b) a bounded headless soak integration test
   (2–3 min, commit/RSS threshold — conservative for shared runners);
   (c) desktop memory smoke in the existing desktop jobs asserting aggregate
   multi-process footprint (upstream #9908 measured 6.89 GiB across 9
   processes); (d) a Windows status-path panic-catch contract test.
6. **Desktop memory visibility**: periodic per-process + aggregate memory
   sampling in `desktop/src/main.ts` boot/heartbeat logging.

The v18.1.10 sync has merged (PR #8) and rides the 1.1.9 release; everything
lands as Zeta overlay commits on that baseline, except item 1, which is
build-infra and can land independently.

### P1 — Surface-scoped tool exposure contract

The channel-trio pattern is the canonical mechanism for surface-targeted
tools: sink presence on `CreateAgentSessionOptions` → `ToolSession` field →
`BUILTIN_TOOLS` factory returning `null` without the sink → `isToolAllowed`
double gate → fail-closed `execute()`. Availability is construction-time
wiring, not a runtime gate — only the serve coordinator
(`zeta-server.ts #ensureMainSession`) and bot sessions receive sinks;
`SessionRouter.open()` workspace sessions, temp web-opened sessions, and
subagents never do. Preserve that invariant in merges. Hardening remaining:

- `channels.enabled` is an opt-out (default true); settings copy must not
  imply the toggle grants capability.
- Bot sessions hold the full sink set including absolute-path `workspace_run`
  delegation (by design; revisit if the surface widens).
- Future surface-conditional prompt options must be immutable per session
  (see Mermaid/SVG above) or paired with an explicit
  `refreshBaseSystemPrompt` on every surface that can flip them.

### P2 — Memory ↔ tracking boundary (prompt contract)

`prompts/tools/tracking.md` gains a hard constraint: tracking = project-level
working state (plan/progress/blockers/decisions) that travels with the project;
memory = learned facts across projects. tracking must never store learned
facts — cross-reference by topic into memory instead. `/tracking start` copy
already points users at the Web UI panel; extend it to name the memory
boundary and the `tracking.enabled` gate.

### P2 — Stats read-only tracking snapshot (cross-package)

`packages/stats` gets a read-only `/api/tracking` snapshot (status.json /
INDEX.md / actions.jsonl / sessions/*.md under `<project>/.zeta/tracking/`),
with a self-contained `TrackingSnapshot` type — stats must not import
coding-agent types. `getProjectTrackingDir` is already exported from
`packages/utils`; the stats-side endpoint + type remain. (Web UI already has a
TrackingPanel wired to the gateway; this is the stats-dashboard-side panel.)

### P3 — Vim input mode extension

`pi-vimmode` (github.com/pekochan069/pi-vimmode, npm `pi-vimmode`, install via
`pi install npm:pi-vimmode`) provides vim keybindings for the prompt input box
only (not file editing). Peer deps pin upstream `@earendil-works/pi-*@^0.77.0`;
Zeta integration requires a coordinate migration to `@linxiraos/*` (or legacy
shim). Deferred until the P0/P1 queue clears; other removed upstream features
(ssh/Bing/calc/recipe) have no ready-made extension repos — build in-house if
wanted.

### P3 — Removed-feature backlog (build in-house if wanted)

Other upstream-removed capabilities with no ready-made extension repo. Track as
low-priority; build in-house on demand: calc / recipe tools, code_search, python
tool, `/background`, `/shake` summary, oracle/plan subagents, `notebook.enabled`,
git context, shimmer, `plan://`, `jobs://`. Each needs its own scoping pass
before work starts.

### P1 — Mobile remote control (phone-first web access)

Phone control of the desktop agent over the user's own network path. **No
embedded tunneling**: users bring their own port mapping, server, or frp; Zeta's
job is to make the served endpoint safe to expose and the UI phone-first.

Shipped foundation: non-loopback bind via `ZETA_SERVE_HOSTNAME` with the
`remote.token` gate (`authorizedForAccess` — Bearer / `X-Zeta-Token` on every
`/api/*`, CSRF origin guard), token rows in SettingsPanel, and
`docs/remote-workspaces.md`; IM channels (WeChat/Feishu/Telegram — see
Shipped); full conversation reconstruction over REST + SSE
(`/api/sessions/:id/context`, `/api/agent/:id/events`), including thinking
blocks and inline media.

Remaining:

1. **Exposure hardening**: a `--host` flag on `zeta serve` (today env-only);
   optional built-in TLS listener (`Bun.serve tls`) plus documented
   reverse-proxy (caddy/nginx) recipes — never silent plain-HTTP beyond the
   LAN; a pairing QR in settings/desktop encoding `URL + token` (reuse
   `utils/qrcode.ts`) so the phone pairs by scanning; token rotation/revocation
   and rate limiting on the auth gate for WAN exposure.
2. **Lazy media for mobile**: the blob-store read endpoint is in place —
   `GET /api/blobs/:hash` (web-gateway) serves `~/.zeta/agent/blobs` for
   fetch-back. Remaining: wire lazy fetch-back into web-ui
   (`useAgentSession` still only sends `?deferMedia`).
3. **Mobile web-ui**: PWA manifest + service worker (installable, offline
   shell) on top of the existing responsive pass; voice input rides the native
   IME (zero work) — an optional Web Speech API mic button can come later.
4. **Android shell (later)**: a thin WebView wrapper of the same web-ui build
   pointing at a user-configured URL only — no business logic, no tunneling,
   and no new workflow file (checks live in the root `ci.yml`).
5. **Transport**: SSE stays the preserved contract; no WebSocket rewrite for
   mobile.

### P3 — IM channel wave 2 (post first-wave)

Discord, Slack, Matrix, Signal, SMS/Twilio, LINE, Teams, IRC, Mattermost —
each is an adapter over the same minimal channel interface; add on demand,
reference `temp/openclaw-ref` (checked out for this survey) for wire
protocols and auth flows.

### P2 — TTT editor About branding (remaining scope; zh UI done)

The vendored TTT editor (`editor/`, shipped as `@linxiraos/editor` +
`zeta-editor`) predates the tui text layer.

- ~~**zh UI**~~ DONE: `editor/internal/app/i18n.go` now carries a full zh
  string table (settings tabs/labels, menus, footer actions, dialog
  chrome); the settings view exposes an English/中文（简体） selector.
- **About branding (remaining)**: upstream attribution is already cleaned —
  Source points at `github.com/Linxira-OS/linxira-zeta` and the upstream
  website line is gone (VENDOR.md). Still upstream-flavored: the dialog
  title remains "About TTT Editor" and the version line shows TTT's own
  semver. Remaining work: a Zeta distribution identity line
  (`Zeta Editor · v<zeta version> · TTT <upstream version>`),
  Chinese-first copy.

## Deferred Queue(未开发的后期规划;开发启动时移入执行计划)

- **tea CLI 工具套件(2026-10-07 用户裁决)**:自托管 Gitea 与 gitea.com 的 gh 工具族
  对等集成。**一期已落**:`packages/coding-agent/src/tools/tea.ts`(单工具 op 判别联合,
  omptype)+ `packages/coding-agent/src/tools/tea-common.ts`(owner/repo 解析、实例→login)
  + `packages/coding-agent/src/utils/gitea.ts` 运行器;注册三点经 `gitea.enabled` 门控
  (默认 false);提示词 `packages/coding-agent/src/prompts/tools/gitea.md`;文档
  `docs/tools/tea.md`(真实文件名 `tea.md`,原条目写的 `gitea.md` 只是配方细节);测试
  `packages/coding-agent/test/tools/tea.test.ts`。**剩余仅二期**:`issue://`/`pr://`
  内部 URL 族 + Gitea Actions run watch。设计输入:tea repo create 静默失败(URL 打印但
  仓不存在),push-create 可靠——建仓操作优先 push-create 或 API 回读验证。实测环境:LAN
  NAS Gitea 28(192.168.11.172:3000,SSH 2222 别名 gitea,钥匙 BHYS-gitea-lan;git 调用
  需显式 -i 钥匙,本仓曾 shallow 需先 unshallow)。

- **v18.8.8 合并后专项排查产出（2026-10-11）**：
  - **待设计**：④tracking 架构项（`status.json` 无锁、`actions.jsonl` 无上限、
    `summaries/` 无面板、`updatedAt` 取请求时刻）。
  - **文档漂移（已收尾）**：版本线叙述已全树对齐到机制——稳定符号
    `pi_natives_build_version()` + `__piNativesBuildVersion` 构建期值戳，逐版本
    哨兵名（含 set-version 的改名步骤）已无残留；涉及 AGENTS.md、
    `document/release.md`、`document/dev-conventions.md`、`document/merge-playbook.md`、
    `document/design-principles.md`、`document/merge-review.md`、
    `scripts/set-version.ts`、`scripts/release-v2.ts`。本条备注至此收尾。

- **pi v1.0.0 语义移植评估(2026-10-02 四子代理调查,结论入账)**:对比
  基线=上游树上 pi 重写点(5d826095780≈v0.30.x,2026-01-01)→pi v1.0.0,我方
  基线 977ec83(2026-07-31)距其 1389 提交。裁决:**durable 子系统暂缓**——
  OMP 作者有主动引入意愿,等上游带进来再随 release 合并吸收,不自建。②
  cacheWarming 三档**已落**(`providers.cacheWarming`,默认 `idle`)。仍排队:
  ①codemode/tool_search 官方内置扩展激活(defaultTools 设置页组,默认关)
  ③TUI/UX 开关包(默认关清单逐项裁断)④provider stream events 语义移植。官方
  插件生态参照:llama.cpp/codemode/tool_search/mcp 四内置,replaceable:true
  让位机制,tuiText(key,fallback) 宿主注入 i18n。
- **teamagent 修正(pi-messenger 插件审计,2026-10-02)**:①user scope 目录
  (getAgentDir()/agents)、②project scope opt-in + trust 门控、⑤重启提示失实
  ——三项均已修并带测试。**④仍开放,是真 bug**:role 写入端发的是 kebab 键
  `thinking-level:`(`plugins/official/pi-messenger/teamagent-command.ts:72`),而发现端
  读 `thinkingLevel`/`thinking`(`packages/coding-agent/src/discovery/helpers.ts:361-368`),
  角色的 thinking level 被静默丢弃。③(非编辑角色缺 tools 最小权限)仍是未验证项。
  小项:usage 文案、--user/--project 冲突不报错、零测试覆盖、.pi 品牌路径残留
  (crew/team/*)。随 feat 分支落地,不经 dev/*。
- **rail 拖拽排序**:`@dnd-kit/*` 已在 `web-ui/package.json` 声明却从未使用
  (`useSortable`/`arrayMove`/`DndContext` 全库零命中);实际出货的是排序菜单,且
  没有持久化任何顺序。要么接线 dnd-kit + localStorage 持久化,要么删掉未用的依赖
  (随 U6 SidePane 框架一起评估)。
- **web_ui_build windows-2022 恢复**:跟踪 vercel/next.js#40760 家族上游
  修复,可修则 revert matrix 裁剪提交。
- **TUI 套件命名定稿与 zeta 工作台(2026-09-30 用户裁定,取代上方的
  "TUI 三件套整合设计"旧条)**:产品形态 = `zeta` 打开**嵌套终端工作台**
  ——一个终端进程,顶层标签页(tab = 窗格布局快照),窗格为真实 PTY 嵌
  终端(zeta-c / zeta-e / shell 皆为子进程),快捷键+菜单快速打开自家工
  具,四件套各自独立启动、help 各自独立。命名:`zeta-c`/`zeta-cli`/
  `zetacode` = coding CLI(@linxiraos/zeta 换 bin 不换包);`zeta-editor`/
  `zeta-e` = ttt;`zeta-ide`/`zeta-i` = termide(由未发布的
  @linxiraos/work 更名);`zeta` = @linxiraos/main(新,工作台本体,
  main/ 独立 Rust workspace,path 依 termide crates);files = 终端文件
  管理器(superfile 暂缓,候选调研中)。两个 IDE(ttt 与 termide)并存
  观察,不二选一。参照系:OpenCode 的多 tab 在其 app 层
  (SessionTab/DraftTab + 持久化,packages/app/src/context/tabs.tsx),
  终端 TUI 无分屏;OpenTUI = Zig 核心 + TS 应用层,不合纯 Rust——我们
  的形态(真 PTY 窗格)更强,壳坚定 Rust。**发包规矩(用户裁定)**:新包
  (@linxiraos/main、ide 系)先由用户手动以现行版本号(1.1.21)首发占
  位,之后用户在 npm 配好 trusted publishing,再接自动发布链
  (main-publish.yml 已备未接线);每次发包全包系统一版本号(无论有无
  changelog),但依赖不强制最新(main 可引用旧版叶子)。**工作台交互准则
  (2026-09-30 用户裁定):零快捷键基线** —— 一切界面元素都要能鼠标高
  效点击(标签切换/新建/关闭、窗格聚焦/关闭、布局切换、退出、菜单、
  设置),快捷键只做可选加速器;这从根上消解跨工具热键冲突(工作台
  Alt 平面 vs files/两个 editor/zeta-c 各自的键位,冲突最多损失加速、
  不损失功能),设置页/自定义键位按此准则设计。迭代队列:**真菜单栏
  系统**(顶部标签栏+可展开菜单栏,File/Pane/Tab/Tools/Settings 树)、
  **设置页**(键位/主题/默认 shell/套件路径等)+ 自定义键位、
  任意拖拽布局编辑器、files 选型集成、tab 会话/handoff 联动
  (handoff.json 机制扩展)、官网更新(用户提供仓库位置后跨文件改)。
  **拖拽交互现状(2026-10-02 更新)**:拖拽已是设置项且默认开启
  (settings.rs `drag` 默认 true,app.rs drag_enabled() 接线;窗格拖拽
  交换/移靠/拉伸、标签拖拽重排全接线,重启即回)。停用走 settings
  文件开关,并非早期设想的 `DRAG_ENABLED=false` 编译期停用。
  **参照系(用户指定,2026-10-01)**:交互逻辑持续对照 vendored 的
  GPL-2.0 项目 fresh(temp/fresh,sinelaw/fresh 终端编辑器)——其核心经
  验已吸收:命中区在绘制时登记、鼠标事件只查登记表(rendered geometry
  即 hit geometry,app.rs 的 HitRegistry 即由此来);后续菜单/拖拽/设置
  页迭代继续以它为标杆。**已落(2026-09-30)**:鼠标路由第一层(标签栏 ‹›步进/点击切换/
  活动标签×关闭/＋新建;状态栏 [layout]/[quit] 可点;点击窗格聚焦;
  聚焦窗格标题 ✕ 关闭;活动标签 ▸+粗体下划线高亮)、缺套件工具时
  窗格内一键 npm 快装(cmd /k 保窗可见)、帮助层非模态(曾吞掉
  Alt+T 等全部热键)、Windows 默认 shell 修正(pwsh/powershell,不再
  落 System32 bash.exe 的 WSL 陷阱)、无色 chrome(终端自身底色)。

- **模型侧「AI 崩溃度」统计(2026-10-11 用户裁决:用户侧先落,本项排队;用户复核「这是比较重要的统计量」,但先保主线稳定,按本队列延后)**:Frustration
  页面目前只测**用户侧**。另一半是模型侧(用户原话:「统计 ai 的崩溃程度」),它的文本形态
  完全不同——markdown/代码围栏/工具调用与结果/emoji——所以要复用 `stripStructuredContent`
  一类剥离逻辑再加自己的信号(致歉与自责标记、反复重述、含糊兜底、工具失败螺旋、啰嗦度)。
  **混语言硬约束(2026-10-11 用户裁定)**:模型思维链绝大多数是英文,正文可能英文、中文或
  中英混杂,少数情况下思维链被强制成中文;所以模型侧分析必须语言中立、en+zh 词典同时生效,
  绝不能按 UI 语言选词典——中文用户的统计天生是双语的。用户侧已据此落地(每条消息同时跑
  en+zh 词典、ASR 优先词典、不依赖 emoji、词典未覆盖脚本显示为未评分);judge 提示词已改
  改为语言中立且适配单条消息内混语言。

- **插件宿主 i18n 机制(2026-10-13 用户裁决;官方插件标准的 `locales/{zh,en}.json` 同步降级为预留)**:
  官方插件标准模板里的 `locales/{zh,en}.json` + 宿主注入 `t()` **只有文档、没有实现**——
  `ExtensionAPI`/`ExtensionContext`(`packages/coding-agent/src/extensibility/extensions/types.ts`)
  无 i18n / `t` 成员,`PluginManifest`
  (`packages/coding-agent/src/extensibility/plugins/types.ts:27`)无 `locales` 字段,
  `plugins/loader.ts`/`manager.ts`/`parser.ts` 均不读 `locales/*.json`。故标准措辞已统一降级为
  **预留目录**(新建插件可选携带,存量插件豁免;`plugins/official/README.md`、
  `plugins/official/INDEX.md`、`document/plugin-system.md` 三处同步,本轮只改文档、不动实现)。
  **待开发三步**:① `ExtensionContext.t()` 注入;② 清单 `locales` 字段与解析;③ loader 读取
  `locales/*.json` 并按宿主语言选表(语言源现成:`packages/coding-agent/src/i18n` 的
  `currentLanguage()`/`M`)。**前置事实**:pi-messenger 的用户可见字符串目前全是硬编码
  (overlay / 命令 / 工具描述 / handler 文案,11 个文件量级、约 200+ 条字面量),抽取前必须
  先划清「用户可见 UI 文案」与「模型可见提示词(工具 description、crew/skills)」的边界——
  后者本地化会改变模型行为。

- **上游 2.0 评估：被推迟的三项(2026-10-13 用户裁决)**:完整决策记录见
  `document/upstream-2.0-evaluation.md`。统一后端方向已定为「局部对齐 + 发现即复用」
  (不做完整统一后端,已开工:`zeta serve` 注册文件 + 同版本复用 + 桌面优先复用);
  PI 内核**不换**。本队列登记三项:①**自建完整统一后端**(opencode 2.0 形态:全机
  daemon + 固定端口 + HTTP/SSE + 服务发现)——押后,启动时再评估;②**跟进 omp² /
  pi-durable**——两者均未发布(omp² `omp2` 分支仍 pre-release,pi-durable 为
  Experimental 且无网络外壳),等上游稳定后再评估对接;③**档 1 反向 cherry-pick
  候选清单**——方向已定(保留为候选,量级 8–20 agent-日),但具体挑哪些能力待裁断,
  开工时从本队列移入执行计划。

## Notes

- Everything here must land as Zeta-branded overlay/brand commits after
  release merges, never inside the sync tree.
- `document/upstream-sync.md` records the release-baseline ledger; this document
  is the product-side counterpart.
- Re-check upstream for competing roadmaps before each priority starts.
