# Zeta Development Roadmap

> **当前执行计划**（UI 迁移、编辑器/终端两端、team agent 接入）见
> [webui-desktop-overhaul-plan.md](./webui-desktop-overhaul-plan.md)（2026-10-02 起；carryover 未完成批次已收编其 §14）。本文档保留长期
> 路线与 Shipped 记录；执行细节以该计划为准。文档规范：旧计划随新计划生效
> 即删；未开发的后期规划登记在本文档。

Zeta is an OMP downstream distribution: the runtime tree, package layout, Bun
workflow, and internal `@linxiraos/*` names intentionally follow OMP so upstream
releases remain mergeable. This roadmap covers **Zeta-owned product surface
only** — capabilities built on top of the OMP runtime, never changes to the
sync tree itself.

## Upstream Position

Verified against `zeta-upstream` (can1357/linxira-zeta) and `pi-upstream`
(earendil-works/pi): **neither upstream has a product roadmap document** (pi
carries only a technical `tui-plan.md`). We track upstream release tags, not
feature plans; re-check for roadmaps at each release sync and adjust if the
upstream position changes.

## Shipped (Zeta-originated capabilities)

These exist today (headline capabilities are marked in the root `README.md`):

| Capability                                     | Where                                                                       | Notes                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Long-term tracking documents                   | `packages/coding-agent/src/tools/tracking.ts`                               | `tracking_update` tool writes `<project>/.zeta/tracking/`; Web UI TrackingPanel. **Default OFF** — gated by `tracking.enabled` (opt-in) since v1.0.6     |
| Experiment measurement (`autoresearch`)        | `packages/coding-agent/src/autoresearch/`                                   | Per-project SQLite experiments, metrics, baseline commits                                                                                                |
| TypeScript custom commands                     | `packages/coding-agent/src/extensibility/custom-commands/`                  | User commands from `~/.zeta/commands/` + project dirs, arktype/typebox/zod arg schemas, bundled `ci-green`/`review`                                      |
| Markdown command files                         | `src/discovery/builtin.ts` + `src/utils/command-args.ts`                    | `<config-dir>/commands/*.md` at user + project level, `$ARGUMENTS`/`$@`/`$1` substitution                                                                |
| Command marketplace (Bun-package distribution) | `slash-commands/builtin-marketplace.ts`                                     | Install/uninstall commands as Bun packages                                                                                                               |
| ACP collaboration builtins                     | `slash-commands/acp-builtins.ts`                                            | Agent Client Protocol session commands                                                                                                                   |
| Local stats dashboard                          | `zeta stats` (`packages/stats`)                                             | Local observability                                                                                                                                      |
| IM channels (WeChat / Feishu / Telegram)       | `packages/channels` + `src/channels/`                                       | `ChatChannel`/`ChannelHost` interface, session router, `channel_send`/`workspace_run`/`im_control` tools, WeChat iLink QR login                          |
| Remote token auth + LAN exposure               | `src/server/web-gateway.ts` (`authorizedForAccess`)                         | Non-loopback bind via `ZETA_SERVE_HOSTNAME` + `remote.token` (Bearer / `X-Zeta-Token` on every `/api/*`), CSRF origin guard, `docs/remote-workspaces.md` |
| Web-ui open-in-app buttons + update check      | `src/server/web-gateway/open.ts`, `web-ui/components/AppShell.tsx`          | `POST /api/open` (terminal / explorer / editors), `GET /api/open/options`, update check/download/install                                                 |
| Web-ui quick model import                      | `src/server/web-gateway/models.ts`                                          | `GET /api/models/import?base=<url>` OpenAI-compatible discovery into `models.yml`                                                                        |
| Web-ui stats iframe                            | `web-ui/components/StatsDashboard.tsx`                                      | AppShell Stats tab rendering `NEXT_PUBLIC_STATS_URL`                                                                                                     |
| Web-ui trajectory view                         | `web-ui/lib/trajectory.ts` + TrajectoryView/TrajectoryCell                  | Chat/Trajectory toggle, think/tool cells with duration + token counts, raw-entry inspector                                                               |
| Mermaid rendering (web + TUI)                  | `web-ui/components/MermaidBlock.tsx`, `packages/utils/src/mermaid-ascii.ts` | Web-ui strict-SVG render (`securityLevel: "strict"`); TUI ASCII render under `tui.renderMermaid` (default on)                                            |
| Session sharing                                | `slash-commands/builtin-collaboration.ts`                                   | `/share` slash command + `zeta share` encrypted link                                                                                                     |

## Priorities

### P1 — Linux mainline distribution (from 1.1.19)

Starting with **1.1.19**, Zeta ships through the Linxira-OS Linux mainline as
a system package (user decision, 2026-09-22 — 1.1.18 remains npm/desktop-only
while the packaging lane is set up):

