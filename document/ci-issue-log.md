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

| ID     | 一句话                                                     | 触发点                            | 状态                                              |
| ------ | ---------------------------------------------------------- | --------------------------------- | ------------------------------------------------- |
| CI-001 | Windows 无符号链接权限，十几个测试本地红                   | 长期存在                          | 记录                                              |
| CI-002 | `CustomCommandWatcher` 时序测试在合并前就红                | 长期存在                          | 记录                                              |
| CI-003 | 新“删除文件防复活”守卫的名字被品牌规则判红                 | `4b03d257ad8`                     | 已处理（豁免）                                    |
| CI-004 | 合并后 `nix/bun.nix` 与 `bun.lock` 不一致                  | `15183edda34`                     | 已处理（发布 bump 重生成）                        |
| CI-005 | Windows 上 Bazel 无法刷新 `MODULE.bazel.lock`              | `2fffbf6b95a` 起的同步            | 绕过（CI 产物）                                   |
| CI-006 | Windows 上 Rust 检查无法编译（没有 MSVC 链接器）           | 发布 `1.4.8`                      | 绕过（WSL 验证）                                  |
| CI-007 | `release.ts` 的版本覆盖面小于 `release-v2.ts`              | `73720678956`                     | 部分（手工补齐）                                  |
| CI-008 | 工作台/IDE 二进制必须按版本重建；tag 运行没识别成 release  | `710f90c50fa`                     | 绕过（tag dispatch + 产物）                       |
| CI-009 | 导出查看器元数据过期，阻塞所有 release binary              | `7c8ca480536`                     | 已处理（`1f3d699ac9b`；`3839499587b` 补离线内联） |
| CI-010 | 安装方式 smoke 随 CI-009 失败（下游）                      | `7c8ca480536`                     | 已恢复（CI-009 修复后）                           |
| CI-011 | `gh run watch` 偶发 502，watcher 退出                      | 发布期间                          | 记录                                              |
| CI-012 | `Zeta Nix` run 长时间 `in_progress`                        | 多个 run                          | 观察                                              |
| CI-013 | 合并前 `main` 本来就是红的                                 | `4f917a02691`                     | 记录                                              |
| CI-014 | 用 `release.ts` 发版（文档已标注不要用）                   | `73720678956`                     | 已处理（转发 v2）                                 |
| CI-015 | bump 先上 main、npm 未发布，安装 smoke 必红                | `5e99ac37dc8` + install-smoke fix | 已处理                                            |
| CI-016 | 新设置组未登记到 `TAB_GROUPS`                              | `15183edda34`                     | 已处理                                            |
| CI-017 | TypeScript server selection 四例稳定失败（原误判为 flake） | `41448562575` / `8e810a4fa07`     | 已定位并修（引入 CI-019）                         |
| CI-018 | 导出查看器重新带回托管 CDN，离线门禁红                     | `41478318050` / `3839499587b`     | 已修，待完整 CI 验证                              |
| CI-019 | LSP canonical 拆分未同步 termide 期望，termide 三例红      | `41575581031` / `8e810a4fa07`     | 已修（工作树，待提交/CI）                         |
| CI-020 | 上游新增/修改的测试与夹具没有合并审计                      | v18.15.0 合并审计                 | 已加门禁（已推 `ceca124008f`）                    |
| CI-021 | Bazel lock 输入哈希用了 Windows 工作区而非 Git blob        | run `41627466260`                 | 已修（`131f4c9b33a`）                             |
| CI-022 | session client 在 fork/persistCopy/forkFrom 丢失           | run `41606325272`                 | 已修（`ceca124008f`）                             |
| CI-023 | eval prelude 残留 `__zeta_call_tool__`                      | run `41606325272`                 | 已修（`ceca124008f`）                             |
| CI-024 | 上游新增 i18n 键没有调用点，orphan guard 红                | run `41636522109`                 | 已修（`131f4c9b33a`）                             |
| CI-025 | 品牌替换后 QR/catalog/browser 契约未同步                   | run `41606325272`                 | 已修（`ceca124008f`）                             |
| CI-026 | merge test audit 只归一化路径，不归一化 prose              | run `41627466260`                 | 已修（`ceca124008f`）                             |
| CI-027 | package.json merge guard 扫上游 merge 历史，gate 卡死      | v18.16 gate 本地                  | 已修（`dc0d77f037c`）                          |
| CI-028 | 上述契约只有 CI 才发现，本地 gate 未覆盖                   | v18.16 复盘                       | 已加 `merge-contracts`                            |

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
  `brand-check` 判 3 处：文件必须写出 `.zeta/...` 和 `sdk/go/zeta-rpc/...` 才能检查它们是否复活。
- **触发点**：`4b03d257ad8`（新增守卫）、合并提交 `15183edda34`。
- **根因**：品牌规则按字面 token 扫；守卫的职责就是命名被禁路径。
- **当时的处理**：在 `scripts/brand/brand-rules.ts` 给该守卫加两条按文件豁免
  （`.omp` 路径规则、`zeta-rpc` 规则），并注明理由。
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
- **修复（2026-11-03）**：`1f3d699ac9b` 重新生成并提交 `viewer.generated.json`，release binary 的
  metadata 检查恢复；随后发现 v18.15.0 合并又把托管 viewer 模板带回来，`3839499587b`
  改为 viewer + marked + highlight 全内联，见 CI-018。
