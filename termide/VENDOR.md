# VENDOR — TermIDE 工作台快照账目

| 项         | 值                                                         |
| ---------- | ---------------------------------------------------------- |
| 上游仓库   | https://github.com/termide/termide                         |
| 来源 commit | tag `0.46.0` = `a027ca788cd4c9d24f060cdcd3195ca2e475617b`(2026-10-26 bump;前一快照 `0.41.0` = `f49a4c40ef6aaaff0741f7a52cefbf163dd9519b`) |
| 引入方式   | `git archive 0.46.0`(无上游 git 历史;上游 `.github/` 需显式删除,见「bump 流程」) |
| 协议       | MIT(`LICENSE` 追加 Linxira-OS/Zeta 版权行)              |
| 引入日期   | 2026-09-28(0.41.0 bump 2026-10-15;0.46.0 bump 2026-10-29)  |
| npm 包     | `@linxiraos/ide`(bin `zetaide`,Rust 二进制分发,版本对齐 Zeta 产品线;2026-09-30 由未发布的 `@linxiraos/work` 更名) |
| 角色       | 工作台/壳:可视化文件管理器(最底层入口)+ 内嵌虚拟终端 pane;`zetacode`/`zetaide` 作为 pane 内子进程经 PTY 组合,编辑器为进程内面板,零代码耦合。产品愿景:把完整 Linux 无图形界面运维迁移到 Agent 流程的 TUI 底座 |

## 出局方案(选型记录)

- fresh(Rust,GPL-2.0):上游 sinelaw/fresh(9k★)活跃,但 **GPL 不可 vendor**(与 editor/VENDOR.md 同一结论);其 Orchestrator(worktree 工作区、agent 会话编排、Everything 对话框)仅作 MIT 重实现的交互参考。
- 自建壳于 Zeta 主仓库:污染 OMP 可合并面,否决。

| 24 | `crates/panel-terminal/src/lib.rs`(`Terminal::try_wait`) | **子进程退出查询**：`is_alive` 由读线程 EOF 驱动，而 ConPTY 在 Windows 上客户端退出时不发 EOF（实测 4 s 内恒 true）⇒ 增加 `pub fn try_wait()` 直接问 child（`portable_pty::Child::try_wait`），供 zetawork GUI 的「会话结束」信号使用 | 上游无此物 | **保留**（Zeta 2026-10-17：GUI 真 PTY 需要平台无关的退出信号） | 2026-10-17 |

| 25 | `crates/panel-terminal/src/lib.rs`(`Terminal::send_bytes`) | **原始按键写入**：GUI 拥有键盘，需要把按键/控制序列直接写进 PTY；私有的 `send_input` 暴露为 `send_bytes` | 上游无此物 | **保留**（Zeta 2026-10-17：GUI 输入转发） | 2026-10-17 |
| 26 | `crates/agent-recall/src/sessions.rs`、`crates/ui/src/fuzzy.rs`、`crates/panel-outline/src/alatyr.rs` | **新 toolchain 的 clippy 修**：两处 `sort_by(|a,b| b.1.cmp(&a.1))` 改 `sort_by_key(Reverse(..))`；Alatyr 的 `loop { let Some(x) = .. else { break } }` 改 `while let` | 上游未动 | **保留**（Zeta 2026-10-18：`cargo clippy --workspace --all-targets -- -D warnings` 在 Linux 上把这三个 lint 当错误，vendor 快照自身的 CI 早于新 lint；语义等价，仅形态改写） | 2026-10-18 |
| 27 | `crates/modal/src/directory_picker.rs` | **Windows 盘符页**：新增 `at_drives`/`drives()`/`starting_at_drives()`，`GetLogicalDrives()` 列出挂载卷；`新建项目` 从盘符页开始，卷根按 Backspace 回到盘符页；另把该文件里写死 `/newdir` 的渲染断言改成接受宿主分隔符（Windows checkout 上原本必红） | 上游无盘符页（unix 上 `/` 可达全部挂载） | **保留**（Zeta 2026-10-19：用户要求 Windows 上从 C/D/E/F 开始找目录） | 2026-10-19 |
| 28 | `src/main.rs`、`src/editor_entry.rs`、`crates/app/src/app/panel_operations.rs` | **窗口标题品牌面**：`Termide: <path>` → `zetaide: <path>`（启动、建/换项目、reattach 三处），字面量；`crates/ui-render/src/theme_dropdown.rs` 另补一条命中测试（每行可见主题的点击必须映射回该行） | 上游写的是自家产品名 Termide | **保留**（Zeta 2026-10-19：终端标签页标题是用户可见品牌面，产品名是 zetaide；命中测试是鼠标路径唯一覆盖） | 2026-10-19 |

