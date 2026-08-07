# tracking_update

> Update project tracking documents in `<project>/.zeta/tracking/`. Maintains a persistent record of project progress, status, decisions, and actions across sessions.

## Source
- Entry: `packages/coding-agent/src/tools/tracking.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/tracking.md`

## Registration / Visibility
- Built-in tool, always available to the agent in normal sessions.
- Execution is synchronous and single-shot.
- The tracking directory is project-local and survives agent session resets.

## Inputs

| Field | Type | Required | Description |
|---|---|---:|---|
| `op` | `"update_status" \| "update_index" \| "log_action" \| "sync_plan"` | Yes | Tracking operation to perform. |
| `content` | `string` | No | Markdown content to write (required for `update_index`). |
| `phase` | `string` | No | Project phase name (for `update_status`). |
| `progress` | `string` | No | Progress description (for `update_status`). |
| `blockers` | `string[]` | No | Blocker items (for `update_status`). |
| `decisions` | `string[]` | No | Decision items appended to existing list (for `update_status`). |
| `action` | `string` | No | Action description (for `log_action`). |
| `detail` | `string` | No | Extended action detail (for `log_action`). |
| `plan_path` | `string` | No | Absolute path to a plan `.md` file to sync (for `sync_plan`). |

## Operations

### `update_status`
Merges fields into `status.json`. Only provided fields are written; `decisions` are appended (deduplicated) rather than replaced. `lastUpdated` is always refreshed.

### `update_index`
Overwrites `INDEX.md` with the supplied markdown `content`. Use this to maintain a structured project overview.

### `log_action`
Appends a timestamped JSON entry to `actions.jsonl`, recording what was done and why.

### `sync_plan`
Copies a plan `.md` file from the agent's session directory into `tracking/sessions/` so it persists across sessions.

## Outputs
- `content[0].type = "text"`
- `details` is `{ op, path, message }`.

## Side Effects
- Filesystem: creates and mutates files under `<project>/.zeta/tracking/` (`status.json`, `INDEX.md`, `actions.jsonl`, `sessions/`).
- Also updates the global tracking index at the user config dir so the project is registered for cross-project discovery.

## Errors
- `content is required for update_index operation` — `update_index` called without `content`.
- `plan_path is required for sync_plan operation` — `sync_plan` called without `plan_path`.
- `Failed to read plan file: <reason>` — `sync_plan` could not read the file at `plan_path`.