- **建议方案 / 门禁**：把 `bun --cwd=packages/collab-web run gen:export-viewer --check`
  加进 `merge-gate`（或 generated-files 的检查集），让漂移在合并阶段就红；
  发布流程在 bump 后、tag 前跑一次 `--write` 并纳入 bump 提交。

## CI-010 安装方式 smoke 随 CI-009 失败（下游）

- **现象**：`Install method smoke tests` 失败。
- **根因**：release binary 没有被构建/上传，smoke 找不到可安装的产物；不是独立缺陷。
- **当时的处理**：记录，不单独修。
- **后续（2026-11-03）**：CI-009 修复后 `Install method smoke tests` 已恢复；CI-015 的
  pi-channels tarball 修复也独立生效。
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

## CI-015 安装 smoke 漏掉 pi-channels tarball override

- **现象**：run `41448562575`（`78eea49eddb`）的 `Install method smoke tests` 失败：
  `No version matching "1.4.8" found for specifier "@linxiraos/pi-channels"`。
- **根因**：smoke 已经把 `channels` 打进 tarball 目录，但没有把它加入
  `package.json` overrides 和 `bun add` 列表；解析 `@linxiraos/zeta` 的
  `@linxiraos/pi-channels: catalog:` 时因此回退到 registry，而 1.4.8 尚未发布。
  不是单纯的“发布顺序依赖”。
- **修复**：`scripts/install-tests/run-ci.sh` 增加 `channels_tgz`，写入 overrides
  并加入 `bun add`。这样安装 smoke 在发布前也能用本地 tarball 验证。
- **影响**：发布前 main 的 install-smoke 不再因这个同伴包失败。

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

## CI-017 TypeScript server selection 四例稳定失败（原误判为 flake）

- **现象**：`Test coding-agent native/unit` 的 4 个 `TypeScript server selection`
  用例如期失败；错误收到的是旧的 `typescript` 单服务器，而不是
  `typescript-native` / `typescript-language-server`。本地单文件同样复现，不是
  桶内测试互相污染。
- **触发点**：run `41448562575`（`78eea49eddb`）；后续 `41485818770` 重跑仍失败。
- **根因**：v18.15.0 合并保留了 Zeta 的旧 canonical `lsp/servers.json` 单条目
  `typescript`（带 tsgo/tsls/tsc candidate 链），但上游已经把内置表拆成
  `typescript-language-server` 与 `typescript-native`，并新增
  `selectTypescriptServer()` 按 `lib/tsserver.js` / `tsc --version` 只保留一个。
  合并把选择器和拆表一起丢了。
- **修复（2026-11-03）**：`8e810a4fa07` 把 canonical 表拆成两个条目、重新生成
  coding-agent / termide 表，并恢复 `selectTypescriptServer()` 调用。本机 4 例通过；
  仅剩 Windows 无符号链接权限的既有测试（CI-001）。
- **副作用**：termide 仍按旧的 `typescript` key + candidates 查表，生成表改成
  `typescript-language-server` 后 3 例红，见 CI-019。
- **建议**：LSP 选择测试不是 flake；以后按“上游拆了表但 Zeta 保留旧 key”这一
  指纹排查，不要只重跑。

## CI-018 导出查看器重新带回托管 CDN，离线门禁红

- **现象**：run `41478318050` 的 `Lint, type check & web build` 被
  `check-shared-infra` 拒绝，命中 `https://build.stencil.so/...` 与
  `https://stencil.so/assets/omp/...`；导出模板仍有外链 `marked` / `highlight`。
- **触发点**：`c290217e05a`（v18.15.0 合并后的导出查看器路径）。
- **根因**：合并后的 `export/html/index.ts` 在 compiled/npm 分支使用上游托管
  viewer 和 CDN 库，模板也恢复成 `{{MARKED_URL}}` / `{{HIGHLIGHT_URL}}` 外链；
  Zeta 的离线导出契约不允许运行时联网。
- **修复**：`3839499587b` 恢复 `src/export/html/vendor` 的 marked/highlight，
  生成 `viewer.generated.ts` 内联 viewer，模板改用 `<template-marked/>` /
  `<template-highlight/>` / `<viewer-script/>`；测试改为断言无 `script[src]`、
  无 `stencil.so`，并校验 npm 包内联文件齐全。`check-shared-infra` 已绿。
- **状态**：修复本身通过目标测试和类型检查；完整 CI 被 CI-017/019 打断，
  `v1.4.8` 发布已按用户要求暂停。

## CI-019 LSP canonical 拆分未同步 termide 期望

- **现象**：run `41575581031` 的 `Test termide (vendored TermIDE)` 红 3 例：
  `an_explicit_override_command_replaces_the_chain` 断言
  `!generated["typescript"].candidates.is_empty()` 失败；
  `first_installed_candidate_wins` 报 `NotOnPath { tried:
["typescript-language-server"] }`；`nothing_installed_reports_the_candidates_it_tried`
  同样只看到单个命令。
