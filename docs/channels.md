# IM channels from the CLI (`zetacode channels`)

`zetacode channels` manages the WeChat / Feishu / Telegram bot runtime without a
browser and without a running web server. It reads and writes the same
`web.yml` (`~/.zeta/agent/web.yml`) used by `zetacode serve`, the desktop shell,
and the GUI settings page. There is one config source and one runtime — these
are all front-ends onto it.

This page is the CLI/hosting surface. Binding and routing vocabulary is
defined in [agent-modes.md](./agent-modes.md); the chat command grammar is in
[remote-workspaces.md](./remote-workspaces.md).

## Status

| Area                                 | Status                        | Where it stands                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WeChat / Feishu / Telegram adapters  | **IMPLEMENTED**               | Real server adapters in `packages/channels/src/{wechat,feishu,telegram}.ts`, hosted by the CLI/TUI session and `zetacode serve` from one runtime. The desktop shell and GUI settings page read/write the same `web.yml`.                                                                                                                                                 |
| Discord adapter                      | **IMPLEMENTED**               | Official Bot API (Gateway v10 + REST) in `packages/channels/src/discord.ts`: guild channels and DMs, @mention/reply trigger, slash `/help` + `/status`, attachments, split at 2 000 chars, 429 handling, resume/reconnect.                                                                                                                                               |
| QQ adapter (OneBot v11)              | **IMPLEMENTED**               | Generic OneBot v11 client in `packages/channels/src/onebot.ts`: forward or reverse WebSocket, Bearer token, group/private, images, `echo` correlation, reconnect and `get_status` health. **No bridge is bundled**; the user runs NapCat / LLBot / SnowLuma.                                                                                                             |
| TIM adapter                          | **PLANNED** — not implemented | No TIM/Tencent-IM adapter exists in the tree; only the three adapters above are compiled in.                                                                                                                                                                                                                                                                             |
| Channel + chat → agent target        | **IMPLEMENTED**               | In `serve`, each channel+chat resolves to exactly one target: `@agent use` override, active bot session/project, persisted workspace binding, channel-default workspace, else the relay coordinator (the default-workspace bot). See [Remote Workspaces & IM Relay](./remote-workspaces.md).                                                                             |
| Relay answers only unbound chats     | **IMPLEMENTED**               | The relay coordinator is the fallback; a chat with any project/workspace/agent binding is not answered by the default workspace, and an unopenable binding returns an error instead of falling back.                                                                                                                                                                     |
| Allowlist, dedupe, reply correlation | **IMPLEMENTED**               | `channels.allowedPeers` gate (`packages/channels/src/auth.ts`), durable per-channel message-id dedupe (`seen-store.ts`), and per-message reply correlation (`reply-correlator.ts`) are wired into every host.                                                                                                                                                            |
| Local IM session visibility          | **IMPLEMENTED**               | IM/bot/relay transcripts are stamped with `SessionHeader.origin`. Studio, the resume picker, and `history.list` hide IM conversations by default; Work Studio History exposes an explicit **IM / Bot** (`includeIm`) view, and IM rows show the workspace alias or `IM · <channel>` instead of an absolute cwd. See [session origin](./session.md#header-sessionheader). |

The CLI surface (`zetacode channels …`) only inspects, pairs, and configures;
it never hosts the runtime. GUI parity is documented in
[GUI IM channels](./gui-im-channels.md).

```sh
zetacode channels status [--json]
zetacode channels login wechat [--json] [--timeout <seconds>]
zetacode channels login feishu [--app-id <id>] [--app-secret <secret>] [--domain feishu|lark] [--json]
zetacode channels login telegram [--token <bot-token>] [--json]
zetacode channels login discord [--token <bot-token>] [--json]
zetacode channels login qq [--endpoint <ws-url>] [--token <access-token>] [--mode forward|reverse] [--port <n>] [--json]
zetacode channels logout <channel> [--json]
zetacode channels enable <channel> [--json]
zetacode channels disable <channel> [--json]
```

`<channel>` is `wechat`, `feishu`, `telegram`, `discord`, or `qq`.

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

Feishu and Telegram authenticate a bot with a pasted credential, not a QR
code; see the next section.

## `login feishu` / `login telegram` (validated bot credentials)

```sh
zetacode channels login feishu [--app-id <id>] [--app-secret <secret>] [--domain feishu|lark] [--json]
zetacode channels login telegram [--token <bot-token>] [--json]
zetacode channels login discord [--token <bot-token>] [--json]
zetacode channels login qq [--endpoint <ws-url>] [--token <access-token>] [--mode forward|reverse] [--port <n>] [--json]
```

Missing flags are prompted for on a TTY (the secret is not echoed). With
`--json`, or when stdin is not a TTY, a missing credential is a usage error
instead of a prompt.

Both commands validate the credential against the platform **before writing
anything**:

- Feishu: `POST /open-apis/auth/v3/tenant_access_token/internal` on
  `open.feishu.cn` (or `open.larksuite.com` with `--domain lark`), then
  `GET /open-apis/bot/v3/info` with that token. The reported identity is the
  app name and `open_id`.
- Telegram: `GET /bot<token>/getMe`. The reported identity is the bot's first
  name, `@username` when present, and its bot id.

A blank or absent flag field falls back to the value already stored in
`web.yml`, so re-running the command validates the saved credential. Only after
the platform accepts it are `channels.feishu.appId`, `appSecret`, and `domain`,
or `channels.telegram.botToken`, written. A rejected or timed-out credential
writes nothing.

`--json` emits one object with the same state words as the WeChat login (no
`scanned`):

```json
{
	"channel": "telegram",
	"state": "connected",
	"identity": { "id": "123456789", "name": "build-bot", "username": "build_bot" },
	"credentialsPersisted": true
}
```

`state` is `connected`, `error`, or `timeout`; failures also carry `error`.
Platform error text is redacted (any submitted or stored secret is replaced by
`••••`) — secrets are never echoed. `GET /api/web-config` masks both secrets as
`••••` like every other stored credential.

The GUI equivalent is **Settings → IM 渠道 → 凭据**: a **Validate and save**
button per channel, disabled while a check runs, showing 未验证 while empty,
验证中… while validating, then 已验证：<bot> or 验证失败：<reason>. It posts
`{ channel, appId?, appSecret?, domain?, botToken? }` to
`/api/channels/credentials`; the gateway validates against the platform, saves,
and asks a running `serve` to restart its channels. A blank secret re-validates
the stored one.

## Discord and QQ

Both channels are **deny-by-default**: a token/endpoint alone is not enough,
because a public guild or a QQ group is reachable by strangers who could open
workspaces and start turns. The adapter refuses to start until the allowlist
is non-empty, and `/api/channels/status` reports the reason.

### Discord

1. Create an application in the Discord Developer Portal, add a bot, and copy
   its token.
2. Enable the **Message Content** privileged intent (Bot → Privileged Gateway
   Intents). Without it `MESSAGE_CREATE` carries no text and the adapter
   reports `auth-failed` on close 4013/4014.
3. Invite the bot with `bot` + `applications.commands` scopes.
4. Validate and save the token:

   ```sh
   zetacode channels login discord --token <bot-token>
   ```

5. Set the allowlist in `web.yml` and enable the channel:

   ```yaml
   channels:
      discord:
         enabled: true
         botToken: "…"
         allowedChannels: ["123456789012345678", "guild:987654321098765432"]
         allowedUsers: [] # optional sender restriction
   ```

`allowedChannels` holds channel ids; `guild:<id>` allows every channel in one
guild. DMs are accepted from users who share a guild with the bot. Messages in
guild channels must @mention the bot or reply to one of its messages; DMs do
not. Slash commands `/help` and `/status` answer ephemerally and never start a
turn.

### QQ over OneBot v11 (bring your own bridge)

Zeta implements the MIT-licensed [OneBot v11](https://github.com/botuniverse/onebot-11)
protocol only. It does **not** bundle, download, or auto-install a bridge, and
it never handles QQ login/QR or reads local QQ data. Run a bridge yourself:

| Bridge                                                         | Mode                          | License                                                                    | Notes                                                                           |
| -------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [NapCat](https://github.com/NapNeko/NapCatQQ)                  | headless NTQQ protocol side   | Limited Redistribution License (non-commercial, no public modified builds) | most common; WebUI QR login; typical OneBot HTTP/WS ports 3000/3001, WebUI 6099 |
| [LLBot (LLOneBot)](https://github.com/LLOneBot/LuckyLilliaBot) | standalone                    | GPL-2.0                                                                    | OneBot 11 + Satori + Milky                                                      |
| [SnowLuma](https://github.com/SnowLuma/SnowLuma)               | injects the desktop QQ client | source-available non-commercial EULA + proprietary native binaries         | newest and least stable; do not rely on it for production                       |

Forward mode (Zeta dials the bridge's OneBot WebSocket) is the default:

```sh
zetacode channels login qq --endpoint ws://127.0.0.1:3001 --token <access-token>
```

Reverse mode (the bridge dials a loopback server Zeta owns; token required):

```sh
zetacode channels login qq --mode reverse --port 8082 --token <access-token>
```

```yaml
channels:
   qq:
      enabled: true
      mode: forward # or reverse
      endpoint: ws://127.0.0.1:3001
      token: "…"
      port: 8082 # reverse mode only
      selfId: "10001" # optional; read from get_login_info otherwise
      allowedGroups: ["42"] # bare group numbers
      allowedUsers: ["900"] # bare QQ numbers for private chat
```

Group messages only start a turn when the bot is @mentioned; private chats are
accepted from every allowlisted user. Peers are namespaced `group:<id>` /
`user:<id>` so a group and a user with the same number never collide.

## `logout`, `enable`, `disable`

`logout wechat` calls the adapter's `unbind`: it asks the server to reset the
channel, then clears the bot token, iLink ids, and peer tokens. It still clears
local credentials when the reset request cannot reach the network.
`logout feishu` clears `channels.feishu.appId` and `appSecret` (the `domain`
stays); `logout telegram` clears `channels.telegram.botToken`. A process already hosting
that channel keeps its in-memory connection until it stops (the GUI's
in-process unbind is immediate); restart the host to apply the logout.

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
used by serve. `channel_send` becomes available in that session (see the
[`channel_send` tool](./tools/channel_send.md)); delivery still honors
`channels.allowedPeers` and per-message dedupe/reply correlation.

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
compete with `channels login wechat`); pair first, or use `/channels login
wechat` (below), then restart the session if you paired elsewhere.

## `/channels` in the TUI

`/channels` is the operator entry for a TUI-only machine; it is hidden from the
everyday command palette and documented here instead. It shares `web.yml` and
the same login flow as the CLI:

```
/channels status
/channels login wechat [timeout-seconds]
/channels login feishu|telegram|discord|qq
/channels enable <channel>
/channels disable <channel>
/channels logout <channel>
```

`<channel>` is `wechat`, `feishu`, `telegram`, `discord`, or `qq`.

- `status` prints the same enabled/running/configured/peers/route/login facts
  as `zetacode channels status`.
- `login wechat` renders the QR in the transcript with the workspace's
  half-block encoder. Before opening the flow it suspends this session's
  channel host (if any), so the QR poll never competes with a running adapter;
  it then restarts whichever channels the fresh `web.yml` enables. A second
  login is serialized by `<agent dir>/run/channels.pairing.lock`.
- `login feishu|telegram|discord|qq` does **not** prompt for secrets inside the
  transcript. It prints the equivalent `zetacode channels login …` command
  (including the OneBot endpoint/mode flags for QQ); the CLI validates and
  saves the credential.
- `enable`/`disable` persist the flag and restart the live host immediately
  when this session previously attempted hosting.
- `logout` is guidance only; the CLI performs the actual credential clear.

Lock behavior: a session that has only an unpaired WeChat enabled starts no
host and takes **no** `channels.lock`, so `zetacode channels login wechat` from
another terminal still works. If the session hosts another channel, its lock
names that channel; a WeChat login is allowed because the host does not own
WeChat. A host that already owns WeChat refuses the second login instead of
racing its connection. `channels.pairing.lock` serializes QR logins
independently of `channels.lock`.

## Relationship to `serve` and the GUI

| Surface                     | What it does                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `zetacode serve --channels` | Hosts the runtime in the web server process with the coordinator/workspace router.                                             |
| `zetacode` / `zetacode -p`  | Hosts the runtime in the normal session (no workspace router; messages go to that session).                                    |
| `zetacode channels …`       | Inspects/pairs/configures the shared `web.yml`; never hosts.                                                                   |
| `/channels` (TUI)           | Same facts/pairing from inside a live TUI; suspends and restarts this session's host around a WeChat QR login.                 |
| GUI settings page (Work Studio) | Reads/writes the same `web.yml`, shows the QR from `GET /api/channels/wechat/qrcode` (server-rendered `svg`), and edits `remote.sessionMappings`; a CLI login is visible there and vice versa. See [GUI IM channels](./gui-im-channels.md). |

The gateway routes (`/api/channels/status`, `/api/channels/send`,
`/api/channels/credentials`, `/api/channels/wechat/{qrcode,reconnect,unbind}`)
are unchanged: they read the in-process serve runtime. They are one more
front-end, not a second state store.

## Examples

```sh
# What is enabled, and is a bot live right now?
zetacode channels status

# Pair WeChat with no browser
zetacode channels login wechat --timeout 120

# Validate a Feishu app credential, then save it
zetacode channels login feishu --app-id cli_xxx --app-secret xxx

# Validate a Telegram bot token with getMe, then save it
zetacode channels login telegram --token 123456:ABC-DEF

# Start the TUI with the bot hosted even if web.yml enables nothing
zetacode --channels

# Headless turn with an enabled channel hosted for its duration
zetacode -p "check the build"

# Validate a Discord bot token, then save it
zetacode channels login discord --token MTIz…

# Validate an OneBot bridge endpoint (NapCat/LLBot/SnowLuma)
zetacode channels login qq --endpoint ws://127.0.0.1:3001 --token abc

# Forget the WeChat pairing
zetacode channels logout wechat
```
