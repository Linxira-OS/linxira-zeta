# Agent modes, workspaces, and IM routing

Zeta runs three agent modes on one runtime. They differ in what an agent owns,
not in how a turn executes:

| Mode | Starting point | Owns |
| --- | --- | --- |
| **Coding Agent** | A project directory (the session cwd) | That project's code, tools, and project state |
| **Personal Harness** | The kept default workspace | The person's conversations; a project only when explicitly bound |
| **Lead mode** (PM) | A manually bound Team PM workspace | That project's task/board/calendar and the Team around it |

A mode is a product role, not a separate engine. A session, a workspace, a
chat binding, and a relay are distinct concepts inside all three; this page
defines them so they are not used interchangeably.

> Status labels on this page: **IMPLEMENTED** means the behavior ships in
> `zetacode` / Work Studio today. **PARTIAL** means some pieces ship and the
> missing ones are named. **PLANNED** means no shipped behavior yet — the text
> describes the target only, never current behavior.

## Naming glossary

- **Zeta Team** — the product surface: Team paths, the Team database, rooms, and the Team Hub.
- **Team mode** — coordination inside a Zeta Team (PM/engineer roles and rooms), distinct from Vibe mode.
- **Team Hub** — the database-backed UI opened by `/team hub` or a Team-root launch; never an agent.
- **Lead mode** — the PM main agent's mode in a Team PM workspace (`/lead`, alias `/pm`).
- **Vibe mode** — director mode over persistent worker sessions (`/vibe`).
- **Super Agent** — Vibe mode's director metaphor only; never a Team role or product.
- **TIM** — the Tencent IM channel adapter; never a Team product. "Super Team" is not a product name.

## Status at a glance

| Area | Status | What exists now |
| --- | --- | --- |
| Coding Agent | **IMPLEMENTED** | Project cwd, normal coding prompt, existing tools and session behavior |
| Personal Harness | **PARTIAL** | Kept default workspace, `PERSONA.md`, project-scoped memory, relay + bot sessions, IM hosting; first-class multiple personal main agents and persisted chat → agent bindings are incomplete |
| Lead mode (PM) | **PARTIAL** | `/lead` (alias `/pm`) runs the PM main agent in a registered Team PM workspace with rooms, board, calendar, the Team Hub, and one PM-owned persistent Secretary; channel bindings and the full Team graph do not ship |
| Workspace, main agent, relay | **IMPLEMENTED** | Workspace container, top-level sessions, `agent://` messaging, relay fallback |
| External binding | **PARTIAL** | Runtime chat → agent (`@agent use`) and persisted chat → workspace/bot-session bindings ship; persisted chat → `agentId` is planned |
| Session origin | **IMPLEMENTED** | Optional `origin` header (`im` + channel/chat/bot session/agent/binding/workspace alias); absent means `local`; legacy `relay` / `bot` / `draft` tags remain the fallback |
| IM visibility in local lists | **IMPLEMENTED** (local surfaces) / **PLANNED** (binding-scoped mobile) | Work Studio, History, the resume picker, and `history.list` hide IM conversations by default behind an explicit IM / Bot filter; alias labels replace absolute cwds. A mobile client scoped to one binding is planned |
| Context rotation | **PARTIAL** | JSONL is not size-capped; compaction and `/handoff` summarize in place; `/rotate` plus archive-and-link is planned |
| Board and calendar tools | **IMPLEMENTED** | Both are built-in and project-scoped; subagents receive them only by explicit profile opt-in. No Work Studio calendar page |

## 1. The three modes

### Coding Agent — IMPLEMENTED

The Coding Agent is the existing repository-bound behavior.

- It starts in a project directory: `zetacode` launched in a repository, an
  attached session whose workspace is that repository, or a gateway session
  created with that project as `cwd`.
- The session cwd is the project root. File tools resolve there, git actions
  apply to it, and the coding prompt is the normal one.
- It owns the project it runs in: code, tests, and the project-scoped `board`
  and `calendar` stores.
- Nothing has to be registered for it, and no mode switch is required. A
  project is selected by cwd, not by a chat binding.

### Personal Harness — PARTIAL

The Personal Harness is for a person rather than a repository.

- The default workspace is kept. `~/.zeta/workspace` (or
  `ZETA_DEFAULT_WORKSPACE`) is the landing point for conversations with no
  project; it is a real Git-backed directory with `AGENTS.md`, `PERSONA.md`,
  and project-scoped memory. See [default-workspace.md](./default-workspace.md).