- **触发点**：`8e810a4fa07`（CI-017 的修复）。
- **根因**：`lsp/servers.json` 拆成 coding-agent 的两个 key 后，生成器只把带
  `languages` 的 `typescript-language-server` 写进 termide 的语言表；termide 仍按
  `"typescript"` + candidate 链读取，且自身没有上游的 split 选择器。
- **当时的处理**：按用户要求暂停发布链修复，不继续改；记录在此。后按方案 1
  修复：`scripts/gen-lsp-servers.ts` 支持 `termideCandidates`，`lsp/servers.json`
  的 `typescript-language-server` 为 termide 生成
  `tsgo → typescript-language-server → tsc` 链；coding-agent 的 split 表不变。
- **验证**：WSL `cargo test -p termide-config lsp::tests` 8/8 通过；
  `bun test packages/coding-agent/test/lsp/candidate-selection.test.ts` 通过；
  `lsp-regressions.test.ts` 仅剩 Windows 无符号链接权限的既有 EPERM。
- **fixed by**：工作树（2026-11-03），待提交并跑分支 CI；不得把断言改成接受
  单 key。

---

## CI-020 上游新增/修改的测试与夹具没有合并审计

- **现象**：`audit-merge-members.ts` 只比较 `packages/*/src/**` 的导出成员；
  上游新增的测试文件、夹具和修改过的断言不在任何合并门禁里。v18.15.0 合并时
  12 个新增测试文件虽然都在，65 个修改测试是否真的带上上游断言只能靠人工。
- **触发点**：v18.15.0 合并复盘（`3fedf8d5326`）。
- **根因**：合并门禁只覆盖“源码成员丢失”，不覆盖“契约（测试/夹具）丢失”；
  CI 里也没有 job 跑合并审计自己的测试。
- **当时的处理**：新增 `scripts/audit-merge-tests.ts`，按上游 tag 计算
  added/modified/deleted 测试与夹具；新增缺失、修改后仍未带上游 hunk 为失败，
  上游删除项只告警；`share.test.ts` 作为已退役功能显式豁免。修改项不是简单比较
  “与 pre-merge 不同”（Zeta 自己的 `.omp→.zeta` 改动会让它永远不同），而是把
  `base..tag` 三方合并进目标，结果必须与目标完全一致。
- **门禁**：`merge-gate.ts` 的 `audit-tests`（需要 `--tag`）；GitHub/Gitea
  `check` job 增加 `bun test scripts/audit-merge-tests.test.ts`，防止审计看到
  空集合还报绿。
- **fixed by**：工作树（2026-11-03），待提交并跑分支 CI。

---

## CI-021 Bazel lock 的输入哈希在 Windows 检出上失真

- **现象**：run `41627466260` 的 `Check MODULE.bazel.lock freshness` 报
  `Cargo.toml changed`；同一份提交在本地 `gen-bazel-lock --check` 却通过。
- **触发点**：`131f4c9b33a` 之前的手工哈希刷新。
- **根因**：Bazel 记录的是它读到的文件字节 `sha256`。Windows checkout 是 CRLF，
  Linux CI 是 LF；当时用工作区 `sha256(Cargo.toml)=a676…` 回填，CI 的 LF blob 是
  `132645…`，所以本地绿、CI 红。`Cargo.lock` 恰好无换行差异，第一次只修它没暴露。
- **修复**：`scripts/gen-bazel-lock.ts --check` 先对
  `git show HEAD:Cargo.toml|Cargo.lock` 求 `sha256`，与 lock 的
  `FILE:@@//…` 记录比较；不一致直接失败并提示重新生成，不再依赖工作区行尾。
- **门禁**：该输入检查所有平台都跑；`merge-gate` 的 `bazel-lock` step 跑完整
  `gen-bazel-lock --check`（Windows 跳过完整 Bazel，CI Linux 为准）。
- **fixed by**：`131f4c9b33a`（输入守卫在后续提交）。

## CI-022 session client provenance 在 fork/copy/load 时丢失

- **现象**：run `41606325272` 的 runtime/session 桶中
  `session-client-provenance.test.ts` 两例失败：fork 后期望 `web`、从 transcript
  fork 后期望 `cli`，实际都是 `undefined`。
- **触发点**：`dc0d77f037c` 的 v18.16 合并冲突解决。
- **根因**：Zeta 的 `client` 继承规则在 `#resetToNewSession` 里恢复了，但
  `fork()`、`persistCopy()`、`forkFrom()` 各自重建 header 时没有携带；新会话路径
  正常，分支/复制/加载路径静默丢字段。
- **修复**：三条路径都从 `this.#header.client` / `sourceHeader.client` 继承。
- **门禁**：`merge-contracts` 固定跑 `session-client-provenance.test.ts` 与
  `drop-session-trash.test.ts`。
- **fixed by**：`ceca124008f`。

## CI-023 eval prelude 残留 `__zeta_call_tool__`

- **现象**：run `41606325272` 的 `completion-bridge.test.ts` 退出码 1；错误为
  `globalThis.__zeta_call_tool__ is not a function`。
- **触发点**：v18.16 把 `completion().attempts()` 加进 prelude。
- **根因**：prelude 绝大多数调用点已改成 `__zeta_call_tool__`，但 attempts 分支
  仍调用旧名；runtime 只安装 `__zeta_call_tool__`。这是跨面 token 对，静态扫不到
  另一侧，只有运行测试能抓。
