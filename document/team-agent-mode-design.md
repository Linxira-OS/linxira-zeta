# Team Agent mode — surface, identity, chat, and storage

Status: implementation target for `1.5.14`; ADR-0091/0092/0093 are the decision
records. This document describes the intended product shape and the current
code facts that constrain it. It is not acceptance evidence.

## 1. Team is a primary surface

Coding mode and Vibe mode are one conversation plus workers. Team mode is a
durable organization: several named people, rooms, repositories, plans,
responsibilities and external sources. It cannot be a tab inside a coding
transcript.

- **Web:** `/team` (and later `/team/:teamId`) is a first-class route with a
  team switcher, per-team sidebar, contact/room list, conversation area,
  plan/task panel and team settings. It is equal-weight with Workbench/History.
- **TUI:** `/team` opens a full-screen Team workspace (the current
  `/team hub` is already fullscreen but requires an active Team and has no team
  switcher). The same workspace exposes teams, contacts, rooms, plans and the
  current session.
- Both are clients of one Host and one session identity (ADR-0088). A Team view
  must not create a second agent or a second transcript.

Current facts:

- Web `TeamWorkspacePage` already has `team.list` tabs and
  overview/onboarding/tasks/rooms/board/calendar/mail/graph/im tabs, but it is
  still a page built from tabs, not a Team-sidebar shell.
- TUI `ActiveTeamHubOverlayComponent` is fullscreen, but `showActiveTeamHub`
  rejects unless `/team` is active, and its source is only the active Team.
- The Team database has multiple `teams` rows with `root_path`; multi-Team is a
  UI/context gap, not a missing schema.

## 2. Multiple Teams

Each Team is a tenant-like workspace:

- own root, repositories, worktrees, PMs/engineers, rooms, tasks, personas,
  long-term notes, default conversations and external bindings;
- switching a Team switches the sidebar, contacts, rooms, plans, tasks and
  conversation list;
- same-named personas in different Teams are separate instances with separate
  memory, permissions and sessions;
- repositories/transcripts never cross Teams. Only explicit global layers are
  shared: user taste/coding habits, global model/provider config, explicitly
  global skills.

A `TeamContext` (`teamId`, root, current room/member/session) is the UI contract.
Web uses the URL; TUI uses a Team switcher in the full-screen Team workspace.

## 3. Identity and AGENTS.md

The dangerous current behavior is ambient instruction inheritance: a
first-level worker can load the same project/global `AGENTS.md` as the main
agent, while also getting a worker role prompt. The worker can then mistake
main-only instructions for its own identity, or the main can lose its own role
when a worker speaks in the same room.

Do not use one `AGENTS.md` as both repository convention and agent identity.
Compose explicit layers:

```text
1. global user instructions       applies to all agents
2. repository AGENTS.md           applies to all agents in that checkout
3. Team profile                   team-wide conventions, data only
4. persona role pack              identity, model, skills, permissions, memory
5. assignment/session scope       this run, this step, this source
```

Rules:

- Repository `AGENTS.md` remains code/project convention for both main and
  workers. It is not a persona and cannot grant/deny identity.
- Main-only or worker-only instructions never ride in `AGENTS.md`; they live in
  the persona/role pack or a scoped Team profile with an explicit `appliesTo`.
- A first-level worker receives layers 1/2 + its own Team/persona/assignment,
  never the main's private persona layers.
- A main agent receives layers 1/2 + main persona; it does not inherit a
  worker's role text.
- Persona/role packs are versioned data. Updating a pack changes the next
  instantiation, not a frozen prompt from an old session.
- If an agent needs a policy from another role, it requests it through the group;
  it never silently reads another agent's identity document.
- Prompt assembly records the applied layer ids/revisions for audit and replay.

Existing files can remain for repository instructions; new Team identity should
use `.zeta/team-profile.md` and `.zeta/personas/<id>.json` (or a versioned
equivalent), not a Team-root `AGENTS.md`. The current Team root deliberately has
no `AGENTS.md`; preserve that rule.

