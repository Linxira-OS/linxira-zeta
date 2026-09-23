<!-- 本文由 AGENTS.md 规整拆分而来（2026-09），随 merge-playbook/release 流程维护。 -->

# OMP Release Merge Playbook

OMP release 合并的操作手册。硬性边界（tag 规则、禁止项、品牌注册表、损伤类别
triage 表、推送门槛）在根 `AGENTS.md`，本文只放操作步骤与工具用法；CI/发布机制
见 `document/release.md`，编码约定见 `document/dev-conventions.md`。

## 六阶段管线

每次 OMP release 合并按以下六个阶段推进。AGENTS.md 保留的是一页摘要；这里是
每阶段的执行细节。

1. **完整 tag 合并。** 用户点名确切上游 tag（如 `v18.1.10`），用
   `git ls-remote --tags omp-upstream refs/tags/<tag>` 核实远端 tag 名与 peeled
   commit SHA，并把该不可变 SHA 记入 sync ledger（`document/upstream-sync.md`）。
   若本地已 fetch 的 tag 与远端不一致：停下上报，不许 force-update 或默默接受
   被移动的 release tag。从 `main` 切出短生命周期
   `sync/omp-release/<release>` 分支（优先在隔离 worktree 里），对核实过的 tag
   做真正的 non-squash merge；合并后 `git merge-base --is-ancestor <tag-commit>
HEAD` 必须成功，证明完整上游 release 已在历史中。
2. **结构修复。** 处理损伤类别 1–3：`workspaces.catalog` 全部 13 个键（14 个发布
   包含不在 catalog 的 `@linxiraos/zeta-web`）对齐 Zeta
   键名与版本线；npm scope 按"上游包名 → Zeta 发布名"**映射改写**（`omptype` →
   `@linxiraos/pi-omptype`，不是机械 scope 替换）；Cargo workspace 版本 +
   natives 哨兵 + committed bindings 用 `bun scripts/set-version.ts <当前 Zeta
版本>` 整线对齐，再 `bun install` 刷新 lockfile；逐项恢复冲突解决中静默丢失
   的 Zeta-only 代码（清单见 AGENTS.md 损伤表第 4 类）。**Gate：`bun scripts/
check-version-consistency.ts` 零漂移 + `bun run check:ts` 零错误**，两关都过
   才进品牌阶段。
3. **品牌 overlay。** 跑 `bun scripts/brand/brand-overlay.ts`（脚本已入库，
   `--dry` 可先预览），在逐 bucket 测试 triage 之前执行——机械 token 先扫掉，
   剩余测试失败就全是判断题（见下文"品牌 overlay 与守卫使用"）。
4. **逐 bucket 测试契约 resolve。** 对合并触碰到的每个上游测试文件，对照它的
   `v<tag>` 版本逐文件 diff、逐文件 resolve；上游同一 commit 同时改实现和测试
   （或文档）时，成对整体接受。**Tests must be merged as contract, not as
   ours-vs-theirs text.**（`v17.2.11` 教训：`38b61ae342` 把 retry-after delay
   30s → 200ms 改到上游，合并却保留了我们的 `delayMs: 30_000` 旧断言，CI 红。）
   `.omp` fixture 路径类损伤（AGENTS.md 损伤表第 6 类）在本阶段处理：只在
   Linux/XDG 分支生效的测试，Windows 本地全绿不代表合并适配完整。
5. **brand-check 归零 + 全测试绿。** `bun scripts/brand/brand-check.ts` 必须
   exit 0——判断题命中逐条手工 resolve（改代码或按依据扩 allow-list），不许为
   过检查而删断言。全测试套件绿，注意第 6 类损伤只在云端 Linux CI 显形。
6. **归纳回规则表/AGENTS。** 更新 `document/upstream-sync.md`（prior baseline、
   source tag、source SHA、Zeta starting commit、conflict decisions、checks、
   final merge commit）；出现新的 token 类别就扩 `scripts/brand/brand-rules.ts`
   规则表，出现新的损伤类别就补 AGENTS.md 损伤表；产品前门（README/logo/名称/
   主页/安装文档）在完整合并之后用单独的 branding-overlay commit 恢复 Zeta
   呈现。最后过 AGENTS.md"推送 sync 分支前的最低门槛"再 push。

