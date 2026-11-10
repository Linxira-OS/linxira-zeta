Assign approved skills to your own engineer main agents.

A skill is referenced by its discovered name only. Paths, hidden files, and
arbitrary injections are not accepted: the name must resolve in the engineer's
own skill discovery (its worktree), so you can only hand over skills that
engineer could already reach.

- `list` (no engineer) — every assignment you made, grouped by engineer.
- `list engineer=<name>` — one engineer's assignments plus the skills available
  to that engineer, with risk and operator-approval state.
- `assign engineer=<name> skill=<name>` — add an assignment. Authored/official
  skills are allowed by default; plugin/registry skills (hooks, tools, plugins)
  need an operator allowlist entry (`team.skillAllowlist`).
- `remove engineer=<name> skill=<name>` — delete an assignment.

Ownership is enforced: only engineers owned by the current PM are accepted, and
a PM (including yourself) is never an engineer. Every assignment records the
assigning PM and its timestamp.

Injection semantics: the engineer loads assigned skills when its session starts
or resumes, or when it runs `/reload-skills`. A live engineer session does not
hot-reload an assignment, and removing an assignment does not retract content
the running session already loaded — restart or `/reload-skills` applies the
new set.
