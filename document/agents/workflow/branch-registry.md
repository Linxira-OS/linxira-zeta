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
| `park/session-fork-diff` | park | 会话 fork 结构差异：`forkDiff(a,b)` 按 entry id 分出 added/removed/changed 与共同祖先；含 `session fork --diff` 接线与 8 个测试。**原 `feat/superagent-runtime`**，2026-11-01 已 commit（`2e542337c1d`） | user | 2026-10-31 | 决定是否把 diff 暴露给 `session fork` 之后再动 |
| `feat/pet-rust` | park | 桌宠 Rust crate（未提交，9 files，`main/crates/zetapet/`） | user | 2026-10-21 | P1 暂缓；保持 park，不动 |
| `feat/pet-packaging` | park | 桌宠 npm 打包（未提交，5 files，`main/npm/pet/`） | user | 2026-10-21 | 同上 |
| `docs/roadmap-audit` | docs | DSH 内核 + TUI/IM 两份 2026-10-31 审计（+24 行，已 commit `faea369a066`） | agent | 2026-10-31 | **等用户提交 `document/roadmap.md` 的改动后**再合（否则工作区脏，git 拒绝合并） |
| `sync/omp-release/v18.15.0` | sync | OMP v18.15.0（`3fedf8d5326`）真 merge，基于 `feat/taste-memory`；56 处冲突按类别 resolve（Zeta 面保留、测试取上游后 `.omp→.zeta`、代码上游语义 + 重放 Zeta-only）；worktree `temp/sync-18.15` | agent | 2026-11-02 | 六阶段门禁与 CI 绿后并入 `main`，删前记 SHA |
| `feat/taste-layer` | feat | P4 `taste` super-memory 层本体（`packages/coding-agent/src/{taste,tools/super-memory.ts,prompts/taste}`、设置/角色/session 接线、`docs/memory.md` + `docs/tools/super_memory.md` + `docs/models.md`、`test/taste/`）；基于 `sync/omp-release/v18.15.0` 的 `e7d7f7f5776`。worktree `temp/taste-layer` | agent | 2026-11-02 | 并入 `main` 后删（合并前记 SHA） |
| `feat/taste-memory` | feat | P0–P2 上游 host/默认值清理 + `check-no-upstream-defaults` / `check-doc-host-parity` 两个新门禁；随后在此之上做 P4 `taste` super-memory 层（`packages/coding-agent/src/taste/`）。worktree `temp/taste-memory` | agent | 2026-11-02 | P4 落地并入 `main` 后删（合并前记 SHA） |
| `feat/design-bridge` | feat | 工作区级 OpenDesign 桥：`.zeta/design.yml` 开关、`/design` 命令、单个 `design` 工具（托管 MCP + `od` CLI）、安装/daemon/MCP 状态检测；默认关闭，不写全局；worktree `temp/design-bridge` | agent | 2026-11-04 | 合入 `main` 后删（删前记 SHA） |
| `fix/ui-audit-p0` | fix | `document/ui-bugfix-report.md` 的 P0/P1/P2 UI/功能修复：托盘驻留、分栏/页脚、会话删除、modal 交互与浮岛视觉；附带 Git 面板提交全部更改/推送闭环；worktree `temp/ui-audit-fixes` | agent | 2026-11-04 | 修复合入 `main` 后删（删前记 SHA） |
| `feat/web-ui-studio-migration` | feat | Web UI Studio 迁移（`local://web-ui-studio-migration-plan.md`）：`web-ui/components/studio/**` + `web-ui/styles/studio/**` 原计划接管产品 UI 层、`zetawork` 原计划变原生外壳托管 `web-ui`（该方向已暂停）、`@linxiraos/zeta-web` 浏览器面与桌面打包共用一份构建；`/api/projects` GET/PUT 注册表、git stage/commit/push/pull/log 网关族。**2026-11-05 追加 web-app 切换**：`web-app/` 自带 Vite 7 构建取代 Next 渲染层、`server/studio-host/` 回答 `/api/v1/*` 宿主契约（pair/CSRF/query/command/events）、`@omp-studio/*` 与 `ompStudio*` 全局名全部迁到 `@linxiraos/studio-*` / `zetaStudio*`、`pi-omptype`/`pi-snapcompact` 改名 `zeta-schema`/`zeta-compact`、`compat.importLegacyOmp` 设置与 `zeta serve` 同源静态托管。基于 `c1f6c6c6a79`，worktree `temp/web-ui-studio` | agent | 2026-11-05 | 全量验证（W1–W8 + `bun check` + branch CI）并入 `main` 后删（删前记 SHA） |
| `backup/pre-studio-ui-2026-11-05` | backup | Studio 迁移前冻结快照，`c1f6c6c6a79789ed99e37c42b14f3648e00fe624`（`v1.4.10` 线）；已推 `origin` | agent | 2026-11-05 | 迁移分支通过全量验证后再删（删前记 SHA） |
| `dev/main-v1830-wip` | dev | v18.3.0 合并 WIP（2026-09-25，已被 v18.14.2 远超） | user | 2026-09-25 | **用户决定**；技术上是死的 |

## 已退役（删除前登记）

| 分支 | SHA | 退役日期 | 原因 |
|---|---|---|---|
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

## 定期动作

- `merge-gate` 的 `branch registry` 门禁会在本地跑：未登记分支、登记了却消失的 `keep` 行、
  超过 30 天的 `feat/*|fix/*|chore/*`、超过 90 天的 `backup/*|spike/*` 都会报出来。
- 每轮上游同步结束（台账更新后）检查一次：`sync/omp-release/*` 应只剩当前在飞的。