| 29 | `src/main.rs` | **CLI 展示名**：`#[command(name = "termide", about = "Terminal IDE")]` → `name = "zetaide"`、`about = "Linxira Zeta IDE"`；`--help` 的 `Usage:` 行原本印上游 `termide.exe` | 上游写自家产品名 | **保留**（Zeta 2026-10-22：`zetaide --help` 是对外品牌面，与偏离 28 的窗口标题同一决定） | 2026-10-22 |

| 30 | `build.rs`、`assets/termide.rc`（新增） | **Windows PE 图标**：为 `termide` / `termide-editor` 编入与 zetawork 共用的 `icon.ico`；上游无 Windows 资源，Explorer/安装器原本显示通用图标。`build.rs` 把模板里的 `@ZETA_ICON@` 换成绝对路径再交给 windres（旧版 windres 按 CWD 解析 `ICON`，新版按 rc 文件目录解析，绝对路径两边都对） | 上游无此物 | **保留**（Zeta 2026-10-25：所有 Zeta 主 exe 同一 logo，名称区分产品；release windows-gnu 缺 windres 时构建失败，避免发无图标二进制） | 2026-10-25 |
| 35 | `build.rs`、`src/main.rs`、`src/editor_entry.rs` | **`--version` 显示 Zeta 产品线**：Cargo workspace 保持本次上游 `0.46.0`（便于后续快照重放）；`build.rs` 从根 `package.json` 读取 Zeta 版本，注入 `ZETA_DISPLAY_VERSION`，`zetaide --version` / `termide-editor --version` 输出 `1.4.x (termide 0.46.0)` | 上游只显示自身 crate 版本 | **保留**（Zeta 2026-10-25：IDE 是 Zeta 产品，但 vendored 内部版本不追 Zeta 线） | 2026-10-25 |

## 与仓库其余部分的关系

- **不是根 Cargo workspace 成员**:根 `Cargo.toml` members 显式列 `crates/*`;termide 自带 `[workspace]`(members `crates/*`,自有 `rust-toolchain.toml` = 1.97.1、`Cargo.lock`)。在 `termide/` 内跑 cargo 命令,与根 workspace 完全隔离。
- **不是 Bun workspace 包**(同 `editor/`、`web-ui/` 先例)。
- **本树的编辑器专用入口是 `@linxiraos/editor` 的载荷**:`src/bin/termide-editor.rs`(偏离 23)编出的
  `termide-editor[.exe]` 进 `editor/npm/editor-{windows,linux}-x64/bin/`,由 `@linxiraos/editor`
  launcher(无 bin,按路径解析)与 `plugins/official/pi-messenger/editor-binary.ts` 解析;
  `$EDITOR` 用法(位置参数 `FILE[:line[:col]]`、阻塞到退出)即由该入口保证。
- **被 `main/`(zeta 工作台)以 path 依赖链接 5 个 crate**:`termide-core`、`termide-config`、`termide-keyboard`、`termide-panel-terminal`、`termide-theme`。因此 `termide/**` 的改动可以让 `main_tests` 变红,`.github/workflows/ci.yml` 的 `main_tests` 触发路径已含 `termide/`(2026-10-15 修复;此前只匹配 `main/`,纯 vendor 改动会让该 job 自跳)。
- 构建产物走 `termide/target/`(根 `.gitignore` 全局 `target/` 已覆盖)。

