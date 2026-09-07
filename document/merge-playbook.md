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
  **Zeta 规范形无歧义**的机械 token 批量改写：`USER_AGENT = \`omp/\${VERSION}\``
  → `zeta/`、`PREVIEW_TITLE`/`APP_NAME`/profile alias 的 `"omp"` → `"ζ"`/`"zeta"`、
  `name: "oh-my-pi"` → `"zeta"`、`.omp` 路径 fixture → `.zeta`（skills/agent/
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

扫描受跟踪产品源码里品牌注册表禁止的上游 OMP 标记（`PI_LOGO`、`@oh-my-pi/`
scope、越界 `.omp` 路径、π 进入 ζ 品牌面文件、MUST_CONTAIN 断言缺失等），
任何未解决命中都 exit 1，合并不得静默回退 Zeta 产品面。判断题（语义分歧、
测试契约）不是它的职责——按本文"逐 bucket 测试契约 resolve"处理。

### brand-rules.ts 规则表与五级分类

`scripts/brand/brand-rules.ts` 的表按五类语义分组；每条规则带一行理由注释。
命中一条上游标记时，先判断它属于哪一级，再决定动作：

| 级别 | 含义 | 落在哪个表 | 动作 |
|---|---|---|---|
| **must-replace** | Zeta 规范形无歧义的机械上游 token | overlay 的 `REWRITES`；`MUST_NOT_CONTAIN` 全树禁令（`PI_LOGO`、`` USER_AGENT = `omp/` ``、`@oh-my-pi/` scope 等）+ `MUST_CONTAIN` 正向断言（`USER_AGENT = zeta/${VERSION}`、`CONFIG_DIR_NAME = ".zeta"`、`APP_NAME = "zeta"`、`ZETA_LOGO`、`icon.omp: "ζ"`、终端标题 `ζ`） | overlay 机械改写；check 兜底禁回归 |
| **allow-interop** | 必须继续读写 OMP 原生位置的互操作面（`.omp-plugin` 清单、discovery/omp-plugins、`omp.sh`/`.ompshare`、browser-relay chrome key 等） | `OMP_PATH_ALLOW` | 保留；不得 sweep（`.omp-plugin` 是刻意保留面，见 AGENTS.md 注册表） |
| **allow-provenance** | 指向上游的出处引用（issue/URL） | `OH_MY_PI_ALLOW_PATTERNS`（`github.com/can1357/oh-my-pi`、`oh-my-pi#\d+`）+ `OH_MY_PI_ALLOW_FILES` 里的 provenance 条目 | 保留 |
| **internal-key** | 内部标识符/共享基础设施，改了会静默断功能 | `OMP_PATH_ALLOW` 的 `__omp`/`OMP_PROFILE`/`ompprurl` 等模式；注册表"Native Tokio 安装导出"行 | 保留；勿 sweep 成 `__zeta*`（v18.0.10 Tokio 静默不装教训） |
| **test-contract** | 测试 fixture/断言编码的上游兼容契约 | `OMP_PATH_ALLOW` 注释：test fixture 豁免（自洽临时路径）；CI 证明真分歧时逐 bucket resolve（skillful-toggle 教训） | 阶段 4 人工逐文件 resolve |

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
