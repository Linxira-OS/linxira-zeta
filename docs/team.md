# Team foundation (paths, database, rooms, work queue, and the Team Hub)

`zetacode team` implements the **Zeta Team** product surface (Team mode) and
its collaboration primitives: the ownerless team root, PM workspaces,
canonical base repositories, PM bindings, engineers, linked worktrees,
database-only rooms, and a durable work queue. The TUI adds
**path entry** and the **Team Hub**: launching at a Team root or PM workspace
opens a read/write view of the Team database, while engineer worktrees and base
repositories open the ordinary coding TUI. Explicit session launches
(`--continue`, `--resume`, `--fork`, or a prompt) still open a coding session in
a PM workspace, where `/lead` (alias `/pm`) runs the **PM main agent** with a
coordination-only toolset and can spawn its one persistent Secretary subagent.
There is still **no team-wide agent, no automatic dispatch, and no channel
binding**. `--execution vibe` records the engineer's
execution choice; it does not start Vibe, and no Team entry ever enables Vibe
automatically. The work queue is pull-based: a PM assigns, a worker claims with
a lease, and the PM reviews.

The `pi-messenger` official plugin owns only the mesh and crew surfaces. Its
`/teamagent` command registers crew roles as spawnable subagents; it is not
Team mode and does not read the Zeta Team database. `/team`, `/team hub`, and
`/lead` (alias `/pm`) stay core.

## Path model

```text
<team>/                              ownerless container (no Agent, no AGENTS.md, no Git, no session)
├─ .zeta/team.json                   { schemaVersion, kind: "team", teamId, name }
├─ pms/<pm>/                         PM main-agent workspace: a plain folder, not Git
│  ├─ .zeta/pm.json                  { schemaVersion, kind: "pm", teamId, pmId, name }
│  ├─ notes/
│  └─ links/                         (no repos/ inside a PM workspace)
├─ repos/<repo>/                     canonical base repository (main/master; never an agent cwd)
│  └─ .zeta/team-member.json         gitignored offline breadcrumb
└─ worktrees/
   └─ <repo>/<pm>/<engineer>/
      ├─ home/                       branch team/<team>/<pm>/<engineer>/integration
      └─ <task>/                     branch team/<team>/<pm>/<engineer>/<task>
```

Rules enforced by the commands:

- The team root has no `AGENTS.md`, no `.git`, and no team-root session.
- `pms/<pm>/` is a plain folder with `.zeta/pm.json`; it never contains
  repositories.
- All canonical base repositories live at `<team>/repos/<repo>/` unless they
  were registered in place with `repo link`. A PM joins a repo through a
  database row, never a second path.
- A base repository is never an agent cwd. Engineer and task worktrees are.
- Only the Team CLI (or an engineer main agent) creates worktrees. Every
  worktree is a real `git worktree add` of a base repository; nothing is cloned.
- `repo link` writes `<repo>/.zeta/team-member.json` so an external checkout can
  resolve its team offline. The database is still authoritative.

## Global database

All structure is written to one SQLite database: `~/.zeta/data/zeta.db`
(override with `ZETA_TEAM_DB`, intended for tests and smoke runs). Markers on
disk are discovery hints; `team doctor` reports drift between them and the
database.

Schema (`PRAGMA user_version` = 6):

