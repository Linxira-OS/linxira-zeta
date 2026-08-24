# Zeta Web UI Next (web-ui-next)

Standalone Vite + React 19 + Tailwind v4 web UI for Zeta — the OpenChamber
(桌面 2.0) port backed by the zeta web gateway.

## Relationship to `web-ui/`

`web-ui/` is the legacy Next.js snapshot (OMP Web). `web-ui-next/` is a new,
independent Vite app that speaks directly to the zeta gateway (`zeta serve`,
port 30141). Both are standalone — neither is a root Bun workspace package.
`web-ui-next/` has its own `package.json` / `package-lock.json` and its own
build; the desktop build stages it next to the compiled `zeta` runtime via
`desktop/scripts/prepare-runtime.mjs`.

## Development

```bash
npm install
npm run dev        # Vite dev server on 127.0.0.1:5199, /api proxied to 30141
npm run build      # production bundle → dist/
```

Start `zeta serve` first (port 30141). The Vite dev server proxies `/api/*`
to the gateway.

## Architecture

- `src/lib/zeta/` — gateway bridge:
  - `ZetaGatewayService.ts` — REST adapter over the gateway `/api/*` plus the
    fake SDK proxy backing `experimental.session.list` / `session.*` / `path` /
    `project` / `command` / `question` / `permission`.
  - `eventBridge.ts` — per-session SSE pipeline (`/api/agent/[id]/events` +
    `/api/agent/running/events`) translating zeta frames to the OpenChamber
    event contract, with running-set discovery, HTTP reconciliation, synthetic
    heartbeats, and TPS tracking (`zeta.tps`).
  - `convert.ts` — message conversion; context fill mirrors zeta's
    `calculatePromptTokens` (input + cache, no output) for parity.
- `src/sync/` — OpenChamber sync layer consuming the pipeline.
- `src/components/chat/` — chat, QuestionCard, PermissionCard, work-status.

## Server-side integration (zeta packages)

UI-gated tools register because `createAgentSession` passes `hasUI: true`
(`packages/coding-agent/src/server/web-gateway/agents.ts`). The gateway emits
`extension_ui_request` frames over SSE and resolves them via
`POST /api/extension-ui/response` (global route, `uiRequestOwners` map).
AskTool falls back to `ui.select` (no `askDialog` on the gateway UI context),
so asks surface as QuestionCards.

Other gateway endpoints used by this app:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/sessions` / `POST /api/agent/new` | session list / create |
| `GET /api/agent/:id/events` | per-session SSE |
| `POST /api/agent/:id` | command channel (prompt/steer/follow_up/abort/...) |
| `POST /api/extension-ui/response` | answer a pending select/confirm dialog |
| `GET /api/models` | providers + models |
| `GET /api/skills` / `POST /api/skills` | slash commands |
| `GET/PUT /api/settings` | CLI settings editor (10 tabs, 328 entries) |
| `GET/PUT /api/web-config` | tray/autostart/channels/remote + uiVersion |
| `GET /api/usage` | aggregate token burn across sessions |
| `DELETE /api/projects` | cascade-delete sessions by project / temp sweep |

## Surfaces cut vs OpenChamber

Dictation/voice settings, scheduled tasks (zeta has no scheduling backend),
Pull Request tab, and terminal+browser rail entries are not ported. The
project-hide and temp-workspace-sweep features are Zeta additions.

## License

Portions derived from OpenChamber (MIT). See `NOTICE.md`.