- **Repos (local clones under `F:/Linxira-OS/`, upstream on GitHub)**.
  Scope: the `zeta-desktop` shell (+ bundled `zeta` CLI) only — the vendored
  editor npm packages (`@linxiraos/editor*`) remain npm-only and are out of
  the system-package lane:
   - `Linxira-OS/packages` — PKGBUILD definitions; every package pinned to an
     upstream commit (`_commit` + codeload + sha256), built in a clean
     `archlinux:base-devel` container, signed, `repo-add`-ed.
   - `Linxira-OS/linxira-packages` — the published `[linxira]` pacman repo
     (x86_64 db + packages + signatures, GitHub Pages).
   - `Linxira-OS/linxira-update` — Arch-Update fork; the system update
     notifier/applier. **Zero extra config needed on our side**: once `zeta`
     is in `[linxira]`, update discovery and delivery are automatic.
- **Wiring checklist for 1.1.19**:
   1. `packages/packages/zeta/PKGBUILD` — decide packaging shape: install the
      pinned GitHub Release linux binary asset (simplest, sha256-pinned) vs
      source build via `bun` (heavier; Arch `bun` package dependency).
   2. `upstream-sync.toml`: add `[[track]] package = "zeta" repo =
"Linxira-OS/linxira-zeta"` — the daily scanner bumps the PKGBUILD from
      `releases/latest` automatically (draft/prerelease ignored), so every
      normal `release-v2.ts` release propagates with no manual step.
   3. Verify end-to-end: release v1.1.19 → sync bot bumps PKGBUILD → CI
      build/sign/repo-add → `pacman -Sy zeta` on a clean system →
      linxira-update offers the upgrade.

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

#### Desktop reference projects (upstream GUI clones)

Two upstream desktop shells are kept as local reference clones under `temp/`
(reference-only, never committed) and are the primary prior art for the next
batch of desktop work, together with the OMP Web snapshot (`temp/omp-web`):

- `temp/oh-my-pi-gui` — "omp GUI" (`@linxiraos/omp-gui`, Electron 35 + React
  19). Native desktop control center: parallel agent sessions, per-tool-call
  inspection, model and usage management. Closest match to Zeta's desktop
  shell ambitions (tray + workbench + session control).
- `temp/oh-my-pi-UI` — "OMP Codex" (`omp-gui`, Electron 38 beta + Vite +
  React 18). Codex-style desktop GUI driving the agent over `--mode rpc-ui`
  NDJSON-over-stdio, one subprocess per session, with a multi-session sidebar
  and per-directory session archiving. Reference for the rpc-ui transport
  contract and session-shell UX.

Of the three, the two GUI projects are the same category (desktop shells);
`omp-web` is the web surface, not a desktop shell. When the desktop track
starts, mine these for: session lifecycle over rpc-ui vs the gateway HTTP
contract, the parallel-session process model, tool-call timeline UX, and the
multi-session sidebar/archive interaction patterns. `temp/` is ignored and
must never be committed; nothing in these clones gets deleted — they are
sync sources for upstream work.

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

