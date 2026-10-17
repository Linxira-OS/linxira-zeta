# Zeta Development Roadmap

> **执行计划状态（2026-10-16 更新）**：原「UI 迁移 / 桌面交接」执行计划
> （`webui-desktop-overhaul-plan.md`，2026-10-02 起）**已被 2026-10-16 的裁决取代并关闭**，
> 其唯一未完项（跨端来源标记）已收编进下文的 Web workbench 条目。GUI 开发启动时，
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

These exist today (headline capabilities are marked in the root `README.md`):

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
| Remote token auth + LAN exposure               | `src/server/web-gateway.ts` (`authorizedForAccess`)                         | Non-loopback bind via `ZETA_SERVE_HOSTNAME` + `remote.token` (Bearer / `X-Zeta-Token` on every `/api/*`), CSRF origin guard, `docs/remote-workspaces.md` |
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

## Priorities

### P0 — 桌面形态定稿：`zetawork` 是唯一桌面应用（2026-10-15 裁决，2026-10-16 修订）

**2026-10-16 生效裁决（当前口径；与本节其余段落冲突时以此为准）**：

- **`web-ui/` 保留、不删、降级**：职责只剩两件 —— ① **服务端**：`zetacode serve` 的 `/api/*`，
  供**浏览器远程连接**（已有降级页面，保持能用即可）；② **插件接口**。**不再做后续复杂维护**，
  也不再承担"产品第二界面"的职责。
- **"渲染方式由用户选"作废**：不再做"在 GUI 里选终端渲染 / 选 Web UI 渲染"的开关
  （一开始即裁决不做，现彻底放弃）。
- **GUI 渲染路线 A（先行）**：GUI 用**虚拟终端**承载 TUI（pty + VT 渲染）；`zetacode`（TS TUI）与
  `zetawork` 自己的 ratatui TUI **都只当面板内容**。zetawork 侧沿用已验证的
  `ratatui Buffer → blit → egui`（`main/crates/zetawork-gui/src/tui_view.rs` 已把每行 cell 范围
  变成点击区）。结构化通道（原生控件 / 浏览器渲染）**后置，不属于当前需求**。
- **新 GUI 按用户给的 HTML 稿做**：`Downloads/index.html` 与 `Downloads/workspace-v2.html`
  （仓库内副本 `temp/zetawork-ui-mock/`；证据归档 `~/.zeta/parked-evidence/2026-10-16/`）。
  **两份各有侧重，按各自侧重开发**：
  `index.html` → **信息面**（右栏四页·含上下文页、设置与用量两个模态、状态栏信息）；
  `workspace-v2.html` → **工作区组织**（项目→工作区→大标签页→面板的增删改与切换、TUI 形态）。
  共同基底：系统标题栏 + 应用菜单栏 + 左中右三栏 + 状态栏。实现语言是 **Rust 原生 GUI
  （`main/crates/zetawork-gui`，egui/eframe）**；HTML 只作设计参照，**不得实现成 web 前端**。
- **术语与层级（用户口径）**：**项目 → 工作区**，且 **工作区 = 一个大标签页**；`工作区 1-1`
  读作「项目一 · 第一个大标签页」；每个大标签页下若干**子页面 / 面板**；第一个大标签页 = **总面板**
  （所有项目合并一张表）。
- **右栏要接 HTML 插件宿主**；但**插件目前只登记进本文档，不暴露、不开发**（见 Deferred Queue）。
- **TUI 只保基本功能**：不再加需求，减法为主；后续投入全在 GUI。
- **内置编辑器要"像专业编辑器"，但不要代码补全**（能力缺口审计后逐项登记）。

**2026-10-15 裁决（保留为历史记录；与上面冲突处以 2026-10-16 为准）**：

**当时的裁决内容**：

- **`web-ui/` 冻结**：开发到此为止，**不再作为独立桌面应用分发**；只保留为 zetawork 桌面应用
  内部**可选的渲染后端**。理由（用户原话指向的两个现场报错）：
  `The Zeta service did not become ready in time.` 与
  `The running Zeta service at http://127.0.0.1:30141 did not answer.` —— Electron 外壳要先 spawn
  `zetacode serve` 再轮询端口就绪，这条链长期不稳，桌面维护成本高。
- **桌面应用本体 = zetawork**，开发位置整体迁到 `desktop/`（现有 Electron 外壳退役）。
- **启动形态**：启动后**保底有一个 `zetacode` 进程**（由工作台自己拉起/内嵌），**不依赖外部服务
  端口就绪** —— 上面那两类错误从形态上消失。
