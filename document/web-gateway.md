# Web Runtime Gateway (`zeta serve` → web-ui)

> 背景与决策记录见 `roadmap.md` 「Web workbench foundation and desktop handoff」。
> 用户已确认（2026-08）：web-ui (Node/Next) 无法 in-process 加载 Bun-only 的
> `@linxiraos/zeta`（node_modules 内为 `.ts` 源码 + `bun:sqlite`/`Bun.*`，
> Node 报 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），
> 采用 **Runtime Gateway** 边界。

## 架构

```
Browser ── :30141 (Bun.serve, ZetaServer)
             ├─ /api/*          → Web Gateway（同进程内 Bun 处理器，不走 Next）
             ├─ /api/stats/*    → Stats Dashboard (:3847)
             └─ 其余             → Next.js Web UI（内部随机端口）

开发模式：next dev / next start 直连时，next.config `beforeFiles` rewrites
把 /api/* 转发到 Gateway 固定端口（默认 30142，127.0.0.1）。
```

- Gateway 是 Bun 进程内 `Bun.serve`（由 `zeta serve` 启动，desktop 同源），
  端口环境变量 `ZETA_WEB_GATEWAY_PORT`（默认 30142），仅监听 127.0.0.1。
- web-ui 进程内 **不再 value-import 任何 `@linxiraos/*`**（类型 import 亦禁止，
  Node 解析不了其类型入口；DTO 类型全部本地定义，以网关 JSON 契约为准）。
- 运行时状态（AgentSession 注册表、start 锁、登录回调）从 web-ui 的
  `globalThis.__pi*` 迁到网关模块级（Bun 无热重载，模块级状态即正确）。
- 网关未启动时，Next rewrites 会返回 502；UI 需可感知（后续加降级横幅，
  本期只保证不崩溃）。

## 路由归属

| 路径 | 归属 | 状态 |
| --- | --- | --- |
| `api/sessions`、`api/sessions/[id]`、`[id]/context`、`[id]/state`、`[id]/entries/[entryId]/thinking`、`[id]/export` | Gateway | W1 ✅ |
| `api/agent/new`、`api/agent/[id]`、`[id]/events`、`[id]/bash-output`、`api/agent/running/events` | Gateway（rpc-manager 迁移） | W2 |
| `api/auth/*`（5 条）、`api/models`、`api/models-config`、`models-config/test` | Gateway（AuthStorage/ModelRegistry） | W3 |
| `api/skills/*`（5 条）、`api/plugins` | Gateway（PluginManager/discoverSkills） | W4 |
| `api/fs/*`、`api/files/*`、`api/cwd/*`、`api/git/*`、`api/home`、`api/default-cwd`、`api/worktrees`、`api/tracking`、`api/file-index` | **留在 Next**（纯 Node，无 runtime import） | — |

## 网关内部模块（`packages/coding-agent/src/server/web-gateway/`）

- `web-gateway.ts` — 入口：`Bun.serve` 路由分发（按 `URL.pathname` 前缀）、
  错误包装（JSON `{ error }`，5xx）、SSE 支持。
- `sessions.ts` — W1：列表（`session-listing.listAllSessions` + 兜底文件扫描）、
  打开（`SessionManager.open` 语义 → DTO）、context（entryIds 配对）、
  state（running/streaming 状态）、thinking、export（`../export/html` + 递归补丁）。
- `agents.ts` — W2：`createAgentSession` + `AgentSessionWrapper` 注册表 +
  RPC 命令转发 + SSE（session/events、running/events）、bash-output。
- `auth.ts` — W3：`AuthStorage`/`ModelRegistry` 的 provider/API-key/OAuth 流。
- `models.ts` — W3：models 列表、`models.json` 读写、连接测试。
- `skills.ts`、`plugins.ts` — W4。

DTO 契约以 web-ui `lib/types.ts` / `lib/api-types.ts` 为准，网关负责产出；
web-ui 侧类型定义保留（客户端在用），路由文件删除。

## 关键实现要点

- 会话 ID：持久化 Web 会话 ID 用 `session.sessionManager.getSessionId()`；
  `AgentSession.sessionId` 是 provider-facing，不可当路由键。
- 打开会话：`SessionManager.open(filePath, undefined, undefined, { suppressBreadcrumb: true })`，
  注意 title slot（fixed-width）在 session header 前，禁止裸解析第一行；
  列表兜底扫描用 `session-loader`/`readTitleSlotFromFile`。
- agentDir：网关入口先按 web-ui 原语义归一 env：
  `ZETA_CODING_AGENT_DIR → OMP_CODING_AGENT_DIR → PI_CODING_AGENT_DIR → ~/.zeta/agent`，
  再调用 `getAgentDir()`（`@linxiraos/pi-utils`），保证 CLI/Web 同目录。
- 扩展生命周期：`createAgentSession` 后需 `extensionRunner.initialize` +
  `emit({ type: "session_start" })`（`modes/runtime-init` 的
  `initializeExtensions`，Bun 专用 — 网关即 Bun，天然满足）。
- SSE 头：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、
  `Connection: keep-alive`；ZetaServer 主代理已设 `idleTimeout: 0`。
- 日志走 `logger`，网关请求失败记录 `web-gateway` 上下文；不上 `console.*`。

## 批次验收

- W1 完成：`bun check`（runtime 包）+ `zeta serve --web-only` 起服后
  `curl /api/sessions`、`/api/sessions/<id>/context` 正常；
  web-ui 删除 sessions 族路由与 `lib/session-reader.ts`、`session-title.ts`(+test)、
  `rpc-manager.ts`（W2 才删）、`skills-service.ts`（W4 才删）——
  每批删除后 web-ui `tsc --noEmit` 的报错只减不增。
- 全绿标准：web-ui `tsc --noEmit` 无错；`next build` 通过；desktop Linux/Windows CI 通过。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ZETA_WEB_GATEWAY_PORT` | `30142` | Gateway 监听端口（仅 127.0.0.1） |
| `ZETA_WEB_GATEWAY_URL` | `http://127.0.0.1:30142` | Next rewrites 目标（web-ui 侧） |
