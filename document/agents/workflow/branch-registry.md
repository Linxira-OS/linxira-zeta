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
| `feat/attach-parity-full` | feature | attach 会话一致性：goal/live 控制器、`/loop`、模式提示跨后端（5 commits，94 files，+3351/−293） | agent | 2026-10-24 | 合入 `main` 或明确改判 `park/*` 之后 |
| `fix/gitea-flow-1` | ci | Gitea 本地 CI 自包含 + Bazel 缓存（1 commit，2 files）。worktree 曾整树删掉 `web-ui/`（2026-11-01 已 `git checkout -- web-ui` 复原，现在干净），可直接合 | agent | 2026-10-30 | 合入 `main` 之后 |
| `feat/superagent-runtime` | park | fork-diff 会话工作（8 个未提交文件：`session/fork-diff.ts`、`session-fork-lineage.test.ts`、listing/manager/commands/command-help） | user | 2026-10-31 | 先 commit 成 `park/*`，再决定是否继续 |
| `feat/pet-rust` | park | 桌宠 Rust crate（未提交，9 files，`main/crates/zetapet/`） | user | 2026-10-21 | P1 暂缓；保持 park，不动 |
| `feat/pet-packaging` | park | 桌宠 npm 打包（未提交，5 files，`main/npm/pet/`） | user | 2026-10-21 | 同上 |
| `docs/roadmap-audit` | docs | `document/roadmap.md` +24 行审计 | agent | 2026-10-31 | 已由 2026-11-01 的超级代理裁决取代，核对后删 |
| `dev/main-v1830-wip` | dev | v18.3.0 合并 WIP（2026-09-25，已被 v18.14.2 远超） | user | 2026-09-25 | **用户决定**；技术上是死的 |
| `spike/egui-shell` | spike | egui 外壳可行性（dock + 持久化） | agent | 2026-10-15 | egui 已定型并落地 `zetawork-gui`，可删 |
| `spike/gpui-shell` | spike | gpui 外壳可行性（clippy 绿） | agent | 2026-10-15 | 同上，可删 |
| `test/lock-1.4.7` | test | 1.4.7 锁输入验证（Cargo.toml 1.4.6→1.4.7） | agent | 2026-10-30 | `main` 已是 1.4.7，**已失效**，可删 |

## 已退役（删除前登记）

| 分支 | SHA | 退役日期 | 原因 |
|---|---|---|---|
| `backup/editor-ttt-1.6.0` | `2fa543c253b` | 2026-11-01 | 旧备份，内容早已并入 |
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
| `feat/plugin-dist`（远端同名） | — | — | 若远端仍存在，交由用户决定是否删除远端分支 |

## 定期动作

- `merge-gate` 的 `branch registry` 门禁会在本地跑：未登记分支、登记了却消失的 `keep` 行、
  超过 30 天的 `feat/*|fix/*|chore/*`、超过 90 天的 `backup/*|spike/*` 都会报出来。
- 每轮上游同步结束（台账更新后）检查一次：`sync/omp-release/*` 应只剩当前在飞的。
