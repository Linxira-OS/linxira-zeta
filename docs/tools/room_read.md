# room_read

> Read-only view of a Team's database rooms: list them, or read one room's members and newest events.

## Status

**IMPLEMENTED (PR #276); not yet in a tagged release.** Lead mode installs
`room_read` and `room_post` together.
The bundled `secretary` subagent also receives `room_read` (but never
`room_post`) so it can summarize room context without speaking in it.

## Source

- Entry: `packages/coding-agent/src/tools/room.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/room-read.md`
- Registration: `packages/coding-agent/src/tools/index.ts` (`BUILTIN_TOOLS.room_read`), `packages/coding-agent/src/tools/builtin-names.ts`

## Registration / Visibility

- A Team surface, not a general coding tool. `resolveBuiltinToolPlan` keeps it
  only when the caller names it in its tool list, so ordinary sessions never
  see it.
- Lead mode installs it ephemerally (`createRoomTools` via `createLeadTools`)
  and removes it when the mode is off.
- Inside the Team database only. The session must sit in a registered Team PM
  workspace; `room_read` never reads a folder as a room.

## Inputs

| Field | Type | Required | Description |
|---|---|---:|---|
| `room` | `string` | No | Room name, with or without the leading `#`. Omit to list every room in the Team. |
| `afterSeq` | `number` | No | Keep only events newer than this sequence number. |
| `limit` | `number` | No | Keep only the newest N events (default 50). |

## Outputs

- **List** (`room` omitted) — one line per room: `#name`, kind (`pm` /
  `coordination` / `room`), owning PM when present, member count, and last
  sequence or `no events`. `details.action = "list"`.
- **Show** (`room` supplied) — the room header, its resolved members with
  roles, and each retained event as `#seq <ISO-8601> <sender> <kind>: <body>`.
  `details.action = "show"`.

## Side Effects

None. `room_read` only queries `rooms`, `room_members`, and `room_events` in
the Team SQLite database; it appends no event and writes no session JSONL.

## Errors

- The session is not inside a registered Team PM workspace — `resolveLeadWorkspace`
  fails with the Team error and no database is opened.
- The named room does not exist in the Team — `ToolError` from the room service.
- Invalid parameters (`afterSeq`/`limit` not positive, non-string `room`) are
  rejected by the schema before execution.
