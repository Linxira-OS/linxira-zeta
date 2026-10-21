# The multi-repository task panel — design

Status: accepted design, implementation not started (the activation gate in §9
ships first). Audience: the implementer of the `task-panel` official plugin and
the workbench page that draws it.

Related documents:

- [`docs/board.md`](../docs/board.md) — the user board (`.zeta/board/`), the
  layer this one does **not** replace.
- [`docs/tools/todo.md`](../docs/tools/todo.md) — the session todo tool.
- [`docs/writing-a-plugin.md`](../docs/writing-a-plugin.md) — the three plugin
  layers; the task panel is layer ② (declarative panels) plus one tool.
- [`document/architecture-layers.md`](./architecture-layers.md) — why a
  declarative panel is rendered by the native host, not by a webview or HTTP.

Every open question from the roadmap entry (2026-10-19, "任务面板 = 官方插件")
is closed below with a choice. Nothing in this document is "to be decided".

## 1. The problem, in one paragraph

The workbench needs one place where a user and several agents can see the work
that spans **more than one repository** — what is pending, what is claimed, what
is blocked, what is done — without pretending that the user's personal board is
a multi-agent queue and without losing tasks when a session ends. The task panel
is that place. It is an official plugin: a tool the model can call, plus
declarative panels the workbench draws natively.

## 2. Three layers that stay three layers

| Layer | Owner | Lifetime | Where | Purpose |
| --- | --- | --- | --- | --- |
| User board (双看板·用户层) | the user | permanent, across sessions | `<project>/.zeta/board/*.md` | personal cards, handoff to an agent |
| Session todo | the agent | one session | `todo` tool / session state | the plan of the work in progress |
| **Task panel** | user + agents | permanent, across repos | `<repo>/.zeta/tasks/*.md` + `<workspace>/.zeta/tasks/panel.json` | **cross-repository orchestration** |

The three models are **not merged** and no automatic synchronisation connects
them. The reasons are in §7.

## 3. Decisions

| # | Question | Decision |
| --- | --- | --- |
| D1 | Tool surface | **One** tool, `task`, with a top-level `op` discriminator. Not a `task_*` family. |
| D2 | Canonical data | One markdown file per task under `<repo>/.zeta/tasks/`. No registry file is canonical. |
| D3 | Multi-repo binding | `<workspace>/.zeta/tasks/panel.json` (versioned schema, committed). `~/.zeta/projects.json` is only a one-shot import source. |
| D4 | Invalidation on move | Resolve on every call; an unresolvable binding is `unresolved` (tasks omitted, list still succeeds). Identity mismatch is detected via the captured git identity and makes the binding **read-only**. Repointing is a user action and keeps refs stable. |
| D5 | Relation to board / todo | Separate layers; explicit promotion, never automatic mirroring. |
| D6 | "Disabled by the user" | Plugin-level disable is sticky and is never overridden by auto-activation. Hiding the panel is UI-only and leaves the tool available. Neither deletes task files. |
| D7 | Workbench gate | Declarative panels exist only when the agent process runs inside a workbench terminal; `PI_FORCE_PLUGIN_PANELS` is the debug override. Hides the **surface**, not the capability. |
| D8 | Auto-activation | Only when the workbench opens the task page, the plugin has **no runtime entry at all**, and it is not project-disabled. Install + enable once, then record the normal runtime state. |
| D9 | v1 scope | Files, one tool, list/form/chart panels, add/remove/repoint bindings in the page. No sync, no DB, no cross-repo move, no nested bindings, no TUI surface. |

## 4. Tool surface: one tool, `op` discriminator

### 4.1 Shape

The model sees exactly one new tool:

```ts
task({
  op: "list" | "get" | "create" | "update" | "move" | "rm" | "repos",
  ...
})
```

This mirrors the existing `todo` tool, which also keeps the discriminator and
its fields at the top level (no `ops` array wrapper, no `task_*` family). One
schema means one prompt, one renderer, one permission story, and one place to
explain refs. A tool family would add four or five names to the tool list, and
`task_create`/`task_update` would still share every rule below.

