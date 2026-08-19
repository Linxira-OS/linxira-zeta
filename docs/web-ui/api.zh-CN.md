# Web UI 网关 API

以下端点均由 Web Gateway 在 `http://127.0.0.1:30141/api/*`（ZetaServer 代理
的端口）提供。除非另有说明，请求与响应体均为 JSON。错误为 `{ "error":
string }` 并带 4xx/5xx 状态码。

本文档中的 `:id` / `:provider` 为路径参数。会话 id 为 `[A-Za-z0-9-]+`；
提供商 id 为 `[A-Za-z0-9_.-]+`。

## Sessions

### `GET /api/sessions`

列出所有会话。

```json
{ "sessions": [ /* SessionInfo[] */ ], "runningSessionIds": ["..."] }
```

### `GET /api/sessions/:id`

完整会话文档（上下文、树、模型、名称）。支持查询参数 `deferThinking=1` 与
`deferMedia=1` 以跳过重量级负载。

### `PATCH /api/sessions/:id`

重命名会话。请求体：`{ "name": string }`。

### `DELETE /api/sessions/:id`

删除会话。

### `GET /api/sessions/:id/context`

会话上下文。查询参数：`leafId`、`deferThinking`、`deferMedia`。

```json
{ "context": { "messages": [], "entryIds": [] } }
```

### `GET /api/sessions/:id/state`

实时 agent 状态。当 RPC 会话存活时：

```json
{ "running": true, "state": { /* AgentState，见下 */ } }
```

`AgentState` 字段：`sessionId`、`sessionName`、`model`
（`{ provider, modelId } | null`）、`systemPrompt`、`thinkingLevel`、
`isStreaming`、`isPromptRunning`、`isBashRunning`、`isCompacting`、
`extensionStatuses`、`extensionWidgets`、`queuedMessages`
（`{ steering, followUp }`）、`planModeEnabled`（布尔）、
`planFilePath`（`string | null`）与 `planContent`（`string | undefined`，
计划模式激活时计划文件的正文）。

### `GET /api/sessions/:id/entries/:id/thinking`

某条目的思考块。查询参数：`blockIndex`（从 0 开始）。

### `GET /api/sessions/:id/export`

导出会话。查询参数：`inline=1` 直接返回负载。

## Agents

### `POST /api/agent/new`

启动新的实时 agent 会话。请求体：`{ cwd?: string, type?: string, ... }`
（其余键转发为启动命令）。

### `POST /api/agent/:id`

发送一条命令。请求体为命令对象；所有响应包装为：

```json
{ "success": true, "data": <result> }
```

命令：`prompt`（`{ message, images?, streamingBehavior? }`）、`steer`
（`{ text, images? }`）、`follow_up`（`{ text, images? }`）、`abort`、
`get_state`（返回 `AgentState`）、`set_model`（`{ provider, modelId }`）、
`fork`（`{ entryId }`）、`navigate_tree`（`{ entryId }`）、
`set_thinking_level`（`{ level }`）、`compact`、`set_session_name`
（`{ name }`）、`get_session_stats`、`get_last_assistant_text`、
`set_auto_compaction`（`{ enabled }`）、`clear_queue`、`get_tools`、
`get_commands`、`set_tools`（`{ toolNames }`）、`reload`、
`abort_compaction`、`set_auto_retry`（`{ enabled }`）、`bash`
（`{ command, excludeFromContext? }`）、`abort_bash` 与 `plan_approve`
（`{ planFilePath, mode }`，`mode` ∈ `preserve | compact | fresh | cancel`）。

### `GET /api/agent/:id`

`AgentState` 快照（等价于 `get_state`）。

### `GET /api/agent/:id/events`

实时 agent 事件的 Server-Sent Events 流。每个帧为 `data: <json>`；先到达
`connected` 帧，随后是运行时会话事件（`turn_start`、`message_start`、
`message_update`、`message_end`、`turn_end`、`agent_start`、`agent_end`、
`tool_execution_start`、`tool_execution_end`、`bash_chunk`、`queue_update`、
扩展 UI 请求……），另有 30 秒 `:` 注释心跳。

### `GET /api/agent/running/events`