## 合并操作要点

以下为各阶段的硬性操作规则（AGENTS.md 保留压缩版，此处为全文）：

- **只从官方 release tag 整合。** Never integrate raw upstream commits,
  `omp-upstream/main`, arbitrary SHAs, individual files, partial diffs,
  cherry-picks, rebases, or squash merges. Do not skip incoming files to make
  a release sync easier.
- **`sync/omp` 是上游镜像，不是产品分支。** It may only be fast-forwarded from
  upstream; it is not merged into `main`.
- **冲突在完整 tag 合并内解决。** Preserve intentional Zeta behavior through
  documented conflict decisions, then make any required Zeta brand, package,
  Bun, CI, or product adaptations in separate commits after the merge. Do not
  use later untagged upstream work to resolve conflicts.
- **无 `.omp` 兼容面。** Zeta's config dir is `.zeta` and `~/.zeta` only; we do
  not maintain legacy `.omp` path aliases — the compatibility cost outweighs
  the value. Upstream tests or docs that carry `.omp` paths must be adapted to
  `.zeta` during the merge and that decision recorded in the ledger
  (e.g. `acp-agent.test.ts` wrote `path.join(cwd, ".omp", "agents")`; zeta
  resolves `.zeta/agents`).
- **产品前门是 Zeta 资产。** Treat the root `README.md`, Zeta logo assets,
  product name, homepage, install instructions, and public examples as
  Zeta-owned product surfaces. A release merge must never skip their upstream
  history; instead, follow the complete merge with a separate, documented Zeta
  branding-overlay commit that restores the approved product presentation. Do
  not let upstream README text become the default Zeta front door.
- **每次 sync 更新 ledger。** Every release sync updates
  `document/upstream-sync.md` with the prior baseline, source tag, source SHA,
  Zeta starting commit, conflict decisions, checks, and final merge commit.
  A release sync reaches `main` only after its focused checks and required CI
  pass.
- **自动化必须保守。** Automation must require an explicit `--tag <tag>`
  argument, reject branch names and bare SHAs, verify the remote tag before
  merge, and produce a merge-tree/conflict report before changing a product
  branch.
- **Tag 逐文件契约 resolve 的对照基准是 `v<tag>` 版本**，不是 `omp-upstream/main`
  ——main 上可能有未进 tag 的中间态，拿它对照会把未经 release 的行为当契约。

## 品牌 overlay 与守卫使用

品牌残留工作分两层：**机械规则进脚本**（`scripts/brand/brand-rules.ts` 是唯一
事实源），**散文只留判断**。AGENTS.md 品牌注册表逐行人工核对，脚本兜底防回归；
brand-check 已进 CI check job（"Brand residue guard" 步骤，类型检查之后）。

### brand-overlay.ts（apply / --dry）

```
bun scripts/brand/brand-overlay.ts --dry   # 预览将被改写的行
bun scripts/brand/brand-overlay.ts         # apply：直接改写工作树
```

- apply 模式基于 `git ls-files` 扫描受跟踪产品源码，把 brand-rules.ts 里
  **Zeta 规范形无歧义**的机械 token 批量改写：`USER_AGENT = \`omp/\${VERSION}\``→`zeta/`、`PREVIEW_TITLE`/`APP_NAME`/profile alias 的 `"omp"`→`"ζ"`/`"zeta"`、
