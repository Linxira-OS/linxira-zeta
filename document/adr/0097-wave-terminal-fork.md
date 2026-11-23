# 0097. Wave Terminal is an Apache-2.0 Zeta fork, isolated from the current release chain

- **Status:** Proposed
- **Date:** 2026-11-23
- **Deciders:** Zeta owner
- **Links:** [ADR-0096](0096-work-studio-terminal-scope.md), [fork policy](../../terminal/ZETA-FORK.md), [README](../../terminal/README.md), [requirements ledger](../requirements-ledger.md) REQ-149

## Context

Wave Terminal (`wavetermdev/waveterm`) was imported from a `waveterm-main.zip`
snapshot at upstream commit `9f1c9670d407be3b93cf090319a63ef30bf54d0e`,
version `0.14.5`. It is Apache-2.0, not MIT, and has its own Electron/Vite/Go
toolchain and `.github` workflows. The root Zeta repository has no Wave source,
no Wave workspace member, and no Wave release path.

ADR-0096 keeps Work Studio's existing terminal tabs and leaves a third-party
standalone terminal to a separate decision. This ADR is that decision for Wave:
it is a standalone terminal candidate, not a replacement for Work Studio's tabs
or for `zetaide`.

The owner's current direction is to finish OMP v19.1 CI and the v19.1.1 quick
sync first. Wave must not become a second source of release pressure while that
work is open.

## Decision

- Wave lives in `terminal/` as an independent Apache-2.0 product unit.
- `terminal/` is **not** a root Bun workspace member and is not added to root
  `package.json` workspaces, root lockfiles, root release assets, npm publishing,
  or current Zeta CI/release workflows.
- Preserve upstream `LICENSE` and `NOTICE`. Because this is a fork, all Zeta
  changes stay Apache-2.0 and material modifications are recorded in
  `terminal/ZETA-FORK.md`.
- **Issue policy:** all problems found in this fork are reported to Zeta
  maintainers first. No upstream issue, PR, discussion, or security report is
  opened for Zeta-specific work. A Zeta maintainer decides whether a confirmed
  upstream defect is reported.
- The adaptation order is:
  1. resources and product identity (names, links, icons, screenshots);
  2. Simplified Chinese localization through an explicit catalogue;
  3. standalone CI, packaging, and a separate release/tag namespace.
- Upstream syncs import a named snapshot/tag and record its commit and version.
  They do not rewrite this tree's history or use an unreviewed textual sweep.
- Brand scanning skips `terminal/` only while it is an unadapted upstream
  snapshot. Removing that exclusion is part of the first adaptation milestone.

## Consequences

- The current Zeta CI, release, and npm chains remain OMP-focused and are not
  made slower or riskier by the Wave import.
- Wave can be built and tested independently without its lockfile polluting the
  root workspace.
- Zeta users do not receive a half-branded Wave build; `terminal/` is source
  material until the adaptation milestones pass.
- The fork carries an explicit legal/policy boundary, including the no-upstream-
  report rule.
- A future release needs a new ADR or an update to this one with the exact
  artifact, tag, signing, and support scope.

## Alternatives

- **Separate repository immediately.** Deferred: the owner wants one Zeta
  product suite and the source in this repository; isolation is enforced by
  workspace/workflow boundaries instead.
- **Merge Wave into the root workspace and release it now.** Rejected: its
  Apache-2.0 notices, Electron/Go toolchain, branding, and localization are not
  ready, and it would compete with the OMP v19.1 gate work.
- **Rewrite the terminal on Tauri first.** Rejected for this import: the owner
  supplied a Wave snapshot and asked to adapt it; a rewrite is a separate
  architecture decision.
- **Report Zeta-specific issues upstream.** Rejected: the fork is responsible
  for its changes; upstream did not take on Zeta's product requirements.

## Links

- [ADR-0096: Work Studio keeps its terminal tabs](0096-work-studio-terminal-scope.md)
- [Wave fork policy](../../terminal/ZETA-FORK.md)
- [Wave snapshot license](../../terminal/LICENSE)
- [Requirements ledger REQ-149](../requirements-ledger.md)
- [Roadmap: Terminal / Wave fork](../roadmap.md)
