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
| plan mode              | `/plan` command + tool-set switching (`getActiveTools`/`setActiveTools`) + `newSession` |
| vibe mode              | `/vibe` command + `pi -p` subprocess workers |
| status line            | `setStatus(key, text)` / `setWidget`                     |
| inline slash commands  | `registerCommand(name, options)` with `ExtensionCommandContext` |
| tools                  | `registerTool` (TypeBox parameters, `details` required on results) |

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
- `AgentToolResult.details` is required (return `details: undefined`).
- `CustomMessage.display` is a boolean, not a style object.
- Pi events carry no usage breakdown; goal token accounting uses
  `ctx.getContextUsage().tokens` as an estimate (see `src/goals/runtime.ts`).
- `api.exec` defaults to the pi launch cwd; tools use `ctx.cwd` explicitly
  where the target directory matters (vibe workers).

## Migrated surface

### Modes (mutually exclusive via `ModeManager`, `src/modes/shared.ts`)

| omp mode | zeta module | notes |
| -------- | ----------- | ----- |
| loop | `src/loop.ts` | `agent_settled` auto-advance, turn_end duration check, iteration limit (`src/loop-limit.ts`) |
| goal | `src/goals/*` | token accounting via `getContextUsage` estimate, budget steering, session restore |
| plan | `src/modes/plan.ts` | port of pi plan-mode example + omp semantics: plan file `plans/<slug>-plan.md`, approval flow (fresh/keep/compact), `[DONE:n]` tracking, `Ctrl+Alt+P`, `--plan` flag |
| vibe | `src/modes/vibe.ts` | director + `pi -p` workers in `.pi/vibe-workers/`, tools `vibe_spawn/send/wait/kill/list` |

Modes persist via `appendEntry` (`zeta-mode`) and restore on `session_start`.
Tool-set switching uses `api.getActiveTools()` / `api.setActiveTools()`
(verified present in pi runner: `setActiveToolsByName`, agent-session.ts:926).

### Commands

`/loop /goal /plan /plan-review /vibe /guided-goal /retry /queue /todo
/commit /stats /usage /token /dirs /worktree /append /say /btw /cleanse /gc
/ssh /web-search /notify /zeta-settings`

### Tools

`goal` (op: complete/pause/resume/report), `todo`, `commit`, computer use
(`computer_screenshot/mouse/type/open/screen_ocr`, OS-command backends:
win32 PowerShell, darwin screencapture/cliclick/osascript, linux
import/xdotool), `ssh_exec/ssh_list_hosts`, `web_search/web_fetch` (DDG HTML
+ r.jina.ai, no API key), `vibe_*` (above).

### Not ported (pi API limits)

- **MCP client** (`/mcp`): pi extension API has no runtime dynamic tool
  registration.
- **browser automation**: no puppeteer dependency path in extension model;
  `web_search`/`web_fetch` cover read paths.
- **collab** (`/join /acp /agents /launch`): maps to pi collab tree, no
  extension API for it.
- **tab bar / kitty-graphics / latex / mouse / bracketed-paste**: pi TUI owns
  terminal rendering; only `desktop-notify` (`src/tui/enhancements.ts`) and a
  settings panel were portable.
- **`/commit` and `/cleanse /gc`**: omp has no such commands (they are tools);
  zeta implements them as commands.

## Porting order (3-month compressed)

1. L1 loop + goals (core mode features) — done (commit `4a0a81d`).
2. L2 full surface migration — done (modes, commands, tools, TUI enhancements).
3. L3 config system surface (/goal budget flags etc.) — later.
4. L4 tool groups not ported (browser parity) — partial, see "Not ported".