`name: "oh-my-pi"`→`"zeta"`、`.omp`路径 fixture →`.zeta`（skills/agent/
plugins/cache 等参数面）、mcp/theme schema URL 指向 Zeta 仓库 raw 地址、
doc-comment 与 `$XDG_*/omp/` 文档路径、`.omp\` Windows 路径等。
- **幂等且刻意窄**：只改无歧义 token。语义面（测试契约、上游互操作面）留给
  人工逐文件 resolve；跑完 overlay 后用 brand-check 看还剩哪些需要动手。
- 执行时机：阶段 3——结构修复之后、逐 bucket 测试 triage 之前，让剩余测试
  失败全是判断题。

### brand-check.ts（CI gate）

```
bun scripts/brand/brand-check.ts          # gate 模式：有未解决命中 exit 1
bun scripts/brand/brand-check.ts --json   # 机器可读报告
```

扫描受跟踪产品源码里品牌注册表禁止的上游 OMP 标记（`PI_LOGO`、`@linxiraos/`
scope、越界 `.omp` 路径、π 进入 ζ 品牌面文件、MUST_CONTAIN 断言缺失等），
任何未解决命中都 exit 1，合并不得静默回退 Zeta 产品面。判断题（语义分歧、
测试契约）不是它的职责——按本文"逐 bucket 测试契约 resolve"处理。

### brand-rules.ts 规则表与五级分类

`scripts/brand/brand-rules.ts` 的表按五类语义分组；每条规则带一行理由注释。
命中一条上游标记时，先判断它属于哪一级，再决定动作：

| 级别                 | 含义                                                                                                                                | 落在哪个表                                                                                                                                                                                                                                                                  | 动作                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **must-replace**     | Zeta 规范形无歧义的机械上游 token                                                                                                   | overlay 的 `REWRITES`；`MUST_NOT_CONTAIN` 全树禁令（`PI_LOGO`、`` USER_AGENT = `omp/` ``、`@linxiraos/` scope 等）+ `MUST_CONTAIN` 正向断言（`USER_AGENT = zeta/${VERSION}`、`CONFIG_DIR_NAME = ".zeta"`、`APP_NAME = "zeta"`、`ZETA_LOGO`、`icon.omp: "ζ"`、终端标题 `ζ`） | overlay 机械改写；check 兜底禁回归                                  |
| **allow-interop**    | 必须继续读写 OMP 原生位置的互操作面（`.omp-plugin` 清单、discovery/omp-plugins、`omp.sh`/`.ompshare`、browser-relay chrome key 等） | `OMP_PATH_ALLOW`                                                                                                                                                                                                                                                            | 保留；不得 sweep（`.omp-plugin` 是刻意保留面，见 AGENTS.md 注册表） |
| **allow-provenance** | 指向上游的出处引用（issue/URL）                                                                                                     | `OH_MY_PI_ALLOW_PATTERNS`（`github.com/can1357/oh-my-pi`、`oh-my-pi#\d+`）+ `OH_MY_PI_ALLOW_FILES` 里的 provenance 条目                                                                                                                                                     | 保留                                                                |
| **internal-key**     | 内部标识符/共享基础设施，改了会静默断功能                                                                                           | `OMP_PATH_ALLOW` 的 `__omp`/`OMP_PROFILE`/`ompprurl` 等模式；注册表"Native Tokio 安装导出"行                                                                                                                                                                                | 保留；勿 sweep 成 `__zeta*`（v18.0.10 Tokio 静默不装教训）          |
| **test-contract**    | 测试 fixture/断言编码的上游兼容契约                                                                                                 | `OMP_PATH_ALLOW` 注释：test fixture 豁免（自洽临时路径）；CI 证明真分歧时逐 bucket resolve（skillful-toggle 教训）                                                                                                                                                          | 阶段 4 人工逐文件 resolve                                           |

`SKIP_PREFIXES`（`web-ui/`、`temp/`、`document/`、`docs/`、`python/`、
`AGENTS.md`、`UPDATE-LOG.md`、vendored 代码、`plugins/` 等）永不扫描；
`PI_FREE_FILES` + `PI_FAMILY` 守护 ζ 品牌面文件（title-generator、welcome、
splash/outro、wizard-overlay）不得出现 π 族字符。出现新的标记类别：先扩
brand-rules.ts 规则表并注释理由，再让脚本吃掉它——不要靠散文记忆。

### 预存 main 欠账清单

以下 `oh-my-pi` 残留**在 main 上即已存在**（与合并无关，`OMP_REPO` env 可覆盖
部分行为），已在 `brand-rules.ts` allow-list 注释里登记为 "Pre-existing main
debt"，留给后续 sweep，不属 merge-residue 修复范围：

- `packages/coding-agent/src/cli/update-cli.ts` — self-update 的 REPO/MISE 回退
  （update-cli REPO 回退）
- `scripts/fix-changelogs.ts`（+ 其测试）— `ARCHIVE_REPO` 默认
  `can1357/oh-my-pi`
