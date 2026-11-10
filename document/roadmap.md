# Zeta Development Roadmap

> **执行计划状态（2026-10-16 更新）**：原「UI 迁移 / 桌面交接」执行计划
> （`webui-desktop-overhaul-plan.md`，2026-10-02 起）**已被 2026-10-16 的裁决取代并关闭**，
> 其唯一未完项（跨端来源标记）已收编进下文的「Cross-client provenance」条目。GUI 开发启动时，
> 执行细节的载体是**本文档 + 项目 tracking**（`<project>/.zeta/tracking/`）。
> 文档规范：`document/` 只放三类（①当前执行计划 ②未开发的后期规划 ③架构设计文档）；
> 旧计划随新计划生效即删；未开发的后期规划一律登记在本文档的 Deferred Queue。

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

These exist today (headline capabilities are marked in the root `README.md`).
Rows that name `main/crates/**` or `docs/gui-*.md` describe the **retired
zetawork line**: its code and runtime docs were removed in 2026-11 (git history
retains them); the capability itself is either gone or now lives in Work Studio.

| Capability                                     | Where                                                                       | Notes                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Long-term tracking documents                   | `packages/coding-agent/src/tools/tracking.ts`                               | `tracking_update` tool writes `<project>/.zeta/tracking/`; Web UI TrackingPanel. **Default OFF** — gated by `tracking.enabled` (opt-in) since v1.0.6     |
| Experiment measurement (`autoresearch`)        | `packages/coding-agent/src/autoresearch/`                                   | Per-project SQLite experiments, metrics, baseline commits                                                                                                |
| TypeScript custom commands                     | `packages/coding-agent/src/extensibility/custom-commands/`                  | User commands from `~/.zeta/commands/` + project dirs, arktype/typebox/zod arg schemas, bundled `ci-green`/`review`                                      |
| Markdown command files                         | `src/discovery/builtin.ts` + `src/utils/command-args.ts`                    | `<config-dir>/commands/*.md` at user + project level, `$ARGUMENTS`/`$@`/`$1` substitution                                                                |
| Command marketplace (Bun-package distribution) | `slash-commands/builtin-marketplace.ts`                                     | Install/uninstall commands as Bun packages                                                                                                               |
| ACP collaboration builtins                     | `slash-commands/acp-builtins.ts`                                            | Agent Client Protocol session commands                                                                                                                   |
| Local stats dashboard                          | `zetacode stats` (`packages/stats`)                                         | Local observability                                                                                                                                      |
| IM channels (WeChat / Feishu / Telegram)       | `packages/channels` + `src/channels/`                                       | `ChatChannel`/`ChannelHost` interface, session router, `channel_send`/`workspace_run`/`im_control` tools, WeChat iLink QR login                          |
| GUI IM channels                                | `main/crates/zetawork-gui/src/settings_channels.rs`, `src/channels.rs`       | 设置 → IM 渠道 reaches web-desktop parity: enable/runtime words, local-QR WeChat login (2 s poll, reconnect/unbind), credentials, `workspaceRoot` + alias registry + session mappings, and the send route's failure kinds; `docs/gui-im-channels.md` |
| Remote token auth + LAN/WAN exposure           | `src/server/serve-access.ts`, `src/server/web-gateway.ts`                   | `--host` → `remote.host` → `ZETA_SERVE_HOSTNAME`; built-in TLS (`--tls-cert`/`--tls-key`, `remote.tls`); plaintext beyond loopback refused unless `--allow-plain-http`; `remote.token` (Bearer / `X-Zeta-Token` on every `/api/*`), CSRF guard, per-peer rate limit, rotation/revocation, pairing QR; `docs/remote-workspaces.md` |
| Mobile web UI (PWA + lazy media)               | `web-ui/public/`, `web-ui/lib/lazy-media.ts`                                | Manifest + offline-shell service worker (`/api/*` never cached); deferred `/api/blobs/:hash` images fetched on viewport proximity through the authenticated fetch path |
| Web-ui open-in-app buttons + update check      | `src/server/web-gateway/open.ts`, `web-ui/components/AppShell.tsx`          | `POST /api/open` (terminal / explorer / editors), `GET /api/open/options`, update check/download/install                                                 |
| Web-ui quick model import                      | `src/server/web-gateway/models.ts`                                          | `GET /api/models/import?base=<url>` OpenAI-compatible discovery into `models.yml`                                                                        |
| Web-ui stats iframe                            | `web-ui/components/StatsDashboard.tsx`                                      | AppShell Stats tab rendering `NEXT_PUBLIC_STATS_URL`                                                                                                     |
| Web-ui trajectory view                         | `web-ui/lib/trajectory.ts` + TrajectoryView/TrajectoryCell                  | Chat/Trajectory toggle, think/tool cells with duration + token counts, raw-entry inspector                                                               |
| Mermaid rendering (web + TUI)                  | `web-ui/components/MermaidBlock.tsx`, `packages/utils/src/mermaid-ascii.ts` | Web-ui strict-SVG render (`securityLevel: "strict"`); TUI ASCII render under `tui.renderMermaid` (default on)                                            |
| SVG fence rendering (web + TUI)                | `web-ui/components/SvgBlock.tsx`, `packages/tui/src/chat/svg-figure.ts`     | Web-ui draws closed ```svg fences as themed inline SVG (DOMPurify SVG-profile policy + `svg-figure` token aliases); TUI rasterizes them under `tui.renderSvg` (default on); serve/web-gateway sessions set `chatSvgRendering` so the prompt advertises them |
| Session sharing                                | `slash-commands/builtin-collaboration.ts`                                   | `/share` slash command + `zetacode share` encrypted link                                                                                                 |

| Linux packaging lane (1.1.19)                  | `document/release.md` (`### Linux downstream packaging contract`)           | Repo-side contract frozen as the release-asset PKGBUILD lane; asset name `zeta-desktop-<version>-linux-x64.tar.gz` (Linxira-OS `[linxira]` repo)         |
| Plan-mode detail ceiling (length-bound plans)  | `packages/coding-agent/src/plan-mode/plan-protection.ts`                    | `readTargetsPlan` wired into the read tool: plan files get the full default read window so long plans are never amended blind                            |
| Web-ui settings coverage + reload button       | `POST /api/settings/reload` + `web-ui/lib/settings-client.ts`               | SettingsPanel mirrors the full settings schema (all tabs/groups from `GET /api/settings`); "Reload config" button wired to the reload endpoint           |
| Full-surface CLI i18n                          | `packages/tui/src/i18n.ts` + `src/i18n/wire-tui.ts`                         | Host-injectable `tuiText` layer, `settings-zh.ts` overlay; ~700 keys across all TUI panels; `scripts/check-i18n-consistency.ts` guards en/zh parity      |
| Plan-surface completion A+B                    | 原 §14（该计划已于 2026-10-16 删除）                                        | Shell wrap-up, command palette (Ctrl+K), Shiki, windowed searchable settings, gateway plan endpoint + sidebar Plan card, Tracking v2, U2 (9e7c4e4251f)   |
| `ssh_exec` remote command tool (v1.1.17)       | `src/ssh/` + `ctx.registerTool`                                             | Wraps the retained connection manager (`zetacode ssh` CLI, `/ssh`); PR #34                                                                                |
| Desktop installers (1.3.2)                     | `scripts/packaging/windows/installer.nsi` + `scripts/packaging/*`           | NSIS `linxira-zeta-<ver>-setup-x64.exe` (GUI + companions, per-user), full-payload portable `-windows-x64.zip`, Arch `.pkg.tar.zst` and AppImage with companions            |
| In-app GUI updater (1.3.2)                     | `main/crates/zetawork-gui/src/updates.rs` + `zetacode update --desktop`     | Status-bar item; the download/verify/silent-install runs through the shipped `zetacode` because the GUI holds no TLS client                                         |
| Resource panel (1.3.2)                         | `main/crates/sysmon` + GUI `RightTab::Resources` + TUI `PaneKind::Resources` | CPU/memory/GPU gauges and a CPU-ranked process table sampled on a worker thread, shared by both surfaces                                                       |
| User board (双看板·用户层) (1.4.0)             | `termide/crates/panel-ide/src/board.rs` + GUI `RightTab::Board` + TUI `PaneKind::Board` + `src/server/web-gateway/board.ts` | Three-column Todo/Doing/Done board of markdown cards under `<project>/.zeta/board/`; GUI/TUI/IDE edit the same files; gateway CRUD + `handoff` brief; docs/board.md. Agent `todo` stays session-scoped and separate |
| Web-ui session tabs + rail drag (1.3.2)        | `web-ui/lib/session-tabs-persist.ts`, `SidebarProjectsList.tsx`             | Tab persistence/restore, close-family + draft confirm, running badge; project reorder by drag persisted as manual order                                        |
| Plugin i18n (1.3.2)                            | `src/extensibility/plugins/locales.ts` + `ExtensionContext.t`               | Manifest `locales` (or `locales/<tag>.json`), per-extension binding, current → en → fallback → key                                                            |
| Extension peer APIs (1.3.2)                    | `src/registry/agent-directory.ts`, `src/irc/facade.ts`                     | `ctx.agents` roster and `ctx.messaging` send/wait/inbox so a plugin no longer deep-imports the IRC bus                                                        |
| Gitea half of `tea` (1.3.2)                    | `src/tools/tea-issue-pr.ts`, `issue-pr-protocol.ts`                        | `issue://`/`pr://` resolve against a Gitea host; `run_watch` polls a Gitea Actions run                                                                        |
| Model-side frustration metrics (1.3.2)         | `packages/stats/src/model-side.ts`, `model-metrics.ts`                     | assistant prose stored per turn (`assistant_text`), en+zh lexicons + tool-spiral signals, second section of the frustration route                               |
| GUI PDF page (1.4.0)                           | `main/crates/zetawork-gui/src/pdf.rs` + `SessionKind::Pdf`                 | hayro (pure Rust) rasterizes pages to egui textures; opened from the file tree or an explicit path; scrolling, paging, zoom, error states. **GUI only** — the TUI refuses `.pdf` (`docs/gui-pdf-viewer.md`) |
| Agent mesh (1.4.0)                             | `packages/coding-agent/src/mesh/`                                           | Cross-process mesh: loopback socket / named pipe with a per-workspace token, `<workspaceId>/<agentId>` addressing, heartbeat + `gone`, offline mailbox + wake, mutual-wait probe that answers both sides; `@agent list`/`@agent use`/`@team`; `document/agent-mesh.md` |
| CLI-hosted IM channels (1.4.0)                 | `packages/coding-agent/src/channels/cli.ts`, `src/cli-commands/channels.ts` | `zetacode channels` `status`/`login`/`logout`/`enable`/`disable` (+`--json`), terminal QR (UTF-8 half blocks), WeChat login state machine, one instance lock shared with `serve`, `session-host.ts` for interactive and `--print` |
| Default workspace bootstrap (1.4.0)            | `packages/coding-agent/src/default-workspace/`                              | First use: `git init`, `.zeta/settings.json` (`memory.backend = mnemopi`), `AGENTS.md`, `PERSONA.md`, first commit; idempotent; persona injected after the personality block; `document/default-workspace-scenarios.md` |
| Declarative plugin panels (1.4.0)              | `src/extensibility/plugins/panels.ts` + GUI `plugin_panels.rs` + `web-ui/pages/plugins/view` | Manifest `ui.panels[]` (`list`/`form`/`chart`/`html`); GUI draws the first three natively, HTML panels run in a webview; `zetacode plugins panel`; example plugin + `zeta-plugin-example-<ver>.zip`; TUI carries no plugin surface, zetaide carries TermIDE's own 0.46 plugin layer (not Zeta's plugin surface) |
| Workbench terminal graphics (1.4.0)            | `termide/crates/panel-terminal/src/kitty.rs`, `reports.rs` + GUI `blit.rs`   | Kitty graphics subset (PNG/RGBA, chunks, c/r, C=1, z, q) painted 1:1 at device-pixel cell metrics; the five capability queries answered by both the local PTY and the `serve` backend; `TERM_PROGRAM=zetawork` |
| GUI settings schema + i18n (1.4.0)             | `main/crates/zetawork-gui/src/settings_schema.rs` + `i18n.rs`               | 「全部设置」 generated from `GET /api/settings` (tabs/groups/typed controls/search/masking), PUT then re-GET, language switch re-fetches; guard test requires an en row for every CJK `t!` key |
| Session-scoped settings + config durability (1.4.0) | `src/config/settings.ts` (`sessionForCwd`), `src/config/web-config.ts`  | A session keeps its own project settings layer and reloads after a write; `web.yml` writes are read-modify-write under one lock with a shared reader; channel instance lock published atomically; `channels.reportPolicy` honoured |
| Backend daemon + attach client (1.4.0)          | `src/commands/daemon.ts`, `src/backend/`                                       | `zetacode daemon` subcommands `status`/`start`/`stop`/`restart`/`logs`/`install-autostart`; bare `zetacode` attaches to the directory's newest session and falls back in-process; `attach --list`/`--new`, `--backend` for print mode; `serve` stays the foreground backend |
| Agent messaging gears (1.4.0)                  | `src/irc/bus.ts`, `src/mesh/gears.ts`                                          | Subagent → spawning main only; main agents get per-workspace inbound/outbound gears (`closed` default → `repo-main-agents` → `repo-all` → `cross-repo-except-default` → `open` for the default workspace); receiver re-checks its gear; same-machine workspaces resolve locally |
| GUI hosts the backend (1.4.0)                  | `main/crates/zetawork-gui/src/backend.rs`                                      | Connect-or-start on launch, banner for starting/failed/stopped, 5 s health monitor off the UI thread, tabs re-dial after a restart, stop-on-quit unless `backend.keep_on_quit` |
| GUI default project + conversations (1.4.0)    | `main/crates/zetawork-gui/src/{left,sessions,seed}.rs`                          | Pinned system project with the default workspace and its conversations at the top; project → workspace → conversation below; per-workspace “new conversation” |
| GUI migrated surfaces (1.4.0)                  | `main/crates/zetawork-gui/src/{history,tracking,session_admin,worktrees,palette}.rs` | History from the session catalogue, tracking documents, cross-project session search/pin/archive, per-conversation worktrees with real branch state, ⌘K palette limited to jumps and desktop actions |
| IM credential login (1.4.0)                    | `src/channels/credential-login.ts`, GUI `settings_channels.rs`                | Feishu app credentials and Telegram bot token validated before saving; masked errors; same state words as the WeChat QR flow |
| Plugin panel activation gate (1.4.0)           | `src/extensibility/plugins/activation.ts`                                     | Declarative panels appear only when the agent runs inside the workbench terminal (or `PI_FORCE_PLUGIN_PANELS=1`); tools and commands stay available everywhere |
| Multi-repo task panel design (1.4.0)           | `document/task-panel-design.md`                                               | Decision-complete: single `task` tool with `op`, per-repo `.zeta/tasks/<id>.md`, workspace binding file, invalidation rules, layer separation from the user board, sticky disable, 23 acceptance scenarios |
| TUI right sidebar (`tui.sidebar`)              | `src/modes/components/sidebar.ts`, `src/modes/components/sidebar-git.ts`, `src/modes/settings.ts` | 36-column gutter, `/sidebar` + `app.sidebar.toggle`, `tui.sidebar` default off, `tui.sidebarWidgets` gates extension widgets; built-ins: context, todos, subagents, MCP, git (cached branch/ahead-behind/status/last 5 commits, hidden outside a repo); hidden below 100 columns or under an overlay; not scrollback. **Had only UPDATE-LOG/docs mention, no roadmap row** |

