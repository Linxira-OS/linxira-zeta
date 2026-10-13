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
| `api/agent/[id]/bash-output` | Gateway | W2 不实现（运行时会话无 `pi-bash-*.log` 临时文件，bash 全量输出走 session artifact；`role === "bashExecution"` 消息在运行时会话文件中不存在，web-ui 永远不会为此构建链接 → 保持 404） |
| `api/agent/[id]/context` | Gateway（新增，非迁移） | ✅ 上下文统计面板数据源：窗口占用 + 分类占用 + 压缩阈值 + 会话累计 token/调用计数（`context-usage.ts`）。**仅活会话**：未运行时回 `{ running: false }`（同 `GET /api/agent/<id>`），仅 `GET`（其余 405） |
| `api/agent/[id]/subagents`、`[id]/subagents/events`（SSE）、`[id]/subagents/[subId]/transcript`、`[id]/subagents/[subId]/output` | Gateway（新增，非迁移） | ✅ 子代理名册读面（`subagents.ts`）：快照 / 增量 SSE / 字节分页转写 / 已发布输出。仅 `GET`（其余 405）；本节下方「子代理名册」给出 DTO 与词表映射。动作面（`cancel`/`steer`）**未实现**，见该节末尾 |
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
- `subagents.ts` — 子代理名册读面（新增）：`AgentRegistry` 行 + 活会话 `task:subagent:*`
  帧（`RpcSubagentRegistry`，订阅级别 `progress`）投影成名册快照，SSE 增量（帧名
  逐字复用 stdio RPC 契约），转写走 `readRpcSubagentTranscript`（字节游标），输出读
  `<artifactsDir>/<id>.md`（+ `.json` sidecar）。根作用域：一个网关会话一个 sink，
  挂在 `AgentSessionWrapper.subagentSink` 上，`destroy()` 时释放；`startRpcSession`
  为每个会话注入自己的 `subagentEventBus`（`createAgentSession` 的公开选项）。
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

DTO 契约以 web-ui `lib/types.ts` / `lib/api-types.ts` 为准，网关负责产出；
web-ui 侧类型定义保留（客户端在用），路由文件删除。新增族的 DTO 与产生它的
handler 同处：上下文统计 = `web-ui/components/context-ring/types.ts` ↔
`web-gateway/context-usage.ts`（web-ui 不 import 任何 `@linxiraos/*` 类型入口，
故镜像定义）。

## 服务发现与复用（`zeta serve` ↔ 桌面）

- `../serve-registry.ts`（`packages/coding-agent/src/server/serve-registry.ts`）：
  `zeta serve` 绑定端口成功后把自身写进 `<config root>/serve.json`
  （`pid/webUrl/statsUrl/gatewayUrl/version/startedAt/cwd`，`0600`，临时文件 +
  rename 原子替换，`shutdown()` 按 pid 撤回；`ZETA_SERVE_REGISTRY` 覆盖路径，
  供测试与多用户/可移植安装使用）。`pid` 已死的条目在下次启动时被删除并打印提示，
  而不是被信任。`--stats-only` 不发布：它没有 identity 端点，探活无法确认。
- `web-gateway/identity.ts`：`GET /api/server/identity` →
  `{ app: "zeta", version, pid, startedAt, webUrl, statsUrl, gatewayUrl }`，由服务
  进程自身回答（注册过 URL 后带上 URL）。它是既有 `/api/*` 面上的只读探针，走既有
  访问门：非 loopback 调用仍需 `remote.token`。
- 决策矩阵：**同版本 + 健康** ⇒ 复用（CLI 打印对方 URL 与"强制另起/重启"选项后
  `exit 0`；桌面 shell 直接 adopt，不 spawn）；**版本不符** ⇒ 明确拒绝并给同样选项
  （CLI `exit 1`，桌面弹选择），绝不静默抢占；**同版本但在其他端口** ⇒ 只提示，显式
  `--web-port` 仍照常起第二个监听；**身份探测失败/陌生服务** ⇒ 不当作自家实例。
- 桌面镜像：`desktop/src/serve-discovery.ts` 因 desktop 是独立 npm 项目（无
  `packages/*` 工作区依赖、`tsc` 的 `rootDir: src`、CLI 以不透明二进制交付）而必须
  自带"读取/探活/判定"这一半；两份读**同一个**注册文件与**同一个**端点，写入侧由
  CLI 独占。两个文件头部互相注明对方路径。
