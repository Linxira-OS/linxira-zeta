# channel_send

> Push a message to the remote IM channel (WeChat / Feishu / Telegram) the user talks to through `zeta serve`. The agent decides what is worth forwarding; working-tool output is never sent automatically.

## Source
- Entry: `packages/coding-agent/src/tools/channel-send.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/channel-send.md`

## Registration / Visibility
- Web/desktop mode only: available when the session runs under `zeta serve` with a channel runtime and `channels.enabled` is not `false`.
- Rejected in plain CLI sessions (`isToolAllowed` returns `false` when `ToolSession.channelSend` is undefined).

## Inputs

| Field | Type | Required | Description |
|---|---|---:|---|
| `text` | `string` | Yes | Message body to send. |
| `to` | `string` | No | Target peer identifier (WeChat user id / Feishu open_id / Telegram chat_id). Defaults to the session-bound peer (the user who sent the last inbound message). |
| `channel` | `"wechat" \| "feishu" \| "telegram"` | No | Channel to use. Defaults to the session-bound channel. |

## Outputs
- `content[0].type = "text"` — `"Sent."` on success.
- `isError: true` with an explanatory message when the channel runtime is unavailable, no peer is bound, or delivery throws.

## Side Effects
- Sends a user-visible message on the external IM platform. No local filesystem or process effects.

## Errors
- `channel_send is not available in this session (CLI mode or no channel runtime).`
- `No channel or peer bound to this session` — raised when `to`/`channel` are omitted and there is no inbound message yet.
- `channel_send failed: <reason>` — the underlying channel delivery threw (e.g. WeChat missing `context_token` for the peer).
