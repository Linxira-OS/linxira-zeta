# 0038. Reuse the Vibe worker tree for governed Team mode; hide the legacy Super Team surface

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Zeta product owner
- **Links:** [Vibe mode](../../docs/vibe-mode.md), [Team foundation](../../docs/team.md), [agent mesh](../../docs/agent-mesh.md), [tracking](../../packages/coding-agent/src/tools/tracking.ts), [ADR skill](../../skills/official/adr/SKILL.md)

## Context

Zeta already has Vibe's persistent task-executor workers, parent-session lifecycle journal, worker registry, and async turns. Worker IDs currently derive from a task label or a generated adjective/noun ID; IDs also name child transcript files. Idle TTL parks workers rather than terminating them. Workers inherit the parent's local-protocol options, so agents in one session tree currently share one `<session artifacts>/local` root.

Project tracking lives at `<project>/.zeta/tracking/`; `tracking.enabled` is currently a global setting, defaults false, and gates `tracking_update`, todo mirrors, and tracking summaries. ADR is already an official skill, but Team mode does not require it or a canonical project architecture summary.

The existing `/team`, `/team hub`, `/lead`, `/pm`, `/teamworker`, Team DB, and PM/engineer/Secretary hierarchy form the old PM/Leader product. The owner has decided to retain this code and its data but hide it under the name **Super Team**. The active Team product is a Vibe-backed main-agent mode. “TIM” is speech recognition for “Team”, not a product or command name.

## Decision

**Active `/team` mode.** `/team` enters Team mode on the current main-agent session. It reuses Vibe's worker executor, registry, job manager, and lifecycle. The main agent owns one Team and its direct workers. Team mode adds Team rooms and peer messaging; room messages do not grant spawn, kill, tool, or mode control. It does not create a second executor, worker registry, session format, or transcript store.

**Stable module identity.** Worker `role` is the reusable identity (for example `server`, `tests`, `ui`, `docs`); `assignment` is the turn-specific task. Task text is never used as the durable agent id or filename stem. When no name is supplied, the host derives an ID from the role and a monotonically increasing generation within the parent session. A supplied display name is sanitized and collision-suffixed by the output manager; role and generation remain explicit metadata. The runtime does not implicitly reuse a resident worker: callers address an existing worker ID with `vibe_send` so assignment reuse cannot target the wrong module owner.

**Lifecycle classes and recursion.** Every worker has one owner scope, stable role, generation id, lifecycle class (`resident` or `ephemeral`), and terminal policy. Residents park after idle TTL and can be revived by their owner. Ephemeral task workers terminate after accepted completion or bounded TTL. Recursive task spawns remain governed by the existing depth/spawn policy. Parent mode exit recursively terminates descendants after durably recording terminal intent. A parked worker remains addressable only while its owner and retention policy permit it; no ownerless long-lived worker is allowed.

**Agent-local scratch.** Keep the session/project artifact root where it is; do not move scratch into the repository or change JSONL storage. Main-agent `local://` continues to address the session root. Vibe/task workers map ordinary `local://<path>` into `local://agents/<agent-id>/<path>` on disk; workers cannot address `local://agents/` directly. `local://shared/` remains readable and is writable only to the Team owner while Team mode is active. Eval reads use the session root so shared files remain readable; eval writes use a separate worker root. Terminal cleanup removes only the worker-local scratch directory, never transcripts or final outputs. Apply file-count/byte limits before cleanup policy expansion.

**Forced project governance.** Team mode uses an effective session-scoped tracking gate; it does not modify the global `tracking.enabled` setting. On entry it creates the existing tracking skeleton at `<project>/.zeta/tracking/` when absent and enables `tracking_update` for the Team owner and workers. Tracking is mandatory while Team mode is active and is restored to the prior effective state on exit. All members use the same project root. Only the main agent may update canonical `INDEX.md`, architecture summary, `status.json`, and team-level decisions. Workers may append activity and write module-scoped notes.

The official `adr` skill is injected through the existing skill loader once per Team owner scope, not copied into scratch and not re-injected every turn. ADR creation is limited to decisions the owner has made; the skill does not grant workers authority to mark a decision Accepted. Team entry loads the canonical architecture summary into the main agent's working context. The summary carries source revision/hash and is refreshed only after an architecture/decision update or explicit request. Per-turn active workers, assignments, and blockers come from live Team status.

**Rooms and IM.** Reuse the existing core mesh transport and add Team-scoped membership/room routing. One `team` room contains the main and first-layer workers; an optional `mains` room contains main agents only. Messages are durable in the mesh room log and never copied into session JSONL. External IM binds to a main-agent session; the main decides whether to route inbound messages into its Team room. Legacy Team DB rooms remain separate and unchanged.

**Legacy Super Team.** Keep PM/Leader/Secretary/engineer/worktree/queue source and database rows intact but hide its commands and Studio navigation by default. Do not migrate its database into the active Team runtime. Reopen it only by a later explicit decision. `pi-messenger` is not a Team dependency and is not enabled by this decision.

## Consequences

- Worker identities and file paths stay module-oriented across task changes; assignment text is not a long-lived identity.
- Worker scratch is isolated without changing session JSONL paths or copying transcripts.
- Tracking and project architecture context are Team entry invariants without changing ordinary-session global settings.
- The main agent owns the canonical project architecture summary; workers cannot replace it.
- Vibe hardening (module identity, recursive lifecycle, local isolation, tracking gate) is a prerequisite to opening Team mode.
- Work Studio may reuse its current Team shell and Agent Hub components, but its active Team model must switch to main/worker/room state. The old UI remains hidden with Super Team.

## Alternatives

- Use the task title as worker ID: rejected because a task title is not a reusable role and creates one-off transcript names.
- Put scratch in repository `.zeta`: rejected because it pollutes worktrees and creates checkout cleanup hazards.
- Enable `tracking.enabled` globally: rejected because it changes ordinary sessions and survives Team exit.
- Copy worker conversation into a Team transcript: rejected; session JSONL remains the source of truth.
- Keep PM/Leader UI active beside new Team: rejected because it presents two competing Team models.

## Links

- Vibe runtime: `packages/coding-agent/src/vibe/runtime.ts`, `vibe/lifecycle.ts`, `registry/agent-lifecycle.ts`.
- Local protocol: `packages/coding-agent/src/internal-urls/local-protocol.ts`, `internal-urls/context.ts`.
- Tracking and skill loading: `packages/coding-agent/src/tools/tracking.ts`, `extensibility/skills.ts`.
- Legacy Super Team: `packages/coding-agent/src/team/**`, `web-app/src/studio/TeamWorkspacePage.tsx`.