- `scripts/ci-macos-upload-secrets.sh`
- `package.json` — `PI_IMAGE` docker tag 默认 `oh-my-pi/pi:dev` + robomp scripts
- `CONTRIBUTING.md` — 标题仍是 "Contributing to oh-my-pi"（upstream-facing 文档）
- `scripts/rewrite-changelog.ts` — db path doc comment（`OMP_PATH_ALLOW` 注释）
- `scripts/install.sh` — 如有：当前无 `oh-my-pi`/`.omp` 命中、也无 allow-list
  条目；合并若引入残留，先扩 allow-list 注释登记，再排期 sweep
- 其余 allow-list 条目为 fixture 级（gh/update-cli/git-hosting/oauth/otel
  probe/gallery-fixtures/telemetry 等测试与注释），同为欠账，见
  `OH_MY_PI_ALLOW_FILES` 逐条注释

## 推送前核对

按 AGENTS.md"推送 sync 分支前的最低门槛"逐项过：

1. `bun scripts/check-version-consistency.ts` 零漂移
2. `bun run check:ts` 零错误
3. 损伤表第 3 类 grep 扫描通过（每个 `@linxiraos/<name>` import 都能在
   `workspaces.catalog`/npm 找到）
4. `bun scripts/brand/brand-check.ts` 归零（exit 0）
5. 动过 `crates/` 时 `cargo fmt --all --check` 归零（品牌缩短会让 rustfmt 折叠决策翻转——v18.1.10 第 8 类损伤）

五关全绿才允许 push。 Feature Branch Workflow 的 merge-main-into-branch 前置
步骤照旧执行。

## 上游增量合并规程（v18.2.5 起，唯一合并方式）

> 本节取代已废弃的压缩式 squash sync。核心原则一句话：**只合并上游原生
> tag 之间的差异；我们自己的差异永远不参与合并计算**。这一语义由 git 三方
> 合并自动保证，前提是 merge-base 恰为上一个已集成的上游 tag——所以本
> 规程的全部内容就是保住这个前提。

### 原理

- 三方合并：`git merge v18.2.6` 时，git 取 `merge-base(HEAD, v18.2.6)` 作为
  共同祖先，theirs 侧 = 祖先到 v18.2.6 的**净增量**。
- 上游树谱系连续（每个 release tag 都是我们上一轮 merge commit 的第二父）
  时，merge-base 恰为上一个 tag——增量合并天然成立，冲突只出现在「上游
  本轮改动的行 × 我们改过的行」的交集，量级为个位数到几十。
- **谱系断裂（squash 重写 / force-push / 跳 tag）会使 merge-base 退化为
  远古祖先**，theirs 侧膨胀为全量追赶窗口 diff。v18.2.1→v18.2.4 的
  1300+ 冲突、连续多轮 CI 损伤即此单一根源。

### 操作步骤（每步强制）

1. **fetch 回填**：`git fetch omp-upstream --no-filter tag v18.2.6`
   （partial clone 必须带 `--no-filter`，否则合并中途
   `remote unpack failed` 且整个 merge 回滚）。
2. **merge-base 验证（gate，不通过禁止合并）**：
   `git merge-base HEAD v18.2.6` 输出必须 == 上一个已集成 tag 的 peeled
   SHA（例：合 v18.2.6 时必须输出 `37273117021129e9...`（v18.2.5））。
   不等 → 谱系受损，停止，先修复谱系（联系维护者评估），禁止带病合并。
3. **增量预览**：`git diff --stat v18.2.5 v18.2.6` 一眼确认本轮增量规模；
   `git log --oneline v18.2.5..v18.2.6` 逐条过一遍提交主题。
4. **合并**：`git merge v18.2.6 --no-edit`（双亲 merge commit，禁止 squash /
   rebase / cherry-pick 上游提交）。冲突按下方「大批量冲突的分级 resolve」
   - 共享契约处理：upstream-wins + Zeta surface 重应用（scope 映射、包名
     映射、.zeta 路径、ZETA_CODING_AGENT_DIR、`__zeta_*` 注入符号、品牌、
     Zeta-only 功能存活清单）。
