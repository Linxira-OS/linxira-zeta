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
├── INDEX.md             # Project overview from the fixed template (see below)
├── status.json          # Current status snapshot (+ v2 stage/phases mirror)
├── actions.<day>.jsonl.log[.N]
│                        # Timestamped action log (JSONL), incl. phase_complete;
│                        #   rolled at 5 MB per file, 3 files kept per day family
├── sessions/            # Synced plan files from agent sessions
│   └── <plan>.md
├── summaries/           # Compaction-derived summaries (v2), written on every committed compaction
│   └── compaction-<ts>.md
└── plans/               # Read-only mirrors of approved plans (v2)
    └── <slug>-plan.md
```

`status.json` and the global index are read-modify-written under an advisory
file lease with an atomic replace, so a second session writing at the same time
cannot drop the first one's update. The action log is bounded by size rotation
(5 MB per file, 3 files); readers take its newest rows through a bounded tail
read. A pre-rotation `actions.jsonl` is left on disk untouched but no longer
read — the rotated family under the names above is the live log.

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

The agent uses the `tracking_update` tool to maintain tracking documents. It
declares the `discoverable` load mode (its schema is not shipped on every
request), but it is pinned top-level rather than mounted under `xd://`
(`XDEV_KEEP_TOP_LEVEL` in `packages/coding-agent/src/tools/xdev.ts`): the
phase-completion nudge and the approved-plan prompt both read the *active*
tool set and call it by name, so mounting it as a device would silently close
both gates. `read` approval level, gated by `tracking.enabled` — and that
setting is a live tool gate (`cfgBuiltinToolGates`), so `/tracking on|off`
adds or removes the tool in a running session.

### Operations

| Operation | Description | File |
|---|---|---|
| `update_status` | Update project phase, progress, blockers, decisions | `status.json` |
| `update_index` | Overwrite the project overview | `INDEX.md` |
| `log_action` | Append a timestamped action entry | `actions.<day>.jsonl.log` |
| `sync_plan` | Copy a plan file to the tracking directory | `sessions/` |
| `sync_todo` (v2) | Mirror todo phases: `stage` + ordered `phases` rows; logs `phase_complete` when the stage advances | `status.json` + `actions.<day>.jsonl.log` |

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

- **Plan approval mirroring**: every approval path — the TUI plan review
  (`InteractiveMode.#approvePlan`), ACP plan proposals
  (`AcpAgent.#handleAcpPlanProposal`), remote/IM approval (`approveRemotePlan`,
  which serves the web gateway and `serve`), and plan-yolo
  (`PrewalkCoordinator`) — mirrors the approved plan read-only into
  `plans/<slug>-plan.md` once `tracking.enabled` is on. `<slug>` is the shared
  plan-title resolver's normalized title, lowercased (falling back to the plan
  filename stem); the mirror is written before the execution turn is
  dispatched, and a tracking failure never fails the approval. The INDEX.md
  template tells the agent to link the mirror from Current Phase.
- **Compaction summaries**: every committed compaction persists its summary to
  `summaries/compaction-<ts>.md` (`<ts>` = the compaction entry's ISO
  timestamp, `:`/`.` replaced by `-`). `TrackingRecorder.recordCompaction` is
  invoked from `SessionMaintenance.#commitCompactionEntry` — the single
  chokepoint every compaction method commits through — and from the
  snapcompact dead-end rebuild that appends a replacement entry; both await it,
  so the file exists once the commit resolves. Gated on `tracking.enabled`:
  while off, nothing is written and `summaries/` is not created. A timestamp
  collision falls back to `compaction-<ts>-<entry id>.md` instead of
  overwriting, and a write failure is logged without failing the compaction.
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
renders 7 sub-tabs (Overview / Status / Plans / Logs / Sessions / Summaries /
Charts): Status shows the `status.json` fields it renders (phase, progress,
blockers, decisions, last updated — the v2 `stage`/`phases` mirror is stored but
not yet drawn), and Summaries lists `summaries/compaction-*.md` newest first.
`updatedAt` is the newest mtime among the tracked files, not the request clock,
so polling an unchanged project reports a stable instant. The dock tracking
entry itself is gated on `tracking.enabled`: the web shell reads
`GET /api/settings` and only then renders the entry
(`web-ui/components/AppShell.tsx`).

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
