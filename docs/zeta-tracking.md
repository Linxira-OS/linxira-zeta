# Zeta Project Tracking System (v2)

A persistent, cross-session project tracking system that maintains structured
records of project progress, todo-phase state, decisions, actions, compaction
summaries, and approved plans. Data is stored in `<project>/.zeta/tracking/`
and survives agent session resets.

The system is **opt-in**: enable it with `/settings` → tools → Project
Tracking (`tracking.enabled`). When off, the `tracking_update` tool is not
available and nothing is written.

## Readers (three-audience contract)

Every tracking document is written for three readers at once:

1. **People** — returning to a project, INDEX.md + status restore context fast.
2. **Agents** — new or compacted sessions re-read the documents to resume work
   with long-term memory intact across context compression.
3. **Collaborators** — cross-session/cross-agent views (Web UI tracking panel)
   show where the project stands.

Boundary with memory: tracking holds *project working state* (plan, progress,
blockers, decisions) that travels with the project; memory holds *learned
facts* across projects. Tracking must not store learned facts — cross-reference
memory by topic instead.

## File Structure

```
<project>/.zeta/tracking/
├── INDEX.md           # Project overview from the fixed template (see below)
├── status.json        # Current status snapshot (+ v2 stage/phases mirror)
├── actions.jsonl      # Timestamped action log (JSONL), incl. phase_complete
├── sessions/          # Synced plan files from agent sessions
│   └── <plan>.md
├── summaries/         # Compaction-derived summaries (v2)
│   └── compaction-<ts>.md
└── plans/             # Read-only mirrors of approved plans (v2)
    └── <slug>-plan.md
```

### INDEX.md template

Seeded on first tracking use (and by `/tracking start`) from
`packages/coding-agent/src/prompts/tracking/index-template.md`. Fixed
sections: `# Goal`, `# Architecture Key Points`, `# Key Decisions`,
`# Current Phase`, `# Next Steps`, `# Open Questions`. The template header
states the three-reader contract.

### Global index

`~/.zeta/agent/tracking-index.json` registers tracked projects for
cross-project discovery. v2 rows are objects:

```json
{
  "path": "<project dir>",
  "name": "<dir name>",
  "phase": "<last known phase>",
  "progress": "<last known progress>",
  "lastActiveSessionId": "<session id | null>",
  "lastUpdated": "<iso timestamp>"
}
```

v1 stored bare path strings; they are migrated to object rows on first write.

## `tracking_update` Tool

The agent uses the `tracking_update` tool to maintain tracking documents. It is
a `discoverable` tool (loaded on demand) with `read` approval level, gated by
`tracking.enabled`.

### Operations

| Operation | Description | File |
|---|---|---|
| `update_status` | Update project phase, progress, blockers, decisions | `status.json` |
| `update_index` | Overwrite the project overview | `INDEX.md` |
| `log_action` | Append a timestamped action entry | `actions.jsonl` |
| `sync_plan` | Copy a plan file to the tracking directory | `sessions/` |
| `sync_todo` (v2) | Mirror todo phases: `stage` + ordered `phases` rows; logs `phase_complete` when the stage advances | `status.json` + `actions.jsonl` |

### Schema

```typescript
{
  op: "update_status" | "update_index" | "log_action" | "sync_plan" | "sync_todo",
  content?: string,        // markdown content (for update_index)
  phase?: string,          // project phase (for update_status)
  progress?: string,       // progress description (for update_status)
  blockers?: string[],     // blocker items (for update_status)
  decisions?: string[],    // decision items (for update_status)
  action?: string,         // action description (for log_action)
  detail?: string,         // action detail (for log_action)
  plan_path?: string,      // plan file path (for sync_plan)
  current_phase?: string,  // current todo phase name (for sync_todo)
  phases?: string[],       // ordered todo phase names (for sync_todo)
}
```

### Automation hooks (v2)

- **Plan approval mirroring**: when a plan is approved and tracking is on,
  the plan text is mirrored read-only into `plans/<slug>-plan.md`; INDEX.md's
  Current Phase section links it.
- **Compaction summaries**: after each committed compaction, the summary is
  persisted to `summaries/compaction-<ts>.md` — long-term context survives
  compression.
- **Phase completion nudge**: when the `todo` tool reports a phase fully
  completed, the session injects a one-shot hidden reminder telling the agent
  to `sync_todo` before starting the next phase; the approved-plan prompt
  carries the same instruction so make-plan → do-plan loops keep the documents
  current without system-prompt churn (prompt-cache bytes stay stable).

### Usage Guidelines

The agent prompt instructs the model to:
- Call `tracking_update` after significant milestones or when blockers resolve
- Log important decisions with `log_action` for traceability
- Sync plans with `sync_plan` for cross-session visibility
- Call `sync_todo` when a todo phase completes (stage + phases mirror)

`/tracking start` prints the guidance and seeds `INDEX.md` from the template.

## Web UI Integration

The gateway serves a point-in-time read at `GET /api/tracking?cwd=<dir>` with
`{index, status, actions, sessions, summaries, plans, updatedAt}` and an SSE
stream at `/api/tracking/events` for change notifications. The TrackingPanel
renders 6 sub-tabs (Overview / Status / Plans / Logs / Sessions / Charts);
v2 data surfaces as stage + phase progress rows and the summaries/plans
listings. The dock tracking entry itself is gated on `tracking.enabled`
(conditional entry — see `document/simplify-and-plan-surface.md` §1.3).

## Design Principles

- **Opt-in**: nothing is written until `tracking.enabled` is on
- **Project-local**: each project has its own `.zeta/tracking/` directory; no
  cross-project data leakage
- **File-based**: all data is plain text (JSON, Markdown, JSONL); no database
  required
- **Survives resets**: tracking data persists across agent session restarts and
  compaction cycles
- **Agent-maintained, hook-assisted**: the agent writes tracking data; plan
  mirroring, compaction summaries, and phase nudges automate the high-value
  writes; the Web UI reads
- **Prompt-cache safe**: all dynamic injection goes through tracking documents
  or hidden nudges, never the standing system prompt
