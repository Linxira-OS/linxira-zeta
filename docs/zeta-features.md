# Zeta features that differ from the upstream CLI

This page collects the product surfaces Zeta adds or changes relative to the
upstream agent it is based on. Everything here ships with `zetacode` (the docs
are embedded in the binary and served over `zeta://docs`) and with the npm
package.

## Terminal attach (backend-backed sessions)

`zetacode serve` hosts sessions for terminal clients that explicitly attach;
a bare launch is still a complete local TUI and never touches a running
backend.

- **Two explicit modes.** Bare `zetacode` owns its session in-process.
  `--attach`, `--attach-session`, `--attach-new`, `--backend` and
  `--backend-url` select backend mode; a missing backend is a startup error,
  not a silent local fallback.
- **Workspace + branch binding.** A session records the git branch of its
  workspace when it is created. `--attach` reuses the newest session for the
  current `(cwd, branch)` and creates one when that pair has none;
  `--attach-session <id>` may cross branches and warns which checkout the
  prompts will edit. `zetacode attach --list` prints every session as
  `id  cwd @ branch  age  name`, including sessions from other repositories.
- **Multiple live backends.** Every instance publishes under `~/.zeta/serve/`;
  attach probes all of them. More than one compatible instance without
  `--backend-url`/`--attach-session` is an error that lists the candidates.
- **Bot/relay sessions are never auto-attached.** Sessions tagged `relay`,
  `bot` or `draft` belong to IM channels and the shared web chat; addressing
  one explicitly still works.
- **Command surface.** The attached TUI runs client-side commands locally
  (`/language`, `/settings`, `/hotkeys`, `/tool`, `/time`,
  `/tracking`, `/changelog`, `/stats`, `/git`, `/copy`, `/export`, `/dump`,
  `/agents`, `/extensions`, `/hub`, `/pause`, `/record`,
  `/open`, `/debug`, `/quit`, `/exit`) and mirrors replica switches to the
  backend (`/model`, `/modelpreset`, `/switch`, `/effort`, `/plan`,
  `/plan-ultra`, `/plan-review`, `/goal`, `/vibe`). `/fast` and `/slow` are
  forwarded to the backend's headless handlers instead of toggling the
  replica; `/guided-goal` starts its interview in the backend session (the
  attached TUI mirrors the interview flag), so it is no longer refused. Every other slash command is executed by the backend against
  its own session (`/skills`, `/tools`, `/context`, `/usage`, `/jobs`,
  `/compact`, `/handoff`, `/retry`, `/rename`, `/mcp`, `/todo`, `/plugins`, …),
  and its `command_output` is shown in the attached status line. `/skills` and
  `/share` are prompt-only entry points: explicit invocation injects the
  built-in guide, and `/skills` install/update forwards to the backend so the
  agent installs in the workspace it is actually running in. `/status` no
  longer exists: the extension panel is `/extensions` only. There is no
  top-level `/theme` or `/help` builtin in the full TUI: change themes in
  `/settings` and open the shortcut sheet with `/hotkeys` (the lightweight
  `zetacode attach` client does answer `/help` with its own command list). `/queue` and the
  `->`/`=>` shorthands fill the backend's follow-up queue; `/btw` uses the
  backend side context. Session lifecycle is backend-owned
  and re-attaches the client: `/new`, `/resume <id>`, `/fork`, `/branch`,
  `/tree`, `/clear` and `/delete yes`; `/login` and `/logout` drive the
  backend's providers. `/restart` targets the backend by default
  (`/restart client` re-execs the TUI); `/omfg`, `/cleanse`, `/tan` and
  `/seance` run through backend headless handlers. `/setup` and `/providers`
  are retired in favor of `/login`; live-session collaboration (`/collab`,
  `/join`, `/leave`) is fully retired. `/live` is disabled
  product-wide until its Codex-only realtime transport is replaced. `/loop` is
  backend-executed: repetitions, its
  `--while`/`--until` shell condition, and `loop.mode` compact/reset actions
  run against the attached session, a second `/loop` stops it, Esc pauses it,
  and the status line mirrors that session's loop state. Plan approval renders the plan review overlay (plan
  content, approve/compact/refine/cancel) and executes the approved plan on the
  backend.
- **Dialogs** (`select`/`confirm`/`input`/`editor`/`ask`) fan out to every
  attached surface; the first answer wins.

## RPC control plane

