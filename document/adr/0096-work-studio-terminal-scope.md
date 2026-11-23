# 0096. Work Studio keeps its terminal tabs; no in-house multi-terminal manager

- **Status:** Accepted
- **Date:** 2026-11-23
- **Deciders:** Zeta owner
- **Links:** [ADR-0034](0034-owner-scope-holds-2026-11-12.md), [ADR-0045](0045-studio-command-terminal-workspace.md), [Web terminal](../../web-app/src/studio/TerminalPane.tsx), [terminal gateway](../../packages/coding-agent/src/server/web-gateway/terminal.ts)

## Context

ADR-0034 held the dedicated Work Studio multi-terminal manager page. The
existing Work Studio terminal is not missing: `TerminalPane` is backed by the
shared Host PTY, restores up to four tabs, and browser/desktop adapters use the
same gateway. ADR-0045 owns command-terminal workspace binding.

The owner has now decided that if the Orca-like multi-terminal manager was not
built, it is dropped completely rather than kept as an unfinished page. A
future option is a third-party implementation, mainly Rust/MIT software; the
upstream closed-source terminal session protocol (TSP) may be studied as a
protocol reference. That is a separate evaluation, not an in-house page.

## Decision

- Keep the existing Work Studio terminal pane and its four restored tabs.
- Do not build a dedicated left-list multi-terminal manager in this tree.
- Do not ship a placeholder or disabled manager page.
- Keep terminal process ownership, PTY, authentication and workspace binding
  in the Host, as ADR-0045 requires.
- A future third-party terminal is evaluated separately: prefer Rust/MIT
  candidates, treat closed-source TSP as a protocol reference only, and require
  a new ADR before vendoring or adding a dependency.
- `zetaide` remains the terminal IDE product surface; this decision does not
  turn Work Studio into a second TERM IDE.

## Consequences

- The Work Studio navigation keeps only terminal tabs, with no manager page to
  maintain or fake.
- Users who need a multi-terminal workspace use `zetaide` or the existing tabs.
- Third-party terminal work has a clean entry point and no compatibility debt
  from a half-built in-house manager.
- Host authentication, PTY lifecycle and workspace binding remain unchanged and
  must be re-tested for any future terminal client.

## Alternatives

- **Keep the manager as a held page.** Rejected: an unbuilt page is not a
  product surface and invites false progress.
- **Build the manager now on the existing tabs.** Rejected: the owner dropped
  the in-house manager; the existing tabs already cover ordinary use.
- **Vendor a third-party terminal immediately.** Rejected: no candidate has been
  audited against the Host PTY/auth/workspace contract.

## Links

- [ADR-0034](0034-owner-scope-holds-2026-11-12.md)
- [ADR-0045](0045-studio-command-terminal-workspace.md)
- [Work Studio terminal](../../web-app/src/studio/TerminalPane.tsx)
- [Terminal gateway](../../packages/coding-agent/src/server/web-gateway/terminal.ts)
