# 0004. Ship the Electron desktop shell; defer Tauri without rejecting it

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Zeta product owner
- **Links:** [Desktop editions](../../docs/desktop-app.md), [desktop README](../../desktop/README.md), [upstream desktop survey](../upstream-2.0-evaluation.md)

## Context

The full desktop edition ships an Electron shell. [docs/desktop-app.md](../../docs/desktop-app.md)
documents both editions built from the same staged runtime: the full edition
bundles Chromium plus the compiled kernel and `web-app/dist`, and the browser
edition omits the browser engine. The Electron shell already owns window chrome,
tray behavior, native dialogs, file opens, protocol handling, autostart, and
update handoff; `desktop/README.md` states it embeds the Web UI and starts the
service without a terminal or system browser.

A Tauri shell would replace the bundled Chromium with the operating system's
webview and the Node main process with Rust. That can reduce memory and installer
size, but it introduces a different webview on each platform (WebView2 on
Windows, WebKitGTK on Linux, WKWebView on macOS), so rendering, input, media, and
accessibility behavior would vary by OS. It would also require reimplementing the
existing preload capability contract and desktop lifecycle in Rust.

## Decision

- **Electron is the supported full desktop shell now.** It keeps one Chromium
  engine and the existing preload/window/tray/update contracts; the backend and
  renderer boundaries from [0001](0001-runtime-layering.md) do not change.
- **Tauri is deferred, not rejected.** Revisit it if bundled Chromium's memory or
  installer size becomes the dominant desktop cost, or if system webviews reach
  the consistency the product needs.
- **Do not maintain two shells in parallel.** Moving to Tauri requires a new ADR
  that names the migration, the capability-contract replacement, and the evidence
  for the consistency/memory tradeoff.

The tradeoff is explicit: Electron buys cross-platform consistency and an
existing capability contract at the cost of Chromium's memory and disk footprint;
Tauri would trade that memory for per-platform webview inconsistency and a shell
rewrite.

## Consequences

- Desktop releases stay on the Electron builder pipeline and its per-target
  installers.
- The Chromium footprint is accepted for now; memory work should first target
  renderer/backend behavior rather than swapping the shell.
- Any Tauri evaluation must produce measurements on all supported platforms, not
  a single-platform prototype.
- The browser edition remains the low-footprint option for users who do not need
  desktop integration.

## Alternatives

- **Adopt Tauri now.** Deferred: the consistency and rewrite costs are not
  justified while Electron's contract and installers work.
- **Return to a Rust egui GUI.** Rejected: there is no Rust UI product surface;
  the old workbench is paused and not a product.
- **Browser-only desktop.** Rejected as the full edition: it loses tray, native
  dialogs, file opens, and the desktop update lifecycle.

## Links

- [Desktop editions](../../docs/desktop-app.md)
- [Desktop README](../../desktop/README.md)
- [Desktop package manifest](../../desktop/package.json)
- [0001](0001-runtime-layering.md) — the runtime split this shell depends on
- [Upstream desktop survey](../upstream-2.0-evaluation.md)
