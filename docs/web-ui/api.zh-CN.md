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

“打开方式”目标及其可用性：`{ desktop, targets: [{ type, label, available,
default?, editor?, detail? }] }`。`type` 取 `terminal`、`explorer`、`editor`
（此时 `editor` 为产品 id）、`terminal-ide`（`zeta-ide`）或
`terminal-editor`（`zeta-editor`）；`default` 标记网关建议的默认目标。
Windows 终端按 `pwsh` → Git Bash → `powershell` 链解析，其余平台
`$SHELL` → bash；探测结果按进程缓存（约 60s）。

### `POST /api/open`

请求体：`{ target?: string, path?: string, editor?: string }` —
用编辑器、终端、文件管理器或内置终端工具打开路径（`terminal-ide` /
`terminal-editor` 在该路径启动 `zeta-ide` / `zeta-editor`）。桌面宿主只执行
`explorer` / `editor` 目标并接收签名 `{ path, token }` 凭据；内置终端工具
始终由网关直接启动。

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

## Terminal

内置终端（spec §15）是网关托管的 PTY：REST 为控制面，WebSocket 为数据面。
会话属于网关进程，不属于浏览器；网关重启即所有会话结束。

一个会话占用一个**槽位**，由「`cwd` 绝对路径 + `instanceId`」确定。实例 id 由
UI 分配（每个工作区第一个槽位是 `t1`，之后 `t2`、`t3`……），并在每次 ensure
时一并提交；同一槽位永远对应同一个 PTY，因此关闭再打开面板是「接回」而不是
新建。

### `POST /api/terminal/ensure`

请求体：`{ cwd?, instanceId?, file?, line?, col?, replace? }`。按槽位接回或新建：

- 槽位内有活会话 → 直接返回该会话并签发新连接票据，`reused: true`；其 64KiB
  回放环仍保留滚动历史，且**不额外占用**并发终端额度；
- 槽位内无活会话（首次打开、已退出、被结束，或上一轮网关进程）→ 新建会话，
  `reused: false`；
- `replace: true` → 先结束槽位内的活会话（`session_ended`，reason
  `killed`），再新建，使 `file`/`line`/`col` 的 zeta-ide 注入生效。

响应：`{ id, ticket, shell, cwd, instance, program, fallbackReason, reused,
injected }`。`program` 为 `workbench` 表示解析到框架工作台
（`zetawork`；npm 侧 bin 为 `zeta` / `zetawork` / `zeta-work`），否则为
`shell` 且 `fallbackReason: "workbench-not-found"`——UI 必须把该回退明确显示
出来，而不是静默换成 shell。Windows 上解析到 `.cmd`/`.bat` 启动器时，以
`cmd.exe /c <shim>` 启动（ConPTY 无法直接执行脚本）。

失败响应带可机读的 `code`：`cwd_missing` / `cwd_not_directory`（400，工作区
目录已不存在）、`invalid_instance`（400）、`terminal_limit`（429，另带
`limit`）、`no_program`（500）。

### `POST /api/terminal`

请求体：`{ cwd?, file?, line?, col? }` → `{ id, shell, cwd, ticket, injected }`。
旧的「总是新建」形式（供注入 `file` 的文件胶囊流程使用），占用 `default` 槽位。

### `GET /api/terminal`

`{ terminals: [{ id, shellLabel, shellCommand, cwd, instance, program,
fallbackReason, exited, exitCode, startedAt, exitedAt }] }`——活会话加上最新 25 条
已退出记录。

### `DELETE /api/terminal/:id`

结束活会话（或丢弃已退出记录）。已连接的客户端会先收到
`{ event: "session_ended", reason: "killed" | "expired" }`，随后 socket 以 1000
关闭；已退出记录过期淘汰时发送 `expired` 变体。两种情况都会释放槽位并回收 PTY。

### `POST /api/terminal/:id/resize`

请求体：`{ cols, rows }`（2…1000）。会话已退出时返回 409。

### `POST /api/terminal/:id/ticket`

签发一次性、60s 有效的 WS 连接票据。会话不存在时 404——UI 据此判断「接回目标
已不存在」。

### `GET /api/terminal/:id/ws?ticket=<ticket>`

WebSocket 升级（loopback 调用可省略票据）。首个下行帧是 `0x00` 前缀的 JSON 元数据
（接入时为 `{ replayedBytes }`，随后是回放负载），之后是裸 PTY 字节；上行文本帧
即 stdin。控制事件：自然退出为 `{ event: "exit", exitCode }`，网关侧结束为
`{ event: "session_ended", reason }`。

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
