# 0084. Backend mode is on by default; the TUI ensures the machine Host

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
on; only an explicit `false` opts out. A bare TUI launch reuses a healthy
machine-wide Host or starts one (`ensureHost`) before opening its session; it
does not require the user to run `zetacode serve` separately. `--standalone`
(or `backend.enabled: false`) keeps the launch local. An explicit
`--backend`/`--attach` remains a hard contract and fails when no matching
backend is reachable; `--backend-url` is never replaced by a local start.
Print/protocol runs keep backend behavior. The Desktop login item owns autostart
for bundled installs; the npm form keeps the bundled-only OS autostart gate, so
an npm TUI starts the Host on first launch instead of at login.

## Consequences

Existing users without a stored value switch to backend-first behavior after
upgrade. A TUI launch may start the machine-level Host, which then serves Work
Studio, runtime settings and IM in addition to that terminal session. npm users
who want the Host to outlive the terminal still need the desktop/bundled install
or an explicit autostart entry.

## Alternatives

Keeping the default off preserved the old local-first behavior but contradicted
the owner's access-point requirement. Keeping the TUI local-only was rejected:
the TUI is a first-class access point, so it must ensure the same Host that
serves its settings and Work Studio rather than telling the user to start it
manually.

## Links

- [daemon.md](../../docs/daemon.md)
- [gui-settings.md](../../docs/gui-settings.md)
- [settings schema](../../packages/coding-agent/src/config/settings-schema.ts)
