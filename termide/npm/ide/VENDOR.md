# VENDOR — TermIDE 工作台快照账目(npm 分发副本)

本包是 **Zeta 仓库 vendored TermIDE 快照** 的 npm 分发入口。权威账目在仓库根
`termide/VENDOR.md`(本文件随 `@linxiraos/ide` 发布,故只保留出处与版本口径)。

| 项         | 值                                                                 |
| ---------- | ------------------------------------------------------------------ |
| 上游仓库   | https://github.com/termide/termide                                   |
| 来源 commit | tag `0.41.0` = `f49a4c40ef6aaaff0741f7a52cefbf163dd9519b`(2026-10-12) |
| 前一快照   | tag `0.38.0` = `c94e9a7e7f9b01c1c743c8087f8da9049c30dc06`(2026-10-06) |
| 更早快照   | `main` HEAD `b1400585e2aeadca23b6b86a86010e612e3dddae`(0.35.0 时代,2026-09-28) |
| 引入方式   | `git archive <tag>`(无上游 git 历史;上游 `.github/` 不随树)      |
| 协议       | MIT(`LICENSE` 追加 Linxira-OS/Zeta 版权行)                       |
| 修改层     | 见仓库根 `termide/VENDOR.md` 的「修改层清单」;本包 `bin/` 下的二进制由该快照本地重编(`--version` 必须等于上表来源 tag) |

## bump 流程

1. `git -C temp/termide fetch origin --tags`,确认窗口;
2. `git archive <tag> | tar -x -C termide`(上游 `.github/` 需显式删除);
3. 逐行重放 `termide/VENDOR.md` 的修改层清单,重编 `bin/` 下两个平台二进制;
4. 更新本文件与根账目的来源 commit/版本;
5. 单 commit 提交(`vendor: bump termide to <sha>`)。
