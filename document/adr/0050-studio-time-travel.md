# 0050. Time Travel snapshots belong to the native Host and session tree

- **Status:** Proposed
- **Date:** 2026-11-15
- **Deciders:** Zeta maintainers
- **Links:** [REQ-099](../requirements-ledger.md), [ADR 0043](0043-studio-conversation-contexts.md)

## Context

Studio v0.2.1 requires filesystem snapshots and exact conversation restoration. Zeta's message checkpoint tool does not snapshot the workspace. Native AgentSession and SessionManager already own prompt admission, session transitions and persisted branches; renderer disconnect must not remove snapshot capture.

## Decision

Adapt the official content-addressed snapshot store into the existing Studio Host. Profile-owned settings default to disabled. Capture before admitted user turns and after terminal completion through awaited native lifecycle hooks, including queued follow-ups and interrupted turns. Serialize capture, settings, retention cleanup and restore operations.

Resolve session and canonical workspace through existing Host inventory and context ownership. Keep snapshot storage private and outside the workspace. Apply upstream ignored-file, symlink, mode and content-hash boundaries. Timeline entries retain native session/tree identity. Preview returns a revision fence; restoration checks it again while the native session is idle and excludes new prompt admission throughout the filesystem/tree transition.

Support code, conversation or combined restoration. Conversation restore lands on the exact native leaf (including the empty root), persists that selection and preserves later branches. Filesystem restore creates a safety backup before mutation and reports rollback or partial failures honestly. Context close only revokes access; native capture and stored snapshots survive it. No replacement auth, workspace or filesystem authority is introduced.

## Consequences

Snapshots add disk use and turn latency when enabled. Retention and exclusions are explicit settings. Native lifecycle ordering, ignored/symlink confinement, stale previews, recovery backups, branch persistence and foreign-context rejection need behavioral and product acceptance before this ADR becomes Accepted. A successful build is insufficient evidence.

## Alternatives

- Reuse message checkpoints: rejected because they cannot restore files.
- Capture only while a Desktop socket is attached: rejected because snapshot lifetime follows native sessions.
- Modify the persisted leaf directly in the Host: rejected because AgentSession must rebuild native state and fence concurrent submissions.

## Links

- [Native session](../../packages/coding-agent/src/session/agent-session.ts)
- [Studio Host](../../packages/coding-agent/src/server/studio-host/server.ts)