- ~~**渲染方式由用户选**：同一个 zetawork 里可选**原生渲染（ratatui）**或 **Web UI 渲染**；于是
  "单独维护的只剩 web-ui 的包"，维护面显著变小。~~
  **（2026-10-16 作废：不做渲染切换开关；渲染形态由上面的「路线 A」定死。）**
- ~~**编辑器分工**（`@linxiraos/editor` 不能浪费）：工作台内嵌编辑器 = termide `panel-editor`
  （进程内 Panel，LSP/tree-sitter/git 全套）；**`@linxiraos/editor`（vendored TTT，Go）
  改作"外部编辑器"**分发——`$EDITOR`/`$VISUAL`（git commit/rebase todo/credential）、大文件与
  最小环境兜底、平台编辑器二进制 `+N file` 交接（它没有独立命令名，按平台二进制路径解析）。
  **随之要改的是指令注册**：`editor` 斜杠命令
  的语义需从"打开工作台编辑器"改为"交给外部编辑器"，与工作台内 termide 面板区分开。~~
  **2026-10-16 修订**：`@linxiraos/editor`（vendored TTT）按**退场**裁决处理
  （YML 文件只改不删、发布包替换干净）——`editor/` 整包已删除，`zeta-editor-*` 资产名与
  `editor_tests` 一并退场；工作台内嵌编辑器仍是 termide `panel-editor`（专业化、无代码补全）。
  **2026-10-17 接续（已执行）**：包名与发布链**由内置编辑器接手**——`editor/npm/`
  重建为 launcher（无 bin）+ 两个平台叶，载荷是 vendored termide 新增的**编辑器专用入口**
  `termide-editor`（只起编辑器面板、`$EDITOR` 语义、位置参数 `FILE[:line[:col]]`，
  `--editor` 链/`editor-publish.yml`/`release_editor_packages` 全部改回实发），
  pi-messenger 的 `/editor` 改用它并经命令行传目标，`~/.zeta/handoff.json` 契约退场；
  用户可见命令面不变（`@linxiraos/editor` 仍无 bin）。
- **路径链接复用原生逻辑**（同批裁决）：终端输出里"任何标准路径/URL → 悬停可点"不自己造；OSC8
  消费端已通（`termide` `hyperlink.rs` → `OpenPath` → `app.rs` `open_path_in_ide`），要找的是现成的
  普通路径/URL 识别并接到 Rust 侧。修饰键语义照参照实现：点击=动作菜单 · Ctrl+点击=切工作区 ·
  Shift+Ctrl+点击=打开文件夹。

**待开工（2026-10-16 修订）**：①Electron 外壳退役 + `desktop/` 改作 zetawork 的家（连带发布面：
`desktop_linux`/`desktop_windows` job、`zeta-desktop-*` 资产、`@linxiraos/zeta-web` 的桌面用途）；
②**GUI 按 HTML 稿重做**（见新增的 P0 条目）；③详情栏 4 页（文件 / Agents 历史对话 / 分支·PR /
用量）+ 范围切换（工作区·项目·全部）+ 点会话切工作区（左栏没有就新建）；④路径链接（普通路径识别 +
修饰键）与发射端 `packages/tui/src/render/hyperlink.ts` 的 line/col 修复。
~~②渲染切换接线~~（2026-10-16 作废）；~~⑤外部编辑器化的指令注册改造 + 打包分发~~（同日由退场裁决取代，2026-10-17 以「内置编辑器接手该包名」重开并已执行：见上）。

### P0 — GUI 按 HTML 稿重做（`main/crates/zetawork-gui`）

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
Go）、cheat-sheet/http-client 类玩具。**PDF** 仅 GUI 可选后置（TUI 永不渲染；默认用系统浏览器）。

参考物：`temp/ttt`（TTT 上游原版，`github.com/eugenioenko/ttt`）的形态与
`community-plugins.json`（45 条 = 24 `lsp-*` + 7 `formatter-*` + 14 功能插件）。

### P0 - Web workbench foundation and desktop handoff

The delivery-order items have landed: Web UI typecheck plus desktop/Web CI
restored (item 1), project grouping and concurrent-session status preserved
through the visual recomposition (item 2), the desktop file-manager/editor
bridge (item 3), AppImage packaging + Linux CI artifact validation (item 5),
and the workbench visual recomposition (item 6 — see Shipped). These landed on
the locked design/typography/port-boundary contracts; the full spec lived in the
now-deleted `document/webui-desktop-overhaul-plan.md` §14. One item remains open:

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

