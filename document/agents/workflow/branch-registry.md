# 分支登记簿（branch registry）

> 目的：任何一条本地分支都能一眼答出「它是干什么的、谁负责、什么时候必须删」。
> 这是唯一的正本；`scripts/check-branch-registry.ts` 在本地门禁里校验它
> （不在 CI 跑：CI 没有本地分支）。新增分支却不登记，本地门禁直接红。

## 规则

1. **登记才算存在**：`git branch` 里有的分支必须在下面两张表之一出现，否则门禁失败。
2. **命名即生命周期**：

   | 前缀 | 用途 | 生命周期 |
   |---|---|---|
   | `feat/*`、`fix/*`、`chore/*` | 单个改动 | 合入 `main` 后删 |
   | `sync/omp-release/*` | 上游 tag 真 merge | 合入 `main` 后删（台账记 SHA） |
   | `port/*` | Pi / Pi Web 语义移植 | 移植完成并合入后删 |
   | `backup/*` | 冻结快照（保护点） | 事后确认可弃即删；删前把 SHA 记进下表 |
   | `dev/*` | **只能用户开**的实验 | 用户自己决定；agent 不删不并 |
   | `spike/*` | 可行性验证 | 结论落地后删；删前记 SHA |
   | `park/*` | 有意暂存的半成品 | 明确恢复或放弃前保留 |

3. **删除前先登记**：把分支名、SHA、日期、原因写进「已退役」表。恢复：
   `git branch <name> <sha>`（gc 之前一直可用）。
4. **worktree 里的未提交内容不算分支内容**：worktree 脏着就删 = 直接丢数据。
   先 commit（或拷到 `~/.zeta/parked-evidence/<date>/`），再删 worktree。
5. 一轮落地 ≤1 次 push（见根 `AGENTS.md` §7）；本表不改变那条规则。

## 在册分支（2026-11-01）

