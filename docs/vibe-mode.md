# Vibe mode

Vibe mode turns the top-level interactive session into a **director** for persistent background worker sessions instead of letting it edit or execute commands itself. The director's active tools are reduced to `read`, optional parent-owned `todo`, and five worker-control tools. Workers do the searching, editing, running, and building; the director verifies their claims by reading touched files. The parent owns the main todo list; workers normally omit `todo`, except when their own prewalk handoff requires it.

## Status

| Mode | Status | Behavior |
| ---- | ------ | -------- |
| Coding `/vibe` | **IMPLEMENTED** | Hard Director. The active toolset is reduced to `read`, optional parent-owned `todo`, and `vibe_spawn/send/wait/kill/list`; `task`, `edit`, `write`, `bash`, `grep`, and `glob` are removed while the mode is on. |
| Team mode | **PARTIAL** (ADR 0038) | `/team [on|off]` enters a Vibe-backed Team lead: worker tools only (`vibe_spawn/send/wait/kill/list`), stable module `role`, and `tracking.enabled` forced on for that session scope (runtime override, never persisted). Team prompts, worker roles, scratch isolation and tracking are implemented; governed Team rooms, IM routing, the Super Team (legacy lead) rename, and the Work Studio Team read model are not. |

Vibe is an execution/orchestration feature, not a Team role or an organization
layer. Model routing for the bundled `sonic`/`task` workers follows
`task.agentModelOverrides.*` and `modelRoles` (see
[Settings](./settings.md)); the worker tool surface is described in
[`task`](./tools/task.md).

## Team mode

`/team` (or `/team on`) enters Team mode; `/team off` exits it. Team mode reuses the
Vibe worker runtime with a hierarchy rather than a flat director:

- `vibe_spawn` requires a stable module `role` (a lowercase slug such as `planner`), separate
  from the assignment text; ids default to `<role>-<generation>`.
- `lifecycle: "resident" | "ephemeral"` selects retention: resident workers keep their
  conversation across assignments, ephemeral ones are for one bounded task.
- Project tracking is forced on for the Team session scope with a runtime override
  (`tracking.enabled`), so `tracking_update` is in the toolset; exiting restores the prior
  override instead of writing the global setting.
- The Team directive is injected as a hidden `team-mode-context` custom message (never
  persisted), and the `adr` skill body is loaded once per Team scope when it is installed.
- The lead owns the canonical architecture summary and `INDEX.md`; workers write module
  notes only, and worker `local://` writes stay under `local/agents/<worker-id>/`.

Legacy Lead/PM mode (`/lead`, `/pm`) remains the pre-Team system; it is being renamed
**Super Team** and hidden from default surfaces. Its Team DB, room service and Work Studio
page are not the source of truth for Team mode.

## Enabling and disabling

Toggle it with the `/vibe` slash command:

```text
/vibe                 # enter vibe mode
/vibe fix the flaky test in packages/tui   # enter and submit a first directive
/vibe                 # run again to exit
```

- Entering activates a parent-session worker scope, installs the vibe tools, reduces the active toolset to `read`, optional parent-owned `todo`, and the vibe tools, and injects the director instructions.
- An inline prompt (`/vibe <prompt>`) enters the mode and submits that prompt as the first directive.
- Exiting aborts any running director turn, suppresses queued-message replay during teardown, restores the prior toolset, cancels in-flight worker turns, and persists terminal lifecycle records for every worker in the scope.
- Vibe mode is mutually exclusive with both active **and paused** plan/goal modes, and with Lead (PM) mode; exit those modes first. Lead mode uses rooms, not Vibe workers.
- Starting, deleting, forking, moving (including `/wt`), or handing off the session is rejected while vibe mode is active. Reset-style `/loop` actions are also blocked.
- The status line shows a `Vibe` indicator while the mode is on; its token-rate display aggregates generating workers even while the director is idle.

`/vibe` is an interactive-TUI command. The mode and worker lifecycle events are persisted with the parent session. Resuming a session whose current mode is `vibe` rehydrates completed workers as idle/parked sessions with their child transcripts; a turn interrupted by process restart is not resumed automatically. Explicitly killed or mode-exit workers stay terminal.

