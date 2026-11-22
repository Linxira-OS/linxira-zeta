# Team Agent mode — surface, personas, scope, and storage

Status: design research, 2026-11-22. This document records the intended product
shape; it does not claim implementation. ADR-0091 is the related decision
record.

## 1. Why Team is a primary surface

Coding mode and Vibe mode are a **single conversation with workers**. Team mode
is a different product object: a durable organization with several people,
rooms, repositories, plans and long-lived responsibilities. It cannot be treated
as a tab inside the coding-agent transcript.

Therefore:

- **Web:** `/team` is a first-class route with its own team switcher, sidebar,
  contacts, conversation area, plan/activity area and team settings. It is
  equal-weight with Workbench and History, not a settings subpage.
- **TUI:** `/team` must open a full-screen Team workspace, not only the
  existing `/team hub` overlay. It has the same team switcher, contact list,
  conversation/room pane and plan/task state. A transcript remains a client
  view over the same Host session; Team is not a second runtime.
- The ordinary coding transcript, Vibe and Team share one Host/session identity
  (ADR-0088). A Team page may open the same session in a different view; it must
  not create a second agent.

## 2. Multiple Teams

The database already has a `teams` table with `root_path` and the Web Team page
loads `team.list` into team tabs. That is the base, not the final IA.

Each Team is a separate tenant-like workspace:

- its own root path, repositories, worktrees, PMs/engineers, rooms, tasks,
  personas, long-term notes and conversation defaults;
- switching Teams changes the left sidebar, contacts, rooms, plan/task lists and
  visible conversations;
- no repository or team transcript is shared across Teams. A same-named persona
  in two Teams is two separate role instances with separate memory and
  permissions;
- only explicitly global layers are shared: user taste/coding preferences,
  global model/provider configuration, and explicitly global skills. Team
  memory and repo content never cross the boundary.

The Web UI already has team tabs; it needs a real team switcher and a
team-scoped navigation model. The TUI has no team switcher today; its Team Hub
requires an active Team and is an overlay. Both need a `TeamContext` carrying
`teamId`, `rootPath`, current room, current member and selected session.

## 3. Personas and long-lived agents

A Team persona is data, not a hidden agent:

```text
persona/
  name, avatar, role
  model / thinking
  skills
  permission overrides
  memory scope (team | global-taste)
  writable paths / working folder
  long-lived responsibility (module, repo, external source)
```

Built-in contacts may be seeded (developer, reviewer, QA, coordinator, external
liaison), but users can add removable tools and permissions per persona. A
persona is instantiated as a first-level Team worker when it is addressed; it is
not a permanent background process. Long-lived means durable role/session
binding and resumed context, not an unbounded always-on model loop.

Personas appear only in their Team's contact list. Global taste/coding habits are
stored in a separate user-level layer and may be read by all Teams; they never
carry another Team's transcript.

## 4. External liaison and first-level IM

Only a **first-level Team child** may hold an external-listening capability.
Nested workers cannot open IM or external bridges.

- The main agent or the user grants an explicit `external.listen` capability
  with a source (IM room, Git/PR feed, OA ticket feed), a filter and a delivery
  policy.
- A liaison may be listen-only. It must record @mentions and required events even
  when it does not answer; non-actionable chatter is dropped without model turns.
- The liaison reports into the Team room and/or its owning main agent; the main
  agent may receive the same group message. A liaison cannot silently send
  outward; outbound sends remain audited and policy-gated.
- Git/OA watchers are separate personas/sources, not one mega-agent with every
  credential.

## 5. Midstream user input

Every midstream message added while a Team turn is running must enter one intake
path:

1. A designated intake/verifier agent or the coordinator receives it.
2. It classifies the update as: answer to an existing step, plan change, new
   work, or external event.
3. It acknowledges the user, updates the durable plan/task if needed, and routes
   the delta to the main agent or the responsible member.
4. A PlanChange or new WorkItem is never left as a transient prompt inside one
   worker.