## Priorities

### P0 — 渲染器定稿：`web-app` 由 `zetacode serve` 托管（2026-11-05 裁决，取代 2026-10-15/16 桌面裁决）

**2026-11-05 裁决（Superseding）：`zetawork` 暂挂，渲染器换成 `web-app`**

**2026-11-06 命名与形态规范**：产品面收敛为三个 —— **Work Studio**（浏览器面，`web-app/`
+ `zetacode serve`）、`zetacode`（CLI/TUI agent）、`zetaide`（终端 IDE，Rust termide）。
**不存在 Rust UI**；`zetawork-gui` 不恢复，`zeta-main` 的嵌套终端工作台语义由 Work Studio
接管。三者的入口、代码落点与发布线见 `document/agents/surface/surfaces.md`。

- 产品渲染层 = `web-app/`（我们自己的 Vite 7 构建），由 `zetacode serve` 直接托管
  （`server/studio-web-app.ts`，CSP / immutable 资产 / history fallback）。宿主契约
  `/api/v1/*` 由 `server/studio-host/` 回答，能力清单只广播已实现的操作。
- **`zetawork`（`main/crates/zeta-main` 的 TUI + `zetawork-gui` 的 GUI）与旧 `desktop/`
  Electron 链**：zetawork 已于 2026-11 从树中移除（git 历史保留）；`desktop/` 自
  2026-11-07 起是活动的 Work Studio 桌面版。Rust 侧 i18n 相关工作随移除作废。
- **`@linxiraos/main` 包名保留**：npm 上已发布版本保持 deprecate 状态，树内不再有源码
  或发布腿。后续把「main 面」——super agent / Room / resident agent——装进这个包时再
  恢复自动发布，届时它的 `bin` 语义是**宿主**，不是拉起 ratatui 二进制。
- 已发布版本（`@linxiraos/main`、`main-{linux,windows}-x64`、`@linxiraos/zeta-web`）
  不删除、不 unpublish：文档标记为 deprecated/reserved（保留已安装用户的可解析性）；
  `@linxiraos/ide`（zetaide / TermIDE）是独立发布线，不受影响。

**2026-11-05 审计记录**：本节原「`zetawork` 是唯一桌面应用」（2026-10-15 裁决 + 2026-10-16 修订）
整段已删除 —— 被上方 2026-11-05 裁决取代（zetawork 暂挂；产品渲染器是 `web-app/`，
`web-app/` 由 `zetacode serve` 托管，见 `packages/coding-agent/src/server/studio-web-app.ts`）。
历史原文见 git 历史（本文件 2026-11-05 之前的版本）。

### P0 — GUI 按 HTML 稿重做（`main/crates/zetawork-gui`）

**2026-11 移除**：这条要求把 HTML 稿做进 Rust GUI（egui + WebView2），
而 2026-11-06 的形态规范明确「不存在 Rust UI」。设计稿的实现面改为 **Work Studio**
（`web-app/`），它已经接管了工作台/布局/面板的呈现；`zetawork-gui` 已于 2026-11
从树中移除（git 历史保留），不构建、不发布、不恢复。需要复用设计稿时，改
`web-app/src/studio/`。

- **唯一基准 = 用户的两份 HTML 稿**：`Downloads/index.html` 与 `Downloads/workspace-v2.html`；
  两份**各有侧重、按各自侧重开发** —— 信息面（右栏四页·含上下文页、设置/用量模态、状态栏）
  与工作区组织（项目→工作区→大标签页→面板的增删改与切换、TUI 形态）。
- **实现语言**：Rust 原生 GUI（egui/eframe，现 0.33.3）；HTML 仅设计参照，**不得引入 web 前端**。
- **渲染路线 A**：面板内容用**虚拟终端**承载（pty + VT）；两套 TUI（`zetacode` 的 TS TUI 与
  zetawork 自己的 ratatui）都只当面板内容；zetawork 侧沿用 `ratatui Buffer → blit → egui`。
- **反馈闭环**：改完用仓库里的**离屏截图 harness**（`main/crates/zetawork-gui/tests/shots.rs`）
  出图自证（**不弹窗、不抢焦点**），逐项与稿子对图；稿子上的元件**不得错位**
  （旧 spike 版是错位反例，其截图不作为基准）。
- **边界**：TUI 只保基本功能（减法为主）；web-ui 降级为"服务端 + 插件接口"。

### P0 — 工作区 ↔ 会话绑定与布局持久化（布局与会话分离）

**2026-11 作废**：本项是 zetawork 的布局面，随 zetawork 移除一并作废；
`main/crates/zeta-main/src/settings.rs` 已不在树里。

**核心原则**：**布局与会话分离** —— 工作区/面板/面板内标签属于**布局**；会话只是面板上的一个
**可空引用**。因此删会话永远不毁布局。

- **绑定文件**：`~/.zeta/workbench.toml`（userdata 路径；现只存 `shell`/`drag`/
  `focus_follows_mouse`/`close_confirmation` + `[[slots]]`，需新增 `[[workspace]]`）。
- **模型**：一条 = 一个工作区（= 一个大标签页）：`id`（`"1-1"` = 项目一 · 第一个大标签页）、
  `project`（规范化路径）、`remote`（git remote 哈希，作次键 —— 仓库被移动/换机克隆还能认回来）、
  `left`（左栏当前项）、`right`（右栏当前页），以及每个**面板**的 `tabs`/`active` 与
  **`agents`（会话引用列表 + 当前指针）** —— **左右两侧各跑一个 agent 会话时分别记**。
- **生命周期与兜底**（保证"永不空白、永不报错"）：

  | 事件 | 行为 |
  |---|---|
  | 首次进项目（无记录） | 在该 cwd 找最近会话；没有则新建；写一条 `[[workspace]]` |
  | 用户换会话（例如新开一个） | 只改指针，旧记录保留（**列表 + 当前指针**，不是单值） |
  | 一个标签页里有多个会话 | 按**面板**分别记，恢复时逐面板 `--restore` |
  | 用户删除会话 / 会话被 GC | 指针失效 → ① 同工作区其余会话中最近一次 → ② 该 cwd 下最近一次（会话库本就按项目 slug 分目录） → ③ 在该面板新建 |
  | 工作区 / 项目被移除 | 整条移除，不留半条 |

- **恢复开关**：`zetacode --restore`（恢复指定会话并继续它被打断的那一轮；要求交互式）/
  `--resume <id>` / `--continue`。
- **复用既有零件**：`session/session-listing.ts`（列会话）、`cli/gc-cli.ts`（会话 GC）、
  `channels/session-router.ts` + `im-control.ts` 的**选择器语义**（裸 id / `{n}` / `[id]`，已支持
  删除会话）—— 直接作为绑定记录的解析规则，不另发明一套。
- **信任边界**：仓库自带指令（`AGENTS.md` / `.zeta/*`）会被喂给 YOLO 权限的 agent；自动装配
  **只对用户显式加过的工作区**生效，未信任的仓库只起裸 shell（一次性在"加工作区"时确认，
  不逐次弹窗）。

### P1 — 标准 IDE 页（`panel-ide`）与编辑器能力补齐（2026-10-17 修订）

**2026-11-05 状态**：GUI 侧的「在 pane 里渲染同一个面板」随 zetawork 暂挂；`termide`/`zetaide`
这条发布线独立（`.github/workflows/ide-publish.yml`），本项继续，已落地部分为
`termide/crates/panel-ide/src/{formatters,notepad,ports,spell,board}.rs`。

**方向修正**：早先"专业编辑器、**明确不含补全**"是**自研渲染层**的口径。现在改为**复用
termide 的 Rust 编辑器核心**（`panel-editor` + `lsp` + `highlight` + `buffer`），只换渲染层
（ratatui 网格 → egui blit）——LSP/补全/悬停/跳转/引用/重命名/诊断随核心一起来了；自研的
玩具高亮退役。

**形态**：新增复合面板 `termide/crates/panel-ide`，固定版式（不再自由拖拽）：

```
顶：文件标签条（多文件，＋ / ×）
左：文件树（可切 Find 搜索）+ Git 更改 / 历史（纵向堆叠）
右：编辑器（每个标签一个 panel-editor 实例）
底：状态栏（Ln/Col、缩进、编码、EOL）
```

只有两条可拖动分割线（左栏宽度、左栏 Git 高度），其余固定。**TUI 与 GUI 渲染同一个面板**
（GUI 走 `Panel::render` → `Buffer` → blit，与终端面板同一手法）。

**四批**：

1. **标准页**：`panel-ide` 固定版式 + 标签条 + 文件树/编辑器接入；TUI 用一个 `PanelGroup`
   装它，GUI 在 pane 里渲染它（TUI 编辑器同时接上 `LspManager`，去掉"本版未接语言服务"）。
2. **Git 中心**：Changes（提交框/文件列表/暂存）、History 分页（Load older）、分支列表 +
   数量、**逐文件历史 + inline diff**（`panel-git-log` 的逐文件视角）。