5. **生成物新鲜度 gate**：合并落地后按需重跑并提交——
   `bun install`（bun.lock）→ `bunx bun2nix -l bun.lock -c ../ -o nix/bun.nix`
   → `bun run gen:compat`（**凡 rules/ 下 KDL 有变化必跑**，v18.2.5 教训：
   rules.json 留旧版导致 compat/conformance/tokenizer 套件全红）。
6. **收口扫描（无扩展名白名单）**：
   - 冲突标记：`git grep -nE "^(<<<<<<<|>>>>>>>) " -- .`
   - 上游符号/品牌：`git grep -nE "@oh-my-pi/|__omp_|PI_CODING_AGENT_DIR|PI_LOGO" -- .`
     （逐命中判定，豁免清单见 brand-rules.ts 与本 playbook 各教训节）
   - 覆盖全部文本类型（.txt/.py/.rs/.nix/.kdl/.toml/.lock 与无扩展文件都在
     扫描范围内——prelude.txt、tests.rs、bun.nix 三次踩坑）。
7. **门禁**：`bun scripts/check-version-consistency.ts` +
   `bun run check:ts` + `bun scripts/brand/brand-check.ts` +
   `bun scripts/check-zeta-sentinels.ts`（双守卫都要）+
   `bunx oxfmt --check <既有 glob>` + 动过 crates/ 时 `cargo fmt --all --check`。
8. **本地全量测试（强制，不靠 CI 揭伤）**：workspace `bun test` 全量 +
   `bun run test:rs`；已知环境噪声按豁免清单排除（本地 .node 陈旧造成的
   natives 符号缺失属环境噪声，但必须先按 §natives 恢复再判定）。
9. **推送**：分段/staging 分支按「推送前核对」节；merge commit 含上游 tag
   对象，注意 pack 体积。

### squash sync【已废弃】

2026-09-17 授权的压缩式 squash sync（AGENTS.md 同名节）是为 v18.1.16..18.2.4
超大追赶窗口（>300 提交 / >50MB pack）做的**一次性抢救**。其代价——上游
谱系断裂、后续每次合并退化为全量冲突——已被 v18.2.5 起的真 merge 路线
取代。**禁止再次对 main 做上游 squash 重写**；本章仅作历史档案保留，
其"backup/omp/main 基座、main-old 保档、分段推送"等传输技巧仍可在
`git push` 网络受限时复用（见「分段快进推送的必然产物」节）。

## 双 tag 连续合并方法论（v18.1.13 → v18.1.14 实战归纳，2026-09-08）

上游连发两个 release 而本地落后两个版本时，**在一个 sync 分支上按 tag 顺序串联合并**
（v13 双亲 merge → v14 双亲 merge），不要跳过中间 tag 直接合最新——中间 tag 的
冲突解决结果是后续 merge 的基座，跳过会让 git 的 merge-base 落在更早的共同祖先上，
把本已解决的 Zeta 适配整批重新变成冲突（v14 直合出现过 604 冲突 vs 串联后的 22+584，
其中后者几乎全是可机械 resolve 的 scope 噪声）。

### 大批量冲突的分级 resolve

1. **先分类再动手。** 对每个 UU 文件取 ours/theirs 两侧，scope 归一化
   （`@linxiraos/*`↔`@linxiraos/*`、`pi-coding-agent`↔`zeta`、import 排序与空白）
   后比较：归一化相等的算 **scope 噪声**，整文件取 theirs + 跑 scope 重写
   （brand-overlay.ts + `@linxiraos/ → @linxiraos/pi-`、双前缀 `pi-pi-` 收敛）。
2. **批量 resolve 用 stage-3 blob 直写**（`git show ":3:<path>" > <path>` +
   `git add`）。Windows 上 `git checkout --theirs` 在索引含未合并 stage 时不可靠。
   批量脚本必须 checkout-index 与 add 分两步——checkout-index 只写工作树不动索引。
3. **整文件取 theirs 的已知盲区**：stage-3 是 v14 全文件，会抹掉 ours 侧
   **冲突块之外**的 Zeta 独有内容。哨兵检查（`check-zeta-sentinels.ts`）兜住符号级
   丢失；符号之外还要防 **身份行丢失**（APP_NAME、ZETA_PROFILE、KEY_NAME、
   biome-ignore 注释、i18n key）。用"Zeta 行计数对比"扫描
   （main 与工作树逐文件比 `/zeta|Zeta|linxiraos/` 行数差 >5 即嫌疑）收口。
