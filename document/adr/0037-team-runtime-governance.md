# 0037. `/team` reuses Vibe workers with project governance; legacy PM/Lead is hidden as Super Team

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Zeta product owner
- **Links:** [Vibe mode](../../docs/vibe-mode.md), [Team foundation](../../docs/team.md), [agent mesh](../../docs/agent-mesh.md), [tracking](../../packages/coding-agent/src/tools/tracking.ts), [ADR skill](../../skills/official/adr/SKILL.md)

## Context

Zeta already has Vibe's persistent task-executor workers, parent-session lifecycle journal, worker registry, and async turns. Worker IDs currently derive from a task label or a generated adjective/noun ID; IDs also name child transcript files. Idle TTL parks workers rather than terminating them. Workers inherit the parent's `localProtocolOptions`, so all agents in one session tree can write under one `<session artifacts>/local` root.

Project tracking lives at `<project>/.zeta/tracking/`; `tracking.enabled` is currently a global setting, defaults false, and gates `tracking_update`, todo mirrors, and tracking summaries. ADR is already an official skill, but Team mode does not require it or a canonical project architecture summary.

The existing `/team`, `/team hub`, `/lead`, `/pm`, `/teamworker`, Team DB, and PM/engineer/Secretary hierarchy form the old PM/Leader product. The owner has decided to retain this code and its data but hide it under the name **Super Team**. The active Team product is a Vibe-backed main-agent mode. The owner explicitly defines “TIM” as speech recognition for “Team”; it is not a product or command name.

## Decision

**Active `/team` mode.** `/team` enters Team mode on the current main-agent session. It reuses Vibe's worker executor, registry, job manager, and lifecycle. The main agent owns one Team and its direct workers. Team mode adds Team rooms and peer messaging; room messages do not grant spawn, kill, tool, or mode control. It does not create a second executor, worker registry, session format, or transcript store.

**Stable module identity.** Worker `role` is the reusable identity (for example `server`, `tests`, `ui`, `docs`); `assignment` is the turn-specific task. Task text is never used as the durable agent id or filename stem. When no name is supplied, the host derives an ID from the role and a monotonically increasing generation within the parent session. A supplied display name is sanitized and collision-suffixed by the output manager; the role and generation remain explicit metadata. The runtime does not implicitly reuse a resident worker: callers must address an existing worker ID with `vibe_send`, so assignment reuse cannot accidentally target the wrong module owner. The Agent Hub displays role and current assignment separately.

**Lifecycle classes and recursion.** Every worker has one owner scope, stable role, generation id, lifecycle class (`resident` or `ephemeral`), and terminal policy. Residents park after idle TTL and can be revived by their owner. Ephemeral task workers terminate after accepted completion or bounded TTL. `task` recursion is explicitly bounded per Team/Vibe owner scope. Parent mode exit recursively terminates descendants after durably recording terminal intent. A parked worker remains addressable only while its owner and retention policy permit it; no ownerless long-lived worker is allowed.

**Agent-local scratch.** Keep the session/project artifact root where it is; do not move scratch into the repository. Extend `LocalProtocolOptions` with an agent-local root. Main-agent `local://` continues to address the session root. A worker's `local://` resolves under `local/agents/<agent-id>/`; `local://shared/` is readable by workers and writable only by the main agent. Workers cannot write the parent plan/index or another worker's namespace. Worker scratch is removed on terminal reclamation; retained transcripts and final outputs remain in the existing session artifact layout. Apply per-agent byte/file quotas and deterministic TTL before any cleanup.

**Forced project governance.** Team mode uses an effective session-scoped tracking gate; it does not modify the global `tracking.enabled` setting. On entry it creates the existing tracking skeleton at `<project>/.zeta/tracking/` when absent and enables `tracking_update` for the Team owner and workers. Tracking is mandatory while Team mode is active and is restored to the prior effective state on exit. All members use the same project root. Only the main agent may update canonical `INDEX.md`, architecture summary, `status.json`, and team-level decisions. Workers may append activity and write module-scoped notes.

The official `adr` skill is injected through the existing skill loader once per Team owner scope, not copied into scratch and not re-injected every turn. ADR creation is still limited to decisions the owner has made; the skill does not grant workers authority to mark decisions Accepted. Team entry loads the canonical architecture summary into the main agent's working context. The summary carries source revision/hash and is refreshed only after an architecture/decision update or an explicit request. Per-turn runtime facts (active workers, current assignments, blockers) come from live Team status, not from the static summary.

**Rooms and IM.** Reuse the existing core mesh transport and add Team-scoped membership/room routing. One `team` room contains the main and first-layer workers; an optional `mains` room contains main agents only. Messages are durable in the mesh room log and never copied into session JSONL. External IM binds to a main-agent session; the main decides whether to route an inbound message into its Team room. The legacy Team DB rooms remain separate and unchanged.

**Legacy Super Team.** Keep PM/Leader/Secretary/engineer/worktree/queue source and database rows intact but hide its commands and Studio navigation by default. Do not migrate its database into the active Team runtime. Reopen it only by a later explicit decision. `pi-messenger` is not a Team dependency and is not enabled by this decision.

## Consequences

- Worker identities and file paths stay module-oriented across task changes; task-specific work remains an assignment, not a new long-lived agent.
- Parent and worker scratch is isolated without changing existing session JSONL paths or copying transcripts.
- Tracking and project architecture context are reliable Team entry invariants without changing ordinary-session global settings.
- The main agent owns the stable project architecture summary; workers can contribute scoped facts but cannot replace the canonical overview.
- Vibe hardening (module identity, recursive lifecycle, local isolation, tracking gate) is a prerequisite to opening Team mode.
- The desktop Work Studio may reuse its existing Team page shell and Agent Hub components, but its active Team data model must switch from PM/engineer rows to main/worker/room state. The old UI remains hidden with Super Team.

## Alternatives

- Use the exact task title as worker ID: rejected because a task-specific label is not a reusable role and creates one-off transcript/file names.
- Put scratch in repository `.zeta`: rejected because it pollutes worktrees and creates cross-checkout cleanup hazards.
- Enable `tracking.enabled` globally on Team entry: rejected because it changes ordinary sessions and survives Team exit.
- Copy worker conversation into a Team transcript: rejected; session JSONL remains the transcript source of truth.
- Keep PM/Leader UI active beside new Team: rejected for the active product surface because it presents two competing Team models.

## Open implementation details

The lifecycle defaults (resident idle TTL, ephemeral maximum runtime, completion grace, scratch quota/TTL) require measured values and regression tests. The main-only `mains` room and group IM reply arbitration require an explicit behavior contract before activation.

## Links

- Vibe: `packages/coding-agent/src/vibe/runtime.ts`, `vibe/lifecycle.ts`, `registry/agent-lifecycle.ts`.
- Local protocol: `packages/coding-agent/src/internal-urls/local-protocol.ts`, `internal-urls/context.ts`.
- Tracking and skill loading: `packages/coding-agent/src/tools/tracking.ts`, `extensibility/skills.ts`.
- Legacy Super Team: `packages/coding-agent/src/team/**`, `web-app/src/studio/TeamWorkspacePage.tsx`.
