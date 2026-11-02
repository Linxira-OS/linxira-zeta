# CI 问题台账

> **规则**：CI / 发布过程中遇到的每个问题都在这里记一条，**只记录，不顺手修**。
> 积累到一定数量后统一评审，再按条目批量修复并补门禁。修复时在对应条目追加
> `fixed by` 与日期，不要删历史。
>
> 每条的必填项：**现象 / 触发点（提交或 run）/ 根因 / 当时的处理 / 建议方案（门禁）**。
> 提交用短 SHA，CI run 用数字 id；两者都能 `git show` / `gh run view` 复查。
>
> 首次登记：2026-11-02（v18.15.0 合并 + 1.4.8 发布）。

## 索引

| ID | 一句话 | 触发点 | 状态 |
|---|---|---|---|
| CI-001 | Windows 无符号链接权限，十几个测试本地红 | 长期存在 | 记录 |
| CI-002 | `CustomCommandWatcher` 时序测试在合并前就红 | 长期存在 | 记录 |
| CI-003 | 新“删除文件防复活”守卫的名字被品牌规则判红 | `4b03d257ad8` | 已处理（豁免） |
| CI-004 | 合并后 `nix/bun.nix` 与 `bun.lock` 不一致 | `15183edda34` | 已处理（发布 bump 重生成） |
| CI-005 | Windows 上 Bazel 无法刷新 `MODULE.bazel.lock` | `2fffbf6b95a` 起的同步 | 绕过（CI 产物） |
| CI-006 | Windows 上 Rust 检查无法编译（没有 MSVC 链接器） | 发布 `1.4.8` | 绕过（WSL 验证） |
| CI-007 | `release.ts` 的版本覆盖面小于 `release-v2.ts` | `73720678956` | 部分（手工补齐） |
| CI-008 | 工作台/IDE 二进制必须按版本重建；tag 运行没识别成 release | `710f90c50fa` | 绕过（tag dispatch + 产物） |
| CI-009 | 导出查看器元数据过期，阻塞所有 release binary | `7c8ca480536` | **未修（阻断 1.4.8）** |
| CI-010 | 安装方式 smoke 随 CI-009 失败（下游） | `7c8ca480536` | 记录 |
| CI-011 | `gh run watch` 偶发 502，watcher 退出 | 发布期间 | 记录 |
| CI-012 | `Zeta Nix` run 长时间 `in_progress` | 多个 run | 观察 |
| CI-013 | 合并前 `main` 本来就是红的 | `4f917a02691` | 记录 |
| CI-014 | 用 `release.ts` 发版（文档已标注不要用） | `73720678956` | 已处理（转发 v2） |
| CI-015 | bump 先上 main、npm 未发布，安装 smoke 必红 | `78eea49eddb` | 记录（等发布） |
| CI-016 | 新设置组未登记到 `TAB_GROUPS` | `15183edda34` | 已处理 |
| CI-017 | LSP 选择测试整桶红、单跑绿 | `78eea49eddb` | 记录 |

---

## CI-001 Windows 无符号链接权限，测试本地红

- **现象**：本地跑 `packages/coding-agent` 的 singleton 桶时 16 个测试失败，全部是
  `EPERM`（`symlink`）或 `EINVAL`（`readlink`）；`packages/utils` 的浏览器解压测试、
  `hyperlink-targets` 同样。失败的都不是产品逻辑，而是测试要先建符号链接。
- **触发点**：长期存在；这次在 `feat/taste-layer` 的合并后全量跑时复现。
  合并前 `feat/taste-memory` 上同样失败（基线对比确认“新增失败为零”）。
- **根因**：Windows 默认不允许普通用户创建符号链接（需要开发者模式或管理员）。
- **当时的处理**：不修；以“合并前后失败集合相同”作为证据，Linux CI 为准。
- **建议方案 / 门禁**：测试里先用能力探测（建一个临时链接）决定 `skip`，而不是按平台
  硬编码；或在本地 CI 镜像里显式声明“无符号链接权限”并给已登记豁免清单。

## CI-002 `CustomCommandWatcher` 时序测试在合并前就红

- **现象**：`packages/coding-agent/test/extensibility/custom-commands/watcher.test.ts`
  的 “ignores writes to files other than the command's index entry” 稳定失败（约 670ms）。
