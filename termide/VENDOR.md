# VENDOR — TermIDE 工作台快照账目

| 项         | 值                                                         |
| ---------- | ---------------------------------------------------------- |
| 上游仓库   | https://github.com/termide/termide                         |
| 来源 commit | tag `0.41.0` = `f49a4c40ef6aaaff0741f7a52cefbf163dd9519b`(2026-10-12 bump;前一快照 `0.38.0` = `c94e9a7e7f9b01c1c743c8087f8da9049c30dc06`,更早 `0.35.0` 时代的 `main` HEAD = `b1400585e2aeadca23b6b86a86010e612e3dddae`) |
| 引入方式   | `git archive 0.41.0`(无上游 git 历史;上游 `.github/` 需显式删除,见「bump 流程」) |
| 协议       | MIT(`LICENSE` 追加 Linxira-OS/Zeta 版权行)              |
| 引入日期   | 2026-09-28(0.38.0 bump 2026-10-06;0.41.0 bump 2026-10-15)  |
| npm 包     | `@linxiraos/ide`(bin `zeta-ide` + 短别名 `zeta-i`,Rust 二进制分发,版本对齐 Zeta 产品线;2026-09-30 由未发布的 `@linxiraos/work` 更名) |
| 角色       | 工作台/壳:可视化文件管理器(最底层入口)+ 内嵌虚拟终端 pane;`zeta` 与 `zeta-editor`(短别名 `zeta-e`)作为 pane 内子进程经 PTY 组合,零代码耦合。产品愿景:把完整 Linux 无图形界面运维迁移到 Agent 流程的 TUI 底座 |

## 出局方案(选型记录)

- fresh(Rust,GPL-2.0):上游 sinelaw/fresh(9k★)活跃,但 **GPL 不可 vendor**(与 editor/VENDOR.md 同一结论);其 Orchestrator(worktree 工作区、agent 会话编排、Everything 对话框)仅作 MIT 重实现的交互参考。
- 自建壳于 Zeta 主仓库:污染 OMP 可合并面,否决。

## 与仓库其余部分的关系

- **不是根 Cargo workspace 成员**:根 `Cargo.toml` members 显式列 `crates/*`;termide 自带 `[workspace]`(members `crates/*`,自有 `rust-toolchain.toml` = 1.91.1、`Cargo.lock`)。在 `termide/` 内跑 cargo 命令,与根 workspace 完全隔离。
- **不是 Bun workspace 包**(同 `editor/`、`web-ui/` 先例)。
- **被 `main/`(zeta 工作台)以 path 依赖链接 5 个 crate**:`termide-core`、`termide-config`、`termide-keyboard`、`termide-panel-terminal`、`termide-theme`。因此 `termide/**` 的改动可以让 `main_tests` 变红,`.github/workflows/ci.yml` 的 `main_tests` 触发路径已含 `termide/`(2026-10-15 修复;此前只匹配 `main/`,纯 vendor 改动会让该 job 自跳)。
- 构建产物走 `termide/target/`(根 `.gitignore` 全局 `target/` 已覆盖)。

## 修改层清单(对上游快照的全部偏离)

0.41.0 bump(2026-10-15)逐项重放核验;「0.41.0 处置」列为本次重放结论,「上游演进/重放处理」列记录 0.35.0→0.38.0→0.41.0 与本层的交叠处理。

