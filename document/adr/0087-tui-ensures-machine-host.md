# 0087. TUI ensures the machine Host and shares it with every client

- **Status:** Accepted
- **Date:** 2026-11-22
- **Deciders:** Zeta owner
- **Links:** [ADR-0084](0084-backend-mode-default-on.md) (superseded), [ADR-0067](0067-tui-runtime-settings.md), [daemon docs](../../docs/daemon.md), [ensure-host](../../packages/coding-agent/src/backend/ensure-host.ts)

## Context

ADR-0084 recorded a bare TUI as local whenever no backend was reachable and
claimed that starting `serve` from the TUI had been rejected by the owner. On
2026-11-22 the owner corrected that record: the TUI must start or reuse the
machine-level Host. The TUI's runtime settings, `/resume` and Work Studio are
not separate runtimes; they are clients of that one Host.

The TUI also owns the project-grouped resume picker. A flat upstream session
list mixes every project together and makes recent work hard to find. The
resume tree must remain the default in-session picker, grouped as
project → workspace → conversation and ordered by recent activity.

## Decision

`backend.enabled` defaults to on and remains global-only. On an interactive TUI
launch, the CLI now calls `ensureHost` before transport resolution: it reuses a
healthy same-version machine Host or starts one in the configured workspace.
`--standalone` and `backend.enabled: false` remain the explicit local paths;
an explicit `--backend-url` is never replaced by a local start. A version
conflict fails closed with the existing diagnostic.

The TUI, Work Studio, the desktop shell and print/protocol runs share one Host
and one serve registry. Runtime settings pages may require that Host, because
the TUI launch has already ensured it. They still do not start a second server
themselves (ADR-0067).

In-session `/resume` passes the host's live resume source into the picker, so
the project-grouped resume tree is used instead of the upstream flat list. The
resume view groups by project and workspace, orders projects and conversations
by recent activity, and keeps the path on each group so same-named projects
remain distinguishable. Live-agent rows retain their existing flat-picker
activation path when present.

## Consequences

A TUI launch can start the machine-wide Host, which then serves Work Studio and
the CLI settings surfaces as well as that terminal session. The npm form still
has no login item, so its Host starts with the first TUI launch rather than at
login; the bundled desktop install owns autostart. Users who want a private
terminal process use `--standalone`.

The resume picker keeps project grouping instead of mixing all history. The
remaining follow-up is bounded recent-first disclosure at scale: at most five
recent projects and five recent conversations per workspace before an explicit
“more” expansion, with the current/default project expanded first. This ADR
sets the grouping/ordering contract; the paging control is implementation work,
not permission to fall back to a flat all-history list.

## Alternatives

- **Keep the TUI local and require a manually started serve.** Rejected: it
  leaves `/resume` settings and Work Studio dependent on a command the user did
  not ask to run.
- **Give each client a private server.** Rejected: it splits sessions and
  configuration, and defeats the shared Host ownership model.
- **Use the upstream flat session list.** Rejected: all projects mix into one
  history, which is the problem the project tree exists to solve.

## Links

- [ADR-0084](0084-backend-mode-default-on.md)
- [ADR-0067](0067-tui-runtime-settings.md)
- [daemon documentation](../../docs/daemon.md)
- [resume tree](../../packages/tui/src/overlays/resume-tree.ts)
- [resume view model](../../packages/coding-agent/src/resume/view-model.ts)
- [Host startup](../../packages/coding-agent/src/backend/ensure-host.ts)
