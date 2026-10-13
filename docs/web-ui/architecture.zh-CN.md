# Web UI 架构

Zeta 的 Web 界面是一个独立的 Next.js 应用（`web-ui/`），通过 HTTP 与本地
运行时通信。`zetacode serve` 启动一个 Bun 进程，同时托管三个后端并把它们
代理到单个端口之后，浏览器只看到一个源（origin）。

## 进程布局

```
Browser ── :30141 (Bun.serve, ZetaServer)
            ├─ /api/stats/*   → Stats Dashboard (:3847, @linxiraos/pi-stats)
            ├─ /api/*         → Web Gateway（进程内 Bun 处理器）
            └─ 其他           → Web UI Next.js（随机内部端口）
```

`ZetaServer`（`packages/coding-agent/src/server/zeta-server.ts`）是统一入口。
其 `classifyRequest()` 决定每个请求的去向：

| 路由类型  | 条件                                                    | 目标                       |
|-----------|---------------------------------------------------------|----------------------------|
| `stats`   | `/api/stats*`、`/api/sync`、`/api/request/*`            | Stats Dashboard            |
| `gateway` | `/api/*` 且非 Next 自有（见下）                          | Web Gateway（`webGatewayFetch`） |
| `webui`   | 其余路径（以及 Next 自有的 `/api/*`）                    | Web UI Next.js 子进程      |
| `unavailable` | 未启动 Web UI 后端                                   | 503                        |

少量 `/api/*` 前缀保留在 Next.js 内，因为它们是纯 Node 代码、不依赖运行时
（`/api/fs/`、`/api/files/`、`/api/cwd/`、`/api/git/`——其中 `status`/`diff`
本地实现，`branches`/`checkout`/`branch` 按请求代理到网关、`/api/home`、
`/api/default-cwd`、`/api/worktrees`、`/api/file-index`）。
其余所有 `/api/*` 请求都交给 Web Gateway。

Web Gateway 还暴露一个独立的 `127.0.0.1` 监听端口
（`ZETA_WEB_GATEWAY_PORT`，默认 30142）供 `next dev`/`next start` 访问；
主代理在进程内分派，因此网关端口被占用只会禁用 dev 模式监听器，不影响
网关本身。`zeta serve` 按 `--gateway-port` 启动该监听器，并把解析出的 origin
（`ZETA_WEB_GATEWAY_URL`）注入 web-ui 子进程，Next 侧 rewrites 与请求期网关代理
（`/api/git/branches|checkout|branch`）即由此解析目标；tracking 由监听器进程内
分派（`classifyRequest`），其 SSE 不再经 Next 中转。

## Web Gateway 分派

`packages/coding-agent/src/server/web-gateway.ts` 中的 `webGatewayFetch(req)`
按路径正则路由。完整路由表以 `*_RE` 常量存在于该文件：

- **Sessions** — `GET/PATCH/DELETE /api/sessions/:id`、
  `GET /api/sessions/:id/context`、`GET /api/sessions/:id/state`、
  `GET /api/sessions/:id/entries/:id/thinking`、`GET /api/sessions/:id/export`
- **Agents** — `POST /api/agent/new`、`GET /api/agent/:id`、
  `POST /api/agent/:id`（命令 RPC）、`GET /api/agent/:id/events`（SSE）、
  `GET /api/agent/running/events`（SSE）
- **Auth** — `GET /api/auth/all-providers`、`GET /api/auth/providers`、
  `GET/POST/DELETE /api/auth/api-key/:provider`、
  `GET/POST /api/auth/login/:provider`、`POST /api/auth/logout/:provider`
- **Models** — `GET /api/models`、`POST /api/models/import`、
  `PUT /api/models/default`、`GET/PUT /api/models-config`、
  `POST /api/models-config/test`
- **Skills** — `GET/PATCH /api/skills`、`POST /api/skills/install`、
  `POST /api/skills/search`、`POST /api/skills/check`、
  `POST /api/skills/update`
- **Open / Update / Plugins** — `GET /api/open/options`、`POST /api/open`、
  `GET /api/update/check`、`GET /api/update/download`、
  `GET /api/update/install`、`GET/POST /api/plugins`