| Table                  | Columns                                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `teams`                | `id`, `name`, `root_path`, `created_at`                                                                                                                                                                                         |
| `team_pms`             | `id`, `team_id`, `name`, `workspace_path`, `created_at`                                                                                                                                                                         |
| `repos`                | `id`, `team_id`, `name`, `base_path`, `remote_url`, `default_branch`, `created_at`                                                                                                                                              |
| `repo_bindings`        | `repo_id`, `pm_id`, `created_at`                                                                                                                                                                                                |
| `engineers`            | `id`, `team_id`, `pm_id`, `name`, `execution`, `created_at`                                                                                                                                                                     |
| `worktrees`            | `id`, `team_id`, `repo_id`, `pm_id`, `engineer_id`, `kind`, `name`, `path`, `branch`, `base_branch`, `created_at`                                                                                                               |
| `rooms`                | `room_id`, `team_id`, `pm_id` (nullable), `name`, `kind`, `created_at`                                                                                                                                                          |
| `room_members`         | `room_id`, `agent_id`, `role`, `created_at`                                                                                                                                                                                     |
| `room_events`          | `seq`, `room_id`, `sent_at`, `sender_agent_id`, `kind`, `body`, `reply_to`, `mentions_json`                                                                                                                                     |
| `agents`               | `agent_id`, `team_id`, `pm_id`, `role`, `persistence`, `parent_agent_id`, `session_id`, `session_file`, `state`, `created_at`, `updated_at`                                                                                     |
| `agent_skills`         | `team_id`, `pm_id`, `engineer_id`, `skill_name`, `source`, `qualified_name`, `assigned_by`, `created_at` (unique per engineer+qualified name and engineer+skill name)                                                           |
| `tasks`                | `id`, `team_id`, `task_key`, `title`, `body`, `status`, `assigned_pm_id`, `assignee_agent_id` (nullable), `owner_agent_id` (nullable), `owner_role`, `lease_expires_at`, `req_ids_json`, `revision`, `created_at`, `updated_at` |
| `task_events`          | `seq`, `task_id`, `at`, `actor_agent_id`, `kind`, `body`, `from_status`, `to_status`, `req_ids_json`, `lease_expires_at`                                                                                                        |
| `team_bootstrap_runs`  | `run_id`, `team_id`, `root_path`, `mode`, `status`, `plan_json`, `created_at`, `updated_at`, `error`                                                                                                                            |
| `team_bootstrap_steps` | `run_id`, `step_id`, `seq`, `kind`, `status`, `payload_json`, `created_at`, `updated_at`, `error`                                                                                                                               |
| `room_subscriptions`   | `room_id`, `agent_id`, `accepted_through`, `read_through`, `subscribed_at`, `updated_at`                                                                                                                                        |

Worktree `kind` is `home` or `task`; engineer `execution` is `normal` or `vibe`;
task `status` is `pending`, `claimed`, `review`, `done`, or `cancelled`.
A repo may be bound to several PMs, and one engineer may own a home worktree per
bound repo. Room `kind` is `pm`, `coordination`, or `room`; rooms and the queue
are described below.

## Rooms

A room is **database rows only**: a `rooms` row, its `room_members` rows, and an
append-only `room_events` log. It is never a folder, Git repository, workspace,
or session, so posting never writes a transcript and room events cannot enter
session JSONL.

| Room kind                   | `pm_id`              | Default members                                                  |
| --------------------------- | -------------------- | ---------------------------------------------------------------- |
| `pm`                        | the owning PM row id | that PM, its engineers, and its Secretary when one is registered |
| `coordination` (`--shared`) | `NULL`               | every PM, engineer, and PM-owned agent in the team               |
| `room` (arbitrary)          | `NULL`               | empty until `--members` supplies agents                          |

- Members resolve to real database rows. A token may be a PM name, an engineer
  name, `<pm>/<engineer>`, a PM-owned agent id, `secretary`, `<pm>/secretary`, or
  a full agent id (`<team>:<pm>[:<engineer>]`). Unknown or ambiguous tokens are
  errors; rooms never invent an agent.
- `--members` replaces the default roster, except that a PM room always keeps
  its owning PM. Duplicate room names in one team are rejected.
- The host assigns every event a monotonic `seq` and a non-decreasing `sentAt`.
  The body is trimmed and must be non-empty. `reply_to` must name an earlier
  event in the same room.
- The sender must be a room member. A PM room defaults its sender to the owning
  PM; other rooms require `--sender`.
- `@name` tokens are stored in `mentions_json` as a JSON array. Readers still see
  the original body.
