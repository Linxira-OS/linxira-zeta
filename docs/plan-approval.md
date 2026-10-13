# Plan approval and goal-directed execution

Plan mode ends with a review: the TUI shows the **Plan Review** overlay, the web
UI and desktop app show the **PlanApproval** card, and IM channels present the
`!plan` reply menu. Approving a plan does two things:

1. it injects the approved plan as the execution brief (the synthetic
   `plan-mode-approved` prompt), and
2. it makes that execution **goal-directed**: the session enters goal mode, so
   the execution turn carries the goal context and the host keeps the work
   moving with hidden continuation turns.

## The approval choices

| TUI option | Web UI / IM mode | Transcript | Execution brief |
| --- | --- | --- | --- |
| **Approve and keep context** | `preserve` (IM reply `1`) | kept as-is | plan inlined, "history usable" note |
| **Approve and compact context** | `compact` (IM reply `2`) | distilled first (plan preserved) | plan inlined on the compacted history |
| **Approve and execute** | `fresh` (IM reply `3`) | replaced by a new conversation; the plan file is re-written at the new artifacts path | plan inlined, no history note |
| Save and quit (`/plan-review` only) | — | untouched | nothing runs |
| Cancel / dismiss | `cancel` (IM reply `4`) | untouched | nothing runs; plan mode stays active |

Refining the plan (feedback in the overlay / "Refine plan") keeps plan mode
active and does not execute anything.

## The goal of the execution round

The objective is taken from the strongest available statement of intent:

1. the task you stated when entering plan mode — `/plan <task>` or
   `/plan-ultra <task>`;
2. the plan's first heading;
3. the plan title supplied with the proposal;
4. the plan's first content line.

It is flattened to one line and clamped, so the goal banner, the goal-mode
context and the continuation prompt stay readable. A plan restored from disk
carries no stated task, so approval falls back to the plan text.

On approval the session enters goal mode: the `goal` tool becomes active, the
status line shows the goal, and the very first execution turn already carries the
goal-mode context (objective plus open todo phase) — the goal is armed *before*
the synthetic prompt, not after the first turn.

## Continuation between turns

While the goal is active, after every turn that ends without the goal being
completed the host starts a **hidden continuation turn** (the
`goal-continuation` prompt; not rendered in the transcript). Continuation stops
on its own when:

- the agent completes the goal (`goal` tool, `op: "complete"`) — goal mode exits
  and the `goal` tool is removed from the active set;
- a continuation turn makes no new progress (no tool activity, or the same
  activity as the previous continuation turn) — the goal stays active and waits
  for you;
- you abort the run — the interrupted goal is paused; only `/goal resume` (or a
  new goal) starts turns again;
- plan mode is entered again, or the session is disposed, switched or reloaded.

The driver is opt-in per run mode through `goal.continuationModes`:

| Value | Covers | Default |
| --- | --- | --- |
| `"interactive"` | TUI sessions | on |
| `"web"` | web UI / desktop app sessions (the serve gateway) | on |
| `"rpc"` | `--mode rpc`, `--mode rpc-ui` | off |

Removing a value stops automatic continuation for that host only; the approval
still arms the goal, so the execution round keeps its goal context and you can
drive the remaining turns yourself. `goal.enabled: false` skips goal mode
entirely — the plan still executes exactly as before.

## Managing the goal

The goal survives the execution turn. Use `/goal` (TUI, or the web UI's mode
controls) to inspect it, and `/goal pause` / `/goal resume` / `/goal drop` to
manage it. IM `!plan` approvals arm the goal too, but IM has no continuation
driver: the reply menu's execution runs the approved turn and stops there.