- 漂移守卫：`scripts/check-serve-discovery-parity.ts` 从两份源码抽取**动作名集合、
  每个动作携带的字段、版本比较（严格 `!==`）与分支顺序**做对比（不做整文件 diff，
  注释/格式/桌面特有字段不算漂移），并强制 `DIFFERENCES` 里记录的刻意差异
  （CLI `start` ↔ 桌面 `spawn`、`stale` ↔ `stalePid`、只有 CLI 有 `occupiesTarget`
  目标端口门）；任一侧抽不出来即失败。接线在 GitHub `ci.yml` 与 Gitea
  `local-ci.yml` 的 `check` job 内（"Serve-discovery parity guard"）。

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

## 子代理名册（`api/agent/[id]/subagents*`）

读面四端点，作用域**必须**挂在顶层会话下：子代理 id 只在「父根会话 artifacts 树」
内唯一（`<artifactsDir>/<id>.jsonl`，嵌套为 `<artifactsDir>/<parent>/<id>.jsonl`），
进程级 `AgentRegistry` 每 id 只保留最新 ref。首个路径参数因此永远是根会话 id。

| 方法 | 路由 | 语义 |
| --- | --- | --- |
| GET | `/api/agent/:id/subagents` | 名册快照（活会话 + 磁盘恢复的 parked/aborted 行） |
| GET | `/api/agent/:id/subagents/events` | SSE：先 `subagent_snapshot`，再增量帧 |
| GET | `/api/agent/:id/subagents/:subId/transcript?fromByte=N` | 按**字节偏移**分页转写 |
| GET | `/api/agent/:id/subagents/:subId/output?json=1` | 已发布结果（`?json=1` 附带 `.json` sidecar） |

`:subId` 是任意非 `/` 段（agent id 可含 `.`/`:`）。四个端点都是 `GET`，其余方法 405；
未知会话 404 `{error:"Unknown session: <id>"}`，未知子代理 404 `{error:"Unknown subagent: <subId>"}`。

### 快照 DTO

```ts
interface SubagentRosterResponse { subagents: SubagentRosterEntry[]; maxConcurrency: number; generatedAt: number }
interface SubagentRosterEntry {
  id: string; displayName: string; kind: "sub" | "advisor";
  parentId: string | null; depth: number;            // depth = 本树内层级（0 = 根会话直接 spawn）
  index?: number;                                     // 同一 task 调用的 spawn 序号（只有活观察者知道）
  agent?: string; agentSource?: string;
  status: AgentStatus;                                // 权威（registry 词表）
  taskStatus?: "pending"|"running"|"completed"|"failed"|"aborted";  // 仅展示（observer 词表）
  description?: string; task?: string; assignment?: string;
  sessionFile: string | null; createdAt: number; lastActivity: number;
  detached?: boolean; parentToolCallId?: string;
  activity?: string;                                  // 仅 running 有意义；**不发事件**，只在快照/合并刷新时可信
  lifecycle?: { responseAt?: number; acceptedAt?: number; terminalAt?: number };
  staleAcceptedRun?: boolean;
  progress?: { lastIntent?; currentTool?; toolCount?; requests?; tokens?;
               contextTokens?; contextWindow?; cost?; durationMs?; recentOutput?: string[] };
  metrics?: AgentMetricsSummary;                      // 持久化行或活观察者 progress
  outputPath?: string | null; patchPath?: string | null; branchName?: string | null;   // 来自持久化 history
  persisted: boolean;                                 // true = 无活会话（磁盘恢复/已 park）
}
```

排序与 TUI Agent Hub 完全一致（`STATUS_ORDER` → `lastActivity` 降序 → id），行数上限 512；
`metrics` 由 `progressMetrics()`（TUI 同一投影）产出。**advisor 默认过滤**（与 TUI 一致），
`kind` 字段保留以便前端将来区分。`depth`/`parentId` 足够前端自行建树，网关不下发树形嵌套。

### 状态词表映射（两套 → 一份 DTO）

| observer `taskStatus`（`AgentProgress.status`） | registry `status`（`AgentStatus`） |
| --- | --- |
| `pending` | `running` |
| `running` | `running` |
| `completed` | `idle`（会话释放后 `parked`） |
| `failed` | `idle` / `parked`（失败运行同样离开 `running`） |
| `aborted` | `aborted`（**终态**，tombstone，不再回活） |

前端**只渲染 `status`**；`taskStatus` 仅解释「为什么是这个状态」。映射由运行时
（`AgentRegistry.setStatus` / 会话 run-state 订阅）施加，网关不重算。

