# VENDOR — TermIDE 工作台快照账目

| 项         | 值                                                         |
| ---------- | ---------------------------------------------------------- |
| 上游仓库   | https://github.com/termide/termide                         |
| 来源 commit | tag `0.38.0` = `c94e9a7e7f9b01c1c743c8087f8da9049c30dc06`(2026-10-06 bump;前一快照 0.35.0 = `b1400585e2aeadca23b6b86a86010e612e3dddae`) |
| 引入方式   | `git archive 0.38.0`(无上游 git 历史;上游 `.github/` 不随树) |
| 协议       | MIT(`LICENSE` 追加 Linxira-OS/Zeta 版权行)              |
| 引入日期   | 2026-09-28(0.38.0 bump 2026-10-06)                        |
| npm 包     | `@linxiraos/ide`(bin `zeta-ide` + 短别名 `zeta-i`,Rust 二进制分发,版本对齐 Zeta 产品线;2026-09-30 由未发布的 `@linxiraos/work` 更名) |
| 角色       | 工作台/壳:可视化文件管理器(最底层入口)+ 内嵌虚拟终端 pane;`zeta` 与 `zeta-editor`(短别名 `zeta-e`)作为 pane 内子进程经 PTY 组合,零代码耦合。产品愿景:把完整 Linux 无图形界面运维迁移到 Agent 流程的 TUI 底座 |

## 出局方案(选型记录)

- fresh(Rust,GPL-2.0):上游 sinelaw/fresh(9k★)活跃,但 **GPL 不可 vendor**(与 editor/VENDOR.md 同一结论);其 Orchestrator(worktree 工作区、agent 会话编排、Everything 对话框)仅作 MIT 重实现的交互参考。
- 自建壳于 Zeta 主仓库:污染 OMP 可合并面,否决。

## 与仓库其余部分的关系

- **不是根 Cargo workspace 成员**:根 `Cargo.toml` members 显式列 `crates/*`;termide 自带 `[workspace]`(members `crates/*`,自有 `rust-toolchain.toml` = 1.91.1、`Cargo.lock`)。在 `termide/` 内跑 cargo 命令,与根 workspace 完全隔离。
- **不是 Bun workspace 包**(同 `editor/`、`web-ui/` 先例)。
- 构建产物走 `termide/target/`(根 `.gitignore` 全局 `target/` 已覆盖)。

## 修改层清单(对上游快照的全部偏离)

0.38.0 bump(2026-10-06)逐项重放核验;「上游演进」列记录 0.35.0→0.38.0 与本层的交叠处理。