`list`, `get` and `repos` are read-only: they never write a file, never renew a
lease, never normalise a name.

### 4.2 References

A task's global reference is `"<repo>/<id>"`:

- `<repo>` is the **binding id** from `panel.json` (lowercase
  `[a-z0-9][a-z0-9-]*`), never a path.
- `<id>` is the task's file stem, validated like a board card id.

Example: `core/auth-crash`. Refs are stable across a repoint (§6) because the
binding id is stable, and across a rename because the id is the file stem.

### 4.3 Operations

| `op` | Required | Optional | Effect | `details` |
| --- | --- | --- | --- | --- |
| `list` | — | `repo`, `status`, `assignee`, `tag`, `due`, `limit`, `format` | Read the aggregate | `{ revision, repos, tasks, diagnostics }` (see 4.4) |
| `get` | `ref` | — | Read one task | `{ task }` |
| `create` | `repo`, `title` | `id`, `status`, `assignee`, `tags`, `due`, `body` | Create `<repo>/.zeta/tasks/<id>.md` | `{ task }` |
| `update` | `ref` | `title`, `assignee`, `tags`, `due`, `body` | Rewrite the named fields, preserve unknown ones | `{ task }` |
| `move` | `ref`, `status` | `blockedReason` | Change status (the only status path) | `{ task }` |
| `rm` | `ref` | — | Delete one task file | `{ removed: ref }` |
| `repos` | — | `format` | Binding health, read-only | `{ repos, diagnostics }`; `format: "fields"` returns `{ fields }` |

Rules:

- `status` is `todo | doing | blocked | done`; default `todo`. `update` rejects
  a `status` field with `use op:"move" for status`; `move` rejects every other
  field. One mutation path per field prevents two ways to say the same thing.
- Entering `blocked` requires `blockedReason`; leaving `blocked` clears it.
- `assignee` is a single-line string, 1–64 chars of `[A-Za-z0-9._:@-]`. The
  reserved values are `user` (default) and `agent` (any agent). Any other value
  names a team member; the panel does not validate it against a roster.
- `create` without `repo` is allowed only when `panel.json` has exactly one
  binding or a `defaultRepo`; otherwise it fails with `repo-required`.
- `create` derives the id from the title when omitted, with the board's rules:
  ASCII letters/digits/`.`/`_`/`-`, non-ASCII-only titles get a stable hash id,
  collisions de-duplicate with `-2`, `-3`, …
- `rm` is single-ref only. There is no bulk or multi-repo delete.
- Bindings are **not** mutable through this tool: there is no `bind`/`unbind`
  op. Which repositories a panel covers is a user decision; §6 defines the
  page actions.

### 4.4 `list` details and the panel formats

Default `format: "records"`:

```ts
{
  revision: string,          // stable digest over (ref, mtimeMs, size) of every task read
  repos: Array<{ id, name, path, status, identity, reason? }>,
  tasks: TaskRecord[],
  diagnostics: Array<{ repo, code, message }>
}
```

`TaskRecord`:

```ts
{
  ref, id, repo, path,
  title, status, assignee, tags: string[], due: string | null,
  created: string, updated: string,
  blockedReason: string | null,
  body: string
}
```

`format: "rows"` returns `{ rows: Array<Record<string, string>> }` with the
columns `ref`, `title`, `status`, `assignee`, `due` — the shape a declarative
`list` panel consumes. `format: "chart"` returns
`{ points: [{ label: status, value: count }] }` in status order
`todo, doing, blocked, done`. `repos` takes `format: "fields"` and returns
`{ fields: [{ key, label, value }] }` — one field per binding, carrying its
status and path, the shape a declarative `form` panel consumes. `format` is how
the panel's static `source.args` selects a view while the tool surface stays
one tool.

