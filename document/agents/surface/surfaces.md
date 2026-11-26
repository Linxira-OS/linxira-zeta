# 产品面（2026-11-26 规范，ADR-0100）

产品线收敛为三个面，每个面只有一个入口。新代码先归到其中之一；归不进去的说明它是基建，
不是产品面——别为它发明第四个入口。

| 产品面 | 入口 | 形态 | 技术 | 代码落点 | 发布 |
|---|---|---|---|---|---|
| **zetacode** | `zetacode` | CLI / TUI agent | Bun + TS | `packages/coding-agent/` | `@linxiraos/zeta` |
| **zetaide** | `zetaide` | **终端 IDE** | Rust `termide/`（ratatui + crossterm）+ `@linxiraos/editor` | `termide/crates/*` | `ide-publish.yml` → `@linxiraos/ide` |
| **Zeta Terminal** | `terminal/` | 终端产品线（Wave fork） | 独立 Electron/Vite/Go 工具链；TSP 呈现协议 | `terminal/` | 独立 Terminal 发布线（ADR-0098/0100） |

## 已退出发布面

- **Work Studio / `web-app/`**：2026-11-26 起不再构建、不打包、不发布。Team/Rooms/IM
  页面迁往 Terminal/TSP 线；在迁移完成前源码只作归档参考。
- **`desktop/`（Electron）**：随 Work Studio 退出；不构建、不发布。
- **`web-ui/`**：冻结快照，不构建、不发布。
- **`main/crates/zetawork-gui`、`zeta-main`、`zetawork` npm 面**：暂停/归档；恢复需要新 ADR。

## `zetacode serve`

`zetacode serve` 保留为 **headless backend / API host**，用于会话、远程客户端与
Terminal 集成。它不是产品面，也不再服务 `web-app/dist` 静态渲染器。`studio-host`
里的 `/api/v1/*` 只有在非 UI 消费者仍需要时保留；不得借它复活浏览器工作台。

## 已归档/基建边界

- `packages/coding-agent/src/server/studio-host/`：宿主 API 基建，归属 `coding-agent`；
  不是 Work Studio 产品面。
- `packages/coding-agent/src/server/studio-web-app.ts`：旧静态服务，归档；release 不构建。
- `terminal/`：Zeta Terminal 产品线，独立工具链，不入根 workspace、根 lockfile 或根
  CI；由 `terminal-ci.yml` 与 Terminal 发布线负责。
- `main/crates/*`：暂停的 Rust 线；不随 release 构建。
