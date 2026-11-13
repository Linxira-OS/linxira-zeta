# 0028. Release preconditions are mechanical: scope, evidence, ADRs, and CI verdict

- **Status:** Proposed
- **Date:** 2026-11-11
- **Deciders:** Zeta owner (release governance)
- **Links:** [release process](../release.md), [policy](../../scripts/release-policy.ts), [scope gate](../../scripts/release-scope.ts), REQ-020/REQ-021/REQ-026/REQ-031/REQ-036/REQ-049

## Context

`document/release.md` already *describes* a pre-tag ADR/requirements gate, and
`check:adr` / `check:reqs` validate structure only. Nothing connects release
scope to the ledger at tag time: a release run can skip `ci:check:full`, a
`VERIFIED` row may cite only a PR number, an unapproved `DEFERRED` row is
invisible, an ADR can be Proposed yet cited in notes, and a `cancelled`/`skipped`
CI run is not distinguished from a green one by the tag driver. The freeze
policy (ADR-0006) adds version gating, not scope traceability.

REQ-036 adds a second false-proof surface: a local `dist/cli.js` answers
`--smoke-test` with `ok`, so a stale bundle can look like a fixed release
artifact.

## Decision

Release readiness is computed from repository files, in one place
(`scripts/release-scope.ts`), and reused by the existing hooks:

- `release-scope.json` declares each public version's `requirements`, `adrs` and
  `approvedDeferrals`. Missing/empty scope fails closed.
- Scoped REQs must be `VERIFIED`/`RELEASED` with independent evidence; `PR #n`
  alone is not verification and `pending` fails. `RELEASED` needs a tag pointer.
- Every `DEFERRED`/`BLOCKED` ledger row outside the scope must have an approval
  record with `approvedBy`, `reason`, `reentryTrigger`.
- Scoped ADRs must be Accepted, indexed, and cited as `ADR-NNNN` in generated
  release notes together with every scoped `REQ-NNN`; `ci-release-notes.ts`
  writes that block and refuses an unscoped public release.
- The CI source verdict counts only when the run is `completed` with conclusion
  `success`; `cancelled`, `skipped`, `stale` and missing runs fail the tag
  driver.
- Cheap structural checks (ADR index, ledger structure, scope structure) run in
  the `check` job in both modes, because a release run skips `ci:check:full`.
  `check:adr` keeps its structural schema; this gate does not expand it.
- Build provenance (`ZETA_BUILD_COMMIT`) is embedded and read back from the
  artifact; release builds fail on a mismatched/unknown commit, while runtime
  installs without git stay allowed.

Wiring: `release-v2.ts` pre-tag, CI `release_gate`, `release_github` notes check,
`ci-release-publish.ts`/bundle build. No second release framework.

## Consequences

- A release cannot be cut from structural-only evidence; the owner must record
  deferral approvals and scope before tagging.
- 1.5.x internal tags remain code-only: policy denies publish/assets, so the
  scope gate runs structurally only (no release-scope requirement).
- A stale local dist can no longer be packed as the release; a clean checkout
  without dist is unaffected.
- `release-scope.json` becomes a maintained artifact; integration owns its
  contents together with the ledger.
- The gate reads files only (fast); it adds no build or test cost to release CI.

## Alternatives

- Keep the manual checklist. Rejected: the current release runs proved it is not
  enforced, and a skipped `ci:check:full` removes the only place the checks ran.
- Make `check:reqs` judge evidence honesty. Rejected: the ledger guard is
  structural by contract; release semantics belong in the release gate.
- Ban non-git builds at runtime. Rejected: legitimate npm/tarball installs have
  no git metadata; only release checks should fail closed.
- Hash the dist instead of a commit marker. Rejected: a hash proves identity,
  not freshness against the release commit; the embedded commit is the same
  fact CI already knows (`GITHUB_SHA`).

## Links

- [Release process](../release.md)
- `scripts/release-scope.ts`, `scripts/release-scope.test.ts`
- `scripts/release-v2.ts`, `scripts/ci-release-notes.ts`, `scripts/check-release-artifact.ts`
- ADR-0006 (freeze policy), REQ-020/021/026/031/036/049
