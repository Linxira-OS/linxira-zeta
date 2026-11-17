# im_control

> Natural-language control of the IM relay (WeChat / Feishu / Telegram through `zetacode serve`): workspaces, default-space sessions, reply language, and model. The coordinator (and each bot session) calls it when the user asks — in any language — to manage those, instead of requiring `!` commands.

## Source
- Entry: `packages/coding-agent/src/tools/im-control.ts`
- Controller: `packages/coding-agent/src/channels/im-control.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/im-control.md`

## Registration / Visibility
- Web/desktop mode only: available when the session runs under `zetacode serve` with a channel runtime and `channels.enabled` is not `false`.
- Rejected in plain CLI sessions (`isToolAllowed` returns `false` when `ToolSession.imControl` is undefined).
- Exposed on both the relay coordinator and every default-space bot session (both are `AgentSession`s created through the same tool wiring).

## Inputs

| Field | Type | Required | Description |
|---|---|---:|---|
| `operation` | `list_workspaces`, `list_sessions`, `use_session`, `new_session`, `rename_session`, `delete_session`, `set_language`, `list_models`, `set_model`, `status`, `route_team_room` | Yes | Which IM control intent to execute. |
| `session` | `string` | No | Session selector for `use_session` / `rename_session` / `delete_session`: bare id, `{n}` list index, or `[id]`. |
| `name` | `string` | No | Display name for `new_session` / `rename_session`. |
| `language` | `"zh" \| "en"` | No | Reply language for `set_language`. |
| `provider` | `string` | No | Provider id from `list_models`, for `set_model`. |
| `model` | `string` | No | Model id from `list_models`, for `set_model`. |
| `body` | `string` | For `route_team_room` | Owner-authored text to forward once. |
| `messageId` | `string` | For `route_team_room` | Platform message id of a real inbound user entry in the calling transcript. |
| `sourceEntryId` | `string` | When ambiguous | Transcript entry id disambiguating repeated message ids across IM instances. |
| `room` | `team` or `mains` | No | Target room, default `team`. |

## Outputs
- `content[0].type = "text"` — the operation result (listings use `{n}` numbers and `[name]` names; pass them back verbatim).
- `isError: true` with an explanatory message for unknown entities, missing params, or the protected `relay` session.

## Side Effects
- Chat-scoped operations (`use_session`, `set_language`, `set_model`) mutate the session registry / `web.yml` (persisted) exactly like their `!`-command counterparts. No model round-trip — the controller is local state only.
- `route_team_room` requires an authenticated main caller in its current active Team scope. It appends one owner-authored room event with the original inbound entry's platform, instance, chat, sender, message id and route metadata. The client cannot supply caller identity or replace provenance. Normal IM delivery and chat/workspace bindings do not change.
- External IM remains a real `role: user` transcript message. Multiple IM instances sharing a main keep each entry's own metadata; later channel or workspace switches do not relabel old entries. Room forwarding is one-shot, after the main receives the inbound.

## Errors
- `im_control is not available in this session (CLI mode or no IM relay).`
- `No chat context for this session.` — the calling session has no bound inbound chat yet.
- `Unknown bot session "…".` / `Unknown workspace […].` — entity not found; the reply lists the valid `{n}`/`[name]` options.
- `relay 会话不可删除` — the relay session is protected from deletion.
- `Language must be "zh" or "en".` — invalid `language` value.
