# local_room_read

> Read the durable local Super/Repo/Main room log: list rooms, or read one room's members and ordered events.

## Source

- Entry: `packages/coding-agent/src/tools/local-rooms.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/local-room-read.md`
- Registration: `packages/coding-agent/src/tools/index.ts` (`BUILTIN_TOOLS.local_room_read`), `packages/coding-agent/src/tools/builtin-names.ts`

## Registration / Visibility

- Built-in tool in the coding-agent tool registry (`BUILTIN_TOOLS`), visible to
  the model in normal sessions like the other built-ins.
- Reads the process-global local room service (`roomRuntime()` in
  `packages/coding-agent/src/rooms/transport.ts`). This is the contacts-room
  layer, not the Team SQLite database: a room owns only its own log and never
  exposes another room's events or a repository transcript.

## Inputs

| Field | Type | Required | Description |
|---|---|---:|---|
| `roomId` | `string` | No | Room id to read. Omit to list every local room. |
| `afterSeq` | `number >= 0` | No | Return only events newer than this host sequence. |
| `limit` | `number > 0` | No | Keep only the newest N events. |

## Outputs

- **List** (`roomId` omitted) — one line per room: `- <id> · <kind> · <name>`,
  or `No local rooms.`. `details.rooms` carries the room records.
- **Show** (`roomId` supplied) — a header line with the room kind, name, and id;
  a `members:` line of `displayName (memberId, role)`; then each retained event
  as `#<seq> <sentAt> <actor.name>: <body>` with `(reply to #N)` when the event
  answers another one. `details.events` carries the event records.

## Side Effects

None. `local_room_read` only queries the room log; it appends no event, advances
no round, and writes no session JSONL.

## Errors

- Room service errors (`RoomError`, e.g. an unknown `roomId`) are surfaced as a
  `ToolError` with the service message.
- Invalid parameters (`afterSeq` negative, `limit` non-positive, non-string
  `roomId`) are rejected by the schema before execution.