1. **Exposure hardening**: a `--host` flag on `zetacode serve` (today env-only);
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

### ~~P2 — TTT editor About branding~~ (RETIRED 2026-10-16: the editor is gone)

**Retired.** The vendored TTT editor (`editor/`, shipped as `@linxiraos/editor`)
was removed wholesale on 2026-10-16 by maintainer ruling, so this whole item —
zh UI (shipped) and the remaining About-branding work — has no target left.
The `@linxiraos/editor` package name came back on 2026-10-17 carrying the
zetawork built-in editor's payload (termide's editor-only entry, resolved by
path, no `bin`), so if that payload ever grows its own About dialog, the
`Zeta Editor · v<zeta version> · <upstream version>` identity line below is the
carried-over requirement.

- ~~**zh UI**~~ DONE (before retirement): `editor/internal/app/i18n.go` carried a full zh
  string table (settings tabs/labels, menus, footer actions, dialog
  chrome); the settings view exposes an English/中文（简体） selector.
- ~~**About branding (remaining)**~~: upstream attribution was already cleaned —
  Source pointed at `github.com/Linxira-OS/linxira-zeta` and the upstream
  website line is gone (VENDOR.md). Still upstream-flavored: the dialog
  title remained "About TTT Editor" and the version line showed TTT's own
  semver. The planned work (a Zeta distribution identity line
  `Zeta Editor · v<zeta version> · TTT <upstream version>`,
  Chinese-first copy) is void with the tree.

### Deferred — TTT 形态的兼容层与小工具（2026-10-17 调查结论）

- **Vim / Emacs 兼容层**（TTT `vim`/`emacs`）：独立工程，人群小；需要时再做。
- **Docker Manager**（容器/镜像/卷）：重、与 coding agent 工作流无直接关系。
- **Go Test Runner**：我们不写 Go（TTT 已退场），不做。
- **PDF Viewer**：仅 GUI 语义可行（TUI 无法有意义渲染）；默认交给系统浏览器，可选后置。
- **cheat-sheet / http-client**：玩具型，不做。

## Deferred Queue(未开发的后期规划;开发启动时移入执行计划)

- **OpenDesigner 官方兼容(2026-10-15 用户登记,后期)**:用户考虑把
  [`nexu-io/open-design`](https://github.com/nexu-io/open-design)(中文说明见其
  `docs/i18n/README.zh-CN.md`)**迁进 zetawork 的设置面**,目标是**后期加入
  OpenDesigner 的官方兼容**,用来提升设计能力。**本轮只登记,不开工**。动手前
  必须先定三件事:①"兼容"的确切含义——读它的设计文件格式 / 调它的 CLI /
  内嵌它的界面,三者成本差一个量级;②**家在哪**:zetawork 的原生 rust GUI
  设置页(设置页归 zetawork 自己,见 roadmap 的 P2 设置面条款),还是它自己的
  一页;③**许可与分发边界**:它是独立上游,许可证须单独核,**不得把 copyleft
  链进我们的 MIT 发布面**(同 R19 里 Zed 编辑器 crate 的裁决口径)。

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