3. **Formatter 层**：保存/快捷键调外部格式化器（rustfmt / prettier / black / gofmt / stylua /
   clang-format / shfmt），一个层 + 七条配置。
4. **小工具**：JSON Viewer、TODO Scanner、Bookmarks、Notepad、Port Finder、Spell、
   Color Picker。

**不做**（只登记 Deferred Queue）：Vim/Emacs 兼容层、Docker Manager、Go Test Runner（我们不写
Go）、cheat-sheet/http-client 类玩具。**PDF** 的 GUI 页（1.4.0）随 zetawork 一起
于 2026-11 移除；TUI 永不渲染。

参考物：`temp/ttt`（TTT 上游原版，`github.com/eugenioenko/ttt`）的形态与
`community-plugins.json`（45 条 = 24 `lsp-*` + 7 `formatter-*` + 14 功能插件）。

### P0 — Cross-client provenance (last open item of the deleted Web workbench plan)

The delivery-order items have landed: Web UI typecheck plus desktop/Web CI
restored (item 1), project grouping and concurrent-session status preserved
through the visual recomposition (item 2), the desktop file-manager/editor
bridge (item 3), AppImage packaging + Linux CI artifact validation (item 5),
and the workbench visual recomposition (item 6 — see Shipped). These landed on
the locked design/typography/port-boundary contracts; the full spec lived in the
now-deleted `document/webui-desktop-overhaul-plan.md` §14. Its desktop half is
moot since `desktop/` is paused (2026-11-05). One item remains open:

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
substitution). Command hot reload has since shipped
(`packages/coding-agent/src/extensibility/custom-commands/watcher.ts`: directory
watch + debounce + last-good state), so the remaining gap vs OpenCode is:

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

### P1 — 外部来源同意与工具暴露档位（2026-11-02）

把「哪些是 Zeta 原生标准、哪些是外来 agent 配置」从能力层钉死，并把默认工具面
收成四档。设计见 [`document/external-sources-and-tool-exposure.md`](./external-sources-and-tool-exposure.md)。

- **S0/S1 只认原生**：`.claude/settings.json` 不再合并进项目层；`.claude/SYSTEM.md`
  不再替换基础提示。外来项目级来源默认不加载，必须有用户同意；可执行来源
  （hooks/tools/MCP）按仓库 + 哈希记录同意，不写仓库。
- **原生**：`.zeta/**`、`AGENTS.md`、内置 system prompt（OMP 自己的，不是 Claude/Codex）。
- **工具档位**：超级简 4 / 极简 5 / 标准 12（默认）/ 完整；未启用工具不注册、
  不列目录；统一关闭用 `tools.disabled`，不再逐工具加开关。
- **agent 请求**：复用 `read xd://<tool>` 对未启用工具发起审批，不新增顶层工具。
- **吸收**：本项吸收 P3「Tool-schema token budget」的默认面问题，并扩展
  P1「Surface-scoped tool exposure」的可用性门禁；MCP 去重与 P2「Embedded MCP
  recognition」的冲突规则共享实现。
- **验收**：默认无外来配置加载；标准档恰好 12 个工具；超级简 4 个；重复 MCP 能力
  只出现一套提示词。

### P1 — Agent-authored plugins / page-host protocol（2026-11-02）

让 agent 在不改仓库源码的前提下创建、验证、加载、提升自己的插件，并给
HTML 页面定一个版本化宿主协议。设计见
[`document/agent-authored-plugins.md`](./agent-authored-plugins.md)。

- **mod 调查结论**：Claude Code 的 mods 是产品级 TypeScript 事件中间件，
  不是开放标准，且明确不沙箱；**Agent Plugins 1.0.0** 才是可移植标准
  （`plugin.json` + `skills/` + `mcp.json`），Zeta 已实现其 skills/MCP 发现。
  不实现 Claude mods 兼容层，只借鉴事件中间件与逐文件批准。
- **创作生命周期**：`<agentDir>/plugins-dev/<session>/<name>/` → scaffold →
  validate → load_dev（逐文件批准 + 哈希）→ reload（回合结束）→
  promote/export（仅用户）→ cleanup。
- **页面协议**：声明式面板优先（数据来自 tool call）；HTML 页面用版本化
  `window.zeta` postMessage 桥（`ready`/`callTool`/`getContext`/`subscribe`/
  `notify`/`resize`），HTTP `/api/*` 只读；不提供任意 HTTP 服务。
- **TUI/TSP**：不做任意布局；用 `ui.slots` / `ui.pages` / `ui.actions` 三组
  协议化扩展点（header/footer/sidebar/transcript/tool-card/overlay），节点树
  仍是纯 TSP JSON，动作 id 由宿主分发。自由布局放 Web UI 宿主。
- **Web UI 性能规则**：路由级懒加载、隐藏面板卸载、会话数据有界、按 panel
  分 store、流式 rAF、插件 iframe 隔离；核心不引 3D/终端依赖。
- **安全**：headless/untrusted 不加载；不能写仓库源码；agent 不能 promote；
  `plugin_manager` 走 `xd://` 请求启用。
- **验收**：会话内创建并加载一个只读工具插件，仓库无新文件；promote 后重启
  可用；HTML 页面能 `callTool` 并拿到结果。

### P1 — Super agent rooms / resident agents / contacts UI（2026-11-03）

把“用户 ↔ 多个仓库主代理 ↔ 各自团队/子代理”做成 Room 原语，实验性、默认关闭。
设计见 [`document/super-agent-rooms.md`](./super-agent-rooms.md)。

**2026-11-06 状态（修正 11-05 的宿主判断）**：Room 原语在代码里还没有实现（全树无
`SuperRoom`/`RepoRoom` 标识），但**宿主已经存在**：`zeta serve` 从 2026-11-06 起随
`@linxiraos/zeta` 出货（`server/studio-host/` 回答 `/api/v1/*`，渲染器是 `web-app/`，
PR #233/#234）。11-05 裁决暂停的是 `@linxiraos/main` 这条**包线**，不是宿主；把它写成
"重启条件 = 装进 @linxiraos/main" 等于给一条已被裁决停掉的路径当门槛，条件永远不会触发。
真正的门槛见 `document/super-agent-rooms.md` §12：有效基线 `v18.16.0` + 四项实现前置。

- **Room 是基建**：独立事件日志、宿主分配 `seq`、`sentAt`、parallel/serial/mention
  三种调度；成员回复按宿主顺序落盘，Agent 不自行排序。
- **层级**：Super Room（跨仓库主代理）→ Repo Room（同仓库多主代理）→ Main Room
  （主代理+子代理）；消息不自动跨 Room 传播。DSH Team 是单仓库 Lead+teammates，
  不是“仓库所有主代理”。
- **Tracking 是锚**：每个仓库 tracking 本地权威；Room 只读摘要/引用；跨仓库决定
  走 proposal/ack，不能直接写对方 tracking/taste/memory。
- **Resident Agent**：普通 task worker 默认 keep-alive、7 分钟 park；Room 只收
  显式提升的 resident/main，宿主中转消息，不放开子代理全局 peer 规则。
- **GUI**：独立联系人/会话/聊天窗口，隐藏 session id；安卓配对 + 设备密钥 + 2FA；
  端口映射外包，Zeta 只提供 TLS/WSS 接口与鉴权。
- **验收**：两个仓库成员在 Room 内有序发言且上下文不互相泄漏；resident 可 park/revive；
  GUI 可从联系人进入 Room，不暴露底层 session。
- **发布载体**：`@linxiraos/main` 这个包名留给 main 面（2026-11-05 裁决）——zetawork
  暂挂后它停止自动发布，恢复时以「宿主」为语义重新实现 `bin`，不要在新包名下重开第二条线。

### P1 — Context learning modes: sliding windows / window batch（2026-11-03）

明确滑动窗口压缩与 memory/taste/tracking 的频率、成本、作用域，并设计可选的
窗口批处理。设计见 [`document/context-learning-modes.md`](./context-learning-modes.md)。

- **压缩**：不是 memory 触发器；默认 `asyncEnabled` 投机摘要，`keepRecentTokens=20000`；
  方法顺序 `remote → snapcompact → handoff → shake → soft`。
- **频率**：mnemopi 默认每 4 个用户轮次；hindsight 每 3 轮；taste 每个提示抽取、5 分钟合并；
  tracking 没有周期提醒，只有 phase 完成 nudge。
- **两套逻辑**：Agent 自维护（工具调用，无额外模型）vs 宿主后台（额外 memory/taste 模型）。
- **窗口批处理**：压缩提交后对丢弃区域做一次批量抽取，产出多条 memory/taste 候选；
  关闭 per-prompt 抽取；host 仍独占 confidence；作为可选 `extractionMode=window`。
- **验收**：`window` 模式只触发一次窗口抽取；不压缩的短会话有会话结束兜底；
  `mnemopi.llmMode=none` 时无额外模型调用。

### P2 — robomp 启用与上游对齐（2026-11-03 调研）

`python/robomp/` 已在 v18.15.0 合并中携带并适配 `zetacode`/`.zeta`，但没有
“生产已启用”的证据；本项是启用顺序与契约补齐，不是从零建设。设计见
[`document/agents/workflow/robomp.md`](./agents/workflow/robomp.md)。

- **前置**：先修 roadmap 已登记的 XDG/CLI 契约缺口，并在容器内跑通
  `robomp triage` / `replay`；release sentinel 保持默认关闭。
- **issue 侧**：webhook → 持久队列 → 单 issue worktree → OMP RPC；分类后只对
  `bug`/`documentation` 复现并开 PR，`enhancement`/`proposal` 只评论，维护者
  授权才实现。
- **PR 侧**：一个 issue 一个 PR；PR 前跑格式化 + 类型检查 + 完整测试；PR body
  固定 `## Repro` / `## Cause` / `## Fix` / `## Verification`。
- **review 侧**：只读、只 `COMMENT`，P0-P3 排序，不 approve/merge。
- **release 侧**：上游 robomp 的 sentinel **只修已 cut release 的失败 CI**，
  原子移动 main+tag；不改版本号、不选 major/minor。版本选择仍是
  `/release` 命令 / `release.ts` 的显式 major/minor/patch，由维护者或 agent
  看 commit 后决定。
- **Zeta 边界**：PAT 只放 sidecar；repo allowlist；自动评论/开 PR 需单独授权；
  不直接套 `release_retag` 绕过现有发布门禁；先做分类/评论，再做修复 PR，
  最后才考虑 release sentinel。
- **验收**：分类评论可回放；修复 PR 在干净 worktree 中跑完前门禁；sentinel
  只处理带发布前缀的 release commit，且不会新建 tag 或改版本。

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

### P0 — LSP memory discipline & multi-language server strategy (zetawork prerequisite)

User ruling (2026-10-15): **this must be optimised — it is a high-level roadmap
goal, not a nice-to-have.** Once the IDE/workbench is real, LSP servers are
mandatory, and "repos multiply × sessions multiply" makes the memory grow
**super-linearly — it will flatten the machine** (their words; the local Linux
distro repos + many subagents in parallel make it worse).

Triggering incident (2026-10-15, measured on this workstation): a single
`tsc.exe --lsp --stdio` (pid 31516) reached **11,756 MB**, spawned by this
repo's LSP broker (`omp.lsp.mux`, `lsp.lazy = true`, `lsp.shared = true`,
resident ~52 min), running **at the repo root** — the root `tsconfig.json` is a
solution file whose reference (`packages/tsconfig.workspace.json`) globs every
package. Broker stopped → memory released (free 16.2 GB / 31.4 GB); no
`tsc`/`--lsp` process remained. **Not** a build; the merge-branch worktree was
not involved.

Problem surface
1. One server per (repo × language) held by a shared broker: resident,
   unbounded, no heap cap, no idle eviction, no RSS ceiling.
2. Language breadth (TS/JS, Python, Rust, R, Java, C/C++, …); the node- and
   JVM-based servers (`tsc --lsp` / `typescript-language-server`, `jdtls`) are
   the heavy ones.
3. Many repos × many sessions × many subagents → per-process peak × process
   count → system-level OOM.

