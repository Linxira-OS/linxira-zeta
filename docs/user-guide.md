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

After install, verify with `zeta --version`. The `zeta` binary is the single
entry point for the CLI, the web server, and the desktop shell.

**Desktop:** install the packaged desktop build for your platform. The
desktop app runs the same `zeta` runtime and adds a system tray icon
(minimize to tray on close).

## Starting the web interface

Run `zeta serve` to start the full stack — Web UI, Web Gateway, Stats
Dashboard — behind one port:

```bash
zeta serve
```

- The Web UI opens at `http://127.0.0.1:30141`.
- The Web Gateway listener runs on `127.0.0.1:30142` (dev-mode access).
- The Stats Dashboard runs on `127.0.0.1:3847`.

`zeta web` starts the Web UI without the desktop shell. In `web.yml` you can
configure the domain, the port, remote access, and whether the app stays in
the system tray.

## Using the web interface

The web UI is organized around sessions:

- **New session** — create a session in any folder; the agent works in that
  directory.
- **Chat** — type a message and press Enter. `/` opens commands, `@` attaches
  files.
- **Trajectory** — switch the message area to the branch/trajectory view.
- **Models** — open the Models panel (bottom of the sidebar) to pick the
  provider and model, or configure provider models.
- **Settings** — the gear icon opens the settings panel: appearance, model,
  tools, Web / Bot, and the "About / Usage" tab with this documentation.
- **Stats** — the Stats tab embeds the Stats Dashboard (usage, costs,
  sessions).

## Model configuration

Model credentials are stored per provider under Settings → Model, or in the
Models panel:

1. Open **Models** in the sidebar.
2. Pick a provider (OpenAI-compatible, Anthropic, DeepSeek, Gemini, …).
3. Enter the **API Key** for that provider.
4. Choose a model and set it as default.

To import models from a custom endpoint, use the **import** action with the
provider's base URL. You can also edit `~/.zeta/agent/config.yml` directly —
the web UI reads the same file.

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
same chat. You can also drive the coordinator with commands:

- `@workspace list` / `@workspace open <path>` / `@workspace create <path>` /
  `@workspace close <name>` — manage registered workspaces (multi-repo
  delegation).
- `@plan <task>` — ask the coordinator to produce a plan for a task; the
  plan arrives as an image (or text fallback), then reply **1** to execute,
  **2** to compact and execute, **3** to execute in a fresh conversation, or
  **4** to cancel.

## Desktop tray

The desktop build adds a system tray icon. Closing the window keeps Zeta
running in the tray (Settings → Web / Bot → "Minimize to tray on close");
use the tray menu to reopen the window or quit.

## Updating

Check for a newer version:

```bash
zeta update --check
```

Apply the update:

```bash
zeta update
```

The desktop app can also update from the Web UI (Settings → check for
updates). Updates keep your configuration under `~/.zeta/`; sessions and
settings survive.
