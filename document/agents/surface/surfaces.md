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
- **不存在 Rust UI。** `main/crates/zetawork-gui`（egui + WebView2）不是产品面，也不恢复；
  `main/crates/zeta-main`（ratatui 嵌套终端工作台）的语义被 Work Studio 取代。
- `zetawork` 仍是 `@linxiraos/main` 的 **bin 名**（该包暂停、只保留名字）。bin 存在
  不等于产品形态存在；引用旧名时必须按这个区分。

## 三件常被混淆的事

1. **`zetaide` 不是 GUI，也不是 `zetacode` 的 TUI 皮肤**：它是独立的终端 IDE
   （ratatui + crossterm），编辑器内核复用 termide 的 `panel-editor` + LSP，发布线
   独立（`ide-publish.yml`），与渲染器裁决无关。
2. **`zetacode` 的 TUI 与 Work Studio 是同一宿主的两个面**：共用 `/api/v1/*` 契约、
   `ops/` 家族与会话状态，不得各自造一套查询/命令。
3. **`desktop/`（Electron）与 `web-ui/`（Next 快照）都不是产品面**：前者暂停、后者冻结。
   它们出现在历史文档里的"Web UI"指的是当时的内嵌壳，不是 Work Studio。

## 相关但不属于产品面

- `main/crates/*`（`zeta-main`、`zetawork-gui`、`workbench-projects`、`sysmon`）：暂停的
  Rust 线，不随 release 构建；恢复需要单独的裁决。
- `packages/coding-agent/src/server/studio-host/`：Work Studio 的宿主实现（基建，归属
  `coding-agent` 包）。
- `web-ui/`：只作快照与历史对照，不构建、不发布。
