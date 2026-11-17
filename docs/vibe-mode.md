# Vibe mode

Vibe mode turns the top-level interactive session into a **director** for persistent background worker sessions instead of letting it edit or execute commands itself. The director's active tools are reduced to `read`, optional parent-owned `todo`, and five worker-control tools. Workers do the searching, editing, running, and building; the director verifies their claims by reading touched files. The parent owns the main todo list; workers normally omit `todo`, except when their own prewalk handoff requires it.

## Status

| Mode | Status | Behavior |
| ---- | ------ | -------- |
| Coding `/vibe` | **IMPLEMENTED** | Hard Director. The active toolset is reduced to `read`, optional parent-owned `todo`, and `vibe_spawn/send/wait/kill/list`; `task`, `edit`, `write`, `bash`, `grep`, and `glob` are removed while the mode is on. |
| Team mode | **PARTIAL** (ADR 0038) | `/team [on|off]` reuses Vibe worker tools, stable module roles and session-scoped tracking, with durable Team/mains rooms and TUI Hub/Studio projections. Entry-time tracking skeleton and canonical architecture summary/revision/hash enforcement remain incomplete. Legacy Super Team is hidden by default. |

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
- `lifecycle: "resident" | "ephemeral"` controls retention. Residents use the task executor's
  idle TTL to park and revive when their owner sends another assignment. Ephemeral workers
  terminate after a successful final turn and any already queued directives, or at a persisted
  30-minute lifetime bound. Their transcript and final output remain; worker-local scratch is removed.
- Project tracking is forced on for the Team session scope with a runtime override
  (`tracking.enabled`), so `tracking_update` is in the toolset; exiting restores the prior
  override instead of writing the global setting.
- The Team directive is injected as a hidden `team-mode-context` custom message (never
  persisted), and the `adr` skill body is loaded once per Team scope when it is installed.
- The lead-owns-canonical-summary / `INDEX.md` rule and "workers write module notes only" are
  **prompt-only**: worker `local://` writes are constrained to
  `local/agents/<worker-id>/`, but there is no canonical-summary entry kind, revision, or hash
  enforcement yet. The **PARTIAL** status above covers those missing pieces.

Legacy Lead/PM mode (`/lead`, `/pm`) remains the pre-Team system; it is being renamed
**Super Team** and hidden from default surfaces. Its Team DB, room service and Work Studio
page are not the source of truth for Team mode.

### Team Hub and Studio

While Team mode is active, `/team hub` opens a persistent split view of its
Team/mains rooms and direct Vibe workers. Host-supplied worker rows carry module
role, generation, lifecycle, tier, real registry status/activity and creation
time. Room history stays visible while selecting a worker. Enter observes an
available worker and returning restores the same Hub selection and filter;
ordinary `/resume` running-agent picker state remains independent.

Work Studio's Team route (`#!team`) reads that same active room/runtime model.
Legacy PM/engineer/Secretary rows never supply the graph. See
[Team surfaces](./team-studio.md) for the concrete invocation/smoke steps and
the per-message IM source labels in ordinary conversations.

Room notifications posted while a Team worker is still starting stay pending in
the durable room log. Once that exact source-owned child attaches, its lifecycle
start retries the same round without another post or navigation. Ordinary Vibe
does not initialize Team rooms.

Autonomous worker wake results retain the spawner transcript captured at startup
or cold revival, even after the main agent resumes a different conversation. A
declared source that cannot be resolved fails rather than delivering into the
currently viewed conversation. Plan, Goal, Vibe and Lead entry reject an active
Team session before changing mode.


## Enabling and disabling

Toggle it with the `/vibe` slash command:

```text
/vibe                 # enter vibe mode
/vibe fix the flaky test in packages/tui   # enter and submit a first directive
/vibe                 # run again to exit
```

- Entering activates a parent-session worker scope, installs the vibe tools, reduces the active toolset to `read`, optional parent-owned `todo`, and the vibe tools, and injects the director instructions.
- An inline prompt (`/vibe <prompt>`) enters the mode and submits that prompt as the first directive.
- Exiting records terminal intent for the scope and its recursive task descendants before cancelling turns and releasing sessions, then restores the prior toolset. Intent-write failures retain sessions for retry and report an error instead of claiming successful termination.
- Vibe mode is mutually exclusive with both active **and paused** plan/goal modes, and with Lead (PM) mode; exit those modes first. Lead mode uses rooms, not Vibe workers.
- Starting, deleting, forking, moving (including `/wt`), or handing off the session is rejected while vibe mode is active. Reset-style `/loop` actions are also blocked.
- The status line shows a `Vibe` indicator while the mode is on; its token-rate display aggregates generating workers even while the director is idle.

`/vibe` is an interactive-TUI command. The mode and worker lifecycle events are persisted with the parent session. Resuming a session whose current mode is `vibe` rehydrates completed workers as idle/parked sessions with their child transcripts; a turn interrupted by process restart is not resumed automatically. Explicitly killed or mode-exit workers stay terminal.

Switching to a saved session (`/resume`) navigates; it does not suspend the source scope. Running worker turns and queued directives keep going, and their lifecycle entries and turn results are written to the source transcript (ADR 0039). Team tools are detached without killing workers. Returning to that parent reattaches its live workers and shows completions that settled while it was away; a process restart still rehydrates only completed workers, because in-flight turns are process-local. Deliberately exiting `/vibe` or `/team` remains a terminal action and kills the scope.

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