| # | 文件 | 偏离 | 上游演进/重放处理 | 0.41.0 处置 | 日期 |
| --- | --- | --- | --- | --- | --- |
| 1 | `LICENSE` | 版权行追加 Linxira-OS/Zeta | 无冲突,原样重放 | **保留**(上游版权行 0.41 已改 `2025-2026 Nick Nizovtsev and TermIDE contributors`,我方行追加其下);`npm/*/LICENSE` 三份副本同步刷新 | 2026-09-28 |
| 2 | `npm/`(新增) | `@linxiraos/ide` 主包 + `ide-windows-x64`/`ide-linux-x64` 平台 leaf(bin `zeta-ide` + `zeta-i`;2026-09-30 由 work 更名,含 launcher win32→windows 映射修复与 leaf `files` 白名单) | 上游不涉 npm 面;每次 bump 后按发布流程重编 leaf 内嵌二进制并提交 | **保留**;并修掉 `npm/ide/VENDOR.md` 的陈旧副本(原记 0.35.0 `b1400585`、3 行,且随包发出去) | 2026-09-28 |
| 3 | `rustfmt.toml`(新增) | 空配置文件,仅注释 | 无冲突,原样保留 | **保留**——0.41.0 tar 根条目已核实仍无 `rustfmt.toml` | 2026-09-28 |
| 4 | `crates/core/src/event.rs` | `PanelEvent::OpenPath` 增 `line`/`col` | 上游大改 event.rs(0.39–0.41 新增 `OpenLink`/`OpenLinkExternal`/`CredentialsRequired`/`CredentialsAccepted`);OpenPath 本体仍未动 | **保留**(additive hunk 干净合并;上游至今无 `line`/`col`) | 2026-10-03 |
| 5 | `crates/core/src/wide_cells.rs` | `mark_variation_selector_tails` 的 `#[allow(deprecated)]`(ratatui 0.30.0/0.30.2 版本线差) | 上游未动 | **保留**(ratatui 仍钉 0.30.0) | 2026-09-28 |
| 6 | `crates/panel-terminal/src/hyperlink.rs`(新增) | OSC 8 URI 解析(region 定位/percent-decode/`?line=&col=`/`:line:col` 回退) | 上游无此物,但 0.41 新建了共享链接模型 `crates/core/src/links.rs`(`LinkTarget`) | **保留**;新增 `hyperlink::HoveredLink` 把 OSC 8 悬停表示接进上游 `LinkTarget`(见 7/10) | 2026-10-03 |
| 7 | `crates/panel-terminal/src/link_detection.rs` | 原为 `LinkType::Hyperlink(String)` 变体 + `link_text` 臂 | **0.41 删除了整个本地 `LinkType` 与 `link_text`**,改由 `termide_core::links::link_at()` 直接返回 `LinkTarget` | **取上游**(变体作废;OSC 8 的悬停表示迁到 `hyperlink::HoveredLink`,文本检测不再需要本地枚举) | 2026-10-03 → 2026-10-15 |
| 8 | `crates/panel-terminal/src/terminal/mod.rs` | `Cell.link`、`TerminalScreen.current_hyperlink/hyperlinks/title`、intern 表、`put_char` 戳链 | 上游新增 `reported_cwd`/`bell`/`extra` 字段;两组并存,`Cell` 构造点全部补齐 | **保留**(第 2 次重放,干净合并);同文件另登记既有未记录的 `CellStyle::dim`(见 20) | 2026-10-03/15 |
| 9 | `crates/panel-terminal/src/terminal/vt100_parser.rs` | `osc_dispatch`(OSC 0/2 title + OSC 8 链接 + pending_ops 内联 flush)+ 7 组测试 | 上游 0.41 的 `osc_dispatch` 与 0.38 **逐字节相同**:同样以 `if !matches!(params.first(), Some(&b"7") \| Some(&b"9")) { return; }` 早退、不含任何 OSC 8 代码(评估中的「0.41 改成只放行 7/9」实为「0.38 起就是如此」——我们的树才是那个被打开早退的版本) | **保留**(第 3 次合并):打开早退,0/2 title、8 链接、7/9;9 cwd 三段并成单实现;上游 0.41 对该文件的其他改动一并带上;CSI-u 掩码修正另登记(见 21) | 2026-10-03 → 2026-10-15 |
| 10 | `crates/panel-terminal/src/mouse.rs` | 原: Ctrl 悬停/点击走 OSC 8 优先(区域跨行串联、URI 解析→`OpenPath{line,col}`,非本地 URI 交 OS) | 上游 0.41 重定义链接语义: `Ctrl+Click` = 工作台内跟随(`PanelEvent::OpenLink`),`Ctrl+Alt+Click` = 外部打开(`PanelEvent::OpenLinkExternal`),并把 `open` 依赖移出该 crate | **语义重写**: OSC 8 区域仍优先(`osc8_region_at`);本地目标 `Ctrl+Click` 发 `OpenPath{path,line,col}`(宿主契约),`Ctrl+Alt+Click` 发 `OpenLinkExternal(LinkTarget::Path)`;非本地 URI 经 `LinkTarget::from_href` 走 OpenLink/OpenLinkExternal,其余(`mailto:` 等)发 `PanelEvent::OpenExternal`(0.41 的正规外发路径,替代原 `open::that`) | 2026-10-03 → 2026-10-15 |
| 11 | `crates/panel-terminal/src/lib.rs` | `set_env` 注入 `ZETA_WORKBENCH=1` + 清扫 `TERM_PROGRAM`/`WT_SESSION`/`COLORTERM`;`osc_title()`/`shell_pid()` 访问器;PTY title 集成测试 + env 清扫测试 | 上游 0.39–0.41 改动该文件的 spawn 路径;`set_env` 本体未动,注入块原位重放 | **保留**;`hovered_link` 类型改为 `hyperlink::HoveredLink`;Alt 和弦另登记(见 22) | 2026-10-03/04 → 2026-10-15 |
| 12 | `crates/panel-terminal/src/shell_utils.rs` | Windows shell 链:`$SHELL` 仅认绝对 Windows 路径、pwsh→powershell 优先、Git Bash 仅经真实 Git 安装推导、禁 `where bash.exe`(WSL launcher 陷阱) | 上游未动 `detect_shell` | **保留**(`diff 0.38.0..0.41.0` 已核实该文件在窗口内无上游改动) | 2026-10-01 |
| 13 | `crates/app/src/cli_args.rs`(新增) | `file[:line[:col]]`/目录 positional 解析(`OpenedTarget`,盘符冒号豁免) | 上游无此物 | **保留** | 2026-10-03 |
| 14 | `crates/app/src/lib.rs` | `pub mod cli_args` + re-export | 上游模块表继续演进 | **保留**(两行追加,干净) | 2026-10-03 |
| 15 | `crates/app/src/app/mod.rs` | `open_path_in_editor_at`(1-based 行列,clamp 语义)+ `open_cli_path_at` | 上游 0.39–0.41 改动该文件(`--restore`/projects/`--config`),但 `open_cli_path` 主体未变 | **保留**(干净合并) | 2026-10-03 |
| 16 | `crates/app/src/app/event_handler/mod.rs` | `OpenPath` 解构加 `..` | 上游新增 `OpenLink`/`OpenLinkExternal` 臂等 | **保留**(干净合并) | 2026-10-03 |
| 17 | `src/main.rs` | positional 解析块(目录→chdir 项目根、`file_targets`(已解析的 `OpenedTarget` 列表))、detached 传解析后路径、open 循环走 `open_cli_path_at`、cli 测试改 String | 上游 0.40 增 `-r/--restore`、0.41 改 `--config` 语义并新增 `hosted_args()`(把文件与 `--config`/`--log-level`/`--no-lsp`/`--restore` 一起传给 detached 实例) | **重放并适配**: 解析块仍在 `Cli::parse()` 后;`hosted_args(cli, files: &[&OpenedTarget])` 收已解析目标(hosted 进程从项目根启动,必须给绝对路径);`handle_detached_instance_cli(cli, file_targets)` 与 always_detachable 两处调用点同步;测试改 String + `hosted_args(&cli, &[])` | 2026-10-03 → 2026-10-15 |
| 18 | `CHANGELOG.md` | `[Unreleased]` 段登记我方各层 | 上游新增 0.39/0.40/0.41 段(注意:上游 0.41 的 CHANGELOG 丢了 `## [0.38.0]` 标题,按上游原样) | **保留**(我方段置于上游各段之上) | 2026-10-03 → 2026-10-15 |
| 19 | `crates/panel-terminal/src/render.rs` | `cell_style()` 提取(reverse→theme 色→`DIM` 等属性) | 上游窗口内未动该文件 | **保留**(既有偏离,本次补登记) | 2026-10-13(`a573f5cc2a1`) |
| 20 | `crates/panel-terminal/src/terminal/{mod.rs,csi_handlers.rs}` | `CellStyle::dim`(SGR 2「faint」)+ SGR 22 同时清 bold 与 dim(ECMA-48) | 上游 0.41 仍无 dim,窗口内未动该文件 | **保留**(既有偏离,本次补登记;PSReadLine 内联预测靠它读作暗色后缀) | 2026-10-13(`a573f5cc2a1`) |
| 21 | `crates/panel-terminal/src/terminal/vt100_parser.rs` | CSI-u 推入按**位掩码** `flag & 1 == 1` 判定(而非 `flag == 1`) | 上游仍为 `flag == 1`,窗口内未动该文件 | **保留**(既有偏离,本次补登记;`>1u`/`>3u` 也要启用 CSI-u) | 2026-10-13(`73d9794c539`) |
| 22 | `crates/panel-terminal/src/lib.rs` | `send_ctrl_char`: `Alt+Ctrl` 和弦发 `ESC` + 控制字节;普通字符前有 Alt 时先发 `ESC`(xterm 编码) | 上游窗口内未动这段按键转发 | **保留**(既有偏离,本次补登记) | 2026-10-13(`73d9794c539`) |

