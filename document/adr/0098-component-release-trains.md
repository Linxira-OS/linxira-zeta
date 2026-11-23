# 0098. Component release trains use independent tags and a pinned suite

- **Status:** Proposed
- **Date:** 2026-11-24
- **Deciders:** Zeta owner
- **Links:** [ADR-0072](0072-restore-normal-public-releases.md), [ADR-0097](0097-wave-terminal-fork.md), [release policy](../release.md), [requirements ledger](../requirements-ledger.md) REQ-150

## Context

Zeta now carries components with different toolchains and release risks:
`zetacode`/runtime (Bun + Rust native addons), `zetaide` (Rust/TermIDE),
Work Studio (`web-app/`, Vite), and the imported Wave terminal (`terminal/`,
Electron/Go). OMP synchronization moves the runtime tree, but it does not move
the terminal, Studio renderer, or IDE on the same schedule.

A single repository-wide tag currently implies that every component was built
and verified together. That coupling makes an OMP sync wait on terminal or
renderer work, and makes an unrelated component change look like a Zeta CLI
release. The owner's direction is that whoever changes a component publishes
that component, while a later suite installer only pins the chosen versions.

## Decision

- Each product component gets its own tag namespace and release workflow:
  - `zetacode` and the OMP runtime tree: existing `vX.Y.Z` release train.
  - `zetaide`: `zetaide-vX.Y.Z`.
  - Work Studio renderer: `studio-vX.Y.Z`.
  - Wave terminal: `zeta-terminal-vX.Y.Z`.
  - Optional aggregate installer: `suite-vX.Y.Z`.
- A component tag points at a source commit whose own CI is green. It does not
  wait for unrelated components, and no component is re-tagged by the suite.
- The aggregate suite release pins exact component versions and records those
  pins as release metadata; it is an installer/release composition, not a
  second source of component versions.
- OMP sync remains the runtime rule: named upstream release tag, true merge,
  exact ancestry, and the existing release gates. It is not coupled to the
  peripheral components' release cadence.
- Root CI remains the integration gate for shared code. Component workflows
  may run independently, but a change that touches shared runtime contracts
  must still pass the root integration job before its component tag.
- The detailed workflow names, artifact names, and signing matrix are updated
  in `document/release.md` and the requirements ledger before the first
  component tag is published; no placeholder tags are created.

## Consequences

- Zeta can ship a terminal or Studio update without pretending the CLI changed.
- OMP v19.1/v19.1.1 gate work is not blocked by peripheral packaging.
- Users and the future suite installer can select an exact component set.
- Release documentation and CI-path ownership must be split carefully; a
  component cannot tag from a red or cancelled source run.
- This ADR does not itself create a release; the first component tag still
  needs its own approved scope and evidence.

## Alternatives

- **Keep one repository-wide `v*` tag for everything.** Rejected: it forces
  unrelated components into one release train and hides which component
  actually changed.
- **Give every package its own tag immediately.** Rejected for now: the
  supported product surfaces are the four above; internal packages remain
  versioned by the runtime release until they become independent products.
- **Let the suite installer rebuild and publish components.** Rejected: the
  installer would become a second release authority and break reproducibility.

## Links

- [ADR-0072: Restore normal public releases](0072-restore-normal-public-releases.md)
- [ADR-0097: Wave Terminal fork](0097-wave-terminal-fork.md)
- [Release policy](../release.md)
- [Requirements ledger REQ-150](../requirements-ledger.md)