- It does not own a project. A session stays in the default workspace unless
  it is explicitly bound to a repository; a bound session then runs with that
  repository's cwd and lives under its session directory.
- It is the personal/chatbox surface: broad tools, notes, quick tasks, and
  optional computer control through the `computer` Eval prelude
  (`computer.enabled`, off by default; see [computer-use.md](./computer-use.md)).
- It is designed to host several main agents at once. Each main agent has its
  own session, transcript, and mailbox, and may be reached through a different
  external chat. The relay plus bot sessions already coexist this way in the
  default workspace; first-class names, aliases, and persisted chat → agent
  bindings for several personal main agents are not complete.
- Remote IM channels bind to an agent (through its workspace or bot session);
  channels are not a property of the default workspace.

**Missing today:** a persisted channel+chat → individual main-agent binding,
and one uniform personal-surface presentation for several personal agents.
Those are the remaining PARTIAL pieces; do not describe a Personal Harness as
owning a repository unless it was explicitly bound.

### Lead (PM) mode — PARTIAL

Lead mode runs the PM main agent for a Team PM workspace. It ships the PM's
coordination surface and its PM-owned persistent Secretary; the Team Hub is a
separate shipped UI over the Team database.

What exists now:

- Open a session in `pms/<pm>/` (with `.zeta/pm.json` and a database row) and
  run `/lead` (alias `/pm`). The mode requires that PM workspace and refuses a
  worktree, base repository, or unrelated cwd.
- The Lead toolset is `read`, optional `todo`, `room_read`, `room_post`, and
  `channel_send` / `board` / `calendar` when configured. `edit`, `write`,
  `bash`, `grep`, `glob`, `task`, and `vibe_*` are removed, so the PM cannot
  code.
- The PM dispatches to engineer main agents through database-only Team rooms.
  `room_post` posts as the resolved PM id and validates membership; it never
  writes session JSONL. `room_read` lists rooms and reads members/events.
- The `secretary` tool spawns, messages, or lists one PM-owned persistent
  subagent. It is a real keep-alive task-executor child with `read`, `todo`,
  `calendar`, `board`, and `room_read`; it has no folder, repository, branch, or
  channel, and duplicated spawns return the existing Secretary. The durable
  reference lives in the Team database `agents` table with the child transcript
  as its session file.
- The operator binds the project manually; the prompt forbids hidden project
  selection and invented agents.
- A bot session bound to a project at creation is still a project-bound
  conversation, not Team mode.

Missing: persisted chat → `agentId` bindings, a board/task row model, and the
full Team graph. Cross-process Secretary revival relies on the normal CLI's
persisted-subagent reviver; same-process park/revive and durable lookup ship.

## 2. Concepts

### Workspace — the container

A **workspace** is a directory registered with Zeta. It is the container that
sessions and agents belong to, and it is the addressable unit on the mesh.

- Identity: `sha1(realpath(workspaceRoot))[:12]`. A workspace alias (from
  `web.yml` `workspaces`, or advertised by a live process) and its directory
  basename are display/addressing aids, not identity.
- A workspace owns the sessions whose cwd is inside its root; the deepest
  matching root wins when workspaces nest.
- A workspace is not a session, not a chat, and not a project record. One
  workspace can host many sessions and several main agents.

### Main agent — the top-level owner

A **main agent** is the top-level agent of a session. It is the agent the user
talks to, and it owns:

- its session and transcript;
- its mailbox (the same per-agent inbox used by `agent://<id>` and the mesh);
- its active tools and mode.

Several top-level sessions may exist in one process or workspace; each
additional one owns a distinct agent id (its session id) instead of displacing
the first. `agent://main` (any case) addresses the caller's workspace main; a
caller that is itself that main receives a self-send error.

A main agent is not a subagent and not a channel bot account. The relay and
each bot session are main agents in this sense.

### Subagent

A **subagent** is a child agent spawned by `task`, Vibe, or an eval
`agent()`/`workpool()` call. It has its own session and tools, but:

- it may message only the main agent that spawned it (nested children walk up
  to that root main);
- it cannot message another main, another subagent, or another workspace, and
  it cannot broadcast;
- it never receives IM/channel tools (`channel_send`, `workspace_run`,
  `im_control`) or plugin management.

### External binding — channel + chat → target

An **external binding** is a route from one external conversation to one
target. It is not a workspace registration and it grants no permissions.