- **P2「按 DeepSeek Reasonix 补齐复杂控件」12 片(2026-10-13 用户裁决;分叉 F1–F5 已决,本队列逐片登记)**:范围 =
  纯前端(`web-ui/**` + `desktop/**`)补齐 Reasonix 交互复杂度最高的控件,**12 个互不阻塞的独立 PR**,零网关/DTO 契约改动。
  **分叉已决**:`F1` 只做前端(解禁 `packages/**` 的四类后端控件另列,见本队列后两条);`F2` 引入会话多标签(不塞进本批,
  另立计划,见下条);`F3` 终端留在右 dock(不做底部抽屉);`F4` 保留 textarea(不移植 contentEditable atom,chip 化放上下文行);
  `F5` 独立 AskCard(须依赖 ask 通道 → 见本队列第三条,本批只做 `S6` 的 DecisionShelf 子集)。
  **逐片一句话**:①`S1` 覆盖层三件套 `AnchoredPopover`/`ContextMenu`/`Tooltip` + 纯定位数学(唯一共享弹出层,替掉
  `DraftContextBar`/`ChatInput`/`AppShell` 的手写定位);②`S2` slash 参数补全(ArgMenu:`model`/`skill`/`plugin`/`session`
  等二级取值,复用既有零引用孤儿 `lib/models-cache.ts`)+ @/slash 菜单虚拟化(已存 `@tanstack/react-virtual`);
  ③`S3` 输入面手感:粘贴折块(≥12 行或 ≥1200 字)、附件 SHA-256 去重、输入框右键菜单、`Alt+↑/↓` 键盘调高并随草稿持久化;
  ④`S4` 草稿跨刷新(`localStorage` `zeta-web:draft:<key>` + LRU)+ 跨会话提示历史(↑/↓ 磁带,源=会话 JSONL,上限 50 会话);
  ⑤`S5` 转写选区浮动菜单(Copy/加入对话)+ composer 上下文 chip(附件/工作区/会话引用/选中文本);⑥`S6` TodoPanel
  (composer 上方常驻任务清单:done/total、当前任务、按批次持久化折叠、全完成自动折叠;后端 `GET /api/agent/<id>` 的
  `todos` 已就绪)+ 最小 `DecisionShelf` 子集;⑦`S7` 工具调用分组/只读批次折叠 + 折叠态按会话持久化(`tool-buckets.ts`
  在 `ChatWindow` 轮次构建期批处理,不下沉 `MessageView`);⑧`S8` 转写虚拟化(hot/warm/cold 三层窗口替换 `visibleCount`
  分页,流式期间历史不重建 —— 本批最高风险片,旧路径留 flag 回退);⑨`S9` 底部状态栏(模型/工作区/分支/缓存命中%/
  tokens/成本/轮次/上下文%,项可勾选排序,设置页新增分区);⑩`S10` 终端多会话 rail(≤4 活,复用已有
  list/create/delete 路由)+ 终端输出「加入对话」插入 composer;⑪`S11` 代码查看器搜索(大文件 >400 行切 CodeMirror 6
  只读视图,包已在 `package.json` 且全库零 import,不新增依赖;字面量+正则搜索、命中计数、行号);⑫`S12` Markdown/数学加固
  (货币不误判、LLM LaTeX 修复、复制回原始 TeX、Young 图)+ Mermaid 串行队列·`svg-sanitize` 消毒·pan/zoom。
  **量级**:**约 30–45 agent-日 [推断]**(单列 `S8` 约 5–10;其余各 1–5)。**为什么推迟**:1.2.1 只带已合内容;
  且 `S1`/`S9`/`S10` 触碰 `AppShell.tsx`、`panel-registry.tsx`(被 P1 `feat/desktop-ui-p1-stats-branch` 占用),
  `S8` 须与窗口滚动修复串行,**必须等 P1 合入 main 后 rebase,不并行**。**开工前先定**:①P1(stats/branches)与滚动修复的
  合并窗口(硬串行前置);②整批按依赖图开工(`S1 → S2/S3/S4/S5`、`S7 → S8`,其余独立)还是先做 `S1` 共享件;
  ③每片的真实浏览器证据目录与验收形态(用户硬性要求,已写死在计划 §3)。
  **取证(本地,`temp/` 不随仓库发布)**:`temp/.omp-tmp/reasonix-controls-plan.md`(含逐片范围/验收/依赖图/F1–F5)。

- **会话多标签 B/C 两片(2026-10-13 用户裁决;A 已合 PR #168,B/C 待做)**:范围 = 在已合并的 PR A(标签骨架:纯模型
  `lib/session-tabs.ts` + `SessionTabBar` + 切换/新建/关闭 + 保活 + 单活动 SSE)之上补齐两片。**B(持久化+恢复+徽章+关闭族)**:
  刷新后标签/顺序/活动项恢复(`zeta-web:session-tabs-v1` + 编解码/校验/淘汰,冷标签零请求)、后台运行徽章(只吃已消费信号)、
  右键「关闭其他/关闭右侧」、上限淘汰(**12**,LRU 且**不中止**运行)、draft 标签关闭确认。**C(DnD+快捷键+收口)**:HTML5 DnD
  重排持久化、`Alt+1..9` 与桌面壳 `Ctrl+W`、活动标签自动滚入可视区、roving tabindex/ARIA 达标、订正 `web-ui/AGENTS.md`
  File Map。**另列(不在 B/C)**:审批徽章接线(`extension_ui_request` → 「等待审批」)依赖 **ask 通道**(见本队列第三条),
  且会改变既有交互行为,须独立立项与独立证据(计划分叉点 4 的推荐 = 不做,仅记录降级)。**量级**:B/C 各 1 PR,
  **约 4–8 agent-日 [推断]**;**为什么推迟**:1.2.1 只带已合内容;`B` 依赖已合的 A,`C` 依赖 B,审批徽章依赖 ask 通道。
  **开工前先定**:①上限 **12** 与「失活但运行中保留 ≤2 条流」的默认值(计划分叉点 1/2 的推荐值,需确认);
  ②「关闭标签不中止运行」(默认)与菜单项「关闭并中止运行」是否同批;③是否顺带接线 `extension_ui_request`(推荐:本批不做)。
  **取证(本地)**:`temp/.omp-tmp/session-tabs-plan.md`(含 B/C 逐条范围文件、可观察验收、风险与回滚)。

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

