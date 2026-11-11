# 0003. Team core owns Team mode; `pi-messenger` owns only Crew and Mesh

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Zeta product owner
- **Links:** [Team foundation](../../docs/team.md), [pi-messenger](../../docs/plugins/pi-messenger.md), [plugin system](../plugin-system.md)

## Context

Zeta Team and the official `pi-messenger` plugin both deal with agents
collaborating in a workspace, and both use words such as "team" and "crew".
They are not the same product surface.

[docs/team.md](../../docs/team.md) records the core Team mode: the ownerless
team root, PM workspaces, base repositories, engineers, worktrees, the Team
database (`~/.zeta/data/zeta.db`, schema versioned), database-only rooms, and
the `/team`, `/team hub`, and `/lead` (alias `/pm`) commands.

[docs/plugins/pi-messenger.md](../../docs/plugins/pi-messenger.md) records the
plugin: a shared chat room, task claiming, file reservation, the `crew/`
sub-agent set, `/editor`, `/messenger`, and `/teamagent`. `/teamagent` registers
the plugin's crew roles and reads the plugin's own store under
`.zeta/messenger/team/`; it never reads the Zeta Team database. The plugin's
README calls its optional profiles/charter/memory layer "Team", but that is a
Crew context layer in the plugin store, not Zeta Team mode.

The risk is a second Team model growing inside the optional plugin, or the core
depending on an optional plugin.

## Decision

- **Team core owns Team mode.** Its database schema, path model, rooms, PM and
  engineer records, and `/team` / `/team hub` / `/lead` (`/pm`) stay in
  `packages/coding-agent/`.
- **`pi-messenger` owns only Crew and Mesh.** Its crew roles, room/task/file
  reservation behavior, and private store under `.zeta/messenger/team/` stay in
  the plugin. It remains an official plugin that arrives installed and disabled.
- **The plugin never reads or writes the Zeta Team database.**
- **The core never imports or requires `pi-messenger`.** Disabling or removing
  the plugin leaves Team mode intact; `/teamagent` is explicitly not Team mode.
- Both sides may use public extension surfaces (`ctx.agents`, `ctx.messaging`)
  without that becoming a reverse dependency: the core does not reach into the
  plugin, and the plugin does not own core state.

## Consequences

- Two stores and two vocabularies remain; no migration merges them. Docs must say
  "crew" for the plugin and "Team" for the core.
- The plugin can ship on its own release leg without changing the Team schema.
- Team tests and plugin tests stay split: `packages/coding-agent/test/team/*`
  covers the core, `packages/coding-agent/test/plugin-pi-messenger.test.ts`
  covers the plugin.
- A future decision to share state requires a new ADR; it cannot be added as a
  convenience import.

## Alternatives

- **Move crew roles and the plugin store into core.** Rejected: it makes an
  optional capability part of the core and grows the Team schema without a Team
  product need.
- **Let `pi-messenger` read the Team database.** Rejected: it couples an optional
  plugin to a versioned core schema and creates a second writer.
- **Drop the plugin and keep only Team.** Rejected: the plugin is an optional
  Crew/Mesh surface and ships disabled for users who want it.

## Links

- [Team foundation](../../docs/team.md)
- [pi-messenger activation record](../../docs/plugins/pi-messenger.md)
- [Plugin system](../plugin-system.md)
- [Team tests](../../packages/coding-agent/test/team/team-core.test.ts)
- [pi-messenger test](../../packages/coding-agent/test/plugin-pi-messenger.test.ts)
- [0002](0002-four-data-store-boundaries.md) — separate stores, separate owners
