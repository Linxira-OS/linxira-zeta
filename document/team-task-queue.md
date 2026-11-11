# Team durable work queue (schema v5) and bootstrap design

- **Status:** Queue implemented in this slice (schema v5); `/initzetateam` is a
  design only and is not shipped.
- **Scope:** `packages/coding-agent/src/team/tasks.ts`, the Team database, the
  `zetacode team task …` CLI, and `team doctor`.
- **Not in scope:** the `/initzetateam` wizard, Vibe auto-start, and any
  IM per-agent binding. The IM design stays in
  [`local://im-multi-account-design.md`](local://im-multi-account-design.md)
  (instance/profile/binding layers). This slice adds no channel, credential, or
  account columns to Team.

## 1. Why a queue

Rooms are an append-only coordination log, not a scheduler. A PM post is never
claimed, never acknowledged, and never survives as "who is doing what". The
queue adds the missing durable fact: one row per work item, one owner at a time,
a lease that makes a crashed worker recoverable, and a review state the PM
controls.

The design is deliberately pull-based. It does not wake agents, start Vibe, or
replace rooms:

- a PM creates/assigns the task;
- an engineer (including an `execution = "vibe"` engineer) claims it;
- the worker renews the lease while active and submits for review;
- the owning PM completes or rejects it.

## 2. Schema (v5)

`PRAGMA user_version = 5` adds two tables. Both cascade from `teams`; the
assignee references `engineers`, so deleting an engineer clears the assignee but
keeps the audit trail.

```sql
CREATE TABLE tasks (
  id                 TEXT PRIMARY KEY,          -- <team>:task:<task_key>
  team_id            TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  task_key           TEXT NOT NULL,             -- T-101 or a REQ-* id
  title              TEXT NOT NULL,
  body               TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL CHECK (status IN
                       ('pending','claimed','review','done','cancelled')),
  assigned_pm_id     TEXT NOT NULL REFERENCES team_pms(id) ON DELETE CASCADE,
  assignee_agent_id  TEXT REFERENCES engineers(id) ON DELETE SET NULL,
  owner_agent_id     TEXT,
  owner_role         TEXT,
  lease_expires_at   INTEGER,
  req_ids_json       TEXT,
  revision           INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  UNIQUE(team_id, task_key)
);

CREATE TABLE task_events (
  seq              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id          TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  at               INTEGER NOT NULL,
  actor_agent_id   TEXT NOT NULL,
  kind             TEXT NOT NULL,
  body             TEXT NOT NULL DEFAULT '',
  from_status      TEXT,
  to_status        TEXT,
  req_ids_json     TEXT,
  lease_expires_at INTEGER
);
```

Indexes: `(team_id, status)`, `owner_agent_id`, `(task_id, seq)`.

`revision` is the compare-and-set token. `req_ids_json` is the task-level union
of ledger ids seen in its title, body, and events. It is metadata, not a foreign
key: the repository ledger remains the authority for `REQ-*` content.

## 3. Status and ownership invariants

| Status | Owner | Lease | Who may move it |
| --- | --- | --- | --- |
| `pending` | none | none | PM assigns; an eligible engineer claims |
| `claimed` | one engineer row id | required, future epoch seconds | owner renews/releases/submits; PM cancels |
| `review` | author engineer row id | none | owning PM completes or rejects |
| `done` | author retained for audit | none | terminal |
| `cancelled` | none | none | terminal |

Hard rules enforced in `tasks.ts`:

1. **One owner per task.** Claims are a single conditional `UPDATE` guarded by
   `revision`; two workers cannot both succeed. The loser re-reads and receives
   either "already claimed" or "changed concurrently".
2. **One task key per team.** `UNIQUE(team_id, task_key)` is the duplicate-work
   guard.
3. **Ownership scope.** A claimer must be an engineer owned by the task's
   `assigned_pm_id`. When `assignee_agent_id` is set, only that engineer may
   claim.
4. **Lease expiry.** A different engineer may reclaim only when the lease is
   absent or expired; the event body says `lease expired; reclaimed by …`.
5. **Review gate.** A worker cannot mark its own work `done`; only the owning PM
   completes a task in `review`.
6. **Every mutation is atomic with its event.** `mutateTask` runs inside
   `TeamDb.runTransaction`; a failed event insert rolls back the status change.
7. **No rooms, sessions, or transcripts are written.** Task events are database
   rows only, exactly like room events.

## 4. `REQ-*` ledger ids

- `REQ-[A-Za-z0-9]+([._-][A-Za-z0-9]+)*` is extracted from every title/body and
  explicit `--req` value.
- The union is stored on `tasks.req_ids_json`; each `task_events` row stores the
  ids relevant to that action.
- `zetacode team task comment <key> --agent <actor> --body "… REQ-42 …"` records
  a ledger reference without changing status.
- Invalid explicit ids are rejected; body extraction ignores prose around them.

## 5. CLI

```bash
zetacode team task create <key> --pm <pm> --title <title> \
  [--body <text>] [--assignee <engineer>] [--req REQ-1,REQ-2]
zetacode team task list [--status pending|claimed|review|done|cancelled] [--json]
zetacode team task show <key> [--json]
zetacode team task assign <key> --pm <pm> --assignee <engineer>
zetacode team task claim <key> --agent <engineer> [--lease <seconds>]
zetacode team task renew <key> --agent <engineer> [--lease <seconds>]
zetacode team task release <key> --agent <engineer>
zetacode team task submit <key> --agent <engineer> [--body <text>] [--req …]
zetacode team task complete <key> --pm <pm> [--body <text>] [--req …]
zetacode team task reject <key> --pm <pm> --body <reason>
zetacode team task cancel <key> --pm <pm> [--body <text>]
zetacode team task comment <key> --agent <actor> --body <text>
```

`--agent` accepts an engineer name, `<pm>/<engineer>`, or the full row id.
`--lease` defaults to 900 seconds and is capped at seven days. The CLI is the
minimal complete listing surface in this slice; the Team Hub remains a room and
roster view. A Hub task section can reuse `TeamDb.listTasks` without schema
changes.

## 6. Restart behavior

All state is in the global Team database (`~/.zeta/data/zeta.db`, or
`ZETA_TEAM_DB`), so a process restart loses nothing:

- `tasks` rows, statuses, owners, revisions, and leases persist;
- `task_events` keeps ordered audit history;
- every service call opens a fresh `TeamDb` connection, so tests and CLI
  invocations exercise the same path as a restarted process;
- an expired lease after a crash is reclaimable without a cleanup daemon.

## 7. Doctor checks

`team doctor` now resolves a room member against PMs, engineers, **and
PM-owned agents** (`agents` rows). This fixes the confirmed bug where
`createRoom` adds a registered Secretary to PM/coordination rooms but doctor
reported `room.member … FAIL`.

For tasks, doctor reports:

- `task.pm:<key>` — assigned PM exists in this team;
- `task.assignee:<key>` — assignee exists, belongs to this team, and is owned by
  the assigned PM;
- `task.owner:<key>` — owner resolves to a PM, engineer, or PM-owned agent;
- `task.lease:<key>` — claimed tasks have owner + lease; other statuses have no
  lease;
- `task.lease-expired:<key>` — warning only: the claim is reclaimable;
- `task.event.actor:<key>#<seq>` — every event actor resolves in this team.

Doctor still never repairs.

## 8. Vibe worker integration (next)

`engineers.execution = "vibe"` is already recorded; this slice does not start a
worker. The next integration is a worker loop that:

1. lists `pending` tasks for its PM and claims one with a lease;
2. renews the lease on a timer while running;
3. submits `claimed → review` with a body carrying `REQ-*` ids;
4. releases the task if it cannot start, so the PM sees the failure.

That loop needs a Team tool or a small CLI wrapper. It must not run in Lead
mode's toolset (Lead has no bash/edit); it belongs to the engineer main-agent
session in its worktree. Auto-start stays off until the bootstrap wizard and
worker crash/reclaim path are exercised end to end.

## 9. `/initzetateam` bootstrap design (not implemented)

The current commands are safe steps, not a wizard: `team init` only creates the
root, and every later step can fail independently. A one-shot wizard must be a
**plan → confirm → apply → verify** orchestration with a durable journal.

### 9.1 Inputs

Team name/root; PM list; repos (`--clone <url>` or `--link <path>`) and their
bindings; engineer matrix (`name`, `pm`, `repo`, `execution`); default rooms
(coordination plus one PM room per PM). No accounts, passwords, or channel
bindings are generated.

### 9.2 Preflight (doctor before apply)

Run before any write:

1. Target root exists/creatable, not inside a Git repository, no `AGENTS.md`,
   and not already a team root.
2. `pms/`, `repos/`, `worktrees/` are absent or empty; no nested Git entries.
3. Team id/root are not registered; all names pass `slugifyTeamName` /
   `validateSegment`; branch/path collisions are impossible.
4. For `repo link`, the path is a primary checkout on its default branch and is
   not inside `pms/`. For `repo clone`, the destination is empty.
5. The Team DB is writable, its `user_version` is a known version, and WAL is
   available.
6. `team doctor` on the prospective root has no error-level checks that the
   wizard cannot create (today this is mostly "no DB row yet", which the plan
   models explicitly).

### 9.3 Journal and transaction/rollback

A `team_bootstrap` table (schema v6, design only) records:

```text
run_id, step_id, status (planned|done|failed|compensated),
payload_json, created_at, updated_at, error
```

Each step calls exactly one existing service function. SQLite rows are safe to
wrap in a transaction per step, but **Git/worktree side effects are not**:
`initTeam`, `addPm`, `addEngineer`, and `addTaskWorktree` already compensate
their own failures. The wizard adds a run-level compensation pass:

1. On failure, stop applying.
2. Walk completed steps in reverse and delete only objects whose journal payload
   says `created_by_run: true` (worktrees first, then branches, then engineer/
   PM/repo/team rows, then markers/directories).
3. Never remove a pre-existing repo link, PM folder, or team.
4. Leave the failed run in the journal for `--resume <run_id>`; resume re-runs
   preflight for the remaining steps and skips `done` steps.
5. A successful run ends with a full `diagnoseTeam`; error-level checks fail the
   run instead of printing "done".

### 9.4 Dependency order

1. `team.task` schema/service/CLI and the doctor member fix (this slice).
2. A pure `planBootstrap(input)` function with conflict validation and a
   serializable plan (no writes).
3. `team_bootstrap` journal + `applyBootstrap(plan)` with per-step compensation
   and `--resume`.
4. Preflight wrapper around `diagnoseTeam` plus the not-yet-created-root checks.
5. `/initzetateam` slash command (`handleTui`, then `handle` if headless/IM is
   desired) and i18n/help text.
6. Vibe worker claim loop; only then consider auto-start. The wizard must not
   start workers before the lease/reclaim path is proven.

## 10. Out of scope: IM per-agent binding

The Team database stays account-free. Binding an IM instance/chat to a PM or
engineer is the separate design in
[`local://im-multi-account-design.md`](local://im-multi-account-design.md):
instances own credentials, profiles own persona/tools, and bindings own sessions.
No channel, credential, or `agentId` column is added here; the task queue only
provides the durable work identity that a future binding can point at.

## 11. Verification in this slice

- `test/team/team-tasks.test.ts`: PM dispatch, duplicate keys, exclusive claim,
  lease expiry/reclaim, renew/release, submit → complete/reject/cancel,
  comments with `REQ-*`, restart/new-process persistence, and doctor task
  checks.
- `test/team/team-rooms.test.ts`: Secretary member regression plus the v1 → v5
  migration retaining rows; existing room tests unchanged.
- No package version bump, tag, or release accompanies this slice.