## 4. Personas and long-lived responsibilities

A persona is data, not a permanent hidden model loop:

```text
persona
  name / avatar / role
  model / thinking
  skills
  permission overrides
  memory scope (team | global-taste only)
  writable paths / working folder
  long-lived responsibility (module / repo / external source)
```

Seed contacts may include coordinator, full-stack/module maintainer, reviewer,
QA, release manager and external liaison. Users can add tools only to the
intended persona. Long-lived means durable role/session binding and resumable
context, not an always-running agent.

### Main agent creates first-level roles

The Team main agent may, on the user's behalf, create a new first-level persona
and its initial identity pack. It must create the pack as versioned data and
record it in the Team database, not silently inject a prompt. The user can edit,
disable or delete the role afterwards. A created role cannot grant itself
credentials, external send rights or cross-Team repo access; those remain
explicit Host grants. Every creation/change is audited.

### Persona plugin packs

A persona may carry a scoped plugin pack (skills, tools, commands, declarative
pages). This lets an agent extend its own capability without changing the Zeta
tree or another Team's runtime.

- The pack lives with the persona/Team data, is content-addressed and loaded only
  into that persona's first-level session.
- Team main workers may scaffold/validate/load a **dev** pack through the
  existing plugin lifecycle; promotion/export remains a user action.
- The existing rule that `plugin_manager` dev loading is interactive-main-only
  must be extended explicitly for first-level Team personas; nested workers stay
  refused. A loaded pack cannot write repository source or promote itself.
- Pack failures affect only the persona; the main/other Team sessions keep their
  previous tool set.
- Plugin permissions are additive to the Host policy, never a bypass.


## 5. Group chat routing

The routing rules are program rules, not a model decision. The pure contract is
`packages/coding-agent/src/team/chat-routing.ts`:

| Surface | Mentions | Delivery |
|---|---|---|
| DM | target | target gets a direct turn |
| Group | none | every participant except sender gets ambient context; nobody starts a turn only for being in the room |
| Group | `@worker` | mentioned worker gets a direct turn; others get an `assigned-elsewhere` notice |
| Group | `@main` | main gets a direct turn; main decides whether to delegate; workers only get the notice |
| Group | multiple | each mentioned gets direct; others get the notice |
| Group | agent sender | same rules; sender never receives its own message |
| Group | unknown mention | report the unknown token to the sender; do not guess a recipient |

Names, aliases and ids are exact (case-insensitive) matches. The user can
mention multiple first-level agents; nested workers are not directly addressable
from the Team group.

### Injection and background work

- `direct`: start/queue a turn for that participant.
- `ambient`: do not start a turn. Inject the group message (or a bounded excerpt)
  at that participant's next tool-call boundary. This is how a busy compiling
  worker still hears the room.
- `assigned-elsewhere`: do not inject the full message; inject a short notice
  that the user assigned it to another agent. This prevents duplicate work.
- A worker may explicitly ask for ambient context retention while it runs a long
  build; the Team host keeps a bounded room cursor and injects it after the
  current tool call, never in the middle of a tool call or queued write.
- Agents may post to the group and mention another first-level agent or main.
  Their sender identity is the durable agent id, never a display name alone.
- Group messages must be persisted with sender, room, seq, mentions and delivery
  state so a reconnect/replay cannot silently lose an assignment.

## 6. Agent-originated messages and attachments

Agents can proactively post text, images and files to a Team room or DM.

- **Web/desktop:** render images inline, files as downloadable/openable cards,
  with the sender, room and timestamp. Attachment bytes are Host resources
  (`local://`/artifact/upload grant); a raw filesystem path is never a public
  message field.
- **TUI:** render a clickable line/link. `Ctrl+click` opens:
  - image → the system image viewer (or the existing image tool);
  - text/markdown → `zetaide`/the configured editor at the file/line;
  - binary/other → the system default application.
- The same attachment must resolve through the Host on both surfaces. Do not
  copy bytes into the room transcript; persist a bounded descriptor and resolve
  through the Host grant on read.
