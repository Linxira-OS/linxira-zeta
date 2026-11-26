# 高交互页面依赖与依附位置（ADR-0101）

TSP 是主路径；Team / Rooms / IM 保留精简 HTML 页面壳作为复杂交互与可访问性保底。
本文件记录当前依赖，以及迁移时必须切断的 Studio 外壳耦合。

## 当前依附链

```text
web-app AppShell
  route "team"    -> TeamWorkspacePage
  route "rooms"   -> RoomsPage
  route "agent-hub" / Team tab -> TeamPage / TeamImChatPane
        |
        +-- StudioClient (web-app transport, /api/v1/*)
        +-- useI18n / Icon / AppSelect / CSS tokens
        +-- usePreviewMode (TeamPage)
        +-- useAppSettings (TeamWorkspacePage)
        +-- GatewayFetch from settings/gatewayRequest (IM)

host:
  studio-host/ops/team.ts?     (team.* query/command)
  studio-host/ops/rooms.ts     (rooms.*)
  server/web-gateway           (/api/im/*, /api/sessions/*)
```

实际 host ops 由 `studio-host/ops/index.ts` 注册；页面只能通过
`StudioClient`/HTTP 调用，不直接 import coding-agent。

## 必须切断的耦合

| 当前依赖 | 问题 | 迁移后 |
|---|---|---|
| `AppShell` 路由 | 页面只能经 Work Studio 打开 | `serve` 的 `/pages/<name>/` 路由 |
| `usePreviewMode` | Studio 预览态不属于独立页面 | 页面 host 可选参数；默认关闭 |
| `useAppSettings` | 依赖 Studio settings provider | 页面 host 提供只读设置快照，或读 host API |
| `settings/gatewayRequest` 的 `GatewayFetch` | 绑在 Studio settings 上 | 页面 kit 的 `PageFetch`，base 由 host 注入 |
| `web-app` 的全局 CSS / 主题 | 页面带走完整 app 样式 | 页面 kit 的精简 token + 页面局部 CSS |
| `studio-contract` 类型 | 可保留；它是 wire 类型，不是 shell | 保留为共享类型依赖 |

## 目标结构

```text
pages/
  shell/              # header/nav/auth + route mount only
  kit/                # PageFetch, i18n, Icon, AppSelect, hostError
  team/               # entry.html + page code
  rooms/
  im/
  styles/             # minimal tokens
```

- `pages/shell` 不包含 Work Studio 的首页、能力页、工作台、桌面壳。
- 页面入口可以是独立 React 入口或原生 HTML；共享 kit 不提供 app shell。
- `serve` 在 `/pages/team/`、`/pages/rooms/`、`/pages/im/` 托管构建产物；
  `identity.pages` 发布 URL。
- `zetacode pages open team|rooms|im` 与 Wave/Terminal 浏览器使用同一 URL。
- `packages/stats` 保持独立，不进 `pages/`。

## 迁移顺序

1. 抽 `pages/kit`：`PageFetch`、i18n、Icon、AppSelect、hostError、tokens。
2. 把 `teamGraph.ts`、`teamImChatGateway.ts`、`teamImBindingGateway.ts` 移到共享
   data 模块；去 `settings/` 依赖。
3. TeamPage 去掉 `usePreviewMode`；改为可选 `preview` prop，默认 false。
4. TeamWorkspacePage 去掉 `useAppSettings`；host 注入只读 settings/WS 地址。
5. 先接 Team 页面，再接 Rooms、IM；每页验证无 `web-app` 可独立加载。
6. 页面稳定后才归档 `web-app/src/studio/Team*`、`Rooms*`。

## 验收

- `pages` 构建不 import `web-app/src/studio/App*`、`workbench/`、`desktop/`。
- `/pages/team/` 在无 `web-app/dist`、无 Work Studio 的情况下加载并完成
  team graph/tasks/rooms 基本读写。
- `/pages/rooms/`、`/pages/im/` 同样可用；IM 走 `/api/im/*`。
- TSP 仍是主入口；页面仅由 CLI/Wave/浏览器显式打开。
