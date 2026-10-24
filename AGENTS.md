# Zeta Development Rules

我们的主力平台一等公民是 linux，我们自己的 linxira 发行版，基于 arch linux。win 的开发是二等公民，macos 滚一边去。（用户批注）

> **本文件只放每次会话都要生效的规则。** 操作细节在 `document/agents/` 与 `document/`，
> 遇到对应问题时按 §11 索引去读，不要在这里展开。

## 1. 方向与上游

Zeta 是 OMP 下游发行版。运行时树、包布局、Bun 工作流、内部 `@linxiraos/*` 包名
刻意跟随 OMP，保证上游更新可合并。四个上游，角色固定：

| 上游 | 角色 |
|---|---|
| OMP（`omp-upstream`） | 运行时树；**只按官方 release tag 集成**（§6） |
| Pi（`pi-upstream`） | 语义移植来源；永不直接 merge（`port/pi/<scope>` 分支） |
| OMP Web（`omp-web-upstream`） | **冻结**：`web-ui/` 已分叉，只手工 cherry-pick，记进 `document/upstream-sync.md` |
| Pi Web（`pi-web-upstream`） | Web 特性的语义移植来源（`port/pi-web/<scope>` 分支） |

分支：`main` = 产品分支；`sync/omp` = 上游未改镜像（只快进，永不并入 `main`）；
`web-ui/` 是独立快照（自己的包管理器与 `web-ui/AGENTS.md`，不是根 workspace 包，
不得有自己的 GitHub workflow——根 `.github/workflows/ci.yml` 覆盖它）。

`temp/` = 仓库内 scratch（gitignore，永不提交）：外部参考克隆 + 自己的 worktree
（`temp/<topic>`）。**必须在仓库路径内**，绝不用系统临时目录（重启即清空）。

## 2. 产品不变量（没有脚本能拦，必须自觉）

- **YOLO 是默认。** `tools.approvalMode` 默认 `yolo`
  （`packages/coding-agent/src/tools/settings.ts`；`tools/approval.ts` 未设置时也回退
  `yolo`）。**不要再加审批层**——不为路径、不为内容类别、不为"看起来危险"。产品能
  判断的取保守标准值并说明，别把判断推给用户；只有用户才能定的产品选择才问。
- **不弹黑框。** GUI 父进程 spawn 的控制台程序一律隐藏：Windows `windowsHide: true`
  （Node/Bun）或 `CREATE_NO_WINDOW`（`std::process::Command`）。产品自启的 helper
  （serve、daemon、git 探测、LSP/MCP、eval、更新器）全静默，日志进
  `~/.zeta/run/daemon.log`。只有测试可以开可见终端。
- **品牌面不许被上游改回。** `.zeta` / `~/.zeta`；命令只有 `zetawork` / `zetacode` /
  `zetaide`；内部文档协议 `zeta://`；npm scope `@linxiraos/*`；release 资产名
  `zeta-cli-*`（**不跟 bin 名**）；OTLP `service.name` = `zeta`；遥测导出硬关闭
  （`TELEMETRY_EXPORT_ENABLED = false`，没有开关）。启动字符画 `ZETA_LOGO` /
  `ZETA_WORDMARK` / `ZETA_SUBLINE` **永久冻结**，判据是
  `bun scripts/brand/brand-check.ts`（手改一个字符即红）。
- **刻意保留的上游记号，不要顺手"修"**：`OMP_*` 环境变量、`.omp-plugin`、
  `my.omp.sh`、`icon.pi`、latex π、`__omp*` 跨进程协议名。

行级注册表与合并后恢复清单：`document/agents/brand/registry.md`。

## 3. 默认上下文

未特别说明时，"agent" 指 `packages/coding-agent/` 的实现；工作对象默认是这个包。
（它是 CLI 工具，不是当前会话的助手。）

## 4. 代码落点

| 写什么 | 放哪里 |
|---|---|
| React 组件 / pages / hooks | `web-ui/` |
| Gateway REST handler | `packages/coding-agent/src/server/web-gateway/`（路由在 `web-gateway.ts`） |
| 频道 / 机器人运行时 | `packages/coding-agent/src/channels/` |
| 配置层（web.yml） | `packages/coding-agent/src/config/web-config.ts` |
| zetawork（TUI / GUI） | `main/crates/zeta-main/`、`main/crates/zetawork-gui/` |
| zetaide / vendored TermIDE | `termide/`（**不要**在 `main/` 里重写 vendored 面板库） |
| `@linxiraos/editor` npm 面 | `editor/` |
| Electron 壳 | `desktop/src/main.ts`（**退役中，不新增代码**） |