行 19–22 是 0.38.0 快照里**已经存在但未登记**的偏离,本次 bump 补登记(`diff -rq` 0.38.0 上游树 vs 本树)。

### 本次 bump 的上游窗口取证(0.38.0 → 0.41.0,上游树逐文件 diff)

| 我方偏离文件 | 窗口内上游改动行数 | 结论 |
| --- | --- | --- |
| `panel-terminal/src/terminal/vt100_parser.rs` | **0** | `osc_dispatch` 两版逐字节相同,合并是「打开早退」而非「上游重写」 |
| `panel-terminal/src/terminal/mod.rs` | **0** | 偏离原样保留 |
| `panel-terminal/src/terminal/csi_handlers.rs` | **0** | 偏离原样保留 |
| `panel-terminal/src/shell_utils.rs` | **0** | 偏离原样保留 |
| `panel-terminal/src/render.rs` | **0** | 偏离原样保留 |
| `core/src/wide_cells.rs` | **0** | 偏离原样保留 |
| `panel-terminal/src/mouse.rs` | 39 | 链接语义重写 → 语义重放(行 10) |
| `panel-terminal/src/link_detection.rs` | 93 | 本地 `LinkType` 被删 → 取上游(行 7) |
| `core/src/event.rs` | 30 | additive,干净合并(行 4) |
| `app/src/app/mod.rs` | 151 | 干净合并(行 15) |
| `app/src/app/event_handler/mod.rs` | 16 | 干净合并(行 16) |
| `app/src/lib.rs` | 2 | 干净合并(行 14) |
| `src/main.rs` | 271 | 重放并适配 `--restore`/`--config`/`hosted_args`(行 17) |
| `crates/unicode-width-fix` | 仅新增 `COPYRIGHT`/`LICENSE-APACHE`/`LICENSE-MIT` | 纯文档/许可改动,`[patch.crates-io]` 路径补丁自动带上 |

