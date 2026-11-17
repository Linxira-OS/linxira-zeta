# 主线开发、工作树与恢复引用

2026-11-17 用户裁决：后续改动集中在 `main`。本规则取代此前根 checkout 只读、
新方向必须独立 feature/integration 分支和等待 CI 成功才落主线的默认流程。
上游确切 tag、发布验收、GitHub 写操作审批与用户 `dev/*` 保护规则继续有效。

## 分支登记（2026-11-01 起）

每开一条分支，先登记到 [`branch-registry.md`](./branch-registry.md)：用途、负责人、
何时必须删。删分支前把 SHA 记进「已退役」表——恢复就是一句
`git branch <name> <sha>`。

- 本地门禁 `bun scripts/check-branch-registry.ts`（`merge-gate` 的
  `branch registry`）校验三件事：有未登记的分支、登记了却已消失的分支、
  已退役却还存在的分支——任一成立就红。超过 30 天的 `feat/fix/chore` 与超过
  90 天的 `backup/spike` 只警告。
- 命名即生命周期：`feat|fix|chore` 合完就删；`sync/omp-release/*` 合完就删；
  `backup/*` 是保护点，确认可弃后删；`spike/*` 结论落地后删；`dev/*` 只归用户。
- worktree 脏着就删等于丢数据：先 commit，或拷到
  `~/.zeta/parked-evidence/<date>/`，再删 worktree。

## 主线开发与并行写入

1. 主代理在根 `main` 上统一编辑、验证和提交，先检查分支与已有改动；不重置用户 WIP。
2. 子代理需要修改源码时自建短命 worktree/分支，给出文件归属、基线和返回证据；
   不改根、不推送、不合并 `main`、不打 tag。只读审查无需 worktree。
3. 主代理审查增量并迁移到当前实现，解决共享文件冲突，运行受影响的最窄验证。
   同源代码已被 cherry-pick 或重构覆盖时按内容核对，不机械重放旧分支。
4. 源码整合不等于验收或发布。本轮无论 CI 结果均整合近期独有改动；检查失败和外部
   前提缺失必须保留证据，不能写成绿。发布仍需 `document/release.md` 的完整门禁。
5. 需要推送时每轮最多一次；先查看同分支在途 run。`cancelled`/`skipped` 不算成功。
   不主动创建 PR、tag、release 或发布包；已有 PR 仍由用户合并。
6. 回收后先归档未提交内容、独有引用、原始补丁与验证证据，再安全移除临时工作树。
   `dev/*`、有意 park 和用户保留的分支不自动并入或删除。


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

### 根 checkout 与恢复引用

- 开工确认根为 `main`，读取现状以根工作树为准；旧分支、stash 与 archive 只作恢复输入。
- 根可以包含本轮正在实现的改动；已有用户改动先识别、保留，禁止 blanket reset/clean。
- 子代理的写入必须隔离到 `temp/<topic>`，由主代理回收；临时分支不是第二条长期产品线。
- 历史分支即使不再保留工作树，也保留引用与登记。删除分支前登记 SHA；用户 `dev/*`
  与明确暂存的分支仍由用户决定，不借 temp 清理擅自删除。

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