1. DONE — Web UI typecheck and desktop Linux/Windows/mac CI restored in the
   root `ci.yml`. Re-verified 2026-08-29 (v18.0.9 fallout-repair series on
   `main`; v18.0.10 sync PR #5).
2. Preserve and test project grouping plus concurrent-session status before any
   visual rework. **Constraints locked for the redesign**: final-answer fold
   grouping (`splitFinalAssistantBlocks`, compaction-anchor, live-tail
   non-folding), project grouping + running-session SSE contract stay intact.
3. Add the desktop bridge for file-manager/editor opening and its trusted-path
   contract.
4. Add the CLI desktop launcher and durable client/automation provenance.
5. Add AppImage packaging and Linux CI artifact validation; keep AUR deferred.
6. Recompose the workbench visual system and evaluate any multi-chat-pane UX as
   a separate Zeta design. **Scheduled for v1.1.10** — approved design: migrate
   the OpenChamber design language (CSS-var token system, full JSON theme
   engine, shadcn-style primitives, icon sprites) and adopt the three-pane
   Codex/ZCode desktop layout (project-grouped sidebar, surface tabs +
   context-usage ring in the header, right ContextPanel + icon rail).
   Connection-layer code is excluded by contract: all data stays on the Zeta
   gateway (`/api/sessions*`, `/api/agent/*`, `/api/settings`, `/api/git/*`,
   `/api/fs/*`); the OpenChamber settings page and CLI link logic are not
   ported — settings become a windowed, searchable surface over the existing
   gateway settings + `web.yml` contracts. Includes Tracking v2 (todo-phase
   binding, compaction-derived summaries under `<project>/.zeta/tracking/`,
   the memory-boundary prompt contract below, default-on) and a
   per-platform `web_ui_build` CI matrix (ubuntu/windows/macos). Steps 3-5
   (desktop bridge / launcher / AppImage) proceed as a parallel desktop track
   and gate the desktop-handoff completion, not the Web visual recomposition.
   Theme-system constraints from "Typography and visual work" above apply as
   hard rules: default `zeta-dark` (first launch dark), compact neutral
   surfaces, system UI font stack with CJK fallbacks (no remote font
   dependency), Starfield retained as a legacy optional theme only. Full
   design spec (locked decisions, layout tree, token inventory, tracking v2
   detail, acceptance): `document/webui-desktop-overhaul-plan.md` §14（收编自 plan-zeta-ui-carryover.md）— amend that
   document in place; this entry stays a pointer.
   Status (2026-09-03): Sidebar 重构红线 + openchamber 头部布局已落地
   (feat/webui-sidebar-overhaul；头部红线见 webui-desktop-overhaul-plan.md §14)；会话地图
   设计已登记 (`document/session-map-web.md`)；agent-team 插件设计已登记
   （本计划 §14 Z5+U11 批）。

### P0 — Compaction as a service (not a command)

OpenCode evolved `/compact` from a markdown command (V1) into a first-class
service: `SessionCompaction` handles planning, execution, and progress events,
and a dedicated **compaction agent** produces the summary
(`packages/core/src/session/compaction.ts` in opencode-v2). Zeta currently has
streaming compaction in `packages/agent/src/compaction/` but the same
service/agent split is not complete.

- **Status**: the shared manual/auto pipeline and the session `promptCacheKey`
  reuse are done (`session-maintenance.ts`, `compaction-v2-streaming.ts`).
- **Remaining acceptance**: a dedicated compaction agent split, and granular
  per-phase progress events (today only `auto_compaction_start`/`_end`).

### P0 — Long-term tracking document + prompt-cache contract

The rule (encoded in `src/tools/tracking.ts` + `src/prompts/tools/tracking.md`): **before the provider
caches the conversation, the model must have written current state into the
long-term tracking document**. Anything that would mutate the cached prefix
(hidden reminders, injected updates, tracking nudges) must go through the
document or a tool instead of the conversation. The standing system guidance
stays byte-stable so DeepSeek/Anthropic prefix caches survive long sessions,
and compaction resumes with the same cached prefix.

- **Status**: the tool, its `tracking.enabled` opt-in gate, and compaction's
  session cache-key sharing are done; the cache-write ordering rule itself is
  still unbuilt.
- **Remaining acceptance**: any dynamic injection path either lands in the
  tracking document before cache write or is rejected by review.

### P1 — Migrate OpenCode's official commands (all three categories)

OpenCode commands fall into three kinds; migrate them in that order:

1. **Mechanism-triggering** (run code): e.g. compaction triggers, session
   operations — implemented as code, not text.
2. **Prompt-substitution** (expand to a prompt): `/init` and `/update` have
   shipped (`cmdInitGenerateAgentsMd` bundled zh overlay; CLI `/update`);
   `/recipe` remains deferred with the removed-feature backlog — manage
   remaining prompt-substitution gaps together with the user-defined
   commands gaps below. (`/review` and `/share` already shipped as
   bundled/builtin commands.)
3. **Combined** (template + arguments), using V2's command schema
   (`template`/`description`/`agent`/`model`) as reference.

### P1 — User-defined commands, remaining gaps

Zeta already has the TypeScript command layer and markdown command files
(`<config-dir>/commands/*.md` at user + project level with `$ARGUMENTS`
substitution). Remaining gaps vs OpenCode:

- **Hot reload**: OpenCode V2 reloads commands from `config.changes` with a
  debounce window; Zeta loads commands at startup (`/reload-plugins` is manual).
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

### P2 — Mermaid/SVG chat rendering: remaining gaps

The revival shipped in a different shape than the original `render_mermaid`
tool plan, and most of it is done: web-ui renders ```mermaid fences via
`MermaidBlock.tsx` (`mermaid@^11`, `securityLevel: "strict"`, source/preview

- zoom dialog); the TUI renders ASCII under `tui.renderMermaid` (default on,
  `packages/utils/src/mermaid-ascii.ts`); the system prompt advertises mermaid
  blocks. Remaining:

* **SVG fenced blocks in chat**: raw inline SVG is sanitized away today
  (`rehype-sanitize` default schema in `web-ui/lib/markdown.ts`), and
  `MarkdownBody.tsx` has no ```svg block path at all — an emitted SVG block
  renders as plain code even on desktop. Add the render path behind a
  security-reviewed sanitize decision (the XSS surface grows once the gateway
  is exposed to phones/WAN). No DOMPurify second layer exists today;
  mermaid's strict output is the only trusted SVG source.
* **Dynamic prompt adjustment (decided design)**: add an immutable
  per-session `chatSvgRendering` surface option set at `createAgentSession`
  (CLI → false, serve → true; serve's only client is web-ui, so a
  process-level binary suffices — no per-client provenance needed). Extend
  the `{{#if renderMermaid}}` block in `prompts/system/system-prompt.md` into
  a three-branch template: SVG surfaces advertise that the model MAY emit
  ```svg blocks (rendered for the user); the `{{else}}` branch keeps today's
  ASCII wording. Do not read the flag from settings: prompt-render options
  sit outside the applied-tool signature and the web settings POST never
  refreshes running-session prompts — an immutable constructor value avoids
  cache drift entirely.
* A dedicated `render_mermaid` tool is no longer required for web/mobile;
  if a real `render_svg` tool is ever warranted, follow the surface-scoped
  sink pattern (see Surface-scoped tool exposure contract below).

* ~~P0 — Channel tool sink wiring regression~~ 已解决（1.1.9）：`sdk.ts` sinks 接线 + 顶层会话门控随 v18.1.10 同步落地。

* ~~P1 — pi-vcs restage race: apply-to-index silently no-ops for new files~~ 已解决：restage race 已修复，`issue-966-repro.test.ts` 隔离解除（文件内已无 skip，恢复为守卫）。

### P1 — Memory stability track (Windows OOM / render retention)

Background: v18-era Windows crashes — the process commits 64–72 GB until the
system commit limit breaks, then whichever native thread allocates first
panics with os error 1455 and the process dies with no traceback
(`document/v18-gix-status-oom-triage.md` has the full evidence chain). The
gix status spike is fixed upstream (c901f632fa, shipped in 18.1.1; arrived via
the v18.1.10 sync, PR #8). What remains is Zeta-owned validation and
self-protection on the Bun 1.4 base (Rust rewrite: mimalloc-backed JSC,
`process.on("memoryPressure")` on Windows, smaller binaries). Local dev
machines are already on Bun 1.4 (done out-of-band); the remaining work is
repo-side:

1. **Lockfile**: regenerate `bun.lock` under Bun 1.4 (lockfileVersion 1 →
   2). The CI bun-version pin concern is resolved — CI derives its bun
   floor from `packageManager` (`bun@>=1.4` already set); no
   `bun-version` pin remains to bump.
2. **Memory profiling harness**: a bounded soak script (scripted long session:
   large tool outputs + resize sequences) sampling rss/heap plus Windows
   commit; A/B matrix — Bun 1.3-built vs 1.4-built binaries, 18.0.x vs 18.1.x
   baseline, PowerShell vs third-party terminals. Evidence before tuning.
3. **memoryPressure shed hook**: subscribe on Windows; on system memory
   pressure, shed render caches (transcript render retention, markdown cache)
   — degrade to a smaller UI instead of dying at 1455. Contract test: the
   shed fires, caches shrink, re-render restores full state.
4. **Transcript render memory bound**: port the upstream farm fix f6a646d305
   (bounded retained transcript render memory: weighted markdown cache
   entries by retained bytes, release finalized blocks after native scrollback
   commits) if the v18.1.x sync does not carry it — that fix is still unmerged
   upstream.
5. **CI memory guardrails**: (a) unit-level retained-bytes caps for
   transcript/markdown caches; (b) a bounded headless soak integration test
   (2–3 min, commit/RSS threshold — conservative for shared runners);
   (c) desktop memory smoke in the existing desktop jobs asserting aggregate
   multi-process footprint (upstream #9908 measured 6.89 GiB across 9
   processes); (d) a Windows status-path panic-catch contract test.
6. **Desktop memory visibility**: periodic per-process + aggregate memory
   sampling in `desktop/src/main.ts` boot/heartbeat logging.

The v18.1.10 sync has merged (PR #8) and rides the 1.1.9 release; everything
lands as Zeta overlay commits on that baseline, except item 1, which is
build-infra and can land independently.

### P1 — Plan mode detail ceiling (length-bound plans)

Two mechanical caps keep long plans from being written or amended in
detail (root-caused 2026-08-30):

1. **Single-response output ceiling**: a full-replacement `write` of the
   plan must fit one model response's tool arguments
   (`model.maxTokens`, often the legacy 32000 catalog value; providers
   clamp at 64k, `packages/ai/src/stream.ts:1712-1722`). On overflow the
   entire tool call is abandoned (`packages/agent/src/agent-loop.ts`
   stop-reason handling), so models self-compress plans.
2. **300-line read window**: `read.defaultLimit` defaults to 300
   (`config/settings-schema.ts`), and plan mode instructs the model to
   re-read and incrementally amend its plan — every amendment beyond line
   300 operated blind, silently dropping details across rounds; the
   executor's mandatory plan read had the same window. (The approval,
   export, and compaction chain never truncates: the file is read and
   written whole end to end.)

Fixes: the read tool now gives plan files the full default window
(`readTargetsPlan` on `local://PLAN.md` / the plan reference path,
explicit selectors still win), and `/plan-ultra` (workflow `ultra`)
carries an always-on incremental-write discipline (edit `PUT >N*`
appends + `CUT` deletions, never full-replacement writes; explicit
high-limit re-reads). The original plan-mode prompt is unchanged.