| 分支 | 类别 | 内容 | 负责人 | 建立 | 何时删 |
|---|---|---|---|---|---|
| `fix/report-automation` | fix | REQ060 roboomp 离线回放/XDG/CLI + REQ022 v18.18.3 台账纠正；worktree `temp/report-automation`（sparse） | agent | 2026-11-11 | 合入 `main` 后删（删前记 SHA） |
| `park/session-fork-diff` | park | 会话 fork 结构差异：`forkDiff(a,b)` 按 entry id 分出 added/removed/changed 与共同祖先；含 `session fork --diff` 接线与 8 个测试。**原 `feat/superagent-runtime`**，2026-11-01 已 commit（`2e542337c1d`） | user | 2026-10-31 | 决定是否把 diff 暴露给 `session fork` 之后再动 |
| `feat/pet-rust` | park | 桌宠 Rust crate（未提交，9 files，`main/crates/zetapet/`） | user | 2026-10-21 | P1 暂缓；保持 park，不动 |
| `feat/pet-packaging` | park | 桌宠 npm 打包（未提交，5 files，`main/npm/pet/`） | user | 2026-10-21 | 同上 |
| `docs/roadmap-audit` | docs | DSH 内核 + TUI/IM 两份 2026-10-31 审计（+24 行，已 commit `faea369a066`） | agent | 2026-10-31 | **等用户提交 `document/roadmap.md` 的改动后**再合（否则工作区脏，git 拒绝合并） |
| `sync/omp-release/v18.15.0` | sync | OMP v18.15.0（`3fedf8d5326`）真 merge，基于 `feat/taste-memory`；56 处冲突按类别 resolve（Zeta 面保留、测试取上游后 `.omp→.zeta`、代码上游语义 + 重放 Zeta-only）；worktree `temp/sync-18.15` | agent | 2026-11-02 | 六阶段门禁与 CI 绿后并入 `main`，删前记 SHA |
| `feat/session-window` | feat | 会话转写窗口：`GET /api/sessions/:id?window&limit&origin`、宿主游标带边界 entryId；worktree `temp/session-window` | agent | 2026-11-06 | 合入 `main` 后删（删前记 SHA） |
| `chore/registry-cleanup` | chore | 退役 `feat/ship-webapp` / `feat/transcript-read` 的登记行；worktree `temp/registry-cleanup` | agent | 2026-11-06 | 下一轮清理时删并登记退役 |
| `feat/taste-layer` | feat | P4 `taste` super-memory 层本体（`packages/coding-agent/src/{taste,tools/super-memory.ts,prompts/taste}`、设置/角色/session 接线、`docs/memory.md` + `docs/tools/super_memory.md` + `docs/models.md`、`test/taste/`）；基于 `sync/omp-release/v18.15.0` 的 `e7d7f7f5776`。worktree `temp/taste-layer` | agent | 2026-11-02 | 并入 `main` 后删（合并前记 SHA） |
| `feat/taste-memory` | feat | P0–P2 上游 host/默认值清理 + `check-no-upstream-defaults` / `check-doc-host-parity` 两个新门禁；随后在此之上做 P4 `taste` super-memory 层（`packages/coding-agent/src/taste/`）。worktree `temp/taste-memory` | agent | 2026-11-02 | P4 落地并入 `main` 后删（合并前记 SHA） |
| `feat/design-bridge` | feat | 工作区级 OpenDesign 桥：`.zeta/design.yml` 开关、`/design` 命令、单个 `design` 工具（托管 MCP + `od` CLI）、安装/daemon/MCP 状态检测；默认关闭，不写全局；worktree `temp/design-bridge` | agent | 2026-11-04 | 合入 `main` 后删（删前记 SHA） |
| `fix/ui-audit-p0` | fix | `document/ui-bugfix-report.md` 的 P0/P1/P2 UI/功能修复：托盘驻留、分栏/页脚、会话删除、modal 交互与浮岛视觉；附带 Git 面板提交全部更改/推送闭环；worktree `temp/ui-audit-fixes` | agent | 2026-11-04 | 修复合入 `main` 后删（删前记 SHA） |
| `backup/pre-studio-ui-2026-11-05` | backup | Studio 迁移前冻结快照，`c1f6c6c6a79789ed99e37c42b14f3648e00fe624`（`v1.4.10` 线）；已推 `origin` | agent | 2026-11-05 | 迁移分支通过全量验证后再删（删前记 SHA） |
| `dev/main-v1830-wip` | dev | v18.3.0 合并 WIP（2026-09-25，已被 v18.14.2 远超） | user | 2026-09-25 | **用户决定**；技术上是死的 |
| `port/studio-conversation` | port | Studio 会话面语义移植（`d2ab1add16f`，未并入 `main`；内容随 `feat/web-ui-studio-migration` 走） | agent | 2026-11-05 | 迁移分支合入 `main` 后删；删前记 SHA |
| `port/studio-sidebar` | port | Studio 侧栏移植 + `port/studio-pages` 合并（`d5ef794bfd7`，未并入 `main`） | agent | 2026-11-05 | 迁移分支合入 `main` 后删；删前记 SHA |
| `temp/release-dispatch` | temp | 临时 release dispatch 工作流实验（`89963b49b81`，未并入 `main`） | unassigned | — | 实验结束即删；删前记 SHA |
| `feat/StaticCompression` | feat | 静态资源构建期预压缩（`.br`/`.gz` 边车）+ `Accept-Encoding` 协商；worktree `temp/StaticCompression` | agent | 2026-11-06 | 合入 `main` 后删（删前记 SHA） |
| `feat/PluginRegistry` | feat | Studio 插件列表改为真实 Zeta 插件注册表 + 启停写对文件 + `ui.panels` 清单；worktree `temp/PluginRegistry` | agent | 2026-11-06 | 合入 `main` 后删（删前记 SHA） |
| `feat/UsageData` | feat | 用量数据：`packages/stats` 的日/时聚合读 API + `GET /api/usage/daily` + `usage.get` 填充 + deep link/`usage.openDashboard`；worktree `temp/UsageData` | agent | 2026-11-06 | 合入 `main` 后删（删前记 SHA） |
| `feat/session-window` | feat | 会话转写窗口分页（已并入 `main` 的 `952b3c0`）；worktree `temp/session-window` | agent | 2026-11-06 | 删分支/worktree 前登记退役 |
| `docs/update-log-1.4.11` | docs | 1.4.11 的 `UPDATE-LOG.md` 条目；worktree `temp/update-log-114` | agent | 2026-11-06 | 合入后删 |
| `fix/board-tool` | fix | 把 `.zeta/board/` 从仅有 API/UI 提升为内置 `board` 工具：共享 store、list/get/create/update/move/assign/delete、项目根绑定、子代理显式 `tools: board` 门禁与测试；worktree `temp/board-tool` | agent | 2026-11-09 | 合入 `main` 后删（删前记 SHA） |
| `perf/tui-subagent-load` | fix | 多子代理 fan-out 下 TUI 响应性：`task` 批次进度更新按 100 ms 合并（leading + trailing，终态立即 flush），消除每 spawn 每 150 ms 的全卡重建/深清洗；含合并正确性与 fan-out 预算测试。worktree `temp/tui-load-perf` | agent | 2026-11-10 | 合入 `main` 后删（删前记 SHA） |

