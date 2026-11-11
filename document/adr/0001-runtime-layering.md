# 0001. Split the desktop runtime into an Electron shell, a Bun backend, and a Chromium renderer

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Zeta product owner
- **Links:** [docs/desktop-app.md](../../docs/desktop-app.md), [desktop/README.md](../../desktop/README.md), [code locations](../agents/surface/code-locations.md)

## Context

The desktop app needs operating-system integration (window chrome, tray, native
dialogs, file opens, update handoff) while sharing one agent kernel with the CLI.
Those needs do not belong in the same process as untrusted renderer content.

The shipped layout, documented in [docs/desktop-app.md](../../docs/desktop-app.md),
has three distinct runtimes:

- the Electron main process is a **Node** process (`desktop/package.json` runs
  `electron .`, and `desktop/src/main.ts` imports `node:child_process` / `node:fs`);
- the Work Studio backend is the **compiled Bun** `zeta`/`zetacode` binary
  (`desktop/scripts/prepare-runtime.mjs` runs the coding-agent build and stages
  `dist/zeta[.exe]` with its native addons);
- the renderer is **Chromium** loading the `web-app/dist` build served by that
  binary, with `contextIsolation: true` and `sandbox: true`
  (`desktop/src/main.ts`, `spawnMainWindow`).

`desktop/README.md` states the shell starts the local service and never opens the
system browser. The renderer's only channel to product state is HTTP/WebSocket to
`/api/v1/*`, the boundary recorded in [code locations](../agents/surface/code-locations.md).

## Decision

Keep three layers with fixed responsibilities and a one-way dependency:

1. **Electron shell (Node).** Owns process lifecycle, tray, window creation,
   menus, native dialogs, file shell actions, the preload capability object, and
   spawning or reusing `zetacode serve`. It holds no product state and answers no
   product API.
2. **Work Studio backend (compiled Bun).** The single kernel shared with the CLI.
   Owns sessions, tools, channels, state, the `/api/v1/*` host contract, and
   static serving of `web-app/dist`. It is not reimplemented in Electron.
3. **Frontend (Chromium).** Renders `web-app/dist`, talks only over `fetch`/WebSocket,
   and receives OS capabilities through the preload bridge. It gets no Node
   integration and no direct filesystem access.

Dependency direction: frontend → backend HTTP/WS → host/gateway; shell → OS and
service lifecycle. The shell never imports host code, and the renderer never
imports `packages/coding-agent/**`.

## Consequences

- One Bun kernel serves CLI, desktop, and browser editions, so agent behavior
  does not fork by surface.
- The app ships two runtimes plus native addons; packaging must stage per-target
  binaries and keep the Electron, Bun, and renderer versions aligned.
- Chromium's memory and disk footprint are accepted costs of a consistent
  renderer across platforms.
- Shell capabilities must be added to the preload contract; adding Node APIs to
  the renderer is not an option.
- Contract tests live in `desktop/scripts/*.test.mjs` (for example
  `serve-resolution.test.mjs`, `preload-bridge.test.mjs`); the backend contract
  is covered by `packages/coding-agent/test/studio-host-team.test.ts` and the
  studio-host suites.

## Alternatives

- **Run the backend in Electron's Node main process.** Rejected: it duplicates
  the Bun kernel, complicates native-addon loading, and breaks CLI/desktop parity.
- **A Rust GUI shell with an embedded webview.** Not a product surface (see
  [surfaces](../agents/surface/surfaces.md)); the Rust GUI line is paused.
- **Browser-only edition.** Kept as a separate edition, but it cannot own tray,
  native dialogs, file opens, or the desktop update lifecycle.

## Links

- [Desktop editions](../../docs/desktop-app.md)
- [Desktop README](../../desktop/README.md)
- [Code locations and dependency direction](../agents/surface/code-locations.md)
- [Product surfaces](../agents/surface/surfaces.md)
- [0004](0004-desktop-shell-electron-tauri.md) — why the shell is Electron today