- The persisted form is a row in `web.yml`
  `remote.sessionMappings: [{ platform, chatId, workspaceAlias?, sessionId?,
  mode? }]` (plus WeChat peer tokens). It survives restarts.
- Runtime overrides sit above it: `@workspace use <alias>` / `*<alias>` for
  the current chat, and `@agent use <id>` for the current chat. Runtime
  overrides do not persist.
- A channel can also have a default workspace (`channels.<id>.workspaceRoot`),
  which is consulted after the per-chat bindings.
- The session origin records `{ channel, chatId, agentId, bindingId,
  workspaceAlias }` when known. Persisting a chat binding to one `agentId`
  is **PLANNED**; today the persisted route targets a workspace alias or a bot
  session, and `@agent use` is a runtime-only override.

### Session origin — local vs `im`

**Session origin** records where a conversation came from. It is a stamp on an
ordinary session, not a second store and not a new session type: an IM
conversation is still a normal transcript with the normal agent.

- `local` (absent stamp) — a personal conversation: coding, default
  workspace, or any session the user opened directly.
- `im` — a conversation that arrived through an external channel.
- The stamp is optional and additive. Older transcripts carry none; readers
  fall back to the `relay` / `bot` / `draft` tag in `web.yml`.
- Its shape is
  `{ kind: "im", channel?, chatId?, agentId?, bindingId?, botSessionId?,
  workspaceAlias? }`. `agentId` and `bindingId` are reserved for a default
  workspace that hosts several main agents; a mobile client scoped to one
  binding filters by them.
- A malformed origin reads as absent, so it can never hide a personal session.
- For an IM row, display the workspace alias, else `IM · <channel>`, else a
  generic IM/default-workspace label. Do not print the absolute host path.

Status: **IMPLEMENTED** for the header, the fallback tag path, and the local
list filters. Persisting a chat binding to one `agentId` and serving a
binding-scoped mobile view are **PLANNED**.

### Relay — the fallback, only when unbound

The **relay** is the default workspace's coordinator main agent (session name
"Zeta Bot (Relay)", tag `relay`). It is the shared fallback for a chat that has
no binding.

- It has a persistent transcript and is registered in `web.yml`; it cannot be
  deleted or rebound to a project.
- It is the fallback **only** when no binding matched. It is not a fallback
  for a binding that failed to open: an explicit project or agent binding that
  cannot be resolved answers with an error and candidates, rather than letting
  the default workspace answer for a repository it does not own.
- It may delegate across registered workspaces with `workspace_run`; a
  project-bound bot session may delegate only within its own project.

## 3. Visibility in personal lists

The rule:

- Local personal surfaces — the Work Studio sidebar, Work Studio History, and
  the TUI resume picker — show personal (`local`) conversations by default.
  IM/relay/bot conversations appear only through an explicit **IM / Bot**
  group or filter.
- Team-origin conversations (`kind: "team"`) follow the same rule: a session
  created inside a resolved Team location (PM workspace, engineer home/task
  worktree, team base repository) is hidden from the current-folder and
  all-projects scopes unless the reader passes `includeTeam`. A Team scope
  groups the rows Team → PM → engineer → repo → conversation; an explicit
  `--resume <id>` bypasses the filter.
- A mobile/external client scoped to one binding shows only that binding's
  chat; it does not browse the machine's other conversations.
- An IM row is labelled by workspace alias or `IM · <channel>`; a Team row by
  its name-built alias or `Team · <teamId>`. Neither shows an absolute
  filesystem path.

Status: **IMPLEMENTED** for the local surfaces. The origin stamp drives the
default filter, with the `relay` / `bot` / `draft` tag as the fallback for
IM transcripts written before it existed; `history.list`, the resume listing
and `buildResumeDirectory` take the same `includeIm` opt-in and add
`includeTeam`, with the Team grouping in `groupTeamSessions`. **PLANNED:** a mobile client scoped to one
binding, which filters on the origin's `agentId` / `bindingId`.

## 4. Board and calendar

Both are built-in tools, not plugins, and both are project-scoped. Neither one
turns a session into a PM; they are project state any top-level session in the
project may use.

| Tool | Store | Scope | Subagents |
| --- | --- | --- | --- |
| `board` | `<project>/.zeta/board/*.md` | Project root = session root; no `cwd`/path parameter | Only when the agent profile's `tools:` names `board` |
| `calendar` | `<project>/.zeta/calendar/events/*.json` | Project root = session root; no `cwd`/path parameter | Only when the agent profile's `tools:` names `calendar` |