### P1 — Surface-scoped tool exposure contract

The channel-trio pattern is the canonical mechanism for surface-targeted
tools: sink presence on `CreateAgentSessionOptions` → `ToolSession` field →
`BUILTIN_TOOLS` factory returning `null` without the sink → `isToolAllowed`
double gate → fail-closed `execute()`. Availability is construction-time
wiring, not a runtime gate — only the serve coordinator
(`zeta-server.ts #ensureMainSession`) and bot sessions receive sinks;
`SessionRouter.open()` workspace sessions, temp web-opened sessions, and
subagents never do. Preserve that invariant in merges. Hardening remaining:

- `channels.enabled` is an opt-out (default true); settings copy must not
  imply the toggle grants capability.
- Bot sessions hold the full sink set including absolute-path `workspace_run`
  delegation (by design; revisit if the surface widens).
- Future surface-conditional prompt options must be immutable per session
  (see Mermaid/SVG above) or paired with an explicit
  `refreshBaseSystemPrompt` on every surface that can flip them.

### P2 — Memory ↔ tracking boundary (prompt contract)

`prompts/tools/tracking.md` gains a hard constraint: tracking = project-level
working state (plan/progress/blockers/decisions) that travels with the project;
memory = learned facts across projects. tracking must never store learned
facts — cross-reference by topic into memory instead. `/tracking start` copy
already points users at the Web UI panel; extend it to name the memory
boundary and the `tracking.enabled` gate.