- **修复**：prelude 改成 `__zeta_call_tool__`。
- **门禁**：`merge-contracts` 固定跑 `completion-bridge.test.ts`；另外 eval
  runtime/prelude 的 `__zeta*` 对已列入 sentinel/品牌审计范围（后续补条目）。
- **fixed by**：`ceca124008f`。

## CI-024 上游新增 i18n 键没有调用点

- **现象**：run `41636522109` 的 native/unit 桶
  `i18n-message-references.test.ts` 报 8 个新的 `ask*` orphan 键（问答面板的
  取消/自动选择/多选/问题数等文案）。
- **触发点**：v18.16 合并带入了 en/zh/messages 的键，但当前树没有对应 call site。
- **根因**：上游这批键对应尚未落地的 UI 路径；Zeta 的 orphan guard 要求新键要么
  有调用点，要么登记在已审阅 backlog，合并没有同步 baseline。
- **处理**：加入 `packages/coding-agent/test/i18n-orphan-keys.baseline.txt`，按
  文件注释作为“已审阅、暂未接线”的清单，不删键、不伪造调用点。
- **门禁**：`merge-contracts` 固定跑 `i18n-message-references.test.ts`。
- **fixed by**：`131f4c9b33a`。

## CI-025 品牌替换后 QR/catalog/browser 契约未同步

- **现象**：run `41606325272` 多个桶红：
   - `packages/tui/test/qrcode.test.ts`：URL 已改成 `my.zeta.sh`，但 golden
     hash/mask 仍是 `my.omp.sh` 的值；
   - `packages/catalog/test/compat-compile.test.ts`：committed `rules.json` 仍是旧
     编译结果（`originator: omp`、旧默认模型）；
   - `packages/catalog/test/deepinfra-provider.test.ts`：实现发 `sort_by=zeta`，
     测试仍断言 `sort_by=omp`；
   - browser relay 测试断言 `zetacode` 文案/端口 9224，源码已是 `zeta`/43153。
- **触发点**：`dc0d77f037c` 的品牌 sweep 只改了部分面。
- **根因**：品牌替换跨越「输入 fixture / golden / 实现常量 / 测试断言」四个面；
  sweep 改了 URL 没重算 QR，改了实现没更新断言，改了端口没改测试。
- **处理**：重算 QR golden；`gen:compat` 重生成 rules；DeepInfra 断言改
  `zeta`；browser 文案统一 `zeta`，端口测试改为解析实际 `DEFAULT_PORT`。
- **门禁**：`merge-contracts` 固定跑 catalog compat、qrcode、browser-worker-exit；
  `merge-gate` 也已包含 catalog/LSP/导出/i18n 的生成物检查。
- **fixed by**：`ceca124008f`。

## CI-026 merge test audit 未归一化 prose 品牌词

- **现象**：修复提交后本地 `merge-gate` 的 `upstream test/fixture import` 报
  `browser-relay-detach.test.ts` 的 `modified-upstream-missing`，但该文件实际包含
  上游新增的 iframe/detach 用例。
- **触发点**：`ceca124008f` 把测试断言里的 `zetacode` 改成 `zeta` 后。
- **根因**：审计的 `normalizeForUpstreamComparison` 只归一化了 scope、`.zeta`、
  `zetacode` 等路径/包名，没有把 prose 里的 `zeta` 映射回 `zetacode`；三方合并因此把
  合法品牌改动当成漏掉的上游 hunk。
- **修复**：归一化链末尾增加 `zeta → omp`（只用于审计比较，不改产品）。
- **门禁**：该审计本来就在 `audit-tests`；`scripts/audit-merge-tests.test.ts`
  继续跑在 `guard-tests`。
- **fixed by**：`ceca124008f`。

## CI-027 package.json merge guard 扫上游 merge 历史导致 gate 卡死

- **现象**：v18.16 sync 分支的 `merge-gate --gates-only` 在
  `package.json merge-drop` 停 >1 小时；单独跑该守卫也 15 分钟不结束。
- **根因**：`git rev-list --merges main..HEAD` 把 v18.16 tag 历史里的 56 个上游
  merge 全算进来；每个 merge 又对 38 个 manifest × 4 个 revision 调 `git show`，
  约 8,500 次子进程。守卫本意只检查“本分支自己做的 merge”。
- **修复**：改为 `git rev-list --first-parent --merges`，只沿分支第一父链；同时
  `merge-gate` 显式传 `--base <base>`。
- **门禁**：该守卫自身保留在 `merge-gate`；新增回归测试覆盖 first-parent 选择。
- **fixed by**：`dc0d77f037c`（已包含在 sync 分支）。

## CI-028 契约问题只有 CI 才发现，本地 gate 未覆盖

- **现象**：v18.16 的三轮 CI 分别暴露 session/fork、eval 全局、i18n orphan、
  QR/catalog/browser 契约；本地 `--gates-only` 全绿，直到 CI 才红。
- **根因**：`merge-gate` 的 guard 覆盖生成物和静态扫描，但不跑“跨面契约”测试；
  CI 的 7 个分桶才是第一次运行这些断言。
