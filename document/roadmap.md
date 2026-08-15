# Zeta Development Roadmap

Zeta is an OMP downstream distribution: the runtime tree, package layout, Bun
workflow, and internal `@linxiraos/*` names intentionally follow OMP so upstream
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
| TypeScript custom commands | `packages/coding-agent/src/extensibility/custom-commands/` | User commands from `~/.zeta/commands/` + project dirs, arktype/typebox/zod arg schemas, bundled `ci-green`/`review` |
| Command marketplace (Bun-package distribution) | `slash-commands/builtin-marketplace.ts` | Install/uninstall commands as Bun packages |
| ACP collaboration builtins | `slash-commands/acp-builtins.ts` | Agent Client Protocol session commands |
| Local stats dashboard | `omp stats` (`packages/stats`) | Local observability |

## Priorities

### P0 - Web workbench foundation and desktop handoff

Zeta Web is a local-first coding workbench built on the OMP Web snapshot. It
must remain one product with the CLI and desktop shell: all three clients read
and continue the same durable sessions, but each client exposes only the
capabilities that its execution environment can actually provide.

#### Information architecture and existing contract

- The left rail groups sessions by project root, including linked worktrees;
  it is the project switcher and session list, not a separate global history.
- The center is the selected session's conversation and composer. The right
  rail is project/session context: open file tabs, file explorer, Git changes,
  task progress, and later terminal or review surfaces. It must not become a
  second unrelated navigation system.
- The current OMP Web baseline already supports multiple concurrently running
  sessions in one window. `runningSessionIds`, the running-session SSE stream,
  project grouping, and unread-completion markers are a preserved contract.
  One center conversation is selected at a time while other agents continue in
  the background.
- Multiple visible center-chat tabs or split chat panes are not a shared Pi Web
  feature. They are a future Zeta UX decision, not part of the initial Web
  recovery or a Pi Web port. File tabs in the right rail remain independent.

#### Desktop project opening

- The top bar will offer `Open in editor` and `Open in file manager` for the
  trusted, selected project directory. These controls appear only when a local
  desktop host can perform the action; browser-only Web UI must not pretend it
  has native process access.
- `Open in file manager` always delegates to the operating system's default
  handler. It must use generic wording: the default may be Dolphin on Linux,
  File Explorer on Windows, Finder on macOS, or another user-selected manager.
  Do not hard-code a distribution, desktop environment, or file-manager name.
- `Open in editor` must be backed by a host-owned editor discovery and launch
  capability. The renderer may select only an editor ID returned by the host;
  it must never send an executable path, shell command, or arbitrary arguments
  across IPC. A default-editor or OS `Open with` handoff is an acceptable
  fallback when a selectable editor cannot be resolved.
- Electron's `shell.openPath()` is sufficient for the default file-manager
  action but not for a selectable editor. Add a narrow preload/context bridge
  and validated main-process IPC before exposing this UI. The current desktop
  shell intentionally has neither bridge nor IPC handler.
- OpenCode is interaction reference only. Its current static list of known app
  commands is not sufficient for Zeta's requirement to support system-registered
  editors, so do not copy that list as the product implementation.

#### Client identity and launcher contract

- The npm `zeta` binary remains the CLI and must never launch the desktop app
  implicitly. Desktop installation must not replace or shadow that command.
- A later `zeta desktop [directory]` subcommand and `zeta-d [directory]` alias
  launch an installed desktop host for the supplied directory, defaulting to
  the current working directory. If no compatible desktop host is installed,
  they return a clear unavailable result rather than opening a browser or
  silently changing CLI behavior.
- The desktop executable stays separately named, for example `zeta-desktop`,
  so platform registration and PATH discovery cannot collide with the npm CLI.
- Session/run provenance needs an explicit cross-client contract. `cli`, `web`,
  `desktop`, and non-interactive automation must be recorded by the initiating
  client rather than inferred by another UI from a cwd or URL. The Web UI can
  then label client-specific actions accurately while all clients keep one
  transcript and session identity. Define this as durable metadata or a
  compatible event before adding presentation badges.

#### Upstream port boundary

- `web-ui/` remains the OMP Web snapshot. OMP UI behavior is the baseline;
  Pi Web is a semantic-port source only.
- A Pi Web change may be ported only when its user-visible UI behavior is shared
  with, or cleanly extends, the OMP Web product without replacing OMP session,
  auth, model, plugin, or configuration architecture. Record the source
  evidence and use a focused `port/pi-web/<scope>` branch.
- Preserve the OMP running-session SSE implementation. Pi Web's polling
  implementation is not an upgrade candidate.
- Do not import Pi-only runtime facades or migrate Pi-only product features just
  because their components compile. In particular, Pi `ModelRuntime`, service
  factories, legacy package management, and their storage assumptions are not
  Web UI compatibility layers for Zeta.

#### Typography and visual work

- HarmonyOS Sans is rejected for the default Web UI. Do not make UI readability
  depend on it, or on an arbitrary locally installed font.
- Until a reviewed redistributable font is selected, use a system UI stack with
  CJK fallbacks: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
  "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", sans-serif`.
  Maple Mono may remain an optional code font with normal monospace fallbacks;
  it is not the UI chrome font.
- A future bundled font must have a documented redistributable license and
  source. Do not add a remote Google font dependency for the desktop default.
- The current Starfield treatment is an optional legacy theme only. The later
  default workbench redesign uses compact neutral surfaces, semantic state
  colors, and stable panels rather than decorative grids, display fonts, or
  themed feature chrome.

#### Linux desktop delivery

- WSL, including an Arch-based environment, is suitable for local functional
  development. Ubuntu CI is the authoritative environment for reproducible
  Linux packaging and artifact validation.
- Required Linux x64 release assets are `.deb` and AppImage. The existing
  archive may remain a build/smoke artifact until a separate release-policy
  decision changes it.
- Do not create, publish, or modify an AUR package or an organization package
  repository. AUR support is explicitly deferred.
- Linux desktop CI must build the Web UI and desktop shell, run platform and
  unpacked-app smoke checks, verify the `.deb` and AppImage exist, upload both
  release assets, and feed them into the GitHub release checksum step.

#### Delivery order

1. Restore the Web UI typecheck and desktop Linux/Windows CI by semantically
   porting the legacy Web runtime calls to current Zeta APIs.
2. Preserve and test project grouping plus concurrent-session status before any
   visual rework.
3. Add the desktop bridge for file-manager/editor opening and its trusted-path
   contract.
4. Add the CLI desktop launcher and durable client/automation provenance.
5. Add AppImage packaging and Linux CI artifact validation; keep AUR deferred.
6. Recompose the workbench visual system and evaluate any multi-chat-pane UX as
   a separate Zeta design.

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
