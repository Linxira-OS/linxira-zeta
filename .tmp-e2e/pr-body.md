## What

Fixes three user-reported web-ui defects around slash commands and model context passthrough, all in the `/plan`-from-an-existing-session flow:

1. **Existing-session slash catalog lost builtin commands** — `web-ui/components/ChatInput.tsx` gated the builtin catalog on `!isStreaming`, so an existing session whose agent was busy (or before the gateway list loaded) showed「斜杠命令 · 0 个匹配项」while the welcome card showed 3. The catalog build is now a single exported `buildSlashCommandCatalog()` (builtin list + gateway commands, builtin-wins name dedup — same precedence as the CLI's `buildAvailableSlashCommands`) used identically by the hero and docked composers in both agent states. Enter-while-streaming now routes builtin slash commands through the command channel (`/plan` enters plan mode and steers the live run, as in the CLI) instead of queueing the raw text for the model.

2. **`/plan <task>` activated plan mode but the task went nowhere (visibly)** — the gateway `mode_enter` path steers the initialPrompt into a round, but the web client never attached: no event stream, no running state, so the task text and any model error were invisible (the reporter's transcript shows the steered task followed by a 401 that the UI never surfaced). `useAgentSession` now bridges a mode-entered round to the live SSE stream (same bridge the mount-time attach uses); `/goal <objective>` additionally submits the objective as the first goal-mode turn (CLI parity — `enterGoalMode` alone only arms state). Backend: `AgentSession.enterPlanMode` no longer drops the task when plan mode is already armed (it steers it), matching CLI intent that a supplied prompt must reach the agent.

3. **`? / 128k` context placeholder** — the web gateway's `get_state` never returned `contextUsage` (the RPC mode does), so the top bar permanently showed `? / <hardcoded 128k fallback>`. `#getState` now includes `inner.getContextUsage()` (real tokens / model context window / percent, flowing into every state poll and `state_changed` refetch), and the top-bar/side-panel fallback renders `0%` instead of `?` when usage is genuinely unknown.

## Why

User-reported on the desktop build at main @ df6d19c14fa (screenshots): existing session `/plan` → 0 matches + "未找到扩展、提示词或技能命令"; welcome card → 3 matches. Full `/plan <task>` sent afterwards activated plan mode (banner, PLAN preview) but the task never visibly reached the agent. Root causes: `ChatInput.tsx:800` isStreaming catalog gate; no frontend attach after `mode_enter`; `enterPlanMode` early-return dropping the task on re-entry; missing `contextUsage` in the gateway `AgentState` DTO.

## Testing

- `packages/coding-agent`: `bun test test/agent-session-mode-controller.test.ts test/i18n-slash-commands.test.ts` — 16 pass, including new regressions: `enterMode('plan', {initialPrompt})` dispatches the task as the first planning round (mock model call recorded), and re-entry while plan mode is armed still delivers the task; registry keeps plan/plan-ultra/goal/vibe resolvable.
- `web-ui`: `npm test` — 195 pass (+3 new: catalog keeps builtin mode commands for existing sessions, builtin-wins dedup, `plan` query ranks the exact command first and matches the mode family); the only 2 failures are pre-existing Windows symlink-EPERM environment failures, identical on unmodified main. `bunx tsc --noEmit` clean; `packages/coding-agent` `tsc --noEmit` clean (only junction-noise in an isolated worktree, zero on a real workspace).
- Browser-verified against a standalone worktree gateway + `next dev` (isolated temp agent dir, seeded existing session): builtin `/plan` family visible in both hero and docked composers; `/plan <task>` in the existing session activates plan mode and the steered task round now streams into the transcript; `get_state` returns `contextUsage`.
- Desktop build pending user verification.

---

- [x] `bun check` passes (scoped: targeted `bun test` + `tsc --noEmit` on both touched packages)
- [x] Tested locally (unit + browser E2E above)
- [x] CHANGELOG updated with the required attribution (UPDATE-LOG.md「下一版本」修复 entries)
