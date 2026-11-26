# 0099. Freeze web-app and move Team pages onto a zeta-owned page surface

- **Status:** Superseded
- **Superseded by:** [0100](0100-terminal-product-line-work-studio-retirement.md)
- **Date:** 2026-11-24
- **Deciders:** Zeta owner
- **Links:** [ADR-0088](0088-one-host-many-clients.md), [ADR-0097](0097-wave-terminal-fork.md), [ADR-0098](0098-component-release-trains.md), [requirements ledger](../requirements-ledger.md) REQ-151

## Context

`web-app/` is a private Vite renderer bundled into `@linxiraos/zeta` as
`dist/web-app`. It still contains Team, Rooms, Team IM, settings, and other
pages. In multi-agent use the browser surface has shown stalls and unreliable
page/context reads. The owner has decided that the terminal/TSP surface is the
primary product, that the OMP baseline stops at `v19.1.0`, and that 1.6.0 must
consolidate the remaining pages in one pass.

Moving `web-app/` wholesale into `retired/` today would remove the host for
Team pages that are still in use. Keeping the whole renderer as the product
surface preserves the performance and maintenance problem.

## Decision

- Team, Rooms, and Team IM pages move to a **zeta-owned page surface** served by
  `zetacode serve` without `web-app/dist`. The exact package layout is chosen
  during implementation; the Host contracts remain in
  `packages/coding-agent/src/server/studio-host/`.
- The remaining `web-app/` renderer is frozen, excluded from default packaging
  and release, and then archived under `retired/` with its MIT/NOTICE
  attribution. It is not deleted while any page still depends on it.
- The desktop shell is frozen and excluded from release in this phase. It may
  remain in-tree for a later optional shell; it is not the product surface.
- `terminal/` remains the Apache-2.0 Wave fork. No Wave branding returns to the
  product.
- OMP `v19.1.0` is the baseline. `v19.1.1` is skipped; a later OMP tag is a
  separate decision.
- Terminal zh-CN and the owner-requested terminal features are delivered before
  the archive is considered complete.

## Consequences

- The 1.6.0 release no longer ships the full browser workbench by default.
- Team pages need their own build/test path and cannot import `web-app` source.
- The release and packaging workflows must stop publishing web-app/desktop
  artifacts before the source is archived.
- A future TSP Team surface can replace the extracted page without reviving the
  whole renderer.

## Alternatives

- Keep `web-app/` as the product UI: rejected; multi-agent performance and
  context reliability remain unresolved.
- Delete `web-app/` immediately: rejected; Team pages still depend on it.
- Convert every page to TSP now: rejected for this phase; it expands the 1.6.0
  scope beyond the archive and Team surface.

## Links

- REQ-151 in [requirements ledger](../requirements-ledger.md)
- [Code locations](../agents/surface/code-locations.md)
- [Work Studio performance](../agents/surface/web-app-performance.md)