### P2 — Stats read-only tracking snapshot (cross-package)

`packages/stats` gets a read-only `/api/tracking` snapshot (status.json /
INDEX.md / actions.jsonl / sessions/*.md under `<project>/.zeta/tracking/`),
with a self-contained `TrackingSnapshot` type — stats must not import
coding-agent types. `getProjectTrackingDir` is already exported from
`packages/utils`; the stats-side endpoint + type remain. (Web UI already has a
TrackingPanel wired to the gateway; this is the stats-dashboard-side panel.)

### P2 — SSH remote command tool — DONE (v1.1.17)

The `ssh_exec` agent tool shipped in v1.1.17 (PR #34): `ctx.registerTool`
wrapping the retained connection manager (`zeta ssh` CLI, `/ssh`, and
`src/ssh/` plumbing). Done.

### P3 — Vim input mode extension

`pi-vimmode` (github.com/pekochan069/pi-vimmode, npm `pi-vimmode`, install via
`pi install npm:pi-vimmode`) provides vim keybindings for the prompt input box
only (not file editing). Peer deps pin upstream `@earendil-works/pi-*@^0.77.0`;
Zeta integration requires a coordinate migration to `@linxiraos/*` (or legacy
shim). Deferred until the P0/P1 queue clears; other removed upstream features
(ssh/Bing/calc/recipe) have no ready-made extension repos — build in-house if
wanted.

### P3 — Removed-feature backlog (build in-house if wanted)

Other upstream-removed capabilities with no ready-made extension repo. Track as
low-priority; build in-house on demand: calc / recipe tools, code_search, python
tool, `/background`, `/shake` summary, oracle/plan subagents, `notebook.enabled`,
git context, shimmer, `plan://`, `jobs://`. Each needs its own scoping pass
before work starts.

### P1 — Web-ui settings coverage + refresh button

SettingsPanel now renders the full schema (all tabs/groups mirrored from
`GET /api/settings`). Remaining: wire a "Reload config" button to the existing
`POST /api/settings/reload` endpoint (built in `web-gateway/settings.ts`, no
UI caller yet).

### P1 — Mobile remote control (phone-first web access)

Phone control of the desktop agent over the user's own network path. **No
embedded tunneling**: users bring their own port mapping, server, or frp; Zeta's
job is to make the served endpoint safe to expose and the UI phone-first.

Shipped foundation: non-loopback bind via `ZETA_SERVE_HOSTNAME` with the
`remote.token` gate (`authorizedForAccess` — Bearer / `X-Zeta-Token` on every
`/api/*`, CSRF origin guard), token rows in SettingsPanel, and
`docs/remote-workspaces.md`; IM channels (WeChat/Feishu/Telegram — see
Shipped); full conversation reconstruction over REST + SSE
(`/api/sessions/:id/context`, `/api/agent/:id/events`), including thinking
blocks and inline media.

Remaining:

1. **Exposure hardening**: a `--host` flag on `zeta serve` (today env-only);
   optional built-in TLS listener (`Bun.serve tls`) plus documented
   reverse-proxy (caddy/nginx) recipes — never silent plain-HTTP beyond the
   LAN; a pairing QR in settings/desktop encoding `URL + token` (reuse
   `utils/qrcode.ts`) so the phone pairs by scanning; token rotation/revocation
   and rate limiting on the auth gate for WAN exposure.
2. **Lazy media for mobile**: the blob-store read endpoint is in place —
   `GET /api/blobs/:hash` (web-gateway) serves `~/.zeta/agent/blobs` for
   fetch-back. Remaining: wire lazy fetch-back into web-ui
   (`useAgentSession` still only sends `?deferMedia`).
3. **Mobile web-ui**: PWA manifest + service worker (installable, offline
   shell) on top of the existing responsive pass; voice input rides the native
   IME (zero work) — an optional Web Speech API mic button can come later.
4. **Android shell (later)**: a thin WebView wrapper of the same web-ui build
   pointing at a user-configured URL only — no business logic, no tunneling,
   and no new workflow file (checks live in the root `ci.yml`).
5. **Transport**: SSE stays the preserved contract; no WebSocket rewrite for
   mobile.

### P3 — IM channel wave 2 (post first-wave)

Discord, Slack, Matrix, Signal, SMS/Twilio, LINE, Teams, IRC, Mattermost —
each is an adapter over the same minimal channel interface; add on demand,
reference `temp/openclaw-ref` (checked out for this survey) for wire
protocols and auth flows.

### DONE — Full-surface CLI i18n (feat/i18n-overlay, post v1.1.17)

v1.1.16's renderer migration into `@linxiraos/pi-tui` (0d6dbd32fc) orphaned
the i18n bundle from every migrated panel — zh fell back to English across
Settings, the MCP wizard, selectors, setup, and chat chrome. Fixed with a
host-injectable text layer:

- `packages/tui/src/i18n.ts`: `setTuiTextSource` / `tuiText(key, fallback)` —
  inline English is the permanent fallback; the coding-agent wires the source
  to the live `M` proxy (`src/i18n/wire-tui.ts`, registered at
  `InteractiveMode` boot), so `/language` switches apply on the next render.
- Settings rows localize host-side: `createSettingsHost` applies the
  `settings-zh.ts` overlay (`localizeSettingUi`) to labels, descriptions,
  groups, and submenu options — same data the gateway panel uses.
- ~700 keys wired across all tui panels, setup scenes, chat/status-line/tool
  meta, and coding-agent controllers; `scripts/check-i18n-consistency.ts`
  guards en/zh/messages parity (baseline drift pre-dates this branch).
- Desktop tray "Open Settings" fixed: `/?panel=settings` deep link
  (web-ui `initial-navigation` + AppShell) and a `/settings` 307 redirect;
  the tray click now shows the window before navigating.
- Sentinels stay byte-stable: `USER_INTERRUPT_LABEL`,
  `GENERIC_ABORT_SENTINEL`, `GUEST_ACTION_LABELS` — only render sites map.

Remaining (non-blocking): the ~27 welcome tips have zh entries but are
English-only content pools for other locales; the git-TUI and debug apps
carry the last ~40 low-priority strings.

### DONE — plan-surface completion A+B (feat/plan-surface-completion, 2026-09-22)

The A+B remainder of
[webui-desktop-overhaul-plan.md](./webui-desktop-overhaul-plan.md) (§14, folded 2026-10-02) has
landed: minimal shell wrap-up (settings-only bottom entry, collapse rail,
welcome dual selector), command palette (Ctrl+K), Shiki over
react-syntax-highlighter, windowed searchable settings, gateway plan endpoint

- sidebar Plan card, tracking.enabled gating, and Tracking v2 (sync_todo,
  index template, object index, status stage/phases, plan mirroring, phase
  nudge). C-level items (CM6, PTY terminal, team agent M0-M2, 7 remaining
  skills, onboarding) stay in §11.2 for separate plans; per-section status is
  annotated inline in that document. U2 (9e7c4e4251f) has landed as well.

### P2 — TTT editor About branding (remaining scope; zh UI done)

The vendored TTT editor (`editor/`, shipped as `@linxiraos/editor` +
`zeta-editor`) predates the tui text layer.

- ~~**zh UI**~~ DONE: `editor/internal/app/i18n.go` now carries a full zh
  string table (settings tabs/labels, menus, footer actions, dialog
  chrome); the settings view exposes an English/中文（简体） selector.
- **About branding (remaining)**: upstream attribution is already cleaned —
  Source points at `github.com/Linxira-OS/linxira-zeta` and the upstream
  website line is gone (VENDOR.md). Still upstream-flavored: the dialog
  title remains "About TTT Editor" and the version line shows TTT's own
  semver. Remaining work: a Zeta distribution identity line
  (`Zeta Editor · v<zeta version> · TTT <upstream version>`),
  Chinese-first copy.

## Deferred Queue(未开发的后期规划;开发启动时移入执行计划)

- **tea CLI 工具套件(2026-10-07 用户裁决:下一批次一次性到位,下一版本发布前交付)**:为
  自托管 Gitea 与 gitea.com 提供 gh 工具族对等集成。侦察完成,配方:①`utils/gitea.ts`
  运行器(克隆 github.ts:which("tea")/非交互 env/5min deadline/8MiB 截断,错误映射
  "运行 `tea login`")②`tea-common.ts`(owner/repo 解析,实例→login 读 tea config.yml)
  ③`tea.ts` 单工具 op 判别联合(omptype),createIf 判二进制,approval 按操作分类
  ④注册三点(builtin-names/BUILTIN_TOOLS/isToolAllowed `gitea.enabled` 默认 false)
  ⑤prompts/tools/gitea.md + docs/tools/gitea.md + test/tools/tea.test.ts。二期:
  issue://、pr:// 内部 URL 族 + SQLite 缓存(凭据指纹法)+ run watch(Gitea Actions,
  runs-on 仅认 self-hosted/ubuntu-latest)。设计输入:tea repo create 静默失败
  (URL 打印但仓不存在),push-create 可靠——建仓操作优先 push-create 或 API 回读验证。
  实测环境:LAN NAS Gitea 28(192.168.11.172:3000,SSH 2222 别名 gitea,钥匙
  BHYS-gitea-lan;git 调用需显式 -i 钥匙,本仓曾 shallow 需先 unshallow)。

- **上游合并队列**:v18.4.3(五 tag 直拉,v18.3.5/40/41/42/43 一次并入,
  288 冲突,账本见 upstream-sync.md)已落 dev/main;dev→main 合并待决策。
  上游性能大年获益:cache-warming、投机 task 启动、grep 流式背压、
  Oniguruma 高亮、TUI 每帧渲染清扫。**后续遗留**:image
  `providers.imageOrder` 的 role-chain 重集成(运行时消费随上游旧 candidate
  循环删除而失活,设置面/测试契约保留);v18.4.4 在 sync worktree
  在途(4 commits 未进 main)。

- **pi v1.0.0 语义移植评估(2026-10-02 四子代理调查,结论入账)**:对比
  基线=上游树上 pi 重写点(5d826095780≈v0.30.x,2026-01-01)→pi v1.0.0,我方
  基线 977ec83(2026-07-31)距其 1389 提交。裁决:**durable 子系统暂缓**——
  OMP 作者有主动引入意愿,等上游带进来再随 release 合并吸收,不自建。其余按
  优先级排队:①codemode/tool_search 官方内置扩展激活(defaultTools 设置页
  组,默认关)②cacheWarming 三档(上游已合并面,核对设置页暴露)③TUI/UX
  开关包(默认关清单逐项裁断)④provider stream events 语义移植。官方插件
  生态参照:llama.cpp/codemode/tool_search/mcp 四内置,replaceable:true 让位
  机制,tuiText(key,fallback) 宿主注入 i18n。
- **teamagent 修正(pi-messenger 插件审计,2026-10-02)**:必修①user scope
  死目录(~/.zeta/agents → getAgentDir()/agents);强烈建议②默认 scope 与官
  方安全姿态相反(project 需 opt-in+trust 确认,isProjectTrusted 勿桩 true)
  ③非编辑角色缺 tools 最小权限④thinking-level→thinkingLevel 键名⑤删除失
  实重启提示;小项:usage 文案、--user/--project 冲突不报错、零测试覆盖、
  .pi 品牌路径残留(crew/team/*)。随 feat 分支落地,不经 dev/*。
- **web-ui/桌面侧栏大修(2026-10-02 用户裁决,发布硬门)**:下一次发布 CI
  前必须完成,否则不许上线。执行计划见 document/webui-desktop-overhaul-plan
  .md(项目分组 IA、hover 浮现 + 新建入口、会话命名/空会话折叠、死代码清
  理;桌面壳零代码改动,仅重建嵌入)。
- **stats dashboard 品牌面修复(2026-10-02 用户裁决)**:π logo/omp 字样/
  "Everything omp did" 全量 Zeta 化;数据源若解析上游目录需切回 .zeta 根。
- **rail 拖拽排序**:dnd-kit 垂直排序 + localStorage 持久化(随 U6
  SidePane 框架一起评估)。
- **web_ui_build windows-2022 恢复**:跟踪 vercel/next.js#40760 家族上游
  修复,可修则 revert matrix 裁剪提交。
- **TUI 套件命名定稿与 zeta 工作台(2026-09-30 用户裁定,取代上方的
  "TUI 三件套整合设计"旧条)**:产品形态 = `zeta` 打开**嵌套终端工作台**
  ——一个终端进程,顶层标签页(tab = 窗格布局快照),窗格为真实 PTY 嵌
  终端(zeta-c / zeta-e / shell 皆为子进程),快捷键+菜单快速打开自家工
  具,四件套各自独立启动、help 各自独立。命名:`zeta-c`/`zeta-cli`/
  `zetacode` = coding CLI(@linxiraos/zeta 换 bin 不换包);`zeta-editor`/
  `zeta-e` = ttt;`zeta-ide`/`zeta-i` = termide(由未发布的
  @linxiraos/work 更名);`zeta` = @linxiraos/main(新,工作台本体,
  main/ 独立 Rust workspace,path 依 termide crates);files = 终端文件
  管理器(superfile 暂缓,候选调研中)。两个 IDE(ttt 与 termide)并存
  观察,不二选一。参照系:OpenCode 的多 tab 在其 app 层
  (SessionTab/DraftTab + 持久化,packages/app/src/context/tabs.tsx),
  终端 TUI 无分屏;OpenTUI = Zig 核心 + TS 应用层,不合纯 Rust——我们
  的形态(真 PTY 窗格)更强,壳坚定 Rust。**发包规矩(用户裁定)**:新包
  (@linxiraos/main、ide 系)先由用户手动以现行版本号(1.1.21)首发占
  位,之后用户在 npm 配好 trusted publishing,再接自动发布链
  (main-publish.yml 已备未接线);每次发包全包系统一版本号(无论有无
  changelog),但依赖不强制最新(main 可引用旧版叶子)。**工作台交互准则
  (2026-09-30 用户裁定):零快捷键基线** —— 一切界面元素都要能鼠标高
  效点击(标签切换/新建/关闭、窗格聚焦/关闭、布局切换、退出、菜单、
  设置),快捷键只做可选加速器;这从根上消解跨工具热键冲突(工作台
  Alt 平面 vs files/两个 editor/zeta-c 各自的键位,冲突最多损失加速、
  不损失功能),设置页/自定义键位按此准则设计。迭代队列:**真菜单栏
  系统**(顶部标签栏+可展开菜单栏,File/Pane/Tab/Tools/Settings 树)、
  **设置页**(键位/主题/默认 shell/套件路径等)+ 自定义键位、
  任意拖拽布局编辑器、files 选型集成、tab 会话/handoff 联动
  (handoff.json 机制扩展)、官网更新(用户提供仓库位置后跨文件改)。
  **拖拽交互现状(2026-10-02 更新)**:拖拽已是设置项且默认开启
  (settings.rs `drag` 默认 true,app.rs drag_enabled() 接线;窗格拖拽
  交换/移靠/拉伸、标签拖拽重排全接线,重启即回)。停用走 settings
  文件开关,并非早期设想的 `DRAG_ENABLED=false` 编译期停用。
  **参照系(用户指定,2026-10-01)**:交互逻辑持续对照 vendored 的
  GPL-2.0 项目 fresh(temp/fresh,sinelaw/fresh 终端编辑器)——其核心经
  验已吸收:命中区在绘制时登记、鼠标事件只查登记表(rendered geometry
  即 hit geometry,app.rs 的 HitRegistry 即由此来);后续菜单/拖拽/设置
  页迭代继续以它为标杆。**已落(2026-09-30)**:鼠标路由第一层(标签栏 ‹›步进/点击切换/
  活动标签×关闭/＋新建;状态栏 [layout]/[quit] 可点;点击窗格聚焦;
  聚焦窗格标题 ✕ 关闭;活动标签 ▸+粗体下划线高亮)、缺套件工具时
  窗格内一键 npm 快装(cmd /k 保窗可见)、帮助层非模态(曾吞掉
  Alt+T 等全部热键)、Windows 默认 shell 修正(pwsh/powershell,不再
  落 System32 bash.exe 的 WSL 陷阱)、无色 chrome(终端自身底色)。

## Notes

- Everything here must land as Zeta-branded overlay/brand commits after
  release merges, never inside the sync tree.
- `document/upstream-sync.md` records the release-baseline ledger; this document
  is the product-side counterpart.
- Re-check upstream for competing roadmaps before each priority starts.
