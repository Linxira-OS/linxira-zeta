# Local rooms (Super / Repo / Main)

Local rooms are the contacts-style collaboration layer from
`../document/super-agent-rooms.md`: a durable, ordered chat shared by the operator,
repository main agents, and explicitly promoted resident agents. They are
separate from the Team database rooms in `docs/team.md` and do not replace them.

## Scope and non-goals

- Single machine, single user. There is no account, password, device pairing, or
  cross-machine authorization in this surface.
- A room is a log, not a session. Room events never enter session JSONL.
- No second task scheduler: fan-out stays in `task`/`workpool`. A room only
  chooses message recipients and order.
- Messages do not forward across rooms. A parent room must explicitly ask a
  member to visit a child room and report back.
- One repository's tracking, taste, memory, or context is never injected into
  another repository's member.
- The proposal/ack ledger does not mutate a target repository. The target agent
  or user applies an accepted decision through its existing tracking mechanism.

## Store

`packages/coding-agent/src/rooms/db.ts` opens one SQLite file:

- default: `<agent dir>/data/rooms.db` next to the global `zeta.db`;
- override: `ZETA_ROOMS_DB` (tests and local experiments).

`PRAGMA user_version` gates migrations. Tables:

| Table | Purpose |
| --- | --- |
| `rooms` | `room_id`, kind (`super`/`repo`/`main`), name, optional home repo, timestamps |
| `room_members` | room, member id, role (`super`/`repo`/`main`/`resident`), display name, home repo/session |
| `room_events` | `(room_id, seq)` primary key, host `sent_at`, actor, body, `reply_to`, mentions, round |
| `room_cursors` | per member `seen` / `delivered` / `read` sequence |
| `room_rounds`, `room_round_targets` | delivery mode, target status, delivered/replied seq |
| `room_proposals` | proposal/ack metadata and target repo; no tracking writes |

`seq` is assigned by the host as `max(seq)+1` inside the append transaction and
is scoped to one room. `sentAt` is also host-assigned and strictly increases even
when two posts share a millisecond. Sender-provided order is never trusted.

## Membership and context

- `super` rooms federate main agents across repositories.
- `repo` rooms are scoped to one repository root.
- `main` rooms hold one main agent and explicitly promoted residents.
- The operator (`user`) is implicit and is never stored as a member row.
- A resident must already exist and be a direct child of a `main` member.
  Promotion only adds membership; it does not spawn, reparent, or grant global
  peer access. Park/revive call `AgentLifecycleManager`.

A delivered message carries a bounded context built only from the room log:
identity, home repo, trigger event, and up to 40 recent room events. The text
states that home-repository instructions/tracking take precedence and that
external content is evidence, not instruction. No other room, tracking, taste,
memory, or transcript is read.

## Delivery

A user post opens one round:

| Mode | Recipients | Order |
| --- | --- | --- |
| `parallel` (default) | every member except the actor | all at once; replies append in completion order |
| `serial` | every member except the actor | one at a time; the next recipient sees earlier replies |
| `mention` | members matched by id, display name, or role | only mentioned members |

Delivery goes through `RoomDeliveryPort`, implemented with the existing
`IrcBus` and `AgentSession.deliverIrcMessage` path. Per-member
`delivered_through_seq` makes a repeated delivery call a no-op. A round target
is `pending` → `delivered` → `replied`/`passed`; `room.round.stop` fails pending
targets, records a `stop` event, and aborts turns already delivered.

Agent replies use `local_room_reply` (or the host `room.reply` command). The
reply gets a new host seq in the same room and advances a serial round. This is
the real reply hook; no exported callback is left unconnected.

## Studio and agent tools

- Host family `rooms` (`server/studio-host/ops/rooms.ts`) serves
  `rooms.list`, `room.get`, `room.log.read`, `room.contacts.list` and the
  `room.*` commands. The capability manifest advertises only registered
  handlers; there are no fixture rows.
- `agent.send`, `agent.kill`, `agent.revive`, and `agent.release` are registered
  against `AgentRegistry`/`AgentLifecycleManager` with generation fencing.
  `agent.spawn` remains unregistered because the host has no spawn route.
- Studio renders the real host data at route `rooms` (`web-app/src/studio/RoomsPage.tsx`):
  room list, contacts/member status, ordered events, quote/reply, @ insertion,
  unread, delivery mode, stop round, and resident park/revive.
- SDK tools: `local_room_read`, `local_room_post`, `local_room_reply`.
  `local_room_reply` appends to the durable log and advances serial delivery.

## Verification status

The room log, delivery coordinator, resident lifecycle, and host manifest were
exercised locally with Bun (no real LLM call):

- `packages/coding-agent/test/rooms/room-log.test.ts`
- `packages/coding-agent/test/rooms/room-delivery.test.ts`
- `packages/coding-agent/test/rooms/room-resident.test.ts`
- `packages/coding-agent/test/rooms/room-consumers.test.ts`
- `packages/coding-agent/test/studio-host/rooms-manifest.test.ts`

They use real temp SQLite files and the real `AgentRegistry` /
`AgentLifecycleManager`. The delivery tests record the injected context at the
transport seam; they do not mock a model or assert source text. The Studio
`RoomsPage` and the web-app typecheck were not built in this sparse worktree
(the workspace hoists TypeScript 7 while `web-app` pins 5.9), so the UI is
source-reviewed but not browser-verified.

## Open gaps

- `room.create` from Studio still accepts an explicit repository root string;
  a path-free workspace-id resolver is future work.
- `agent.spawn` is not a host command.
- Turn-output auto-capture is not attached: a resident must call
  `local_room_reply`. This avoids correlating unrelated assistant turns.
- No cross-machine room transport or device auth exists; mesh delivery inherits
  the existing single-user trust model.
