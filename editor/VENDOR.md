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

（当前为纯净快照，无修改。后续每一处偏离在此登记：文件、内容、原因。）

## bump 流程

1. `git -C temp/ttt fetch origin && git -C temp/ttt tag` 确认新 tag；
2. `git -C temp/ttt archive <new-tag> | tar -x -C editor`（覆盖前 `diff -r` 对账
   本清单的修改层，逐项重新应用并登记）；
3. 更新本文件 tag/SHA/修改层；单 commit 提交（`vendor: bump editor to <tag>`）。