(即评估 §6 的 `git diff 0.38.0..0.41.0 -- <file>` 收尾命令已全部执行,`rustfmt.toml` 缺失一项由 0.41.0 tar 根条目清单核实。)

## bump 流程

1. `git -C temp/termide fetch origin --tags && git log --oneline 0.38.0..<tag>` 确认窗口,**只取 tag**(上游 `main` 常领先于最新 tag,不要用 `main`);
2. `git archive <tag> | tar -x -C termide`;**0.41.0 起上游没有 `.gitattributes`**(0.38.0 也没有),`git archive` **会**带上 `.github/` —— 解包后必须显式 `rm -rf termide/.github`;
3. 逐项重放本表:干净项直接取上游,冲突项按「0.41.0 处置」列语义重放(`git merge-file --diff3 ours 旧上游树 新上游树` 是好工具:base=旧上游树可把「我们的偏离」与「上游演进」分开);
4. 核对锁文件:本次 `termide/Cargo.lock` **已与上游 0.41.0 逐字节一致**(本树 `Cargo.toml` 与上游 0.41.0 逐字节相同,故无需本地解析;发布构建走 `--locked`),副作用是该文件原有的 CRLF 被规范化为 **LF**(`main/Cargo.lock`/根 `Cargo.lock` 本就是 LF);`main/Cargo.lock` 在 path 依赖变化后重新生成(`[patch.crates-io] unicode-width` 镜像保留,两个锁里 `unicode-width 0.2.2` 均无 `source` 行 ⇒ 走路径补丁);根 `Cargo.lock` 不含 `termide-*`,不动;
5. 在 `termide/` 与 `main/` 各自 workspace 内跑 fmt / check / clippy / nextest;
6. 重编两个平台 leaf 二进制并提交(见下);
7. 更新本文件来源 commit/修改层;单 commit 提交(`vendor: bump termide to <sha>`)。

## 两个平台叶子二进制的重编配方

发布 job 自己用的方法(`scripts/ci-release-build-binaries.ts`):

```
# termide/ 内,Windows(GNU target)
cargo build --release --locked -p termide --target x86_64-pc-windows-gnu
# WSL/native linux
cargo build --release --locked -p termide
```

