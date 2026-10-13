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
把 /api/* 转发到 Gateway；目标来自 `ZETA_WEB_GATEWAY_URL`（未设置时回退
`ZETA_WEB_GATEWAY_PORT`，再回退默认 30142）。注意 Next 在**加载配置时**求值
rewrites（`next start` 用构建产物里的 routes-manifest），因此该目标必须在
web-ui 构建（或 dev server 启动）时就已知：`zeta serve` 不依赖它——网关所属的
`/api/*` 由统一监听器在**进程内**分派（`classifyRequest`，含 `/api/tracking`），
而 Next 自己实现的网关路径（`/api/git/{branches,checkout,branch}`）用**请求期
代理**（`app/api/git/*` 经 `resolveGatewayUrl()`）跟随 `--gateway-port`。
```

- Gateway 是 Bun 进程内 `Bun.serve`（由 `zeta serve` 启动，desktop 同源），
  端口环境变量 `ZETA_WEB_GATEWAY_PORT`（默认 30142），仅监听 127.0.0.1。
  `zeta serve` 按 `--gateway-port` 启动它，并把解析出的 origin 作为
  `ZETA_WEB_GATEWAY_URL` 注入 web-ui 子进程（`spawnWebUi`），供 Next 侧代理/
  请求期代理解析目标。
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
| `api/agent/new`、`api/agent/[id]`、`[id]/events`、`api/agent/running/events` | Gateway（rpc-manager 迁移） | W2 ✅ |
| `api/agent/[id]/memory`、`[id]/memory/search`、`[id]/memory/items/[memId]` | Gateway（`MemoryRuntimeContext` + 会话级 `MnemopiSessionState`） | W5 ✅（**只读**：列表 / 搜索 / 单条；`PATCH` item 与 `POST /memory` 已占位但返回 501） |
| `api/agent/[id]/bash-output` | Gateway | W2 不实现（运行时会话无 `pi-bash-*.log` 临时文件，bash 全量输出走 session artifact；`role === "bashExecution"` 消息在运行时会话文件中不存在，web-ui 永远不会为此构建链接 → 保持 404） |
| `api/agent/[id]/context` | Gateway（新增，非迁移） | ✅ 上下文统计面板数据源：窗口占用 + 分类占用 + 压缩阈值 + 会话累计 token/调用计数（`context-usage.ts`）。**仅活会话**：未运行时回 `{ running: false }`（同 `GET /api/agent/<id>`），仅 `GET`（其余 405） |
| `api/auth/*`（5 条）、`api/models`、`api/models-config`、`models-config/test` | Gateway（AuthStorage/ModelRegistry） | W3 ✅ |
| `api/skills/*`（5 条）、`api/plugins` | Gateway（`DefaultResourceLoader`/`DefaultPackageManager`） | W4 ✅ |
| `api/tracking`、`api/tracking/events`（SSE） | Gateway（`tracking.ts`） | ✅ `zeta serve` 进程内分派（`classifyRequest`，不依赖 Next rewrite）；dev/standalone 经 Next rewrite |
| `api/fs/*`、`api/files/*`、`api/cwd/*`、`api/git/*`、`api/home`、`api/default-cwd`、`api/worktrees`、`api/file-index` | **留在 Next**（纯 Node，无 runtime import）；其中 `api/git/{branches,checkout,branch}` 是**请求期网关代理**（`app/api/git/*` → `resolveGatewayUrl()`） | — |

## 网关内部模块（`packages/coding-agent/src/server/web-gateway/`）

- 入口 `../web-gateway.ts`（`packages/coding-agent/src/server/web-gateway.ts`）：
  `*_RE` 路由常量 + `webGatewayFetch` dispatch（按 `URL.pathname` 前缀）、
  错误包装（JSON `{ error }`，5xx）、SSE 支持；子目录 `web-gateway/`
  每资源一个 handler 模块（下列列表非穷尽）。
- `sessions.ts` — W1：列表（`session-listing.listAllSessions` + 兜底文件扫描）、
  打开（`SessionManager.open` 语义 → DTO）、context（entryIds 配对）、
  state（running/streaming 状态）、thinking、export（`../export/html` + 递归补丁）。
- `agents.ts` — W2 ✅：`createAgentSession` + `AgentSessionWrapper` 注册表 +
  RPC 命令转发 + SSE（session/events、running/events）。web-ui 的
  `AgentSessionWrapper`/`startRpcSession`/extension-UI 对话框语义全部迁入；
  `queue_update` 与 `running`/`not-running` 事件为网关合成（运行时事件集
  不含二者）；`auto_compaction_end` 的事件载荷补上运行时缺失的
  `estimatedTokensAfter`（`getContextUsage()` 合成）。bash-output 不实现。
- `context-usage.ts` — 上下文统计面板（右栏 `context` 面板，web-ui
  `components/context-ring/**`）：把会话自有的记账投影成一份快照 ——
  `computeSessionContextBreakdown`（分类占用 / 窗口 / 空闲 / 压缩缓冲）+
  `getSessionCompactionBoundaries`（阈值与投机压缩百分比）+
  `AgentSession.getSessionStats()`（累计 token / 调用计数 / 花费 / 路由模型）。
  不新增任何 token 计算；分类是估算值，面板按 `~` 语义呈现。
- `auth.ts` — W3 ✅：`AuthStorage`/`ModelRegistry` 的 provider/API-key/OAuth 流。
- `models.ts` — W3 ✅：models 列表、`models.json` 读写、连接测试。
- `skills.ts`、`skills-lock.ts`、`skill-updates.ts`、`npx.ts` — W4 ✅：skills 列表
  （`DefaultResourceLoader` + `.skill-lock.json` 注解，`Settings.loadIsolated` 隔离
  实例避免触碰 CLI 单例）、PATCH `disable-model-invocation` 外科式编辑、install/
  search/check/update（shell-free `npx` 包装 + GitHub tree / skills.sh 版本对比）。
  纯 Node 逻辑文件从 `web-ui/lib/` 迁入，配套测试迁为 `test/web-gateway/` bun 测试。
- `plugins.ts` — W4 ✅：把 web-ui 的 `settings.packages` 包视图映射到运行时原生
  `settings.extensions` + `disabledExtensions`（zeta 无项目级 packages 持久化：
  路径位于 `cwd` 内的条目按 project scope 显示，其余为 global；install/remove/
  update 幂等写配置，未落盘的包显示 `missing` + warning，与 OMP Web 一致；
  disable/enable 写 `disabledExtensions` 的 `extension-module:<name>` 条目）。

- `memory.ts` — W5 ✅：记忆**读面**（`list`/`search`/`item`）。逐后端能力矩阵
  （`MEMORY_CAPABILITIES`）是唯一真源，且每个响应都回带 `capabilities`；后端
  不支持的操作一律 `200 + supported:false + message`（不是空数组、不是 5xx，沿
  `memory-backend/runtime.ts` 的"结构化不可用"语义）。`mnemopi` 走会话自带的
  `MnemopiSessionState`（未初始化时报"not initialised"，不假装空库）；`local`
  的条目是记忆根下的 markdown 文件（id = 相对路径，含越界防护）；`sharpshooter`
  按行列出三个决策文件。写操作留位：`PATCH items/:memId` 与 `POST /memory`
  返回 501（`unsupported:true`），矩阵里 `write`/`archive`/`maintenance` 全 false。

DTO 契约以 web-ui `lib/types.ts` / `lib/api-types.ts` 为准，网关负责产出；
web-ui 侧类型定义保留（客户端在用），路由文件删除。新增族的 DTO 与产生它的
handler 同处：上下文统计 = `web-ui/components/context-ring/types.ts` ↔
`web-gateway/context-usage.ts`（web-ui 不 import 任何 `@linxiraos/*` 类型入口，
故镜像定义）。

## 记忆读面（W5）契约与逐后端能力矩阵

五个记忆后端（`memory.backend`）能力严重不对称，故**每个响应都回带 `capabilities`**，
前端据其决定渲染搜索框、文件列表还是"该后端不支持"。矩阵唯一真源是
`web-gateway/memory.ts` 的 `MEMORY_CAPABILITIES`（`memory.test.ts` 逐行断言）。

| 后端 | `list` | `search` | `item` | `files` | 说明 |
| --- | --- | --- | --- | --- | --- |
| `off` | ✗ | ✗ | ✗ | ✗ | 无后端；`message` 明确"nothing to list/search" |
| `local` | ✓ | **✗** | ✓ | ✓ | 条目 = 记忆根（`getMemoryRoot(agentDir, cwd)`）下的 markdown 文件；`id` = 相对路径（`learned.md`、`skills/<name>.md`、`rollout_summaries/**`），`kind ∈ memory/summary/learned/skill/rollout/other`；无结构化搜索（回带"用列表接口"的指引） |
| `mnemopi` | ✓ | ✓ | ✓ | ✗ | `list` = 会话各作用域 bank 的**活跃 working 行**（`Mnemopi.getContext`，已过滤 `invalidate`/`supersede`；episodic 只经 `search` 出现）；`search` = 作用域 recall；`item` = `getScopedMemory(id)`，含全文、`store`(working/episodic/fact)、`bank`、`metadata` |
| `sharpshooter` | ✓ | ✓ | **✗** | ✗ | `list` = `architecture.md`/`product.md`/`style.md` 的逐行；行 `id` 形如 `architecture.md#0`（仅供列表定位，不可寻址）；`search` 是朴素子串 |
| `hindsight` | ✗ | ✗ | ✗ | ✗ | 内容在远端服务、本地不可寻址；`message` 指引用 `recall` 工具 / `reflect` |
| 写面（下一批） | — | — | — | — | 本批所有后端 `write`/`archive`/`maintenance = false`：`PATCH`/`POST` 仅占位并返回 501。下一批可写者只有 `mnemopi`（`update`/`forget`/`invalidate`，`forget` 硬删、`invalidate` 软归档）与 `local` 的 `learned.md`（`learn` 工具路径） |

路由与响应（**不支持 = `200 + supported:false + message`**，绝不空数组、绝不 5xx；
沿 `memory-backend/runtime.ts:36-40` 的结构化不可用语义）：

```
GET   /api/agent/:id/memory?limit=1..50      → { backend, supported, available, capabilities, status,
                                                  count, items[], message? }
GET   /api/agent/:id/memory/search?q=&limit= → { backend, supported, capabilities, query, count, items[], message? }
GET   /api/agent/:id/memory/items/:memId     → { backend, supported, capabilities, item } | 404 { error, ... }
PATCH /api/agent/:id/memory/items/:memId     → 501 { error, unsupported, message }   // 留位
POST  /api/agent/:id/memory                  → 501 { error, unsupported, message }   // 留位（maintenance）
```

- `limit` 夹取 `1..50`（列表默认 20、搜索默认 10；缺省/非数字回默认值）。
- `memId` 客户端须 `encodeURIComponent`：`local` 的 id 是相对路径（可含 `/`），
  `sharpshooter` 的 id 含 `#`。服务端解码后再解析，`local` 逐级校验不越出记忆根。
- `available` 区分"后端不支持"（`capabilities.* = false`）与"后端支持但本会话未初始化"
  （`mnemopi` 未装 `MnemopiSessionState` 时 `status.message = "…not initialised…"`，不假装空库）。
- 读面需要**真实运行时会话**：网关按 `getRpcSession` → 会话文件 `startRpcSession`
  的顺序解析（与 `GET /api/agent/:id/events` 同款），拿不到会话即 404。
- 写入口必须走 `memory-backend/redact.ts` 的凭据擦除——本批无写路由，故该约束
  记录在下一批的契约里，不得在本批以只读之外的形式绕过。

## 关键实现要点

- 会话 ID：持久化 Web 会话 ID 用 `session.sessionManager.getSessionId()`；
  `AgentSession.sessionId` 是 provider-facing，不可当路由键。
- 打开会话：`SessionManager.open(filePath, undefined, undefined, { suppressBreadcrumb: true })`，
  注意 title slot（fixed-width）在 session header 前，禁止裸解析第一行；
  列表兜底扫描用 `session-loader`/`readTitleSlotFromFile`。
- agentDir：网关入口先按 web-ui 原语义归一 env：
  `ZETA_CODING_AGENT_DIR → OMP_CODING_AGENT_DIR → PI_CODING_AGENT_DIR → ~/.zeta/agent`，
  再调用 `getAgentDir()`（`@linxiraos/pi-utils`），保证 CLI/Web 同目录。
- 扩展生命周期：`createAgentSession`（sdk）内部完成扩展发现/加载/初始化；
  网关在启动新会话后立即 `setToolUIContext(uiContext, true)` 把
  extension-UI 请求路由进 SSE（`extension_ui_request` 事件 + 包装器的
  pending-response 映射；对话框 `timeout` 由客户端主导，网关只兜底超时）。
- 空工具契约：`toolNames: []` 时按 web-ui 语义清空
  `session.agent.state.systemPrompt`（运行时类型为 `string[]`，置 `[]`）。
- SSE 头：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、
  `Connection: keep-alive`；ZetaServer 主代理已设 `idleTimeout: 0`。
- 日志走 `logger`，网关请求失败记录 `web-gateway` 上下文；不上 `console.*`。

## 批次验收

- W1 完成：`bun check`（runtime 包）+ `zeta serve --web-only` 起服后
  `curl /api/sessions`、`/api/sessions/<id>/context` 正常；
  web-ui 删除 sessions 族路由与 `session-title.ts`(+test)、
  `rpc-manager.ts`（W2 才删）、`skills-service.ts`（W4 才删）——
  每批删除后 web-ui `tsc --noEmit` 的报错只减不增。
- W2 完成：`bun check` 通过；`zeta serve --web-only` 起服后
  `POST /api/agent/new`（`ensure_session` 与带 `prompt` 两种）、
  `GET/POST /api/agent/<id>`（`get_state`/`get_tools`/`get_commands`）、
  `GET /api/agent/<id>/events`（SSE 首帧 `connected`）、
  `GET /api/agent/running/events`（首帧 `running`）逐一冒烟通过。
- 列表可见性遵循 runtime 的 lazy-persistence 契约：新会话未产出 assistant
  输出前不落盘（`#shouldHaveSessionFile()` 要求已有 assistant 消息或文件已
  存在），`GET /api/sessions` 与 runtime 自身一样不列出未物化会话；
  `set_session_name` 在空会话上只改内存标题，随首次真实写入一并持久化
  （冒烟实测：`set_session_name` 后状态可见、列表仍空、`~/.zeta/agent/sessions/`
  下无文件 —— 与 runtime 行为一致）。
- 全绿标准：web-ui `tsc --noEmit` 无错；`next build` 通过；desktop Linux/Windows CI 通过。
- W3 完成：`bun check` 通过；`zeta serve --web-only` 起服后 `GET /api/auth/all-providers`、
  `GET /api/models`、`GET/PUT /api/models-config`、`POST /api/models-config/test` 冒烟通过。
- W4 完成：`bun check` 通过；web-ui 删除 skills 5 路由、plugins 路由、
  `lib/skills-service.ts`/`skill-lock.ts`/`skill-updates.ts`/`npx.ts`（+旧 .mjs 测试，
  逻辑迁入网关，测试迁为 `test/web-gateway/*.test.ts`，12 用例全绿）后
  `tsc --noEmit` 无错；`zeta serve --web-only` 起服后 `GET/POST /api/skills*`、
  `GET/POST /api/plugins` 冒烟通过（本机注意：plugins 写 settings 依赖
  `@linxiraos/pi-natives` FileLock，staging dll 过期时 POST 持久化报
  `NativeFileLock.tryAcquire` undefined —— natives 重建后恢复，属环境问题非网关缺陷）。
- W5 完成（记忆读面，只读）：`bun check`（runtime 包）+ 聚焦测试
  `test/web-gateway/memory.test.ts`（14 用例：矩阵逐行、5 后端降级路径、
  `limit` 夹取、`local` 越界拒绝、`sharpshooter` 行/搜索、保留写路由 501）全绿；
  真实 HTTP 证据（`startWebGateway` + `POST /api/agent/new` + 真实读写路径）
  逐后端落盘：`off`/`hindsight` 全 `supported:false` 带 message、`local` 真实
  `learned.md` 与"不支持搜索"、`sharpshooter` 行列表与子串搜索、
  `mnemopi` 真实列表 3 条 + 搜索 3 条 + 单条全文（`store:working`/`bank`/`metadata`）。
  写面未实现：`PATCH`/`POST` 返回 501，矩阵 `write`/`archive`/`maintenance` 全 false。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ZETA_WEB_GATEWAY_PORT` | `30142` | Gateway 监听端口（仅 127.0.0.1）；`zeta serve --gateway-port` 优先 |
| `ZETA_WEB_GATEWAY_URL` | `http://127.0.0.1:30142` | Next rewrites / 请求期代理的目标（web-ui 侧）；`zeta serve` 按 `--gateway-port` 注入，未注入时回退 `ZETA_WEB_GATEWAY_PORT` 再回退默认端口 |