| `feat/team-core` | feat | Team path/DB foundation（第一纵切）：`.zeta/team.json` / `.zeta/pm.json` 解析与上行 resolver、单库 `~/.zeta/data/zeta.db`（teams/team_pms/repos/repo_bindings/engineers/worktrees）、`zetacode team` 的 init/pm/repo/engineer/worktree/doctor（真实 `git worktree add`）；无 UI/房间/graph。worktree `temp/team-core` | agent | 2026-11-09 | 合入 `main` 后删（删前记 SHA） |
| `docs/execution-system` | docs | 需求台账 + 执行契约 + ADR 规范性规则：`document/requirements-ledger.md`（25 条 seeded REQ）、`document/agents/workflow/execution-contract.md`、`scripts/check-requirements-ledger.ts`、`check:adr`/`check:reqs` 接入 `bun check`、`document/release.md` 预打 tag 清单；无产品代码。worktree `temp/execution-system` | agent | 2026-11-11 | 合入 `main` 后删（删前记 SHA） |
| `feat/report-completion` | feat | 报告完成列车集成分支；ledger delta + matrix/owner seams + ADR reservations；不 push/PR，本地小 lane 合入。worktree `temp/report-completion` | agent | 2026-11-11 | 全部小 lane 合入并独立验收后删（删前记 SHA） |
| `feat/active-surface-completion` | feat | A core/Team：Team Hub headless/ACP/IM、`/lead` `/pm` headless、mobile Settings+security gating+单次 2FA verify、SSH probe、metadata、permanent mounted step-up browser regression、1.6.0 readiness gate；ADR-0031/0032。worktree `temp/active-surface-completion`；source commits `5c40b5c27ed` + `befef7c8df6` + `ffab8dcb8ab` + `31e8955f933`；merges `52b7c0c08ab` + `bdcd7026b05` | agent | 2026-11-12 | 合入 `feat/report-completion` 并独立验收后删（删前记 SHA；保留 evidence） |
| `feat/android-cli-completion` | feat | Android Tier1 CLI + IDE walker/robomp runtime boundary；wrapper Gradle 8.9、39 tasks success、11 JUnit 0 fail、signed debug APK；walk post-fix nextest 2/2；IdePage `captures_escape` fix 后 panel-ide 52/52（3 leaky），GNU rebuild RC0 28.84s；inline `OpenGitDiff`/`GitDiffPanel::new_for_commit_file` 组件 smoke 通过，全 App mouse focus/paging 未验。worktree `temp/android-cli-completion`；HEAD `a189d4385b6600fd8a7574059a3413ffb76cf2a5` | android-research | 2026-11-12 | 已本地合入 `feat/active-surface-completion`；device/emulator/release 未验；删前记 SHA |
| `fix/report-studio` | fix | Studio A0–A4：workspace read-model 契约、顶栏/上下文/最近对话/长名/听写门控；独占 App.tsx。worktree `temp/report-studio` | agent | 2026-11-11 | 合入 `feat/report-completion` 后删 |
| `feat/report-team` | feat | Team service：doctor、bootstrap、task queue、room live delivery、read model；不改 Studio/IM/SDK。worktree `temp/report-team` | agent | 2026-11-11 | 合入集成分支后删 |
| `feat/report-im` | feat | IM 多实例/Agent Profile/上下文隔离后端；独占 `server/zeta-server.ts`。worktree `temp/report-im` | agent | 2026-11-11 | 合入集成分支后删 |
| `feat/report-agent-profiles` | feat | SDK/tool profile：真正 per-agent 工具白名单、profile/persona 接线；独占 `sdk.ts`。worktree `temp/report-agent-profiles` | agent | 2026-11-11 | 合入集成分支后删 |
| `fix/report-remote` | fix | 远端 token 注入/#authorize/2FA step-up/pairing/scope/SSH bridge 契约；独占 auth 模块。worktree `temp/report-remote` | agent | 2026-11-11 | 合入集成分支后删 |
| `fix/report-tui` | fix | TUI Windows 9001/IME 帧序/relay/focus/Hub；无上游 merge。worktree 由 worker 建。 | agent | 2026-11-11 | 合入集成分支后删 |
| `fix/report-cd` | fix | `/cd` 根路径/卷挂载缓存/补全/pins/headless；macOS C3 保持排除。worktree 由 worker 建。 | agent | 2026-11-11 | 合入集成分支后删 |
| `feat/report-im-ui` | feat | Studio IM Discord/QQ 凭据、allowlist、多实例 UI；不改 IM 后端。worktree 由 worker 建。 | agent | 2026-11-11 | 合入集成分支后删 |
| `feat/report-commands` | feat | 命令 lane：REQ-052 official command migration + custom command `agent`/model metadata；只源码，不跑大 build。worktree `temp/report-commands` | agent | 2026-11-11 | 合入集成分支后删 |
| `feat/report-context-reload` | feat | Context/prompt hot reload lane：REQ-057；SDK hook 由 tools owner 接。worktree `temp/report-context-reload` | agent | 2026-11-11 | 合入集成分支后删 |
| `fix/report-automation` | fix | Robomp/automation lane：REQ-060 + REQ-022 只读评估、ledger 事实纠正；不 merge/tag upstream。worktree `temp/report-automation` | agent | 2026-11-11 | 合入集成分支后删 |
| `feat/report-ide` | feat | zetaide Git center/inline diff/JSON/TODO：REQ-069；只编辑。worktree `temp/report-ide` | agent | 2026-11-11 | 合入集成分支后删 |
| `feat/report-learning` | feat | Context learning window extraction：REQ-056；与 compaction service hook 协调。worktree `temp/report-learning` | agent | 2026-11-11 | 合入集成分支后删 |
| `feat/report-mcp` | feat | Embedded MCP recognition：REQ-053；SDK/manager 只交 tool-scope hook，不 race 工具白名单。worktree `temp/report-mcp` | agent | 2026-11-11 | 合入集成分支后删 |
| `feat/report-memory` | feat | Memory H3：REQ-061–REQ-065；large-session-perf 试发，dead 由父 recover；REQ-066 仍 desktop owner。worktree `temp/report-memory` | agent | 2026-11-11 | 合入集成分支后删 |

