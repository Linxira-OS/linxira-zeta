# 0082. Vibe and Team decisions are session-scoped; model configuration is global or project

- **Status:** Proposed
- **Date:** 2026-11-21
- **Deciders:** Zeta owner
- **Links:** [Vibe mode](../../docs/vibe-mode.md), [Team mode](../../docs/team.md), [Team runtime governance](0038-two-lane-agent-hierarchy.md), [Team core boundary](0003-team-core-vs-pi-messenger.md)

## Context

Vibe mode turns the current top-level session into a director over persistent
worker sessions. Team mode reuses that runtime with stable module roles and
durable Team rooms. The existing implementation already has several
configuration layers, but they are spread across session state, global
settings, project configuration and the legacy Team database.

The owner asked for the boundaries to be explicit before the surfaces are
expanded: what is global, what is project-owned, what belongs to one session,
how a model is selected for a worker, and when a mode change takes effect.

Current facts:

- `/vibe` and `/team` are session modes. Entering reduces the parent toolset
  and creates a parent-owned worker scope; exiting terminates or detaches that
  scope. See [Vibe mode](../../docs/vibe-mode.md).
- Team mode is currently **partial** and reuses Vibe workers. Its active
  `/team hub` reads the live Vibe/room projection; the legacy Team database and
  Super Team UI are not its source of truth.
- `modelRoleStorage` is `global` or `project`. In `project` mode, role
  assignments are saved to `.zeta/config.yml`; missing project roles fall back
  to global defaults.
- `hiddenModels` is an exact-selector visibility list for pickers. It does not
  remove models from the catalog, role assignments or fallback chains.
- Worker model resolution uses `task.agentModelOverrides.sonic`,
  `task.agentModelOverrides.task`, then `modelRoles`, then the parent
  active/default model as a fallback. The worker tier (`fast`→`sonic`,
  `good`→`task`) does not choose an arbitrary model by itself.
- Team tracking uses a session-scoped runtime override when entering Team
  mode; it must not write the global `tracking.enabled` setting.
- A worker id is scoped to its owning agent and parent session. A worker from
  another scope is unknown and cannot be controlled.

## Decision

1. **Mode is session-scoped.** `vibe` and `team` belong to the owning session
   and its worker scope. They are not global defaults and do not auto-start on
   a new launch, a resume, a worktree move, or a Team database read. Entering
   or leaving a mode is an explicit command in that session.
2. **Team is a Vibe execution policy, not a second scheduler.** Team mode uses
   the Vibe worker runtime, stable module roles and the existing session
   tracking override. It does not start Vibe automatically and does not claim
   that the legacy Team database is its execution authority.
3. **Model roles use one declared storage scope.** `modelRoleStorage` selects
   global or project storage. A project role may fall back to a global role; a
   session command may set the current session's model independently. UI
   surfaces must say which scope they are editing and must not silently write
   global config for a project/session decision.
4. **Model visibility is exact and non-destructive.** `hiddenModels` may hide
   exact `provider/model` selectors from the quick picker. It must not remove a
   model from the catalog, `modelRoles`, worker tiers or fallback chains.
   Hiding a provider wholesale is a provider setting, not a model decision.
5. **Worker model precedence is fixed.** Resolve in this order:
   `task.agentModelOverrides.<tier-agent>` → the role alias in `modelRoles` →
   the parent's active/default model. A session model change affects the
   parent and new work; it must not rewrite the persisted role configuration.
6. **Team database is not the Team-mode authority.** The legacy Team database
   remains a durable record surface for its own commands, but active Vibe/Team
   worker lifecycle, room membership and worker state come from the live
   session/room projection. No Team database row may enable Vibe or start a
   worker.
7. **Tracking overrides are temporary.** Entering Team mode applies a
   session-scoped tracking override; exiting restores the previous value. It
   does not persist a global `tracking.enabled` change.
8. **No new setting is introduced by this ADR.** This records the boundary and
   the precedence; a later implementation ADR is required before adding a new
   global/project/session key.

## Consequences

- A user can run several sessions with different Vibe/Team states without
  turning a global switch on or off.
- Model configuration has a visible owner: global profile, project
  `.zeta/config.yml`, or the current session. Copy that claims “the model” must
  also say which scope it came from.
- Team mode cannot accidentally become a background daemon or a second source
  of worker truth.
- Cross-session worker control and hidden-model surprises have explicit rules.
- Adding a new mode-scoped setting requires a follow-up ADR, not an ad-hoc
  setting.

## Alternatives

- **Make Vibe a global launch default.** Rejected: it would turn a one-session
  execution policy into machine-wide behavior and make a new launch start
  workers without a user command.
- **Let Team mode own a separate worker scheduler.** Rejected: it would
  duplicate the Vibe lifecycle and split worker truth across two authorities.
- **Store all model roles only globally.** Rejected: project-specific role
  choices are already part of the existing model configuration and cannot be
  represented by a single global set.
- **Hide a provider by removing its models from the catalog.** Rejected:
  visibility is a picker concern; catalog removal would break role assignments
  and fallback chains.
- **Do nothing.** Leaves the current spread of scopes in place and makes future
  UI additions likely to write the wrong layer.

## Links

- [Vibe mode](../../docs/vibe-mode.md)
- [Team mode](../../docs/team.md)
- [Team runtime governance](0038-two-lane-agent-hierarchy.md)
- [Team core boundary](0003-team-core-vs-pi-messenger.md)
- [Model settings](../../packages/coding-agent/src/config/model-settings.ts)
