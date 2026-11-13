# local_room_reply

> Reply to a delivered local room event as the current agent, through the same
> durable path the room host uses.

## Source

- Entry: `packages/coding-agent/src/tools/local-rooms.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/local-room-reply.md`
- Reply hook: `recordRoomReply` in `packages/coding-agent/src/rooms/transport.ts`
- Registration: `packages/coding-agent/src/tools/index.ts` (`BUILTIN_TOOLS.local_room_reply`), `packages/coding-agent/src/tools/builtin-names.ts`

## Registration / Visibility

- Built-in tool in the coding-agent tool registry (`BUILTIN_TOOLS`), visible to
  the model in normal sessions.
- Intended for an agent that was delivered a room event: the room host injects
  a `[local-room:<roomId>:<roundId>:<seq>]` context carrying the room id,
  triggering seq, and round id. `local_room_reply` calls
  `recordRoomReply`, the same service the host uses, so the reply lands in the
  durable room log and a serial round advances.

## Inputs

| Field | Type | Required | Description |
|---|---|---:|---|
| `roomId` | `string` | Yes | Room id from the delivered context. |
| `body` | `string` (non-empty) | Yes | Reply body. |
| `replyTo` | `number > 0` | No | Seq of the event being answered (the delivered `seq`). |
| `roundId` | `string` | No | Round id when the delivered context named one. |

## Outputs

- `content[0].type = "text"` — `Replied as #<seq>.` or
  `Replied as #<seq>; next: <memberId>, …` when advancing the round delivered
  to further members.
- `details` — `{ seq, next }`, where `seq` is the new host sequence and `next`
  lists the members the advanced round accepted delivery for.

## Side Effects

- Appends the reply to the room log with a new host-assigned seq.
- With `roundId`, advances the serial round through
  `RoomDeliveryCoordinator.advance`, which may deliver the next turn to member
  sessions (including reviving a parked member). The reply itself never
  broadcasts to the room.

## Errors

- `This session has no agent identity; a room reply needs one.` — no agent id
  is available for the sender.
- `Agent "<id>" is not a member of this room` — the replying agent is not
  registered in the room.
- Invalid parameters (empty `body`, non-string `roomId`, non-positive
  `replyTo`) are rejected by the schema before execution.
