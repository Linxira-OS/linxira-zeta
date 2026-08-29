# Zeta Development Roadmap

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

| Capability | Where | Notes |
| --- | --- | --- |
| Long-term tracking documents | `packages/coding-agent/src/tools/tracking.ts` | `tracking_update` tool writes `<project>/.zeta/tracking/`; Web UI TrackingPanel. **Default OFF** — gated by `tracking.enabled` (opt-in) since v1.0.6 |
| Experiment measurement (`autoresearch`) | `packages/coding-agent/src/autoresearch/` | Per-project SQLite experiments, metrics, baseline commits |
| TypeScript custom commands | `packages/coding-agent/src/extensibility/custom-commands/` | User commands from `~/.zeta/commands/` + project dirs, arktype/typebox/zod arg schemas, bundled `ci-green`/`review` |
| Markdown command files | `src/discovery/builtin.ts` + `src/utils/command-args.ts` | `<config-dir>/commands/*.md` at user + project level, `$ARGUMENTS`/`$@`/`$1` substitution |
| Command marketplace (Bun-package distribution) | `slash-commands/builtin-marketplace.ts` | Install/uninstall commands as Bun packages |
| ACP collaboration builtins | `slash-commands/acp-builtins.ts` | Agent Client Protocol session commands |
| Local stats dashboard | `zeta stats` (`packages/stats`) | Local observability |
| IM channels (WeChat / Feishu / Telegram) | `packages/channels` + `src/channels/` | `ChatChannel`/`ChannelHost` interface, session router, `channel_send`/`workspace_run`/`im_control` tools, WeChat iLink QR login |
| Remote token auth + LAN exposure | `src/server/web-gateway.ts` (`authorizedForAccess`) | Non-loopback bind via `ZETA_SERVE_HOSTNAME` + `remote.token` (Bearer / `X-Zeta-Token` on every `/api/*`), CSRF origin guard, `docs/remote-workspaces.md` |
| Web-ui open-in-app buttons + update check | `src/server/web-gateway/open.ts`, `web-ui/components/AppShell.tsx` | `POST /api/open` (terminal / explorer / editors), `GET /api/open/options`, update check/download/install |
| Web-ui quick model import | `src/server/web-gateway/models.ts` | `GET /api/models/import?base=<url>` OpenAI-compatible discovery into `models.yml` |
| Web-ui stats iframe | `web-ui/components/StatsDashboard.tsx` | AppShell Stats tab rendering `NEXT_PUBLIC_STATS_URL` |
| Web-ui trajectory view | `web-ui/lib/trajectory.ts` + TrajectoryView/TrajectoryCell | Chat/Trajectory toggle, think/tool cells with duration + token counts, raw-entry inspector |
| Mermaid rendering (web + TUI) | `web-ui/components/MermaidBlock.tsx`, `packages/utils/src/mermaid-ascii.ts` | Web-ui strict-SVG render (`securityLevel: "strict"`); TUI ASCII render under `tui.renderMermaid` (default on) |
| Session sharing | `slash-commands/builtin-collaboration.ts` | `/share` slash command + `zeta share` encrypted link |

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
   a separate Zeta design. **Scheduled for v1.1.7** — approved design: migrate
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
   detail, acceptance): `document/web-ui-modernization.md` — amend that
   document in place; this entry stays a pointer.

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
2. **Prompt-substitution** (expand to a prompt): `/init` (guided AGENTS.md
   setup, `initialize.txt`), plus `/update`, `/recipe` equivalents where they
   fit Zeta. (`/review` and `/share` already shipped as bundled/builtin
   commands.)
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
+ zoom dialog); the TUI renders ASCII under `tui.renderMermaid` (default on,
`packages/utils/src/mermaid-ascii.ts`); the system prompt advertises mermaid
blocks. Remaining:

