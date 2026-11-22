# 0092. Team identity is composed from explicit scoped layers

- **Status:** Proposed
- **Date:** 2026-11-22
- **Deciders:** Zeta owner (direction), implementation review pending
- **Links:** [Team Agent design](../team-agent-mode-design.md), [ADR-0091](0091-team-agent-roles-and-coordinator.md), [External sources](../external-sources-and-tool-exposure.md)

## Context

OMP loads repository/global instructions for an agent's working directory. A
Team main and its first-level workers can share that directory, so a worker can
receive the main's identity/instructions together with its own role prompt. That
causes identity confusion: the worker may answer as the main, inherit main-only
permissions, or lose its role as soon as a root `AGENTS.md` changes. Conversely,
without persistent role documents, a persona's duties cannot evolve over time.

`AGENTS.md` is a repository convention file, not an agent identity document. One
file cannot safely serve both jobs.

## Decision

Agent identity is assembled from explicit layers, in order:

1. **global user instructions** — applies to all agents;
2. **repository `AGENTS.md`** — code/project convention, applies to all agents
   in that checkout; it never grants identity or per-role permissions;
3. **Team profile** — team-wide conventions/data (`<team>/.zeta/team-profile.md`);
4. **persona role pack** — identity, model, skills, permissions and memory;
5. **assignment/session scope** — this step, run, room or source.

Main-only and worker-only instructions cannot ride in `AGENTS.md`. They live in
the persona/role pack or a Team-profile item with an explicit `appliesTo`.
A first-level worker receives layers 1/2 plus its own Team/persona/assignment,
never the main's private persona. A main receives 1/2 plus its own persona, never
a worker's role text.

Role packs are versioned data. Prompt assembly records layer ids/revisions so a
resumed session and an audit can see what identity was applied. An agent that
needs another role's policy requests it through the group; it never silently reads
another agent's identity file. The Team root keeps no `AGENTS.md`; new data uses
`.zeta/team-profile.md` and `.zeta/personas/<id>.json`.

## Consequences

This requires a prompt-assembly boundary that labels instructions by scope and
filters them per agent role. It does not change repository conventions for the
main and workers. Existing sessions without layer metadata remain readable but
cannot claim scoped identity. Persona updates affect the next instantiation; a
frozen old session is not silently rewritten.

## Alternatives

- **One `AGENTS.md` for everyone.** Rejected: it is exactly the identity
  confusion and cannot express per-role permissions.
- **Give each worker its own checkout to isolate instructions.** Rejected: it
  breaks shared worktrees and repository convention loading.
- **Inject the whole main prompt into every worker.** Rejected: it leaks
  main-only policy and makes role behavior unstable.

## Links

- [Team Agent design](../team-agent-mode-design.md)
- [ADR-0091](0091-team-agent-roles-and-coordinator.md)
- [ADR-0067](0067-tui-runtime-settings.md)
- [External sources and tool exposure](../external-sources-and-tool-exposure.md)
