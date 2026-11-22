# 0091. Team mode should use named roles and a confirming coordinator

- **Status:** Proposed
- **Date:** 2026-11-22
- **Deciders:** Zeta owner (direction), implementation review pending
- **Links:** [PiBot](https://github.com/w01fb0ss/PiBot), [Vibe/Team mode](../../docs/vibe-mode.md), [Team foundation](../../docs/team.md), [ADR-0037](0037-team-runtime-governance.md), [ADR-0038](0038-two-lane-agent-hierarchy.md), [ADR-0082](0082-vibe-team-configuration-scopes.md)

## Context

The owner points to PiBot as the desired team-agent shape. PiBot's model is
observable from its repository:

- Named Bots have a role, model, skills, permissions, memory, and a working
  folder. Roles are data packs (`.pibot` role/group definitions), not a hard-coded
  UI list.
- A group has a coordinator. The coordinator writes a plan whose steps name an
  owner, task, dependencies, inputs, deliverables, acceptance, and fix rounds.
  The user confirms the plan before it runs; the group can pause/resume and
  collects per-step results.
- Every tool call goes through one policy engine; bot-level permission overrides
  and an audit log apply even when several bots share a conversation.
- The brain is local and headless; Electron, mobile, CLI/runner, and ACP are
  clients of the same agent brain.
- Plans, handoffs, verification, and retained plan templates are durable data,
  not transient prompt text.

Zeta already has Vibe workers, Team Hub, model roles, task/room records and
approvals (ADR-0037/0038/0082). Its active `/team` is a worker tree; the legacy
Team database is pull-based and explicitly has no team-wide agent. It does not
have first-class named Bots, a coordinator plan-confirmation flow, per-bot
permission/memory packs, or a headless brain client boundary equivalent to
PiBot's L1–L5 split.

## Decision

If Team mode is extended, it follows these boundaries:

- A Team member is a durable named role with its own model, skills, memory and
  permission profile. Role/group definitions are data and can be imported as a
  pack; they do not become a second runtime.
- A group coordinator may plan and delegate only through the existing Host
  session/worker authority. The plan is shown to the user for explicit
  confirmation before execution, with step owners, dependencies, inputs,
  deliverables and acceptance. A coordinator is not a hidden second agent.
- Pause/resume and per-step results are program state, not model inference.
  Retained plans are durable artifacts.
- Bot-level permissions are overrides on the existing policy engine and audit
  path. A read-only reviewer cannot gain write/send authority from its role
  pack.
- Desktop, TUI, mobile/runner, and ACP remain clients of one Host/session identity
  (ADR-0088). Do not import PiBot's Electron/React stack or its pi dependency;
  borrow the role/plan/policy model.
- The current Vibe worker tree and Team Hub remain the execution substrate until
  a later accepted implementation ADR. This ADR does not enable a hidden
  team-wide auto-dispatcher or change the legacy Team queue semantics.

## Consequences

This is a product-direction proposal, not an implemented Team mode. The owner
must accept the scope before code is written. Implementing it requires: a role
pack format, coordinator plan schema and confirmation UI, per-role permission
projection, durable plan/step records, cross-client session identity, and a
headless brain boundary. Existing `/team` and Vibe tests must continue to pass
until the new mode is explicitly cut over.

The current `docs/team.md` statement that there is no team-wide agent remains
true for the legacy database. A future accepted ADR must supersede that statement
for the new mode rather than silently contradicting it.

## Alternatives

- **Copy PiBot's app stack.** Rejected: it would introduce a second Electron
  brain/runtime and violate Zeta's one-Host/client boundary.
- **Keep the pull-based Team queue only.** Rejected as the desired experience:
  it cannot provide a coordinator plan the owner confirms and watches.
- **Let a coordinator auto-dispatch without plan confirmation.** Rejected:
  PiBot's own flow requires confirmation, and Zeta's approval boundary requires
  the user to see the plan before work starts.

## Links

- [PiBot](https://github.com/w01fb0ss/PiBot)
- [PiBot AGENTS.md](https://github.com/w01fb0ss/PiBot/blob/main/AGENTS.md)
- [PiBot built-in team](https://github.com/w01fb0ss/PiBot/tree/main/packages/teams/builtin)
- [ADR-0088](0088-one-host-many-clients.md)
- [Vibe and Team mode](../../docs/vibe-mode.md)
- [Team foundation](../../docs/team.md)
