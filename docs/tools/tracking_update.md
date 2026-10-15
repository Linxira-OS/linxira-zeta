# tracking_update

> Update project tracking documents in `<project>/.zeta/tracking/`. Maintains a persistent record of project progress, status, decisions, actions, and todo-phase state across sessions.

## Source
- Entry: `packages/coding-agent/src/tools/tracking.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/tracking.md`
- Index template: `packages/coding-agent/src/prompts/tracking/index-template.md`

## Registration / Visibility
- Built-in tool; gated by the `tracking.enabled` setting (off by default — enable via `/settings` → tools → Project Tracking). Not always available: when the setting is off the agent has no `tracking_update` tool.
- Execution is synchronous and single-shot.
- The tracking directory is project-local and survives agent session resets.

## Readers (who consumes these documents)
1. **People** — returning to a project, the INDEX.md + status restore context fast.
2. **Agents** — new or compacted sessions re-read the documents to resume work.
3. **Collaborators** — cross-session/cross-agent views (Web UI tracking panel) show where the project stands.

Keep every section factual and independently readable. Tracking stores *project working state* (plan / progress / blockers / decisions) that travels with the project; it must not store cross-project learned facts — those belong to memory, and cross-references point there by topic.

## Inputs

| Field | Type | Required | Description |
|---|---|---:|---|
| `op` | `"update_status" \| "update_index" \| "log_action" \| "sync_plan" \| "sync_todo"` | Yes | Tracking operation to perform. |
| `content` | `string` | No | Markdown content to write (required for `update_index`). |
| `phase` | `string` | No | Project phase name (for `update_status`). |
| `progress` | `string` | No | Progress description (for `update_status`). |
| `blockers` | `string[]` | No | Blocker items (for `update_status`). |
| `decisions` | `string[]` | No | Decision items appended to existing list (for `update_status`). |
| `action` | `string` | No | Action description (for `log_action`). |
| `detail` | `string` | No | Extended action detail (for `log_action`). |
| `plan_path` | `string` | No | Absolute path to a plan `.md` file to sync (for `sync_plan`). |
| `current_phase` | `string` | No | Current todo phase name (for `sync_todo`). |
| `phases` | `string[]` | No | Ordered todo phase names (for `sync_todo`). |

## Operations

### `update_status`
Merges fields into `status.json`. Only provided fields are written; `decisions` are appended (deduplicated) rather than replaced. `lastUpdated` (the write instant) and `lastSessionId` are refreshed on every status write. This is the status document's own stamp: the freshness the Web UI reports (`GET /api/tracking` → `updatedAt`) is derived from the tracking files' mtimes instead, so it does not advance while the content is unchanged.

### `update_index`
Overwrites `INDEX.md` with the supplied markdown `content`. Use this to maintain a structured project overview. On first use of any tracking operation the index is seeded from the fixed template (`# Goal / # Architecture Key Points / # Key Decisions / # Current Phase / # Next Steps / # Open Questions`).

### `log_action`
Appends a timestamped JSON entry to the project action log (`actions.<day>.jsonl.log`; rolled at 5 MB per file, 3 files kept), recording what was done and why. Readers see the newest rows through a bounded tail read.

### `sync_plan`
Copies a plan `.md` file from the agent's session directory into `tracking/sessions/` so it persists across sessions.

### `sync_todo` (v2)
Mirrors todo phases into `status.json`: `stage` = current phase name, `phases` = ordered `[{name, status}]` rows (phases before the current one are marked `completed`). When the stage advances, a `phase_complete` entry is appended to the action log. Call this when a todo phase completes instead of re-describing phases by hand — the Web UI panel and INDEX.md stay aligned with the live todo list.

## Outputs
- `content[0].type = "text"`
- `details` is `{ op, path, message }`.

## Side Effects
- Filesystem: creates and mutates files under `<project>/.zeta/tracking/` (`status.json`, `INDEX.md`, the rotated `actions.<day>.jsonl.log` family, `sessions/`, plus `plans/` written by plan approval). `status.json` is published by atomic replace; the rotated action-log files are pruned to the newest 3. `summaries/compaction-*.md` is **not written today**: `TrackingRecorder.recordCompaction` implements it but has no production call site (see `docs/zeta-tracking.md` → Automation hooks).
- Also updates the global tracking index (`~/.zeta/agent/tracking-index.json`) so the project is registered for cross-project discovery. The index is a JSON array of objects `{path, name, phase, progress, lastActiveSessionId, lastUpdated}` (v1 stored bare path strings; they are migrated on first write).
- Concurrency: `status.json` and the global index are read-modify-written under an advisory file lease keyed on `<tracking>/.lock`, taken for the whole read-modify-write, and the tool itself runs serialized against sibling calls in the same batch — two writers cannot drop each other's update.

## Errors
- `content is required for update_index operation` — `update_index` called without `content`.
- `plan_path is required for sync_plan operation` — `sync_plan` called without `plan_path`.
- `Failed to read plan file: <reason>` — `sync_plan` could not read the file at `plan_path`.
