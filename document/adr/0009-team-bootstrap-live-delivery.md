# 0009. Team bootstrap journal, live room delivery, and task workers

- **Status:** Proposed
- **Date:** 2026-11-11
- **Deciders:** Zeta product owner
- **Links:** [Team foundation](../../docs/team.md), [Task queue design](../team-task-queue.md)

## Context

Team can create a root, PMs, repos, engineers, rooms, and a durable task queue,
but every structural command is a separate step with only local rollback. A
failed `/initzetateam` leaves a half-built team. Rooms are append-only rows with
no delivery: a member must manually poll `room_read`, so PM dispatch and
engineer acknowledgement are human-driven. The task queue has claim/lease
semantics but no worker loop bound to an existing engineer session.

The product is local-first and single-user. It has no accounts, credentials, or
authentication, and it must not grow a daemon or a second scheduler.

## Decision

1. **Bootstrap is plan → preflight → apply, with a durable journal.** A pure
   plan validates names, paths, Git/ownerless constraints, and DB collisions
   before any write. `apply` records every step in schema v6
   (`team_bootstrap_runs`, `team_bootstrap_steps`), calls the existing service
   step, and can compensate only objects created by that run. `resume` skips
   `done` steps and re-runs preflight for the rest; `rollback` walks completed
   steps in reverse. Success ends with `team doctor`.
2. **The same bootstrap service backs CLI and `/initzetateam`.** Headless and
   TUI share `runInitTeamCommand`; no wizard-only logic. A single-engineer mode
   adds one engineer to an existing Team through the same plan/apply/journal.
3. **Rooms get durable per-member delivery cursors.** Schema v6 adds
   `room_subscriptions(room_id, agent_id, last_seq, …)`. `postRoomEvent` fans
   out to subscribed members through the existing `IrcBus` (and its mesh
   transport); it never starts a daemon. A failed/offline delivery leaves the
   cursor unchanged and is retried when the member's session starts
   (`deliverPendingRoomEvents`).
4. **Task workers reuse the queue and the caller's session.** A worker loops
   claim → renew lease → execute → submit/release with compare-and-set
   ownership. It does not spawn an agent, start Vibe, or run in the background
   without an explicit session; auto-start stays out of scope.
5. **Team stays local and account-free.** Registered live agents (main/relay,
   engineer, PM, Secretary) may receive deliveries, but there is no account,
   token, password, or auth system. IM per-agent binding remains a separate
   design.

## Consequences

- Two new schema tables groups (bootstrap runs/steps, room subscriptions) and a
  new v6 migration; v5 task data is untouched.
- Git/worktree side effects are compensated by journal steps, not by a global
  transaction. A failed rollback leaves the run resumable and never deletes
  pre-existing user objects.
- Session start must call `deliverPendingRoomEvents`; session dispose/abort
  must stop an opt-in task worker. SDK/IM owners wire those calls; Team exports
  the services and tests.
- Room events become an at-least-once delivery stream. Duplicates are tolerable
  locally; the message carries room + seq for idempotent readers.
- No release, tag, or package version change is implied. ADR indexing is owned
  by integration.

## Alternatives

- **Keep one-shot CLI steps and document the manual order.** Rejected: it is the
  current half-built failure mode and cannot prove rollback.
- **Run bootstrap inside one SQLite transaction.** Rejected: clones, worktrees,
  and branches are not transactional with SQLite; compensation is required.
- **Add a Team daemon/watcher for rooms and workers.** Rejected: duplicates the
  existing session/mesh machinery and violates the local single-user boundary.
- **Let the plugin (`pi-messenger`) own delivery/tasks.** Rejected by ADR 0003:
  the core owns Team state; the plugin stays optional.

## Links

- [Team foundation](../../docs/team.md)
- [Task queue design](../team-task-queue.md)