`revision` exists for the panel cache, not for correctness: the panel may reuse
a rendered answer while the revision is unchanged, but every tool call still
re-reads the files.

Ordering is deterministic everywhere: bindings in `panel.json` order, then
status order (`todo`, `doing`, `blocked`, `done`), then `due` (absent last),
then `ref`. Filters never reorder.

### 4.5 Outputs and errors

The tool follows `todo`'s result convention: one text `content` part plus typed
`details`. A failure sets `isError` and prefixes the summary with the failing
ref or repo. Errors are named and actionable:

- `repo-required` — several bindings, no `repo` given.
- `repo-unresolved` — binding path missing; create/update/move/rm refuse.
- `repo-readonly-identity` — the path now holds a different repository (§6.3).
- `task-not-found`, `task-id-invalid`, `task-exists`, `task-too-large`.
- `binding-duplicate-path` — two bindings resolve to one directory (§5.3).
- `format-invalid` — an unknown `format`.

A partial read never fails the call: one unreadable repo produces a
`diagnostics` entry and the other repos' tasks are still returned.

### 4.6 Concurrency and writes

- Writes are atomic: sibling temp file + rename, like the board's writer.
- One advisory lock file per repo directory (`.zeta/tasks/.lock`) serialises
  `create`/`update`/`move`/`rm` between concurrent sessions; a lock older than
  five minutes is broken with a diagnostic, never silently waited on forever.
- A write sets `updated` on the task and leaves every other task untouched.
- The tool never rewrites a file it did not decide to change; reading does not
  normalise front matter.

## 5. Where the data lives

### 5.1 Task files (canonical)

One task is one file: `<repo>/.zeta/tasks/<id>.md`.

```markdown
---
title: Fix the parser
status: doing
assignee: agent
tags: [parser, rust]
due: 2026-11-01
created: 2026-10-21T09:30:00Z
updated: 2026-10-21T10:02:11Z
---

The brief an agent receives from `task get`.
```

Rules:

- The file opens and closes its front matter with a line containing only `---`.
- `title` is required (non-empty, folded to one line).
- `status` defaults to `todo`; unknown values are a parse diagnostic and the
  file is skipped, never rewritten.
- `created`/`updated` are ISO-8601 UTC instants written by the tool; a hand
  edit may set them and the next write updates `updated` only.
- `tags` accepts `[a, b]` or `a, b`.
- `due` is `YYYY-MM-DD`; empty or absent means none.
- Unknown front-matter keys are preserved verbatim on rewrite, in their
  original relative order after the known keys.
- Everything after the closing `---` is the body, returned by `get`.
- Files over 512 KiB, non-`.md` files, dotfiles and entries with invalid ids
  are skipped with a diagnostic; they never hide the rest of the repo.
- Symlinks are not followed. A symlinked `.md` entry is reported
  (`not-a-regular-file`) and skipped, so a task cannot point outside its repo.
- Writes are confined to `<repo>/.zeta/tasks/<valid-id>.md`; ids cannot contain
  a path separator, so a ref cannot escape.

### 5.2 Binding file (panel configuration)

`<workspace>/.zeta/tasks/panel.json` — a workspace is the directory the panel is
opened in (the cwd of the session/tool call).

```json
{
  "version": 1,
  "defaultRepo": "core",
  "repos": [
    {
      "id": "core",
      "name": "zeta",
      "path": ".",
      "addedAt": "2026-10-21T09:00:00Z"
    },
    {
      "id": "sdk",
      "name": "zeta sdk",
      "path": "../zeta-sdk",
      "identity": { "gitRootCommit": "…", "gitRemote": "github.com/Linxira-OS/zeta-sdk" },
      "addedAt": "2026-10-21T09:01:00Z"
    }
  ]
}
```

- `version` must be `1`; an unknown version is an error naming the file, and the
  tool refuses to write (reads return `diagnostics`, no tasks from this panel).
- `path` is relative to the workspace directory whenever possible; an absolute
  path is accepted for a repo that is not a descendant. It is canonicalised
  with `realpath` when the binding is added and on every read.
