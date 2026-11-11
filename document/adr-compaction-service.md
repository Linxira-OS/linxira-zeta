# ADR: compaction as a service with a dedicated compaction agent

- Status: accepted (implementation landed on `feat/report-compaction`)
- Date: 2026-11-11
- Requirements: REQ-051 (P0 compaction service split + granular progress), REQ-058 (compaction fidelity / QA detail retention)
- Consumer contract: `local://compaction-service-contract.md` (stable event + commit hook)

## Context

Compaction already had a shared manual/auto/speculation pipeline and a single commit
path, but three gaps remained against the roadmap acceptance:

1. no dedicated compaction agent — the summarizer request was assembled inline at two
   different call sites (`#compactWithFallbackModel` for manual/speculation, and the
   auto retry loop in `runAutoCompaction`);
2. only coarse progress (`auto_compaction_start/_end`, `manual_compaction_start/_end`),
   so nothing could show *what* a pass was doing;
3. summaries lost exact facts (paths, IDs, constraints, unfinished work) that later
   turns need, because retention depended on the model re-typing them.

Constraints from the product/engineering contract:

- keep the five methods (`remote`, `snapcompact`, `handoff`, `shake`, `soft`), their
  preference order, and the model/threshold policy sources untouched;
- no second session, scheduler, or task runner; no duplicate commit path;
- no prompt-cache-key change on the live prefix;
- no hardcoded repository special cases, no silent fallback that hides failure;
- tracking references only when `tracking.enabled`, otherwise never touch user files.

## Decision

Split responsibilities without moving the pipeline:

| Component | Owns | Does not own |
| --- | --- | --- |
| `session/compaction/service.ts` (`CompactionService`, `CompactionPass`) | pass identity, phase ordering, terminal classification, commit fan-out | running a summary, choosing a model, appending entries |
| `session/compaction/agent.ts` (`CompactionAgent`) | summarizer context (extension context + fidelity ledger), the engine summarizer call, the summary artifact | candidate/fallback policy, auth classification, abort/disconnect, commit |
| `session/compaction/fidelity.ts` | deterministic, bounded extraction and rendering of the fidelity artifact | any I/O, any model call, any user-file access |
| `session/session-maintenance.ts` (existing) | planning/cut point, method preference and fallback, abort/disconnect, single commit path | — |

The summarizer call itself moved into the agent at **both** real call sites, so this is
not an entry-point wrapper: manual/speculation go through `#compactWithFallbackModel` →
`CompactionAgent.summarize`, and automatic passes go through the auto candidate loop →
`CompactionAgent.summarize`. Candidate iteration, retry budgets, auth-failure
classification, and native-failure handling stay in the session.

Progress is one additive event, not a new pipeline:

```
plan ──► summarize | archive ──► commit          (one terminal, or terminal below)
  │
  └────► failed | aborted                        (`aborted` = cancellation only)
```

`plan` may repeat inside one pass when a method fallback begins (same `passId`); the
service serializes phases, refuses work after a terminal phase, and makes `commit`
terminal. Emission is observability only: a failing emitter or commit listener can
never fail or roll back a compaction.

The commit hook is the single fan-out point, called from `#commitCompactionEntry` after
the entry is durable and after the tracking mirror, before `session_compact`:

```ts
service.onCommit(commit => …)   // exactly once per appended entry id
```

It carries the entry, the discarded-entry cut point (`firstKeptEntryId` plus the ordered
`discardedEntryIds`), the fidelity artifact, and — for an armed speculative splice — the
production pass as `sourcePassId`. It is awaited, so listeners must snapshot/enqueue and
return; model or network work belongs on the consumer's own queue.

## Fidelity

`CompactionFidelity` is extracted from the pass's own summarize range only (never the
whole session), with a fixed per-message scan bound and fixed per-bucket caps. The
rendered ledger is appended to the summarizer's side request (a static prompt file
explains the retention rules); the structured artifact is stored at
`preserveData["zeta.compactionFidelity"]` and survives as `previousPreserveData`.

Tracking references (`<workspace>/.zeta/tracking/{INDEX.md,status.json,summaries/}`) are
present only when `cfgTrackingEnabled` is true. With tracking off the field is absent and
nothing about the user's files is read or written.

## Alternatives rejected

- **A second compaction service/scheduler** — duplicates the abort, resume, and commit
  semantics that took several releases to stabilise (queue draining, interrupted-turn
  resume, armed speculation validity). Rejected: the existing pipeline is the service's
  substrate.
- **Status-only `plan` + a new `attempt` event** — invents wire surface for cosmetics.
  Rejected in favour of honest repeated `plan` with one `passId`.
- **Model-written fidelity** — a second summarizer call that can silently drop facts.
  Rejected: extraction is deterministic and its empty result is explicit.
- **Exposing phases only in-process** — leaves RPC/Host/Web blind. Rejected: the event is
  added to the RPC wire table (and generated TypeScript/schema/SDK artifacts) plus the
  client forwarding allowlist.

## Consequences

- Consumers get one stable contract (`@linxiraos/zeta/session/compaction-contract`,
  `AgentSession.onCompactionCommit`, `compaction_phase`).
- The summarizer request gains a bounded ledger; cache keys and the live prompt prefix
  are unchanged (the ledger is a side-request artifact, not a system-prompt change).
- Auto/manual/speculation all report the same phases; a fallback pass is visibly one pass.
- Fidelity adds a small, bounded per-pass CPU cost (regex over the clipped summarize
  range), no I/O with tracking off.
- If a future consumer needs more than the cut point, it must extend the notification
  additively; existing fields are frozen.

## Verification

- `packages/coding-agent/test/compaction-service.test.ts`: phase order through a real
  `compact()` (spying the engine summarizer), cancellation classified as `aborted`,
  preserved foreign `preserveData` keys, and exact path/ID/constraint retention in the
  committed entry. Written; not executed in this lane (parent-gated test window).
- Existing compaction suites rely on `vi.spyOn(compactionModule, "compact")`; the agent
  calls the engine through a namespace import, so the same spy interception path holds.