| `docs/maintenance` | docs | 维护/归属/安全协议：`document/maintenance-ownership.md`、README 中英文维护与文档边界章节、`assets/maintenance-map.svg`、`SECURITY.md`/`CONTRIBUTING.md` 路由；仅文档，无代码/测试；worktree `temp/maintenance-docs` | agent | 2026-11-12 | 合入 `main` 后删（删前记 SHA） |
| `chore/release-freeze` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-11 | Preserve; owner review |
| `chore/remove-paused-zetawork` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `chore/report-gov` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-12 | Preserve; owner review |
| `docs/adr-records` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-11 | Preserve; owner review |
| `docs/agent-modes` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `docs/agent-team-peer-messaging` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-08 | Preserve; owner review |
| `docs/channel-metadata` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `docs/im-session-status` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `feat/adr-prd-skills` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `feat/cd-directory-picker` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `feat/default-logo-avatar` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-11 | Preserve; owner review |
| `feat/dev-isolation` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `feat/device-2fa` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `feat/im-adapters` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `feat/im-onboarding-ui` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `feat/logo-04-cluster` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `feat/model-visibility` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-11 | Preserve; owner review |
| `feat/official-html-report-skill` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-11 | Preserve; owner review |
| `feat/omp-cleanup` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-07 | Preserve; owner review |
| `feat/package-linkage` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `feat/pm-skill-control` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `feat/report-android` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-12 | Preserve; owner review |
| `feat/report-compaction` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-12 | Preserve; owner review |
| `feat/report-desktop` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-12 | Preserve; owner review |
| `feat/report-plugins` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-12 | Preserve; owner review |
| `feat/report-provenance` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-12 | Preserve; owner review |
| `feat/report-rooms` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-12 | Preserve; owner review |
| `feat/report-team-studio` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-12 | Preserve; owner review |
| `feat/report-tracking` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-11 | Preserve; owner review |
| `feat/report-voice` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-12 | Preserve; owner review |
| `feat/resume-visibility` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-11 | Preserve; owner review |
| `feat/retire-collab` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-07 | Preserve; owner review |
| `feat/studio-capability-matrix` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-11 | Preserve; owner review |
| `feat/studio-im-settings` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `feat/studio-terminal` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `feat/team-graph` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `feat/team-graph-producer` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `feat/team-hub` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `feat/team-lead` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `feat/team-origin` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `feat/team-rooms` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `feat/team-secretary` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `feat/team-vibe-hardening` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-11 | Preserve; owner review |
| `feat/tern-cleanup` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-07 | Preserve; owner review |
| `fix/acp-identity` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `fix/channels-project-routing` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `fix/channels-security` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-08 | Preserve; owner review |
| `fix/cli-docs` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `fix/cli-help-inventory` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `fix/desktop-sharp` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-08 | Preserve; owner review |
| `fix/desktop-shell` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-08 | Preserve; owner review |
| `fix/desktop-size-audit` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `fix/desktop-titlebar` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-08 | Preserve; owner review |
| `fix/desktop-window-controls` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-11 | Preserve; owner review |
| `fix/export-viewer-metadata` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-07 | Preserve; owner review |
| `fix/im-adapters-ci` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `fix/im-session-origin` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `fix/omp-residue` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-08 | Preserve; owner review |
| `fix/omp-ui-residue` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-11 | Preserve; owner review |
| `fix/package-linkage-151` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `fix/plugin-chain-naming` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `fix/plugin-cutover-proof` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `fix/release-1.4.13-leaves` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `fix/release-notes-desktop-browser` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `fix/report-im-config` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-12 | Preserve; owner review |
| `fix/report-im-fixtures` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-11 | Preserve; owner review |
| `fix/report-models` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-12 | Preserve; owner review |
| `fix/resume-project-separator` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `fix/runtime-diagnostics` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-11 | Preserve; owner review |
| `fix/server-auth` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-08 | Preserve; owner review |
| `fix/session-path-binding` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `fix/stats-i18n` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `fix/studio-fake-surfaces` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-08 | Preserve; owner review |
| `fix/studio-host-ops` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-08 | Preserve; owner review |
| `fix/studio-rpc` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-08 | Preserve; owner review |
| `fix/ui-naming` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-08 | Preserve; owner review |
| `perf/large-session-load` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `perf/mermaid-lazy-chunk` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-11 | Preserve; owner review |
| `perf/plugin-roots-resolution-cache` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `perf/startup-latency` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `rescue/root-20261110` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-10 | Preserve; owner review |
| `sync/omp-release/v18.18.0` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-08 | Preserve; owner review |
| `sync/omp-release/v18.18.1-2` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |
| `sync/omp-release/v18.18.3` | preserved | Present local branch; owner/review intent not reviewed in this metadata-only pass; do not merge/delete without owner | unassigned | 2026-11-09 | Preserve; owner review |

