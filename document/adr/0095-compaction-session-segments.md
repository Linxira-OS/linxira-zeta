# 0095. Segment the transcript after a committed compaction

- **Status:** Proposed
- **Date:** 2026-11-23
- **Deciders:** Zeta owner (direction), implementation review pending
- **Links:** [Agent modes](../../docs/agent-modes.md), [session manager](../../packages/coding-agent/src/session/session-manager.ts), [compaction service](../../docs/compaction-service.md)

## Context

A session currently stays in one append-only JSONL file for its whole life.
Compaction reduces the model context in place, but the transcript file keeps
growing. The Team Agent direction requires a turn-boundary split after a
committed compaction, without deleting history and without making resume pick
two files for one conversation.

The session manager already has a recovery path that moves a session to a
sibling file with `continuationOf` when another process owns the current file.
That path preserves resume semantics and is covered by continuation tests.

## Decision

When a compaction commit is durable and the session is persisted, the session
manager moves subsequent writes to a new sibling JSONL file. The old file is
left intact as the previous segment. The new header records
`parentSession` and `continuationOf`; resume-by-id follows the continuation.
The split happens only after the commit hook, never during a turn, and is not
triggered by file size.

This does not delete or rewrite the old segment, and it does not install a
background rotation task.

## Consequences

- A long conversation is readable as ordered segments.
- Resume and history discovery follow `continuationOf`; forks are not followed.
- Session identity changes after the split; callers must treat the session id
  from the manager as current.
- The split is one extra file operation at compaction commit and inherits the
  existing recovery path's ownership and artifact-copy behavior.
- JSONL is still not size-capped; `/rotate` remains a separate proposal.

## Alternatives

- Rewriting the same file in place: does not segment and risks losing history on
  a crash.
- Size-based automatic rotation: can split mid-turn and surprises operators.
- A background archival task: violates the no-silent-deletion/no-hidden-rotation
  boundary.

## Links

- [Agent modes](../../docs/agent-modes.md)
- [Compaction service](../../docs/compaction-service.md)
- Implementation: `SessionManager.segmentAfterCompaction` and the session
  maintenance commit listener.