- **Node 残留清点后续:web-ui 生产产物改用 Next 官方 Bun adapter(P0;2026-10-13 用户裁决:此项入队待排,P2 另行先做)**:
  范围 = 把 `web-ui/` 的生产产物从 **Node 目标**的 `.next/standalone`(`web-ui/next.config.ts:17` `output: "standalone"`)
  换成 Next 官方 **Bun adapter**(`nextjs/adapter-bun`,产出 `bun-dist/` + Bun 启动的 `server.js`),并把
  `packages/coding-agent/src/commands/web-ui-launcher.ts:20` 的 `ZETA_WEB_RUNTIME || "node"` 默认改为 `bun`
  (保留 `ZETA_WEB_RUNTIME=node` 逃生阀)。这是唯一"web 面脱离 Node、并解锁删除 desktop 内置 Node"的实质大改。
  **量级**:**中高**——1 个构建+运行时改造 PR + 原生依赖矩阵逐个体测,**约 5–15 agent-日 [推断]**。
  **为什么推迟**:1.2.1 只带已合内容;且它本质是"换产物形态",风险集中在 `web-ui/next.config.ts:28-38` 的
  `serverExternalPackages`(`better-sqlite3`/`undici`/`fastembed`/`onnxruntime-node`/`tar`/`@anush008/tokenizers*`)——
  Node-API 原生模块在 Bun 上是否可用**必须实测**(`better-sqlite3` 在 Bun 侧最稳的替代是 `bun:sqlite`,但 API 不同需改代码)。
  **开工前先定**:**原生依赖矩阵逐个体测的清单与通过标准**(每个模块:能否在 Bun 下加载 / 关键路径冒烟 / 失败是否阻塞发布);
  另需定 `bun --bun next start` 与 adapter `bun-dist/` 两条路径的取舍口径——Next 官方自 v16.4.0 起把 Bun 列为
  **Verified Adapter**,但我们今天打包的是 **Node 目标产物**,**不在其承诺面内**(把 Node 产物塞给 `bun` 跑 ≠ 官方支持)。
  **取证(本地,`temp/` 不随仓库发布)**:`temp/.omp-tmp/node-residency-report.md` §1.3(a)、§3 第 1/10 条、§4.1、§5.1(两条 P0)。

- **Node 残留清点后续:删 desktop 内置 Node staging + npm 启动器/安装文档成对改(P1;依赖上一条 P0)**:
  范围 = ①删 desktop 打包期的内置 Node staging——`desktop/scripts/prepare-runtime.mjs:53`
  (`fs.copyFileSync(process.execPath, stagedNode)`)、`desktop/scripts/platform.mjs:12`(`nodeBinaryName`)、
  `desktop/src/main.ts:66` 的 `WEB_RUNTIME_NAME`(及其 `webRuntimeName` 契约面:`desktop/src/serve-resolution.ts:59,123,141`、
  `desktop/src/tool-resolution.ts:44`);②把 2 个 npm 启动器(`main/npm/main/bin/zeta.js`、`termide/npm/ide/bin/zeta-ide.js`)的 shebang 从 `#!/usr/bin/env node` 改为 `bun`、`engines` 声明改为
  `{"bun": ">=1.3.14"}`,**并同步把安装文档改为 `bun install -g`**(`README.md:33` 的 "Node 18+ or Bun"、
  `docs/user-guide.md:14-18`、`docs/user-guide.zh-CN.md:13`)。**量级**:低——2 个 PR,**约 1–3 agent-日 [推断]**。
  **为什么推迟**:**依赖 P0**——内置 Node 存在的唯一理由是托管 Next standalone 的 `server.js`(Node 目标产物),
  P0 不落地就删不掉;且**启动器 shebang 与安装文档必须成对改**:npm 生成的 Windows `.cmd` shim **硬编码 `node`**
  (本仓实物证据:`web-ui/node_modules/.bin/next.cmd` 里 `SET "_prog=node"`;`desktop/node_modules/.bin/electron-builder.cmd` 同理),
  只改 shebang 而安装方式仍是 `npm i -g` 就是**假迁移**(Windows 上 `npm i -g @linxiraos/zeta` → `zetacode` 会用系统 Node
  跑 Bun 目标 bundle,因 `Bun.semver` 未定义而抛错)。**开工前先定**:①删 staging 后"目标机无需 Node"改由 Bun 承担的口径,
  以及 `desktop/README.md`、`AGENTS.md`、desktop smoke 断言的同步改动清单;②`bun install -g` 在
  Windows/macOS/Linux 三端生成 shim 的行为确认(不再是 `.cmd`/`node`,而是 `.exe`/`bunx` 侧)。**取证(本地)**:
  `temp/.omp-tmp/node-residency-report.md` §1.3(b)、§2.1、§2.2、§3 第 2/4/5 条、§4.2、§5.1(两条 P1)。
  （行号说明:报告写作 `main.ts:59-60`、`README.md:36`、`run-ci.sh:178`,登记时已漂移;上列为登记时的 main 实测行号。）

