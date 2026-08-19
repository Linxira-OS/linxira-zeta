# Web UI gateway API

All endpoints below are served by the Web Gateway at
`http://127.0.0.1:30141/api/*` (the port ZetaServer proxies). Unless noted,
request and response bodies are JSON. Errors are `{ "error": string }` with a
4xx/5xx status.

Base paths in this document use `:id` / `:provider` for path parameters.
Session ids are `[A-Za-z0-9-]+`; provider ids are `[A-Za-z0-9_.-]+`.

## Sessions

### `GET /api/sessions`

List all sessions.

```json
{ "sessions": [ /* SessionInfo[] */ ], "runningSessionIds": ["..."] }
```

### `GET /api/sessions/:id`

Full session document (context, tree, model, name). Supports query params
`deferThinking=1` and `deferMedia=1` to skip heavy payloads.

### `PATCH /api/sessions/:id`

Rename a session. Body: `{ "name": string }`.

### `DELETE /api/sessions/:id`

Delete a session.

### `GET /api/sessions/:id/context`

Session context. Query: `leafId`, `deferThinking`, `deferMedia`.

```json
{ "context": { "messages": [], "entryIds": [] } }
```

### `GET /api/sessions/:id/state`

Live agent state. While the RPC session is alive:

```json
{ "running": true, "state": { /* AgentState, see below */ } }
```

`AgentState` fields: `sessionId`, `sessionName`, `model`
(`{ provider, modelId } | null`), `systemPrompt`, `thinkingLevel`,
`isStreaming`, `isPromptRunning`, `isBashRunning`, `isCompacting`,
`extensionStatuses`, `extensionWidgets`, `queuedMessages`
(`{ steering, followUp }`), `planModeEnabled` (boolean),
`planFilePath` (`string | null`), and `planContent` (`string | undefined`,
the plan file body when plan mode is active).

### `GET /api/sessions/:id/entries/:id/thinking`

Thinking blocks for one entry. Query: `blockIndex` (0-based).

### `GET /api/sessions/:id/export`

Export the session. Query: `inline=1` returns the payload directly.

## Agents

### `POST /api/agent/new`

Start a new live agent session. Body: `{ cwd?: string, type?: string, ... }`
(the remaining keys are forwarded as a start command).

### `POST /api/agent/:id`

Send one command. Body is the command object; every response is wrapped:

```json
{ "success": true, "data": <result> }
```

Commands: `prompt` (`{ message, images?, streamingBehavior? }`), `steer`
(`{ text, images? }`), `follow_up` (`{ text, images? }`), `abort`, `get_state`
(returns `AgentState`), `set_model` (`{ provider, modelId }`),
`fork` (`{ entryId }`), `navigate_tree` (`{ entryId }`),
`set_thinking_level` (`{ level }`), `compact`, `set_session_name`
(`{ name }`), `get_session_stats`, `get_last_assistant_text`,
`set_auto_compaction` (`{ enabled }`), `clear_queue`, `get_tools`,
`get_commands`, `set_tools` (`{ toolNames }`), `reload`,
`abort_compaction`, `set_auto_retry` (`{ enabled }`), `bash`
(`{ command, excludeFromContext? }`), `abort_bash`, and `plan_approve`
(`{ planFilePath, mode }` with `mode` ∈ `preserve | compact | fresh |
cancel`).

### `GET /api/agent/:id`

`AgentState` snapshot (equivalent to `get_state`).

### `GET /api/agent/:id/events`

Server-Sent Events stream of live agent events. Each frame is
`data: <json>`; a `connected` frame arrives first, then runtime session
events (`turn_start`, `message_start`, `message_update`, `message_end`,
`turn_end`, `agent_start`, `agent_end`, `tool_execution_start`,
`tool_execution_end`, `bash_chunk`, `queue_update`, extension UI requests,
…) plus a 30s `:` comment heartbeat.

### `GET /api/agent/running/events`

