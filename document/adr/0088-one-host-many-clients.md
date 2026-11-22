# 0088. One machine Host serves every Zeta client and one session identity

- **Status:** Accepted
- **Date:** 2026-11-22
- **Deciders:** Zeta owner
- **Links:** [ADR-0087](0087-tui-ensures-machine-host.md), [desktop app](../../docs/desktop-app.md), [Studio host](../architecture-layers.md)

## Context

The product has a TUI (`zetacode`), Work Studio in the browser (`web-app/`),
the Electron desktop shell (`desktop/`), and print/protocol commands. The owner
requires these clients to share one machine-level backend and one task:
opening the same session in the TUI and in Work Studio must show the same
session, not two local copies with different state. The desktop app has been
observed to interrupt a message and is not yet a trustworthy client.

The current implementation already has `ensureHost`, a serve registry, a
gateway, and session files. The defect is client policy: a client can fail to
adopt the live Host, start a competing service, or hold UI-only context that
the other clients do not read.

## Decision

One machine Host is the authority for agent sessions, tool execution, config,
credentials, channels, artifacts, and terminal state. Every client is a view
over that Host:

- TUI, Work Studio, the Electron desktop shell, and print/protocol commands
  discover and reuse the same compatible Host; they do not create a second
  agent or a second session for the same task.
- A session has one stable session id. Opening that id in the TUI and the web
  renderer displays the same task, turn state, tool results, and stopping state.
  UI-local state is presentation only; it never becomes execution state.
- The Electron shell must adopt the shared serve registration and its
  authentication. It may start the Host when none exists, but it must not run a
  private agent beside a live shared Host. A version conflict fails closed with
  a diagnostic rather than silently splitting sessions.
- `--standalone` is the only explicit private-server path. It is a separate
  session and must never be presented as the shared task.
- Desktop context panels, usage/cost panels, terminal panes, and session
  switchers read Host APIs. A panel that requires an unimplemented Host
  capability stays explicitly unavailable; it must not show a local mock that
  diverges from the TUI.

## Consequences

The desktop shell is not complete until it adopts the shared Host and exercises
send/interrupt/stop through the same session as the TUI and web view. The
release gate must include a cross-client same-session check, not only separate
client smoke tests. The TUI's `ensureHost` path and the web client's existing
gateway path become the reference implementations.

A version-mismatched Host remains a hard failure until an explicit upgrade or
replacement path exists. Running two independent local sessions is still
possible only through `--standalone`, and the UI must label it as such.

## Alternatives

- **One backend per client.** Rejected: message state, pending approvals, and
  tool results diverge; the owner cannot continue one task across surfaces.
- **Treat the web UI as the only authority and make the TUI a thin terminal.**
  Rejected: the TUI must work as a first-class client and must not require a
  browser.
- **Desktop keeps a private session until feature parity.** Rejected: that is
  the current interruption/fork defect and makes the desktop unusable as a
  trusted view.

## Links

- [ADR-0087](0087-tui-ensures-machine-host.md)
- [ADR-0067](0067-tui-runtime-settings.md)
- [ensure-host](../../packages/coding-agent/src/backend/ensure-host.ts)
- [serve registry](../../packages/coding-agent/src/server/serve-registry.ts)
- [desktop shell](../../desktop/src/main.ts)
- [Work Studio](../../web-app/src/studio/App.tsx)