- Read API for the Hub and Studio: `showRoom`, `readRoomEvents` (including
  `afterSeq` incremental reads), `listRooms` with member/event markers, and
  `TeamDb.listRoomsForAgent`. The Team Hub uses these reads; a task pane is not
  shipped in this slice.

## Work queue

A task is a `tasks` row plus an ordered `task_events` log in the same global
database. It survives restart and is independent of rooms: the queue records
who owns the work, while rooms remain the conversation log.

| Status      | Owner                     | Lease    | Transition                                      |
| ----------- | ------------------------- | -------- | ----------------------------------------------- |
| `pending`   | none                      | none     | PM creates/assigns; an eligible engineer claims |
| `claimed`   | one engineer row id       | required | owner renews, releases, or submits              |
| `review`    | the author engineer       | none     | owning PM completes or rejects                  |
| `done`      | author retained for audit | none     | terminal                                        |
| `cancelled` | none                      | none     | terminal                                        |

- Claims use a compare-and-set on `tasks.revision`, so two workers cannot own
  the same task. A claim outside the task's PM is rejected; when
  `assignee_agent_id` is set, only that engineer may claim.
- The default lease is 900 seconds (`--lease`), capped at seven days. An expired
  lease is reclaimable by another engineer of the same PM; a live lease owned by
  someone else is a conflict.
- `zetacode team task submit …` moves `claimed → review`; only the owning PM can
  `complete` or `reject` it. `cancel` is available to the owning PM before
  `done`. Every mutation and its event commit in one SQLite transaction.
- `REQ-*` repository-ledger ids are extracted from task titles/bodies and
  `--req`, stored on the task, and recorded per event. They are metadata; the
  ledger remains authoritative for their content.
- Listing is available through `zetacode team task list` and the Team Hub's
  `TASKS` section (claim `c`, renew `n`, submit `u`, complete `x`, reject
  `X`, cancel `C`). The detailed design, `/initzetateam` dependency order, and
  Vibe worker integration are in
  [document/team-task-queue.md](../document/team-task-queue.md).
- The queue writes no session transcript. IM per-agent binding stays out of
  scope; see `local://im-multi-account-design.md`.

## Bootstrap and runtime

`/initzetateam` and `zetacode team bootstrap` share one service
(`src/team/bootstrap.ts`, `bootstrap-command.ts`):

1. **Plan** validates the ownerless root (not Git, no `AGENTS.md`, no nested
   Git), empty `pms/`/`repos/`/`worktrees/`, name/path/branch collisions, repo
   link/clone targets, and DB registration before any write.
2. **Apply** re-runs preflight immediately before writing, then records every
   step in `team_bootstrap_runs`/`team_bootstrap_steps` and calls the existing
   service. A running step whose service call finished before the journal
   `done` write is adopted on resume by matching persisted rows/markers.
3. **Default resources**: coordination room, one PM room per PM, bindings for
   each repo (or explicit `--bind`), and specified engineers.
4. **Rollback** walks completed steps in reverse and removes only objects the
   run created. It never uses force: a worktree with user changes or a moved
   HEAD, or a clone with extra files, is preserved with the DB row and a
   `rollback_failed` error. Rollback stops at the first failure.
5. **Resume** re-runs preflight for remaining steps, skips `done`, and never
   deletes pre-existing rows/folders. Success ends with `team doctor`.

`--engineer-only` uses the same journal against an existing Team to add one or
more engineers; it does not recreate the root, PMs, repos, or bindings.
`--no-rollback` leaves a failed run resumable; `--rollback <runId>` compensates
explicitly.

### Room delivery and ack

`postRoomEvent` writes the durable event and fans it out to subscribed members
through the existing `IrcBus`/mesh transport; no daemon or polling is added.
`room_subscriptions.accepted_through` advances only for a real session/host
receipt, oldest-first and without skipping a failed seq. `read_through` is the
consumer's explicit ack and never moves with delivery. Offline/failed members
keep their cursor and are drained by `deliverPendingRoomEvents` when their
session starts. `queued` is not treated as accepted because the local mailbox is
in-memory.

