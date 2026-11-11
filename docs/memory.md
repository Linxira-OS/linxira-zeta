# Autonomous Memory

Zeta supports five memory modes. Memory is disabled by default; select one backend via `/settings` or `config.yml`:

| `memory.backend` | Storage and behavior                                                                               | Guide                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `off`            | No memory backend                                                                                  | —                                                       |
| `local`          | Project-scoped summaries and lessons generated from persisted sessions                             | This page                                               |
| `hindsight`      | Remote, bank-scoped Hindsight memory                                                               | [Hindsight](#hindsight-remote-backend)                  |
| `mnemopi`        | Local Mnemopi SQLite memory                                                                        | [Mnemopi memory backend](./mnemosyne-memory-backend.md) |
| `sharpshooter`   | Friction-gated project decision files (architecture/product/style), consolidated in the background | [Sharpshooter](#sharpshooter-backend)                   |

Enable the local summary pipeline:

```yaml
memory:
   backend: local
```

## Usage

### What gets injected

At session start, if a consolidated summary or manually captured lesson exists for the current project, it is injected into the system prompt as a **Memory Guidance** block. The summary and lessons share `memories.summaryInjectionTokenLimit`.

If startup consolidation finishes after the first prompt build, the active session's summary snapshot is refreshed. Captured lessons remain pinned to the initial snapshot, so a concurrent `learn` call still affects only later sessions.

- Treat memory as heuristic context — useful for process and prior decisions, not authoritative on current repo state.
- Cite the memory artifact path when memory changes the plan, and pair it with current-repo evidence before acting.
- Prefer repo state and user instruction when they conflict with memory; treat conflicting memory as stale.

### Reading memory artifacts

The agent can read memory files directly using `memory://` URLs with the `read` tool:

| URL                                    | Content                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `memory://root`                        | Compact summary injected at startup                                                                                                      |
| `memory://root/MEMORY.md`              | Full long-term memory document                                                                                                           |
| `memory://root/learned.md`             | Lessons captured by the `learn` tool                                                                                                     |
| `memory://root/skills/<name>/SKILL.md` | A generated skill playbook                                                                                                               |
| `memory://<memory-id>`                 | Full Mnemopi memory row (working or episodic) with a YAML frontmatter metadata header; only available when `memory.backend` is `mnemopi` |

The `memory://<memory-id>` form returns the full stored row rather than the clipped recall preview (recall content that exceeds the preview cap ends with a trailing `…`); agents are instructed to read it before any `memory_edit update`.

The `memory://root[/…]` rows are file-backed and only exist with `memory.backend: local`, which populates the on-disk memory root via the consolidation pipeline. Under `hindsight` or `mnemopi` the root is never written, so those URLs do not resolve — use `recall`/`reflect` (and `read memory://<memory-id>` on `mnemopi`) instead.

### `/memory` slash command

| Subcommand            | Effect                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `view`                | Show the current backend injection payload                                                                               |
| `stats`               | Show backend-specific memory statistics, when supported                                                                  |
| `diagnose`            | Show backend-specific diagnostics, when supported                                                                        |
| `queue`               | Show pending memory deltas awaiting consolidation                                                                        |
| `sync`                | Run memory consolidation now                                                                                             |
| `clear` / `reset`     | Delete active backend memory data/artifacts                                                                              |
| `enqueue` / `rebuild` | Force consolidation/retention work for the active backend                                                                |
| `mm …`                | Hindsight mental-model maintenance (`list`/`show`/`refresh`/`history`/`seed`/`delete`/`reload`); unsupported in ACP mode |

### Capturing lessons

Enable `autolearn.enabled` to make the `learn` tool available:

```yaml
autolearn:
   enabled: true
```

With the local backend active, `learn` saves explicit durable lessons to the project's `learned.md`. Lessons are newest-first, deduplicated, secret-redacted, capped at 100 entries, and injected starting with the next session; a `learn` call does not mutate the active session's prompt-cache prefix. Each lesson's content is capped at 2,000 characters and optional context at 400 characters. Structured memory search, `recall`, `retain`, `reflect`, and `memory_edit` are not available for the local backend.

## Project-scoped memory

`memory.backend` is resolved per session cwd. The layers, highest priority
first, are: runtime override → `--config` overlay → project
(`<cwd>/.zeta/settings.json`, `<cwd>/.zeta/config.yml`, `.claude/settings.json`)
→ user (`~/.zeta/agent/settings.json` / `config.yml`) → schema default `off`.

To enable memory for **one repository only**, write the project layer directly:

```json
// <repo>/.zeta/settings.json
{ "memory": { "backend": "mnemopi" } }
```

The user layer stays `off`, so sibling repositories are unaffected. Every
session resolves its own cwd's layers: one `serve` process can hold a
`mnemopi` session in the default workspace and an `off` session in another
repository at the same time. The web settings panel follows the active
workspace when it reads — it shows the effective value and flags a project
override after a save — but writes still land in the user layer; to enable
memory for one repository, the file above remains the edit path. Storage is
already per-project: `getMemoryRoot` maps a cwd to `memories/<encoded cwd>`
under the agent directory, so one repository never reads another's rows.
`@status` reports the effective backend and the layer that supplied it
(for example `记忆: mnemopi (project)`).

The default workspace (`~/.zeta/workspace`) is the only directory shipped with
this project-layer opt-in; see
[Default workspace](./default-workspace.md#memory).

## How it works

Local summary memories are built by a background pipeline that runs at startup; `/memory enqueue` marks consolidation work that the next startup picks up. The pipeline is skipped for subagents and for sessions that are not persisted to a session file.

**Phase 1 — per-session extraction:** For each past session that has changed since it was last processed, a model reads the session history and extracts durable signal: technical decisions, constraints, resolved failures, recurring workflows. Sessions that are too recent, too old, currently active, or beyond the configured scan/age limits are skipped. Each extraction produces a raw memory block and a short synopsis for that session.

**Phase 2 — consolidation:** After extraction, a second model pass reads all per-session extractions and produces three generated outputs written to disk:

- `MEMORY.md` — a curated long-term memory document
- `memory_summary.md` — the compact text injected at session start
- `skills/` — reusable procedural playbooks, each in its own subdirectory

The separately maintained `learned.md` is not overwritten by consolidation.

Phase 2 uses a lease and heartbeat to prevent double-running when multiple processes start simultaneously. Stale skill directories from prior runs are pruned automatically.

Consolidated output is redacted for common secret/token patterns before `MEMORY.md`, `memory_summary.md`, or generated skills are written to disk.

### Extraction behavior

Memory extraction and consolidation behavior is driven by static prompt files in `packages/coding-agent/src/prompts/memories/`.

| File                      | Purpose                                          | Variables                                   |
| ------------------------- | ------------------------------------------------ | ------------------------------------------- |
| `stage_one_system.md`     | System prompt for per-session extraction         | —                                           |
| `stage_one_input.md`      | User-turn template wrapping session content      | `{{thread_id}}`, `{{response_items_json}}`  |
| `consolidation_system.md` | System prompt for cross-session consolidation    | —                                           |
| `consolidation.md`        | User-turn prompt for cross-session consolidation | `{{raw_memories}}`, `{{rollout_summaries}}` |
| `read-path.md`            | Memory guidance injected into live sessions      | `{{memory_summary}}`, `{{learned}}`         |

### Model selection

Memory piggybacks on the model role system.

| Phase                   | Role                                                                | Purpose                          |
| ----------------------- | ------------------------------------------------------------------- | -------------------------------- |
| Phase 1 (extraction)    | `default`                                                           | Per-session knowledge extraction |
| Phase 2 (consolidation) | `smol` (falls back to `default`, then current/first registry model) | Cross-session synthesis          |

If the requested memory role is not configured, memory model resolution falls back to the `default` role, then the active session model, then the first model in the registry.

## Configuration

| Setting                               | Default | Description                                                                                                                              |
| ------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `memory.backend`                      | `off`   | Select `local` for this pipeline; legacy `memories.enabled: true` is migrated to `memory.backend: local` when no explicit backend is set |
| `memory.extractionMode`               | `auto`  | `auto` keeps backend cadence, `window` learns only committed discarded regions, `manual` leaves explicit tools and `/memory enqueue` as the only triggers |
| `memories.maxRolloutAgeDays`          | `30`    | Sessions older than this are not processed                                                                                               |
| `memories.minRolloutIdleHours`        | `12`    | Sessions active more recently than this are skipped                                                                                      |
| `memories.maxRolloutsPerStartup`      | `64`    | Cap on sessions processed in a single startup                                                                                            |
| `memories.threadScanLimit`            | `300`   | Maximum recent session records scanned at startup                                                                                        |
| `memories.maxRawMemoriesForGlobal`    | `200`   | Maximum per-session extractions supplied to global consolidation                                                                         |
| `memories.stage1Concurrency`          | `8`     | Concurrent per-session extraction jobs                                                                                                   |
| `memories.stage1LeaseSeconds`         | `120`   | Extraction job lease duration                                                                                                            |
| `memories.stage1RetryDelaySeconds`    | `120`   | Delay before a failed extraction becomes claimable again                                                                                 |
| `memories.phase2LeaseSeconds`         | `180`   | Consolidation lease duration                                                                                                             |
| `memories.phase2RetryDelaySeconds`    | `180`   | Delay before failed consolidation is retried                                                                                             |
| `memories.phase2HeartbeatSeconds`     | `30`    | Consolidation lease heartbeat interval                                                                                                   |
| `memories.rolloutPayloadPercent`      | `0.7`   | Fraction of the selected model's context budget available to rollout payloads                                                            |
| `memories.phase1InputTokenLimit`      | `4000`  | Per-session extraction input cap                                                                                                         |
| `memories.fallbackTokenLimit`         | `16000` | Model token budget used when the model has no finite declared context window                                                             |
| `memories.summaryInjectionTokenLimit` | `5000`  | Shared approximate token cap for the summary and captured lessons injected into the system prompt                                        |

## Hindsight remote backend

Hindsight requires a reachable [Hindsight](https://hindsight.vectorize.io/) server. The default endpoint is `http://localhost:8888`; set a token when the server requires authentication:

```yaml
memory:
   backend: hindsight
hindsight:
   apiUrl: http://localhost:8888
   apiToken: ${HINDSIGHT_API_TOKEN}
```

`HINDSIGHT_*` environment variables override `hindsight.*` settings, which override built-in defaults. See the [complete Hindsight environment-variable table](./environment-variables.md#hindsight-memory-backend) for all 18 supported overrides, accepted values, parsing rules, precedence, and defaults.

By default, Hindsight uses `per-project-tagged` scoping: writes go to a shared bank with a project tag, while recall includes project-tagged and untagged global memories. With `hindsight.globalScope: true` (off by default), `retain` and `learn` accept `scope: "global"` to write such an untagged memory, so a preference or lesson that holds everywhere reaches every project. Recall finds the global fact itself in every project. Per-project mental models refresh with strict project-tag matching, so they never include global memories; the untagged `user-preferences` model does. Consolidation may also fold a global fact into an existing project-tagged observation, so observation results in other projects can miss that consolidated form. A bank configuration that tags extracted facts (an `entity_labels` group with `tag: true`) adds a tag to every fact carrying such a label, and a global fact tagged that way no longer surfaces in other projects. `per-project` isolates each working-directory project in its own bank and does not offer `scope: "global"`; `global` uses one shared bank. An explicit `hindsight.bankId` selects the bank base. Changes to the bank ID, prefix, or scoping rebuild the primary session state so later operations use the new scope.

The default bank base is `zeta`; it was upstream's `omp` before the 2026-10 brand cut. Memories are addressed by bank, so a deployment that already retained content under the old default keeps those memories only by pointing at them again: set `hindsight.bankId: omp` (or `HINDSIGHT_BANK_ID=omp`) to keep recalling them, or re-retain into the new bank.

Both project-scoped modes name the project the same way: take the repository's primary checkout root (so every linked worktree of one repository resolves to the same directory), then lowercase its basename. A checkout at `~/code/General` therefore tags `project:general`. Tags are matched literally, so this fold is what keeps one repository in one memory scope no matter how the path is capitalised.

The primary session recalls on its first model turn (`hindsight.autoRecall: true`) and automatically retains completed conversation turns every three user turns by default. `/memory enqueue` flushes queued tool retains and forces retention of the current session. At agent end, the primary state schedules cadence-based retention and flushes the retain queue; session disposal drains that queue before releasing the state. Request failures and configured timeouts are logged and leave the coding session usable. Subagents alias the parent's client, bank, and scope for explicit `recall`, `retain`, and `reflect` calls, but do not run their own automatic recall or retention.

Tool-initiated `retain` and `learn` writes go through a durable outbox: each memory is written to a private file under `<agentDir>/hindsight-outbox/` (without the bearer token, with recognizable secrets redacted) before the tool reports it queued, and the file is deleted once the server accepts it. Failed deliveries stay on disk and retry with exponential backoff; the next primary session for the same API URL and bank delivers what earlier processes left. Each memory's id doubles as its server `document_id`, so a resend replaces instead of duplicating. Requests the server refuses (HTTP 400, 413, 422), malformed files, and events undelivered for 7 days move to `hindsight-outbox/quarantine/` with a warning and are deleted 30 days later. A 2xx response means server acceptance, not completed extraction. Automatic transcript retention does not use the outbox.

Recall is injected as background context, not instructions, and recalled memory is also available as extra context during compaction. The first-turn recall is stored in the session file, so resuming, switching to, or forking the session sends it unchanged instead of recalling again; a context reset, a different bank or tag filter, or a branch that edits the first prompt recalls afresh. Hindsight memories cannot be looked up by id, so changes to them since the recall are not reported. Mental models are still reloaded when a new process starts. Selecting Hindsight exposes `recall`, `retain`, and `reflect`; `memory_edit` is not available because upstream Hindsight memories are not edited through this backend.

`/memory view`, `/memory stats`, `/memory diagnose`, and `/memory enqueue` operate through the active Hindsight state. `/memory clear` first drains pending retains, then clears only the local session state and recall cache. It **does not delete the server-side bank**; delete that bank with the Hindsight UI or API.

## Sharpshooter backend

Sharpshooter keeps three short project decision files — `architecture.md`, `product.md`, and `style.md` — and injects them into the system prompt. It needs no server; files live under `<agentDir>/memories/sharpshooter/<bank>/`, where the bank is derived from the working directory, so each project has its own decisions.

```yaml
memory:
   backend: sharpshooter
sharpshooter:
   minPromptLength: 4
   intervalMinutes: 5
```

**Extraction:** each user prompt in the main session (subagents are skipped) goes to the extraction model, which records durable decisions the user made — architecture, product, and style decisions, constraints, rejected approaches, and corrections — as deltas in a per-session queue. Slash commands and prompts shorter than `sharpshooter.minPromptLength` characters are not sent; a session runs one extraction at a time, and a prompt that arrives while one is running is not extracted. Short replies such as "opt 2" are resolved against the preceding assistant message, but at the default of 16 characters they are too short to be sent — lower `sharpshooter.minPromptLength` to capture them.

**Consolidation:** a scheduler checks every minute and, once `sharpshooter.intervalMinutes` have passed since the last run, applies the queued deltas to the three files in one model pass and removes them from the queue. `/memory enqueue` consolidates immediately; `/memory queue` lists pending deltas and `/memory clear` deletes the project's files and queue.

| Setting                            | Default | Description                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory.backend`                   | `off`   | Set to `sharpshooter` to enable this backend                                                                                                                                                                                                                                       |
| `sharpshooter.model`               | unset   | Model selector for extraction and consolidation; unset uses the `smol` role                                                                                                                                                                                                        |
| `sharpshooter.minPromptLength`     | `16`    | Prompts shorter than this many characters are not sent for extraction; values below `2` act as `2`. Characters are counted as displayed (one CJK character or emoji is one), the same in every language, so Chinese users may lower it to capture short replies such as "用方案二" |
| `sharpshooter.intervalMinutes`     | `5`     | Minimum minutes between consolidation runs                                                                                                                                                                                                                                         |
| `sharpshooter.injectionTokenLimit` | `15000` | Approximate token cap for the decision files injected into the system prompt                                                                                                                                                                                                       |

## Taste layer

The taste layer learns durable *preferences* — how you want code written — separately from project facts. It is off by default, needs a memory backend, and is the only memory layer that stores its data in Command Code's `taste.md` format, so an existing `.commandcode/taste/taste.md` is imported on first use and a store this layer writes stays readable by that tool.

```yaml
memory:
   backend: mnemopi
taste:
   enabled: true
   scoping: per-project
```

Stores live under `<agentDir>/memories/taste/<domain>/…/taste.md` as plain Markdown:

```markdown
# Taste

- Prefers the outer framework to run directly on the target kernel. Confidence: 0.62
- Avoids barrel files in `src/`. Confidence: 0.74
```

The visible file carries the statement and one confidence; evidence, mentions, conflict state, tombstones, and timers live next to it in `state.json`. Keep the file editable: consolidation re-normalizes it, and a hand-edited confidence is treated as the entry's prior.

**Scoping.** `per-project` (default) keeps one store per repository; `global` keeps one for the machine; `per-project-tagged` reads the project store first, then the global one, with the project winning a topic. Under both tagged modes a subagent gets its own store under `agents/<bank>/<agentId>/`, so one agent's habits never leak into another's prompt.

**Learning.** Each user prompt in the main session (subagents are skipped; prompts shorter than `taste.minPromptLength` are not extracted) is classified into a candidate: statement, category, polarity, and the user's verbatim words as evidence. The model may also call `super_memory` with `action: "record"`; a record is only a candidate, never a stored entry, and its evidence must be a verbatim substring of the user's latest message. Candidates are queued per session and applied by a scheduler tick after `taste.intervalMinutes`.

**Consolidation** turns candidates into entries and is the only place confidence changes:

- Every observation adds Beta evidence — `stated×N` for an extraction, `repeat×N` for the same topic in another session — plus a diminishing repeat bonus; contradictions add negative evidence.
- A repeated topic corroborates its entry instead of creating a second one.
- Opposite polarities on one topic become an unresolved **conflict**: neither is injected until you resolve it (`super_memory` with `action: "resolve"`, or forget one side).
- Deletion only for: a manual forget, a conflict unresolved for 30 days, an idle unprotected entry older than a year whose decayed retention fell below 0.5, and the per-category cap of 12 (weakest retention first). Every deletion leaves a tombstone.
- At `p ≥ 0.8` with at least five mentions an entry becomes protected: age never deletes it again.

**Judgment.** The optional semantic step picks a model from `modelRoles.taste`, then `judge`, then `@smol`. A judgment model (TypeSafe Jev, OpenRouter/OpenAI Decisions, Workers AI System One) contributes a *calibrated* posterior with pseudo-counts (T2). A chat model only classifies — category and polarity — and any confidence it emits is discarded (T1). With no model, the layer runs entirely on the host's evidence math (T0), which is the default.

**Injection.** The block is rebuilt with the base system prompt (session start, model/tool/settings change, branch, backend refresh), never per turn, and capped at `taste.injectionTokenLimit` approximate tokens:

```markdown
These preferences are the current store and take precedence over any conflicting statement …
## Preferences
- Prefers explicit return types on exported functions. Confidence: 0.62
## Retracted
- Do not follow (retracted 2026-10-30): Prefers barrel files everywhere
```

The precedence line matters because a compacted history keeps quoting preferences the store has since forgotten; `## Retracted` names those for 30 days so the model stops following them instead of trusting the older quote.

| Setting                      | Default | Description                                                                                              |
| ---------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `taste.enabled`              | `false` | Master flag: no extraction, consolidation, tool, or injection while off                                 |
| `taste.extractionMode`       | `prompt` | `prompt` extracts per user prompt, `window` batches committed discarded regions, `off` stops extraction |
| `taste.scoping`              | `per-project` | `global`, `per-project`, or `per-project-tagged`                                                   |
| `taste.minPromptLength`      | `16`    | Prompts shorter than this many characters are not extracted                                             |
| `taste.intervalMinutes`      | `5`     | Minimum minutes between consolidation runs                                                              |
| `taste.injectionTokenLimit`  | `600`   | Approximate token cap for the injected block                                                             |
| `taste.confidenceFloor`      | `0.6`   | Minimum injection score; below it an entry is cold-stored and not injected                              |
| `modelRoles.taste`           | unset   | Judge model; unset falls through `judge` to `@smol`, and no model leaves the layer at T0                |

The `/memory` command covers backend stores only; inspect and edit taste with the `super_memory` tool (`query`, `stats`, `resolve`, `forget`) or the file itself.

## Window learning

Compaction is the only automatic learning boundary in window mode. When a compaction commits, the discarded region — session entries strictly before the retained tail — is snapshotted once into a durable journal. The retained recent messages are not learned again, and the active window's tail is never read before it is discarded.

```yaml
taste:
   extractionMode: window   # prompt | window | off (default prompt)
memory:
   extractionMode: window   # auto | window | manual (default auto)
```

| Setting                   | Modes                        | Behavior                                                                                                      |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `taste.extractionMode`    | `prompt` / `window` / `off`  | `prompt` extracts per user prompt as before; `window` stops per-prompt extraction and batches after commits; `off` stops extraction entirely, while existing preferences stay injectable |
| `memory.extractionMode`   | `auto` / `window` / `manual` | `auto` keeps each backend's cadence; `window` learns only committed discarded regions plus one session-stop flush; `manual` leaves explicit tools and `/memory enqueue` as the only triggers |

The journal lives under `<agentDir>/memories/window-learning/<namespace>/<session>.json` and holds pending windows, processed window ids, processed entry ids, attempts, and the last error. The namespace is the SDK-resolved memory namespace: an `im:` binding scope or the canonical repository scope, never a cwd concatenation. A restart replays pending windows without re-extracting completed ones; a compaction commit listener only copies the discarded entries and advances the cursor, so it never runs a model or delays compaction.

A short session that ends without a compaction flushes once at stop. Backends implement this through their existing retention/queue paths with the window id as the deterministic source id; failed work remains visible in the journal and retries on the next agent end, session stop, or restart — no extra daemon or timer is created.

Model cost depends on the backend. A window batch is one larger request per committed region instead of many per-prompt calls, but it is a separate context with no cached main-conversation prefix. `mnemopi.llmMode: none` still makes no extra LLM requests: window memory retention stays host-only and taste window extraction is skipped. Tracking remains operational process state (tasks, status, plans); window learning does not turn tracking state into personal facts, and it reads only the current repository's tracking and stores.

## Key files

- `packages/coding-agent/src/memories/index.ts` — pipeline orchestration, injection, clear/enqueue entry points (the `/memory` command routes here via `packages/coding-agent/src/memory-backend/local-backend.ts`)
- `packages/coding-agent/src/memories/storage.ts` — SQLite-backed job queue and thread registry
- `packages/coding-agent/src/prompts/memories/` — memory prompt templates
- `packages/coding-agent/src/internal-urls/memory-protocol.ts` — `memory://` URL handler
- `packages/coding-agent/src/taste/` — taste layer: `store.ts` (Command Code format, state, tombstones), `extract.ts` + `queue.ts` (candidates), `window-extract.ts` (committed-window batches), `consolidate.ts` (evidence, conflicts, deletion), `score.ts` (Beta posterior, retention, injection score), `judge.ts` (T0/T1/T2), `inject.ts` (prompt block), `scheduler.ts` + `lifecycle.ts`
- `packages/coding-agent/src/memory-backend/window-learning.ts` + `window-queue.ts` — commit-boundary capture, durable processed cursor, and the serial retry drain (no daemon)
- `packages/coding-agent/src/tools/super-memory.ts` — the `super_memory` tool (see [Tools](./tools/super_memory.md))
