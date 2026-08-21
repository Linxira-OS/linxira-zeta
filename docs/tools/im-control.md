# im_control

> Natural-language control of the IM relay (WeChat / Feishu / Telegram through `zeta serve`): workspaces, default-space sessions, reply language, and model. The coordinator (and each bot session) calls it when the user asks — in any language — to manage those, instead of requiring `!` commands.

## Source
- Entry: `packages/coding-agent/src/tools/im-control.ts`
- Controller: `packages/coding-agent/src/channels/im-control.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/im-control.md`

## Registration / Visibility
- Web/desktop mode only: available when the session runs under `zeta serve` with a channel runtime and `channels.enabled` is not `false`.
- Rejected in plain CLI sessions (`isToolAllowed` returns `false` when `ToolSession.imControl` is undefined).
- Exposed on both the relay coordinator and every default-space bot session (both are `AgentSession`s created through the same tool wiring).

## Inputs

| Field | Type | Required | Description |
|---|---|---:|---|
| `operation` | `"list_workspaces" \| "list_sessions" \| "use_session" \| "new_session" \| "rename_session" \| "delete_session" \| "set_language" \| "list_models" \| "set_model" \| "status"` | Yes | Which IM control intent to execute. |
| `session` | `string` | No | Session selector for `use_session` / `rename_session` / `delete_session`: bare id, `{n}` list index, or `[id]`. |
| `name` | `string` | No | Display name for `new_session` / `rename_session`. |
| `language` | `"zh" \| "en"` | No | Reply language for `set_language`. |
| `provider` | `string` | No | Provider id from `list_models`, for `set_model`. |
| `model` | `string` | No | Model id from `list_models`, for `set_model`. |

## Outputs
- `content[0].type = "text"` — the operation result (listings use `{n}` numbers and `[name]` names; pass them back verbatim).
- `isError: true` with an explanatory message for unknown entities, missing params, or the protected `relay` session.

## Side Effects
- Chat-scoped operations (`use_session`, `set_language`, `set_model`) mutate the session registry / `web.yml` (persisted) exactly like their `!`-command counterparts. No model round-trip — the controller is local state only.

## Errors
- `im_control is not available in this session (CLI mode or no IM relay).`
- `No chat context for this session.` — the calling session has no bound inbound chat yet.
- `Unknown bot session "…".` / `Unknown workspace […].` — entity not found; the reply lists the valid `{n}`/`[name]` options.
- `relay 会话不可删除` — the relay session is protected from deletion.
- `Language must be "zh" or "en".` — invalid `language` value.
