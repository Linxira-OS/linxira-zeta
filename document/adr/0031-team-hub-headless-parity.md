# 0031. Team Hub headless/ACP/IM parity uses the existing Team read model

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** A core/product owner (REQ-045/046 implementation)
- **Links:** [Team foundation](../../docs/team.md), [team hub data](../../packages/coding-agent/src/team/hub-data.ts), [slash commands](../../packages/coding-agent/src/slash-commands/builtin-zeta.ts), [Team CLI](../../packages/coding-agent/src/cli/team-cli.ts), ADR-0003, ADR-0009, REQ-045, REQ-046

## Context

`/team hub` currently registers only `handleTui`. ACP and IM dispatchers require
`handle` and therefore skip it, even though `/initzetateam` and `/teamworker`
already share headless handlers. Team Hub data is already projected by
`createTeamHubDataSource` from the real global Team database; the TUI and the
standalone `zetacode` Team-root entry both consume that same source. There is no
second Team backend and no synthetic agent/room status.

## Decision

Add a `handle` to the existing `/team hub` slash command. It resolves the Team
entry for the session cwd, loads the existing `TeamHubSnapshot` through
`createTeamHubDataSource`, and renders a pure plain-text projection of the same
rooms, PMs, engineers, tasks, default selected room, and honest warning/empty
state. `handleTui` stays the TUI entry; both paths share the read model and the
same room/task services. `/team hub` keeps the existing command surface: it
opens the default Hub snapshot and adds no room-name argument parser.

An empty Team renders no invented rooms. It states the real next CLI steps
(`team pm add`, `team room create`, `team room list`, and the new member verbs)
and a missing database row keeps the existing warning. Add `team room member
add/remove` CLI verbs that call the existing `addRoomMember`/`removeRoomMember`
services, so room and member guidance points at real commands.

## Consequences

- Headless, ACP, IM and TUI reach the same Team database through one read model;
  no daemon, agent status or cross-machine Team is introduced.
- The slash command gains a plain-text contract suitable for ACP/IM output;
  TUI-only behavior is unchanged.
- Empty/DB-missing states remain honest and actionable instead of showing a
  blank screen or fabricated rows.

## Alternatives

- Add a separate headless Team backend. Rejected: duplicates the Team DB and
  creates a second source of truth.
- Make IM/ACP launch the TUI overlay. Rejected: those dispatchers require
  `handle` and have no terminal UI.

## Links

- [Team foundation](../../docs/team.md)
- [Team Hub data](../../packages/coding-agent/src/team/hub-data.ts), [text projection](../../packages/coding-agent/src/team/hub-text.ts), [Team CLI](../../packages/coding-agent/src/cli/team-cli.ts), [slash commands](../../packages/coding-agent/src/slash-commands/builtin-zeta.ts)
- ADR-0003, ADR-0009, REQ-045, REQ-046
