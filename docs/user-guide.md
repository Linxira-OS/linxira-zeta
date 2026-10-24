# Zeta User Guide

Zeta is a local coding agent with a web interface, IM channel integration,
and a desktop tray. This guide covers installation, startup, configuration,
and daily use.

## Installation

Zeta ships as an npm package and as a desktop application.

**npm (Bun / Node):**

```bash
npm install -g @linxiraos/zeta
# or
bun add -g @linxiraos/zeta
```

After install, verify with `zetacode --version`. The `zetacode` binary is the single
entry point for the CLI, the web server, and the desktop shell.

**Desktop:** install the packaged desktop build for your platform. The
desktop app runs the same `zetacode` runtime and adds a system tray icon
(minimize to tray on close).

## Starting the services

Run `zetacode serve` to start the Stats Dashboard and the Web Gateway:

```bash
zetacode serve
```

The three defaults live in `packages/utils/src/ports.ts` and deliberately avoid
OMP's `30141/30142/3847` and common developer ports, so OMP and Zeta can run
side by side on one machine. Override any of them with `--web-port`,
`--gateway-port`, `--stats-port` (or the matching `ZETA_*_PORT` variables).

- Web Gateway: `127.0.0.1:43143` — the HTTP API and the per-session RPC
  WebSocket that terminal clients attach to.
- Stats Dashboard: `127.0.0.1:43147` — usage, cost, request and tool panels,
  with an EN ⇄ 中文 switch in the top-right corner.
- Web UI: `127.0.0.1:43141` — **development is deferred**. The package does not
  ship a Web UI build; the port answers with a bilingual placeholder page that
  says the interface is being completed. A later release ships the full Web UI
  and makes `serve` fetch it from npm on demand.

The terminal is the primary surface. A bare launch is a complete local TUI;
backend mode is selected explicitly and attaches to the exact workspace and
branch it belongs to:

```bash
zetacode                  # pure local TUI (never touches a running backend)
zetacode --attach         # attach to this directory's newest backend session
zetacode attach --list    # sessions across repositories: id, cwd @ branch, age, name
zetacode attach <id>      # plain terminal client for one session
zetacode --attach-session <id>   # full TUI on that session
zetacode --backend-url http://127.0.0.1:43143   # pin one backend
```

`--attach`/`--backend` never fall back to a local session: if no backend is
reachable, the client exits with a diagnostic. With multiple live backends,
pass `--backend-url` or `--attach-session`; the client refuses to pick one
silently.

## Model configuration

Model credentials and definitions are stored in `~/.zeta/agent/models.yml`
(the same file the CLI reads — a change in the web UI applies to the CLI and
serve immediately). Open **Models** in the sidebar:

1. **Providers defined in `models.yml`** show a full editor: name, base URL,
   API key (an env-var name, `!shell-command`, or a literal key), headers,
   and `compat`. Under each provider you can add models and configure their
   detail — **thinking intensity** (mode + supported effort levels +
   default level), input types, cost, context/max tokens, and more.
2. **Other providers** appear as managed cards: OAuth subscription login
   (ChatGPT/Anthropic) or a simple API-key card. Their credentials are kept
   in the auth store, separate from `models.yml`.
3. Choose a model and set it as the default.

To import models from a custom endpoint, use the **import** action with the
provider's base URL. You can also edit `~/.zeta/agent/models.yml` directly.

## Connecting IM channels

With IM channels enabled (in Settings → Web / Bot, or in `web.yml`), Zeta
answers your messages through Telegram, Feishu, or WeChat, and forwards the
agent's replies back to your phone.

**Telegram:**

1. Create a bot with @BotFather and copy the **token**.
2. In Settings → Web / Bot, enable Telegram and paste the token.
3. Save; the channel connects and the bot is ready.

**Feishu (Lark):**

1. Create a custom app in the Feishu developer console.
2. In Settings → Web / Bot, enable Feishu and enter the **App ID** and
   **App Secret**.
