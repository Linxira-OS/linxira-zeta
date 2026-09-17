# Zeta Project Tracking System

A persistent, cross-session project tracking system that maintains structured
records of project progress, status, decisions, and actions. Data is stored in
`<project>/.zeta/tracking/` and survives agent session resets.

## File Structure

```
<project>/.zeta/tracking/
├── INDEX.md           # Project overview (markdown, maintained by agent)
├── status.json        # Current status snapshot
├── actions.jsonl      # Timestamped action log (JSONL)
└── sessions/          # Synced plan files from agent sessions
    └── <plan>.md
```

### Global Index

A global tracking index at `~/.zeta/agent/tracking-index.json` maintains a list
of all tracked project directories, enabling discovery across projects.

## `tracking_update` Tool

The agent uses the `tracking_update` tool to maintain tracking documents. It is
a `discoverable` tool (loaded on demand) with `read` approval level.

### Operations

| Operation | Description | File |
|---|---|---|
| `update_status` | Update project phase, progress, blockers, decisions | `status.json` |
| `update_index` | Overwrite the project overview | `INDEX.md` |
| `log_action` | Append a timestamped action entry | `actions.jsonl` |
| `sync_plan` | Copy a plan file to the tracking directory | `sessions/` |

### Schema

```typescript
{
  op: "update_status" | "update_index" | "log_action" | "sync_plan",
  content?: string,       // markdown content (for update_index)
  phase?: string,         // project phase (for update_status)
  progress?: string,      // progress description (for update_status)
  blockers?: string[],    // blocker items (for update_status)
  decisions?: string[],   // decision items (for update_status)
  action?: string,        // action description (for log_action)
  detail?: string,        // action detail (for log_action)
  plan_path?: string,     // plan file path (for sync_plan)
}
```

### Usage Guidelines

The agent prompt instructs the model to:
- Call `tracking_update` after significant milestones or when blockers resolve
- Log important decisions with `log_action` for traceability
- Sync plans with `sync_plan` for cross-session visibility

## Web UI Integration

The TrackingPanel component in the Web UI provides a visual interface for
tracking data with 6 sub-tabs:

| Tab | Content |
|---|---|
| Overview | Project summary from `INDEX.md` |
| Status | Current phase, progress, blockers, decisions |
| Plans | Synced plan files from `sessions/` |
| Logs | Action history from `actions.jsonl` |
| Sessions | Agent session summaries |
| Charts | Visual progress charts |

## Design Principles

- **Project-local**: Each project has its own `.zeta/tracking/` directory; no
  cross-project data leakage
- **File-based**: All data is plain text (JSON, Markdown, JSONL); no database
  required
- **Survives resets**: Tracking data persists across agent session restarts and
  compaction cycles
- **Agent-maintained**: The agent writes tracking data; the Web UI reads it