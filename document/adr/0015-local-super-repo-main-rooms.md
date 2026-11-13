# 0015. Local Super/Repo/Main rooms are a durable log independent of Team DB rooms

- **Status:** Proposed
- **Date:** 2026-11-12
- **Deciders:** Zeta owner (REQ070 local super/repo/main rooms + resident contacts)
- **Links:** [design](../super-agent-rooms.md), [runtime docs](../../docs/rooms.md), [room log](../../packages/coding-agent/src/rooms/db.ts), [delivery](../../packages/coding-agent/src/rooms/delivery.ts), [Studio family](../../packages/coding-agent/src/server/studio-host/ops/rooms.ts)

## Context

`document/super-agent-rooms.md` defines a contacts-style collaboration layer:
Super Rooms (cross-repo main agents), Repo Rooms (one repository, several main
agents), and Main Rooms (a main agent plus explicitly promoted residents). The
Team database already owns `rooms`/`room_events` for PM coordination
(`docs/team.md`, schema v2). That Team surface is scoped to one ownerless Team
root, resolves PM/engineer rows, and is not a cross-repository contacts log.

The host now ships in-process with the Runtime (v18.18.3 line / 1.5.x Work
Studio). The existing primitives are real: `AgentRegistry` tracks main/sub
agents, `AgentLifecycleManager` owns idle→parked→revive, `IrcBus` delivers one
host-authored message into an existing session queue, and the Studio host
advertises only registered operations. Missing until this decision: an
independent room log, room delivery rounds (parallel/serial/mention), explicit
resident membership, and a Studio contacts page.

Constraints taken as given:

- Single machine, single user. No account, password, device pairing, or
  cross-machine authorization system is added by rooms.
- A room event is not a session transcript. Room messages must not write JSONL
  and must not become a second scheduler.
- A child agent may not use a room to bypass its parent or reach global peers.
- One repository's tracking/taste/memory/context is never injected into another
  repository's member.
- The Team graph/DB and its owner remain untouched; rooms are additive.

## Decision

Add `packages/coding-agent/src/rooms/` as a **separate durable log** at
`<agent dir>/data/rooms.db` (override `ZETA_ROOMS_DB`), with no Team DB tables
and no session writes.

- Room kinds are `super`, `repo`, `main`; member roles are `super`, `repo`,
  `main`, `resident`. `user` is implicit and is not a member row.
- `room_events` has a composite primary key `(room_id, seq)`. The host assigns
  `seq = max(seq)+1` and a strictly increasing `sentAt` inside one transaction.
  `seq` is the only order; sender-authored timestamps are never trusted.
- A user post opens one round (`parallel`, `serial`, or `mention`). Delivery
  uses the existing `IrcBus`/session queue through a `RoomDeliveryPort`; it does
  not spawn tasks. Per-member `delivered_through_seq` cursors make delivery
  idempotent. Serial delivers exactly one target at a time and only advances
  after a reply/pass, with prior replies included in the next context.
- A member's context is assembled from the room log only. It contains the
  member's identity/home repository and room events, never another room's
  events, another repository's tracking/taste/memory, or a session transcript.
  Cross-repository content can only appear as text that someone posted; it is
  evidence, not an instruction.
- Residents are explicit promotions of an existing direct child of a `main`
  member. Promotion does not modify the registry or lifecycle. Park/revive call
  the existing `AgentLifecycleManager`; a room cannot create, broadcast as, or
  reparent an agent.
- The proposal/ack ledger stores proposal and ack events plus target metadata.
  Acceptance never writes the target repository automatically; the target
  agent/user applies it through its existing tracking mechanism.
- The Studio host exposes a `rooms` family backed by the real log. Agent
  `agent.send|kill|revive|release` handlers are registered against the real
  registry/lifecycle. The capability manifest is generated from handlers, so no
  unimplemented room surface is advertised.
- Agent-side tools `local_room_read`, `local_room_post`, `local_room_reply`
  read and append the same log. `local_room_reply` is the real reply hook: it
  appends to the durable log and advances a serial round; it is not an exported
  dead callback.

**Open points.** Room creation from Studio takes a repository root string
because the renderer has no path-free workspace-to-root resolver yet; a later
change may move this to `workspaceId`. `agent.spawn` remains unregistered
because the host has no spawn route outside the Runtime task executor. Delivery
auto-capture of a member's final assistant text is intentionally not used; the
explicit `local_room_reply` tool is the contract.

## Consequences

- Room order survives restart and a failed delivery cannot skip an earlier
  sequence. A queued/mesh-at-least-once transport is still possible at the
  `IrcBus` layer, so the room log is idempotent at the cursor, not at the wire.
- The Team DB remains the authority for PM/engineer/Team rooms; local rooms do
  not replace it and cannot be read as Team rooms.
- Studio gets a real contacts/chat surface without a new protocol: room reads
  are queries, room writes are command receipts, and the existing subscription
  mechanism is not widened in this change.
- Residents are visible as room members only; their lifecycle is still the
  registry's. A parked resident still needs a registered ref to be revived.
- The proposal ledger cannot silently mutate another repository, at the cost
  that acceptance is a two-step operation (room ack + target-side tracking
  update).
- `ZETA_ROOMS_DB` gives tests an isolated file; no migration of Team DB rows is
  performed or implied.

## Alternatives

- **Reuse Team DB `rooms`/`room_events`.** Rejected: Team rooms are tied to
  `team_id`/`pm_id` and PM/engineer rows, cannot represent a cross-repository
  Super Room or a main+resident Main Room without overloading the Team schema,
  and would make Team graph ownership ambiguous.
- **Reuse session transcripts as the room log.** Rejected: transcripts are
  per-session, tool-call-shaped, and would duplicate/ leak context; the design
  explicitly forbids a room writing a session.
- **Add a room task scheduler.** Rejected by the design and the 2026-11-01
  ruling: fan-out stays in `task`/`workpool`; rooms only decide message order
  and recipients.
- **Auto-reply by capturing every assistant turn.** Deferred: it would attach
  unrelated turns to a room and needs a turn-to-event correlation the current
  session API does not expose. The explicit tool is the narrow truthful path.
- **Add accounts/device auth.** Rejected for this slice: the requirement is a
  same-machine single-user product; existing local studio auth is unchanged.

## Links

- Design: [super-agent-rooms.md](../super-agent-rooms.md)
- Runtime docs: [docs/rooms.md](../../docs/rooms.md)
- Code: `packages/coding-agent/src/rooms/`, `server/studio-host/ops/rooms.ts`,
  `server/studio-host/ops/agents.ts`, `tools/local-rooms.ts`,
  `web-app/src/studio/RoomsPage.tsx`
- Tests: `packages/coding-agent/test/rooms/`
- Related: [0002](0002-four-data-store-boundaries.md) (store boundaries),
  [0003](0003-team-core-vs-pi-messenger.md) (Team vs messenger)