3. Save; the channel connects.

**WeChat:**

1. In Settings → Web / Bot, enable WeChat.
2. Click the QR code; scan it with WeChat to log in.
3. The channel stays connected while the app runs. If the login expires,
   use **Reconnect** in the settings to get a fresh QR code.

Once a channel is online, message the bot directly. The agent replies in the
same chat. You can also drive the coordinator with commands (full-width
punctuation from Chinese IMEs is auto-normalized):

- `!hello` — verify the bot is connected; `!help` — full reference;
  `!status` — channels / routing / workspaces / language / model at a glance.
- `!lang <zh|en>` — set this chat's reply language.
- `!session list` / `new <name>` / `use <id|n>` / `rename` / `delete` —
  manage extra default-space sessions (per-chat context; the relay session
  can never be deleted).
- `!model` / `!model <p>-<m>` — list and switch models by number.
- `!workspace list` / `open <path> [alias]` / `create <path> [alias]` /
  `close <alias>` — manage registered workspaces (multi-repo delegation).
  `*<alias>` jumps a chat into direct mode with that workspace, `*relay`
  (or `!workspace relay`) switches back to the relay coordinator.
- `!workspace bind <alias>` — persist this chat → workspace binding (direct
  mode), `!workspace unbind` removes it. `!workspace use <alias>` is the
  runtime-only variant.
- `!work workspace:<alias> <task>` — run a task directly in that workspace;
  `!work <task>` — run it in the current bound workspace or the relay.
- `!plan <task>` — ask the coordinator to produce a plan for a task; the
  plan arrives as an image (or text fallback), then reply **1** to execute,
  **2** to compact and execute, **3** to execute in a fresh conversation, or
  **4** to cancel. The same plan is also available for approval in the web UI.
  Approving a plan executes it as a **goal** (the execution round carries the
  goal context and the host keeps the work moving between turns) — see
  [`docs/plan-approval.md`](/docs/plan-approval.md).

Full command reference and the routing model live in
[`docs/remote-workspaces.md`](/docs/remote-workspaces.md).

## Desktop tray

The desktop build adds a system tray icon. Closing the window keeps Zeta
running in the tray (Settings → Web / Bot → "Minimize to tray on close");
use the tray menu to reopen the window or quit.


## Desktop entry: `zeta-d` vs `zetacode`

The desktop install registers exactly one command on your PATH: `zeta-d`.

- `zeta-d` — runs the bundled CLI/TUI (same experience as `zetacode`).
- `zeta-d -d` — opens the desktop GUI in the current directory; pass a path
  (`zeta-d -d ~/projects/foo`) to open that workspace instead.

Bare `zetacode` always belongs to your npm/source install and is never provided by
the desktop bundle, so both installs coexist without conflicts. From an npm
install you can still open the desktop GUI with `zetacode --desktop [cwd]`; it
exits with an error listing the locations it probed when no desktop install is
found. The desktop app updates itself; running `zetacode update` from the bundled
binary is refused on purpose.

## CLI sidebar and turn telemetry

Two display features live in the interactive TUI:

- **Sidebar** (`/sidebar`, or the `tui.sidebar` setting): a right-hand panel
  showing context usage, token totals and cost, git branch/dirty state, and
  the current model. It needs at least 100 terminal columns and hides itself
  on narrower terminals; scrolled-back history never contains sidebar text.
- **Turn telemetry** (`statusLine.turnTelemetry`, on by default): a dim line
  above the editor after each turn showing throughput (tokens/s), time to
  first token, duration, tokens, and cost. Add the `turn_stats` status-line
  segment to see the same numbers persistently.

## Updating

Check for a newer version:

```bash
zetacode update --check
```

Apply the update:

```bash
zetacode update
```

The desktop app can also update from the Web UI (Settings → check for
updates). Updates keep your configuration under `~/.zeta/`; sessions and
settings survive.
