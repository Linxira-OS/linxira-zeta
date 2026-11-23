# 0089. OMP v19 is the target baseline; the conflicting sync is not merged

- **Status:** Accepted
- **Date:** 2026-11-22
- **Deciders:** Zeta owner
- **Links:** [v19 conflict audit](../agents/merge/v19.0.0-conflict-audit.md), [PR #325](https://github.com/Linxira-OS/linxira-zeta/pull/325), [upstream sync](../upstream-sync.md)

## Context

Zeta `main` still integrates OMP `v18.22.0` (`3e8cff3b7ce1`). The owner states
that the intended baseline is the OMP v19 line. A `sync/omp-release/v19.0.0`
branch exists at `579992ddd2e` and PR #325 is open, but GitHub reports the PR
`CONFLICTING` / `DIRTY`; a merge-tree probe against current `main` finds 30
conflicted files. The branch is therefore **not** an integrated baseline and
must not be described as one.

OMP Studio `v0.2.7` and `v0.2.8` target OMP `19.0.1`. Studio `v0.2.5` and
`v0.2.6` still carry an 18.20.2-based Runtime. The current Zeta Studio source is
`v0.2.4` on OMP 18.22.0. Studio cannot be advanced independently while the
runtime baseline is held.

## Decision

- The next integrated runtime baseline is **OMP `v19.0.0`**, the owner-selected
  release line. This ADR does not authorize merging any other tag or a moving
  `main`.
- The existing v19 sync is held. No merge, rebase, squash, retag, or release may
  claim v19 until the conflict surface is resolved and the Studio delta is
  classified.
- Before a v19 merge: resolve every conflict by ownership (Zeta product/brand
  and external-source gates stay ours; upstream implementation/tests are
  accepted as pairs), regenerate generated files, run the full merge gates and
  CI, and prove the official tag commit is an ancestor of the merge.
- README, `NOTICE`, `THIRD-PARTY-NOTICES.txt`, release notes, and package
  metadata keep stating `v18.22.0` until that verified merge exists. Do not
  write v19 into public-facing text as current state while the tree is 18.22.
- OMP Studio stays on `v0.2.4` until the runtime decision above is executable.
  Advancing Studio across the v19 boundary requires a separate accepted change,
  not a silent copy of the newer renderer.

## Consequences

`main` remains a truthful 18.22.0 tree; the v19 branch is evidence and work in
progress, not the baseline. A release cut from `main` cannot claim v19 or Studio
v0.2.5+ compatibility. The conflict audit and Studio delta reports are required
inputs to the next integration plan.

The owner may later select a newer exact OMP tag (for example `v19.1.0`) or a
different Studio tag; that requires a new ADR or an explicit amendment, never
an automatic latest-tag follow.

## Alternatives

- **Merge PR #325 as-is.** Rejected: it is conflicting and would merge unresolved
  ownership decisions; the owner explicitly forbade merging it now.
- **Call the branch the baseline without merging.** Rejected: ancestry and the
  working tree would contradict the claim.
- **Advance Studio to v0.2.8 on 18.22.** Rejected: v0.2.7+ targets OMP 19.0.1;
  the Host adapter and runtime contracts would be false.

## Links

- [Conflict audit](../agents/merge/v19.0.0-conflict-audit.md)
- [Studio delta](../agents/merge/studio-v0.2.8-delta.md)
- [PR #325](https://github.com/Linxira-OS/linxira-zeta/pull/325)
- [OMP v19.0.0 release](https://github.com/Linxira-OS/linxira-zeta/releases/tag/v19.0.0)
- [OMP Studio v0.2.8](https://github.com/the-snowpear/omp-studio/releases/tag/v0.2.8)
