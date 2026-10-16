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
`set_thinking_level` (`{ level }`), `compact` (`{ customInstructions? }`),
`set_session_name`
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

Open targets with availability: `{ desktop, targets: [{ type, label,
`available, default?, editor?, detail? }] }`. `type` is `terminal`,
`explorer`, `editor` (then `editor` carries the product id), or
`terminal-ide` (`zetaide`); `default` marks the gateway-suggested target. On
Windows the terminal is resolved through the
`pwsh` → Git Bash → `powershell` chain, elsewhere `$SHELL` → bash; probe
results are cached in-process (~60s).

### `POST /api/open`

Body: `{ target?: string, path?: string, editor?: string }` — open a path in
an editor, terminal, file manager, or one of the bundled terminal tools
(`terminal-ide` spawns `zetaide` at the path). Desktop hosts execute only
`explorer` / `editor` targets and receive a signed `{ path, token }`
capability; the bundled terminal tool always launches through the gateway.

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

## Terminal

The embedded terminal (spec §15) is a gateway-owned PTY with a REST control
plane and a WebSocket data plane. Sessions are process-scoped: the gateway
keeps them, not the browser, and a gateway restart ends every session.

A session occupies a **slot** identified by `(absolute cwd, instanceId)`. The
UI allocates the instance id (first slot `t1`, then `t2`, `t3`, … per
workspace) and sends it with every ensure; the same slot always resolves to the
same PTY, which is what makes closing and reopening the pane a reattach rather
than a new spawn.

### `POST /api/terminal/ensure`

Body: `{ cwd?, instanceId?, file?, line?, col?, replace? }`. Reattach-or-spawn
for one slot:

- live session in the slot → it is returned with a fresh connect ticket and
  `reused: true`; its replay ring buffer still holds the scrollback, and it
  does **not** consume another entry of the live-terminal budget;
- no live session (first open, exited, killed, or a previous gateway process)
  → a session is spawned, `reused: false`;
- `replace: true` ends the slot's live session first (`session_ended`,
  reason `killed`) so the new spawn carries the `file`/`line`/`col` zetaide
  injection.

Response: `{ id, ticket, shell, cwd, instance, program, fallbackReason, reused,
injected }`. `program` is `workbench` when the framework workbench
(`zetawork`; npm bins `zeta` / `zetawork`) resolved through the
shared binary-discovery tiers, else `shell` with
`fallbackReason: "workbench-not-found"` — the UI must show that fallback
instead of silently running the shell. On Windows a resolved `.cmd`/`.bat`
launcher is started as `cmd.exe /c <shim>` (ConPTY cannot exec a script).

Failures carry a machine-readable `code`: `cwd_missing` / `cwd_not_directory`
(400 — the workspace directory is gone), `invalid_instance` (400),
`terminal_limit` (429, plus `limit`), `no_program` (500).

### `POST /api/terminal`

Body: `{ cwd?, file?, line?, col? }` → `{ id, shell, cwd, ticket, injected }`.
Legacy always-spawn form (used by the `file`-injection chip flow); it claims
the `default` slot.

### `GET /api/terminal`

`{ terminals: [{ id, shellLabel, shellCommand, cwd, instance, program,
fallbackReason, exited, exitCode, startedAt, exitedAt }] }` — live sessions plus
the newest 25 exited records.

### `DELETE /api/terminal/:id`

Kill (live) or drop (retained exited) a session. Attached clients receive
`{ event: "session_ended", reason: "killed" | "expired" }` before the socket
closes with 1000; a retained exited record that ages out sends the `expired`
variant. Either way the slot is released, and the PTY is reaped.

### `POST /api/terminal/:id/resize`

Body: `{ cols, rows }` (2…1000). 409 when the session already exited.

### `POST /api/terminal/:id/ticket`

Issue a one-time, 60-second connect ticket for the WS data plane. 404 when the
session is gone — the UI's signal that a reattach target no longer exists.

### `GET /api/terminal/:id/ws?ticket=<ticket>`

WebSocket upgrade (loopback callers may omit the ticket). The first outbound
frame is `0x00`-prefixed JSON metadata (`{ replayedBytes }` on attach, then the
replay payload), later frames are raw PTY bytes; inbound text frames are stdin.
Control events: `{ event: "exit", exitCode }` for a natural exit,
`{ event: "session_ended", reason }` for a gateway-side end.

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

### `POST /api/channels/send`

Send one text message through a running channel — the out-of-process half of the
`channel_send` tool, for a caller that is not the serve process (the desktop
shell, the GUI's notification fallback, a script).

```json
{ "channelId": "wechat", "to": "<peer id>", "text": "<message>" }
```

All three fields are required: they are the runtime's `sendText(channelId, to,
text)` arguments, and the gateway has no chat of its own to default to.

```json
{ "ok": true, "receipt": { "channelId": "wechat", "to": "<peer id>", "textLength": 12, "sentAt": "<ISO 8601>" } }
```

400 when a field is missing or blank, or when the peer is not paired with that
channel (WeChat refuses a peer it holds no `context_token` for — wait for an
inbound message first); 404 when the channel is not running in this process;
500 when the channel reached the platform and the platform refused. Access
control is the gateway's own, unchanged: loopback passes, a non-loopback caller
needs `remote.token`.