- **处理**：新增 `merge-contracts` guard step，固定跑：
  catalog compat、QR golden、session client provenance、drop-session trash、
  eval completion bridge、browser worker exit、i18n orphan、settings zh。
- **门禁**：`merge-gate.ts` 的 `merge-contracts`；与 `guard-tests` 一起在本地
  `--gates-only` 阶段执行。
- **fixed by**：本次门禁提交。

## CI-029 v18.16 main 合并后的 browser 测试竞态

- **现象**：`main` 的 `Test coding-agent native/unit (TS)` 在
  `browser-relay-tab-isolation.test.ts` 与 `browser-open-options.test.ts` 偶发红；
  rerun 仍红，但同一代码的 `sync/omp-release/v18.16.0` run `41640622236` 是绿。
- **根因**：两个都是测试夹具竞态，不是合并改动的运行时回归。
  - relay 用例只等 2 秒让 Chrome 扩展把新标签列进 relay；CI 负载下事件晚于
    2 秒，`acquireTab` 报 `No page target matched "First"` 或 “Selected tab did
    not become available”。
  - open-options 用例先 bind 一个临时的 Bun server 再关闭，然后假设该端口仍然
    无人监听；CI 上端口可能被其他进程复用，导航反而成功，触发
    `Expected promise to reject, but it resolved`。
  - `main` 与绿色 sync 分支的代码差异只有 `document/ci-issue-log.md` 和
    `document/upstream-sync.md` 两处台账文档。
- **修复**：relay 用例在 `acquireTab` 前轮询 relay `/json`，确认标题已出现；
  open-options 改用 1023（Linux 特权端口、低于所有临时端口范围），不依赖
  “刚释放的端口不会被复用”。
- **门禁**：不降低任何 CI 阈值；保留原断言和测试触发条件，只消除夹具竞态。
- **fixed by**：`1ea59944579`。`main` CI run `41662377662` 已绿；同一提交的
  Coverage run `41662394241` 也成功（报告型，不是测试门禁）。

## CI-030 Windows 发布：WSL DNS 与 Bazel symlink

- **现象**：`release-v2 1.4.9` 在 Windows 刷新 `MODULE.bazel.lock` 时失败：
  `cargo-bazel splice` 创建 `.bazelignore` symlink，报 `os error 1314`；
  WSL 里 `github.com` 被解析成 `127.0.0.1`，无法下载 Linux `cargo-bazel`。
- **根因**：Windows 用户未开 symlink 权限；WSL 自动生成的
  `/etc/resolv.conf` 指向的 stub resolver 对 `github.com` 返回 `127.0.0.1`
  （Windows 侧 DNS 正常，解析到 `20.205.243.166`）。不是仓库代码问题。
- **处理**：
  - WSL `/etc/resolv.conf` 改为 `nameserver 8.8.8.8`，并在 `/etc/wsl.conf`
    设 `generateResolvConf=false`（否则重启会被覆盖）；
  - Bazel 改走 WSL，使用 Windows 的 Bazel repository cache；Linux
    `cargo-bazel` 从缓存预热；发布在本机完成。
- **结果**：`v1.4.9` release run `41683262821` 绿；GitHub Release 已发布，
  npm `@linxiraos/{zeta,main,ide}@1.4.9` 已可查。
- **规则**：这是环境绕过，不是降低 CI；发布源代码仍以 `1ea59944579` 的
  完整 CI 为准。换镜像/代理时同样只允许绕过网络，不允许绕过测试或断言。

## CI-031 Studio 来源署名被品牌守卫误判；本地未跟踪文件漏扫

- **现象**：集成 run `43867774185`（`faad80d5ed4`）的 `Lint, type check & web build` 在 `Brand residue guard` 失败，2 hits / 0 missing assertions：`rep-docs/product.md:20` 与 `rep-docs/product.zh-CN.md:16`。两行均为 OMP Studio 官方仓库的来源署名；npm 安装、renderer build、first-load、cargo-deny 和 workspace 类型检查已通过。其后的 check-job 步骤未执行，不能算通过。
- **触发点**：`sync/studio-release/v0.2.0` 的唯一 `full=true / skip_npm=true` dispatch；job `133300965984`。
- **根因**：`brand-check.ts` 的扫描集合来自 `git ls-files`；本地零命中是在新 `rep-docs` 文件暂存之前取得。CI 扫到了提交后的新文件，而 `OMP Studio` 规则没有为这两条明确的来源署名配置精确 `allowPatterns`。这不是产品名回退，不应删除用户要求保留的上游归属。
- **当时的处理**：只记录，不改规则、不再推送或 dispatch；保留失败 job 原始日志与诊断至 `~/.zeta/parked-evidence/2026-11-16/studio-v0.2.1-final/sealed-final6/ci-check-job.log` 及 `ci-brand-failure-diagnosis.json`。整条 CI 的最终结论另记于同目录，本文不预判。
- **建议方案 / 门禁**：下一批给这两条来源链接增加精确 path+line 内容模式，仍拒绝同文件里的其他产品残留；提交前必须在完整暂存清单上运行扫描。保留官方仓库链接、双语一致性和公开归属；禁止把整个 `rep-docs/` 加入豁免。

## CI-032 原生 desktop 三处 Clippy 错误