Directions (to be refined; not commitments)
1. **Prefer Rust-native servers** where they exist — measured/claimed to be far
   cheaper than node-based: `rust-analyzer` (Rust); `ty` (Astral: *"extremely
   fast Python type checker and language server, **written in Rust**"*) and
   `pyrefly` (Meta, Rust) for Python. Evaluate per language as we add support.
2. **TypeScript: move to the native TypeScript 7 (Go) server** —
   `microsoft/typescript-go`, preview on npm as `@typescript/native-preview`
   (`tsgo`), which ships its own `internal/lsp`; third-party editor plugins
   already use it instead of the node `typescript-language-server`. This is the
   most direct fix for the TS side; fold in the existing
   `toolchain-ts7-bun14x` findings.
3. **Broker-side discipline**: exactly one instance per (repo, language) with
   **configurable RSS ceiling + idle LRU eviction + restart on breach**.
   `lsp.shared` gives sharing without limits — that is the current state and it
   is not enough.
4. **Server configuration must expose extra args / environment** — today
   `cfg://lsp` has only `enabled / lazy / shared / diagnostics* / formatOnWrite`,
   i.e. **no way to set a heap cap** (e.g. `NODE_OPTIONS=--max-old-space-size=…`).
5. **Rust-side LSP host/client for zetawork**: `tower-lsp` /
   `tower-lsp-server` (Tower ecosystem) or `rust-analyzer/lsp-server`
   (lightweight sync) — no node in the workbench's host path.
6. **Graceful degradation**: when LSP is unavailable/disabled, workbench
   navigation must still work (grep/index), never a blank surface.

Acceptance directions: per-(repo, language) resident memory is configurable and
enforced; idle servers are released after N minutes; M repos × K sessions grows
sub-linearly; TS-side peak has a measured before/after when switching to tsgo.

Interim discipline (in force since 2026-10-15): this repo runs with
`lsp.enabled = false` for agent sessions; agents use `grep`/`read` instead of
`xd://lsp`, never run repo-wide `tsc`/`bun check`/builds, and stop any LSP
broker they started. Agents never write into the root checkout.

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

### P2 — `/tracking start` copy (memory boundary)

The hard constraint has shipped: `packages/coding-agent/src/prompts/tools/tracking.md`
now carries the **Memory boundary** clause (tracking = process state; learned
facts belong to `retain`/`recall`/`memory_edit`; the two stores stay disjoint).
What remains is the slash-command copy — `packages/coding-agent/src/slash-commands/builtin-zeta.ts:302`
still says only `用 /tracking start 开始维护项目追踪文档`, without naming the memory
boundary or the `tracking.enabled` gate.

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

**2026-11-05 状态校正**：下文 "shipped foundation / this wave" 的 Web 侧产物都在**冻结的
`web-ui/`** 里（`web-ui/public/` 的 manifest + service worker、`web-ui/lib/lazy-media.ts`）；
新的渲染器 `web-app/` 的 `web-app/public/` 目前只有 `brands/`、`favicon.ico`、`icon.png`，**没有 manifest/offline shell**。
所以"手机优先的 Web UI"这一半要随渲染器迁移重做，服务端那一半（token/TLS/远程绑定）继续有效。

Phone control of the desktop agent over the user's own network path. **No
embedded tunneling**: users bring their own port mapping, server, or frp; Zeta's
job is to make the served endpoint safe to expose and the UI phone-first.

Shipped foundation: non-loopback bind with the `remote.token` gate
(`authorizedForAccess` — Bearer / `X-Zeta-Token` on every `/api/*`, CSRF origin
guard), token rows in SettingsPanel, and `docs/remote-workspaces.md`; IM
channels (WeChat/Feishu/Telegram — see Shipped); full conversation
reconstruction over REST + SSE (`/api/sessions/:id/context`,
`/api/agent/:id/events`), including thinking blocks and inline media.

Shipped (this wave):

1. **Exposure hardening** — `--host` on `zetacode serve` (flag → `remote.host`
   → `ZETA_SERVE_HOSTNAME` → loopback); built-in TLS listener
   (`--tls-cert`/`--tls-key`, `remote.tls`, env) with a non-loopback plaintext
   bind refused unless `--allow-plain-http`; pairing QR in Settings → Web →
   Remote Access (`URL#zeta-token=…`, rendered by the dependency-free QR
   encoder); token rotation/revocation with persisted SHA-256 revocations and a
   per-peer failure limiter (10 failures / 60 s → 429) on the gate, which now
   answers 401 for a bad/revoked token. Reverse-proxy recipes (Caddy, nginx) in
   `docs/remote-workspaces.md`.
2. **Lazy media for mobile** — `GET /api/blobs/:hash` wired into the web UI:
   `MediaImage` fetches deferred images on viewport proximity through the
   authenticated fetch path and renders an object URL (an `<img src>` cannot
   carry `X-Zeta-Token` on a remote origin), with an LRU object-URL cache.
3. **Mobile web-ui** — manifest + icon set + service worker (offline shell,
   `/api/*` never cached), registered only in a production secure context;
   voice input rides the native IME (zero work).

Deferred:

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

## Deferred Queue(未开发的后期规划;开发启动时移入执行计划)

- **Attach 会话生命周期命令仍在 replica 上执行（2026-10-22 登记）**：附着 TUI 的控制面
  已走 RPC WebSocket（prompt/steer/follow-up/abort、对话框、plan_approve、模型/思考/
  plan-goal-vibe 镜像），但 `/new`、`/resume`、`/tree`、`/compact`、`/reload` 仍作用于
  本地 replica。协议侧命令已存在（`new_session`、`open_session`、`switch_session`、
  `get_entries`、`get_tree`、`compact`、`reload`），缺的是 TUI 选择器/确认流程与
  `compact` 模式（soft/remote/snapcompact）到协议参数的映射，以及切换后 replica 重建。
  未做前 `docs/cli-reference.md` 明确标注这些命令须在宿主进程执行。

- **本轮审计遗留（2026-10-20，均已定位、均未做）**：
  - **WeChat 登录状态机有四处实现**：`packages/coding-agent/src/channels/wechat-login.ts`（CLI）、
    `main/crates/zetawork-gui/src/channels.rs`（GUI 轮询）、`src/server/web-gateway/` 的渠道
    路由与 web-ui 面板各判一次 stage，词汇一致但迁移规则各写一遍。收口需要一处"归一化 +
    迁移"实现，前端只消费结果；属于重构，不改行为。
  - **`@status` 只做投影、不做校验**：`@status` 汇总的层信息来自 `Settings.sessionForCwd`，
    但用户层/项目层的**写入**仍只落一层（见下文「记忆设置的写入层级」），面板没有层级选择器；
    两侧要一起改才有意义。
  - **`@workspace use` 的 mode 校验**：`switchToWorkspace` 只校验 `resolveDir(alias)`，
    不区分 `sessionMappings.mode`；在 mixed 配置下，一个无会话映射的工作区别名会静默切到
    direct 模式而不是报错。需要一条明确的产品口径（报错 / 落到 relay）再动。
  - **IM 与 CLI 的会话命令词汇不一致**：IM 侧是 `!session use <id|n>`
    （`src/channels/workspace-router.ts:612`），CLI 侧 `/session` 只有
    `info`/`delete`/`pin` 等子命令，没有 `use`；两套命令面各记一套动词，是否统一属
    命令面复核，未定。
- **记忆设置的写入层级（2026-10-20 定现状，仅登记）**:设置面板与 `/settings` 写
  `memory.backend` 时只落用户层（`~/.zeta/agent/settings.json` 或 `config.yml`），
  面板没有"用户层 / 项目层"选择器。项目层目前的操作路径是直接编辑
  `<repo>/.zeta/settings.json`（`{"memory":{"backend":"mnemopi"}}`，见
  `docs/memory.md#project-scoped-memory`）。默认工作区不受此限：`zeta serve` 首次启动
  直接把 `memory.backend: mnemopi` 写进 `~/.zeta/workspace/.zeta/settings.json`，用户层
  仍保持 `off`。要在面板里补项目层写入，需要把 `config/settings.ts` 的项目保存路径从
  仅 `modelRoles` 泛化到任意键（含删除 tombstone 与 watcher 语义），不是界面层的小改。

- **桌宠（pet）——旁路产品，接口面只此一份（2026-10-21 裁定）**：桌宠不随
  Zeta 版本线发布，版本独立（`@linxiraos/pet`），我们**只对外暴露接口**、不内嵌实现。
  契约见 `document/pet-interface.md`：状态文件 + 命令通道，配置归属**默认工作区**，
  移动默认自主、工作区可按需下发目标点。素材生产走「文生图角色表 → 图生视频 →
  抠像/抽帧 → 图集」，可复用 `dsh-pet`（MIT）的提示词配方与 `simiao-dsh-pet`（MIT，
  仅脚本与文档）的批量驱动方案；两者生成的**素材不在 MIT 范围**，不可入库。
  Deferred：素材批量生成器与运行时本体要单独立项。

- **`document/agent-team-plugin.md` 悬空引用（2026-10-20 取证）**:`document/plugin-system.md:213`
  把「agent-team 完整开发规格（编排器 / `team_*` 工具 / 人设群聊 / Web pages）」指向
  `document/agent-team-plugin.md`，但该文件**不存在**（`ls document/agent-team-plugin.md`
  → No such file or directory）。补写规格或把链接改指到现有文档，二者择一，未定；
  在补齐前该链接保持悬空。

- **任务面板 = 官方插件（2026-10-18/19 用户定方向；设计已成文，实现未开始）**：
  设计规格是 `document/task-panel-design.md`（决策完整：单 `task` 工具带 `op`、per-repo
  `<project>/.zeta/tasks/<id>.md`、工作区绑定文件、失效规则、与用户看板分层、sticky disable、
  23 条验收场景；见文首 Shipped 的 "Multi-repo task panel design" 行）。**代码尚未开始**：
  全树没有 `.zeta/tasks` 的读写实现。
  一个**对 agent 可见、以工具暴露**的任务面板，**多仓库**——一个面板可以绑定多个
  repo，同一份任务视图跨仓库聚合；面板本体做成 **official 插件**（`plugins/official/`），
  **由 GUI 自动激活**（开面板即装/启，不要求用户手动启用）。
  - 与「用户看板」（见文首 Shipped 表）的关系：board 是**用户的**长期层，agent todo 是**会话**层；
    任务面板是**跨仓库的编排层**，三者不合并成一套数据结构。
  - 未定项（动手前必须定）：①「工具暴露」的确切形态——`task_*` 工具集合（list/create/
    update/assign）还是单一 `task` 工具带 action；②多仓库绑定存在哪（项目注册表
    `projects.json` 还是面板自己的 `tasks.yml`），以及 repo 移动/改名后的失效语义；
    ③面板数据的真源（文件在 `.zeta/tasks/`，可 diff 可手改，与 board 同口径）；
    ④`disable` 语义——用户显式关掉后，GUI 自动激活是否还成立（默认：**用户显式
    关闭即不复活**）。
- **OpenDesigner 官方兼容(2026-10-15 用户登记,2026-11-04 首版落地)**:
  用户考虑把
  [`nexu-io/open-design`](https://github.com/nexu-io/open-design)(中文说明见其
  `docs/i18n/README.zh-CN.md`)**接进 Zeta 的设计能力**,目标是**后期加入
  OpenDesigner 的官方兼容**,用来提升设计能力。
  - **已落地（TUI-first，非 zetawork）**:工作区级 `.zeta/design.yml` 开关 +
    `/design` 命令 + 单个 `design` 工具。工具内部走 OpenDesign MCP（项目/文件/
    artifact/brief/run）和 `od` CLI（media/export/brand/design-systems/figma 等），
    **不把 22 个 MCP 工具注册给会话**；默认关闭，不写全局，其他仓库零开销。
    `/design status` 分别检测 CLI、daemon、MCP。
  - **集成面已裁定（2026-11-06 用户裁决）：只做 MCP + CLI，不做 UI 集成**。已落地的形态
    就是终态：`/design` 命令 + 单个 `design` 工具，内部走 OpenDesign MCP 与 `od` CLI。
    **不做**：Web UI / Work Studio 面板、zetawork 原生设置页（Rust UI 已作废）、
    OpenDesign 自身 React UI 内嵌。理由：桥接的价值在模型能调设计能力，不在于再画一遍
    别人的界面；UI 集成会把我们的渲染器绑到第三方的面板模型上。
  - 旧记录（已作废，保留供对照）:zetawork 原生设置页、Web UI 集成、OpenDesign 自身 React UI 内嵌。
    该行的"重启条件 = zetawork 恢复或 `web-app/` 接设计面"随 2026-11-06 裁决一并作废：
    UI 集成不再是待办，也不再是重启条件。
  - **许可与分发边界**:它是独立上游 Apache-2.0，但捆绑的 design system/plugin/
    资产须单独核 provenance，**不得把 copyleft 链进我们的 MIT 发布面**；首版只调用
    外部 CLI/MCP，不分发其资产。
  - 文档:`docs/design.md`、`docs/tools/design.md`、`docs/settings.md`。

- **robomp 容器 CLI 契约残留(2026-10-14)**:本轮已修「镜像只装了一个 CLI 垫片,
  而 robomp 按名 spawn 另一个名字」这一断层——`Dockerfile`(pi-base 段)的垫片
  `/usr/local/bin/zeta` 更名 `zetacode`(`ENTRYPOINT` 同步),robomp 三处取值
  (`src/config.py:101` 默认、`docker-compose.yml:81`、`.env.example:186`)对齐
  `zetacode`,`python/robomp/AGENTS.md`/`README.md` 的幽灵 `/usr/local/bin/omp`
  垫片叙述与 `omp --mode rpc` 调用叙述一并改写;机器守卫
  `scripts/check-robomp-cli-contract.ts`(CI `check` job + 本地 `local-ci.yml`
  `check` job)从 Dockerfile 垫片名与 robomp 取值两侧推导,任一侧漂移即红。
  **仍排队(逐项已取证,勿与上条混谈)**:
  - ①**沙箱 XDG 目录名**:`python/robomp/src/sandbox.py:541-549,584-588` 预建
    `$XDG_*_HOME/omp`,而产品只认 `$XDG_*_HOME/zeta`——`packages/utils/src/dirs.ts`
    (`APP_NAME="zeta"` @:24)以 `fs.existsSync($XDG_*_HOME/zeta)`(:383、:403)为
    XDG 生效条件,故今日容器内 XDG 重定向**从未生效**,产品状态根回落 `~/.zeta`
    (=`/srv/agent-home/.zeta`,root:root 0755,见 `entrypoint.sh:68-69`)。改名即把
    产品 data/state/cache 切到各工作区 XDG 树,并使 `entrypoint.sh:77-84` 与
    `worker.py:199-221` 那套 group `omp` 共享 `~/.zeta/run` 方案失效——**必须先有
    容器内验证**(本机无 docker daemon),故本轮只出结论不动手。
  - ②`PI_ROOT`/`OMP_*` 环境变量族改名:AGENTS.md 品牌表 2026-10-10 裁决暂缓,
    robomp 的 `ROBOMP_OMP_COMMAND` 属同族,本轮只改取值不改名。
  - ③镜像 tag/stage 名:`package.json:138,139,147` 的 `PI_IMAGE` 默认
    `oh-my-pi/pi:dev` 与 `Dockerfile.robomp:19`/`docker-compose.yml:23` 的
    `zeta/pi:dev` 不同名(compose 显式传参掩盖),`pi-base`/`pi-runtime` 段名同属
    镜像命名面——不在本轮范围。
  - ④容器内 unix 组 `omp`(`entrypoint.sh:25-38`、`worker.py:674` `extra_groups`):
    跨槽位权限模型的一部分,刻意保留。
  - ⑤Python SDK 默认命令名:`sdk/python/zeta-rpc/src/zeta_rpc/client.py:458`
    `executable: str = "omp"`(手写 transport 默认值,robomp 恒显式传参故不影响
    容器);`scripts/rate-edit-tool.py:949-956` `shutil.which("omp")` 与报错文案
    「`zetacode`」自相矛盾。二者同一类「默认值指向不存在的命令」,待独立批次。
  - ⑥robomp 工作区内部目录名 `.omp-xdg`/`.omp-tmp`/`.omp-session*`
    (`sandbox.py:17`、`test_sandbox.py` 多处):纯 robomp 自用 scratch,非产品配置
    面,改名无契约收益、改动面大,不排期。
  - ⑦`python/robomp/` 散文仍通篇以 "omp" 称呼产品(如 `README.md:50,58,226`):
    品牌扫描 `SKIP_PREFIXES` 有意跳过 `python/`,随 ②的 env 迁移一并处理。

- **tracking 面板读取上限（v18.8.8 专项的唯一残留，2026-10-20 复核）**：`sessions/`/`summaries/`/`plans/`
  的 markdown 仍无条数/字节上限且整篇读入（`readMarkdownDir`，
  `packages/coding-agent/src/server/web-gateway/tracking.ts:127-148`），面板一次拉全量。
  同批的「租约锁 / actions 轮转 / summaries 子页 / `updatedAt` 内容派生」四项已实现，
  版本线文档漂移已收尾。

- **pi v1.0.0 语义移植评估(2026-10-02 四子代理调查,结论入账)**:对比
  基线=上游树上 pi 重写点(5d826095780≈v0.30.x,2026-01-01)→pi v1.0.0,我方
  基线 977ec83(2026-07-31)距其 1389 提交。裁决:**durable 子系统暂缓**——
  OMP 作者有主动引入意愿,等上游带进来再随 release 合并吸收,不自建。（②
  cacheWarming 三档已落:`providers.cacheWarming`,默认 `idle`。）仍排队:
  ①codemode/tool_search 官方内置扩展激活(defaultTools 设置页组,默认关)
  ③TUI/UX 开关包(默认关清单逐项裁断)④provider stream events 语义移植（全树
  无 `provider_stream_event`，未落）。官方插件生态参照:
  llama.cpp/codemode/tool_search/mcp 四内置,replaceable:true 让位机制,
  tuiText(key,fallback) 宿主注入 i18n。
- **TUI 文案覆盖与硬编码门禁（2026-11-06 暂挂）**：TS 侧目录已完整（`packages/tui/src/i18n.ts`、
  `packages/coding-agent/src/i18n/{messages,en,zh}.ts` 3,098 key 且 `check-i18n-consistency` 全绿），
  缺的是覆盖面：`packages/tui/src` 仍有 73 个 `actionButton("…")` 字面量与若干原始模板串不走
  catalog，任何语言下都保持英文。**修正（2026-11-06）**：早先写的"确定要发布第二门语言"是错的 —— `zh` 已经出货：
  `packages/coding-agent/src/i18n/index.ts` 的 `CATALOGUES = {en, zh}`、`settings.language`
  可选、locale 还能从 `zh_CN.UTF-8` 自动识别。所以那 73 处并非"未发布语言的未来工作"，
  而是**已发布语言下真实的中英混排**。条件改为"下一个 TUI 文案批次"；顺序仍是先落
  "禁止新增硬编码文案"的扫描门禁（便宜且防增长），再按目录迁。与 `zetawork` 无关。Rust `zeta-main` 不在此列
  （zetawork 暂停，见 P0 裁决）。
- **TUI 套件命名定稿与 zeta 工作台(2026-09-30 用户裁定,取代上方的
  "TUI 三件套整合设计"旧条;命名口径 2026-10-15 收口)**:产品形态 =
  `zetawork` 打开**嵌套终端工作台**
  ——一个终端进程,顶层标签页(tab = 窗格布局快照),窗格为真实 PTY 嵌
  终端(zetacode / 内置编辑器面板 / shell 皆为子进程),快捷键+菜单快速打开自家工
  具,各命令独立启动、help 各自独立。命名:`zetacode` = coding CLI
  (@linxiraos/zeta 换 bin 不换包);编辑器 = 工作台内置面板(ttt vendored 已于
  2026-10-16 退场,2026-10-17 起 `@linxiraos/editor` 的载荷就是该内置编辑器的
  编辑器专用入口 `termide-editor`,按路径 spawn,无 bin);
  `zetaide` = termide(由未发布的 @linxiraos/work 更名);`zetawork` =
  @linxiraos/main(新,工作台本体,main/ 独立 Rust workspace,path 依
  termide crates;裸 `zeta` 只打印套件索引 help);files = 终端文件
  管理器(superfile 暂缓,候选调研中)。**终端 IDE 只剩 termide**(ttt 已随之
  退场,不再是"两个并存观察")。参照系:OpenCode 的多 tab 在其 app 层
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
  Alt 平面 vs files/编辑器/zetacode 各自的键位,冲突最多损失加速、
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

  **2026-11-05 暂挂**：zetawork（含 `main/crates/zeta-main` 的 TUI）暂停，本项不新增代码；
  重启条件 = `publish_zetawork` 恢复自动发布。命名口径仍有效（`@linxiraos/main` 包名留给
  main 面），下面作为决策记录保留。另：迭代队列里的「tab 会话/handoff 联动（`handoff.json`
  机制扩展）」随 `~/.zeta/handoff.json` 契约于 2026-10-17 退场而作废。

- **pi-messenger 用户可见文案抽取（插件宿主 i18n 的最后一环，2026-10-20 机制已实现）**：
  `ExtensionContext.t(key, fallback?)`、`PluginManifest.locales`、`plugins/locales.ts`
  的「当前语言 → en → fallback → key」查找均已在树（`docs/plugins.md` 为实现契约）。
  仍排队 = pi-messenger 的用户可见字符串抽取（overlay / 命令 / 工具描述 / handler 文案，
  11 个文件量级、约 200+ 条字面量）+ zh 条目；抽取前必须划清「用户可见 UI 文案」
  与「模型可见提示词（工具 description、crew/skills）」的边界——后者本地化会改变模型
  行为。

  **2026-11-06 状态校正**：宿主是 **`zetacode` 本体**（`plugins/official/pi-messenger/`
  走插件 API：`registerCommand` + TUI overlay），不是 zetawork。所以「宿主退场」不适用：
  这项是活的，与渲染器裁决无关，只是排队。别把它当僵尸条目删掉。

- **上游 2.0 评估：被推迟的三项(2026-10-13 用户裁决)**:完整决策记录见
  `document/upstream-2.0-evaluation.md`。统一后端方向已定为「局部对齐 + 发现即复用」
  (不做完整统一后端,已开工:`zetacode serve` 注册文件 + 同版本复用 + 桌面优先复用);
  PI 内核**不换**。本队列登记三项:①**自建完整统一后端**(opencode 2.0 形态:全机
  daemon + 固定端口 + HTTP/SSE + 服务发现)——押后,启动时再评估;②**跟进 omp² /
  pi-durable**——两者均未发布(omp² `omp2` 分支仍 pre-release,pi-durable 为
  Experimental 且无网络外壳),等上游稳定后再评估对接;③**档 1 反向 cherry-pick
  候选清单**——方向已定(保留为候选,量级 8–20 agent-日),但具体挑哪些能力待裁断,
  开工时从本队列移入执行计划。

- **pi 0.61.1 → v1.2.0「选择性拉取」冲突面登记(2026-10-13 用户裁决:本轮不开工,只列清单与路线图)**:接续上条 ③,
  本条把「挑哪些能力」的冲突面与候选清单完整登记下来,便于将来开工时直接移入执行计划。历史同步点
  `b21b42d0`(= pi 0.61.1,2026-03-22),对照面 pi `v1.2.0` = `06a4669355`(2026-10-12),欠账
  `git rev-list --count b21b42d0..pi-v1.2.0` = **3,562 commits / 95 个版本条目 / +352,211 −91,355 行**
  (其中 `packages/` 1,874 文件 / +335,563 / −84,041)。
  **可行性结论**:差异化拉取**能做且是唯一可行形态**,但它只吃下 pi 这半年增量的「表层能力」,pi 1.2.0 的
  「架构增量」拿不动。分桶(110 个细粒度评估项):我方已覆盖 23%、可直接取 26%、需适配 38%、不可取 13%
  ——按条目约 **60–65% 可落地**;按代码量约 **40–55% 落在不可取侧**(pi 7 个新系统层包 105,267 行 + 内核重写块)
  `[推断]`。**最大障碍 = 三处契约层分叉**:①会话数据模型(pi 的 lane-based `Session` v4 / `SessionRepo` /
  `TranscriptContext` / `finishTurn` / `ContextEditEntry` 在我方全库 0 命中,我们只有 `SessionStorage` 接缝);
  ②工具参数校验与暴露体系(pi `typebox` ↔ 我们自研 `omptype`(355 文件 import);pi
  `exposure`/`namespace`/`reachesTools` ↔ 我们 `hidden`/`loadMode`/`approval`);③pi 的系统层新包中
  `chord`(chord2 宿主运行时)/`durable`/`env` 形成自闭合依赖链,且 `durable`(63,985 行)与我们
  `session/`+`compaction` 正面重叠。
  **取法(硬约束)**:不 merge —— `git merge pi-v1.2.0` 已实测不可行(201 冲突文件 / 1,263 冲突块 /
  98.7% 真语义);真实冲突面只有 **168 个同名文件(`src/` 生产码 62 个**,pi 78,239 行 vs 我们 148,510 行),
  一律走 `port/pi/<scope>` 分支 cherry-pick。本仓库已有 24–25 次同类 port 提交先例,最近一次为
  `7fb18faf4c6`「backported pi-mono changes (1feccfed..b21b42d0)」;门禁沿用
  `scripts/check-merge-lineage.ts` 与 `document/merge-playbook.md`。
  **取证产物(本地,`temp/` 不随仓库发布)**:`temp/.omp-tmp/pi-pull-surface-report.md`(完整报告,含分组
  热力表、同名文件榜、复现命令)与 `temp/.omp-tmp/pi-pull-surface-summary.md`。

  **候选清单(20 项,均未开工;量级 S ≤1 / M 1–3 agent-日,区间为含验证的估计 `[推断]`)**:合计约
  **18–26 agent-日**,可拆 20 个互不阻塞的独立 PR,**零 merge 冲突面**。

  | # | 能力(一句话) | 代表 SHA | 落点 | 风险 | 量级(agent-日) | 拖入依赖 |
  |---|---|---|---|---|---|---|
  | 1 | `--tools` 支持 `+name`/`-name` 增量,不再整表替换 | `ddaa0a0341a` | 改造 `packages/coding-agent/src/cli/flag-tables.ts` + 工具选择链 | 低 | S(0.3–0.8) | 无 |
  | 2 | `--exclude-tools`/`-xt`,并给 `--tools`/`--exclude-tools` 加 `*` 通配与 `--no-mcp` | `04b97ef0007` | 新增 flag,接入 `loadMode`/`hidden`/per-run 工具集判定链 | 中 | M(1–2) | 无 |
  | 3 | `ToolDefinition.prepareArguments`(schema 校验前规整参数) | `b5f425ad152` | `extensibility/extensions/types.ts` 新增槽位 | 低 | S(0.3–0.8) | 无 |
  | 4 | `defineTool()` 与生态导出批量(`CONFIG_DIR_NAME`/`generateUnifiedPatch`/`convertToPng`/`parseArgs` 等) | `0.65.0` 等 | `packages/coding-agent/src/index.ts` 从既有 shim 正式 re-export | 低 | S(0.5–1) | 无 |
  | 5 | 发布 4 套配置 JSON schema(settings/models/keybindings/themes),并修主题 `$schema` 漂移 | `96abe9a5ad3` | 新增生成脚本 + 4 个 schema 文件 | 低 | M(1–2) | 无 |
  | 6 | `AGENTS.override.md` 每目录上下文覆盖 + symlink AGENTS.md(嵌套 worktree)修复 + `--no-context-files` | `8ecf8a9883d` / `f1b2e77f5b1` | `discovery/` + 规则优先级(`--no-rules` 已等价) | 低 | S–M(0.5–1.5) | 无 |
  | 7 | `--session-id` / `--name,-n` / `settings.sessionDir` / `PI_CODING_AGENT=true` | `52dc08c1f78` / `ce554ad3dec` | `cli/args.ts` + `session/session-manager.ts`(贯穿 create/fork/恢复) | 低 | M(1–2) | 无 |
  | 8 | Windows `EPERM` 锁瞬时重试(防御性对齐) | `e6fb2581dff` | 落点在我们的 SQLite 凭证/锁工具,非 `auth.json` | 低 | S(0.3–0.8) | 无 |
  | 9 | 认证面补齐:`ANTHROPIC_AUTH_TOKEN` bearer + Anthropic workload identity federation + `auth check` 三态 + `print-api-key`/`print-bearer-token` | `0.82.1` / `0.99.2` / `0.83.0` / `0.84.1` | `packages/ai/src/auth/*` env 别名;扩 `commands/token.ts` | 低 | S–M(0.5–1.5) | 无 |
  | 10 | 全局 `httpProxy` 设置(只作用于自家管理的 fetch) | `0.79.5` | 新增 settings 键 + fetch 注入 | 低 | S(0.3–1) | 无 |
  | 11 | OpenRouter provider-preference 全字段(allow_fallbacks/require_parameters/data_collection/sort/max_price/ignore/quantizations) | `0.67.1` | `packages/catalog/src/types.ts` + KDL 轴 + 两处请求构建 | 低 | S–M(0.5–1.5) | 无 |
  | 12 | `samplingParams` + `samplingParamsByThinkingLevel`(每模型默认值 + 按思考档覆盖) | `0.84.0` / `1.0.2` | catalog schema + resolver + 合并顺序 | 中 | M(1.5–3) | 无 |
  | 13 | `inputLimits.images.resize` 每模型图像缩放档 | `f5c946480c5` | catalog 模型配置 + `packages/ai` 图像管线 | 中 | M(1–2) | 无 |
  | 14 | per-key OpenRouter 模型列表(`/models/user` + 离线保留) | `ee409a85f6a` | `catalog/src/provider-models/openai-compat.ts` | 中 | M(1–2) | 无 |
  | 15 | `retry.provider.{timeoutMs,maxRetries,maxRetryDelayMs}` 命名空间 | `0.70.1` / `0.76.0` | settings schema + 各 provider 传输层穿透 | 中 | M(1.5–3) | 无 |
  | 16 | 渲染上下文 `durationMs`(别名我们现有 `elapsedMs`)+ `outputPad` | `36a686ee8dd` / `18336987add` | `packages/tui/src/tools/renderer.ts` + 卡片/消息渲染管线 | 低 | S–M(0.5–1.5) | 无 |
  | 17 | 扩展事件补齐 6 个:`session_compact_failed` / `ui_prompt_start·end` / `provider_stream_event` / `thinking_level_select` / `session_info_changed` / 输入 `streamingBehavior` | `a6b1dbceb1a` / `ccfe79ed238` / `0.99.0` / `0.71.0` / `0.80.3` / `0.77.0` | `extensibility/shared-events.ts` + runner 各插入点 | 中 | M(2–4) | 无 |
  | 18 | 扩展 API 小补齐 8 项:`ctx.signal` / `pi.on()` 退订 / `clear_queue` / `prompt·steer·follow_up` disposition / bash RPC `excludeFromContext` / `registerToolRenderer` / `renderShell:"self"` / `terminate:true` | `0.63.2` / `0.86.0` / `a79b3733421` / `e473b5cd8b6` / `61babc24cf6` / `1.0.1` / `f7cd613ee46` / `0.69.0` | 扩展面 + `modes/rpc/*` + `tui/src/tools/*` | 中 | M(2–4) | 无 |
  | 19 | TUI/CLI 小项打包 9 项:OSC 7501 契约上移 `Terminal.setProgramStatus`、`PI_TUI_WRITE_LOG` 目录、HTML 导出 `display:false` 的 H 切换、`${1:-7}` 位置参数默认值、task-list checkbox、`quietStartup:"header"` 三态、`externalEditor` 设置、`/tree` `Shift+T`、设置命名别名 | `503c605528f` / `0.63.0` / `0.99.0` / `0.79.1` / `0.74.1` / `f29ea3deb29` / `0.80.3` / `0.65.0` | `packages/tui/*` + `modes/settings.ts` + export 模板(可拆 8 个 PR) | 低 | S(1.5–3 合计) | 无 |
  | 20 | 新 provider KDL 规则:ant-ling / qwen-token-plan(+CN) / openrouter-fusion | `0.78.1` / `0.84.1` / `0.79.8` | `packages/catalog/src/rules/providers/*.kdl` | 低 | S(0.5–1) | 无 |

  **大项立项登记(5 项;用户勾选,单列不入候选清单,因量级 L 或触及契约层)**:每项写「范围 / 量级 /
  为什么单列 / 开工前先定什么」。

  - **全屏 transcript 体系**:范围 = pi 0.84.0→1.0.0 的 `tuiMode` 全屏模式、transcript 搜索(Ctrl+Shift+F)、
    jump-to-latest、选区自动复制、可拖拽滚动条、`fullscreenWheelScrollLines`。量级 **L(8–20 agent-日)**。
    单列理由:我们当前是「主屏 native 流 + overlay 借 alt-screen」,并刻意保留终端原生选区
    (`tui.mouse` 默认 false),这不是接线而是新状态机。**开工前先定**:①是否接受 in-app 选区(与终端原生
    选区/复制行为互斥);②alt-screen 生命周期与 native 图像预算/`scroll-view` 的接线边界;③`tuiMode`
    默认值(pi 1.0 起默认 fullscreen,我们是否跟随)。
  - **codemode 引擎**:范围 = pi `packages/codemode`(33 文件,QuickJS 沙箱,外部依赖仅 `quickjs-wasi`,
    不 import 任何 pi 包)+ `coding-agent/src/extensions/codemode` 的接线。量级 **L(5–12 agent-日)**。
    单列理由:包本身最干净,但价值依赖 pi 的工具暴露契约(`exposure`/`searchTools`/`describeNamespace`/
    `reachesTools`),与我们 `hidden`/`loadMode`/per-run 工具集重叠但不等价。**开工前先定**:①工具暴露度
    模型二选一还是并存;②`prepareLoadout()`/`ctx.executeTool()` 嵌套工具调用是否一起做;③`quickjs-wasi`
    的打包体积与 eval 沙箱的安全边界。
  - **虚拟模型 `registerVirtualModel`**:范围 = 扩展注册模型、逐请求选物理模型 + thinking level
    (`0.99.0`,SHA `540e174c72c`),含 selection/dispatch 分离、会话分支态、footer 与 `/session` 展示。量级
    **L(3–8 agent-日)**。单列理由:它贴模型解析/角色链与 catalog,是候选里最靠内核的一项(我方
    `virtualModel` 全库 0 命中)。**开工前先定**:①路由态是否进 session 条目(影响会话 JSONL 兼容);
    ②与 `registerProvider` 静态/动态注册的关系与优先级;③成本归属(按物理模型计费)。
  - **project trust gating**:范围 = 项目本地设置/资源/指令/包加载前的信任裁决 + `project_trust` 扩展事件 +
    `defaultProjectTrust` + `--approve`/`--no-approve`(`0.79.0`/`0.79.1`,SHA `718215bd95b`)。量级
    **L(4–8 agent-日)**。单列理由:全新子系统且要插在启动早期顺序里;我方 `isProjectTrusted()` 目前是
    恒真桩,与既有 `--trusted-extension`/`--auto-approve` 语义必须裁决,否则双语义并存。**开工前先定**:
    ①信任粒度(项目/目录/资源/插件)与存储位置;②「扩展可裁决」与「设置先行」的顺序;③对 Web/桌面宿主
    (`serve`/gateway)的等价面。
  - **`message_update` 增量契约**:范围 = 把 RPC/JSON 的 `message_update` 从「累积快照」改为「只发
    `assistantMessageEvent` 增量」(pi 0.84.0 破坏性)。量级 **M–L**。单列理由:我们默认全量、另留
    `set_event_filter("delta")` 可选投影;翻转默认会拖垮既有 wire 消费者与 `rpc-client.ts`,故建议做成
    SDK/host 层「pi 兼容模式」而不是改默认。**开工前先定**:①兼容开关的承载层(SDK 选项 vs wire 版本
    协商);②`message_start`/`message_end` 之间增量装配的责任归属;③对既有 Web UI/desktop 消费面的回归范围。

- **审批内核钩子(自建能力第三批;**唯一触及内核面的项**;2026-10-13 用户裁决 F5=B)**:范围 = 把审批从「文本 `select`」升格为
  结构化事件:**内核**在 `ExtensionUIContext` 新增**可选** `approvalRequest?({toolCallId,toolName,tier,approvalMode,reason?,prompt,expiresAt?})
  → ApprovalDecision("allow_once"|"allow_always"|"reject_once"|"reject_always")`,发射点 `wrapper.ts` 的 `approvalCheck.required`
  分支(**有钩子走钩子,没有退回 `select`**);**网关**发 SSE `approval_requested`/`approval_resolved` +
  `extension_ui_request(method:"ask")`/`method:"cancel"`,并扩 `POST /api/extension-ui/response` 为 `{id,value?,confirmed?,cancelled?,timedOut?,answers?,decision?}`;
  **前端**新增 AskCard(多问题走查/推荐徽章/自定义输入/备注)与 ApprovalModal(工具/tier/reason/prompt + 四决策按钮)。
  必带两个副项:共享 `parseAskDialogResponse` 校验器迁出为单一实现;`uiRequestOwners` 注册时机 bug(搬到 `dispatchUiRequest`,
  否则无 `/events` 订阅时答复恒 404 —— 全局审批面与多标签/多窗口的前置)。
  **边界(与第二/第三批)**:**第二批 = ask 通道**——网关实现 `askDialog` + `ExtensionUiRequest`/`ExtensionUiResponse` 联合扩型 +
  校验器共享,**不改内核行为**,且必须先合(PR-B 复用同一扩型/答复体形状);**第三批 = 本条**——唯一新增内核可选方法的一批,
  因为审批决策语义(tier 解析、`policy:"deny"`、provider safety 不可绕过、`xdevApproved`/`acpApprovedArgs` 旁路)全在内核
  (`wrapper.ts` + `tools/approval.ts`),网关无法从提示串反推;「总是允许」也必须由内核决定落盘位置,不能由 UI 私自持久化。
  `select` 兜底路径**完整保留**(纯加法兼容)。**量级**:3 后端 PR + 2–3 前端片 + 约 10 例契约测试,**约 10–20 agent-日 [推断]**。
  **为什么推迟**:1.2.1 只带已合内容;钩子落在**每个工具调用**的关键路径,需人在内核面 review;前端片须排在 P2 `S8` 之后、
  且与 P1 合入后共用一次 `panel-registry` 三列表改动。**开工前先定**:①fail-closed 与超时语义(超时只能**拒绝**、绝不自动放行)
  及 `abort` 语义;②`allow_always` 落盘范围(默认仅会话内存表;写 `tools.approval.<tool>` 需二次确认并与 `tools.approvalMode`
  的优先级说明);③结构化事件**替代** `select`(目标态)还是配对过渡(过渡态须写死配对规则,否则双弹窗);④`ask` 图片附件
  (`customInputImages`/`noteImages`)是否支持(不支持须**显式拒绝**而非静默丢弃)。
  **取证(本地)**:`temp/.omp-tmp/capability-contracts.md` §3(含现状 `文件:行号`、拟议契约、落点、代价、重叠评估);
  关联 `temp/.omp-tmp/reasonix-controls-plan.md` §F5(方案 B)。

- **记忆内容管理「写面」(2026-10-13 用户当前未选,登记为**待定**)**:范围 = 在**已合并的只读面**(PR #166:
  `GET …/memory`(status + 逐后端能力矩阵)/`…/memory/search`/`…/memory/items/:memId`)之上做写侧:`PATCH /api/agent/:id/memory/items/:memId`
  (`op: update|forget|invalidate`)、`POST /api/agent/:id/memory`(`clear|enqueue|stats|diagnose|queue`),可选 PR-3 做 `local`
  文件**只读**清单;前端为 MemoryPanel 的详情/修订/归档片。**量级**:1 后端写 PR(+1 可选文件面)+ 1–2 前端片,
  **约 5–10 agent-日 [推断]**。**为什么待定(推迟)**:写侧风险高且用户未选 —— 5 个后端能力**严重不对称**
  (`off` 全禁;`local` 只写 `learned.md` 且**无搜索**;`mnemopi` 全可写;`hindsight` 内容在服务端且不可寻址;
  `sharpshooter` 搜索仅子串、无归档);mnemopi 的 search/edit 依赖会话级 `MnemopiSessionState`,不能凭空开库编辑;
  HTTP 写入口**不得绕过** `redact.ts` 的凭据擦除;`recall` 返回的是**截断预览**,修订前必须先取全文,否则会把预览写回去;
  `local` 汇总文件是**整体重写**语义,提供「编辑」会与整合互相覆盖。**开工前先定**:①**写侧能力矩阵**
  (哪些后端可写/可搜索/可归档)与 UI 空态文案(`capabilities` 必须下发,否则 UI 会整片空白);②风险控制与边界
  (无活会话 → 明确报「不可写」而非 5xx;归档 = `invalidate` 软删与 `forget` 硬删的措辞分开;**写入路径强制走 redact**);
  ③`local` 文件面只做只读清单还是允许编辑(推荐只读);④可选 `memory_changed` 事件是否做(推荐不做,避免与 `state_changed`
  抢语义)。**取证(本地)**:`temp/.omp-tmp/capability-contracts.md` §2 与 §5.1/§9(逐后端现状 `文件:行号`、拟议契约、代价、未决项)。

- **Node 残留：npm 启动器 shebang/engines + 安装文档成对改（2026-10-13 登记；2026-11-05 收窄）**:
  原条目 ①「删 desktop 打包期的内置 Node staging」随 `desktop/` 暂停作废（
  `desktop/scripts/prepare-runtime.mjs:53` 仍在，但该壳不再构建）。剩下 ② 仍有效：
  `termide/npm/ide/bin/zetaide.js` 仍是 `#!/usr/bin/env node`、`termide/npm/ide/package.json`
  的 `engines` 仍是 `{"node": ">=18"}`（`main/npm/main/` 同形，但 `main/` 已暂停）；
  **必须与安装文档成对改**（`README.md:112` 仍写 "Node 18+ or Bun"），否则 `npm i -g` 生成的
  Windows `.cmd` shim 仍硬编码 `node`，等于假迁移。**量级**:低——2 个 PR,**约 1–3 agent-日 [推断]**。
  **开工前先定**:`bun install -g` 在 Windows/macOS/Linux 三端生成 shim 的行为确认。
  **取证(本地)**:`temp/.omp-tmp/node-residency-report.md` §1.3(b)、§2.1、§2.2、§3 第 2/4/5 条、
  §4.2、§5.1(两条 P1)。

- **Node 残留:「明确不改」清单(防后人误改;2026-10-13 登记)**:
  下列均为**刻意保留 Node**,不是漏改、不是待办;任何人**不得**以"全线 Bun"为名改动:①**Electron 主进程**
  (`desktop/package.json` `electron@37.10.3`)——Electron 官方把 Node 作为主进程运行时内建,"改掉它"等于换桌面外壳框架,
  不是运行时迁移;②**CI 发布 job 的 `setup-node` + npm trusted publishing**——`npm publish` 的 OIDC 依赖 npm CLI
  (`ci.yml` 注释已写死:npm 12 需要比 Bun 1.3 更新的 emulated Node),改动收益为零、风险是断发布;③**`electron-builder`**
  (`desktop/scripts/package-desktop.mjs`)——纯 Node 工具、无 Bun 等价物,只在构建期跑;④**构建期 Node**(web-ui
  `next build`、desktop `npm ci`、`node --test` 契约测试)——工具链而非产品运行时,目标机用户不接触;
  ⑤**用户自带的 LSP/MCP/DAP/npx 生态工具**——它们本身就是 Node 程序,我们只保证"优先 / 回退"策略正确;
  ⑥**Dockerfile 的 `node→bun` 符号链接**(`Dockerfile:141-147`)——方向是"去 Node 化"(用 bun 伪装 node,服务镜像内
  `#!/usr/bin/env node` 的包 bin),删掉反而让镜像工具链断。**取证(本地)**:
  `temp/.omp-tmp/node-residency-report.md` §5.2(逐条原因)、§3 第 3/8/9/11 条。

- **Node 残留清点后续:P2 已开工 + NAPI/Bun "best effort" 风险事实(2026-10-13 记录)**:
  **2026-11-05 复核**：CI 的 Bun natives 回归已是阻塞性（`.github/workflows/ci.yml` 的
  "Bun natives regression" job，注释写明 "A real Bun gap found here is a release blocker"），
  `Cargo.toml:358-359` 显示 addon 只用到 level 8 type-tag 校验；`findNpxCli()` 的 Bun 分支未逐条复核。
  下面是保留的风险事实：
  状态 = P2 三项(`napi10` 降到实际所需的最低 Node-API level、CI 为 Bun 的 natives 加**阻塞性**(而非
  `continue-on-error`)回归、`packages/coding-agent/src/server/web-gateway/npx.ts:29-45` 的 `findNpxCli()` 增加 Bun 分支)
  **已另派、开工中**,不属本队列(此处仅留状态与风险)。**关键风险事实**(须先记牢):我们的 addon 用 **Node-API level 10**
  (`Cargo.toml:338` `napi = { version = "3", features = ["napi10", ...] }`,并自行 vendored napi,见 `Cargo.toml:45`),
  而 napi-rs 官方支持矩阵把 **Bun 标为 "Best effort"**:Bun job `continue-on-error`(失败不阻塞 napi-rs 发布)、
  `napi new` 脚手架**只提供 Node-API level 1–9**、且明确把 "Bugs in an alternate runtime's Node-API implementation"
  排除在 ABI 保证之外;Bun 官方 Node-API 文档**未声明支持的版本号**。这是整份清点里**风险收益比最差**的一处——
  迁移收益为零(已经在 Bun 上),风险是"某次 Bun 升级把深水区 NAPI 语义改坏"。**取证(本地)**:
  `temp/.omp-tmp/node-residency-report.md` §4.3、§5.1(两条 P2)。

- **README 语义修正项(待定;2026-10-13 登记)**:`README.md:112`(登记时报告记作 :36)的 "Install the workspace
  (**Node 18+ or Bun** on the machine)" 与实测不符——`@linxiraos/zeta` 实际**需要 Bun**(发布产物是 Bun 目标 bundle,
  `packages/coding-agent/src/cli.ts:47` 模块顶层访问 `Bun.semver`);`@linxiraos/zeta-web` 需要 **Node ≥ 22.19.0**
  (`web-ui/bin/node-version.js:3` 硬门禁);真正只需系统 Node 的是 main/ide 两个 Rust 工具的**启动器**。
  范围 = 修正 README 与 `docs/user-guide*.md` 的安装前置描述。**量级**:极低(单文件级文档小修)。**为什么待定**:
  它从属 **P1**——P1 落地时安装文档本就要改成 `bun install -g`,可顺带一次改对;若 P1 长期不开工,可独立小修。
  **开工前先定**:归入 P1 批次,还是独立小修。**取证(本地)**:`temp/.omp-tmp/node-residency-report.md` §2.5、§4.2。