## 已退役（删除前登记）

| 分支 | SHA | 退役日期 | 原因 |
|---|---|---|---|
| `chore/electron-latest-stable` | `625e1d1538ddab34033227e7c87103ffd076c896` | 2026-11-11 | PR #318 已合并；cache-cleanup 确认 `temp/electron-latest` worktree/registration 与本地分支均已删除；不删除远端分支 |
| `feat/compat-cleanup` | `b2aa276c8962bd1bf44924f0cc161de688e6e467` | 2026-11-11 | 已在 `5a2ef25974a` 登记后由 cache-cleanup 删除 `temp/compat-cleanup` worktree 与本地分支；最终 links=0；`.zeta` 工具源码与 `serve.out.log` / `serve.err.log` 保存在 `~/.zeta/parked-evidence/2026-11-11/compat-cleanup/`；不删除远端分支 |
| `feat/release-114` | `07db32f217d783a43c6f2b988075014df0466398` | 2026-11-11 | 已在 `5a2ef25974a` 登记后由 cache-cleanup 删除 `temp/release-114` worktree 与本地分支；最终 links=0；`.zeta` 工具源码与 `prbody.md` 保存在 `~/.zeta/parked-evidence/2026-11-11/release-114/`；不删除远端分支 |
| `chore/retire-jcode-evaluation` | `408b5f91785` | 2026-11-11 | 已合并（`f0f99b296ee`，PR #314）：登记簿退役 `docs/jcode-evaluation` + 一处「未发现≠不存在」措辞收紧；PR CI `42972661696`、main CI `42973476613` 均绿；worktree `temp/jcode-retire` 已删除 |
| `docs/jcode-evaluation` | `b0a4f36fe80` | 2026-11-11 | 已合并（`006484a5818c038b1e50cec706387d36bec1f159`，PR #313）：`document/jcode-evaluation.md` + `roadmap.md` Deferred Queue 登记 + AGENTS §11 索引行；PR CI `42969576865`、main CI `42970403085` 均绿；worktree `temp/jcode-doc` 已删除 |
| `docs/lkb-linkage` | `b2aa267b8a6` | 2026-11-11 | 已合并（`b2aa267b8a68d684d9146611c4b31d4bf0322d43`，PR #309）：LKB 客户端边界 + README 相关仓库链接 + GitHub Packages 不启用结论；PR CI `42960381396`、main CI `42961524864` 均绿；worktree `temp/lkb-linkage` 已删除 |
| `feat/web-ui-studio-migration` | `b197d271a61` | 2026-11-05 | 已合并（`1d2fb36f731`，PR #233）：渲染器切到 `web-app`、Studio 宿主 `/api/v1/*`、命名归一、四项性能成本；CI run `42062805101` 33 job 全绿 |
| `feat/ship-webapp` | `3885645f3ef` | 2026-11-06 | 已合并（`45dd66729e6`，PR #237）：渲染器随包出货、zetawork 资产退役、渲染器类型债清零、滚动布局读修复 |
| `feat/transcript-read` | `1b52e7afddc` | 2026-11-06 | 已合并（`bd0080d4432`，PR #238）：`GET /api/sessions/:id` 按 `(path, mtime, size)` 缓存 |
| `sync/omp-release/v18.16.0` | `88656c15a80`（远端 `2b083affafa`） | 2026-11-04 | OMP `v18.16.0` 真 merge 已合入 `main`；`main` CI `41662377662` 绿，Coverage `41662394241` 成功；worktree `temp/sync-v18.16.0` 已删除 |
| `feat/attach-parity-full` | `fe712038e2e` | 2026-11-01 | 内容已全部在 `main`（`backend/subagent-mirror.ts`、`slash-commands/cleanse.ts`、`loop/continuation-controller.ts` 均存在；24 处冲突逐个解析后与 `main` 的差异只剩文档，已手工迁入）。该分支还提交了 `.bun-cache/bun-linux-x64-baseline-v1.4.3`（88 MB，`.gitignore` 已列却仍被加入），**永不合入** |
| `backup/editor-ttt-1.6.0` | `2fa543c253b` | 2026-11-01 | 旧备份，内容早已并入 |
| `fix/gitea-flow-1` | `19a9f0a4074` | 2026-11-01 | 已合入 `main`（`239318e8581`）：Gitea 本地 CI 自包含 + Bazel 缓存 |
| `test/lock-1.4.7` | `6fa727a7104` | 2026-11-01 | `main` 已是 1.4.7，验证分支失效 |
| `spike/egui-shell` | `e915a2f71f7` | 2026-11-01 | egui 已定型并落地 `zetawork-gui` |
| `spike/gpui-shell` | `e04de51a468` | 2026-11-01 | 同上；gpui 未采用 |
| `backup/post-pr15-merge` | `98e6c438448` | 2026-11-01 | 旧备份（PR #15 时代，2026-09） |
| `backup/pre-sync-v18.1.16` | `36e3af58bbb` | 2026-11-01 | 旧备份（v18.1.16 同步前） |
| `backup/pr-197` | `e00c98f668f` | 2026-11-01 | 旧备份（2026-10-14） |
| `backup/main-2026-10-31` | `c9c13e37318` | 2026-11-01 | 快照，0 commits ahead |
| `sync-full-merge-backup` | `72d39366af6` | 2026-11-01 | 2026-09 v18.2.x 时代的整树备份 |
| `sync/omp-release/v18.2.1` | `509f6b45cb8` | 2026-11-01 | 旧同步分支（v18.2.x） |
| `sync/omp-release/v18.2.3-squash` | `f13753e6d81` | 2026-11-01 | 旧同步分支（被真 merge 策略废弃） |
| `sync/omp-release/18.13` | `e7fe9f1452f` | 2026-11-01 | 已并入 `main`（0 ahead） |
| `sync/omp-release/18.14` | `4d3e2c14c9c` | 2026-11-01 | 已并入 `main`（0 ahead） |
| `lab/merge-repro` | `88aad68d840` | 2026-11-01 | 合并复现实验（2026-09） |
| `build/1.4.7` | `8ebc361a222` | 2026-11-01 | 1.4.7 构建快照，0 ahead |
| `feat/plugin-dist` | `0c4b0698c66` | 2026-11-01 | 已合入 `main`（官方插件默认装、默认关 + 内置目录） |
| `feat/ide-links` | `7023ad9db67` | 2026-11-01 | 已合入 `main`（链接可点击：GUI Markdown/IDE 页 + TUI 对齐） |
| `fix/pi-messenger-upstream` | `8dc5fe099d6` | 2026-11-01 | 已合入 `main`（pi-messenger 上游 #41/#42） |
| `sync/omp-release/18.14.2` | `264ea62c460` | 2026-11-01 | 已合入 `main`（v18.14.2 真 merge） |
| `vendor/termide-0.46.0` | `1855260d837`(远端) | 2026-11-01 | 已合入 `main` |
| `ci/fix-41464951855` | `99748129aad` | 2026-11-03 | 内容已被 `5e99ac37dc8` 及其后续修复取代；worktree 干净，仅用于复现，退役 |
| `feat/plugin-dist`（远端同名） | — | — | 若远端仍存在，交由用户决定是否删除远端分支 |
| `port/studio-pages` | `a5cdafcdb77` | 2026-11-05 | 已并入 `feat/web-ui-studio-migration`（`a5cdafcdb77` 即该分支末端合并提交），worktree `temp/port-pages` 已删；内容随迁移分支走 |
| `port/studio-deck` | `f20aef45342` | 2026-11-05 | 已并入 `feat/web-ui-studio-migration`，worktree `temp/port-deck` 已删（`.git` 文件在中止的删除中被抹掉，`worktree prune` + `safe-remove-tree apply` 清理）；内容随迁移分支走 |
| `port/studio-shell` | `917c777a3c6` | 2026-11-05 | 已并入 `feat/web-ui-studio-migration`，worktree `temp/port-shell` 已删；内容随迁移分支走 |

