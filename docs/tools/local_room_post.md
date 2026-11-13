# local_room_post

> Post one message to a local Super/Repo/Main room as the current agent.

## Source

- Entry: `packages/coding-agent/src/tools/local-rooms.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/local-room-post.md`
- Registration: `packages/coding-agent/src/tools/index.ts` (`BUILTIN_TOOLS.local_room_post`), `packages/coding-agent/src/tools/builtin-names.ts`

## Registration / Visibility

- Built-in tool in the coding-agent tool registry (`BUILTIN_TOOLS`), visible to
  the model in normal sessions.
- Writes through the process-global local room service
  (`roomRuntime().rooms.postMessage`). The agent must be a member of the room;
  the tool posts under that member's identity rather than creating one.

## Inputs

| Field | Type | Required | Description |
|---|---|---:|---|
| `roomId` | `string` | Yes | Room id to post into. |
| `body` | `string` (non-empty) | Yes | Message body. |
| `mode` | `"parallel" \| "serial" \| "mention"` | No | Delivery mode for a user-triggered round. An agent post is a normal message and does not fan out to other agents. |
| `mentions` | `string[]` | No | Explicit mention ids; parsed from the body when omitted. |

## Outputs

- `content[0].type = "text"` — `Posted #<seq> to room <roomId>.`
- `details.event` — the appended `RoomEvent`, including its host-assigned seq.

## Side Effects

- Appends one durable event to the room log under the current agent's member
  identity. It does not write a session transcript, a Team database row, or
  another repository's tracking.
- A user-triggered round opened by the post may schedule delivery to its
  targets; the posting agent itself is not broadcast to.

## Errors

- `This session has no agent identity; a room reply needs one.` — the session
  exposes no agent id.
- `Agent "<id>" is not a member of this room` — the posting agent is not
  registered in the room.
- Invalid parameters (empty `body`, non-string `roomId`, unknown `mode`) are
  rejected by the schema before execution.
