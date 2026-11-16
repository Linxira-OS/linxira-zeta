# 0057. Studio session worktrees retain native ownership through turns and shutdown

- **Status:** Proposed
- **Date:** 2026-11-16
- **Deciders:** Zeta maintainers
- **Links:** [REQ-099](../requirements-ledger.md), [ADR 0047](0047-studio-runtime-private-resources.md)

## Context

Official Studio v0.2.1 exposes nine `worktrees.session.*` operations, a first-turn choice and the native `worktree.onExit` policy. Zeta's native worktree implementation already creates, inspects and prepares removals. Its gateway owns project registration, resident sessions and subsequent workspace/session transitions. The interactive CLI has its own owned-worktree collection.

## Decision

Use native `createSessionWorktree`, `inspectSessionWorktree`, `planWorktreeExit` and `removeExitWorktrees` from the exact resident session. Track only Studio-created trees in a bounded, schema-validated, atomically written registry under the private agent profile, keyed by the canonical primary root. Never infer managed ownership from the general Git worktree list.

Compose the Studio start-choice fence into the existing native before-turn hook, before Time Travel captures. Create/open/resume preparation registers the project through the existing gateway; the existing workspace and session commands perform transitions. No second SessionManager or automatic session start is introduced.

Prepare removals with native fingerprints, session-file claims and the live AgentRegistry. An opaque single-use, instance/session-bound token expires after five minutes; apply rechecks ownership, current cwd and native change fingerprint. Other live sessions prevent removal. Before serve teardown, quiesce native sessions and apply `worktree.onExit` only to managed rows whose cwd is exiting. No available interaction channel means decline the native confirmation, preserving dirty or moved trees. CLI-owned trees remain under the CLI owner.

## Consequences

First turns cannot silently bypass a requested worktree choice. Removal and shutdown preserve changed or concurrently used trees and committed branches according to native policy. Host-operation and real Git tests prove local ownership and transition preparation; actual renderer transitions and shutdown must still be exercised before this decision can be Accepted.

## Alternatives

- Treat every Git worktree as managed: rejected because Git membership does not prove Studio ownership.
- Remove trees from synchronous session disposers: rejected because native planning and writes must be awaited before gateway teardown.
- Open sessions inside the worktree producer: rejected because that duplicates the gateway transition authority.

## Links

- [Native worktrees](../../packages/coding-agent/src/task/worktree.ts)
- [Studio start boundary](../../packages/coding-agent/src/server/studio-host/services/time-travel-boundary.ts)
- [Serve shutdown](../../packages/coding-agent/src/server/zeta-server.ts)