### SSE 帧

判别式是 JSON 的 `type`（与既有 SSE 相同：`data: <json>\n\n`，无 `event:` 名、无 `seq`，
30s 心跳注释帧 `:\n\n`）：

- `subagent_snapshot { subagents, maxConcurrency, generatedAt }` —— **首帧**（先写快照再订阅，
  扫描期间到达的帧不会抢在快照前；那些帧只描述进度，状态已在快照里）。
- `subagent_lifecycle { payload: SubagentLifecyclePayload }` —— 逐字复用 RPC 帧（observer 词表
  `started|completed|failed|aborted`）。
- `subagent_progress { payload: SubagentProgressPayload }` —— 复用 RPC 帧；**同一子代理只留最新一帧**，
  150ms 合并窗口；终端状态帧同时触发 `subagent_removed`。
- `subagent_status { subagent: SubagentRosterEntry }` —— 网关合成：`AgentRegistry.onChange`
  （`registered|status_changed|metadata_changed`）的权威行，前端按 id 替换即可。
- `subagent_removed { id }` —— 网关合成：终态清理（RPC 契约是直接删快照，web 需要显式删除通知）。

`activity`/`lastActivity`/`session` 的变更**不发事件**（`AgentRegistry.setActivity`/`attachSession`
刻意静默），只能靠快照帧或 `subagent_status`/`subagent_progress` 合并刷新 —— 需要更强保证时轮询
`GET …/subagents`。

**慢消费者策略**：进度帧两级丢弃 —— sink 内 150ms 合并（最新优先）；每条连接再按流缓冲
（`controller.desiredSize <= 0`）丢弃并只保留每个子代理的最新一帧，缓冲排空后补发。
状态帧（snapshot/lifecycle/status/removed）**永不丢弃**：它们小且受子代理churn 限制，
慢客户端因此只会丢失被覆盖的进度细节，最终收敛到真相。

### 转写与输出

- 转写分页复用 `readRpcSubagentTranscript(sessionFile, fromByte)`：一次读 `fromByte` 到 EOF 的完整行，
  丢弃尾部半行，返回 `{sessionFile, fromByte, nextByte, reset, entries, messages}`；`nextByte` 是下次的游标
  （追加输出后从该游标继续即为增量），`fromByte > filesize` 时 `reset: true` 且从 0 重读。
- subId → 会话文件解析顺序：活观察者快照 → `AgentRegistry` ref（须在本树内）→ 磁盘探测
  `<artifactsDir>/**/<subId>.jsonl`（深度上限 8，覆盖嵌套 spawn），因此重启后仍可按 id 读历史转写。
- 输出：`<artifactsDir>/<subId>.md`（+ 同名 `.json` sidecar，`?json=1` 取）。已发布 →
  `{published:true, outputPath, content, size, status}`；已注册但尚未发布 → 200
  `{published:false, status, message, progress?, metrics?}`（`agent://<id>` 的 progress 视图语义）；
  `?json=1` 而无 sidecar → 404 `{error}`。
- **动作面（未实现）**：`POST /api/agent/:id/subagents/:subId` 的 `{action:"cancel"}` /
  `{action:"steer", message}` 拟复用 `handleRpcCancelSubagent` / `handleRpcSteerSubagent`
  （`rpc-mode.ts`，均已导出）+ `resolveOwnedLiveSubagent` 的所有权校验；本批只做读面，
  该路由保留为 404（未注册），实现时须一并补上 `AgentLifecycleManager.release` 与 tombstone 语义。

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
- 子代理名册（新增）完成：`bun test test/web-gateway/subagents.test.ts`（快照形状与作用域、
  SSE 首帧快照 + 进度 + 终态、转写字节游标/重放/越界 reset、输出已发布/未发布/404）全绿；
  `bun run check:types` 无错；起服后真跑一个子代理，四个端点逐一冒烟通过（证据见 PR）。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ZETA_WEB_GATEWAY_PORT` | `30142` | Gateway 监听端口（仅 127.0.0.1）；`zeta serve --gateway-port` 优先 |
| `ZETA_WEB_GATEWAY_URL` | `http://127.0.0.1:30142` | Next rewrites / 请求期代理的目标（web-ui 侧）；`zeta serve` 按 `--gateway-port` 注入，未注入时回退 `ZETA_WEB_GATEWAY_PORT` 再回退默认端口 |
