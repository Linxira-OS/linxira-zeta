Update project tracking documents in `<project>/.zeta/tracking/`. Use this to maintain a persistent record of project progress, status, decisions, and actions across sessions.

<instruction>
- SHOULD call `tracking_update` after completing significant milestones or when blockers are resolved.
- SHOULD log important decisions with `log_action` so the project history is traceable.
- SHOULD sync plans to the tracking directory with `sync_plan` for cross-session visibility.
- The tracking directory is project-local and survives agent session resets.
</instruction>

## Operations

### `update_status`

Update the project status file (`status.json`). Fields are merged — only provide the fields you want to change.

- `phase`: current project phase (e.g. "planning", "implementation", "testing", "review")
- `progress`: one-line summary of current progress
- `blockers`: list of active blockers
- `decisions`: key decisions made (appended, not replaced)

### `update_index`

Overwrite the project index (`INDEX.md`) with markdown content. Use this to maintain a structured overview of the project.

### `log_action`

Append a timestamped action entry to `actions.jsonl`. Each entry records what was done and why.

- `action`: short action description
- `detail`: optional extended detail

### `sync_plan`

Copy a plan file from the agent's session directory into the tracking `sessions/` folder so it persists across sessions.

- `plan_path`: absolute path to the plan `.md` file