- **SVG fenced blocks in chat**: raw inline SVG is sanitized away today
  (`rehype-sanitize` default schema in `web-ui/lib/markdown.ts`), and
  `MarkdownBody.tsx` has no ```svg block path at all — an emitted SVG block
  renders as plain code even on desktop. Add the render path behind a
  security-reviewed sanitize decision (the XSS surface grows once the gateway
  is exposed to phones/WAN). No DOMPurify second layer exists today;
  mermaid's strict output is the only trusted SVG source.
- **Dynamic prompt adjustment (decided design)**: add an immutable
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
- A dedicated `render_mermaid` tool is no longer required for web/mobile;
  if a real `render_svg` tool is ever warranted, follow the surface-scoped
  sink pattern (see Surface-scoped tool exposure contract below).

### P0 — Channel tool sink wiring regression

The v18.0.9 merge dropped the `channelSend`/`workspaceRun`/`imControl` wiring
from the `toolSession` literal in `sdk.ts` (originally from `3e043195a4`; the
restore commit re-added the option declarations, `ToolSession` fields,
factories and `isToolAllowed` gates but not the wiring lines). All three
channel tools are inert in every session — serve coordinator and bot sessions
included. `bun run check:ts` cannot see it (optional fields compile clean) and
no test exercises the tools, so the regression is silent — a new member of the
post-merge damage class 4 (Zeta-only session-layer drops). Fix: restore the
three wiring keys, add a contract test (serve coordinator session exposes the
trio; CLI sessions never do), and gate sink wiring on the channels runtime
actually being started so a channel-less `zeta serve` never advertises tools
that fail at call time.

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
- No `taskDepth` guard exists for the trio in `isToolAllowed` (safe only
  because subagents never receive sinks — add the guard before any sink
  forwarding change).
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

### P2 — SSH remote command tool (extension recovery)

The plumbing already shipped: `zeta ssh` CLI, the `/ssh` slash command, and
`src/ssh/` (connection-manager, file-transfer, sshfs-mount). Remaining: an
agent-callable SSH exec tool via `ctx.registerTool` wrapping the retained
connection manager — no new protocol work needed.

### P2 — Bing search provider (core provider add, not an extension)

`web/search/providers/` has duckduckgo/google/startpage/ecosia/mojeek/public but
no `bing.ts`. Mirror `duckduckgo.ts` against the `cn.bing.com` endpoint and add
`bing` to `SEARCH_PROVIDER_OPTIONS` (`web/search/types.ts`). The extension API has
no `registerSearchProvider`, so this is a core change, not a plugin.
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

### P1 — Web-ui quick model import (OpenAI-compatible `/models` discovery)

ModelsConfig currently requires manual provider/model entry. Add
`GET /api/models/import?base=<url>` to the web gateway: fetch
`<base>/models` (OpenAI-compatible listing), parse `data[].id` (+ context
window where present), merge into `ModelsConfigFile`
(`~/.zeta/agent/models.yml`), and surface the discovered models in
ModelsConfig.tsx with context-window + thinking-effort columns. Reuses
`web-gateway/models.ts` infrastructure (`ModelRegistry`, `ModelsConfigFile`,
`getSupportedEfforts`).

### P1 — Web-ui open-in-app buttons (terminal / explorer / editor)

Add `POST /api/open` gateway handler: resolve registered apps via `$which`
(ported from `temp/openchamber`'s Electron logic — `wt.exe`/`pwsh`/`cmd`
terminal fallback chain, `explorer`/`xdg-open`/`open` file managers, and
`code`/`cursor`/`codium`/`windsurf`/`zed` editors), spawn against a
path validated by `allowed-roots`. AppShell top bar gains an "Open" dropdown
(terminal / file manager / detected editors) plus an "Update" entry that
checks `getLatestRelease()` (update-cli.ts), downloads the npm/binary release,
verifies SHA256, and prompts to restart for overwrite install.

### P1 — Web-ui settings coverage + refresh button

SettingsPanel now renders the full schema (all tabs/groups mirrored from
`GET /api/settings`). Remaining: wire a "Reload config" button to the existing
`POST /api/settings/reload` endpoint (built in `web-gateway/settings.ts`, no
UI caller yet).

### P1 — Stats dashboard iframe bridge

ZetaServer already reverse-proxies `/api/stats` to the stats dashboard but
serves the dashboard's static SPA only on its direct port. Add a "Stats" tab
to AppShell rendering `<iframe src={NEXT_PUBLIC_STATS_URL}>`; inject
`NEXT_PUBLIC_STATS_URL` from ZetaServer via web-ui-launcher (same pattern as
`ZETA_WEB_PORT`), and start stats unless `statsOnly` (not `webOnly`).

### P2 — Trajectory view (own session trace UI)

A "聊天 / 轨迹" toggle in the chat area re-layouts the existing
`SessionContext.messages` into a trace view: turn grouping via parentId,
step cells (user / assistant message with Think + token columns from
`usage`, tool call/result folded by `toolCallId` with
`result.timestamp - call.timestamp` duration), inspector panel with raw
entry JSON and a reconstructed (labeled "重建") prompt view. Pure-function
`deriveTrajectory` + React components, no DSH dependency.

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
2. **Lazy media for mobile**: `?deferMedia` blanks tool-result images with no
   fetch-back endpoint; add a blob-store read endpoint
   (`~/.zeta/agent/blobs`) so phone clients lazy-load images instead of
   pulling base64 inline.
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

## Notes

- Everything here must land as Zeta-branded overlay/brand commits after
  release merges, never inside the sync tree.
- `document/upstream-sync.md` records the release-baseline ledger; this document
  is the product-side counterpart.
- Re-check upstream for competing roadmaps before each priority starts.