`zetacode serve` exposes the same RPC protocol over WebSocket per session at
`ws://127.0.0.1:43143/api/rpc/ws?sessionId=<id>`, so a client can drive a
session the backend owns. `component_list` / `component_open` let companion
surfaces read the live TUI component tree. The full command list and framing
are in [rpc.md](./rpc.md#websocket-transport); generated TypeScript, Python,
Rust and Go clients consume the same schema.

## Stats dashboard

`zetacode stats` (and `zetacode serve`) runs the local observability dashboard
on `127.0.0.1:43147`: usage, costs, requests, errors, traces, tools, projects
and gain. The interface is fully translated (English / Simplified Chinese) and
has an **EN ⇄ 中文** switch in the top-right corner; the choice is remembered
in the browser. Numbers and dates follow the selected locale.

## Daemon and backend lifecycle

`zetacode daemon status|start|stop|restart|logs|install-autostart|uninstall-autostart`
manages the background backend. Starting twice is an idempotent no-op; stale
pids are cleaned up instead of blocking. Autostart is explicit (a user-level
service on Linux, a login item on Windows) and the command prints the written
path and how to undo it. See [daemon.md](./daemon.md).

## Work Studio (browser workbench)

Work Studio is the shipped browser surface. `zetacode serve` serves the
renderer (`web-app/`, a maintained fork of OMP Studio) same-origin with the
gateway, so one port is enough:

- the renderer build ships inside `@linxiraos/zeta` (`dist/web-app`); a source
  checkout can point `ZETA_WEB_APP_DIR` at `web-app/dist`, and the placeholder
  only appears when no build exists;
- the host contract is `/api/v1/*` (pair, CSRF, query, command, events), and
  the legacy Web Gateway REST surface (`/api/*`) is still served for
  compatibility;
- the retired `web-ui/` snapshot is abandoned and ships no build; it is not a
  supported way to run the UI.

See [zeta-serve-web.md](./zeta-serve-web.md) and
[web-ui/api.md](./web-ui/api.md).

## Desktop editions

Work Studio ships as a desktop application in two editions from one runtime:
the Electron edition (bundled Chromium, NSIS/zip/AppImage/deb) and the browser
edition (no bundled engine, launcher starts `zetacode serve` and opens the
default browser). Both carry the compiled `zeta` kernel, native addons and the
`web-app` renderer, so a target machine needs neither Bun nor Node. See
[desktop-app.md](./desktop-app.md).

## Ultra plan mode

Plan mode has three workflows: `/plan` (parallel, the default), `/plan-ultra`
(fan-out scouting, incremental plan writes, and the deepest decision floor), and
the `mode` tool / session API (`workflow: "iterative"`, which has no slash
entry — `/plan --iterative` is not parsed as a flag). The plan overlay supports
approve, compact, refine, and cancel; approval hands the plan to the goal loop.
Details and the approval matrix are in [plan-approval.md](./plan-approval.md).

## Project tracking

An opt-in, cross-session project record kept in `<project>/.zeta/tracking/`
(`tracking.enabled`). It holds progress, todo-phase state, decisions, actions,
compaction summaries and approved plans, written for people, agents, and
collaborators; the Work Studio tracking panel reads the same documents. See
[zeta-tracking.md](./zeta-tracking.md).

## Learning layers (memory, taste, tracking)

Three opt-in layers learn from a session without a hosted service:

- **memory** — durable project facts; backends and the `super_memory`/`retain`
  tools are in [memory.md](./memory.md);
- **taste** — durable preferences learned from each user prompt (main session
  only, short prompts skipped), judged with calibrated pseudo-counts and
  injected into the system prompt under a token cap;
- **tracking** — the cross-session project record described above.

Compaction and window summaries feed them; none of the layers require a
background model (the `memory`/`taste`/`judge` model roles are optional). See
[memory.md](./memory.md#taste-layer) and [zeta-tracking.md](./zeta-tracking.md).

## Agent hub and mesh

Subagents are first-class: **Agent Hub** is the TUI roster with live activity,
transcripts, steering, revive and kill (`Alt+A`, `Ctrl+S`); the **mesh**
extends `agent://` messaging across `zetacode serve` processes on one machine,
using the same hub/`agent://`/`ctx.messaging` model. See
[agent-hub.md](./agent-hub.md) and [agent-mesh.md](./agent-mesh.md).

## Agent modes, workspaces, and IM routing

Three product modes share one runtime: the **Coding Agent** (project cwd and
the existing coding prompt), the **Personal Harness** (the kept default
workspace, several main agents, computer control, and a project only when
explicitly bound), and the **PM / Super Agent** (manual project binding; board,
calendar, engineers and secretary). [agent-modes.md](./agent-modes.md) defines
them together with workspace, main agent, external binding, session origin
(`local` vs `im`), and relay, states which parts are IMPLEMENTED / PARTIAL /
PLANNED, and keeps Vibe, Advisor, and `/review` distinct.

## Plugin registry

Plugins come from the marketplace plus npm, git and local-link sources; the
installed set is the CLI's plugin lockfile, not a second store.
`GET /api/plugins` returns installed plugins with their declared `ui.panels`,
and the Work Studio Plugins page toggles the same store. See
[plugins.md](./plugins.md) and [marketplace.md](./marketplace.md).

## Usage dashboard

`zetacode stats` (and `zetacode serve`) hosts the local usage dashboard on
`127.0.0.1:43147`: year-long activity heatmap, per-model breakdown with legend,
today's hourly series, and deep links (`range=all`) from Work Studio. Reading
`GET /api/usage/daily` covers the same 400-day window.

## Companions and config

- Commands are `zetacode` (agent), `zetawork` (workbench) and `zetaide`
  (TermIDE); bare `zeta` prints the workbench help.
- Configuration lives under `.zeta` / `~/.zeta` only. The `OMP_*` and `PI_*`
  environment-variable prefixes are kept for compatibility with existing
  user configuration.
- IM channels (WeChat, Feishu, Telegram) are hosted by `zetacode serve`, not
  by the GUI: `zetacode channels` inspects, pairs and toggles them. See
  [channels.md](./channels.md).
