# IM channels in Work Studio

> **Status (2026-11-10).** The shipped surface is **Settings → IM 渠道** in Work
> Studio (`web-app/src/studio/settings/ImChannelsPane.tsx`), served by
> `zetacode serve`. The desktop shell shows the same page in its window; the
> tray's **IM 渠道** item sends `app.settings:channels` and the renderer opens
> that group. Neither the paused Rust GUI (`main/crates/zetawork-gui`) nor the
> frozen `web-ui/` snapshot is a channel settings surface.

The pane is a front-end over `/api/channels/*`, `/api/web-config`, and
`/api/remote/*`. It keeps no state store of its own: `~/.zeta/agent/web.yml` and
the live `serve` channel runtime remain the only truth, shared with
`zetacode channels …` in a terminal. Opening the pane reads the gateway, a
write re-reads it, and nothing renders a value the gateway did not send.

## Routes used

| Surface | Route | What the pane does with it |
|---|---|---|
| Runtime state | `GET /api/channels/status` | `{id, running}` per channel the runtime started; polled every 2 s |
| Configuration | `GET /api/web-config` | Enabled flags, masked secrets, `remote.workspaces`, `remote.sessionMappings`, `remote.botSessions` |
| Toggles / defaults | `PUT /api/web-config` | `channels.<id>.enabled`, `channels.<id>.workspaceRoot`, whole-array `remote.sessionMappings` |
| Credentials | `POST /api/channels/credentials` | Validate against the platform, then save; never stores an unvalidated secret |
| WeChat login | `GET /api/channels/wechat/qrcode`, `POST …/reconnect`, `POST …/unbind` | QR + state, fresh login, logout |
| One test message | `POST /api/channels/send` | `{channelId, to, text}` through the running channel |
| Paired devices | `GET /api/remote/devices`, `DELETE …/devices/:id`, `POST …/devices/revoke-all` | List and revoke; tokens never appear |
| Pairing QR | `GET /api/remote/pairing` | Shows `svg` + address; the plaintext token in that response is dropped |

## Channels and runtime words

One row per adapter — 微信, 飞书 / Lark, Telegram, Discord, QQ (OneBot v11) —
each with an enable switch and two chips:

- **运行中** — the status list reports the channel running;
- **已停止** — the config disables it;
- **错误：运行时未启动** — the config enables it but the status list does not
  contain it. This is the honest "credentials missing, host refused to start,
  or another process holds the channel lock" state; it is never smoothed into
  either neighbour.

Rows follow the runtime's own channel registry, so a Discord or QQ binding is
never hidden from the table. `PUT channels.<id>.enabled` restarts the `serve`
channel runtime, so the toggle takes effect immediately. Disabling never deletes
credentials. Discord is deny-by-default until `channels.discord.allowedChannels`
is non-empty and QQ needs `allowedGroups`/`allowedUsers`; that is why an enabled
row can still read **错误：运行时未启动**. Discord and QQ have no validate-and-save
route yet: the credentials section says so and points at the raw web config
(`channels.discord.*`, `channels.qq.*`) instead of faking an editor.

## WeChat login

While WeChat is enabled the pane polls `GET /api/channels/wechat/qrcode` every
two seconds. The route answers `{pending, qrcodeUrl, status}` and, for a page
payload, an additive `svg`; **the gateway renders that symbol from the same
payload the terminal renders as block characters**, so the browser needs no QR
library and the login URL is never sent to an external QR image service. Image
payloads (`data:image/…`, an image URL) are shown as an `<img>` instead and the
route omits `svg`.

| Stage | Source | Shown as |
|---|---|---|
| `pending` | `{pending:true,status:"wait"}` | 请用微信扫码 |
| `scanned` | `status:"scaned"` | 已扫码，请在手机上确认 |
| `connected` | `status:"confirmed"`, or a stored bot token with no pending login | 已连接 / 已登录（凭据已保存） |
| `expired` | `status:"expired"` | 二维码已过期，请重新连接 |
| `unbound` | `{pending:false}` and no stored token | 尚未登录 |

重新连接 and 解绑 are disabled unless the channel is enabled and running (the
routes answer 404 otherwise); 解绑 asks for confirmation because it clears the
token and peer bindings on the live adapter.

## Credentials

- Feishu: `appId`, `appSecret`, `domain` (`feishu` / `lark`).
- Telegram: `botToken`.
- WeChat's bot token is written by the QR login itself.

Secret fields are write-only: `GET /api/web-config` masks every secret as
`••••`, the field starts empty, and an empty draft means "keep the stored
value" — the same rule `runCredentialLogin` applies. A save goes through
`POST /api/channels/credentials`, which validates against the platform first;
a rejected credential writes nothing and its error text is redacted server-side.
`channels.<id>.workspaceRoot` (the channel's default directory when a chat has no
binding) is editable with an absolute path; empty means the coordinator session.

## Chat bindings

`remote.sessionMappings` rows are listed as a table and edited in place:

- platform (the five adapters the runtime registers), chat ID;
- workspace alias (only aliases registered under `remote.workspaces`) or a bot
  session (a read-only list from `remote.botSessions`, created by `!session …`
  in chat);
- `agentId` / PM is **PLANNED**: the column says 未实现 and the pane never
  writes that key.

A save rewrites the whole array — the `PUT /api/web-config` contract — with the
row object copied and only the edited fields patched. `userId`, `chatType`,
`connectionId`, `mode`, `lang` and unknown future keys are preserved; the table
shows a "N other field(s) kept" chip so that is visible. The gateway validates
the array with the router's own rules (non-empty chat ID, at least one target,
a registered alias shape), and the pane mirrors those rules to disable Save
before an avoidable 400.

## Devices and second factor

The device registry exists (`auth/device-registry.ts`, `auth/device-auth.ts`), so
the pane shows real paired devices with platform, scopes, last-seen and a
per-device 撤销 as well as 撤销所有设备 (`keepCurrent` spares this device).
Pairing shows the server's QR (`svg`) and the address for a new device.

There is **no TOTP/2FA endpoint**: the pane states that it is not implemented
and offers no switch. Responses never include a token or hash.

## Old surfaces

- `web-ui/` is frozen (frozen OMP Web snapshot): not built, not published, and
  not linked from Work Studio. Its old Web/Bot settings page is not a second
  entry point. Retirement/redirect plan: `zetacode serve` already prefers the
  Work Studio build for every non-`/api/*` path; if the legacy page must stay
  reachable for a compatibility window, redirect `/settings` and
  `/?panel=settings` to Work Studio's settings route (only when the renderer
  build is absent), and treat the old channel page as read-only. No new feature
  lands there.
- `main/crates/zetawork-gui` is paused and ships nothing.