4. **版本线三件套每次 merge 后必跑**：`set-version.ts` → `package.json` catalog
   13 键对齐 main → `bun install` → `check-version-consistency.ts`。changelog
   上游 section 重键（`## [18.x.y]` → `## [1.1.10-omp18.x.y]`）要全前缀匹配
   （`1[5-8].`），只重键当次版本会漏历史段。
5. **工具链是 Zeta 资产**：每次 merge 都会被上游 oxlint/oxfmt scripts 覆盖
   （根 + 12 个 per-package `check`/`lint`/`fmt`/`fix`）。逐文件从 main 恢复
   `check:tools` 等脚本与 `.oxlintrc.json`/`.oxfmtrc.json`/`biome.json`，
   然后把上游新代码里的 `oxlint-disable-next-line` 注释批量迁移成
   `biome-ignore`（noThenable→noThenProperty、no-eval→noGlobalEval、
   no-template-curly-in-string→noTemplateCurlyInString、
   no-unused-private-class-members→noUnusedPrivateClassMembers）。
6. **上游功能性 delta 必须手工移植**，整文件恢复 main 后逐 hunk 补：
   v14 的 IPC worker 父进程 watchdog（cli.ts +67 行，win32 ppid≤0 分支 +
   natives Process 探活 + 1s setInterval 兜底）和 idle-compaction async-wake
   守卫（agent-session.ts runIdleCompaction 首行 `#hasPendingAsyncWake()`）。
7. **测试契约随实现走，也随我们改过的实现走**：上游测试断言上游 shipped
   CHANGELOG 的版本号（如 18.1.12 uncategorized bullet），我们 rekey 后地址不可达
   ——契约不变，改测试的 fixture 寻址方式（读 shipped section body 过 summarize）
   而不是删断言。
8. **收口顺序固定**：scope 重写 → set-version/catalog/lockfile → 哨兵 → brand
   归零 → biome 归零 → `check:ts` → 行为测试（逐个 triage，区分 Windows-local
   已知噪声：natives 5s 加载超时、ENAMETOOLONG、symlink EPERM）。

## v18.2.4 squash-sync 首轮 CI 失败分类与分诊（2026-09-17/18）

squash 树（backup 基座 + 2 提交）首次 CI：5 个 test 桶红。逐桶分诊结论与
新增教训——**每类先在"旧 main 基线 worktree"跑同一测试分清三态：Windows
本地噪声 / 确定性内容回归 / 程序性步骤缺失**，不要对着 CI 日志盲修：

### 新损伤类别 #10：manifest 重复 JSON 键 → 子进程 stderr 污染

- **指纹**：子进程 spawn 型测试成批失败（logger 字节契约、DailyRotateFile、
  ptree stderr、stderr guard、任何断言 `stderr === ""` 的测试），断言 diff
  里出现 `warn: Duplicate key "@linxiraos/xxx" in package.json:N`。
- **根因**：合并 driver union 把上游 `@oh-my-pi/*` 依赖与 Zeta
  `@linxiraos/*` 同名键并存的 manifest，再经 scope sweep 字符串改名后
  同一对象内出现重复键。bun 每次进程启动都向 stderr 打警告。
- **修复**：`object_pairs_hook` 计数去重全部 `packages/*/package.json`；
  预防：scope sweep 之后必须跑"重复键扫描"，合并 driver 改为按
  scope-mapped 名合并而非字符串 union。
- 本次规模：11 个 manifest / 48 个重复键。

### 程序性步骤缺失（非损伤）

- `committed rules.json matches a fresh compile` → 跑 `bun run gen:compat`。
- CHANGELOG `## [18.x]` 段随每个新 tag 合并重新出现 → 重跑折叠脚本。
- catalog/Astra、Codex discovery 96 连挂（本地）→ 大头是**本地陈旧
  natives `.node`**（类 5：`Failed to load pi_natives native addon for
win32-x64`），本地 `packages/natives` 重建即消；CI bazel 现场构建无此问题。

### 全局符号 sweep 不能按扩展名白名单（v18.2.4 教训之二）

