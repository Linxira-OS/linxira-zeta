# Zeta features that differ from the upstream CLI

This page collects the product surfaces Zeta adds or changes relative to the
upstream agent it is based on. Everything here ships with `zetacode` (the docs
are embedded in the binary and served over `zeta://docs`) and with the npm
package.

## Terminal attach (backend-backed sessions)

`zetacode serve` hosts every session; a terminal attaches to one instead of
starting a private in-process agent.

- **Workspace + branch binding.** A session records the git branch of its
  workspace when it is created. Bare `zetacode` and `--attach` reuse the newest
  session for the current `(cwd, branch)` and create one when that pair has
  none; `--attach-session <id>` may cross branches and warns which checkout the
  prompts will edit. `zetacode attach --list` prints every session as
  `id  cwd @ branch  age  name`, including sessions from other repositories.
- **Bot/relay sessions are never auto-attached.** Sessions tagged `relay`,
  `bot` or `draft` belong to IM channels and the shared web chat; addressing
  one explicitly still works.
- **Command surface.** The attached TUI runs client-side commands locally
  (`/language`, `/theme`, `/settings`, `/hotkeys`, `/tool`, `/time`,
  `/tracking`, `/changelog`, `/stats`, `/git`, `/copy`, `/export`, `/dump`,
  `/help`, `/tools`, `/context`, `/agents`, `/skills`, `/extensions`,
  `/status`, `/usage`, `/jobs`, `/hub`, `/pause`, `/record`, `/open`,
  `/debug`, `/quit`, `/exit`) and mirrors replica switches to the backend
  (`/model`, `/modelpreset`, `/switch`, `/effort`, `/fast`, `/slow`, `/plan`,
  `/plan-ultra`, `/plan-review`, `/guided-goal`, `/goal`, `/vibe`). Every
  other slash command is executed by the backend against its own session
  (`/compact`, `/handoff`, `/retry`, `/rename`, `/mcp`, `/todo`,
  `/plugins`, …), and its `command_output` is shown in the attached status
  line. `/queue` and the `->`/`=>` shorthands fill the backend's follow-up
  queue; `/btw` uses the backend side context. Session lifecycle is backend-owned
  and re-attaches the client: `/new`, `/resume <id>`, `/fork`, `/branch`,
  `/tree`, `/clear` and `/delete yes`; `/login` and `/logout` drive the
  backend's providers. Only commands whose runtime lives in the backend process
  are refused, with the host action that performs them (`/restart`, `/setup`,
  `/collab`, `/join`, `/leave`, `/loop`, `/omfg`, `/cleanse`, `/tan`,
  `/seance`, `/live`). Plan approval renders the plan review overlay (plan
  content, approve/compact/refine/cancel) and executes the approved plan on the
  backend.
- **Dialogs** (`select`/`confirm`/`input`/`editor`/`ask`) fan out to every
  attached surface; the first answer wins.

## RPC control plane

`zetacode serve` exposes the same RPC protocol over WebSocket per session at
`ws://127.0.0.1:30142/api/rpc/ws?sessionId=<id>`, so a client can drive a
session the backend owns. `component_list` / `component_open` let companion
surfaces read the live TUI component tree. The full command list and framing
are in [rpc.md](./rpc.md#websocket-transport); generated TypeScript, Python,
Rust and Go clients consume the same schema.

## Stats dashboard

`zetacode stats` (and `zetacode serve`) runs the local observability dashboard
on `127.0.0.1:3847`: usage, costs, requests, errors, traces, tools, projects
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
(`127.0.0.1:30141`) with a bilingual placeholder page that states the
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
