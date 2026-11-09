# Team foundation (paths and database)

`zetacode team` implements the first vertical slice of the Team path model:
the ownerless team root, PM workspaces, canonical base repositories, PM
bindings, engineers, and linked worktrees. There is **no Team UI, no team-wide
agent, no rooms, no tasks/board rows, and no PM mode** in this slice. `--execution
vibe` records the engineer's execution choice; it does not start Vibe.

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

Schema (`PRAGMA user_version` = 1):

| Table | Columns |
| --- | --- |
| `teams` | `id`, `name`, `root_path`, `created_at` |
| `team_pms` | `id`, `team_id`, `name`, `workspace_path`, `created_at` |
| `repos` | `id`, `team_id`, `name`, `base_path`, `remote_url`, `default_branch`, `created_at` |
| `repo_bindings` | `repo_id`, `pm_id`, `created_at` |
| `engineers` | `id`, `team_id`, `pm_id`, `name`, `execution`, `created_at` |
| `worktrees` | `id`, `team_id`, `repo_id`, `pm_id`, `engineer_id`, `kind`, `name`, `path`, `branch`, `base_branch`, `created_at` |

`kind` is `home` or `task`; `execution` is `normal` or `vibe`. A repo may be
bound to several PMs, and one engineer may own a home worktree per bound repo.

## Commands

```bash
zetacode team init <name> --root <path> [--name <display>]
zetacode team pm add <pm> [--root <path>]
zetacode team repo add <repo> --clone <url> [--root <path>]
zetacode team repo link <repo> <path> [--root <path>]
zetacode team repo bind <repo> --pm <pm> [--root <path>]
zetacode team engineer add <name> --pm <pm> --repo <repo> [--execution normal|vibe]
zetacode team worktree add <task> --repo <repo> --pm <pm> --engineer <name>
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
- `doctor` does not repair. It validates the ownerless root, PM markers and
  plain-folder status, base repo paths and branches, database rows and
  bindings, worktree paths/branches/registration, and reports unregistered PM
  folders, base repos, or linked worktrees. Warnings do not fail the command;
  errors exit non-zero.

## Resolver

Walking up from any directory finds the nearest `.zeta/team.json` and returns
`{ teamRoot, teamId, teamName, pmId?, pmRoot? }`. A PM workspace supplies
`pmId` through `.zeta/pm.json`; a worktree supplies it from the locked
`worktrees/<repo>/<pm>/<engineer>/…` layout. Outside the team root, a
`.zeta/team-member.json` breadcrumb resolves the team.

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
engineer → repo → conversation grouping that the Team Hub's Sessions
panel will reuse. An explicit `--resume <id>` resolves through the
unfiltered listing and is not affected by the default filter. There is no
Team TUI screen in this slice.

## Not in this slice

Team Hub, PM mode, rooms and channel bindings, the team relationship graph,
board/task rows, and Vibe auto-start remain unimplemented. The Engineer
`execution` column is the only Vibe-related fact stored here.
