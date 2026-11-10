# 产品面（2026-11-06 规范）

产品只有三个面，每个面只有一个入口。新代码先归到其中之一；归不进去的说明它是基建，
不是产品面——别为它发明第四个入口。

| 产品面 | 入口 | 形态 | 技术 | 代码落点 | 发布 |
|---|---|---|---|---|---|
| **Work Studio** | `zetacode serve` | 浏览器 Web UI | Vite 7 + React；宿主回答 `/api/v1/*` | `web-app/src/studio/`；`packages/coding-agent/src/server/{studio-host,studio-web-app}.ts` | 随 `@linxiraos/zeta` 出货（`dist/web-app`，`prepack` 暂存） |
| `zetacode` | `zetacode` | CLI / TUI agent | Bun + TS | `packages/coding-agent/` | `@linxiraos/zeta` |
| `zetaide` | `zetaide` | **终端 IDE** | Rust `termide/`（ratatui + crossterm）+ `@linxiraos/editor` | `termide/crates/*` | `ide-publish.yml` → `@linxiraos/ide` |

## 命名变更（2026-11-06 用户裁定）

- 「zetawork」作为**产品面名字**退役 → **Work Studio**，归 Web UI。
- **不存在 Rust UI。** 旧的 `main/crates/zetawork-gui`（egui + WebView2）与
  `main/crates/zeta-main`（ratatui 嵌套终端工作台）已于 2026-11 从树中移除
  （git 历史保留）；后者的语义被 Work Studio 取代。
- `zetawork` 仍是 `@linxiraos/main` 的**已退役包名**（弃用保留，源码不在树里）。

## 三件常被混淆的事

1. **`zetaide` 不是 GUI，也不是 `zetacode` 的 TUI 皮肤**：它是独立的终端 IDE
   （ratatui + crossterm），编辑器内核复用 termide 的 `panel-editor` + LSP，发布线
   独立（`ide-publish.yml`），与渲染器裁决无关。
2. **`zetacode` 的 TUI 与 Work Studio 是同一宿主的两个面**：共用 `/api/v1/*` 契约、
   `ops/` 家族与会话状态，不得各自造一套查询/命令。
3. **`desktop/` 是 Work Studio 的桌面版**（Electron + 无浏览器引擎版，由
   `release_desktop` 打包）；`web-ui/` 是冻结快照。历史文档里的"Web UI"指的是
   当时的内嵌壳，不是 Work Studio。

## 相关但不属于产品面

- `packages/coding-agent/src/server/studio-host/`：Work Studio 的宿主实现（基建，归属
  `coding-agent` 包）。
- `web-ui/`：只作快照与历史对照，不构建、不发布。
