Switch this session's mode yourself.

Single `op`:
- `enter` with `mode: "plan"`: starts plan mode — plan before executing, with the plan file as the only write target. Optional `workflow`: `parallel` (default), `iterative`, `ultra`.

- `exit` with `mode: "plan"`: ends plan mode **only when you started it**. If the user started it, you cannot end it — propose the plan (`write` to `xd://propose`) or ask the user.

Only enter plan mode when the **user explicitly** asked for it (`/plan`, "plan first", "先做计划", "先规划", "计划模式"). A request for a simple proposal, a 方案, a recommendation, or a question answer does NOT authorize plan mode and must be answered inline without switching modes. Never create a `local://<slug>-plan.md` file outside plan mode.

`goal` and `vibe` mode are NEVER yours to enter or leave: they grant autonomy only the user can grant (budgeted autonomous pursuit, automatic approval). Ask the user to run `/goal` or `/vibe`.

Entering plan mode is a self-imposed restriction, not a shortcut: while it is on, file writes go to the plan file and the plan reaches the user through `xd://propose`. Leaving a plan mode you started abandons that plan; the user's approval path is unchanged either way.
