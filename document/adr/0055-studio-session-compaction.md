# 0055. Conversation compaction and queued maintenance use native session ownership

- **Status:** Proposed
- **Date:** 2026-11-16
- **Deciders:** Zeta maintainers
- **Links:** [REQ-099](../requirements-ledger.md), [ADR 0052](0052-studio-input-validation-authority.md)

## Context

Official Studio v0.2.1 exposes a conversation-specific compaction threshold and queued compaction. Zeta's model-level settings and native queues already own effective context maintenance and prepared user messages. Registering renderer controls without connecting those native policies would claim settings that never affect execution; queueing by display text could lose duplicate messages, images or hidden companions.

## Decision

Store the official `studio.compaction-threshold` custom transcript entry with its originating session identity. Preserve that existing on-disk identifier. Read the last matching conversation entry for the live transcript, including after rewind; forks do not inherit a parent session's override. Resolve the conversation threshold after model settings in native session maintenance and context usage. Percentages follow the currently selected context window; clearing the entry restores model/global inheritance without changing those preferences.

Queued compaction belongs to the exact native AgentSession and transcript position. Assign stable generation-local opaque identities to prepared message objects, preserving hidden companions, images, attribution and order. Hold user follow-ups admitted after the compaction barrier outside executable queues until native maintenance settles. Cancel, disposal or transcript replacement must release or retain held inputs according to the same native conversation boundary, never deliver them to another transcript. Editing/removing a queue entry uses its identity and expected contents rather than matching duplicate display text. The existing CLI text-based callers keep their native behavior through the same queue owner.

Expose the official typed `session.compaction.*` and queue operations through existing Studio authentication, context and device-binding checks. No second agent, queue executor, persistence store or Runtime is installed. Manual compaction invokes the existing native compaction implementation only at its actual yield boundary. Malformed thresholds, stale positions, foreign sessions and stale queue entries are rejected at their consuming boundary.

## Consequences

The persisted override affects real native maintenance, not only a renderer preview. Queue regression checks must cover duplicate user text, images/hidden companions, admission during a running turn, cancellation and transcript replacement. The implementation and current-source behavioral evidence are required before this ADR can become Accepted; the ADR remains Proposed during integration.

## Alternatives

- Apply a settings override globally: rejected because one conversation would change other sessions and agents.
- Keep a Host-only text queue: rejected because native admission and hidden prepared companions would have a second owner.
- Hide the controls: rejected because it does not implement the requested upstream behavior.

## Links

- [Native AgentSession](../../packages/coding-agent/src/session/agent-session.ts)
- [Context maintenance](../../packages/coding-agent/src/session/session-maintenance.ts)
- [Studio surfaces](../../docs/studio-surfaces.md)
