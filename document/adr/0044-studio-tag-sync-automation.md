# 0044. Studio tag sync automation

- **Status:** Proposed
- **Date:** 2026-11-14
- **Deciders:** Zeta maintainers
- **Links:** [REQ-105](../requirements-ledger.md), [merge review](../merge-review.md)

## Context

Studio has a separate repository and path layout. Its renderer and shared packages are mapped into Zeta, while desktop and Host behavior must use Zeta's existing serve/authentication authority. Ad hoc merge scripts and partial reports make it difficult to distinguish files already imported from unresolved adaptations.

## Decision

Use one complete, explicit official tag pair as the inventory. Verify both remote tag commits and local objects; refuse a moved or unavailable remote on apply. Compute mapped text merges with Git's three-way merge, with only enumerated package/global namespace transformations. Apply conflict-free text results and unmodified deletions in one batch, preserving local additions. Binary divergence, path/mode changes, manifests, Host/desktop composition and unmapped upstream files remain named review rows. Textual cleanliness is never behavior acceptance.

Every write has an exact preimage backup and hash fence. Apply refuses the root checkout, main, symbolic-link destinations and concurrent preimage changes. It never stages, commits, pushes, fetches a branch, or substitutes a snapshot import for the required official source-parent merge. A report lists the complete delta, mechanical outcomes and outstanding semantic rows separately; no completion percentage is inferred from dirty-file counts.

Reuse the existing merge-gate runner for fixed Studio quick, behavior and final profiles. Explicit skips remain skips. The final report cannot claim acceptance while unresolved decisions, source ancestry or required live desktop/SSH evidence is missing. Per-step logs and machine-readable outcomes live under repository `temp/`.

## Consequences

The next sync can batch safe path-mapped changes and focus manual review on semantic overlaps. Mapping rules and namespace transforms are maintained in one script. Real browser/native/SSH and source-matched native verification remain separate acceptance evidence. This ADR stays Proposed until the batch runner and gate profiles are exercised on the current integration.

## Alternatives

- Continue independent scratch scripts and report formats: rejected because they do not produce a complete final-tag backlog.
- Copy upstream desktop/Host wholesale: rejected because it would replace Zeta's product and authentication authority.
- Treat every Git-clean file as verified: rejected because semantic and producer/consumer conflicts can be textually clean.

## Links

- [Studio batch sync](../../scripts/studio-sync.ts)
- [Studio gate profiles](../../scripts/studio-gate.ts)
- [Existing merge gate runner](../../scripts/merge-gate.ts)
