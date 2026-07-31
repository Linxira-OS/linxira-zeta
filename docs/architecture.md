# Architecture

## Decision: pi base + omp as extensions (2026-08-01)

- **Engine**: pi coding-agent. Its core agent loop, session model (v3), TUI
  layout system, and C/S server architecture are the runtime.
- **Features**: omp surface features are implemented as pi extensions against
  the Extension API (`~/.pi/agent/extensions/`).
- **omp**: frozen design source in `temp/oh-my-pi`. Never a runtime
  dependency, never merged into zeta. Refresh via `git fetch` in temp and
  manual cherry-picks of behavior changes.

## Extension host mapping

| omp concept            | pi extension equivalent                                   |
| ---------------------- | --------------------------------------------------------- |
| `/loop` loop mode      | `/loop` command + `agent_settled` event + `sendUserMessage` |
| goals mode             | `/goal` command + custom entries (`appendEntry`) + `turn_end` token accounting |
| status line            | `setStatus(key, text)` / `setWidget`                     |
| inline slash commands  | `registerCommand(name, options)` with `ExtensionCommandContext` |
| tools                  | `registerTool` (later work)                              |

## Extensibility notes

- Commands registered via `api.registerCommand`; handlers get
  `ExtensionCommandContext` (extends `ExtensionContext`).
- Event hooks: `agent_settled` fires after a run fully settles (no queued
  continuation), which is the natural trigger for loop/goal auto-advance.
- `api.sendUserMessage` submits a user message (with `deliverAs`).
- `api.appendEntry(customType, data)` persists state into the session
  transcript (visible to LLM, survives restart).
- Type-only imports from `@earendil-works/pi-coding-agent` are erased at
  runtime; pi provides the module at load time.

## Porting order (3-month compressed)

1. L1 loop + goals (core mode features) — current.
2. L2 TUI additions (tab bar, kitty-graphics, mouse, latex rendering) — later.
3. L3 config system surface (/goal budget flags etc.) — later.
4. L4 tool groups (browser, computer, ssh) — later.
