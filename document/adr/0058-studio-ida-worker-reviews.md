# 0058. Studio IDA reviews fence the existing native worker identity and version

- **Status:** Proposed
- **Date:** 2026-11-16
- **Deciders:** Zeta maintainers
- **Links:** [REQ-099](../requirements-ledger.md), [ADR 0047](0047-studio-runtime-private-resources.md)

## Context

Official Studio v0.2.1 has basic and detailed IDA controls. Zeta already owns IDA worker startup, configuration, tools and native evaluation context. A Host-only review token cannot detect changes performed through the native worker or a replaced database.

## Decision

Extend the existing typed IDA worker protocol with the official `studio` method. Each worker has a fresh opaque identity and a monotonically increasing version invalidated before mutation. Prepared reviews expire in five minutes, are single-use and carry exact worker identity/version; save, execution and close preserve exclusive, non-overwriting checkpoints before and after flush.

Adapt Studio commands through the selected resident AgentSession's native tool context and existing IDA supervisor. Require a live authenticated view, exact session/workspace/cwd, workspace-confined inputs and backups, no final symlink inputs, and matching worker identity/version at commit. No dormant session start, separate worker authority, licensed-runtime substitute or success fallback is introduced. Missing `ida_domain`, `idapro` or licensed installation is returned as unavailable with the native status reason.

## Consequences

Concurrent worker changes invalidate stale Studio reviews. Checkpoints retain disk state across native flush and mutation. Fake IDA modules and protocol checks exercise local transitions but do not prove execution against a licensed IDA database. Real licensed acceptance is a separate prerequisite; the decision remains Proposed until appropriate integration evidence exists.

## Alternatives

- Host-only version counters: rejected because native tool calls can mutate the same worker outside the Host service.
- Create a separate Studio worker: rejected because it splits configuration and database ownership.
- Report a fixture as installed IDA: rejected because installation and licensing are real runtime prerequisites.

## Links

- [Worker protocol](../../packages/coding-agent/src/ida/protocol.ts)
- [IDA worker](../../packages/coding-agent/src/ida/worker.py)
- [IDA supervisor](../../packages/coding-agent/src/ida/supervisor.ts)
