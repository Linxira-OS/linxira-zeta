# 0094. Team personas may carry scoped plugin packs and new first-level roles

- **Status:** Proposed
- **Date:** 2026-11-22
- **Deciders:** Zeta owner (direction), implementation review pending
- **Links:** [Team Agent design](../team-agent-mode-design.md), [ADR-0026](0026-agent-authored-plugins.md), [ADR-0091](0091-team-agent-roles-and-coordinator.md), [plugin system](../plugin-system.md)

## Context

The owner requires that a Team main can create a new first-level role/identity,
and that an agent can carry its own plugin pack so it can add capabilities
without changing the Zeta tree. The current agent-authored plugin lifecycle
allows `plugin_manager` dev plugins only in an interactive main session:
print/RPC/headless/subagent sessions are refused, and promotion is a user
action. That is too narrow for Team personas, but removing the restriction
globally would let nested workers run arbitrary code.

The persona identity is data (ADR-0092); capability should be data too, not a
second hidden runtime.

## Decision

- A Team main may create a new first-level persona and its initial identity pack
  on the user's behalf. The role is registered in the Team database and stored
  as versioned data (`personas/<id>`), not injected as an anonymous prompt. The
  user can edit, disable or delete it; every change is audited.
- A persona may carry a scoped plugin pack (skills, tools, commands, pages)
  stored under its Team/persona data root. It is loaded only into that
  first-level persona session, content-addressed, and bounded by the same Host
  policy and approval path.
- The existing `plugin_manager` dev lifecycle is extended only for first-level
  Team personas. Nested workers stay refused. Dev packs may be scaffolded,
  validated and loaded; promotion/export remains a user CLI action.
- A pack cannot write repository source, grant itself credentials, promote itself,
  open external sends, or affect another persona/Team. A failed pack load leaves
  the previous tool set.
- A newly created role cannot silently acquire IM/external rights; those are
  separate explicit Host grants (ADR-0093).

## Consequences

This changes the agent-authored plugin boundary from "interactive main only" to
"interactive main and first-level Team persona", with the same approval/YOLO and
audit path. It needs a persona-scoped dev root, pack hash/revision, load/reload
isolation and clear UI for what capabilities a persona gained. Until accepted
and implemented, the current interactive-main-only rule remains in force.

## Alternatives

- **Let every subagent load plugins.** Rejected: nested workers would gain
  unbounded machine access and break isolation.
- **Require a Zeta source change for each new capability.** Rejected: it defeats
  the Team main's ability to create a role and let it evolve.
- **Install packs globally.** Rejected: one persona's experiment would alter
  every Team and every session.

## Links

- [Team Agent design](../team-agent-mode-design.md)
- [ADR-0026](0026-agent-authored-plugins.md)
- [plugin system](../plugin-system.md)
- [agent-authored plugins design](../agent-authored-plugins.md)
