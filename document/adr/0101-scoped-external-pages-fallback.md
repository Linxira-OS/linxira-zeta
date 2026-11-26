# 0101. Keep scoped external HTML pages as a high-interaction fallback

- **Status:** Accepted
- **Date:** 2026-11-26
- **Deciders:** Zeta owner
- **Links:** extends [0100](0100-terminal-product-line-work-studio-retirement.md), [0099](0099-web-app-freeze-and-team-page-extraction.md), [0098](0098-component-release-trains.md), [requirements ledger](../requirements-ledger.md) REQ-151

## Context

ADR-0100 makes Zeta Terminal and TSP the next product line and retires Work
Studio from release. TSP is the primary presentation surface, but some pages —
notably Team, Rooms, and IM — need dense tables, multi-pane editing, drag
targets, focus management, and rich paste/clipboard behavior. Those interactions
are not equally usable for every person or every terminal, and a TSP-only
fallback would make the product worse for those users.

`zetacode stats` already proves the model: it is an independent HTML/JS app with
its own server (`packages/stats`, default port 3847), served outside Work Studio.
Work Studio's `StatisticsPage` was only an iframe of that page. The page remains
available when the Studio shell is gone.

## Decision

- Keep a **scoped external pages surface** as a high-interaction fallback. It is
  not Work Studio and not a general browser workbench.
- The first pages are **Team**, **Rooms**, and **IM**; each keeps its own HTML
  entry and route. `zetacode stats` stays in `packages/stats`.
- `zetacode serve` hosts the pages at stable same-origin routes
  (`/pages/team/`, `/pages/rooms/`, `/pages/im/`) or, where isolation is needed,
  at a dedicated page origin. It advertises their URLs through
  `identity.pages`; `zetacode pages open <name>` opens the same URL in the
  system browser or the Wave/Terminal embedded browser.
- The pages use the same agent-core APIs, authentication, CSRF and WebSocket
  policy as `serve`. They do not import the Work Studio shell, navigation,
  desktop shell or `web-app` runtime. Prefer plain HTML/ESM with the smallest
  state layer the page needs; do not introduce a React/Next/Vite app shell just
  to host three pages.
- TSP remains the primary path. These pages are a **fallback** for complex
  interaction and accessibility, not a second full product. Feature parity is
  tracked per page; a missing page is not replaced by a fake TSP-only stub.
- `web-app/` remains archived. Data/query logic needed by the three pages is extracted from
  `web-app` (and, only where still useful, `retired/web-ui`) into a small shared
  module. UI markup stays page-local; the pages must render without the Work
  Studio shell.
- The pages are small static assets (HTML + ESM, minimal bundling). They may ship
  in the `@linxiraos/zeta` package and are checked by a scoped CI step, not by
  restoring the Work Studio build/package jobs.
- Work Studio desktop and the old `web-ui/` Next shell are not revived. Old
  `web-ui/` lacks these pages and would add a heavier host without solving the
  extraction.

## Consequences

- Root release adds a small pages artifact/build gate; it does not restore
  `dist/web-app`, Work Studio Electron, or `workstudio-browser-*`.
- `serve` gains page routes and `identity.pages`; its auth/token boundary must
  cover them.
- Team/Rooms/IM can be opened from the CLI, Terminal/Wave, or a normal browser,
  so dense interaction has a real fallback.
- The pages must not grow into a new general-purpose web UI. A new page needs an
  explicit owner decision; the default remains TSP.
- CI must test the page routes and their API contracts, but not the retired
  Work Studio suite.

## Future migration

Migration from `web-app/` / `retired/web-ui/` is **page-level and selective**,
never a wholesale revival:

- move data/query logic first, then page markup, then its tests;
- only pages whose interaction is genuinely better in HTML move into the slim
  shell; everything else stays TSP-first;
- each additional page needs an owner decision, and the slim shell must not grow
  a general app shell, desktop packaging, or a second full web workbench.

## Alternatives

- TSP-only for Team/Rooms/IM: rejected; dense interaction and accessibility
  regress for some users.
- Revive old `web-ui/` as the host: rejected; it lacks these routes and adds a
  Next server/build without reducing migration work.
- Revive Work Studio wholesale: rejected by ADR-0100; it is the product surface
  being retired, not a fallback page host.
- Hand-write three minimal HTML pages: insufficient for Team/IM editing and
  state; a scoped page app is the minimum viable fallback.

## Links

- [ADR-0100](0100-terminal-product-line-work-studio-retirement.md)
- [ADR-0099](0099-web-app-freeze-and-team-page-extraction.md)
- [Stats dashboard](../../packages/stats/src/client/App.tsx)
- [Product surfaces](../agents/surface/surfaces.md)