- **现象**：同一集成 run `43867774185` 的 `Validate Rust workspace (bazel)` 在 `Clippy (workspace lint policy on opted-in crates)` 退出123。此前 Rust tests 已执行17/17并全部通过；后续其他 Clippy/rustfmt 步骤未执行，不能当绿。
- **触发点**：`faad80d5ed4`，job `133300966004`；目标 `//crates/pi-natives:pi_natives`。
- **根因**：`desktop/linux/wayland/mod.rs:183` 的 `WaylandBackend::new` 仅剩同文件测试调用（约682行），生产构建未使用而触发 `dead_code`；`desktop/ax.rs:1159` 的 `Option.map(...).unwrap_or_default()` 触发 `clippy::map_unwrap_or`；`desktop/types.rs:298` 的自引用 `Vec<DesktopObservationNode>` 触发 `clippy::use_self`。CI `-D warnings` 把三项判为错误；本机 Rust 格式检查不覆盖 Clippy。
- **当时的处理**：只记录，保留 `sealed-final6/ci-rust-validate.log`；不加 allow/suppress、不改阈值、不发第二次 push。主工作台 job 已通过；TermIDE nextest3580passed/9skipped，属于独立 job，不能抵消本项失败。
- **建议方案 / 门禁**：下一批将同文件测试的构造迁到 `new_observed(display, false)` 后删除仅测试使用的构造器包装，使用 `map_or_else` 和 `Self` 表达原语义，再跑原生目标的严格 Clippy；保留所有测试及 passive Computer 权威边界。

## CI-033 Desktop 夹具的干净检出与异步等待

- **现象 / 触发点**：run `43867774185` 的 job `133317011347` 在 `Test desktop contract suite` 失败。`memory-credentials.test.mjs` 两项和 `prediction.test.mjs` 三项报 repo `temp/` 下 `mkdtemp` ENOENT；managed relay 三项报 owner changed / ECONNREFUSED。
- **根因**：两个文件直接 `mkdtemp(<repo>/temp/<prefix>)`，没有创建干净 checkout 缺省不存在的父目录，已由代码与日志确认。relay 夹具最多100次 `setImmediate` 便假设描述文件读取已完成，失败后恢复 fetch；这与未完成 attach 的症状一致，但竞态因果尚未独立确认，不能直接标作 flaky。
- **处理**：保存 `sealed-final6/ci-job-133317011347.log`，不重跑或削弱断言。已有真实 Electron 证据保留原范围，不用它抹掉 CI 红。
- **建议方案 / 门禁**：夹具先创建 repo-local temp 父目录；relay 改用有截止时间的明确 socket/handshake 状态并在 finally 结清 pending attach。干净检出执行完整 contract 命令。

## CI-034 Gateway ask 夹具没有跟随原生 session hook

- **现象 / 触发点**：run `43867774185`，runtime job `133317011578` 的 `web-gateway/ask-channel.test.ts` 四项在创建 wrapper 时抛 `session.setBeforeNextUserTurn is not a function`，尚未进入 ask 行为断言。
- **根因**：`makeSession()` 仅把 `{sessionManager:{},subscribe(){…}} as never` 交给真实 `AgentSessionWrapper`，但 wrapper 现在会安装 TimeTravel/Worktree 的原生 turn hooks；实际 `AgentSession` 已有这些方法。
- **处理**：保存 `ci-job-133317011578.log`，不向生产 attach 添加 optional/no-op 回退；其余40个 runtime chunks通过不抵消这4项失败。
- **建议方案 / 门禁**：改为符合原生会话生命周期的真实隔离夹具或现有完整 fixture，保留多问题、超时、取消与错误响应断言。

## CI-035 UI/TUI 与 spotlight 断言失败

- **现象 / 触发点**：run `43867774185`，UI job `133317011299` 三个 chunks失败：prewalk-off:202 持久化前后对象出现内部 identity symbol 与 `details:undefined` 差异；date-cwd-reminder:1686 的第2个请求缓存未读到最新 tool result；中文设置 `encourageEdits` label 仍为 `Encourage Edits`。native packages job `133317011572` 的 spotlight 双窗口 code 查询得到0，期望2。
- **根因**：spotlight实现的 role 为 `zeta.spotlight.code`，test:705 仍过滤 `omp.spotlight.code`，已确认契约落点不一致；label在原生 setting注册时未本地化。prewalk对象身份差异与cache边界失败尚未定位产品原因，禁止把后一项归为纯夹具或重钉旧错误行为。
- **处理**：保存两 job 日志，只记录。上游/本地断言与产品不变量需成对核对；没有运行“重试确认”。
- **建议方案 / 门禁**：spotlight保留双窗口内容、编号与折叠行为，移除对内部role字符串的耦合；中文文本做实际注册本地化；prewalk验证持久语义而非瞬态对象标记；cache继续断言跨日期和context hook后复用历史到最新tool result。

## CI-036 安装 prepack 的 Vite 配置加载失败

