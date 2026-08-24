# Zeta Gateway Bridge (`src/lib/zeta/`)

This directory owns every zeta-specific adaptation of the ported OpenChamber UI
layer. The UI components and stores are untouched upstream code; all backend
knowledge lives here.

## Architecture

OpenChamber's UI talks to its backend through two seams; both are replaced:

| Seam | Upstream | Zeta replacement |
|---|---|---|
| SDK client singleton | `@/lib/opencode/client` → `OpencodeService` (opencode HTTP API) | `ZetaGatewayService` wraps the singleton (`client.ts` L1-2, L2016-2021); Phase 1 intercepts boot reads + delegates, Phase 2 implements real mappings |
| Runtime APIs | `window.__OPENCHAMBER_RUNTIME_APIS__` injected by the Express host (`packages/web/src/api/index.ts`) | `ZetaRuntimeApis.ts` constructs the object in `main.tsx` |

`SessionAuthGate` is bypassed in `main.tsx` (no `/auth/session` backend; zeta
remote access uses the `X-Zeta-Token` fetch patch instead).

## Phase 2 mapping table (OpencodeService → zeta gateway)

Endpoint source of truth: `web-ui/lib/agent-client.ts` + `useAgentSession.ts`
in the old UI; route table in
`packages/coding-agent/src/server/web-gateway.ts` (all responses
`{ success, data }` / `{ error }`).

| OpencodeService member | Zeta gateway endpoint |
|---|---|
| `listSessions` | `GET /api/sessions` |
| `getSession` | `GET /api/sessions/[id]?deferThinking=1&deferMedia=1` |
| `deleteSession` | `DELETE /api/sessions/[id]` |
| `getSessionMessages` / context | `GET /api/sessions/[id]/context?leafId=` |
| live state | `GET /api/sessions/[id]/state` |
| `sendMessage` / `sendCommand` / steer/abort/mode | `POST /api/agent/[id]` (command channel, `sendAgentCommand` helper) |
| session create | `POST /api/agent/new` |
| shared/current session | `GET /api/agent/current` |
| agent state | `GET /api/agent/[id]` |
| event stream | `GET /api/agent/[id]/events` (SSE) → `eventBridge.ts` |
| models | `GET /api/models?cwd=` |
| model config | `GET`/`PUT /api/models-config` |
| providers auth | `/api/auth/*` (login/logout/providers/api-key) |
| skills | `/api/skills*` |
| slash commands | old UI `loadSlashCommands` source (same as ChatWindow) |
| settings | `GET`/`PUT /api/settings` |
| web config | `GET`/`PUT /api/web-config` |
| desktop info | `GET /api/desktop/info` |
| update check | `/api/update/*` |
| channels (wechat/telegram/lark) | `/api/channels/*` |

## Phase 2 disposition (current)

- `ZetaGatewayService` implements the operational surface against the zeta
  gateway: sessions (list/get/create/delete/rename/messages), chat commands
  (`prompt`/`steer`/`follow_up`/`bash`/`abort`/`compact`), providers
  (`GET /api/models`, cwd fallback), commands/skills (`get_commands`,
  `/api/skills`), permissions/questions reply mapping (extension_ui_response;
  listing still empty until Phase 4 pending-registry exposure).
- The SDK proxy backs `experimental.session.list`, `session.*`, `path.get`,
  `project.*`, `config.get`, `command.list`, and benign empties for
  `mcp/lsp/vcs/question/permission`.
- `eventBridge.ts` implements the sync EventPipeline contract over
  `/api/agent/[id]/events` + `/api/agent/running/events`; run-end HTTP
  reconciliation closes sub-100ms-turn races; synthetic heartbeats keep the
  stale watchdog calm.
- `projectSync.ts` seeds the client-local project registry from session roots
  (required for provider/config activation).
- Known gaps (later phases): `navigate_tree`/`fork` need entryId mapping via
  the context tree; AgentState has no `contextUsage` key (Phase 6 computes it).
- `ZetaRuntimeApis`: `runtime`/`settings`/`permissions`/`notifications`/`tools`
  are explicit; `git`/`files`/`terminal` auto-reject every method.

## Deliberately cut surfaces (no zeta backend; do not re-add without a plan entry)

- dictation / mic / voice settings: removed (`components/dictation/`,
  `hooks/useDictation.ts`, OpenChamber settings Voice section). The pure-client
  speechSynthesis hooks (`useMessageTTS`/`useLocalTTS`) remain for FilesView /
  PlanView read-aloud buttons.
- terminal + browser rail surfaces: entries removed from
  `lib/surfaces/registry.ts` and ProjectActionsButton unmounted from Header /
  TitlebarLeftControls. Component files (`components/terminal/`,
  `components/browser/`, `TerminalView`) are unreachable dead code kept until a
  dedicated cleanup pass — no entry point can open these tabs anymore.
- github PR/push panels: right-sidebar Pull Request tab removed.
- automations / scheduled tasks: sidebar button and views removed.
- plugin marketplace (zeta uses its own PluginsConfig): not present in tree.
- quota provider bars: deferred to Phase 6 — the work-status/context usage UI
  will be replaced with zeta-computed stats; empty-state fetch failures today
  are benign.
- PWA service worker: never ported.
