# mode

> Switch this session's mode yourself — enter plan mode, or leave the plan mode you started.

## Source
- Entry: `packages/coding-agent/src/tools/mode.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/mode.md`
- Session API: `AgentSession.enterMode` / `exitMode` / `getModeState` (`packages/coding-agent/src/session/agent-session.ts`), reached through the `enterMode` / `exitMode` members of `ToolSession`

## Input and availability
`mode` takes `op` (`enter` or `exit`), `mode` (`plan`, `goal`, `vibe`) and an optional `workflow` (`parallel` default, `iterative`, `ultra`) that only applies to entering plan mode. Registered as a built-in tool in every session; it refuses with a tool error when the session has no mode controller attached (a `ToolSession` built outside the SDK).

## Behavior
The policy is asymmetric on purpose:

| `op` | `mode` | Allowed when | Otherwise |
|---|---|---|---|
| `enter` | `plan` | always | — |
| `enter` | `goal`, `vibe` | never | tool error: those modes grant autonomy only the user can grant; ask the user to run `/goal` or `/vibe` |
| `exit` | `plan` | the agent entered that plan mode (`PlanModeState.enteredBy === "agent"`) | tool error: a user-armed plan mode is the user's approval gate — propose the plan (`write` to `xd://propose`) or ask the user |
| `exit` | `goal`, `vibe` | never | tool error: ask the user |

- `PlanModeState.enteredBy` records who armed the mode; it is absent (treated as `"user"`) for every caller that does not pass it, so `/plan`, the CLI, the web gateway and ACP clients all keep producing user-armed modes.
- Entry sets the plan file (from the session's plan reference, default `local://PLAN.md`), forces the `write` tool into the active set, applies the plan-role model transition and journals the change — all of it the existing `enterPlanMode` path.
- Entry while another mode is active surfaces the session's own refusal ("Exit goal mode first.") as a tool error rather than a raw throw.
- Refusals never change any state.
- `approval: "write"`: switching modes changes session state, so `always-ask` asks the user before the switch.