## 修改层清单(对上游快照的全部偏离)

0.41.0 bump(2026-10-15)逐项重放核验;「0.41.0 处置」列为本次重放结论,「上游演进/重放处理」列记录 0.35.0→0.38.0→0.41.0 与本层的交叠处理。

| # | 文件 | 偏离 | 上游演进/重放处理 | 0.41.0 处置 | 日期 |
| --- | --- | --- | --- | --- | --- |
| 1 | `LICENSE` | 版权行追加 Linxira-OS/Zeta | 无冲突,原样重放 | **保留**(上游版权行 0.41 已改 `2025-2026 Nick Nizovtsev and TermIDE contributors`,我方行追加其下);`npm/*/LICENSE` 三份副本同步刷新 | 2026-09-28 |
| 2 | `npm/`(新增) | `@linxiraos/ide` 主包 + `ide-windows-x64`/`ide-linux-x64` 平台 leaf(bin `zetaide`;2026-09-30 由 work 更名,含 launcher win32→windows 映射修复与 leaf `files` 白名单) | 上游不涉 npm 面;每次 bump 后按发布流程重编 leaf 内嵌二进制并提交 | **保留**;并修掉 `npm/ide/VENDOR.md` 的陈旧副本(原记 0.35.0 `b1400585`、3 行,且随包发出去) | 2026-09-28 |
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
| 29 | `crates/panel-terminal/src/lib.rs` | 新增 `new_with_shell_env`(把 `spawn_shell` 已有的 `env` 参数暴露出来;`new_with_shell` 语义不变) | 上游无此方法;`spawn_shell(..., env)` 自 0.41 起就带 env 槽,只是没有公开入口 | **保留**——工作台用它把自身 companion 目录前置到 pane 的 `PATH`(键入 `zetacode` 必须命中随包二进制,而不是旧 npm 全局副本) | 2026-10-19 |
| 30 | `crates/panel-ide/src/board.rs`(新增,替代上游 `todo.rs`)、`crates/panel-ide/src/lib.rs` | TODO 标记扫描器升级为**用户看板**:解析/写入 `<project>/.zeta/board/*.md` 卡片(`Column`/`Assignee`/`Card`/`load`/`create_card`/`save_card`/`move_card`/`delete_card`),`BoardPanel` 按列分组、`h`/`l` 移动即写文件、`e` 内联改标题;`lib.rs` 的 lower-left 视图 `LeftView::Todo` → `Board`、`Ctrl+T` → `toggle_board_view`。同一份模型被 GUI 的 `RightTab::Board`(`main/crates/zetawork-gui/src/board.rs`)与 TUI 的 `PaneKind::Board`(`main/crates/zeta-main/src/{board,widgets}.rs`)复用,故不引入第二套解析 | 上游 0.41 只有 `todo.rs` 标记扫描(无看板),窗口内该文件未动 | **保留**——Zeta 2026-10-20 路线图裁决「看板是 TODO 面板的升级,不另写解析」;标记扫描随之移除,上游若演进该文件需按本行语义重放 | 2026-10-20 |
| 31 | `crates/panel-terminal/src/kitty.rs`(新增)、`crates/panel-terminal/testdata/kitty-2x2.png`(新增,测试夹具)、`src/lib.rs`、`src/terminal/{mod.rs,vt100_parser.rs}`、`crates/panel-terminal/Cargo.toml` | **把 pane 变成真正的图形终端**:(a) `set_env` 不再删除 `TERM_PROGRAM`/`COLORTERM`,改为声明 `TERM_PROGRAM=zetawork`、`TERM_PROGRAM_VERSION=<crate 版本>`、`COLORTERM=truecolor`(同时剥离外层模拟器遗留的会话标记 `WT_SESSION`/`KITTY_WINDOW_ID`/`GHOSTTY_RESOURCES_DIR`/`WEZTERM_PANE`/`ITERM_SESSION_ID`/`VSCODE_PID`/`ALACRITTY_WINDOW_ID`:它们说的都是“上面那台终端才是渲染器”,且优先级高于 `TERM_PROGRAM`,泄漏会把图像协议指错);(b) `TerminalScreen` 新增 `cell_px`(渲染器上报的**设备像素**单元格)与 `graphics`(Kitty 图像库);(c) CSI 应答补齐:`CSI 16 t`→`CSI 6;<h>;<w>t`、`CSI 14 t`→`CSI 4;<h>;<w>t`、`CSI 18 t`→`CSI 8;<rows>;<cols>t`、DA1→`CSI ?1;2c`、XTVERSION→`DCS >|zetawork(<版本>) ST`,未知 cell 尺寸时不回答 14/16(宁缺毋滥);(d) 新增 `kitty.rs`:APC 扫描器(`ApcScanner`,`ESC _ … ESC \` 跨读取分片重组、超限 32 MiB 拒绝)、`a=t|T|p|d|q`、`m=1` 分块、`f=100` PNG / `f=32` RGBA / `f=24` RGB、`i`/`p` id、`c`/`r` 单元范围、`x`/`y`/`w`/`h` 源裁剪、`C=1`、`z`、`q=0|1|2`,回复 `ESC_Gi=<id>;OK ESC\`(`EINVAL`/`ENOENT`/`ENOTSUP`),`a=d` 的 `a/A/i/I/p/P`;(e) 新增 `StreamParser`(VT 解析 + APC 扫描 + performer),PTY 读线程改用它,宿主/测试也能直接喂字节;(f) `Terminal::set_cell_pixels`/`cell_pixels`/`graphics`,并把 cell 像素乘出的窗口像素写进 PTY `winsize`(`resize` 亦保留);上游是纯文本终端:无 graphics、无像素查询应答;上游 `set_env` 也剥外层身份(见偏离前版本),但没有自家身份可用 | **保留**——Zeta 2026-10-20:用户要求**自有 GUI 优先**:zetawork 面板自己渲染 Kitty 图像,并在 `CSI 16 t` 上回答真实设备像素单元,使 zetacode 的栅格密度精确(此前恒按 9×18 估算,图像被上采样模糊)。VENDOR 边界:图形**绘制**不在本 crate(TUI 的 ratatui 行文本无法画像素),而在 `main/crates/zetawork-gui` 的 egui blit(`blit::paint_images`/`image_rect`,serve 后端同源复用 `kitty` 模块);因此 zeta-main 的 TUI 面板(宿主为原生终端)解析并吞掉 APC,但**不画像素**——该路径本来也没有图形协议,留作后续(原生终端转发属明确不做的 workaround)。`U=1` 占位符未实现:客户端探测失败后回落到直接 `a=p` 放置,本实现画的正是后者 | 2026-10-20 |
| 23 | `src/bin/termide-editor.rs`(新增)、`src/editor_entry.rs`(新增)、`termide/tests/editor_entry.rs`(新增)、`crates/app/src/app/mod.rs`(`App::open_new_editor`) | **编辑器专用入口** `termide-editor`:`@linxiraos/editor` 平台叶的载荷。只装配编辑器面板(位置参数走既有 `cli_args`,空参数开一个空 buffer),`$EDITOR` 语义——阻塞到退出、关最后一个面板交回控制权(`set_layout_persistence(false)`)、**无** detach/headless/agent/补全选项面;入口用 `#[path]` 引入 `src/ui.rs` 与 `src/editor_entry.rs`,**不动** `src/main.rs`(上游改动最频繁的文件),也不新增 lib target | 上游无此物(上游只有 `termide` 一个 bin) | **保留**(Zeta 2026-10-17 裁决:内置编辑器接管 `@linxiraos/editor` 包名;见 `editor/npm/editor/VENDOR.md`) | 2026-10-17 |
| 32 | `src/main.rs`、`crates/logger/src/lib.rs`、`Cargo.toml`/`Cargo.lock` | **panic 现场捕获**:`install_panic_hook()` 在终端初始化前安装;把 panic message + `location` + `Backtrace::force_capture()` 追加到当前会话日志(新增 `termide_logger::file_path()`)和兜底文件(`%APPDATA%/termide/panic.log`、`~/.local/share/termide/panic.log`),随后恢复终端(关 raw、离开备用屏、显示光标)再打印到 stderr;非主线程 panic 只交给默认 hook(面板构建/agent worker 已被 `join`/`catch_unwind` 接住,不能在别人的帧上恢复终端) | 上游 hook 仅 `leave_terminal_modes()` + 默认 hook;默认 hook 的文字画在备用屏上,恢复后即被清掉,磁盘无任何记录 | **保留**(Zeta 2026-10-21:可移动卷上打开路径后 zetaide 秒退,Application Error 无记录;需要下一次崩溃可证) | 2026-10-21 |
| 33 | `crates/project/src/lib.rs`、`crates/project/src/maintenance.rs`、`src/main.rs` | **项目 key 保留卷名**:`project_key` 不再剥掉 `Component::Prefix`——`C:\Users\me\p` → `C/Users/me/p`、卷根 `D:\` → `D`(不再落到 `projects/` 本身)、UNC `\\server\share\p` → `unc/server/share/p`(verbatim 写法同 key);新增启动迁移 `migrate_rootless_layouts`,只把「当前卷上镜像路径确实存在」的旧无根目录移到 `projects/<卷>/` 下,否则原样保留并 warn;`..` 编码成 `__parent__` 防止逃出数据目录。另修两个 Windows-only 测试:路径断言改按组件比较,`set_modified` 改用可写句柄 | 上游剥 `Prefix` + `RootDir`,`D:\CODE` 与 `E:\CODE` 共用 `projects/CODE` | **保留**(Zeta 2026-10-21:两块可移动盘同名目录会互相继承面板/cwd/终端历史) | 2026-10-21 |
| 34 | `crates/agent-web/src/cdp.rs`、`crates/system-monitor/src/lib.rs`、`crates/app/src/app/mod.rs`、`crates/app/src/app/modal/batch_symlink.rs` | **Windows 上的 dead-code 门槛**:Unix-only 的管道 `Cdp` 读取线程、`MountCacheEntry`、reattach 用的 `keyboard_caps` 字段、相对符号链接辅助函数加 `cfg(unix)`/`cfg_attr(not(unix), allow(dead_code))`,否则 `cargo clippy ... -D warnings` 在 Windows checkout 上把它们当错误(上游 CI 只在 Linux 跑 clippy) | 上游未动;语义等价,仅平台门 | **保留**(Zeta 2026-10-21:本机验收命令必须绿) | 2026-10-21 |

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

`-p termide` 现在会同时编出**两个** bin:上面的 `termide`(工作台,进 ide 叶)与
`termide-editor`(编辑器专用入口,偏离 23,进 **editor 叶**):

```
# 同一个 target 目录里,编辑器载荷 = target[/x86_64-pc-windows-gnu]/release/termide-editor[.exe]
cargo build --release --locked -p termide --bin termide-editor --target x86_64-pc-windows-gnu   # Windows
cargo build --release --locked -p termide --bin termide-editor                                  # Linux
```

产物拷进 `editor/npm/editor-windows-x64/bin/termide-editor.exe`、
`editor/npm/editor-linux-x64/bin/termide-editor-linux-x64`(文件名必须与
`editor/npm/editor/launcher.js`、`plugins/official/pi-messenger/editor-binary.ts`
里的 `LEAF_EXE` 一致;`scripts/ci-release-publish.ts --editor` 在叶包缺这个文件时
**拒绝发布**)。免执行核对 stamp 同样适用:`grep -a -o -E '0\.41\.0 \([0-9a-f]{8}(-dirty)?\)' <leaf binary>`。
**本轮的 editor 叶二进制尚未构建/提交**(focused 约定:发版前动作),叶包 `bin/` 缺文件即为此。

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
- **未变的**:`Panel` 契约只动 `icon()` 返回类型(`Option<&'static str>` → `Option<&str>`)与新增默认方法 `focus_click_acts()`;`RenderContext`/`PanelConfig`/6 个必需方法未动。`termide-lsp` 在窗口内零改动。toolchain 1.97.1（Zeta 固定）、crossterm 0.29、ratatui 0.30.0 不变,`[patch.crates-io] unicode-width` 镜像仍需保留。

## 0.46.0 bump (2026-10-29)

- 上游 `0.41.0 → 0.46.0` 共 235 commits，精确 tree diff 492 路径（362 改、81 增、49 删）。
- 重放按 `git merge-file --diff3` 三方合并：408 个文件取上游，58 个保留 Zeta 偏离，34 个双方都改后合并，49 个上游删除的截图删除。
- 冲突/兼容处置：
  - `crates/modal/src/settings/input.rs` 取上游新 LSP 编辑器；旧 Zeta 的自绘 LSP 表单退役，`LspServerSettings.candidates` 字段保留（上游 `lsp_server.rs` 构造时填 `Vec::new()`），`config` 层仍能读写该字段。
  - `crates/panel-terminal/src/lib.rs` 保留我们的 `send_ctrl_char` 与上游 `shell_kind`，两边的新测试都保留。
  - `crates/panel-git-log/src/lib.rs` 保留 `set_file_filter`/`file_filter`，套上游 `new(paths, project_root)`。
  - `crates/panel-ide/src/lib.rs` 的 `GitStatusPanel::new` / `GitLogPanel::new` 适配上游双参数签名。
  - `crates/config/src/lib.rs` 导出 `LspCandidate`，移除上游已删的 `ReasoningParam`，加入 `DebugSettings`/`DebuggerSettings`。
  - `Cargo.lock` 以 0.46.0 为基线，再由本地 cargo 加入 `termide-panel-ide`/`termide-logger` 等 Zeta crate。
- 产品裁决（2026-10-29）：接受 `zetaide` 的 TermIDE 上游插件层（`crates/plugins`、设置页、Markdown 插件面板、命令/诊断）；Zeta 自己的插件面板仍只在 `zetawork-gui`，工作台 TUI 不承载插件层。`no_plugin_layer` 测试相应收窄为只扫描 `zeta-main`。
- Zeta ACP 偏离：新增 `provider = "zeta"` 直接运行 `zetacode acp`（不经 npx），ACP `clientInfo` 报 `zetaide`，并实现 `terminal/create|output|wait_for_exit|kill|release` 与 `terminal: true`，让 `zetacode` 的非 PTY bash 走 zetaide 客户端。
- 0.46 的 1.97.1 clippy 修：`agent-mcp`/`agent-acp` 的 `sort_by` 改 `sort_by_key(Reverse(..))`，`ui` 的 range loop 改迭代器，`panel-editor` 的 `needless_bool` 化简，`vfs`/`panel-terminal` 的固定宽度 `chunks_exact` 改 `as_chunks`；`core`/`file-ops`/`ui-render` 对中间测试模块加 `items_after_test_module` allow（上游 0.46 代码在更老的 clippy 上通过）。
- 上游新增能力：0.42 的图片 `read`、delegate/peer；0.43–0.44 的断点/DAP 调试器；0.45 的插件、项目信任/安全加固、delegate 暂停；0.46 的命令占位符与 delegate 限流。
- 验证：`cargo fmt --check`、`cargo check --workspace`（Linux）、`cargo test --workspace`（Linux）、`cargo check --workspace --target x86_64-pc-windows-gnu` 通过；ACP 专项 `termide-agent-acp` 50 tests、provider/config/app tests 全绿；`main` workspace 的 Linux/Windows GNU `cargo check` 与 `cargo test --workspace`（524 tests）也通过。Clippy 仅被上游 0.46 在 nightly 上新增的 `chunks_exact_to_as_chunks` / `unnecessary_sort_by` / `needless_range_loop` 拦住，不是本次重放引入。
