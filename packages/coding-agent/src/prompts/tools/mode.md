Switch this session's mode yourself.

Single `op`:
- `enter` with `mode: "plan"`: starts plan mode — plan before executing, with the plan file as the only write target. Optional `workflow`: `parallel` (default), `iterative`, `ultra`. Use it when a task deserves a plan the user approves before any file changes.
- `exit` with `mode: "plan"`: ends plan mode **only when you started it**. If the user started it, you cannot end it — propose the plan (`write` to `xd://propose`) or ask the user.

`goal` and `vibe` mode are NEVER yours to enter or leave: they grant autonomy only the user can grant (budgeted autonomous pursuit, automatic approval). Ask the user to run `/goal` or `/vibe`.

Entering plan mode is a self-imposed restriction, not a shortcut: while it is on, file writes go to the plan file and the plan reaches the user through `xd://propose`. Leaving a plan mode you started abandons that plan; the user's approval path is unchanged either way.