### Engineer task worker

`/teamworker on|off|status [normal|vibe]` is valid only in an engineer worktree
session. The mode must match the engineer's recorded `execution`. The loop
claims only while the session is idle, renews the lease, queues a real
follow-up turn, waits for its terminal `agent_end`, then submits for review. It
never completes its own review, never starts Vibe, and never spawns an agent or
daemon. `off` aborts and releases an owned claim; a lost lease aborts execution
and cannot submit or release a new owner's task.

## Commands

```bash
zetacode team init <name> --root <path> [--name <display>]
zetacode team bootstrap [--name <team>] --root <path> [--pm ...] [--repo ...]
  [--bind ...] [--engineer ...] [--room ...] [--engineer-only]
  [--resume <runId>] [--rollback <runId>] [--no-rollback]
zetacode team pm add <pm> [--root <path>]
zetacode team repo add <repo> --clone <url> [--root <path>]
zetacode team repo link <repo> <path> [--root <path>]
zetacode team repo bind <repo> --pm <pm> [--root <path>]
zetacode team engineer add <name> --pm <pm> --repo <repo> [--execution normal|vibe]
zetacode team worktree add <task> --repo <repo> --pm <pm> --engineer <name>
zetacode team room create <name> --pm <pm> [--members <a,b>]
zetacode team room create <name> --shared [--members <a,b>]
zetacode team room list [--root <path>]
zetacode team room show <room> [--limit <n>]
zetacode team room member add <room> --agent <id>
zetacode team room member remove <room> --agent <id>
zetacode team room post <room> --body <text> [--sender <agent>] [--reply-to <seq>]
zetacode team task create <key> --pm <pm> --title <title> [--body <text>] [--assignee <engineer>] [--req REQ-1]
zetacode team task list [--status pending|claimed|review|done|cancelled] [--json]
zetacode team task show <key> [--json]
zetacode team task assign <key> --pm <pm> --assignee <engineer>
zetacode team task claim <key> --agent <engineer> [--lease <seconds>]
zetacode team task renew <key> --agent <engineer> [--lease <seconds>]
zetacode team task release <key> --agent <engineer>
zetacode team task submit <key> --agent <engineer> [--body <text>] [--req REQ-1]
zetacode team task complete <key> --pm <pm> [--body <text>] [--req REQ-1]
zetacode team task reject <key> --pm <pm> --body <reason>
zetacode team task cancel <key> --pm <pm> [--body <text>]
zetacode team task comment <key> --agent <actor> --body <text>
zetacode team doctor [--root <path>] [--json]
```

- `init` creates `<root>/.zeta/team.json` plus `pms/`, `repos/`, and
  `worktrees/`, then registers the team. The team id is a slug of `<name>`.
- `pm add` creates `pms/<pm>/.zeta/pm.json`, `notes/`, and `links/`.
- `repo add` performs a real clone into `repos/<repo>` and records the default
  branch; `repo link` registers an existing repository root without moving it.
  Both refuse a repository that is not on its default branch.
- `repo bind` records the PM↔repo row. Bindings are idempotent only by absence:
  a duplicate binding is an error.
- `engineer add` creates
  `worktrees/<repo>/<pm>/<engineer>/home` on
  `team/<team>/<pm>/<engineer>/integration`. Adding the same engineer for a
  second bound repo reuses the roster row and adds another home worktree.
- `worktree add` creates `worktrees/<repo>/<pm>/<engineer>/<task>` on
  `team/<team>/<pm>/<engineer>/<task>`, branched from the base repository's
  default branch.
- `room create` writes the room and its membership rows. A PM room takes
  `--pm`; `--shared` (or `--kind coordination`) creates a team-wide room with no
  owning PM; any other room is an arbitrary team room. No directory is created.