依赖方向不可倒：`desktop/`、`web-ui/` 只经 HTTP 访问 `zeta serve` /
`webGatewayFetch`，**不得 import `packages/*` 源码**。

Catalog 值（models、identity、descriptors、cache）从 `@linxiraos/pi-catalog/<module>` 引；
`@linxiraos/pi-ai` 只导出它自己签名用到的类型，别经它拿 catalog 值。

插件代码与登记一律放 `plugins/`（`official/` 放源码，`community/` 只放指针），
不放 `packages/`。体系见 `document/plugin-system.md`。

展开版（含退役前的 desktop/web-ui 内嵌架构）：`document/agents/surface/code-locations.md`。

## 5. 文档边界

- `docs/` = 随产品打包的运行时文档（`zeta://docs`）。**新特性必须写进 `docs/`**——
  子命令、标志、扩展 API、工具、内部 URL 面，不能只留 CHANGELOG 或代码注释。
- `document/` = 内部开发 / 流程 / 架构文档，永不打包。只放四类：① 当前执行计划
  （新计划生效即删旧，一律不并存）；② `roadmap.md` 的未开发规划；③ 架构设计文档；
  ④ `document/agents/`（从本文件移出的操作知识，见 §10）。
- 移动 `docs/` ↔ `document/` 要清理所有交叉引用；已发布 CHANGELOG 条目不可变。

**计划纪律**：计划是执行规格，不是设计文档
（产品侧教义：`packages/coding-agent/src/prompts/system/plan-mode-active.md`）。
决策完整 > 简短——留下实现者要自己再选一遍的计划等于失败；Non-Goals / Alternatives /
Risks 之类填充是噪声。计划文件写进会话 artifacts（`local://` → `~/.zeta` 下），
**不进仓库工作树**；开启 Tracking 时由 tracking 层镜像到 `<project>/.zeta/tracking/`
（唯一项目内副本）。落地后删除，结论沉淀进本文件或 `roadmap.md`。

## 6. 上游同步（硬约束）

只在需要具体修复 / 特性时同步，**没有定期同步**。用户必须点名确切 tag
（如 `v17.2.11`）；不得推断"最新"，不得用 `omp-upstream/main`。

- 合并前与开始合并时各查一次远端：`git ls-remote --tags omp-upstream refs/tags/<tag>`。
  tag 被重切是正常的——以远端为准，`git fetch --force omp-upstream --no-filter tag <tag>`
  对齐，old→new SHA 记进台账。只有"已开始合并之后才移动"才停下报告，绝不悄悄合完。
- 从 `main` 开短命 `sync/omp-release/<release>`（最好在独立 worktree），对已验证的
  tag 做**真 merge（禁 squash）**；完成后 `git merge-base --is-ancestor <tag-commit> HEAD`
  必须成立。
- 禁止：上游原始 commit、任意 SHA、单文件、部分 diff、cherry-pick、rebase、squash；
  禁止为省事跳过 incoming 文件。
- 测试按**契约**合并：上游同时改实现与测试的，整对接受；不要保留 Zeta 旧断言配新行为。
- 产品前门（README、logo、名称、主页、安装文档）是 Zeta 的：完整合并后单独做
  branding-overlay commit。
- 每轮同步更新 `document/upstream-sync.md` 台账（baseline、source tag/SHA、Zeta 起点、
  冲突决策、门禁、最终 merge commit）。同步自动化必须要求显式 `--tag <tag>`，拒绝分支名
  与裸 SHA。

**动手前必读**：`document/merge-playbook.md`（逐阶段操作）、
`document/merge-review.md`（合并前 checklist、决策记录模板、守卫矩阵）。
同步细节：`document/agents/merge/sync-procedure.md`；
合并后损伤排查：`document/agents/merge/damage-classes.md`。

## 7. 分支、工作树与推送

- 根 checkout 永远干净且停在 `main`。开工前 `git rev-parse --abbrev-ref HEAD` +
  `git status --porcelain`；不在 `main` 就先安顿改动再切回。根里只做无副作用操作
  （读、`git fetch`、worktree / branch 管理）。
- 所有开发在 worktree：`git worktree add temp/<topic> -b <branch> refs/heads/main`。
  新方向先开本地分支，不直接在 `main` 上开发；`dev/*` 只能用户开，永不并入 `main`。