- **现象 / 触发点**：run `43867774185`，install job `133317011945`：`gen:web-app` → `npm run build` 在加载 `web-app/node_modules/.vite-temp/vite.config.ts…mjs` 时无法解析 `vite-module-runner:import-meta-resolve`，prepack与安装方式 smoke退出1。
- **根因**：已确认在嵌套 prepack/build 路径发生；相同提交check job的直接 `npm ci`/renderer build通过，因此不是已修的SheetJS来源拒绝。是否Bun调用链环境或Vite/Vitest配置交互尚未定位，不声称已解决。
- **处理**：保存 `ci-job-133317011945.log`；不换旧Vite版本、不跳build、不发布半成品。
- **建议方案 / 门禁**：下一批沿 `scripts/install-tests/run-ci.sh` 与 `packages/coding-agent/scripts/build-web-app.ts` 的真实嵌套入口诊断，证明安装payload实际可用；直接renderer build不能替代这个场景。

## CI-037 Native/unit 九个失败 chunks

- **现象 / 触发点**：run `43867774185`，job `133317011394`，1191files/120chunks 中9个chunks失败，原始日志 `sealed-final6/ci-job-133317011394.log`，去重前完整用例标记与chunk目录为 `ci-final-failure-inventory.json`。
- **已确认分组**：`session-sync.test.ts`/`subagents.test.ts` 与CI-034同为夹具缺 `setBeforeNextUserTurn`；Computer policy/workspace/budget、Host services夹具在缺repo temp父目录时ENOENT，部分teardown再抛undefined host。`tools/computer.test.ts` 多项在 `supervisor.ts:319` 的会话实例fence抛ToolAbortError。另有ACP context/mode、disposing后空abort重试、cost-gate print exit、CLI help inventory、task prompt-cache切会话断言失败。
- **根因边界**：hook与temp前置条件由日志确认；Computer旧fixture是否缺实例key、retry/cost/cache是否产品回归尚未定位。禁止将49条原始用例标记都归咎于同一个夹具、或声称已验证基线同红。
- **处理**：只记录，不重跑确认、不跳用例、不为旧fixture放松实例fence；保留实际原生Linux addon与smoke通过证据。
- **建议方案 / 门禁**：按9个失败chunk分别诊断；先统一干净检出temp初始化与真实会话fixture，再验Computer取消/授权/stop和cache/成本/重试的实际可见行为。

## CI-038 Singleton 夹具与 advisor fork

- **现象 / 触发点**：run `43867774185`，job `133317011772`：`advisor-toggle.test.ts:924` 的fork历史对象包含断言失败；service preview四项与service fencing一项因repo temp父目录缺失而ENOENT。日志还输出desktop app not found；没有把它直接列为已确认的独立失败原因。
- **根因**：temp父目录问题与CI-033同类；advisor预期对象与带内部identity symbol的实际历史对象不匹配，是否仅瞬态身份或持久成本丢失尚未定位。
- **处理**：保存原始 `ci-job-133317011772.log` 与完整标记目录；不将未定位advisor归成flaky，不因其他singleton测试通过而给本桶绿。
- **建议方案 / 门禁**：先修隔离fixture前置条件，再按持久化/跨fork成本语义检查advisor，避免把内部对象身份当用户契约。

## 2026-11-16 本轮集成 CI 最终结果