- `room list` prints kind, owning PM, member count, and the latest sequence.
- `room show` prints members and the newest events (default 50, oldest first).
- `room post` appends one event and prints its host-assigned sequence. `--sender`
  accepts the same tokens as membership; `--reply-to` names an earlier sequence
  in the same room.
- `task create` writes a `pending` task for an owning PM, optionally assigning
  one of that PM's engineers and recording `REQ-*` ids. `task list` and
  `task show` are read-only.
- `task assign/claim/renew/release/submit/complete/reject/cancel/comment` follow
  the status table above. Claim/renew/release/submit take `--agent`; review
  actions take `--pm` and must name the owning PM.
- `doctor` does not repair. It validates the ownerless root, PM markers and
  plain-folder status, base repo paths and branches, database rows and
  bindings, worktree paths/branches/registration, and room integrity: duplicate
  names, PM ownership, member rows that resolve to this team's PMs, engineers,
  or PM-owned agents (including a registered Secretary), the owning PM's
  membership, event senders, and reply links. It also reports unregistered PM
  folders, base repos, or linked worktrees, and validates task assignees,
  owners, leases, and event actors. Warnings do not fail the command; errors
  exit non-zero.

## TUI entry and Team Hub

`zetacode` classifies the launch directory before creating a session:

| cwd                                                  | Opens                            | Notes                                                                                                                                                                                |
| ---------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| exactly the Team root (`.zeta/team.json`)            | **Team Hub**                     | A UI surface, never an Agent. No team-root session, no `AGENTS.md`, no model request.                                                                                                |
| exactly a PM workspace (`.zeta/pm.json`)             | **Team Hub**, focused on that PM | A bare launch opens the Hub (no fake PM agent). An explicit session launch stays in coding; `/lead` (alias `/pm`) then runs the PM main agent — see [Lead (PM) mode](#lead-pm-mode). |
| `repos/<repo>` (including nested dirs)               | normal coding TUI + warning      | The base repository is not an agent cwd and keeps its default branch.                                                                                                                |
| `worktrees/<repo>/<pm>/<engineer>/home` or `/<task>` | normal coding TUI + breadcrumb   | Breadcrumb reads `Team / PM / repo / engineer / worktree`; Vibe stays off unless `/vibe`.                                                                                            |
| any other directory below the Team root              | normal coding TUI + warning      | No sibling guessing; `/team hub` is available.                                                                                                                                       |
| outside every Team                                   | normal coding TUI                | No Team UI or warning.                                                                                                                                                               |

A malformed or unsupported marker never blocks a coding launch: the ordinary
session opens with a warning instead. Explicit launches that already choose work
(`--resume`, `--continue`, `--fork`, `--restore`, `--backend`/`--attach`, a goal,
or a prompt) keep their normal meaning and skip Hub auto-entry. On a bare
interactive launch, `/team hub` opens the Hub from any Team directory; `Esc`
returns to the previous coding session.

`/team hub` also has a plain-text `handle` for headless, ACP and IM dispatchers.
It resolves the same Team entry and renders the same `TeamHubSnapshot` (PMs,
engineers, rooms, selected room events, tasks) without a TUI, model request or
daemon. An empty Team shows the real CLI next steps and never invents rooms,
members or statuses; a missing database row keeps the snapshot warning. Room
membership is changed through `zetacode team room member add/remove`, which use
the existing membership service and its PM-ownership rules.

The Hub reads the global database on open, on `r`, and after a post. It never
creates a session or a transcript and never fabricates agents, rooms, or
statuses:

- Left pane: rooms from `rooms`/`room_events` (`shared`, PM, custom), then PMs
  and engineers from `team_pms`/`engineers`. Rooms show kind, owner, member
  count, the real latest `seq`, and `+N` events that arrived since this Hub
  opened or the room was last viewed. Engineers show the DB `execution` value
  and registered worktree count; the Hub has no running/idle status source and
  therefore shows none.
- Right pane: the selected room's newest 200 events in ascending `seq`, with
  host `sentAt`, resolved sender, and reply target. An empty room says so.
- Selecting an engineer shows the real worktree rows (kind, branch, path).

| Key                               | Behavior                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `j` / `k`                         | Move in the roster, or scroll events when the event pane has focus.                                                     |
| `h` / `l`, `Tab`                  | Switch between roster and events.                                                                                       |
| `Enter`                           | Open the selected room's events, or the selected engineer's worktrees.                                                  |
| `g`                               | Jump to the shared coordination room.                                                                                   |
| `p`                               | Cycle the focused PM's rooms.                                                                                           |
| `s`                               | Compose a room event. `Tab`-cycles a real room member as sender; `Enter` posts through the room service; `Esc` cancels. |
| `m` / `M`                         | Add/remove a room member by token; `M` removes (PM room keeps its owner).                                               |
| `K`                               | Cycle room kind (`room` → `coordination` → `pm` when an owner exists).                                                  |
| `c` / `n` / `u` / `x` / `X` / `C` | On a selected task: claim, renew, submit for review, complete, reject, cancel.                                          |
| `a`                               | Close the Hub and open Agent Hub (subagent control stays there). A standalone Hub says it needs a coding session.       |
| `r`                               | Reload roster and events from the database.                                                                             |
| `/`                               | Filter rooms, people, and events. `Esc` clears the filter first.                                                        |
| `Esc`                             | Return from events to the roster, clear the filter, then close the Hub.                                                 |

Posting is a `room_events` insert only. A shared room needs an explicit member
sender (the composer requires one); a PM room defaults to its owning PM in the
CLI and the composer always names the selected member. No room post becomes
session JSONL.

Team-origin sessions were already grouped by `groupTeamSessions` for the resume
picker; the Hub does not list sessions or duplicate that grouping.

## Resolver

Walking up from any directory finds the nearest `.zeta/team.json` and returns
`{ teamRoot, teamId, teamName, pmId?, pmRoot? }`. A PM workspace supplies
`pmId` through `.zeta/pm.json`; a worktree supplies it from the locked
`worktrees/<repo>/<pm>/<engineer>/…` layout. Outside the team root, a
`.zeta/team-member.json` breadcrumb resolves the team.

## Lead (PM) mode

`/lead` (alias `/pm`) turns the top-level interactive session into the PM for
the workspace it was opened in. It is valid only when the cwd resolves to a
registered PM workspace (`pms/<pm>/` with `.zeta/pm.json`); a worktree, a base
repository, or the team root is refused with an error, and a failed entry
leaves the session's tools untouched. A bare `zetacode` launch at a PM
workspace opens the Team Hub; start a session explicitly (`--continue`,
`--resume`, or with a prompt) to use `/lead`.

- Active tools: `read`, optional parent-owned `todo`, `room_read`, `room_post`,
  `secretary`, `engineer_skills`, and `channel_send` / `board` / `calendar` when
  the session is configured for them. `task`, `edit`, `write`, `bash`, `grep`,
  `glob`, and `vibe_*` are removed while the mode is on.
- `room_read` lists the team's rooms or reads one room's members and newest
  events; `room_post` appends an event as the resolved PM agent. Both call the
  room service above, so membership is validated and no session JSONL is
  written.
- The mode is mutually exclusive with plan/goal/vibe. Exiting restores the
  exact prior toolset and journals `mode_change: none`.
- The mode is journaled as `mode_change: lead` with the prior toolset; a
  reopened session re-enters Lead mode when its cwd still resolves to the PM
  workspace, and otherwise clears back to normal coding. The status line shows
  `Lead`.
- The Lead prompt coordinates engineer main agents through rooms and forbids
  coding, spawning workers, hidden project selection, and invented agents. It
  exists for the PM main agent, not for a Team-root session (there is none).

## Engineer skill assignment

A PM can assign approved skills to its **own** engineer main agents through the
Lead-mode `engineer_skills` tool. Assignments are rows in `agent_skills`; they
reference a discovered skill by name/source and never by filesystem path.

- `engineer_skills list` lists the PM's assignments by engineer;
  `list engineer=<name>` also shows the skills that engineer's discovery
  exposes, with risk and operator-approval state.
- `assign engineer=<name> skill=<name>` and `remove …` accept an engineer name,
  `<pm>/<engineer>`, or the full row id, plus a discovered skill name or
  `<provider>:<name>`. There is no path input, so the tool cannot inject a file
  the engineer could not already discover; hidden/manual-only skills (`hide:
true`) are rejected.
- Ownership is enforced: another PM's engineer is rejected, and a PM name
  (including the caller's) is rejected as “not an engineer”. `assigned_by` is
  the PM row id and `created_at` records the time.
- Authored/official skills are allowed by default. Plugin and registry
  providers (`zeta-plugins`, `claude-plugins`, `agent-plugins`, `skillshare`)
  can ship hooks/tools/plugins, so they are high risk and need an
  operator-approved entry in `team.skillAllowlist` (a bare name,
  `provider:name`, provider id, `provider:*`, `*`, or a glob). The engineer
  session re-checks the allowlist before injecting.
- Injection happens when an engineer main-agent session starts or resumes: the
  assigned skills are injected as hidden autoload prompts (the same mechanic as
  subagent `autoloadSkills`), once per transcript. A live engineer does not
  hot-reload; it must run `/reload-skills` or restart. Removing an assignment
  stops future injections but cannot retract content the running session
  already loaded.
- Discovery for assignment uses the engineer's home worktree (falling back to
  the PM workspace), so a PM sees the skills that engineer's own session would
  discover. Skill files are never copied.

## Secretary (PM-owned persistent subagent)

Lead mode's `secretary` tool is a narrow handle on the PM's one persistent
Secretary: `spawn [prompt]`, `send {message}`, or `list`. It cannot name another
agent, request isolation, or pick a model.

- The Secretary is a real keep-alive task-executor subagent, not a main agent:
  no folder, Git repository, branch, Team-root seat, or external channel. The
  Team database owns it (`agents.pm_id`, `role = secretary`,
  `persistence = persistent`, `parent_agent_id` = PM row id), and its child
  transcript is the resumable `session_file`.
- Agent definition: `read`, `todo`, `calendar`, `board`, and read-only
  `room_read`; no `edit`/`write`/`bash`/`grep`/`glob`/`task`/`vibe_*`/
  `channel_send`. `ownsTodo: true` keeps its own todo list instead of the usual
  parent-owned strip.
- `spawn` is idempotent per PM: an existing Secretary is returned, never
  duplicated. The first turn runs through `runStructuredSubagent` with
  `keepAlive`, then the AgentLifecycleManager owns idle → park → revive. A
  reservation whose first turn died before a transcript existed is re-run on
  the same row instead of being returned as an unusable Secretary.
- `send` continues the same child session through `runSubagentFollowUpTurn`;
  when the live registry ref is gone, the tool re-registers the durable
  `session_file` as parked and lets the lifecycle reviver bring it back.
- A PM room and a coordination room include a registered Secretary in their
  default roster; `secretary` and `<pm>/secretary` also resolve as explicit
  room members. The Secretary has no channel tool, so it cannot message outside
  the Team.

Cross-process cold revival depends on the top-level process installing
`createPersistedSubagentReviverFactory` (the normal CLI startup does). This
slice stores and tests the durable reference, in-process park/revive, and
re-registration from the database; it does not run a second OS process to prove
cold revival.

## Session origin and resume filtering

A session created inside a resolved Team location is stamped with a
`SessionHeader.origin` of `{ kind: "team", teamId, pmId?, engineerId?,
repoId?, roomId?, workspaceAlias? }`. The ids are the team database's
deterministic row ids (`acme`, `acme:core`, `acme:core:alice`, `acme:api`),
so they keep matching the DB; `workspaceAlias` is built from names only
(`core / alice / api / T-101`) and never contains an absolute path.

Resolution happens at creation, synchronously, from the same upward
`.zeta/team.json` walk as the CLI resolver: a PM workspace supplies
`pmId`, the locked worktree layout supplies `pmId` / `engineerId` /
`repoId`, and the global DB, when present, refines the rows and matches
external `repo link` worktrees by path. A malformed marker or an
unreadable DB leaves the session unstamped, which keeps it personal rather
than hiding it. Team transcripts stay in the existing per-cwd JSONL
buckets; nothing is moved, and no room events are written.

The resume-picker/list APIs (`SessionManager.listForPicker`,
`listAllForPicker`, `PickerListingOptions`) take `includeTeam`, default
`false`: the current-folder and all-projects scopes hide Team rows, as
they do IM rows. A Team scope passes `true` and feeds the rows to
`groupTeamSessions` (`src/resume/team-groups.ts`), the Team → PM →
engineer → repo → conversation grouping. An explicit `--resume <id>`
resolves through the unfiltered listing and is not affected by the default
filter. The Team Hub is a separate surface and does not list sessions.

## Studio relationship graph

`team.graph.get` (`packages/coding-agent/src/server/studio-host/ops/team.ts`,
pure projection in `team-projection.ts`, UI in `web-app/src/studio/TeamPage.tsx`)
reads one snapshot of the global Team database plus the live main-agent
registry:

- **Team cluster** — one dashed ownerless boundary per `teams` row. It is a
  container, never an agent node; no Team-root session exists.
- **PM workspace** — a `team_pms` row (`pms/<pm>/`, plain folder), carrying the
  live PM main agent when its cwd matches the workspace path.
- **Git repo** — one `repos` row per canonical base repo; a PM joins through a
  `binding` edge from `repo_bindings`, never a per-PM copy.
- **Engineer** — an `engineers` row with its recorded `vibe`/`normal` mode. A
  live main whose cwd is that engineer's home or task worktree is attached; a
  row with no attached session is `offline`, never a fabricated agent.
- **Linked worktree** — a `worktrees` row (`home`/`<task>`, branch name), with
  `worktree-of` to its base repo and `contains` to its engineer.
- **DB room** — a `rooms` row; `room_members` emits `room` edges from PM,
  engineer and Secretary records.
- **Secretary** — an `agents` row (`role = secretary`, `persistent`) as a
  subagent owned by its PM (`spawn` edge).

An unclaimed live main remains an `agent` node inside its Team boundary (or the
`unassigned` boundary when no team root contains its cwd). The read model
serializes hashed workspace ids and basenames, never filesystem paths. There are
no remaining producer gaps; an empty or missing database is an empty inventory,
not an error.

## Studio Team pane

Work Studio's Team pane is a browser surface over the same database: onboarding
plan/apply/resume/rollback and doctor, PM/repo/engineer setup, the durable task
queue with lease/review actions, room member/kind management, incremental room
events with subscription/ack cursors, and the relationship graph. See
[team-studio.md](./team-studio.md).

## Not in this slice

Automatic Vibe start, IM per-agent binding, and a background daemon remain
unimplemented. The durable queue is usable through `zetacode team task …`, the
Team Hub task pane, and the opt-in `/teamworker` engineer-session loop. No Team
entry starts Vibe or a worker without that explicit command. Lead (PM) mode covers the
PM main agent's coordination surface; the Secretary is reachable only from that
mode, and there is still no Team-root session. The Hub is a UI without an Agent
and shows only rooms and the PM/engineer roster; subagent control remains in
Agent Hub. Rooms are reachable through `room_read`/`room_post` in Lead mode and
through the CLI and Hub. The Engineer `execution` column is the only Team-side
Vibe fact. The `/initzetateam` plan/apply/rollback design and dependency order
are in [document/team-task-queue.md](../document/team-task-queue.md); IM
per-agent binding is designed separately in
`local://im-multi-account-design.md`.