- `id` is generated once from `name` (`[a-z0-9][a-z0-9-]*`) and is immutable.
  Refs depend on it.
- `identity` is captured at bind time when the repo is a git work tree. It is
  advisory metadata for §6.3, not a key.
- `repos: []` is valid: the panel shows an empty state and the tool's `list`
  returns no tasks. There is **no runtime auto-seed** from
  `~/.zeta/projects.json`.
- The panel page may offer a one-time "import registered projects" action; the
  resulting entries are written to `panel.json` like manual ones. Import is a
  user action and never runs on every open.

### 5.3 Why files, not a registry

- **Reviewable.** A task change is a diff in the repository it belongs to; a
  `git log` on `.zeta/tasks/` is the task history.
- **Portable.** The tasks move with the repo. A registry keyed by absolute path
  loses every task the first time a repo is renamed or cloned elsewhere.
- **No single write hotspot.** Two agents working in two repos write two
  directories. A central `tasks.yml` would serialise every agent through one
  file and one merge conflict.
- **Works without the panel.** A user can edit a task in any editor, and a
  session in that repo can read it without the workbench running.
- **Why not the board directory.** The board is the *user's* layer with its own
  Rust parser/writer shared by GUI, TUI, IDE and gateway. Reusing
  `.zeta/board/` would either force the task panel into the board's three-column
  user model or create a second writer for the same files. Tasks get their own
  directory and their own single writer (the plugin's tool).

### 5.4 Why the binding file is not `~/.zeta/projects.json`

`projects.json` is machine-global UI state: rows are created by opening a
folder in this workbench, its ids differ per machine, and removing a row is a
pure UI action. A committed `panel.json` means a team shares which repositories
one panel aggregates; a machine-local registry cannot express that. The
registry stays an import source and a suggestion source for "repoint".

## 6. Multi-repository binding and invalidation

### 6.1 Binding a repository

User actions in the panel page (not tool ops):

- **Add repository** — folder picker or a path; canonicalise; reject a
  duplicate canonical path (`binding-duplicate-path`); derive the id; capture
  git identity; write `panel.json` atomically.
- **Remove repository** — deletes the binding row only. Task files are never
  touched. Refs from that repo disappear from the panel, not from disk.
- **Repoint repository** — replaces `path` (and refreshes identity) while
  keeping the id. Refs stay valid; the next read resolves the new directory.
- **Set default** — writes `defaultRepo`; does not change any task.

### 6.2 Resolution on every read

There is no watcher and no cached binding. For each `list`/`get`/`repos` call:

1. Read and validate `panel.json`.
2. For each entry, resolve `path` against the workspace and `realpath` it.
3. Status is one of:
   - `ok` — directory exists.
   - `unresolved` — path missing; reason `missing`.
   - `invalid` — path exists but is not a directory; reason `not-a-directory`.
   - `duplicate` — another binding already resolved to this canonical path;
     the later binding in file order is skipped.
   - `readonly` — identity mismatch (§6.3).
4. Read each `ok` repo's `.zeta/tasks/` independently. A missing task directory
   is an empty repo, not an error (it is created on first `create`).

`list` returns every repo with its status and the tasks of the readable ones.
An `unresolved` binding never fails the call and is never deleted automatically.

### 6.3 When a repository moves, is renamed, or is replaced

- **Renamed** (same directory, new name): nothing changes. Paths resolve, refs
  hold; the display name is the binding's `name`, not the folder name.
- **Moved within the machine**: the stored path no longer exists → `unresolved`;
  tasks are omitted with a diagnostic. The page shows the binding with the
  stale path and a **Repoint** button. After repointing, the same refs return
  the same tasks because refs key on the immutable binding id.
- **Moved and the old path now holds a different repository**: if the binding
  has a captured `identity` and the resolved directory's identity differs
  (different git root commit, or a different normalised remote), status becomes
  `readonly` with reason `identity-mismatch`. Tasks remain visible (read-only)
  so the user can see what was there, and every mutation fails with
  `repo-readonly-identity`. The page offers **Repoint** (accept the new
  directory), **Restore path**, or **Remove binding**. The tool never
  auto-accepts.
- **Suggested repoint**: the page may scan `~/.zeta/projects.json` for a row
  whose basename or git remote matches the binding and offer it as a one-click
  suggestion. The tool never performs this; it is a UI affordance.
- **Clone on another machine**: `panel.json` is committed, so the clone has the
  same ids. A relative path that no longer resolves is `unresolved` until the
  user repoints. Task files came with the repos, so no task data is lost.
- **No identity available** (a non-git repo): replacement cannot be detected;
  path resolution alone decides. The page warns once when binding a non-git
  repo, and `identity` is omitted.

### 6.4 Nested panels

A bound repository that itself contains `.zeta/tasks/panel.json` is **not**
expanded in v1. Bindings are flat; no transitive aggregation. This keeps one
list per panel and makes the cycle question disappear.

## 7. Relationship to the user board and session todos

### 7.1 Board

- The board stays the user's long-term personal layer, unchanged in every
  surface (GUI, TUI, IDE, gateway).
- A board card is **not** a task and is never read by the task tool.
- **Promotion** (future, explicit): the card page may offer "Create task from
  card", which copies title/tags/due/body into a chosen repo. The two records
  then evolve independently; there is no live link and no sync.
- `handoff` keeps starting a session from a card's brief. The task panel adds no
  session-starting path in v1.

### 7.2 Session todo

- `todo` remains the agent's per-session plan, persisted in the session, and is
  the correct place for steps that only matter to one turn of work.
- Working a task is a two-step convention, not a sync:
  1. `task get <ref>` → `todo init` with the local plan.
  2. `task move <ref> doing` (optionally `assignee`), and `done` at the end.
- Neither direction is automatic. Completing all todos does not move a task;
  moving a task does not edit a session's todo list. An agent that omits the
  convention is not blocked, only less visible.
- Nothing from a session todo is ever written to `.zeta/tasks/` implicitly, and
  task bodies are never copied into session state.

### 7.3 Why no merge

The three layers answer different questions (what the user wants, what this
session is doing, what the team across repos must coordinate) and have
different lifetimes and writers. A merged model would force one lock, one file
format, and one owner on all three; the board's existing Rust writer and the
session's in-memory state would both have to change, for no user-visible gain.

## 8. "Disabled by the user"

Four distinct switches; each one has a different meaning:

| Switch | Where | Effect | Survives what |
| --- | --- | --- | --- |
| Workbench gate | process env (`ZETA_WORKBENCH` / `TERM_PROGRAM=zetawork`) | declarative panels inactive outside the workbench (§9) | not a user setting; `PI_FORCE_PLUGIN_PANELS=1` overrides |
| Plugin disabled | `zeta-plugins.lock.json` `enabled: false`, or project `plugin-overrides.json` | plugin does not load: no `task` tool, no panels | **sticky**; auto-activation never clears it |
| Panel hidden | workbench UI state (machine-local) | the page does not draw the panel | tool and files unaffected |
| No bindings | `panel.json` `repos: []` | panel shows its empty state; tool lists nothing | user adds a repo |

**Auto-activation is bounded by the second switch.** The workbench may install
and enable the official `task-panel` plugin on first open **only when there is
no runtime entry at all** for it (never installed, never toggled) and the project
does not disable it. A runtime entry with `enabled: false` is a user decision:
the page shows "disabled by the user" and an explicit Enable button, and no
automatic path may flip it. Removing the plugin is likewise respected: the page
offers Install, it does not install silently after a user uninstalled it (the
runtime entry or an explicit preference records the removal).

Disabling never deletes task files, removes bindings, or hides tasks from other
panels. Re-enabling presents the same data.

## 9. The workbench activation gate (implemented first)

Declarative panels are visible only when the **agent process** detects it runs
inside a Zeta workbench terminal. The predicate lives in
`packages/coding-agent/src/extensibility/plugins/activation.ts`:

1. `PI_FORCE_PLUGIN_PANELS` truthy → active (`reason: "forced"`). Debug switch,
   honoured outside a workbench and in tests.
2. `ZETA_WORKBENCH=1` (a pane spawned by `termide`) **or**
   `TERM_PROGRAM=zetawork` (a pane attached to `zetacode serve`, whose gateway
   stamps the identity) → active (`reason: "workbench"`). `detectTerminalId` is
   case-insensitive.
3. Otherwise inactive (`reason: "outside-workbench"`).

Enforcement points, all in the agent process:

- `readPanelDeclaration()` returns `{ ok: true, ui: {} }` when inactive, so a
  host reads the plugin as declaring no panels.
- `readPanelData()` (what `zetacode plugins panel` runs) fails with a named
  message that includes the force switch; it never runs a data tool for a
  surface no host can draw.
- `getEnabledPlugins()` drops `manifest.ui` (without a warning: the plugin is
  not broken, it has no host) and includes the gate in its cache key.
- The workbench GUI stamps `ZETA_WORKBENCH=1` on every `zetacode` child it
  spawns (`main/crates/zetawork-gui/src/zetacode.rs`). The GUI may itself have
  been launched from an ordinary shell, and a child inherits that environment;
  without the stamp its own panel-data call would be refused as "outside the
  workbench". The panel host is inside by construction.

What stays available outside the workbench: the plugin itself, its tools, hooks
and commands. The gate hides the **surface**, not the capability. Consequently
a plain terminal with the task-panel plugin installed can still call the `task`
tool and edit the same files; only the declarative panels are invisible. That is
intentional: hiding a UI is not a reason to take a capability away, and the
files remain the truth.

## 10. Acceptance scenarios

Each scenario is observable through the tool JSON, the files on disk, or the
workbench page. Tests are named after the scenario.

### Gate

1. **Inside a local pane.** `ZETA_WORKBENCH=1` → the example plugin's four
   panels are declared, and `plugins panel example-panel tasks --json` returns
   data.
2. **Inside a serve-attached pane.** `TERM_PROGRAM=zetawork` (no
   `ZETA_WORKBENCH`) → same as 1.
3. **Plain terminal.** Neither marker → the declaration is `{ ui: {} }`, the
   CLI fails with `PI_FORCE_PLUGIN_PANELS=1` in the message, and the plugin's
   tools/commands still load.
4. **Force-on.** Plain terminal + `PI_FORCE_PLUGIN_PANELS=1` → panels and data
   are visible. `PI_FORCE_PLUGIN_PANELS=0` does not force anything.
5. **Invalid manifest outside the workbench.** A malformed `ui` block is not
   reported as an error outside the workbench (it is not read); inside, it is
   dropped with the existing named warning.

### Data and tool

6. **Create/list round trip.** `task create` in repo A writes exactly one file
   under `A/.zeta/tasks/`; `task list` returns it with the requested fields and
   `body`; the file's front matter matches §5.1.
7. **Two repos.** A panel with bindings `core` and `sdk` lists both repos'
   tasks, with refs `core/…` and `sdk/…`, in the documented order.
8. **Partial failure.** One binding is unreadable → `list` succeeds, returns the
   other repo's tasks, and names the failing repo in `diagnostics`.
9. **Update preserves unknown keys.** A hand-added front-matter key survives
   `task update` and `task move`.
10. **Move is the only status path.** `task update {ref, status}` fails with
    `use op:"move" for status`; `task move` changes it and touches nothing else.
11. **Block invariant.** `move` to `blocked` without `blockedReason` fails;
    leaving `blocked` clears the reason.
12. **Ref validation.** `../escape`, an empty id, an id with `/`, and a symlink
    target are all rejected/skipped without touching anything outside the repo.
13. **Panel formats.** `list {format:"rows"}` returns the five declared columns;
    `{format:"chart"}` returns four status points; `records` remains the default.

### Binding and invalidation

14. **Move + repoint.** Bind repo at path P, create tasks, move the directory to
    Q, `list` reports the binding `unresolved` and omits its tasks; repoint to Q
    (`id` unchanged) and the same refs return the same tasks.
15. **Replacement.** Move repo away and clone a different repo at P with a
    different git identity → binding `readonly`, tasks still readable, every
    mutation fails `repo-readonly-identity`; repointing to the original
    directory restores writes.
16. **Rename only.** Rename the repo directory and repoint (or bind a new
    relative path); ids and refs do not change.
17. **Duplicate path.** Adding a second binding to the same canonical directory
    is rejected; a hand-edited duplicate is reported and the later entry is
    skipped.
18. **No auto-seed.** With an empty binding list and a populated
    `~/.zeta/projects.json`, `list` returns no repos until the user imports/binds.

### Disable semantics

19. **Sticky disable.** Disable the plugin, open the task page → no auto-enable;
    the page reports the disabled state; the tool is absent.
20. **Hide ≠ disable.** Hide the panel in the workbench → no panel drawn, but
    the `task` tool still works and the files are unchanged.
21. **Remove binding preserves data.** Removing a binding leaves every task file
    on disk; re-adding the same directory returns the same refs.

### Layer separation

22. **Todo independence.** Complete every session todo → no task changes.
    Move a task to `done` → the session todo list is unchanged.
23. **Board independence.** Editing a board card changes no task; editing a task
    changes no board card. `handoff` still starts from the board only.

## 11. Implementation plan (for a fresh implementer)

1. **Gate** (this change): `activation.ts`, the three enforcement points, the
   activation tests, and the docs row for `PI_FORCE_PLUGIN_PANELS`.
2. **Plugin package** `plugins/official/task-panel/`:
   - `package.json` with the `zeta` manifest (`extensions: ["./index.ts"]`,
     locales).
   - `plugin.json` id `task-panel` with three panels:
     `tasks` (`list`, `source: {tool:"task", args:{op:"list", format:"rows"}}`,
     columns `ref,title,status,assignee,due`), `repos` (`form`,
     `{op:"repos", format:"fields"}`), `by-status` (`chart`,
     `{op:"list", format:"chart"}`).
   - `index.ts` registering the `task` tool with the §4 schema; it must work in
     the headless panel context (no session, no model turn) because the panel
     data path uses it.
   - A model-facing prompt modelled on `prompts/tools/todo.md`, stating when
     `task` is appropriate versus `todo` and the board.
   - `locales/en.json`, `locales/zh.json`.
3. **File layer** (inside the plugin): parser/writer for §5.1 with preserved
   unknown keys, atomic write, per-repo lock, containment checks.
4. **Binding layer**: `panel.json` read/validate/resolve; `repos` op; explicit
   `unresolved`/`invalid`/`duplicate`/`readonly` statuses.
5. **Workbench page**: a 任务 tab that draws the plugin's panels through the
   existing declarative-panel path, plus the binding actions of §6.1 and the
   disable/install states of §8. No new TUI surface.
6. **Tests**: the 23 scenarios above where they are unit-testable, plus the
   gate tests. File round-trip, ordering, containment, invalidation, and the
   panel-format adapters are all testable without the GUI.
7. **Docs**: a `docs/task-panel.md` user page (files, refs, op table, disable
   semantics) and cross-links from `docs/board.md` and `docs/tools/todo.md`.

## 12. Out of scope for v1

- A TUI page for tasks (product rule: TUI surfaces get no new features).
- A second web-ui implementation; the panel is native, and HTML is not used.
- A database, daemon, background watcher, or cross-machine sync.
- Moving a task file between repositories.
- Nested bindings.
- GitHub/Gitea issue import or export.
- Automatic promotion between the board, tasks, and session todos.
