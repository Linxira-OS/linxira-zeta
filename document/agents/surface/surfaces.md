# 产品面（2026-11-26 规范，ADR-0100）

产品线收敛为三个面，每个面只有一个入口。新代码先归到其中之一；归不进去的说明它是基建，
不是产品面——别为它发明第四个入口。

| 产品面 | 入口 | 形态 | 技术 | 代码落点 | 发布 |
|---|---|---|---|---|---|
| **zetacode** | `zetacode` | CLI / TUI agent | Bun + TS | `packages/coding-agent/` | `@linxiraos/zeta` |
| **zetaide** | `zetaide` | **终端 IDE** | Rust `termide/`（ratatui + crossterm）+ `@linxiraos/editor` | `termide/crates/*` | `ide-publish.yml` → `@linxiraos/ide` |
| **Zeta Terminal** | `terminal/` | 终端产品线（Wave fork） | 独立 Electron/Vite/Go 工具链；TSP 呈现协议 | `terminal/` | 独立 Terminal 发布线（ADR-0098/0100） |

## 精简页面壳（高交互保底，不是 Work Studio）

TSP 是主路径，但 Team / Rooms / IM 需要密集表格、多栏编辑、拖拽和复杂剪贴板，
TSP 对这些交互不总是更好。按 ADR-0101 保留一个**精简 HTML 页面壳**：一个最小 host（header/nav/auth）+ 独立页面，不使用 React/Next 工作台外壳。

| 页面 | 路由 | 数据 |
|---|---|---|
| Team | `/pages/team/` | `team.*` host ops / gateway |
| Rooms | `/pages/rooms/` | `rooms.*` / IRC |
| IM | `/pages/im/` | channels 后端 |
| Stats | 独立 `packages/stats`（默认 3847） | 自有 `/api/*` |

- 由 `zetacode serve` 同源托管，复用其 auth/CSRF/WS；`identity.pages` 发布 URL
- `zetacode pages open team|rooms|im` 在系统浏览器或 Wave/Terminal 内嵌浏览器打开
- 页面用原生 HTML/ESM，状态层按页需要最小化；不 import Work Studio shell
- 不发布 Electron/desktop，不整包恢复旧 `web-ui/`；后续按页面选择性迁移
- 这些页面是保底，不是第四个完整产品；新增页面需要单独裁决

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
