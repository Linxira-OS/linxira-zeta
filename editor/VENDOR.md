# VENDOR — TTT Editor 快照账目

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/eugenioenko/ttt |
| 来源 tag | `v1.5.0` |
| peeled SHA | `765048940a54d9765fa574ae62df43abed398fa8` |
| 引入方式 | `git archive v1.5.0`（无上游 git 历史）|
| 协议 | MIT（`LICENSE` 原样保留，未改动）|
| 引入日期 | 2026-09-19 |
| npm 包 | `@linxiraos/editor`（Go 二进制分发，版本对齐 Zeta 产品线）|

## 出局方案（选型记录）

- fresh（Rust，GPL-2.0）：臂长引用价值不足，协议不可 vendor。
- termide（MIT）：功能差一档（无多光标/插件）。
- subtree 全历史：ttt/.git 实测 57MB，超 50MB push 红线。
- submodule：树不可改、force-push 场景易碎。

## 修改层清单（对上游 v1.5.0 的全部偏离）

| # | 文件 | 偏离 | 原因 | 日期 |
|---|---|---|---|---|
| 1 | `internal/ui/mouse_edge.go`（新增）、`internal/ui/root.go`、`internal/ui/selectable_list.go`、`internal/ui/tabbar_widget.go`、`internal/widgets/table.go`、`internal/widgets/tree.go` | 右键触发改**按下沿检测**（Rising edge / `lastButtons` 比较），替代原始 `btn&Button2 != 0` 位测试 | 上游 bug：quirky SGR release（Tabby 实测，file dialog 关闭后）在 tcell `btnsDown` 集合里留下残留 Button2 位，tcell 对每个后续 motion 事件重放该位 → 鼠标仅移动就自动弹出右键菜单（v1.1.18 用户实测）。沿检测免疫残留位 | 2026-09-23 |
| 2 | `internal/ui/terminal_widget.go` `sgrButtonCode` | 内嵌终端鼠标转发的按钮映射修正：tcell Button2=secondary(右键) → SGR 2、Button3=middle → SGR 1（原映射把 Button2 当 middle） | 上游把 tcell 语义名（Primary/Secondary/Middle）与 X11 物理编号混用；与 tcell `input.go` 的 wire 1→Button3、wire 2→Button2 映射对齐 | 2026-09-23 |
| 3 | `internal/app/commands_view.go`（About 对话框）、`cmd/ttt/main.go`（--help） | 品牌面清理：删除上游 Website（tttedit.dev）/ GitHub（eugenioenko/ttt）链接，改为 Linxira-OS/linxira-zeta | fork 后品牌面归 Zeta 所有（AGENTS 品牌面登记制度） | 2026-09-23 |

## bump 流程

1. `git -C temp/ttt fetch origin && git -C temp/ttt tag` 确认新 tag；
2. `git -C temp/ttt archive <new-tag> | tar -x -C editor`（覆盖前 `diff -r` 对账
   本清单的修改层，逐项重新应用并登记）；
3. 更新本文件 tag/SHA/修改层；单 commit 提交（`vendor: bump editor to <tag>`）。