- **Settings / Web config** — `GET/PUT /api/settings`、
  `POST /api/settings/reload`、`GET/PUT /api/web-config`
- **Docs** — `GET /api/docs/<path>`（随包 Markdown 文档；见
  `docs/web-ui/api.md`）
- **Channels** — `GET /api/channels/wechat/qrcode`、
  `POST /api/channels/wechat/reconnect`
- **Stats 桥接** — `GET /api/agent/running/events` 与运行中会话注册表保持
  侧栏的实时状态同步。

未知 `/api/*` 路径返回 404 `{ "error": "Not implemented" }`。

## 实时 Agent 会话

网关持有一个模块级注册表，存放存活的 `AgentSessionWrapper` 实例
（`web-gateway/agents.ts`），以持久化会话 id 为键。包装器在运行时
`AgentSession` API 与 web-ui RPC 协议之间做翻译：

- **命令** — `POST /api/agent/:id`，JSON 请求体；所有命令经
  `AgentSessionWrapper.send()` 分派，并以 `{ success: true, data: <result> }`
  包装返回（失败为 `{ error }`）。命令类型包括 `prompt`、`steer`、
  `follow_up`、`abort`、`get_state`、`set_model`、`fork`、`navigate_tree`、
  `set_thinking_level`、`compact`、`set_session_name`、`get_session_stats`、
  `get_last_assistant_text`、`set_auto_compaction`、`clear_queue`、
  `get_tools`、`get_commands`、`set_tools`、`reload`、`abort_compaction`、
  `set_auto_retry`、`bash`、`abort_bash` 与 `plan_approve`。
- **状态** — `get_state` 返回快照，包含 `planModeEnabled` / `planFilePath` /
  `planContent`，供 Web UI 渲染远程计划审批卡片 `PlanApproval`。
- **事件** — `GET /api/agent/:id/events` 是 Server-Sent Events 流
  （`text/event-stream`）。包装器订阅运行时会话的 `AgentSessionEvent`，
  把每个事件转发为 `data: <json>` 帧，另加一条合成的 `connected` 帧与 30
  秒注释心跳。客户端（`web-ui/hooks/useAgentSession.ts`）用它实现实时
  流式输出、运行状态、队列更新与扩展 UI。

`POST /api/agent/new` 启动会话；`GET /api/agent/running/events` 向所有已
连接客户端流式推送当前运行中的会话 id 集合。

## 统计面板入口

统计面板（`@linxiraos/pi-stats`，默认 `http://127.0.0.1:<statsPort>`，由
`zetacode stats` 或 `zetacode serve` 启动）**不是** dock 面板。它回答的是跨
会话问题——成本、模型、供应商、工具、frustration judge、gain、时间序列、
会话轨迹——而 dock 的上下文环只报告单个实时会话，因此外壳把统计面板保留为
**动作型入口**，而非第二个「统计」面板：

- 命令面板中的「打开统计面板」动作；
- 侧栏的「今日」用量行（其数字来自面板的
  `/api/stats/overview?range=today`）。

两者都调用 `openStandaloneStats()`（`web-ui/lib/standalone-stats.ts`）：
经 `GET /api/webui/stats-url` 解析地址（该路由读取启动时由
`packages/coding-agent/src/commands/web-ui-launcher.ts` 的
`spawnWebUi(port, statsUrl)` 注入的 `NEXT_PUBLIC_STATS_URL`，并回退到文档
默认值），探测可达性后在独立标签页打开。若无服务应答，外壳的短暂提示会给出
地址与启动命令，而不是留下一个打不开的标签页。

## Settings 客户端桥

`web-ui/lib/settings-client.ts` 是浏览器端访问网关 `/api/settings` 与
`/api/web-config` 端点的客户端。`fetchSettings(lang)` 返回完整设置目录
（tabs、groups、逐项设置行）与当前值及本地化标签——所有标签/描述的本地化
都在网关侧完成，客户端从不维护自己的翻译表。`updateSetting(path, value)`
按点路径持久化一个设置；`fetchWebConfig()` / `updateWebConfig(path, value)`
对独立的 web 层配置（`~/.zeta/agent/web.yml`，GET 时脱敏）做同样的事。
