# Team foundation (paths, database, rooms, and the Team Hub)

`zetacode team` implements the Team path model and its first collaboration
primitive: the ownerless team root, PM workspaces, canonical base repositories,
PM bindings, engineers, linked worktrees, and database-only rooms. The TUI adds
**path entry** and the **Team Hub**: launching at a Team root or PM workspace
opens a read/write view of the Team database, while engineer worktrees and base
repositories open the ordinary coding TUI. Explicit session launches
(`--continue`, `--resume`, `--fork`, or a prompt) still open a coding session in
a PM workspace, where `/lead` (alias `/pm`) runs the **PM main agent** with a
coordination-only toolset. There is still **no team-wide agent, no board/task
rows, and no channel binding**. `--execution vibe` records the engineer's
execution choice; it does not start Vibe, and no Team entry ever enables Vibe
automatically.

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

Schema (`PRAGMA user_version` = 2):

| Table | Columns |
| --- | --- |
| `teams` | `id`, `name`, `root_path`, `created_at` |
| `team_pms` | `id`, `team_id`, `name`, `workspace_path`, `created_at` |
| `repos` | `id`, `team_id`, `name`, `base_path`, `remote_url`, `default_branch`, `created_at` |
| `repo_bindings` | `repo_id`, `pm_id`, `created_at` |
| `engineers` | `id`, `team_id`, `pm_id`, `name`, `execution`, `created_at` |
| `worktrees` | `id`, `team_id`, `repo_id`, `pm_id`, `engineer_id`, `kind`, `name`, `path`, `branch`, `base_branch`, `created_at` |
| `rooms` | `room_id`, `team_id`, `pm_id` (nullable), `name`, `kind`, `created_at` |
| `room_members` | `room_id`, `agent_id`, `role`, `created_at` |
| `room_events` | `seq`, `room_id`, `sent_at`, `sender_agent_id`, `kind`, `body`, `reply_to`, `mentions_json` |

Worktree `kind` is `home` or `task`; engineer `execution` is `normal` or `vibe`.
A repo may be bound to several PMs, and one engineer may own a home worktree per
bound repo. Room `kind` is `pm`, `coordination`, or `room`; rooms are described
below.

## Rooms

A room is **database rows only**: a `rooms` row, its `room_members` rows, and an
append-only `room_events` log. It is never a folder, Git repository, workspace,
or session, so posting never writes a transcript and room events cannot enter
session JSONL.

| Room kind | `pm_id` | Default members |
| --- | --- | --- |
| `pm` | the owning PM row id | that PM and the PM's engineers |
| `coordination` (`--shared`) | `NULL` | every PM and engineer in the team |
| `room` (arbitrary) | `NULL` | empty until `--members` supplies agents |

- Members resolve to real database rows. A token may be a PM name, an engineer
  name, `<pm>/<engineer>`, or a full agent id (`<team>:<pm>[:<engineer>]`).
  Unknown or ambiguous tokens are errors; rooms never invent an agent.
- `--members` replaces the default roster, except that a PM room always keeps
  its owning PM. Duplicate room names in one team are rejected.
- The host assigns every event a monotonic `seq` and a non-decreasing `sentAt`.
  The body is trimmed and must be non-empty. `reply_to` must name an earlier
  event in the same room.
- The sender must be a room member. A PM room defaults its sender to the owning
  PM; other rooms require `--sender`.
- `@name` tokens are stored in `mentions_json` as a JSON array. Readers still see
  the original body.
- Read API for a future TUI/Studio: `showRoom`, `readRoomEvents` (including
  `afterSeq` incremental reads), `listRooms` with member/event markers, and
  `TeamDb.listRoomsForAgent`. No UI is provided yet.

## Commands

```bash
zetacode team init <name> --root <path> [--name <display>]
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
zetacode team room post <room> --body <text> [--sender <agent>] [--reply-to <seq>]
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
- `doctor` does not repair. It validates the ownerless root, PM markers and
  plain-folder status, base repo paths and branches, database rows and
  bindings, worktree paths/branches/registration, and room integrity: duplicate
  names, PM ownership, member rows that resolve to this team's PMs or engineers,
  the owning PM's membership, event senders, and reply links. It also reports
  unregistered PM folders, base repos, or linked worktrees. Warnings do not fail
  the command; errors exit non-zero.

## TUI entry and Team Hub

`zetacode` classifies the launch directory before creating a session:

| cwd | Opens | Notes |
| --- | --- | --- |
| exactly the Team root (`.zeta/team.json`) | **Team Hub** | A UI surface, never an Agent. No team-root session, no `AGENTS.md`, no model request. |
| exactly a PM workspace (`.zeta/pm.json`) | **Team Hub**, focused on that PM | A bare launch opens the Hub (no fake PM agent). An explicit session launch stays in coding; `/lead` (alias `/pm`) then runs the PM main agent — see [Lead (PM) mode](#lead-pm-mode). |
| `repos/<repo>` (including nested dirs) | normal coding TUI + warning | The base repository is not an agent cwd and keeps its default branch. |
| `worktrees/<repo>/<pm>/<engineer>/home` or `/<task>` | normal coding TUI + breadcrumb | Breadcrumb reads `Team / PM / repo / engineer / worktree`; Vibe stays off unless `/vibe`. |
| any other directory below the Team root | normal coding TUI + warning | No sibling guessing; `/team hub` is available. |
| outside every Team | normal coding TUI | No Team UI or warning. |

A malformed or unsupported marker never blocks a coding launch: the ordinary
session opens with a warning instead. Explicit launches that already choose work
(`--resume`, `--continue`, `--fork`, `--restore`, `--backend`/`--attach`, a goal,
or a prompt) keep their normal meaning and skip Hub auto-entry. On a bare
interactive launch, `/team hub` opens the Hub from any Team directory; `Esc`
returns to the previous coding session.

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

| Key | Behavior |
| --- | --- |
| `j` / `k` | Move in the roster, or scroll events when the event pane has focus. |
| `h` / `l`, `Tab` | Switch between roster and events. |
| `Enter` | Open the selected room's events, or the selected engineer's worktrees. |
| `g` | Jump to the shared coordination room. |
| `p` | Cycle the focused PM's rooms. |
| `s` | Compose a room event. `Tab`-cycles a real room member as sender; `Enter` posts through the room service; `Esc` cancels. |
| `a` | Close the Hub and open Agent Hub (subagent control stays there). A standalone Hub says it needs a coding session. |
| `r` | Reload roster and events from the database. |
| `/` | Filter rooms, people, and events. `Esc` clears the filter first. |
| `Esc` | Return from events to the roster, clear the filter, then close the Hub. |

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
  and `channel_send` / `board` / `calendar` when the session is configured for
  them. `task`, `edit`, `write`, `bash`, `grep`, `glob`, and `vibe_*` are
  removed while the mode is on.
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

## Not in this slice

Secretary creation, channel bindings, the team relationship graph, board/task
rows, and Vibe auto-start remain unimplemented. Lead (PM) mode covers the PM
main agent's coordination surface only; there is still no Team-root session,
and the Hub itself is a UI without an Agent. The Hub shows only rooms and the
PM/engineer roster, never a full graph; subagent control remains in Agent Hub.
Rooms are reachable through `room_read`/`room_post` in Lead mode and through
the CLI and Hub. The Engineer `execution` column is the only Team-side Vibe fact,
and no Team entry enables Vibe.
