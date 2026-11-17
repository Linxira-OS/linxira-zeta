# 0039. Background work survives /resume by staying bound to its source transcript

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Runtime and TUI lifecycle owners
- **Links:** [Vibe mode](../../docs/vibe-mode.md), [switch lifecycle](../../packages/coding-agent/src/session/agent-session.ts), [async delivery](../../packages/coding-agent/src/async/job-manager.ts), [focused tests](../../packages/coding-agent/test/agent-session-async-delivery.test.ts)

## Context

`/resume` replaces the transcript rendered by one long-lived `AgentSession`; it
does not create a new session object. Before this decision the switch behaved as
a hard boundary for work owned by that session:

- `switchSession` called `#cancelOwnAsyncJobs()` for a different target, cancelling
  every bash/task/eval job owned by the agent and evicting results already waiting
  for delivery.
- Interactive startup registered `#quiesceVibeForSessionSwitch`, which called
  `VibeSessionRegistry.suspendScope`: running Vibe/Team turns were cancelled, queued
  directives were cleared, and process-local worker records were dropped.
- `exitTeamModePreservingActive` additionally called `killAll` even in its
  "preserving" switch path.

Those actions were safe when results were injected into whichever transcript was
active, but they throw away work the user explicitly started. A long build or a
worker assignment often outlives a navigation to another conversation. The switch
also cannot route the eventual result into the new conversation: the transcript
that asked for the work is the only place where the completion is meaningful.

`SessionManager.cloneCurrentSession` already provides the snapshot pattern used by
`BashRunner.beginSessionTransition`: in-flight work keeps a writer for its
originating branch while the live manager moves to another file. This ADR extends
that ownership rule to async jobs and Vibe/Team workers.

## Decision

A session switch is a **navigation**, not a cancellation boundary.

- Jobs running when a different session is loaded keep running. The switch creates
  a source snapshot with `SessionManager.cloneCurrentSession()` and binds those
  jobs to it; jobs already bound to an earlier source keep that binding. The
  delivery generation (`#asyncDeliveryEpoch`) is bumped so a receipt queued for
  the old transcript is stale and re-delivers through the source binding rather
  than injecting into the target.
- Vibe and Team records in the outgoing owner scope are pinned to the same
  snapshot (`VibeSessionRegistry.pinScopeToSource`). Turn-settled/tombstone
  lifecycle entries and queued follow-up artifacts continue to use that source.
  Pinned records are reattached to the live session when its transcript is loaded
  again.
- `exitTeamModePreservingActive` removes Team's transient tools but does not kill
  workers. Explicit `exitTeamMode`, `vibe_kill`, `/vibe` or `/team off`, and
  process disposal still terminate workers and jobs.
- A completion delivered while another transcript is active is appended to the
  source journal as an `async-result` message; it never starts a turn in the
  active conversation. Returning to the source loads the completion into the
  live message list.
- A switch target whose transcript has pending detached writes is gated: the
  switch waits for those writes before loading it, and a delivery that starts
  during the load parks on the gate. Completions for the transcript being left
  park on a second gate until the switch outcome is known, so a rejected switch
  never writes a duplicate detached completion and a committed switch never
  injects a result into the transcript it replaced. If the switch is rejected and
  rolls back, the source binding, pins, and delivery generation are rolled back,
  leaving the source as the live delivery destination.
- Same-file reload keeps the existing live delivery path: the transcript is not
  replaced, so no source binding is needed and queued receipts remain valid.
- `/new`, reset/branch/fork, handoff, and dispose keep the cancellation rule. A
  fileless (in-memory) source can keep a detached writer in memory but cannot be
  resumed from disk; only file-backed transcripts are durable.

The source writer is keyed by `(sessionId, resolved sessionFile)` and serialized
per binding; Vibe lifecycle writes use the same serialization and switch gates as
async-result writes, so a captured source parent cannot append through a stale
clone after the source has become live again. `AsyncJob.origin` records the source
of a job that starts while its parent is already pinned (Vibe queued follow-up
turns); jobs registered before a switch are bound at the switch observation.

## Consequences

- Background work is no longer lost to navigation, and a worker's transcript,
  queued directives, and artifacts stay with the conversation that owns them.
- A completion that arrives while the user is elsewhere produces no new turn and
  no notification in the active conversation. It is visible on return; the user
  has to look at the source conversation rather than being interrupted.
- There is one binding per transcript identity. Repeat `/resume` cycles refresh
  that binding from the live manager rather than retaining one entry snapshot
  per visit; it is closed once it holds no bound jobs, no queued write, and no
  Vibe/Team worker turn or directive for that transcript. Per-job bindings are
  released once their result is delivered. If the same transcript is written by
  its live manager concurrently (for example another process resumes it), the
  clone's append-only writes fall back to the existing `SessionManager` conflict
  recovery shown in `#adoptForeignEntries`; a completion can join as a side
  branch in that uncommon case.
- Fileless sessions cannot durably persist a completion after navigation. They
  keep the job running, but the detached result has no resumable transcript.
- SDK/embedding code that calls `AgentSession.switchSession` inherits the
  behavior without a new API. Hosts that need explicit shutdown still call
  `dispose`, which cancels owned jobs and Vibe/Team scopes.

## Alternatives

- **Cancel owned jobs on switch (previous behavior).** Predictable ownership, but
  destroys user-started work and is the bug this ADR fixes.
- **Keep results in memory and inject them when the source returns.** No second
  writer, but a completion is lost on process exit and the source transcript on
  disk does not reflect work that finished. It also cannot answer a later
  `--resume` of the source.
- **Deliver the result into the active conversation.** Avoids stranded results,
  but leaks one conversation's work into another and misleads the model about
  which transcript owns the job. Rejected explicitly.
- **Serialize all work per session id instead of per source file.** Simpler
  lookup, but a session that is branched or relocated has distinct journals; the
  file identity is the actual transcript boundary.

## Open points

- The existing bash raw-artifact capture failure (`new RunTrace(finalCommand)`
  missing from a reused native artifact) is unrelated to source binding; it
  affects one async-delivery assertion and is tracked separately.
- Cross-process concurrent writes to one source are handled by the manager's
  conflict recovery, not by a new lock; the completion may become a side branch.
  A future explicit source-writer lease could remove that ambiguity.

## Links

- [Vibe mode](../../docs/vibe-mode.md)
- [Source-bound session switching](../../packages/coding-agent/src/session/agent-session.ts)
- [Async delivery lifecycle](../../packages/coding-agent/src/async/job-manager.ts)
- [Source-binding regression tests](../../packages/coding-agent/test/agent-session-async-delivery.test.ts)
