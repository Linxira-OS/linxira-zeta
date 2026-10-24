<!-- 从根 AGENTS.md 原文移出（2026-10-25 精简，未改写）。并行代理、feature branch、内部整合批次、dev/* 实验分支、工作树与分支纪律。 -->

# 分支、工作树与推送纪律（展开版）

> 硬约束摘要见根 AGENTS.md「分支、工作树与推送」；本文是完整流程与理由。

## Parallel Agent Branches (2026-10-20 用户立规)

多子代理并行开发的标准流程，**每一条都是硬规则**：

1. **每个子代理自建 worktree + 分支**（`temp/<topic>` ← `feat/*`/`fix/*`/`chore/*`），
   根 checkout 始终干净停在 `main`；子代理不得推送、不得合并 `main`、不得打 tag。
2. **本地先合、跑通测试**：父代理把各分支按依赖顺序合入一个
   `chore/integration-<version>` 分支，解决冲突后跑本地门禁——
   `check-version-consistency`、`check-ci-surface`、`check-workbench-bundles`、
   `check-scope-imports`、`brand-check`、`bun run check:ts`、`cargo fmt --all -- --check`
   （用 `main/rust-toolchain.toml` 钉的 1.97.1）——以及受影响套件的测试。
3. **推分支、跑 CI**：本地绿才推 `chore/integration-<version>`，并用
   `gh workflow run ci.yml --ref <branch>` 跑**一次**分支 CI；CI 覆盖本地做不到的
   多系统/原生构建/打包面（`makensis`、`appimagetool`、`makepkg`、bazel natives）。
4. **新功能必须带测试**：没有对应测试的功能改动不进整合分支；环境性失败必须在
   报告里给出「基线同样红」的证据，不得以 `skip` 或删除断言换取绿。
5. **zetacode 新特性必须写进 `docs/`**：`docs/` 是随产品打包的运行时文档
   （`zeta://docs`）。新的 CLI 子命令/标志、扩展 API、工具、内部 URL 面都要在
   `docs/` 对应文件补齐，不能只留在 CHANGELOG 或代码注释里。

## Feature Branch Workflow (mandatory)

Any new-direction development (new features, new surfaces, refactors that are
not pure fixes to `main`) MUST follow the offline-branch workflow:

1. **Create a local offline branch first** — never develop new directions
   directly on `main`. The branch name MUST be designed up front when the
   feature plan is written (e.g. `feat/web-ui-next`, `feat/<scope>`); plans
   MUST name their branch.
2. Work and commit on that branch locally until functionally complete.
3. **Before EVERY push of an integration branch** (`sync/omp-release/*`,
   `port/*`, `feat/*`, `chore/*`): merge the latest `main` into it first
   (`git merge main`), then run the local minimum gate —
   `bun scripts/check-version-consistency.ts`, `bun run check:ts`,
   `bun scripts/check-lsp-servers.ts` (the coding-agent and termide LSP tables
   are generated from `lsp/servers.json`), `oxlint`/`oxfmt`
   on the changed files, plus a re-run of any suite that was red in the last CI
   round. Never push a branch that is behind `main`; a CI failure triage
   starts with "is this already fixed on `main`, and is `main` fully merged
   into this branch?" before touching the branch itself.
4. **Zeta's own work does not open PRs.** PRs exist for outside contributions
   (see [Pull requests](#pull-requests)); for our own branches the evidence is
   the local gate plus the branch's **one** `workflow_dispatch`
   (`gh workflow run ci.yml --ref <branch>`) — a push to a branch outside
   `main`/`dev/*` triggers no CI at all (`ci.yml` → `on.push.branches`), so the
   dispatch is the only branch-side run. Use it **once, after the last push** —
   not after every fix, and only when the branch needs a real natives build or a
   full-suite verdict.
5. **Land through the local integration batch** (see below), then push `main`
   once.
6. Delete the branch and its worktree after the landing (both remote and local).

`main` stays reserved for released/stable work; a new direction only lands on
`main` via this merge path, never by committing directly to it.

### 内部整合批次：本地先合、一次推（2026-10-16 用户裁决）

当多个**已各自验过的分支**要一起落 `main`（同步分支 + 编辑器/GUI/文档批次）：

1. 每个分支**合并前**过本地最小门禁（`bun run merge-gate --gates-only` +
   `bun run check:ts`；动过 `crates/` 再加 `cargo fmt --all -- --check`）；
2. 在**本地**按顺序合并进 `main`（真 merge commit、禁 squash）。推荐做法：先在
   `temp/<topic>` 工作树里把批次合出来并跑完整门禁，再用 `git merge --ff-only`
   把 `main` 推进到它 —— 根 checkout 因此只承担"推进引用 + 推送"，不承担编辑；
3. 合并后刷新依赖：`bun install --frozen-lockfile`。它同时是锁文件一致性检验；
   若它改动了**跟踪的**生成物，说明合并后的生成物过期，必须先修再推；
4. **一次 push** `main`，且**在上一轮 run 结束前不推**（2026-10-17 立规，
   起因：同一轮对 main 连推 4 次，`#1212`–`#1214` 被并发组互相取消，整条流水线
   一次都没跑完，等于没有信号）。落规三条：
   - 一轮落地的推送次数 **≤1**；CI 红之后的修复一律**先在 worktree 里累积**
     （`merge-gate --gates-only` + clippy 本地跑绿），攒到下一次整轮推送；
   - **在途 run 存在时不推同一分支**；推送前先看 `gh run list --branch <b>`；
   - `cancelled` 既不是失败也不是通过——只有 `success` 才算证据；被取消的 run
     必须在报告里写明"无信号"，不得当作绿。
   `ci.yml` 的 `concurrency` 已对 **main 推送**改为**排队**（不再互相取消）：
   即便误推两次，两轮都会完整跑完，信号不会被抹掉。release run 与 main 推送
   都在 no-cancel 组，分支 dispatch 仍会互相取代。**本地先合仍然才有意义**；
5. **高风险或发布性质**的变更（上游 tag 同步、品牌面、发布链、CI 自身）仍按各自
   章节走完整证据链；上游同步分支的权威证据是它的 `workflow_dispatch`（本地做不了
   真编 natives 与依赖 natives 的桶）。

### `dev/*` — 用户指定的实验分支

`dev/<topic>` 是**由用户亲自开**的实验分支，用于验证某个机制/做法是否成立；
结论未定之前它**不进入**上面的 feature-branch → PR → `main` 路径。

- **必须由用户开**：分支的成败以"是否实现用户的想法"为准，agent 不得自行
  开 `dev/*`，只能在用户点名后于其上作业。
- **门禁以用户判断为准**：默认不要求 PR、不要求 CI 绿（实验的目的是先拿
  结论，不是交付）；但用户明确要求时必须照做——本次实验就要求实验分支推
  GitHub 并**跑 CI 且必须绿**，用来验证机制是否真的走得通。
- **永不合并进 `main`**。实验成功后，把结论沉淀成规则（写进 AGENTS.md /
  `document/merge-playbook.md` 等），代码本身按正常流程重新落地。
- **失败或废弃即删**（本地 + 远端）；不留在仓库里当历史包袱。
- 命名 `dev/<topic>`，topic 描述被验证的东西，不用来放功能开发。

首个实例：`dev/main` — 验证"上游同步只取上游 tag 间原生差异"的合并机制
（v18.2.5 → v18.3.0），并测定**最稳的合并步长**（按冲突量决定一次合几个
tag）；结论成立则写入 `document/merge-playbook.md`。

### 工作树与分支纪律（2026-10-15 立规）

根 checkout 必须永远是"干净且停在 `main`"的状态；任何开发都在短命 worktree
里做。立的由头：2026-10-11 的 v18.8.7 同步轮把根 checkout 留在
`sync/omp-release/v18.8.7` 且带 79 个未提交改动，一直没人切回，之后**从这棵
陈旧树里读出了 `packageManager = bun@1.4.0` 这种错误事实**（main 上其实是
`bun@1.4.3`）——凡读现状必须读 `refs/heads/main`。

- **开工前先查根**：`git rev-parse --abbrev-ref HEAD` 必须是 `main`，
  `git status --porcelain` 必须为空。不在 `main` 时先把改动安顿好
  （`git stash push -u -m "<说明>"` 或提交到对应分支），**切回 `main` 再干活**。
- **根 checkout 只做无副作用操作**：读文件、`git fetch`、`git worktree` /
  `git branch` 管理。**禁止**在根里改文件、提交、或跑会写盘的构建。
- **所有开发在 worktree 里**：
  `git worktree add temp/<topic> -b <branch> refs/heads/main`；分支名**开工前
  定好**（`feat/*`、`fix/*`、`docs/*`、`chore/*`、`sync/omp-release/<tag>`）。
- **一轮合并 / 一个 PR 结束后立刻切回 `main`**，`sync/omp-release/<release>`
  分支与其 worktree **用完即删**（`git worktree remove <path>` +
  `git branch -d <branch>`）。干净且已并入 `main` 的 `temp/*` worktree 属残留，
  随时可删；**有未提交内容的一律先保留并登记**。
- **推送任何集成分支前先 `git merge main`**；不允许落后 `main` 就推。
- **读事实只认 `refs/heads/main`**（根即 main 时可直接读）。禁止从陈旧 worktree、
  旧 stash、旧分支里读"现状"。
- 子代理一律**自建 worktree**，禁止改根 checkout 的文件；委托时把这条写进 brief。

#### `temp/` 的用途、路径与清理（2026-10-15 立规）

- **两个标准用途**：① 外部学习 / 参考项目的克隆；② 我们自己的子分支
  worktree（`temp/<topic>`）。两者都必须是**仓库内路径**——绝不使用系统
  临时目录（`%TEMP%`、`/tmp`、`os.tmpdir()`）：那里重启即清空，之前做的
  事情全部丢失。`temp/` 本身被 gitignore，内容永不提交。
- **清理前先核两件事**：分支是否真在 `main` 里
  （`git branch --contains <sha>` 应列出 `main`），以及是否有未提交内容
  （有则**先保留并登记**，不得直接删）。
- **登记工作树一律用 `git worktree remove --force` 删**（git 的删除不追
  链接），不要手写递归删除。
- **地雷：禁止对任何含 `node_modules` 的目录执行 `rm -rf`。** Windows 上
  bun 的 workspace 链接是 junction，`rm -rf` 会**穿透**它——2026-10-15 实测
  上级目录旧目录里 `node_modules/@linxiraos/pi-ai` 指向 `<repo>/packages/ai`，
  穿透即等于删掉仓库源码。删任何目录前先确认其中的链接指向哪里
  （Node/Bun 用 `lstat().isSymbolicLink()`，PowerShell 用 `LinkType`/`Target`）。
  登记已被清掉的孤儿目录，用「只 `lstat`、遇链接只删链接本身」的遍历器删 ——
  入库工具：**`bun scripts/safe-remove-tree.ts <dir>`**（先删链接 → 复核 0 链接 →
  才整删普通树；仍有链接就停机交人判断）。它只支持"先看后删"，`list` 模式可
  用来登记某个目录里的链接指向哪里。
- **产物与证据不入库，也不留在 `temp/`**：截图、diff、PR 正文草稿等归档到
  `~/.zeta/parked-evidence/<date>/`，然后再删对应目录。

