# Zeta Development Roadmap

Zeta is an OMP downstream distribution: the runtime tree, package layout, Bun
workflow, and internal `@zeta/*` names intentionally follow OMP so upstream
releases remain mergeable. This roadmap covers **Zeta-owned product surface
only** — capabilities built on top of the OMP runtime, never changes to the
sync tree itself.

## Upstream Position

Verified against `omp-upstream` (can1357/oh-my-pi) and `pi-upstream`
(earendil-works/pi): **neither upstream has a product roadmap document** (pi
carries only a technical `tui-plan.md`). We track upstream release tags, not
feature plans; re-check for roadmaps at each release sync and adjust if the
upstream position changes.

## Shipped (Zeta-originated capabilities)

These exist today and are marked in the root `README.md`:

| Capability | Where | Notes |
| --- | --- | --- |
| Adaptive long-term tracking (`autolearn`) | `packages/coding-agent/src/autolearn/` | Passive/active capture, standing system guidance kept prompt-cache stable |
| Experiment measurement (`autoresearch`) | `packages/coding-agent/src/autoresearch/` | Per-project SQLite experiments, metrics, baseline commits |
| TypeScript custom commands | `packages/coding-agent/src/extensibility/custom-commands/` | User commands from `~/.omp/commands/` + project dirs, arktype/typebox/zod arg schemas, bundled `ci-green`/`review` |
| Command marketplace (Bun-package distribution) | `slash-commands/builtin-marketplace.ts` | Install/uninstall commands as Bun packages |
| ACP collaboration builtins | `slash-commands/acp-builtins.ts` | Agent Client Protocol session commands |
| Local stats dashboard | `omp stats` (`packages/stats`) | Local observability |

## Priorities

### P0 — Compaction as a service (not a command)

OpenCode evolved `/compact` from a markdown command (V1) into a first-class
service: `SessionCompaction` handles planning, execution, and progress events,
and a dedicated **compaction agent** produces the summary
(`packages/core/src/session/compaction.ts` in opencode-v2). Zeta currently has
streaming compaction in `packages/agent/src/compaction/` but the same
service/agent split is not complete.

- **Acceptance**: manual + auto compaction share one pipeline; progress
  surfaced through events; the compaction call reuses the session
  `promptCacheKey` so it hits the provider prefix cache (see P0 tracking).

### P0 — Long-term tracking document + prompt-cache contract

The rule (already encoded in `autolearn/controller.ts`): **before the provider
caches the conversation, the model must have written current state into the
long-term tracking document**. Anything that would mutate the cached prefix
(hidden reminders, injected updates, tracking nudges) must go through the
document or a tool instead of the conversation. The standing system guidance
stays byte-stable so DeepSeek/Anthropic prefix caches survive long sessions,
and compaction resumes with the same cached prefix.

- **Acceptance**: any dynamic injection path either lands in the tracking
  document before cache write or is rejected by review; compaction requests
  share the session cache key.

### P1 — Migrate OpenCode's official commands (all three categories)

OpenCode commands fall into three kinds; migrate them in that order:

1. **Mechanism-triggering** (run code): e.g. compaction triggers, session
   operations — implemented as code, not text.
2. **Prompt-substitution** (expand to a prompt): `/init` (guided AGENTS.md
   setup, `initialize.txt`), `/review` (`review.txt`), plus `/update`, `/recipe`,
   `/share` equivalents where they fit Zeta.
3. **Combined** (template + arguments), using V2's command schema
   (`template`/`description`/`agent`/`model`) as reference.

### P1 — User-defined commands, completed

Zeta already has the TypeScript command layer (arbitrary logic or prompt
return, arg schemas). Remaining gaps vs OpenCode:

- Lightweight **markdown command files** (drop a `.md` in a command dir, add a
  description, use `$ARGUMENTS` in the body) — currently md commands exist only
  as builtins.
- **Hot reload**: OpenCode V2 reloads commands from `config.changes` with a
  debounce window; Zeta loads commands at startup.
- **`agent` field on commands** so a command can pin which agent/agent model
  runs it.

### P2 — Embedded MCP recognition

Recognize and configure project-analysis MCP servers automatically:

- **CodeGraph** (`@colbymchenry/codegraph`): local code-graph database
  (`.codegraph/`, SQLite + FTS5); one `codegraph_explore` call answers
  structural questions (call paths, blast radius, dynamic dispatch), file
  watcher auto-syncs. Same goal as `/init` (project cognition) but sustained —
  complementary, can stack.
- OpenCode's official MCP packages (fetch/playwright experiments) where they
  fit.
- **Name-collision/priority rules** for embedded MCP tools vs builtin tools.

### P3 — Tool-schema token budget

OpenCode's `autotools` lesson: a huge tool schema set costs large token
overhead (multi-ten-thousand-token tool definitions) and forced two-phase tool
decision. Right-size Zeta's tool schemas and consider two-phase selection.

### P1 — Context-file and prompt hot updates (agent-doc awareness)

Today the session system prompt is a signature-driven snapshot
(`session-tools.ts`): active tool names, tool labels/descriptions, MCP
projection, and MCP instruction text form a signature, and the prompt is only
rebuilt when that signature changes (or on explicit `refreshBaseSystemPrompt`
calls: model/agent switch, memory ops, commands). The provider request tools
list is dynamic per turn, but **AGENTS.md and other context files change is
not watched**: editing them mid-session does not reach the model until some
other trigger rebuilds the prompt.

- **Acceptance**: context-file changes (AGENTS.md/CLAUDE.md/…, custom prompts)
  are detected and diffed against the rendered base prompt; when the rendered
  bytes change, rebuild and clear the provider prompt-cache key per the P0
  tracking contract (a changing prefix means the old cache no longer applies —
  never ship a stale prefix).
- Distinct from full config hot-reload (V2-style debounced watchers for
  commands/agents) — that stays a later item.

### P3 — Compaction fidelity (QA detail retention)

Compacted summaries lose specifics that later turns need. Design distillation
with the tracking document as the durable store, so compaction never
singlesources context that must survive long sessions.

## Notes

- Everything here must land as Zeta-branded overlay/brand commits after
  release merges, never inside the sync tree.
- `document/upstream-sync.md` records the release-baseline ledger; this document
  is the product-side counterpart.
- Re-check upstream for competing roadmaps before each priority starts.