当前运行中会话 id 集合的 SSE 流：

```json
{ "type": "running", "runningSessionIds": ["..."] }
```

## Auth

### `GET /api/auth/all-providers`

所有已知提供商及其认证方式。

### `GET /api/auth/providers`

已配置/已激活认证的提供商与登录状态。

### `GET /api/auth/api-key/:provider`

该提供商是否存有 API 密钥。

### `POST /api/auth/api-key/:provider`

设置 API 密钥。请求体：`{ "apiKey": string }`。

### `DELETE /api/auth/api-key/:provider`

移除已存 API 密钥。

### `GET /api/auth/login/:provider`

OAuth 登录流程的 SSE 流（授权 URL + 轮询事件）。

### `POST /api/auth/login/:provider`

完成 OAuth 登录。请求体：`{ token?, code? }`。

### `POST /api/auth/logout/:provider`

移除该提供商的已存认证。

## Models

### `GET /api/models`

模型列表。查询参数：`cwd`（默认为 `process.cwd()`）。

### `POST /api/models/import`

从 base URL 导入模型。查询参数：`base`。（兼容起见 GET 也接受；处理器检查
方法。）

### `PUT /api/models/default`

设置默认模型。请求体：`{ "provider": string, "modelId": string }`。

### `GET /api/models-config`

读取模型配置文件。未设置时为 `{ "providers": {} }`。

### `PUT /api/models-config`

写入整个模型配置 JSON。

### `POST /api/models-config/test`

在临时目录中测试模型配置变更。

## Skills

### `GET /api/skills?cwd=<path>`

列出某项目的技能。

### `PATCH /api/skills`

请求体：`{ filePath, disableModelInvocation }`。

### `POST /api/skills/install`

请求体：`{ package, scope, cwd? }`。

### `POST /api/skills/search`

请求体：`{ query, limit? }`。

### `POST /api/skills/check`

请求体：`{ cwd, package?, scope? }`。

### `POST /api/skills/update`

请求体：`{ cwd, package, scope }`。

## Open / Update / Plugins

### `GET /api/open/options`

可用的“打开方式”目标（平台对应的编辑器/终端）。

### `POST /api/open`

请求体：`{ target?: string, path?: string }` — 用编辑器或终端打开路径。

### `GET /api/update/check`

检查是否有新版本。`{ updateAvailable?: boolean, ... }`。

### `POST /api/update/download`

下载最新发布版本。

### `POST /api/update/install`

安装已下载的发布版本。

### `GET /api/plugins?cwd=<path>`

列出某项目的插件。

### `POST /api/plugins`

请求体：`{ action, source?, scope?, cwd }`。

## Settings / Web config

### `GET /api/settings?lang=en|zh`

完整设置目录（tabs、groups、逐项设置行）与当前值及本地化标签。

### `PUT /api/settings`

更新一个设置。请求体：`{ "path": string, "value": unknown }`。

### `POST /api/settings/reload`

从磁盘重载设置（遵循 `x-zeta-cwd` 请求头）。

### `GET /api/web-config`

合并后的 web 层配置（`~/.zeta/agent/web.yml`），密钥已脱敏。

### `PUT /api/web-config`

更新一个点路径。请求体：`{ "path": string, "value": unknown }`；未知路径
返回 400。

## Docs

### `GET /api/docs/<path>`

读取随包文档文件（相对 `docs/`，如 `user-guide.md` 或
`web-ui/architecture.md`）。路径限定为 `[A-Za-z0-9._/-]`，禁止包含 `..`
或为绝对路径。内容取自随包文档 embed（编译二进制 / npm 包），源码 `docs/`
目录作为开发环境兜底。

```json
{ "path": "user-guide.md", "content": "# ..." }
```

文件缺失返回 404 `{ "error": "not_found" }`。

## Channels

### `GET /api/channels/wechat/qrcode`

微信扫码登录状态：

```json
{ "pending": true, "qrcodeUrl": "...", "status": "..." }
```

或 `{ "pending": false }`。

### `POST /api/channels/wechat/reconnect`

触发新的微信扫码登录。`{ "ok": true }`；渠道未运行时返回 404。