| `fix/browser-relay-hello-race` | `c1f6c6c6a79789ed99e37c42b14f3648e00fe624` | 2026-11-12 | 已合入 `main@381acebe` 与 `feat/report-completion@d0ef54a5c694`（ancestor 验证）；worktree `temp/fix-browser-relay` 已删除（git worktree remove RC0；branch -d was c1f6c6c6a79；0 links）；no-follow logical 580,886,416 B；clean（无 tracked/untracked 改动） |
| `feat/ci-buckets` | `06671d0b78607b87e17aeb7df8c44d19448f47d8` | 2026-11-12 | 已合入 `main@381acebe` 与 `feat/report-completion@d0ef54a5c694`（ancestor 验证）；worktree `temp/ci-buckets` 已删除（safe-remove-tree 先删 18 links + 3435 dirs + 40017 files；worktree remove RC0；branch -d was 06671d0b786）；no-follow logical 2,663,773,956 B；仅 known-regenerable ignored（node_modules/export-assets/viewer/native node） |
| `feat/device-account-ux` | `509e4390233b06f3ae861feec39891fe7469fdc7` | 2026-11-12 | 已合入 `main@381acebe` 与 `feat/report-completion@d0ef54a5c694`（ancestor 验证）；worktree `temp/device-account-ux` 已删除（safe-remove-tree 先删 18 links + 2120 dirs + 29314 files；worktree remove RC0；branch -d was 509e4390233）；no-follow logical 1,871,833,836 B；仅 known-regenerable ignored |

| `docs/jcode-citation-fix` | `e5bfa5b8…` (last-known abbreviated original pointer) | 2026-11-12 | Original row cited public URL/commit and a cleanup/worktree removal; this metadata-only pass observed the branch absent from local refs and did not delete any branch/worktree. Row moved to retired without inventing a full SHA |

## 定期动作

- `merge-gate` 的 `branch registry` 门禁会在本地跑：未登记分支、登记了却消失的 `keep` 行、
  超过 30 天的 `feat/*|fix/*|chore/*`、超过 90 天的 `backup/*|spike/*` 都会报出来。
- 每轮上游同步结束（台账更新后）检查一次：`sync/omp-release/*` 应只剩当前在飞的。
