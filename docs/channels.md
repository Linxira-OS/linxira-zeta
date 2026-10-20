# IM channels from the CLI (`zetacode channels`)

`zetacode channels` manages the WeChat / Feishu / Telegram bot runtime without a
browser and without a running web server. It reads and writes the same
`web.yml` (`~/.zeta/agent/web.yml`) used by `zetacode serve`, the desktop shell,
and the GUI settings page. There is one config source and one runtime — these
are all front-ends onto it.

```sh
zetacode channels status [--json]
zetacode channels login <channel> [--json] [--timeout <seconds>]
zetacode channels logout <channel> [--json]
zetacode channels enable <channel> [--json]
zetacode channels disable <channel> [--json]
```

`<channel>` is `wechat`, `feishu`, or `telegram`.

## `status`

Reports, per channel:

| Field            | Meaning                                                                          |
| ---------------- | -------------------------------------------------------------------------------- |
| `enabled`        | `channels.<id>.enabled` in `web.yml`; the next host starts the channel.          |
| `running`        | The channel is live in a hosting process (CLI/TUI session or `serve`).           |
| `configured`     | Required credentials exist. WeChat can still pair by QR when this is false.      |
| `boundPeers`     | Distinct chats bound through `remote.sessionMappings` (plus WeChat peer tokens). |
| `workspaceRoute` | The channel's `workspaceRoot` and its registered alias, or `session default`.    |
| `login`          | `qr` for WeChat, `credentials` for Feishu/Telegram.                              |

The human form prints one line per channel. `--json` returns:

```json
{
	"configPath": "/home/me/.zeta/agent/web.yml",
	"runtime": {
		"hosting": true,
		"pid": 4812,
		"host": "cli",
		"startedAt": "2026-10-20T09:12:00.000Z",
		"sessionId": "session-...",
		"channels": ["wechat"],
		"stale": false
	},
	"channels": [
		{
			"id": "wechat",
			"enabled": true,
			"configured": true,
			"running": true,
			"boundPeers": 2,
			"workspaceRoute": { "workspaceRoot": null, "alias": null, "source": "default" },
			"login": "qr"
		}
	]
}
```

`runtime` is read from `<agent dir>/run/channels.lock`, written by whichever
process currently hosts the runtime. A lock whose pid is gone is reported as
`stale` and does not block a new host.

## `login wechat` (terminal QR, no browser)

```sh
zetacode channels login wechat
```

The command runs the same `WeChatChannel` login flow used by `serve`:

1. Fetch a QR code from the iLink API.
2. Render it in the terminal as UTF-8 upper/lower-half block characters
   (the workspace's own zero-dependency QR encoder — no image fetch).
3. Poll until scanned and confirmed.
4. Persist `channels.wechat.botToken`, `ilinkBotId`, `ilinkUserId`, and
   `baseUrl` through `WebConfig`, exactly like the serve/QR path.

Payload handling:

- A login URL is encoded directly.
- A QR-image URL that carries the content in `?data=` is encoded from that
  parameter, without fetching the image.
- A `data:image/...` payload (or an image URL with no extractable data) cannot
  be decoded locally, so the raw payload is printed instead as a fallback line.
- If the terminal is narrower than the symbol, the raw payload is printed too.
- An expiry fetches a fresh QR and prints it again.

`--timeout <seconds>` bounds the wait (default 180). The state sequence is
`pending → scanned → connected` or `timeout`; `--json` emits one final object:

```json
{
	"channel": "wechat",
	"state": "connected",
	"qrcode": "https://liteapp.weixin.qq.com/q/...",
	"timeoutSeconds": 180,
	"credentialsPersisted": true
}
```

Feishu and Telegram have no QR login; the command reports that their
credentials belong in `web.yml` or the GUI.

## `logout`, `enable`, `disable`

`logout wechat` calls the adapter's `unbind`: it asks the server to reset the
channel, then clears the bot token, iLink ids, and peer tokens. It still clears
local credentials when the reset request cannot reach the network. `logout
feishu` / `logout telegram` empty the corresponding secret fields. A process
already hosting that channel keeps its in-memory connection until it stops (the
GUI's in-process unbind is immediate); restart the host to apply the logout.

`enable` / `disable` persist `channels.<id>.enabled`. Enabling means "the next
host starts this channel"; a process already hosting the runtime keeps its
current set until it stops or `serve` re-applies the config. Disabling never
touches credentials.

## Hosting from a normal session

`zetacode` (interactive TUI) and `zetacode -p …` (headless/print) host the
runtime directly against the live `AgentSession` when:

- any channel is enabled in `web.yml`, or
- `--channels` is passed.

No HTTP server is involved: `startChannels` only needs `getAgentId`,
`deliverIrcMessage`, `subscribe`, and `setIrcAutoReplyListener`, which
`AgentSession` already implements. Inbound messages are delivered as IRC
messages to that session and replies go back through the same `ChannelHost`
used by serve. `channel_send` becomes available in that session.

Lifecycle:

- The runtime starts after the session is created and before the first turn.
- In print mode it runs for that turn and stops before the process exits.
- In interactive mode it stops when the TUI exits.
- One host per bot: a second session (or `serve`) is refused with a message
  naming the live pid. The refusal is a warning; the session itself still
  starts. The guard file is `<agent dir>/run/channels.lock`.

`--channels` only turns hosting on; it does not enable channels by itself.
Channels that are enabled but missing credentials are skipped by the adapter
with a warning, exactly as in `serve`. WeChat without a token is skipped by the
CLI host specifically (rather than starting a hidden QR login that would
compete with `channels login wechat`); pair first, then restart the session.

## Relationship to `serve` and the GUI

| Surface                     | What it does                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `zetacode serve --channels` | Hosts the runtime in the web server process with the coordinator/workspace router.                                             |
| `zetacode` / `zetacode -p`  | Hosts the runtime in the normal session (no workspace router; messages go to that session).                                    |
| `zetacode channels …`       | Inspects/pairs/configures the shared `web.yml`; never hosts.                                                                   |
| GUI settings page           | Reads/writes the same `web.yml` and `GET /api/channels/wechat/qrcode` for its QR; a CLI login is visible there and vice versa. |

The gateway routes (`/api/channels/status`, `/api/channels/send`,
`/api/channels/wechat/{qrcode,reconnect,unbind}`) are unchanged: they read the
in-process serve runtime. They are one more front-end, not a second state
store.

## Examples

```sh
# What is enabled, and is a bot live right now?
zetacode channels status

# Pair WeChat with no browser
zetacode channels login wechat --timeout 120

# Start the TUI with the bot hosted even if web.yml enables nothing
zetacode --channels

# Headless turn with an enabled channel hosted for its duration
zetacode -p "check the build"

# Forget the WeChat pairing
zetacode channels logout wechat
```
