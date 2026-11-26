# 0100. Zeta Terminal is the next product line; retire Work Studio from release

- **Status:** Accepted
- **Date:** 2026-11-26
- **Deciders:** Zeta owner
- **Links:** supersedes [0097](0097-wave-terminal-fork.md), retires the Work Studio release scope of [0099](0099-web-app-freeze-and-team-page-extraction.md), extends [0098](0098-component-release-trains.md), [requirements ledger](../requirements-ledger.md) REQ-151

## Context

Work Studio (`web-app/` plus the Electron desktop shell) was the browser product
surface. It still owns Team/Rooms/IM pages and is the renderer packaged into
`dist/web-app` and the Work Studio desktop archives. The owner has now decided
that Zeta will not build or release another general-purpose web UI: the next
product line is the Terminal line, built on the TSP surface.

`terminal/` already exists as the Apache-2.0 Wave fork, with its own toolchain
and CI. ADR-0097 deliberately kept it out of the root release chain. ADR-0099
froze `web-app/` but left Team pages dependent on it. Those two constraints are
now superseded by an explicit product decision.

## Decision

- **Zeta Terminal is the next product line.** `terminal/` is no longer only a
  reference fork: it is the product surface for the terminal-first/TSP line and
  is released through its own component train (ADR-0098), not by reviving the
  root web UI.
- **Work Studio is retired from release.** `web-app/` and the Electron desktop
  shell are excluded from release assets and from the root product CI. Their
  source remains in-tree for archival/reference until the Team/TSP pages are
  fully moved, then moves under `retired/` with the existing MIT/NOTICE
  attribution.
- **`zetacode serve` stays.** It remains the headless backend/API host for
  sessions, remote clients and Terminal integration. It must not serve a
  `web-app/dist` renderer and must not become a second UI build target.
- **TSP is the presentation contract for the Terminal line.** Team/Rooms/IM
  surfaces are rebuilt on the Terminal/TSP side, not as another browser
  renderer. The Studio host contracts may remain as backend API only while a
  non-UI consumer needs them.
- **Release and CI must follow the product table.** Work Studio desktop
  packaging, web-app build/test steps, and their release-asset checks are
  removed before the source archive. Work Studio jobs are not left permanently
  skipped as a substitute for deleting them.

The resulting product surfaces are:

| Surface | Entry | Release |
|---|---|---|
| `zetacode` | CLI/TUI agent | `@linxiraos/zeta` |
| `zetaide` | terminal IDE | `@linxiraos/ide` |
| Zeta Terminal | `terminal/` | independent Terminal train |

`serve` is infrastructure, not a fourth product surface.

## Consequences

- The root release no longer ships `dist/web-app`, Electron Work Studio, or the
  `workstudio-browser-*` assets.
- CI loses the web build, Studio guards, desktop contract suite, Work Studio
  packaging, and the associated release-asset validation. Those are deleted,
  not hidden behind `if: false`.
- Terminal keeps its own CI/release gate. Root CI must not build it as a Bun
  workspace member; the Terminal toolchain remains independent.
- Team pages must move to the Terminal/TSP line before the `web-app/` archive is
  complete. Until then, the frozen source is not a release artifact.
- Rust CI becomes path-triggered; it is not a release-chain job. Native addon
  builds remain in the root release chain because `zetacode` ships them.

## Alternatives

- Keep Work Studio as a release surface: rejected; the owner has decided the
  web UI is not the next product.
- Delete `web-app/` immediately: rejected while Team pages still need a source
  reference; archive only after extraction.
- Build a second web UI on TSP: rejected; TSP belongs to the Terminal line and
  must not recreate the browser workbench.
- Keep Work Studio jobs as permanent skips: rejected; stale jobs are noise and
  can hide a release regression.

## Links

- [ADR-0097: Wave fork](0097-wave-terminal-fork.md)
- [ADR-0098: component release trains](0098-component-release-trains.md)
- [ADR-0099: web-app freeze](0099-web-app-freeze-and-team-page-extraction.md)
- [Product surfaces](../agents/surface/surfaces.md)
- [Requirements ledger](../requirements-ledger.md) REQ-151