提交 `faad80d5ed4d947283e7ebc7cbc445aa1d3d39ec` 已一次发布到 `sync/studio-release/v0.2.0`；唯一 `full=true / skip_npm=true` run [43867774185](https://github.com/Linxira-OS/linxira-zeta/actions/runs/43867774185) 已 completed/failure：8success、9failure、18skipped、0cancelled。CI-031–038涵盖9个失败job；均只登记，未第二次推送或dispatch。

已通过：Bazel lock、release metadata、主工作台、TermIDE（3580passed/9skipped）、Linux baseline/modern addon构建及原生smoke、跨目标addon构建、CLI smoke、TS workspace fast。Rust validation的17个测试目标通过后在Clippy失败；check job在品牌守卫前的npm安装、renderer build、first-load、cargo-deny和类型检查通过，不代表整个job绿。

跨目标job `133300966557` 为当前提交真构建 `linux-musl-x64-baseline` 与 `win32-x64-baseline`，产物 `native-addons` ID `14229990773`，105233356bytes，SHA256 `413367ee7dfaf2202fc93ea837dbf5819fe103df4c9ae70828c6881e5b7406e3`。Linux pair产物 `14227223884`，106993749bytes，SHA256 `30966cf6508c09ea79d705008fb012fe7d0ddbeee28f86eeffcca1c17effbd51`。这补充了当前提交的构建来源；不等于Windows实机被动捕获/物理Wayland/完整release验收。Linux产物本地下载超时，仅留不完整文件，明确不可加载或计为本地验收。

最终job JSON、全部失败日志、源码核账、当前/提交字节hash、传输回执与未决原因存于 `~/.zeta/parked-evidence/2026-11-16/studio-v0.2.1-final/sealed-final6/`。本段与CI-031–038是推送后的本地未提交记录，不伪称已在远端。

本批只携入上述已封存记录，不改其结论或顺手修复 CI-031–038。当前 2FA、共享 IM 对话与中文命名另走独立验收和一次新 CI。

## CI-039 QQ allowlist 的既有本地回归失败

- **现象**：本批运行 `packages/channels/test/runtime.test.ts`，`QQ allowlists hold bare numbers and match group:/user: peers` 在第199行期望 `["group:42", "user:900"]`，实际仅 `["group:42"]`。该文件4项通过、1项失败；不是本轮 CI 结论。
- **范围证据**：发布基线 `faad80d5ed4` 的独立工作区执行同一文件也得到4通过、1失败，同样缺 `user:900`。当前共享 IM 改动未引入该失败；具体 adapter/allowlist 根因尚未诊断。
- **处理**：只登记，不改 QQ 适配器、allowlist 或断言。共享 IM 的69项后端回归及16项界面回归另行通过，不拿它们覆盖此失败。
- **后续门禁**：在选定的 IM 平台批次诊断 bare peer 的 group/user 匹配，保留群聊与私聊的允许/拒绝四条行为；外部 QQ 实际投递仍未验收。


## 2026-11-17 主线整合本地检查记录

- **内存预算（REQ-065）**：`memory-soak.ts --seconds=180 --max-rss-growth-mib=384` 真实退出1；
  360个采样，RSS起点120.27MiB、峰值3083.91MiB、增长2963.64MiB。收据为
  `~/.zeta/parked-evidence/2026-11-17/main-consolidation/memory-soak.json`。
  使用复用的1.5.1 addon，未证明当前源码native；超额根因未定位，门槛保留、不重跑或放宽。
- **Bazel锁生成**：`gen-bazel-lock.ts` 900秒停在main repo mapping并超时；
  `bazel-lock-drift.ts`实际通过依赖覆盖，不替代输入新鲜度或成功生成。未新编native。
- **Windows symlink**：保存的browser-open-options用例在创建UUID路径symlink时EPERM；
  同批61项通过、1项失败。沿用CI-001环境类别，不skip、不删断言，不声称已通过。
- 上述失败不阻断用户要求的源码整合；发布仍需完整CI与当前工件证据。

## 2026-11-17 main push CI observation

- One authorized push moved remote main from `e37c23c144d` to `13accf0fc1849852b9814b1f072a5e45a2f1d928` and started [CI 44041010183](https://github.com/Linxira-OS/linxira-zeta/actions/runs/44041010183) at 2026-11-17T07:44:24Z. The run was still in progress at inspection; no final green or all-job verdict is claimed. No second push, dispatch, tag or release was performed.
- **CI-040 — Bazel lock input freshness:** completed job `133895326044` failed `Check crate_universe entry`. Recorded/current Cargo.toml hashes are `53413b4df80985bbba16a2dcd8c2fff497647e2d304581698d7aa47b848f3dd0` / `80e8a3a7b0e54427c78cf987cd4a722fcd3e4b21b27e663690becabaef023b18`; Cargo.lock hashes are `c604ba518aba6dd91886ed782d3b7aca7ec704e67954186623cfba0ac986db77` / `ae8f1135da9d9842aea8db6745beafce49a52c3f941dacef6167a8c05307967a`. The seven crate-coverage tests passed; they do not establish input freshness. Reuse the CI-generated regeneration artifact if it matches final inputs, otherwise regenerate the real lock on Linux; do not replace only hashes or weaken the check.
- **CI-031 recurrence:** completed job `133895622040` again rejected the two legal source credits at `rep-docs/product.md:20` and `rep-docs/product.zh-CN.md:16` (2 hits, 0 missing assertions). Preserve attribution; repair the guard's existing legal-attribution classification and verify product-brand rejection remains effective.
- At the same observation, main-workspace, TermIDE and release-metadata jobs succeeded; native and Rust jobs were still running. Paused/manual publication skips are not release success. Original logs and job snapshot: `local://main-ci-push-20261117.json`, `artifact://54760`, `artifact://54758`.

---

## 附：1.4.8 发布链路时间线（供后续复盘）

| 步骤                              | 提交 / run                    | 结果                                         |
| --------------------------------- | ----------------------------- | -------------------------------------------- |
| 上游 18.15.0 真合并               | `2fffbf6b95a`                 | 56 冲突，修复 `54d6a69fad4` / `e7d7f7f5776`  |
| 分享退役 + 防复活守卫             | `676287bf017` / `4b03d257ad8` | 本地类型检查绿                               |
| 合并 `main` 进发布线              | `15183edda34`                 | 3 冲突；`nix/bun.nix` 红（CI-004）           |
| 第一次 bump（`release.ts`）       | `73720678956`                 | 版本覆盖不全（CI-007）；bazel 锁红（CI-005） |
| 锁产物提交                        | `570ad1ef4ff`                 | bazel 锁绿                                   |
| 补齐版本 + changelog + main Cargo | `710f90c50fa`                 | 版本一致性绿；workbench 二进制仍红（CI-008） |
| 安装 CI 构建的二进制              | `7c8ca480536`（tag `v1.4.8`） | lint/check/锁/产物二进制绿                   |
| 最终发布 run                      | `41436102660`                 | 失败于导出查看器元数据（CI-009）；**未发布** |

**当前状态（2026-11-03）**：tag `v1.4.8` 仍指向 `7c8ca480536`，未移动；GitHub
Release 未创建、npm 仍是 `1.4.7`。用户已要求暂停发布链，先记录问题并准备上游
`v18.16.0` 合并。CI-019 已修但仍在工作树，未提交/未推分支，因此 `main` 仍按
旧提交判红；发布继续保持暂停。