This is a Team-level intake contract; it does not reuse coding-agent Plan mode.

## 6. Plan confirmation is a separate Team object

Team plans need their own durable card:

```text
TeamPlan
  id, teamId, coordinatorId, originMessageId
  steps[]:
    id, title, owner, task, dependsOn
    inputs, deliverables, acceptance, maxFixRounds
  budget, permissions, status
```

The coordinator produces the plan; the **user** confirms, or the main agent
confirms only under an explicit policy the user configured. It must not call the
existing `/plan` mode, Ask `plan_mode` consent, or coding-agent Plan review. Pause,
resume, replan, per-step review and fix rounds are program state.

## 7. Current Team paths and long-term text

Current repository layout (enforced by the Team service/doctor):

```text
<team>/                              ownerless container
├─ .zeta/team.json
├─ pms/<pm>/                         plain PM workspace
│  ├─ .zeta/pm.json
│  ├─ notes/
│  └─ links/
├─ repos/<repo>/                     canonical base repo; never an agent cwd
└─ worktrees/<repo>/<pm>/<engineer>/
   ├─ home/                          integration branch
   └─ <task>/                        task branch
```

All structure is registered in `~/.zeta/data/zeta.db` (`ZETA_TEAM_DB` override);
markers on disk are discovery hints. A Team root has no `.git`, no `AGENTS.md`
and no root session. Existing long-term text is only `pms/<pm>/notes/` plus
task/room data; there is no first-class team profile or persona store.

Proposed additions (data, not a second agent cwd):

```text
<team>/.zeta/team-profile.md         team charter, shared conventions
<team>/.zeta/personas/<id>.json      role/model/skills/permission/memory scope
<team>/.zeta/memory/team/            team-scoped long-term memory
<user>/.zeta/memory/taste/           cross-team taste/coding preferences only
```

The existing PM notes remain valid. No Team-root `AGENTS.md` is introduced; a
profile file is data read by the Team service and explicitly injected when a
persona is instantiated.

## 8. Logs and session files

### Logs

Logs already split:

- process logs: `~/.zeta/logs/zeta.<date>.<pid>.log`, 10 MiB per file, 5 files
  per process, then pruned;
- launch broker output: 25 MiB, previous file retained;
- tracking action log: 5 MB × 3.

No large single log is expected; however `agent.log`-style structured streams
should be tagged by `teamId`, `sessionId`, `agentId` and rotated by the same
sink.

### Session JSONL

The main transcript is `<session>.jsonl`. Subagent transcripts are **separate
files** under `<parent-stem>/<agentId>.jsonl`, with `parentSession` breadcrumbs;
they are not appended into the main transcript. A >100 MB main file can still be
slow because the whole line-oriented journal is scanned, even though subagents
are separate.

Compaction changes model context; it does not currently split the on-disk JSONL.
Proposed split policy:

- Never split on a hard MB threshold.
- Split only after a committed compaction boundary, when the transcript has a
  durable `compaction` entry and the live turn has settled.
- Close the current segment, write a segment manifest/link, and continue the same
  session identity in a new segment. The latest compaction summary is the
  canonical handoff.
- Split at a turn boundary, never inside a tool call/result or queued message.
- Keep old segments immutable and searchable; resume loads the summary plus the
  active segment and follows links for history.
- A future split must be idempotent and crash-safe; an interrupted split keeps
  the old segment active.

This is a design requirement, not implemented.

## 9. PiBot comparison and scope

PiBot's useful model is: named Bots, role packs, coordinator plan confirmation,
per-Bot policy, durable plans and a headless brain. Zeta should borrow those
concepts, but keep:

- one machine Host and one session identity (ADR-0088);
- existing Vibe worker/Team execution substrate;
- Zeta's global/project model-role boundary (ADR-0082);
- no second Electron/runtime and no Pi dependency.

The current `docs/team.md` "no team-wide agent / pull queue" remains true for the
legacy Team database. A later accepted implementation ADR must supersede it for
the new Team surface rather than changing behavior silently.