- 子代理自建 worktree，**不推、不合并 `main`、不打 tag、不改根 checkout**；委托时把
  这条写进 brief。
- 推任何集成分支前先 `git merge main` 并跑本地门禁。Zeta 自己的工作**不开 PR**：
  证据 = 本地门禁 + 该分支唯一一次 `gh workflow run ci.yml --ref <branch>`
  （分支 push 本身不触发 CI）。
- **一轮落地 ≤1 次 push**；在途 run 不推同一分支（先看 `gh run list --branch <b>`）；
  `cancelled` 不是失败也不是通过——**它没有信号**，不得当绿。
- 清理：`git worktree remove --force`；有未提交内容先保留登记。**禁止对含
  `node_modules` 的目录 `rm -rf`**（Windows junction 会穿透，等于删源码）——
  用 `bun scripts/safe-remove-tree.ts`。证据 / 产物归档到
  `~/.zeta/parked-evidence/<date>/`，不留在 `temp/`。

展开版（并行代理流程、整合批次、worktree 细节与立规缘由）：
`document/agents/workflow/branches.md`。

## 8. 命令与提交

- 不主动 commit / push / 打 tag / 开 PR，除非用户要求。
- 用 `bun check`，**不要** `tsc` / `npx tsc`。
- Rust 测试用 `bun run test:rs`（nextest + doctest 两段），**不要**直接 `cargo test`。
- scratch 一律进 `temp/`（已 gitignore）；一次性产物永不提交，仓库根只放产品文件。
- 合并 PR 的 commit message：`Merge PR #<number>: <conventional PR subject> (@<author>)`。
- npm 发布面**不存在 token**：一律 GitHub OIDC trusted publishing（无 `NPM_TOKEN`）。
  细节：`document/agents/workflow/release-publish.md`。

## 9. GitHub 权限

发评论 / 开 issue / 改 PR 描述前，必须把目标和拟发文本给用户看并获批（用户已给出
目标 + 文本即算确认）。"处理 PR 反馈"只授权改代码和起草回复，不授权直接发。授权
resolve 时，回复必须说明改动与验证，经批准后在原 thread 发，**发成功才许 resolve**。
改 PR 不等于授权发无关评论或开 issue。

细节（PR 模板、贡献者原话、changelog 归属）：`document/agents/workflow/github.md`。

## 10. `document/` 目录结构

- `document/agents/` — 从本文件移出的操作知识，**按问题分目录**：`merge/`（同步细节、
  损伤类别、文件所有权）、`brand/`（品牌注册表）、`surface/`（代码落点、包清单）、
  `workflow/`（分支、发布、GitHub）。索引见 `document/agents/README.md`。
- 其余 `document/*.md` — 架构与流程正本（`architecture-layers.md`、
  `merge-playbook.md`、`release.md`、`dev-conventions.md`、`local-ci.md`、
  `upstream-sync.md` 台账等）。

## 11. 索引：遇到什么读哪里

| 遇到 | 读 |
|---|---|
| 上游同步冲突 / 合并后 CI 红 / 损伤排查 | `document/agents/merge/damage-classes.md`、`document/merge-playbook.md` |
| 脚本注释里的 "damage class N" | 同上——编号指 `document/agents/merge/damage-classes.md`（原在根文件） |
| 同步流程、六阶段、合并前核对 | `document/agents/merge/sync-procedure.md`、`document/merge-review.md` |
| 品牌残留、包名 / bin / 资产名 | `document/agents/brand/registry.md`、`document/brand-surface-rules.md` |
| 代码该放哪个目录、包与插件布局 | `document/agents/surface/code-locations.md`、`document/agents/surface/packages.md` |
| 分支 / 推送 / 整合批次 / worktree | `document/agents/workflow/branches.md` |
| 发布链、tag、更新日志、版本线 | `document/release.md`、`document/agents/workflow/release-publish.md` |
| 日常编码约定（格式、日志、生成物、测试） | `document/dev-conventions.md` |
| 本地 CI 镜像与 job map | `document/local-ci.md` |
| 插件体系 | `document/plugin-system.md` |
| 架构（分层、natives、gateway、TUI） | `document/architecture-layers.md`、`document/web-gateway.md` |
| 上游移植指南 | `document/porting-from-pi-mono.md` |
| 同步台账 / 历史决策 | `document/upstream-sync.md` |
