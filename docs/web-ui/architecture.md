# Web UI architecture

Zeta's web interface is a standalone Next.js app (`web-ui/`) that talks to a
local runtime over HTTP. `zeta serve` starts one Bun process that hosts three
backends and proxies them behind a single port, so the browser only ever sees
one origin.

## Process layout

```
Browser ── :30141 (Bun.serve, ZetaServer)
            ├─ /api/stats/*   → Stats Dashboard (:3847, @linxiraos/pi-stats)
            ├─ /api/*         → Web Gateway (in-process Bun handlers)
            └─ 其他           → Web UI Next.js (random internal port)
```

`ZetaServer` (`packages/coding-agent/src/server/zeta-server.ts`) is the single
entry point. Its `classifyRequest()` decides where each request goes:

| Route type  | Condition                                            | Target                       |
|-------------|------------------------------------------------------|------------------------------|
| `stats`     | `/api/stats*`, `/api/sync`, `/api/request/*`         | Stats Dashboard              |
| `gateway`   | `/api/*` not owned by Next (see below)               | Web Gateway (`webGatewayFetch`) |
| `webui`     | anything else (and Next-owned `/api/*`)              | Web UI Next.js child         |
| `unavailable` | no Web UI backend running                          | 503                          |

A few `/api/*` prefixes stay inside Next.js because they are pure Node code
with no runtime dependency (`/api/fs/`, `/api/files/`, `/api/cwd/`,
`/api/git/`, `/api/home`, `/api/default-cwd`, `/api/worktrees`,
`/api/tracking`, `/api/file-index`). Every other `/api/*` request is handed to
the Web Gateway.

The Web Gateway also exposes a standalone `127.0.0.1` listener
(`ZETA_WEB_GATEWAY_PORT`, default 30142) for `next dev`/`next start` access;
the main proxy dispatches in-process, so a busy gateway port only disables the
dev-mode listener, never the gateway itself.

## Web Gateway dispatch

`webGatewayFetch(req)` in `packages/coding-agent/src/server/web-gateway.ts`
routes by pathname regex. The full route table lives in that file as `*_RE`
constants:

- **Sessions** — `GET/PATCH/DELETE /api/sessions/:id`,
  `GET /api/sessions/:id/context`, `GET /api/sessions/:id/state`,
  `GET /api/sessions/:id/entries/:id/thinking`, `GET /api/sessions/:id/export`
- **Agents** — `POST /api/agent/new`, `GET /api/agent/:id`,
  `POST /api/agent/:id` (command RPC), `GET /api/agent/:id/events` (SSE),
  `GET /api/agent/running/events` (SSE)
- **Auth** — `GET /api/auth/all-providers`, `GET /api/auth/providers`,
  `GET/POST/DELETE /api/auth/api-key/:provider`,
  `GET/POST /api/auth/login/:provider`, `POST /api/auth/logout/:provider`
- **Models** — `GET /api/models`, `POST /api/models/import`,
  `PUT /api/models/default`, `GET/PUT /api/models-config`,
  `POST /api/models-config/test`
- **Skills** — `GET/PATCH /api/skills`, `POST /api/skills/install`,
  `POST /api/skills/search`, `POST /api/skills/check`,
  `POST /api/skills/update`
- **Open / Update / Plugins** — `GET /api/open/options`, `POST /api/open`,
  `GET /api/update/check`, `GET /api/update/download`,
  `GET /api/update/install`, `GET/POST /api/plugins`
- **Settings / Web config** — `GET/PUT /api/settings`,
  `POST /api/settings/reload`, `GET/PUT /api/web-config`
- **Docs** — `GET /api/docs/<path>` (packaged Markdown corpus; see
  `docs/web-ui/api.md`)
- **Channels** — `GET /api/channels/wechat/qrcode`,
  `POST /api/channels/wechat/reconnect`
- **Stats bridge** — `GET /api/agent/running/events` and the running-session
  registry keep the sidebar's live state in sync.

Unknown `/api/*` paths return 404 `{ "error": "Not implemented" }`.

## Live agent sessions

The gateway owns a module-level registry of live `AgentSessionWrapper`
instances (`web-gateway/agents.ts`), keyed by the persistent session id. A
wrapper translates between the runtime `AgentSession` API and the web-ui RPC
protocol:

- **Commands** — `POST /api/agent/:id` with a JSON body; every command is
  dispatched through `AgentSessionWrapper.send()` and wrapped in
  `{ success: true, data: <result> }` (or `{ error }` on failure). Command
  types include `prompt`, `steer`, `follow_up`, `abort`, `get_state`,
  `set_model`, `fork`, `navigate_tree`, `set_thinking_level`, `compact`,
  `set_session_name`, `get_session_stats`, `get_last_assistant_text`,
  `set_auto_compaction`, `clear_queue`, `get_tools`, `get_commands`,
  `set_tools`, `reload`, `abort_compaction`, `set_auto_retry`, `bash`,
  `abort_bash`, and `plan_approve`.
- **State** — `get_state` returns a snapshot including `planModeEnabled` /
  `planFilePath` / `planContent`, so the web UI can render the
  `PlanApproval` card for remote plan reviews.
- **Events** — `GET /api/agent/:id/events` is a Server-Sent Events stream
  (`text/event-stream`). The wrapper subscribes to the runtime session's
  `AgentSessionEvent`s and forwards each one as a `data: <json>` frame, plus a
  synthetic `connected` frame and a 30s comment heartbeat. The client
  (`web-ui/hooks/useAgentSession.ts`) uses these for live streaming, running
  state, queue updates, and extension UI.

`POST /api/agent/new` starts a session; `GET /api/agent/running/events`
streams the set of currently-running session ids to every connected client.

## Stats iframe

The Web UI's Stats tab embeds the Stats Dashboard in an `<iframe>`. The
dashboard URL is injected at spawn time: `spawnWebUi(port, statsUrl)` in
`packages/coding-agent/src/commands/web-ui-launcher.ts` passes
`http://127.0.0.1:<statsPort>` as the second argument, which the web-ui
process surfaces as `NEXT_PUBLIC_STATS_URL`.

## Settings client bridge

`web-ui/lib/settings-client.ts` is the browser-side client for the gateway's
`/api/settings` and `/api/web-config` endpoints. `fetchSettings(lang)` returns
the full settings catalog (tabs, groups, per-setting rows) with values and
localized labels — all label/description localization happens on the gateway
side, the client never builds its own translation table. `updateSetting(path,
value)` persists one setting by dot path; `fetchWebConfig()` /
`updateWebConfig(path, value)` do the same for the independent web-layer
config (`~/.zeta/agent/web.yml`, secrets masked on GET).