| # | 文件 | 偏离 | 上游演进/重放处理 | 日期 |
| --- | --- | --- | --- | --- |
| 1 | `LICENSE` | 版权行追加 Linxira-OS/Zeta | 无冲突,原样重放 | 2026-09-28 |
| 2 | `npm/`(新增) | `@linxiraos/ide` 主包 + `ide-windows-x64`/`ide-linux-x64` 平台 leaf(bin `zeta-ide` + `zeta-i`;2026-09-30 由 work 更名,含 launcher win32→windows 映射修复与 leaf `files` 白名单) | 上游不涉 npm 面;0.38.0 未动二进制构建脚本(`build.rs` 仅 env 变更),leaf 内嵌二进制仍按发布流程重编提交 | 2026-09-28 |
| 3 | `rustfmt.toml`(新增) | 空配置文件,仅注释 | 无冲突,原样保留 | 2026-09-28 |
| 4 | `crates/core/src/event.rs` | `PanelEvent::OpenPath` 增 `line`/`col` | 上游大改 event.rs(ShowInfo/ShowChecklist/RequestAttention 等);OpenPath 本体未动,干净重放 | 2026-10-03 |
| 5 | `crates/core/src/wide_cells.rs` | `mark_variation_selector_tails` 的 `#[allow(deprecated)]`(ratatui 0.30.0/0.30.2 版本线差) | 上游未动;ratatui 仍钉 0.30.0,保留 | 2026-09-28 |
| 6 | `crates/panel-terminal/src/hyperlink.rs`(新增) | OSC 8 URI 解析(region 定位/percent-decode/`?line=&col=`/`:line:col` 回退) | 上游无此物,原样带回 | 2026-10-03 |
| 7 | `crates/panel-terminal/src/link_detection.rs` | `LinkType::Hyperlink(String)` 变体 + `link_text` 臂 | 上游未动,干净重放 | 2026-10-03 |
| 8 | `crates/panel-terminal/src/terminal/mod.rs` | `Cell.link`、`TerminalScreen.current_hyperlink/hyperlinks/title`、intern 表、`put_char` 戳链 | 上游新增 `reported_cwd`/`bell` 字段与 `extra` 半格字段;两组并存,`Cell` 构造点全部补齐 | 2026-10-03 |
| 9 | `crates/panel-terminal/src/terminal/vt100_parser.rs` | `osc_dispatch`(OSC 0/2 title + OSC 8 链接 + pending_ops 内联 flush)+ 7 组测试 | 上游同版本也加了 `osc_dispatch`(OSC 7/9;9 cwd 报告):合并为单实现——我方 flush 结构保留,上游 7/9;9 分支并入;上游 bell/cwd 测试与我方测试并存 | 2026-10-03 |
| 10 | `crates/panel-terminal/src/mouse.rs` | Ctrl 悬停/点击走 OSC 8 优先(区域跨行串联、URI 解析→`OpenPath{line,col}`,非本地 URI 交 OS) | 上游只动了 find bar 底部停靠几何(120-155 行区),与本层(182 行后)不相交,干净重放 | 2026-10-03 |
| 11 | `crates/panel-terminal/src/lib.rs` | `set_env` 注入 `ZETA_WORKBENCH=1` + 清扫 `TERM_PROGRAM`/`WT_SESSION`/`COLORTERM`;`osc_title()`/`shell_pid()` 访问器;PTY title 集成测试 + env 清扫测试 | 上游 spawn 路径重构(`new_with_cwd_env`/`spawn_shell` env 参数、`read_screen` 中毒恢复、`SessionPanel`→`PanelState`);`set_env` 本体未动,注入块原位重放 | 2026-10-03/04 |
| 12 | `crates/panel-terminal/src/shell_utils.rs` | Windows shell 链:`$SHELL` 仅认绝对 Windows 路径、pwsh→powershell 优先、Git Bash 仅经真实 Git 安装推导、禁 `where bash.exe`(WSL launcher 陷阱) | 上游新增 `ShellKind`/`cd_command` 与 `get_shell_args` 重构,未动 `detect_shell`;本层原样重放 + `where_first` 助手 | 2026-10-01 |
| 13 | `crates/app/src/cli_args.rs`(新增) | `file[:line[:col]]`/目录 positional 解析(`OpenedTarget`,盘符冒号豁免) | 上游无此物,原样带回 | 2026-10-03 |
| 14 | `crates/app/src/lib.rs` | `pub mod cli_args` + re-export | 上游模块表大改(`layout_session`→`layout_store` 等);两行追加,干净 | 2026-10-03 |
| 15 | `crates/app/src/app/mod.rs` | `open_path_in_editor_at`(1-based 行列,clamp 语义)+ `open_cli_path_at`(上游 0.38 新 viewer 分发路径加行列参数;`open_cli_path` 委托保持上游签名) | 上游 `open_cli_path` 为 0.38 新物(目录→文件管理器、非文本→viewer);行列放置挂其 editor 分支 | 2026-10-03 |
| 16 | `crates/app/src/app/event_handler/mod.rs` | `OpenPath` 解构加 `..` | 上游大改该文件(新事件臂);OpenPath 臂未动,干净重放 | 2026-10-03 |
| 17 | `src/main.rs` | positional 解析块(目录→chdir 项目根、`file_paths`/`file_targets`)、detached 传解析后路径、open 循环走 `open_cli_path_at`、cli 测试改 String | 上游 "session"→"instance" 全量改名(`handle_detached_instance_cli`)并改走 `open_cli_path`;两者融合重放 | 2026-10-03 |
| 18 | `CHANGELOG.md` | `[Unreleased]` 段登记我方三层(链接/探针+清扫/positional) | 保留上游 0.36-0.38 全部版本段,我方段置顶 | 2026-10-03 |

上游 0.35.0→0.38.0 重大结构变更(供后续重放参照):`crates/session`→`crates/project` 改名、`SessionPanel`→`PanelState`、`LayoutManagerSession`→`LayoutPersistence`(app crate 新增 `agent_panel`/`open_projects`/`projects_menu`)、agent 面板与 MCP/HTTP、OSC 7/9;9 cwd + BEL 注意标记(`osc_cwd.rs`、`windows_proc.rs` 新模块)、find bar 底部停靠、`dunce`/`toml_edit`/objc2 新依赖、描述文案改为 all-in-one workspace。

## bump 流程

1. `git -C temp/termide fetch origin && git -C temp/termide log HEAD..origin/main` 确认新提交;
2. `git -C temp/termide archive <commit> | tar -x -C termide`(覆盖前 `diff -r` 对账本清单修改层,逐项重新应用并登记;上游 `.github/` 不随树);
3. 更新本文件来源 commit/修改层;单 commit 提交(`vendor: bump termide to <sha>`)。