- **触发点**：合并前的 `feat/taste-memory`、合并后的 `sync/omp-release/v18.15.0` 都失败。
- **根因**：测试用固定等待窗口判断“没有回调”，Windows 文件系统通知时序不稳定。
- **当时的处理**：记录为既有问题，不计入本轮回归。
- **建议方案 / 门禁**：改成事件驱动（收到首个事件后再断言窗口内无第二次），或给
  该用例加 `test.skipIf(process.platform === "win32")` 并注明原因。

## CI-003 新守卫的名字被品牌规则判红

- **现象**：`check-removed-upstream-files.ts`（记录“合并不许复活的删除项”）被
  `brand-check` 判 3 处：文件必须写出 `.omp/...` 和 `sdk/go/omp-rpc/...` 才能检查它们是否复活。
- **触发点**：`4b03d257ad8`（新增守卫）、合并提交 `15183edda34`。
- **根因**：品牌规则按字面 token 扫；守卫的职责就是命名被禁路径。
- **当时的处理**：在 `scripts/brand/brand-rules.ts` 给该守卫加两条按文件豁免
  （`.omp` 路径规则、`omp-rpc` 规则），并注明理由。
- **建议方案 / 门禁**：把这条固化成约定——**任何“必须命名禁用 token 才能工作”的守卫，
  在引入它的同一个提交里登记品牌豁免**，否则合并必红。

## CI-004 合并后 `nix/bun.nix` 与 `bun.lock` 不一致

- **现象**：`Zeta generated files` 的 “Verify nix/bun.nix matches bun.lock” 失败
  （run `41419311548`，提交 `15183edda34`）。
- **触发点**：上游合并改了 `bun.lock`，`nix/bun.nix` 没重生成。
- **根因**：合并门禁没有把 `gen-nix-bun` 纳入；只有发布脚本会重生成。
- **当时的处理**：1.4.8 发布 bump 触发 `generateNixBunDeps`，后续 generated-files 变绿。
- **建议方案 / 门禁**：`merge-gate` 在 `bun.lock` 变更时跑
  `bun scripts/gen-nix-bun.ts --check`（若没有 `--check` 就先加），或在 CI 的
  generated-files 已有检查前移到合并门禁。

## CI-005 Windows 上 Bazel 无法刷新 `MODULE.bazel.lock`

- **现象**：发布脚本在版本 bump 后执行 `gen:bazel-lock` 失败：
  `Failed to create symlink: ... .bazelignore`，Windows 错误 1314（客户端没有所需的特权）。
- **触发点**：`2fffbf6b95a` 起的同步；1.4.8 发布 `73720678956` 首次撞上。
- **根因**：`cargo-bazel splice` 需要建符号链接；本机没有开发者模式/管理员。
- **当时的处理**：
  1. `scripts/release.ts` 增加 `ZETA_SKIP_BAZEL_LOCK=1` 显式跳过（默认行为不变）；
  2. 让 CI 的 `bazel_lock` job 失败时上传刷新后的锁（该 job 本来就设计成这么做）；
  3. 从 run 下载 `MODULE.bazel.lock` 产物，提交在 `570ad1ef4ff`，再打 tag。
- **后续（2026-11-02）**：v1 管线已删除；`release.ts` 现在只转发到
  `release-v2.ts`，后者在 bazelisk 可用时刷新锁、不可用时明确警告并提示取 CI 产物。
  `ZETA_SKIP_BAZEL_LOCK` 不再被使用。
- **建议方案 / 门禁**：发布脚本在跳过时自动去 CI 取产物并提交，或把该步骤放到
  WSL/Linux 执行；另加一个不依赖 Bazel 的“锁输入哈希”快速预检，提前提示“将过期”。
- **已有机制（无需新写）**：`release-v2.ts` 在 bazelisk 可用时会自己刷新锁；
  不可用时会大声警告并提示“失败后取 CI 产物”（脚本内已有原文）。
  历史做法同样是 WSL bazelisk（`b2308822165`）。

## CI-006 Windows 上 Rust 检查无法编译（没有 MSVC 链接器）

- **现象**：发布脚本第 6 步 `bun run check` 的 `check:rs` 失败：
  `link.exe` 报 “extra operand …” —— 解析到的是 Git 自带的 coreutils `link`，
  不是 MSVC 链接器；本机也没有 Visual Studio 构建工具。
- **触发点**：1.4.8 发布第二次尝试；此后所有需要本地 Rust 的步骤都受影响。
- **根因**：Windows 发布机没有 MSVC 工具链，且 PATH 里的同名 `link.exe` 抢先解析。
- **当时的处理**：
  1. `scripts/release.ts` 增加 `ZETA_SKIP_RS_CHECK=1`，本地只跑 `check:ts`；
  2. 在 WSL（Linxira OS）里装 `cmake`、`ninja` 后跑 `bun run check:rs`，通过；
     Rust 以 CI / WSL 为准。
