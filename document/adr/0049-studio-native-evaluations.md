# 0049. Studio evaluations execute through the existing native session

- **Status:** Proposed
- **Date:** 2026-11-15
- **Deciders:** Zeta maintainers
- **Links:** [REQ-099](../requirements-ledger.md), [ADR 0047](0047-studio-runtime-private-resources.md)

## Context

Studio v0.2.1 exposes benchmark, instruction, judgment and Ratchet workspaces. Zeta already owns provider execution, session identity, task isolation and Ratchet review boundaries in standalone serve. A second worker/session authority would bypass those native contracts.

## Decision

Adapt the official evaluation coordinator to the selected inventoried native AgentSession. Register the thirteen `evaluations.*` operations through existing Host authentication, context, device binding and CSRF checks. Reuse `getEvalToolSession()`, native benchmark/instruction/judgment execution and Ratchet isolation and approvals. Missing provider credentials and unsupported isolation remain real failures.

Tasks belong to the native session, independently of renderer event connections. Disconnect releases only the view's review lease. Native session disposal, identity replacement and Host shutdown cancel execution and retain completed or partial results. Reattachment changes the review generation; stale views cannot submit decisions.

Persist bounded records, row revisions, reports and exports in private profile storage partitioned by session identity. Reads and restarts never replay paid work. Public results, errors and exports remove credential values, private endpoints and native paths; native reports remain private. Export paging preserves all retained rows within documented bounds.

## Consequences

Standalone serve remains the only authority. Evaluation cancellation must reach native requests and isolation cleanup. Native task lifetime, retained results, owner replacement and review generation require behavioral tests and real provider acceptance before this ADR can become Accepted. Local fixtures alone do not establish provider or packaged-product compatibility.

## Alternatives

- Copy the upstream process authority: rejected because it duplicates Zeta session ownership.
- Cancel paid work when the renderer disconnects: rejected because reconnect must recover the existing task and retained results.
- Parse terminal output or synthesize measurements: rejected because native structured results are available.

## Links

- [Host operations](../../packages/coding-agent/src/server/studio-host/ops/evaluations.ts)
- [Native session](../../packages/coding-agent/src/session/agent-session.ts)
