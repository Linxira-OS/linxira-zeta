# 0005. Record contract decisions as ADRs and trace them through release

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Zeta product owner
- **Links:** [release process](../release.md), [index guard](../../scripts/check-adr-index.ts), [template](template.md)

## Context

Zeta already has a release process with a `release_gate` that validates the check
guards, lockfile freshness, native addons, install methods, and required
artifacts before publishing ([document/release.md](../release.md)). What it does
not preserve is **why** a contract-level choice was made. Changelogs record what
shipped; design docs change with the code; neither is an immutable, indexed
record that a later maintainer can rely on.

The built-in `adr` skill already requires an ADR for public API, data-model,
security/auth, dependency/license, migration, and release-scope decisions. This
repository had no ADR home, so those decisions were scattered or lost.

## Decision

- **An ADR is required** when a change touches architecture layering, a public
  API or tool/wire/CLI contract, a data model or persistence format, a security
  or authorization boundary, a dependency/license commitment, an irreversible
  migration, or release scope. Bug fixes, renames, formatting, and
  behavior-preserving refactors do not need one.
- **ADRs live in `document/adr/`**, numbered `NNNN-slug.md`, with one index row
  per file. Accepted ADRs are immutable; a changed decision is a new ADR that
  supersedes the old one.
- **Release traceability maps ADR → PR → tests → assets.** Every release-relevant
  ADR records links to its PR(s), the tests or checks that prove the behavior,
  and the release assets whose presence or absence the ADR governs. Release
  review walks that mapping; release notes cite the ADR ID. A contract change
  with no ADR is an untraced change: the release is not cut until it is recorded
  or explicitly ruled out of scope.
- **The guard is structural, not semantic.** `bun run check:adr` verifies index
  and file consistency, duplicate IDs, sequential numbering, required sections,
  and status vocabulary. It does not judge whether the decision is right; review
  does that. The guard runs as part of `ci:check:full`.

## Consequences

- Contributors pay a small documentation cost for contract changes, and reviews
  gain a durable rationale to point at instead of re-litigating a decision.
- The release review has one more checklist item; automation beyond the index
  guard is follow-up work, not a claim of this ADR.
- Superseding is cheap and explicit: old bodies stay readable, and the index
  shows the replacement chain.
- The ADR set must be kept honest: a **Proposed** record is not a decision, and a
  decision the owner has not made must not be marked **Accepted**.

## Alternatives

- **Changelog only.** Rejected: a changelog records outcomes, not the constraints
  and rejected alternatives that explain them.
- **Design docs only.** Rejected: they are mutable and are not indexed as decisions,
  so readers cannot tell which statements are commitments.
- **No process.** Rejected: the repository already has contract-level decisions
  (runtime layering, Team/plugin boundary, external data ownership) whose
  rationale would otherwise be reconstructable only from history.

## Links

- [Release process](../release.md)
- [ADR index](README.md)
- [ADR template](template.md)
- [ADR index guard](../../scripts/check-adr-index.ts)
- [0001](0001-runtime-layering.md), [0002](0002-four-data-store-boundaries.md),
  [0003](0003-team-core-vs-pi-messenger.md), [0004](0004-desktop-shell-electron-tauri.md)
  — the initial records that exercise this rule