- **测试「墙钟绑定」同类清理(2026-10-14 登记,来自 native 桶 chunk 13/34 flake 定案 PR #187)**:
  **事实**:`Test coding-agent native/unit (TS)` 两个 flake 已定案并修复(chunk 13 `test/collab/chunked-welcome.test.ts`、
  chunk 34 `test/issue-3464-ollama-cloud-task-backoff.test.ts`),**两者非同机制、同类型**——都是「把断言结果绑到真实时间」,
  放大器是**本桶刻意 over-subscribe**(4 chunk 进程 / 2 core 的 runner),不是产品 bug:一个给纯微任务路径设了固定
  250ms 预算(负载下 join→reject p90 749ms/p99 1495ms,但**每次都正确 reject**),另一个的断言依赖产品
  `retry.fallbackRevertPolicy=cooldown-expiry` 的 200ms 回拨窗口(链解析与 failover 每次都正确)。
  **残余同类(本次未做,属非目标)**:①**107 个** coding-agent 测试文件使用正数时长的 `Bun.sleep`,其中 **27 个**与
  `Promise.race` 配对(= 假预算的主要形状);②同桶已注释掉的 `mcp/transports/stdio.test.ts` pid 轮询 flake;
  ③同 chunk 邻居 `test/collab/host-peer-left-queue.test.ts` 用 1–8s 预算(宽松,风险低)。
  **范围**:按类清理——纯微任务/内存路径的固定预算改为**直接 await 被测 promise**(hang 交 per-test timeout 兜底);
  断言依赖产品时钟窗口的**冻结时钟**(`vi.spyOn(Date,"now")`,兄弟套件 `test/agent-session-retry-fallback.test.ts` 已是此范式,
  且该文件 `afterEach` 已有 `vi.restoreAllMocks()`)。**不动** chunk 划分与池宽度(无共享状态/端口/临时目录/缓存参与,
  负载才是放大器)。**量级**:中——107 文件需逐个甄别,真需改的是子集,**约 3–8 agent-日 [推断]**。
  **为什么推迟**:非用户可见行为、当前桶全绿,一次性大扫会与在飞的 PR 冲突。
  **开工前先定**:①甄别标准——哪些 `Bun.sleep` 是「等真实异步 I/O(必须保留)」、哪些是「假预算(必须删)」,
  以免把真实等待也一并删掉;②是否顺手加一条 lint/守卫把「用固定时长 race 去断言一个微任务结果」这种形状拦死
  (仓库已有 `ts-no-test-timers` 的同精神规则可参照);③是否把该桶池宽度/分片作为独立议题评估(本次结论是**不需要**)。
  **取证**:`pr://187`(含前后失败率表 12/40→0/40、23/40→0/40 与逐字原始断言);本地未提交的
  `temp/bucket-flake-triage/.repro/`(`before_single.txt`/`after_single.txt`、`runs/*.log`、3 个机制探针
  `probes/`、`harness.py` 池化压测)。

- **产品回退策略的「回拨 churn」(2026-10-14 登记,待定;非 bug,是策略裁断)**:
  **事实**:`retry.fallbackRevertPolicy` 默认 `cooldown-expiry`,`TurnRecovery#maybeRestoreRetryFallbackPrimary`
  (`packages/coding-agent/src/session/turn-recovery.ts:2388`)在自动重试的 continue 头部
  (`src/session/agent-session.ts:5265`)把这次重试**拨回刚被限流的主模型**;当 provider 给的 `retry-after-ms` 很短时,
  重试会立刻打回主模型(时钟探针:活时钟 1/5/25ms → `[primary, primary]`,50/100/200/1000ms → `[primary, fallback]`)。
  **范围**:裁断是否给回拨设**下限阈值**(如窗口 < 1s 时跳过回拨、直接继续用 fallback),或维持现状并在文档写明。
  **量级**:低——1 PR(策略 + 1 条 `docs/` 说明 + 覆盖既有 `test/agent-session-retry-fallback.test.ts` 一个用例)。
  **为什么待定**:属**既定策略**,非本次 flake 的成因(#187 未触碰),且放宽/收紧回拨会影响额度耗尽时的失败面,需用户裁断。
  **开工前先定**:阈值取值与「窗口极短时优先用 fallback 而非主模型」是否符合产品意图(与我们默认 YOLO、不新增审批层的姿态一致)。
  **取证**:`pr://187` 根因 2(含逐档阈值与 `model_change`/`isSelectorSuppressed()` 时间线探针)。

- **双向 subagent relay / `zeta-relay`（2026-10-30 用户裁决；暂不开发）**:只登记方向，不排期。
  形态是**对端进程 + 主会话**，不是 DSH `ctx.subagents` 的 child，也不走 `dsh-subagent-acp`：
  一边在指定 cwd 拉起/接入另一边的 ACP 主会话，两边对称；对端自己的子代理仍留在对端，不承诺
  跨 harness 可见。计划两个 adapter（DSH 侧 relay 工具、Zeta 侧 DSH 工具），P0 本地 spawn，
  P1 attach/listen；`workspace` 一次一个 cwd，多仓库由多个 peer session 或 relay hub 串行/并行
  联系，不改造 DSH ACP 的 one-primary-workspace。**不做**新用户模式、不做 TUI 后端、不并入 IM；
  PTC 由 agent 自己选 `eval` 聚合，relay 只暴露普通工具。

- **超级代理（super agent）自建运行时（2026-11-01 用户裁决；短时暂挂，不排期）**:口径改为
  **跟随标准框架，不自建内核**。事实：OMP 官方路线图 #12413 写的是 "Not the goal: a separate
  'context operating system' … or a second scheduler beside `task` / `agent()` / `completion()` /
  `wait()` / `workpool()` / eval"（v6 条目 "no second scheduler"，v7 "production machinery maybe
  never"），swarm 扩展 2026-08-05 整包删除且 #7895 至今无维护者答复，编排投入全在 `src/task/`
  （近 30 天 100 commit）与 per-call 模型（v18.14.2 #12229）——**上游只拒绝「核心里的第二条调度器」，
  不拒绝这项能力本身**，所以挂起只是等标准，不是永封。
  DeepSeek Harness（DSH，`deepseek-ai/deepseek-harness`）是插件优先框架（Cordis，
  "everything is a plugin"），带 **ACP v1 stdio profile**（`dsh --profile acp`，无私有方法/能力/
  `_meta`）与实验性 **Agent Teams**（`ctx.agentTeams`：durable roster、共享 task DAG
  (`blockedBy`/`writeScopes`/`revision` CAS)、inbox 消息、`interrupt`、`waitForChange`）——若它成为
  标准，直接接，不另立方言。
  **恢复时唯一被接受的形态**：①**官方插件**（`plugins/official/`，层① 工具/命令 + 层② 声明式面板），
  不新增核心运行时；②IDE 侧只加一条 ACP connection（`AcpConfig{command,args,env,flavor:Generic}` 已能
  驱动任意 ACP 代理；`is_cli_provider` 现只认 `claude_code`/`codex`/`gemini_cli`/`zeta`/`zetacode`，
  加 `dsh` 是枚举级改动）；③编排一律落在既有 `task`/`agent()`/`workpool()`/`wait()` 上——**不写第二条
  调度器、不加新会话字段、不加新协议**。破坏面预算：`packages/coding-agent` 运行时不改，只增插件目录 +
  清单 + 文档。
  **与 `zeta-relay`（2026-10-30）同一条线**：relay 解决「两个 harness 互为主会话」，本项解决「谁当
  超级代理」；两者都走对端进程 + ACP，不合并成第三个运行时。

- **内核可换（kernel ABI）· 上游原版 Pi 跑通 · 味觉并入记忆（2026-11-01 用户裁决；只登记方向，不排期）**:
  四件事一并登记，口径如下。
  ① **跑通上游原版 Pi**：我们的内核是 `pi-core`，但是**上游 OMP 改过的 pi**；要能让外层 harness
  跑在**最原始的上游 Pi**（未改）上，"跑一次 harness" 属要做的事。**形态不是 ACP**——是 in-process
  的 **kernel ABI**，形状对齐 `@linxiraos/pi-agent-core` 的 `Agent`/`agentLoop`
  （`(systemPrompt, tools[], messages[]) → AsyncIterable<AgentEvent>`）；ACP 是"进程 + 协议"对等，
  与本项不同层（见 `zeta-relay`、超级代理两条）。**现状**：`@linxiraos/pi-agent-core` 被
  `packages/coding-agent/src` 直接 import **264 处 / 235 文件**、无 facade（唯二转发在
  `extensibility/legacy-pi-coding-agent-shim.ts`、`tools/approval.ts`）——换内核＝先做依赖倒置，
  这是最大工程量；Rust IDE 侧已有 `trait Backend`/`BackendFactory` 接缝，TS 侧没有。
  ② **Codex / Claude Code**：会考虑，**慢慢整**（不排期）。可编程面：Claude =
  `@anthropic-ai/claude-agent-sdk`（`query()` + hooks + 进程内 MCP 工具，库级）；Codex =
  `codex app-server` JSON-RPC（进程级，工具归 Codex）。
  ③ **Command Code**：**研究中**（闭源，对外只有 `cmd acp`）。
  ④ **味觉算法并入记忆**：可能把 Command Code 的 **taste 算法**与我们的记忆叠加——我们本身已加
  **tracking**（见 `packages/coding-agent/src/prompts/tools/tracking.md` 与文首 Shipped 的
  Long-term tracking documents 行）。**关键事实**：我们
  现有记忆工程（`packages/coding-agent/src/sharpshooter/` → 项目决策
  `architecture.md`/`product.md`/`style.md`，存 `<agentDir>/memories/sharpshooter/<bank>/`；
  `@linxiraos/pi-mnemopi` SQLite recall）与 tracking **都靠模型自觉性**（LLM 抽取/写入），
  **没有独立决策模型**；Command Code 的 taste 是 **`taste-1` 神经符号分类器**（固定类别集 +
  0~1 校准置信 + meta RL 重打分 + 符号层矛盾检测，不生成文本）。**用户既有实践**走**余弦相似度**
  （embedding 检索/聚类）路线。研究明白后再加进来。
  **为什么暂不排期**：与「超级代理（2026-11-01）」条「跟随标准框架、不自建内核、不写第二条调度器」
  存在口径张力（本项要走 kernel ABI，需先改那条裁决）；235 文件倒置也会与在飞 PR 冲突。
  **开工前先定**：① 内核 ABI 边界是否等于 `agentLoop` 事件流；② 工具执行权归属（外来内核是否交出
  tool 执行）；③ 先跑通 vanilla Pi 还是先抽象接口；④ taste：自建 vs 借算法、与 sharpshooter/tracking
  的边界、是否引入"分类器 + 校准"而非仅 embedding 检索。
  **取证**：`https://commandcode.ai/docs/taste`、`https://commandcode.ai/docs/acp`；本地
  `packages/coding-agent/src/prompts/memories/sharpshooter-{extract,consolidate}-system.md`。

## Notes

- Everything here must land as Zeta-branded overlay/brand commits after
  release merges, never inside the sync tree.
- `document/upstream-sync.md` records the release-baseline ledger; this document
  is the product-side counterpart.
- Re-check upstream for competing roadmaps before each priority starts.
- **2026-11-05 审计记录（删掉的条目及其理由；roadmap 只留未建计划）**：
  - **被新裁决取代**：2026-10-15/16「`zetawork` 是唯一桌面应用」两段裁决整段删除 —— 由 2026-11-05
    渲染器裁决取代（zetawork / desktop 暂挂，渲染器 `web-app/`，`packages/coding-agent/src/server/studio-web-app.ts`）。
  - **已交付/已解决（删除；已有 Shipped 行的标了 Shipped）**：跨工作区多主代理消息（Agent mesh，`packages/coding-agent/src/mesh/`，
    见 Shipped 行）、long-term tracking 缓存契约（`packages/coding-agent/src/prompts/tools/tracking.md`
    的 Cache ordering / Sanctioned delivery path 段；原文已明示"no enforcement point"，这是设计而非缺口）、
    模型侧崩溃度统计（`packages/stats/src/model-side.ts`）、`tea` 二期（`tools/tea-issue-pr.ts`）、
    teamagent 修正（`plugins/official/pi-messenger/teamagent-command.ts` + 测试）、rail 拖拽
    （`@dnd-kit` 已接线 `web-ui/components/sidebar/SidebarProjectsList.tsx`）、
    Node 清理项 P3（`packages/omptype/package.json` 的 `engines` 只剩 `bun`；`run-ci.sh` 已无 `node -e`）、
    右栏 HTML 插件宿主（`packages/coding-agent/src/extensibility/plugins/panels.ts:178` 的 `html` 面板 +
    GUI `plugin_panels.rs`）、TTT About branding 与 TTT 小工具（vendored TTT 编辑器 2026-10-16 退场，
    包名 2026-10-17 由 termide 的编辑器入口接手，见 `editor/npm/`；PDF Viewer 已交付，见 Shipped）、
    许可分层（已定稿：`LICENSE` 分层声明、`README.md:386`、
    `scripts/check-license-map.ts`；整仓 AGPL 需先替换 `crates/pi-natives` 的 CDDL `inferno`）。
  - **裁定不做**：Reasonix 12 片（2026-10-30 用户裁决）；面板集里的 Notebook / Stencil Git 图 /
    Vim-Emacs 兼容层 / Docker Manager / Go Test Runner；Node 残留 P0（web-ui 的 Next Bun adapter）
    与 P1 的 desktop Node staging —— `web-ui/` 冻结、渲染器换成 `web-app/`、`desktop/` 暂停，前提消失。
  - **宿主消失**：会话多标签 C 片（`web-ui/` 冻结，`web-app/src/studio` 里没有标签实现）。