产出 `termide/target[/x86_64-pc-windows-gnu]/release/termide[.exe]`,拷进
`npm/ide-windows-x64/bin/termide.exe`、`npm/ide-linux-x64/bin/termide-linux-x64`;
`--version` 必须等于本文件来源 tag(CI 矩阵**没有** windows 腿,`.exe` 只能本地出)。
`.cargo/config.toml` 已为 `x86_64-pc-windows-gnu` 配好 mingw 链接器;`russh`/`aws-lc-sys` 还需要 `nasm`。

**stamp 陷阱(实测)**：`crates/core/build.rs` 用 `git rev-parse --short=8 HEAD` + `git status --porcelain` 打
`TERMIDE_VERSION = "<pkg> (<sha>[-dirty])"`。所以
(a) 构建前工作树必须干净(否则带 `-dirty`)——先提交快照,再构建,二进制随后单独提交;
(b) WSL 里 **git worktree 不能用来构建 linux 叶子**:worktree 的 `.git` 是含 Windows 绝对路径的 gitfile,
WSL git 报 `fatal: gitfile does not point to a valid repository` ⇒ 静默退化成无 stamp 的 `termide 0.41.0`。
linux 叶子要在一个 **native checkout(clone)** 里构建(旧的 0.38.0 叶子带 `(c4559e00)` 戳,即当年在根 checkout 上编的);
(c) **换快照后必须强制重跑该 build script**。它的 `rerun-if-changed` 只挂 `build.rs` 与
`../../.git/HEAD`、`../../.git/index`——而 vendored 子树的 `termide/.git` **不存在**(本仓库连 worktree 根都不是它的仓库根),
所以整棵源码被替换**不会**自动触发重跑,target 里可能沿用上一次打出的 `TERMIDE_VERSION`。
强制办法任选:`touch termide/crates/core/build.rs`、`cargo clean -p termide-core`、或换一个空 `CARGO_TARGET_DIR`
(本次 vendor 两个平台叶子都用了换新 target/新 clone 的办法);
(d) stamp 的值取自**构建时刻的 HEAD**:同一棵树在 vendor commit `540284a1` 与合并 main 后的 `b9cac734` 上构建会得到
两个不同的干净戳(都不是 `-dirty`)。发布口径只要求版本号(AGENTS 13 类),SHA 只用于区分同版本多次构建;
(e) 免执行核对 stamp:`grep -a -o -E '0\.(38|41)\.0 \([0-9a-f]{8}(-dirty)?\)' <leaf binary>`(两个平台叶子各只有一条命中)。
注意别拿错文件:根 checkout 里**同一相对路径**的叶子仍是上一版的 0.38.0(会打印 `termide 0.38.0 (c4559e00)`)。

## 上游 0.38.0→0.41.0 重大结构变更(供后续重放参照)

- **链接层重写**:新增 `crates/core/src/links.rs`(`LinkTarget::{Url,Path}`、`links_in`/`link_at`/`from_href`/`is_foreign_scheme`),`PanelEvent` 新增 `OpenLink`/`OpenLinkExternal`;`panel-terminal/src/link_detection.rs` 删除本地 `LinkType`/`link_text` 改调 `core::links`;语义变为 `Ctrl+Click` 内随、`Ctrl+Alt+Click` 外开;`panel-terminal` 移除 `open` 依赖。
- **凭据保险库**:新增 `crates/secrets`、`crates/core/src/credentials.rs`、`PanelCommand::{ProvideCredentials,CancelCredentials}`、`PanelEvent::{CredentialsRequired,CredentialsAccepted}`、`SecretText`/`CredentialAttempt`;`app/src/app/vault.rs`。
- **agent 面大量新增**:`crates/agent-recall`、`agent-core` 的 recall/recap/loop-guard/prune/failure 等、`panel-agent` 的 failure/unfinished、projects 后台驻留(`-r/--restore`、`Alt+1..9`)、`--config` 语义改为「既读又存」、设置即改即存。
- **文件管理器**:`Alt+F9` 解包(新增 `file-ops/src/worker/unpack.rs`、`app/.../modal/unpack_handler.rs`)、掩码选择、挂载点、打包压缩级别。
- **未变的**:`Panel` 契约只动 `icon()` 返回类型(`Option<&'static str>` → `Option<&str>`)与新增默认方法 `focus_click_acts()`;`RenderContext`/`PanelConfig`/6 个必需方法未动。`termide-lsp` 在窗口内零改动。toolchain 1.91.1、crossterm 0.29、ratatui 0.30.0 不变,`[patch.crates-io] unicode-width` 镜像仍需保留。