- **后续（2026-11-02）**：v1 管线已删除；`release-v2.ts` 本来就只跑 `check:ts`，
  `ZETA_SKIP_RS_CHECK` 不再被使用。
- **建议方案 / 门禁**：发布文档写明“Windows 发布机必须有 MSVC 或改走 WSL”；
  提供 `scripts/check-toolchain.ts` 预检（检测 MSVC 与 `link.exe` 真伪）；
  把 `check:rs` 的 WSL 调用固化成脚本，避免每次手工 export PATH。
- **历史先例（2026-11-02 查证）**：
  - `release-v2.ts`（`bb999381b86`）早就把“无 MSVC 主机”当正常情况：本地只跑
    `check:ts`，Rust 交给 CI；注释原文就是 “environment-blocked on hosts without an
    MSVC linker/SDK”。
  - `document/release.md` 的 “Rebuilding leaves on the Windows workstation” 给的是
    **WSL + `x86_64-pc-windows-gnu`** 的完整配方（把 `main/` 复制到 `/root/zeta-build`，
    不要在 `/mnt/c` 上构建）。
  - `b2308822165`（1.1.23 救火）用 **WSL bazelisk** 重生成 `MODULE.bazel.lock`、
    用 `cargo metadata` 重写 `Cargo.lock`、修 clippy；没有安装 MSVC。
  - `915f45821f5` 是唯一改 MSVC 工具链的提交，但只服务 Linux/macOS 执行端的 bazel
    交叉编译；`scripts/bazel-natives.ts:398` 也明说 Windows 主机只能本地 `host`，
    交叉构建去 WSL/Linux。
  - 结论：仓库的既定方案就是“**WSL 构建 + CI 验 Rust**”，没有可捡的本地 MSVC 修复。
    本次错在用了 v1 的 `release.ts`（见 CI-014），不是缺 MSVC 补丁。

## CI-007 `release.ts` 的版本覆盖面小于 `release-v2.ts`

- **现象**：1.4.8 第一次 bump 后，`check-workbench-bundles` 报
  `packages/coding-agent/package.json: 1.4.8 != 1.4.7 (workbench line)`；
  `check-version-consistency` 还报 npm 发行版、main Cargo、README badge、
  以及所有 changelog 缺 `[Unreleased]`。
- **触发点**：`73720678956`（用 `scripts/release.ts` 发版）。
- **根因**：`release.ts` 只扫 `packages/*/package.json`；
  `release-v2.ts` 还有 npm 发行版（`main/npm`、`editor/npm`、`termide/npm` 的
  launcher + leaf + `optionalDependencies` 固定版本）、`main/` 独立 Cargo 工作区及其
  锁、`web-ui`、README badge，并在发布后重新打开 `[Unreleased]`。
- **当时的处理**：跑 `bun scripts/set-version.ts 1.4.8` 修版本与固定版本；
  手工重写 `main/Cargo.lock` 的 4 个成员；给 14 个 changelog 补 `[Unreleased]`。
  提交 `710f90c50fa` 完成。
- **建议方案 / 门禁**：二选一并统一入口——(a) 把 `release` 指向 `release-v2.ts`；
  (b) 把 v2 的 Step 2f/2f-4、changelog finalize、`assertConsistency` 移植进
  `release.ts`。无论哪条，发布提交前必须跑
  `check-version-consistency` + `check-workbench-bundles`，否则不允许 tag。

## CI-008 工作台/IDE 二进制必须按版本重建；tag 运行没识别成 release

- **现象**：
  1. 版本一致后 `check-workbench-bundles` 报 4 个叶子二进制仍是 1.4.7，
     “does not embed `zetawork 1.4.8`”；
  2. 原子推送 `main` + `v1.4.8` 产生的推送运行里，`Release product binary` 全部
     `skipped`（`release_metadata` 判 `is-release=false`，run `41426537507`）；
  3. 用 `gh workflow run ci.yml --ref v1.4.8` 手动 dispatch 后，产物才构建出来。
- **触发点**：`710f90c50fa`、tag `v1.4.8`、run `41426537507` / `41426779676`。
- **根因**：
  1. 二进制内嵌 crate 版本，必须重建；本机无 MSVC，CI 用 Linux + mingw 交叉编译
     （`zeta-work-*`、`zeta-ide-*`）；
  2. 发布检测依赖 `git tag --points-at HEAD`，原子推送后短时间内 tag 可见性存在竞态。