- **Node 残留清点后续:清理项(P3;2026-10-13 登记)**:
  范围 = ①`packages/omptype/package.json:43-46` 删 `engines.node`(只保留 `bun`;它是唯一同时声明 node 的工作区包);
  ②`scripts/install-tests/run-ci.sh:185` 的 `node -e "..."`(写 `pkg.overrides`)换成 `bun -e`。**量级**:极低——1 PR,
  **约 0.5 agent-日 [推断]**。**为什么推迟**:纯一致性清理,无收益无风险,排在 P0/P1 之后。**开工前先定**:无实质分叉,
  仅需在 CI 环境确认 `bun -e` 对那段 `require('fs')`/`JSON.parse` 脚本的等价性。**取证(本地)**:
  `temp/.omp-tmp/node-residency-report.md` §2.2、§2.3、§3 第 13/14 条、§5.1(P3 行)。

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
  状态 = P2 三项(`napi10` 降到实际所需的最低 Node-API level、CI 为 Bun 的 natives 加**阻塞性**(而非
  `continue-on-error`)回归、`packages/coding-agent/src/server/web-gateway/npx.ts:29-45` 的 `findNpxCli()` 增加 Bun 分支)
  **已另派、开工中**,不属本队列(此处仅留状态与风险)。**关键风险事实**(须先记牢):我们的 addon 用 **Node-API level 10**
  (`Cargo.toml:338` `napi = { version = "3", features = ["napi10", ...] }`,并自行 vendored napi,见 `Cargo.toml:45`),
  而 napi-rs 官方支持矩阵把 **Bun 标为 "Best effort"**:Bun job `continue-on-error`(失败不阻塞 napi-rs 发布)、
  `napi new` 脚手架**只提供 Node-API level 1–9**、且明确把 "Bugs in an alternate runtime's Node-API implementation"
  排除在 ABI 保证之外;Bun 官方 Node-API 文档**未声明支持的版本号**。这是整份清点里**风险收益比最差**的一处——
  迁移收益为零(已经在 Bun 上),风险是"某次 Bun 升级把深水区 NAPI 语义改坏"。**取证(本地)**:
  `temp/.omp-tmp/node-residency-report.md` §4.3、§5.1(两条 P2)。

- **README 语义修正项(待定;2026-10-13 登记)**:`README.md:33`(报告记作 :36)的 "Install the workspace
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

- **右栏 HTML 插件宿主（2026-10-16 用户裁决；只登记，不暴露、不开发）**:用户口径 —— **右栏要接
  HTML 插件宿主**，但**先把"插件"这件事在路线图里放好，暂不对外暴露**。本轮只登记方向：右栏面板
  需要一个能挂第三方 HTML 页面的宿主，形态二选一 —— **GUI 内嵌 WebView2 面板**（倾向此项：spike
  已证明 WebView2 子窗口在本机可行、GUI 内可缩放），或复用 `zetacode serve` 服务端 + GUI 内浏览器
  视图。插件体系本身已有设计文档（`document/plugin-system.md`、`plugin-storage-spec.md`、
  `plugin-manager-installer-plumbing.md`），本项**只做宿主接线**，不重做那三份设计。

## Notes

- Everything here must land as Zeta-branded overlay/brand commits after
  release merges, never inside the sync tree.
- `document/upstream-sync.md` records the release-baseline ledger; this document
  is the product-side counterpart.
- Re-check upstream for competing roadmaps before each priority starts.
