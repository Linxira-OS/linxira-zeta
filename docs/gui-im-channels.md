# IM Channels in the GUI

The desktop shell (`main/crates/zetawork-gui`) exposes the same messaging-channel
surface as the web desktop. It is the fourth remote target in 设置, next to
zetacode's own options, the provider catalog, and the IM notification fallback.

The pane reads and writes the same gateway truth source the (deferred) Web UI
was built against:

| Surface | Route | File / runtime |
|---|---|---|
| Runtime state | `GET /api/channels/status` | the running `zetacode serve` channel runtime |
| Configuration | `GET` / `PUT /api/web-config` | `~/.zeta/agent/web.yml` |
| WeChat login | `GET /api/channels/wechat/qrcode`, `POST …/reconnect`, `POST …/unbind` | the live WeChat adapter |
| One message | `POST /api/channels/send` | `ChannelRuntime.sendText` |

The gateway origin is `webUrl` from `~/.zeta/serve.json`; the GUI accepts only a
plain `http://` loopback origin with an explicit port (there is no TLS client in
the shell). When the file is absent the pane says so and starts no request.

## Layering

This pane follows the rule in `document/architecture-layers.md`: the GUI is a
front-end over `/api/channels/*` and `/api/web-config` only. `~/.zeta/agent/web.yml`
remains the single source of truth; the panel keeps the last response for drawing
and a few text-field drafts, but it must not grow a state store of its own,
write the file directly, or cache credentials. Every mutation is a gateway
request followed by a read of the same routes the web desktop uses.

## Controls

### Channels

Three rows — WeChat, Feishu / Lark, Telegram — each with an enable switch and a
runtime word. The word is not a colour:

- **运行中** — the gateway's status list reports the channel running;
- **已停止** — the status list reports it stopped;
- **错误：…** — the config enables it but the status list has no entry. That is
  the "credentials missing, runtime did not start" case, surfaced instead of
  hidden behind a stopped switch.

A toggle is a `PUT channels.<id>.enabled`. The gateway restarts the channel
runtime on any `channels.*` write, so the switch takes effect immediately.

### WeChat login

While WeChat is enabled, the pane polls `GET /api/channels/wechat/qrcode` every
two seconds — the same interval as the web UI — and draws the QR:

- `qrcodeUrl` that names an image (`data:image/…`, `.png`, `.jpg`, `.gif`,
  `.webp`, `.svg`) is fetched and decoded when it is PNG or JPEG (the formats the
  WeChat CDN serves); a `data:` URL is decoded in place.
- anything else — the legacy iLink page URL (`liteapp.weixin.qq.com/…`), or an
  image the `image` crate cannot read (SVG) — is encoded locally with
  `qrcodegen`; the web UI sends a page URL to an external QR service, the GUI
  deliberately does not.

Stages, in the order a login walks them:

| Stage | Source | Shown as |
|---|---|---|
| `Pending` | `{pending:true,status:"wait"}`, or 重新连接 pressed | 待扫码 |
| `Scanned` | `status:"scaned"` | 已扫码，请在手机上确认 |
| `Connected` | `status:"confirmed"` (or a stored bot token with no login pending) | 已连接 |
| `Expired` | `status:"expired"` | 二维码已过期，请重新连接 |
| `Unbound` | 解绑 pressed | 已解绑 |

`{pending:false}` returns to 未开始, except after 解绑: the unbound state stays
visible until a new login actually starts, so the next poll cannot make the
action look undone.

- **重新连接** — `POST /api/channels/wechat/reconnect`, then a fresh QR.
- **解绑** — `POST /api/channels/wechat/unbind`. Clears the credentials and peer
  bindings on the running adapter; the next poll's absence of a pending login
  does not clear the 已解绑 word.

### Credentials

- Feishu: `appId`, `appSecret`, `domain` (`feishu` / `lark`).
- Telegram: `botToken`.
- WeChat's bot token is written by the QR login itself, not by this pane.

Secret fields are write-only. `GET /api/web-config` masks every secret as
`••••`; the row shows 已保存（留空则不修改） and starts with an empty draft, so
the real value never reaches a widget. An empty draft is not written. A save
commits the changed fields in order through `PUT /api/web-config`, then re-reads
the whole config with `GET` (the route answers `{ok:true}`, not the new config),
which is exactly the web UI's commit path.

### Workspace routing

The routing model is the web config's, unchanged (see
[`remote-workspaces.md`](remote-workspaces.md) for the IM commands that consume
it):

- **Per-channel default directory** — `channels.<id>.workspaceRoot`. Messages on
  that channel land in this directory unless a chat binding says otherwise. An
  empty value means the coordinator session.
- **Alias registry** — `remote.workspaces`, entries `{alias, path}`. The alias
  is what IM commands use: `@workspace use <alias>` or `*<alias>`. Legacy bare
  path entries are shown with their directory name as the alias. `main` is
  reserved for the relay coordinator.
- **Chat bindings** — `remote.sessionMappings`, entries
  `{platform, chatId, workspaceAlias, …}`. A binding routes one remote chat
  directly to a workspace and wins over the channel default. The GUI edits
  `platform`, `chatId` and `workspaceAlias`; every other field (`sessionId`,
  `lang`, `mode`, `connectionId`, `chatType`) is preserved verbatim when the
  array is rewritten.

The GUI writes the whole array for an add / edit / remove (the
`PUT /api/web-config` contract), with the web config's validation: non-empty
alias, absolute directory, no duplicate alias, no `main`, and a binding's alias
must exist.

### Send test

`POST /api/channels/send` with `{channelId, to, text}`. The route's status table
is surfaced as the route names it:

| Status | Shown |
|---|---|
| 200 | 已发送 |
| 404 | 没有这个渠道（unknown-channel） |
| 400 | 未配对（unpaired），请先让对方给机器人发一条消息 |
| 500 | 发送失败（failed） |

This is the same route the notification fallback uses; the pane only makes its
failure kind visible instead of leaving it in a status-bar tooltip.

## Threading

No request runs on the UI thread. Opening the pane starts one full read
(status + config + QR); while the pane stays open, status + QR are polled every
two seconds and the full config is re-read once a minute. Writes and the two
WeChat actions run on short-lived worker threads, and a finished job updates the
panel on the next frame. Closing the modal stops the poll.

## Screenshot

`ZETA_SHOTS_DIR=<dir> cargo +1.97.1-x86_64-pc-windows-gnu test -p zetawork-gui
--test shots -- --ignored im_channels_settings_screenshot` writes
`16-im-channels.png`: the three channel rows, a locally encoded WeChat QR, the
per-channel default directories, the three alias rows and the bindings.