- **当时的处理**：从 run `41426779676` 下载 4 个产物，替换四个叶子二进制，
  按 sha256 重写 `.stamp.json`，提交 `7c8ca480536`，再强制移动 tag。
- **建议方案 / 门禁**：发布脚本在 atomic push 后**显式 dispatch 一次 tag run**
  （或让 `release_metadata` 在看不到 tag 时重试几秒）；
  增加 `scripts/install-release-binaries.ts` 把“下载产物→替换→打 stamp”固化，
  并作为发布步骤的一部分；`check-workbench-bundles` 继续作为提交前门禁。

## CI-009 导出查看器元数据过期，阻塞所有 release binary

- **现象**：release binary 三个平台全部失败：
  `Export viewer metadata is stale; run bun run gen:export-viewer --write ... and commit viewer.generated.json`
  （run `41436102660`，提交 `7c8ca480536`）。
- **触发点**：1.4.8 最终发布 run；合并后第一次真正构建 release binary。
- **根因**：合并时保留了 Zeta 自己的导出查看器实现（不接上游托管查看器），
  但查看器元数据（`viewer.generated.json`）没有在合并 / 分享退役 / 前端资源变化后重生成。
- **当时的处理**：**未修**（本轮只记录）。
- **建议方案 / 门禁**：把 `bun --cwd=packages/collab-web run gen:export-viewer --check`
  加进 `merge-gate`（或 generated-files 的检查集），让漂移在合并阶段就红；
  发布流程在 bump 后、tag 前跑一次 `--write` 并纳入 bump 提交。

## CI-010 安装方式 smoke 随 CI-009 失败（下游）

- **现象**：`Install method smoke tests` 失败。
- **根因**：release binary 没有被构建/上传，smoke 找不到可安装的产物；不是独立缺陷。
- **当时的处理**：记录，不单独修。
- **建议方案**：CI-009 修好后自动恢复；若要更清晰的报错，smoke 在缺少输入时先输出
  “upstream job failed” 而不是断言失败。

## CI-011 `gh run watch` 偶发 502

- **现象**：发布等待期间 `gh run watch` 以
  `failed to get run: HTTP 502` 退出，run 本身仍在跑。
- **触发点**：1.4.8 发布等待。
- **根因**：GitHub API 瞬时错误；工具不重试。
- **当时的处理**：改用带重试的轮询脚本直到 `completed`。
- **建议方案 / 门禁**：发布脚本的 `watchCI` 对 5xx 做指数退避重试（现在只在业务失败时退出）。

## CI-012 `Zeta Nix` run 长时间 `in_progress`

- **现象**：`41423958693`、`41424376083`、`41426562296` 等 `Zeta Nix` run 数小时仍是
  `in_progress`；对应 CI 早已结束。
- **根因**：未确认（可能是 runner 排队、nix 构建缓存、或 workflow 自身卡住）。
- **当时的处理**：观察，不阻塞发布。
- **建议方案**：给 `Zeta Nix` 加超时与排队诊断；确认它是否仍需要按 push 触发。

## CI-013 合并前 `main` 本来就是红的

- **现象**：推送前最后一次 `main` CI（提交 `4f917a02691`）失败在
  “Test main workspace (zeta workbench)”。
- **根因**：与本次合并无关的既有失败；本次合并没有引入新的失败集合
  （singleton 桶 16 个失败均为 CI-001）。
- **当时的处理**：记录；以“合并前后失败集合一致”为证据继续。
- **建议方案**：修复该 job 并补一个“主工作区冒烟”，避免长期红掩盖新回归。

## CI-014 用 `release.ts` 发版（文档已标注不要用）

- **现象**：1.4.8 第一次 bump 只改了 `packages/*`，漏掉 npm 发行版、`main/` Cargo 工作区
  与锁、README badge、changelog `[Unreleased]`；随后 workbench 守卫与版本一致性连环红。
- **触发点**：`73720678956`（`bun scripts/release.ts 1.4.8`）。
- **根因**：`scripts/release.ts` 是 v1，只保留共享 helper 与 `watch` 模式；
  `document/release.md` 明确写 **“Do not use it to cut a release”**。
  `release-v2.ts` 才会做完整 bump、`nix/bun.nix` 重生成、bazel 锁刷新（bazelisk 可用时）、
  一致性 + 叶子守卫、`check:ts`、源提交 push-run 绿检查、原子推送。
