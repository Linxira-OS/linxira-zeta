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
  (`/language`, `/theme`, `/settings`, `/hotkeys`, `/tool`, `/time`,
  `/tracking`, `/changelog`, `/stats`, `/git`, `/copy`, `/export`, `/dump`,
  `/help`, `/agents`, `/extensions`, `/hub`, `/pause`, `/record`,
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
  longer exists: the extension panel is `/extensions` only. `/queue` and the
  `->`/`=>` shorthands fill the backend's follow-up queue; `/btw` uses the
  backend side context. Session lifecycle is backend-owned
  and re-attaches the client: `/new`, `/resume <id>`, `/fork`, `/branch`,
  `/tree`, `/clear` and `/delete yes`; `/login` and `/logout` drive the
  backend's providers. `/restart` targets the backend by default
  (`/restart client` re-execs the TUI); `/omfg`, `/cleanse`, `/tan` and
  `/seance` run through backend headless handlers. `/setup` and `/providers`
  are retired in favor of `/login`; `/collab`, `/join` and `/leave` are opt-in
  legacy collaboration, hidden on fresh installs. `/live` is disabled
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

## Web UI status (deferred)

The Web UI's development is **deferred**. Neither the package nor the release
artifacts ship a Web UI build; `zetacode serve` answers the web port
(`127.0.0.1:43141`) with a bilingual placeholder page that states the
interface is being completed. The Stats Dashboard and the terminal attach
client are unaffected. A later release completes the Web UI and makes `serve`
fetch `@linxiraos/zeta-web` from npm on demand — it is not bundled into the
CLI.

## Companions and config

- Commands are `zetacode` (agent), `zetawork` (workbench) and `zetaide`
  (TermIDE); bare `zeta` prints the workbench help.
- Configuration lives under `.zeta` / `~/.zeta` only. The `OMP_*` and `PI_*`
  environment-variable prefixes are kept for compatibility with existing
  user configuration.
- IM channels (WeChat, Feishu, Telegram) are hosted by `zetacode serve`, not
  by the GUI: `zetacode channels` inspects, pairs and toggles them. See
  [channels.md](./channels.md).