- `__omp_*` → `__zeta_*` 的 sweep 用 `--include="*.ts"` 执行，漏掉了
  `src/eval/js/shared/prelude.txt`（16 处桥调用改了 15 处，judge() 的
  `__omp_call_tool__` 残留，本地绿、CI 红——vm 注入的字符串源码 ts 扫描
  天生看不见）与 `src/eval/py/prelude.py` 的符号对。
- 规则：全局符号改名的收口扫描一律 `git grep -n "__omp_<name>" -- .`
  （无后缀过滤），资源文件（.txt/.py/.js/.json/.kdl）逐命中判定。

### bun 1.4.0 bytecode 与上游 bun@>=1.4 的分歧（v18.2.4 教训之三）

- 上游 `compile-binary.ts` 新增 `bytecode: true`，上游 CI 按
  `packageManager: bun@>=1.4` 拉最新 bun 编译，正常；Zeta pin
  `bun@1.4.0`，该版本 bytecode 编译产物启动即崩
  （`SyntaxError: import.meta is only valid inside modules`，全平台，
  `--version` 就炸）——desktop smoke ×4 与 install-method smoke 同源。
- 修复：`bytecode: false` + 代码内注释记录分歧；bun pin 升级时回归验证。

### CI 日志判读：`::error::` 回显不是错误（v18.2.4 教训之四）

- GitHub Actions 会整段回显 `run: |` 脚本文本；`echo "::error::..."`
  出现在回显里不代表触发。定位真失败只认 `##[error]` 注解 +
  `Process completed with exit code`，再向上找具体 step 输出
  （packageManager、native addon target 两次误判都是回显坑）。

### 冲突标记扫描必须覆盖全部文本类型（v18.2.4 教训）

- 收口扫描的路径清单漏了 `nix/`（和任何非 packages/crates/scripts/docs 的
  目录）+ 非 ts/json/md 后缀（`.nix`/`.toml`/`.lock`/`.yml`）——
  `nix/bun.nix` 带着三处冲突标记进了两个提交，直到 Nix flake 评估红才暴露。
- 规则：标记扫描改为 `git grep -lE "^(<<<<<<<|>>>>>>>) " -- .`（全树、全
  文本类型，仅排除二进制），任何新目录加入仓库都要重新过一遍清单。
- bun.lock 变更后的配套动作再次确认：`bunx bun2nix -l bun.lock -c ../ -o
nix/bun.nix`（bun2nix 2.1.2），lockfile 重复键去重后 bun install 不会
  自动重写 lock 文本，bun.nix 必须手动重生成。

### 分段快进推送的必然产物

- squash 分支是"重建的树"，**不继承完整合并分支已通过的任何清扫**——
  每个 tag 合并带进来的 CHANGELOG 段/scope/`.omp` 残留在 squash 树上要
  **全部重扫一遍**（本次 CHANGELOG 311 段、scope 14 文件）。
- browser-launch 的 CfT buildId 适配：不能拍脑袋 pin 版本号，必须从
  启动器同源读取（browsers.ts 内部的 revision 常量/导出），否则
  `chrome/linux-151.0.7666.0` vs 实际 `150.0.7871.24` 的路径断言红。
- `[skip ci]` 在**多提交 push 事件里会抑制整次推送的 CI**（不只 HEAD）：
  "首提交 skip + 次提交触发"的计划落空——改用 workflow_dispatch 手动
  触发（`gh workflow run ci.yml --ref main`）。

### 待修复清单（按本分诊，修复 PR 内容）

1. manifest 去重（48 键）→ 消灭 logger/ptree/stderr 全家。
2. `bun run gen:compat` → rules.json 对齐。
3. browser-launch.test buildId 从启动器同源读取。
4. tui terminal-capabilities Warp/Paseo 6 连挂（CI Linux 确定性红）→
   对照 v18.2.3/v18.2.4 上游实现逐 hunk 核对 CorePkgs 的手工合并。
5. sdk-mcp-instructions（xd:// inventory 空）/ rules-reload ×3 /
   main-interactive-input：旧 main 本地同样红 = Windows 噪声；但 CI
   Linux 上红的部分需在 Linux 语境复核（rules-reload 的 `.zeta/rules`
   fixture 路径与 discovery 顺序是首要嫌疑）。