- Outbound messages from an agent are audited with sender, room, mention set,
  attachment count and policy result. A liaison cannot silently send outward.

## 7. External liaison / first-level IM

Only a **first-level Team child** may hold `external.listen`; nested workers
cannot open IM or external bridges.

- The main agent or user grants a capability with source (IM room, Git/PR feed,
  OA ticket feed), filter and delivery policy.
- A liaison may be listen-only. It must record @mentions and required events even
  when it does not answer; non-actionable chatter creates no model turn.
- A liaison reports into the Team room and/or its owning main; the main may
  receive the same group message.
- Git/OA watchers are separate persona/source bindings, not one agent with every
  credential.
- The user can add tools to a liaison; a Tool not granted to that persona cannot
  be used from a room message.

## 8. Midstream input and Team plans

Every user message added while a Team turn runs enters one intake path:

1. designated intake/verifier or coordinator receives;
2. classify as answer, plan change, new work or external event;
3. acknowledge, update durable plan/task;
4. route the delta to main or the responsible member.

Team plans are a separate object, not the coding-agent Plan/Ask flow:

```text
TeamPlan
  id, teamId, coordinatorId, originMessageId
  steps[]:
    id, title, owner, task, dependsOn
    inputs, deliverables, acceptance, maxFixRounds
  budget, permissions, status
```

The coordinator produces the plan; the user confirms, or the main confirms only
under an explicit policy the user configured. Pause/resume/replan/per-step
review/fix rounds are durable program state.

## 9. Current Team paths and long-term text

```text
<team>/                              ownerless container
├─ .zeta/team.json
├─ pms/<pm>/                         plain PM workspace
│  ├─ .zeta/pm.json
│  ├─ notes/
│  └─ links/
├─ repos/<repo>/                     canonical base repo; never agent cwd
└─ worktrees/<repo>/<pm>/<engineer>/
   ├─ home/                          integration branch
   └─ <task>/                        task branch
```

Structure is registered in `~/.zeta/data/zeta.db` (`ZETA_TEAM_DB` override);
markers are hints. The Team root has no `.git`, no `AGENTS.md`, no root session.
Current long-term text is only `pms/<pm>/notes/` plus task/room data.

Proposed data additions (not a second agent cwd):

```text
<team>/.zeta/team-profile.md
<team>/.zeta/personas/<id>.json
<team>/.zeta/memory/team/
<user>/.zeta/memory/taste/       # cross-Team taste/coding habits only
```

## 10. Logs and session JSONL splitting

Logs already split:

- process logs: `~/.zeta/logs/zeta.<date>.<pid>.log`, 10 MiB × 5 per process;
- launch broker output: 25 MiB + previous;
- tracking action log: 5 MB × 3.

Team logs should additionally carry `teamId`, `roomId`, `sessionId`, `agentId`.

Session JSONL:

- main transcript: `<session>.jsonl`;
- subagents: separate `<parent-stem>/<agentId>.jsonl`, not inlined into the main
  JSONL; `parentSession` breadcrumbs connect them;
- compaction changes model context but does not currently split the disk file;
- >100 MB main files can still be slow.

Split policy:

- never split on a fixed MB threshold;
- split only after a committed compaction and after the live turn settles;
- split on a turn boundary, never inside a tool call/result or queued message;
- keep session identity stable, write a segment manifest/link, keep old segments
  immutable/searchable;
- resume follows the latest compaction summary + active segment;
- interrupted split keeps the old segment active; split is idempotent/crash-safe.

## 11. PiBot reference and Zeta boundary

Borrow from PiBot: named role packs, coordinator plan confirmation, per-bot
policy, durable plans, headless brain. Keep Zeta's existing Vibe/Team worker
substrate, one Host/session identity (ADR-0088), global/project model roles
(ADR-0082), and no second Electron/runtime or `pi` dependency.

The current `docs/team.md` "no team-wide agent / pull queue" remains true for the
legacy Team database until a later accepted implementation ADR supersedes it.