- Top-level sessions receive both by default. A subagent never inherits them
  implicitly; the profile must opt in.
- The board is the user's long-lived task layer, separate from the agent's
  per-session `todo`. See [board.md](./board.md) and
  [tools/board.md](./tools/board.md).
- The calendar is file-backed event storage with list/get/create/update/delete;
  see [tools/calendar.md](./tools/calendar.md).
- The Work Studio **calendar UI is not implemented**. Calendar access is the
  tool/API only. Having the board and calendar tools does not make either one
  Team mode.

## 5. IM routing rules

- **One agent, many channels.** Several `(channel, chat)` rows may target the
  same relay or bot session. A chat is the unit that is bound, not a channel.
- **Several agents in the default workspace.** The relay and bot sessions
  coexist there as independent top-level sessions, each with its own
  transcript and mailbox.
- **No silent default-workspace fallback.** An unbound chat falls to the relay
  (the default workspace). An explicit binding that cannot open is an error
  with candidates; it never silently answers as the default workspace.
- **Project-bound bots stay in their project.** A bot session bound to a
  project runs in that repository, and its `workspace_run` delegation is
  limited to that project. Cross-project access is refused. The relay keeps
  its documented cross-repo role.
- **Precedence** (detailed command surface in
  [remote-workspaces.md](./remote-workspaces.md)): runtime `@agent use` →
  runtime `@workspace use` / `*<alias>` → active bot session → persisted
  per-chat binding → channel default workspace → relay.

## 6. Context rotation

The session JSONL is the durable conversation record, and it is deliberately
not size-capped.

- Normal turns append. Some maintenance (indexed storage) rewrites the file
  atomically, but no rewrite exists to enforce a size cap. Individual oversized
  strings are truncated at persistence with an explicit marker
  (signed/encrypted provider blocks stay byte-exact), and images/artifacts are
  externalized to the blob store. The transcript itself is never silently
  shortened to fit a size limit.
- **Compaction** (`/compact`, automatic context management) and **`/handoff`**
  summarize older context *in place* and continue the same session. `/handoff`
  is **IMPLEMENTED**; it is not rotation and it does not start a new file.
- **`/rotate` is PLANNED.** Target: an explicit operation that writes a
  summary plus a continuation into a new transcript, archives the old one, and
  links the two. It must be operator-triggered; no background task may delete
  or rewrite a transcript to make it smaller.
- `zetacode gc` is separate storage maintenance (blobs, cold-session archive,
  compression, stale state). It requires `--apply` for destructive phases and
  is not a context-rotation mechanism.

Status: **PARTIAL**. No rotation command exists yet; the no-silent-deletion
guarantee and in-place compaction/handoff do.

## 7. Vibe, Advisor, and `/review` are not modes

These are easy to confuse with the three modes. They are not:

- **Vibe** is a worker execution policy. It turns the top-level session into a
  director whose toolset is reduced to `read`, optional `todo`, and the
  worker-control tools; the work happens in persistent `fast`/`good` worker
  sessions. It is not a workspace mode and does not own a project. See
  [vibe-mode.md](./vibe-mode.md).
- **Advisor** is a passive second model. It reviews transcript deltas with its
  own read-oriented tools and injects advice; it cannot approve actions, be
  messaged, revived, or killed. See [advisor-watchdog.md](./advisor-watchdog.md).
- **`/review`** is a separate code-review command. It builds a review prompt
  and returns it to the main session, which spawns the `reviewer` task agent.
  It is neither Vibe nor Advisor. See
  [slash-command-internals.md](./slash-command-internals.md).

A Coding Agent and a Personal Harness may run Vibe or an Advisor without
changing their mode. A PM runs Lead (PM) mode instead of Vibe: the two are
mutually exclusive, and Lead dispatches through rooms to engineer main agents.

## Related

- [agent-mesh.md](./agent-mesh.md) — cross-process workspace/agent addressing
  and the IM `@agent` commands.
- [agent-hub.md](./agent-hub.md) — live subagent roster, transcripts, and
  steering.
- [channels.md](./channels.md) — CLI hosting, login, and channel configuration.
- [remote-workspaces.md](./remote-workspaces.md) — `!workspace` / `!session`
  grammar, relay delegation, and remote access.
- [default-workspace.md](./default-workspace.md) — default workspace
  initialization, persona, and memory.
- [session.md](./session.md) — transcript storage and persistence guarantees.