Switching to a saved session suspends the source scope: running worker turns are cancelled and queued directives are cleared, but the persisted child conversations are not tombstoned. Returning to that parent can rehydrate them; this differs from deliberately exiting `/vibe`.

## The two worker tiers

Every worker is a real, keep-alive task-executor subagent with the normal coding tool surface and its own persisted child transcript. Choose a tier when spawning:

| Tier   | Bundled agent | Default role | Use for                                             |
| ------ | ------------- | ------------ | --------------------------------------------------- |
| `fast` | `sonic`       | `@smol`      | Mechanical execution, drafts, high-volume work      |
| `good` | `task`        | `@task`      | Design, judgment calls, and reviewing `fast` output |

The tier always selects the bundled `sonic` or `task` definition, not a same-named discovered custom agent. Model resolution otherwise matches task-agent routing: `task.agentModelOverrides.sonic` / `.task` wins over the bundled agent model, and role aliases resolve through `modelRoles`, with the parent active/default model as fallback.

## Worker-control tools

| Tool         | Input and behavior                                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vibe_spawn` | `{ cli: "fast" | "good", role, prompt, lifecycle?, name? }`. `role` is a stable lowercase module slug (1-32 characters); `prompt` is this turn's assignment. Omitted names become `<role>-<generation>`; explicit names are sanitized and collision-suffixed. |
| `vibe_send`  | `{ session, message }`. Steers a streaming turn at its next step; if a turn exists but cannot be steered, queues an automatic next turn; if idle/parked, starts the next turn immediately.           |
| `vibe_wait`  | `{ sessions?, timeout? }`. Waits for the first watched turn to settle (all in-flight workers when omitted), default 30 seconds. It acknowledges settled jobs so their result is not delivered twice. |
| `vibe_kill`  | `{ session }`. Cancels an in-flight turn, clears queued messages, releases the worker, and retains any initialized transcript at `history://<id>`.                                                   |
| `vibe_list`  | `{}`. Lists sessions in spawn order with tier, state, turn/queue counts, resolved model, and recent activity.                                                                                        |

Spawn and send return immediately. Each worker-turn result self-delivers into the director conversation through the async job manager; long response text is preview-capped there, with full output available at `agent://<id>`. Running `fast` and `good` workers on independent workstreams concurrently is the normal shape.

Several messages queued while one worker turn cannot be steered are joined into one automatic next-turn directive. `vibe_list` omits explicitly killed workers from its live wall and reports their ids separately; `vibe_wait` can still watch an explicitly named settled worker.

## Scope and failure behavior

Worker ids are scoped to the owning agent and parent session; a worker from another scope is reported as unknown and cannot be controlled. Spawning requires the session async job manager. Spawn failures terminate the partial worker; failed lifecycle persistence can retain a dead record for mode-exit recovery. Turn failures self-deliver as failed job results, while a recoverable keep-alive worker returns to `idle` for another `vibe_send`. At turn settlement, a worker whose child session is no longer idle/parked in the same owner scope becomes `dead`. Sends reject stale or mismatched child-session identities rather than controlling another session.

## Workflow

1. Split the request into independent workstreams — one persistent worker per workstream so each accumulates useful conversation context.
2. Call `vibe_spawn` with a self-contained brief: files, constraints, and observable acceptance criteria. Workers start blank and never see the director's conversation.
3. Keep directing other workers while turns are in flight. Use `vibe_wait` only when blocked; a timed-out wait can be reissued.
4. Use `vibe_send` naturally for corrections and next steps. A mid-turn send steers when possible; otherwise it becomes the worker's next turn automatically.
5. When a result arrives, `read` touched files and inspect full output when the preview is insufficient. Reconcile verified work through the optional parent `todo`.
6. Route by difficulty: draft with `fast`, escalate to `good` when mechanical execution stalls or judgment is required.
7. Use `vibe_kill` for a finished/stuck worker. Exiting the mode kills the entire remaining scope.

The director remains responsible for the final outcome: worker completion means the turn settled, not that its claims are correct.
