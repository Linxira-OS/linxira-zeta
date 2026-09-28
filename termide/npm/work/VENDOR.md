# VENDOR — TermIDE 工作台快照账目

| 项         | 值                                                         |
| ---------- | ---------------------------------------------------------- |
| 上游仓库   | https://github.com/termide/termide                         |
| 来源 commit | `main` HEAD `b1400585e2aeadca23b6b86a86010e612e3dddae`(fork 零落后核验,2026-09-28) |
| 引入方式   | `git archive HEAD`(无上游 git 历史;上游 `.github/` 不随树) |
| 协议       | MIT(`LICENSE` 追加 Linxira-OS/Zeta 版权行)              |
| 引入日期   | 2026-09-28                                                 |
| npm 包     | `@linxiraos/work`(bin `zeta-work` + 短别名 `zeta-w`,Rust 二进制分发,版本对齐 Zeta 产品线) |
| 角色       | 工作台/壳:可视化文件管理器(最底层入口)+ 内嵌虚拟终端 pane;`zeta` 与 `zeta-editor`(短别名 `zeta-e`)作为 pane 内子进程经 PTY 组合,零代码耦合。产品愿景:把完整 Linux 无图形界面运维迁移到 Agent 流程的 TUI 底座 |

## 出局方案(选型记录)

- fresh(Rust,GPL-2.0):上游 sinelaw/fresh(9k★)活跃,但 **GPL 不可 vendor**(与 editor/VENDOR.md 同一结论);其 Orchestrator(worktree 工作区、agent 会话编排、Everything 对话框)仅作 MIT 重实现的交互参考。
- 自建壳于 Zeta 主仓库:污染 OMP 可合并面,否决。

## 与仓库其余部分的关系

- **不是根 Cargo workspace 成员**:根 `Cargo.toml` members 显式列 `crates/*`;termide 自带 `[workspace]`(members `crates/*`,自有 `rust-toolchain.toml` = 1.91.1、`Cargo.lock`)。在 `termide/` 内跑 cargo 命令,与根 workspace 完全隔离。
- **不是 Bun workspace 包**(同 `editor/`、`web-ui/` 先例)。
- 构建产物走 `termide/target/`(根 `.gitignore` 全局 `target/` 已覆盖)。

## 修改层清单(对上游快照的全部偏离)

| # | 文件 | 偏离 | 原因 | 日期 |
| --- | --- | --- | --- | --- |
| 1 | `LICENSE` | 版权行追加 Linxira-OS/Zeta | MIT 分发声明 | 2026-09-28 |
| 2 | `npm/`(新增) | `@linxiraos/work` 主包 + `work-windows-x64`/`work-linux-x64` 平台 leaf(bin `zeta-work` + `zeta-w`) | npm 分发链路,照抄 `editor/npm/` 模式;平台二进制(`termide.exe`/`termide-linux-x64`)发布前本地构建后提交进 leaf 的 `bin/`(同 editor 的 ttt.exe 先例),发布经 `work-publish.yml` | 2026-09-28 |

## bump 流程

1. `git -C temp/termide fetch origin && git -C temp/termide log HEAD..origin/main` 确认新提交;
2. `git -C temp/termide archive <commit> | tar -x -C termide`(覆盖前 `diff -r` 对账本清单修改层,逐项重新应用并登记;上游 `.github/` 不随树);
3. 更新本文件来源 commit/修改层;单 commit 提交(`vendor: bump termide to <sha>`)。
