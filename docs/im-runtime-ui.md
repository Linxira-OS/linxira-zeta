# IM runtime UI (Studio + TUI)

> Status 2026-11-11. Consumes the frozen IM runtime contract
> **ADR-IM-0007 / INT-IM-01** (`local://im-runtime-contract.md`). The backend
> routes are landing separately; this page never falls back to
> `channels.<platform>` or `remote.sessionMappings`, so a half-migrated backend
> shows its error instead of a stale second truth.

## Studio page

`web-app/src/studio/settings/ImRuntimePage.tsx` is exported for the Studio
shell to mount (App routing is owned by the Studio lane; this slice does not
edit `App.tsx`). The page reads and writes:

| Surface | Route |
| --- | --- |
| Instances | `GET/PUT /api/channels/instances` |
| Runtime state | `GET /api/channels/status` (`instances[]`) |
| Credential validation | `POST /api/channels/instances/:id/validate` |
| Enable / disable | `POST /api/channels/instances/:id/{enable,disable}` |
| WeChat | `POST /api/channels/instances/:id/wechat/{qrcode,reconnect,unbind}` |
| Bindings | `GET/PUT /api/im/bindings` |
| Profiles + targets | `GET /api/im/agents`, `PUT /api/im/agents` (write route requested from the backend) |
| Bot state/commands | `GET /api/im/commands?instanceId=&chatId=` |
| One message | `POST /api/channels/send` `{ instanceId, to, text }` |

### Instances

- One row per instance; several instances may share a platform. The instance id
  is the runtime namespace and immutable after creation.
- Status words come from `instances[].running/state/detail/lastError` plus
  `configured`; an instance that is enabled but absent stays "not started".
- Credentials are masked (`••••`) on read. The editor sends:
  **empty → keep** (field omitted), **explicit clear → `null`**, **value →
  replace**. The mask is never sent back as a value.
- WeChat QR is per instance and rendered from the server's `svg`; image payloads
  fall back to an `<img>`. Reconnect/unbind act on that instance only.
- Validate calls the platform without writing; success reports the identity, a
  rejection shows the gateway's redacted error.

### Bindings

- A row shows instance, chat/thread/user, target display, agent profile,
  session, model and role. `needsReview` and unavailable targets are visible and
  block a save until a usable target is selected; an unknown target is never
  silently treated as valid.
- At most one `answer` binding per chat; additional rows must be `observe`
  (client-side pre-check, backend enforces).
- The write projection strips UI-only display facts (`targetDisplay`,
  `targetAvailable`, `needsReviewReason`) so they cannot be mistaken for caller
  input. `sessionId` must reference an existing bot session.

### Agent profiles

- Persona (`inline` / `file` / `workspace`), model, location (`workspace` /
  `team-pm` / `engineer`), memory backend/namespace/workspace context.
- Tool allowlists: **builtin, extensions, MCP servers, custom tools, skills,
  commands**, plus preset and approval mode. Each list is one-per-line and
  literal: an empty list means *none*. New profiles start with empty lists —
  ambient tools are never inherited and `customTools` defaults to empty.
- `capabilities` is backend-enforced metadata, not a UI permission toggle. The
  editor does not render or change it; when present it is preserved verbatim so
  the UI never claims a permission it does not execute.
- The runtime identity includes `bindingId` and is computed by the backend;
  Studio displays `agentRuntimeId` from `/api/im/commands` and never composes it.

### Bot state / commands

`GET /api/im/commands` returns the current bot, binding (role), session, model,
voice capability and command examples. Voice reports `{supported:false,reason}`
today and the page says so; examples are rendered verbatim. A test message goes
through the instance-scoped send route; a 409 ambiguous response must name
candidate instances (requested contract field).

### Empty / error / loading states

Every section renders loading, empty, and the gateway's own error text. There is
no fabricated success: a missing route (e.g. `PUT /api/im/agents` before the
backend lands) shows the 404/405 message and leaves the editor open.

## TUI `/channels`

`/channels` now renders a redacted admin page (`packages/coding-agent/src/channels/admin-view.ts`):

```
/channels status | instances | targets | bindings
/channels enable-instance <id>
/channels disable-instance <id>
/channels login wechat [timeout]        (unchanged terminal QR)
/channels enable|disable <platform>     (legacy platform rows)
```

- Instances show enabled/running/configured/state/last-error and the resolved
  target; bindings show role, profile, session, target and `needs-review` /
  `target-unavailable` marks; targets list availability and reasons.
- No token, app secret or peer token ever enters the snapshot or the
  transcript; credential login stays in Studio or the CLI.
- If `web.yml` still has the legacy platform shape, instances are synthesized
  with `id = platform` and the page says migration is pending. The TUI
  `enable-instance` write uses `channels.instances` and therefore starts working
  once the backend adds that path; until then it reports the write error
  verbatim rather than pretending it toggled something.

## Gaps

- The backend routes and `imAgents` write route are not on `main` yet; this
  branch is a local integration slice with tests against the frozen shapes.
- Studio routing must mount `ImRuntimePage`; browser interaction is verified
  through the real Settings page in a build window, not an isolated demo.
- Binding creation needs an existing bot session; the contract's session
  creation flow is not exposed by this page.
