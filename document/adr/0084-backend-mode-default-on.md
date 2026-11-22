# 0084. Backend mode is on by default; clients attach when a backend is reachable

- **Status:** Accepted
- **Date:** 2026-11-21
- **Deciders:** Zeta owner
- **Links:** [daemon docs](../../docs/daemon.md), [GUI settings](../../docs/gui-settings.md), [ADR-0080](0080-repository-path-governance.md)

## Context

`backend.enabled` was default-off and global-only. A bare TUI was always local,
and print/protocol runs failed when no backend existed. The owner asked that all
access points use the backend by default, with the Desktop install owning the
login item and npm remaining unable to install one safely.

## Decision

`backend.enabled` defaults to on and remains global-only. An unset value means
on; only an explicit `false` opts out. A bare TUI connects to a live default
backend when one is reachable and otherwise falls back to its own local process;
it never starts or adopts a backend. Explicit `--backend`/`--attach` remains a
hard contract and fails when no matching backend is reachable. Print/protocol
runs keep backend behavior. The Desktop login item owns autostart for bundled
installs; the npm form keeps the existing bundled-only OS autostart gate.

## Consequences

Existing users without a stored value switch to backend-first behavior after
upgrade, but remain usable when no backend is running. The TUI no longer starts
serve implicitly. npm users still need an explicit desktop/bundled install or a
manually launched `zetacode serve` for login persistence.

## Alternatives

Keeping the default off preserved the old local-first behavior but contradicted
the owner's access-point requirement. Starting `serve` from the TUI was rejected
because it turns a terminal launch into a machine-wide background service.

## Links

- [daemon.md](../../docs/daemon.md)
- [gui-settings.md](../../docs/gui-settings.md)
- [settings schema](../../packages/coding-agent/src/config/settings-schema.ts)
