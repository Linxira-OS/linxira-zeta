# VENDOR — `@linxiraos/editor` 载荷账目

| 项         | 值                                                                 |
| ---------- | ------------------------------------------------------------------ |
| 载荷       | Zeta 内置编辑器：vendored TermIDE（`termide/`）的 `panel-editor`，编为**编辑器专用入口** `termide-editor` |
| 上游仓库   | https://github.com/termide/termide（快照 tag `0.41.0`）             |
| 协议       | MIT（上游版权行 + Linxira-OS 发行行，见本目录 `LICENSE`）           |
| 载荷引入   | 2026-10-17（此前的 vendored TTT Editor／Go 载荷于 2026-10-16 退场） |
| npm 包     | `@linxiraos/editor`（launcher，无 `bin`）+ 平台叶 `@linxiraos/editor-{windows,linux}-x64` |
| 偏离账本   | **`termide/VENDOR.md`**（本载荷是它对上游快照的偏离第 23 项：新增编辑器专用入口；本目录不重复登记） |
| 二进制来源 | `cargo build --release --locked -p termide --bin termide-editor`（在 `termide/` 内；Windows 侧走 `--target x86_64-pc-windows-gnu`），产物拷进对应平台叶的 `bin/`（见 `termide/VENDOR.md` 的重编配方） |

本目录不再有"vendored 第三方编辑器的独立台账"：载荷来自我们自己的 vendored
TermIDE 树，上游与偏离口径以 `termide/VENDOR.md` 为准。