SSE stream of the current running-session id set:

```json
{ "type": "running", "runningSessionIds": ["..."] }
```

## Auth

### `GET /api/auth/all-providers`

All known providers with their auth mode.

### `GET /api/auth/providers`

Providers with configured/active auth and login status.

### `GET /api/auth/api-key/:provider`

Whether the provider has a stored API key.

### `POST /api/auth/api-key/:provider`

Set an API key. Body: `{ "apiKey": string }`.

### `DELETE /api/auth/api-key/:provider`

Remove the stored API key.

### `GET /api/auth/login/:provider`

SSE stream for the OAuth login flow (authorization URL + poll events).

### `POST /api/auth/login/:provider`

Complete an OAuth login. Body: `{ token?, code? }`.

### `POST /api/auth/logout/:provider`

Remove the provider's stored auth.

## Models

### `GET /api/models`

Model list. Query: `cwd` (defaults to `process.cwd()`).

### `POST /api/models/import`

Import models from a base URL. Query: `base`. (GET also accepted for
compatibility; the handler checks the method.)

### `PUT /api/models/default`

Set the default model. Body: `{ "provider": string, "modelId": string }`.

### `GET /api/models-config`

Read the models config file. `{ "providers": {} }` when unset.

### `PUT /api/models-config`

Write the whole models config JSON.

### `POST /api/models-config/test`

Test a models-config change in a temporary directory.

## Skills

### `GET /api/skills?cwd=<path>`

List skills for a project.

### `PATCH /api/skills`

Body: `{ filePath, disableModelInvocation }`.

### `POST /api/skills/install`

Body: `{ package, scope, cwd? }`.

### `POST /api/skills/search`

Body: `{ query, limit? }`.

### `POST /api/skills/check`

Body: `{ cwd, package?, scope? }`.

### `POST /api/skills/update`

Body: `{ cwd, package, scope }`.

## Open / Update / Plugins

### `GET /api/open/options`

Available "open in" targets (editor / terminal for the platform).

### `POST /api/open`

Body: `{ target?: string, path?: string }` — open a path in an editor or
terminal.

### `GET /api/update/check`

Check for a newer release. `{ updateAvailable?: boolean, ... }`.

### `POST /api/update/download`

Download the latest release.

### `POST /api/update/install`

Install the downloaded release.

### `GET /api/plugins?cwd=<path>`

List plugins for a project.

### `POST /api/plugins`

Body: `{ action, source?, scope?, cwd }`.

## Settings / Web config

### `GET /api/settings?lang=en|zh`

The full settings catalog (tabs, groups, per-setting rows) with current
values and localized labels.

### `PUT /api/settings`

Update one setting. Body: `{ "path": string, "value": unknown }`.

### `POST /api/settings/reload`

Reload settings from disk (honors `x-zeta-cwd` header).

### `GET /api/web-config`

The merged web-layer config (`~/.zeta/agent/web.yml`) with secrets masked.

### `PUT /api/web-config`

Update one dot path. Body: `{ "path": string, "value": unknown }`; unknown
paths return 400.

## Docs

### `GET /api/docs/<path>`

Read a packaged documentation file (relative to `docs/`, e.g.
`user-guide.md` or `web-ui/architecture.md`). Paths are restricted to
`[A-Za-z0-9._/-]` and must not contain `..` or be absolute. Content comes
from the packaged docs embed (compiled binaries / npm bundle) with the
source `docs/` tree as the dev fallback.

```json
{ "path": "user-guide.md", "content": "# ..." }
```

Missing files return 404 `{ "error": "not_found" }`.

## Channels

### `GET /api/channels/wechat/qrcode`

WeChat QR-login state:

```json
{ "pending": true, "qrcodeUrl": "...", "status": "..." }
```

or `{ "pending": false }`.

### `POST /api/channels/wechat/reconnect`

Trigger a fresh WeChat QR login. `{ "ok": true }` or 404 when the channel is
not running.