- **当时的处理**：手工补齐版本、main 锁与 changelog，再用 CI 产物重建二进制；
  没有回退到 v2。
- **已处理（2026-11-02）**：v1 发布管线已删除；`release.ts` 只保留 `watch`、`deps`
  和 v2 复用的 helper，任何版本/bump 调用都转给 `release-v2.ts`（同一进程参数、
  继承退出码）。`canary` 与 `major/minor/patch` 不再由旧脚本处理（历史没有 canary
  tag，npm 也只有 `latest`）。

## CI-015 版本 bump 先上 main、npm 尚未发布，安装 smoke 必红

- **现象**：run `41448562575`（`78eea49eddb`）的 `Install method smoke tests` 失败：
  `No version matching "1.4.8" found for specifier "@linxiraos/pi-channels"`。
- **根因**：bump 已推送到 main，但 npm 上的 `@linxiraos/*` 仍是 1.4.7；安装方式测试按
  仓库版本从 registry 安装同伴包，自然找不到 1.4.8。
- **影响**：发布完成前，main 的每次普通推送都会在这个 job 红；它不代表代码回归。
- **建议**：smoke 在 registry 版本落后于仓库版本时明确判定“发布未完成”并 skip/警告，
  不要用断言失败表达；发布完成后自动恢复。

## CI-016 新设置组未登记到 `TAB_GROUPS`

- **现象**：`settings-layout` 失败：`catalog.remoteRefresh: group "Catalog" not in
  TAB_GROUPS["model"]`，以及 `Taste` 的四条不在 `TAB_GROUPS["memory"]`。
- **触发点**：taste 层合并 `15183edda34`。
- **根因**：注册了 `Taste` / `Catalog` 分组，但 `pi-tui` 的 `TAB_GROUPS` 没同步；
  顺序还必须匹配 `all-settings` 的域顺序，否则连续组测试也会红。
- **当时的处理**：`TAB_GROUPS.model` 在 `Prompt` 后加 `Catalog`；`TAB_GROUPS.memory`
  在 `General` 后、`Auto-Learn` 前加 `Taste`；`ZETA_LANG=en` 下 5 个用例全过。
- **建议**：设置注册时若 `ui.group` 不在 `TAB_GROUPS[ui.tab]` 就在开发期抛错，
  或给注册表单加一个纯单测，不要只靠 UI 布局测试兜底。

## CI-017 LSP 选择测试整桶运行时红、单跑绿

- **现象**：`Test coding-agent native/unit` 桶里 4 个 `TypeScript server selection`
  用例 `toEqual` 失败；单独跑该用例通过，整文件 152 个用例一起跑时复现。
- **触发点**：run `41448562575`（`78eea49eddb`）；本地同样现象。
- **根因**：同文件/同桶内测试互相污染（PATH、临时 TypeScript 安装、环境变量），
  不是产品逻辑；具体污染源尚未定位。
- **建议**：这组用例改为显式注入 PATH 与临时目录，或 `describe.serial` 并在
  `afterEach` 恢复 env；先定位是谁改了全局再决定门禁。

---

## 附：1.4.8 发布链路时间线（供后续复盘）

| 步骤 | 提交 / run | 结果 |
|---|---|---|
| 上游 18.15.0 真合并 | `2fffbf6b95a` | 56 冲突，修复 `54d6a69fad4` / `e7d7f7f5776` |
| 分享退役 + 防复活守卫 | `676287bf017` / `4b03d257ad8` | 本地类型检查绿 |
| 合并 `main` 进发布线 | `15183edda34` | 3 冲突；`nix/bun.nix` 红（CI-004） |
| 第一次 bump（`release.ts`） | `73720678956` | 版本覆盖不全（CI-007）；bazel 锁红（CI-005） |
| 锁产物提交 | `570ad1ef4ff` | bazel 锁绿 |
| 补齐版本 + changelog + main Cargo | `710f90c50fa` | 版本一致性绿；workbench 二进制仍红（CI-008） |
| 安装 CI 构建的二进制 | `7c8ca480536`（tag `v1.4.8`） | lint/check/锁/产物二进制绿 |
| 最终发布 run | `41436102660` | 失败于导出查看器元数据（CI-009）；**未发布** |

**当前状态**：tag `v1.4.8` 已推送，但 GitHub Release 未创建、npm 仍是 `1.4.7`。
按本轮规则不修 CI-009，等批量处理。
