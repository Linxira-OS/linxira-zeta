# IM channels in Work Studio

> **Status (2026-11-12).** The shipped surface is **Settings → IM 运行时**
> (`web-app/src/studio/settings/ImRuntimePage.tsx`), served by `zetacode serve`.
> It is the only advertised IM settings page: instances, credentials, bindings,
> profiles and bot commands all use the instance editor. The desktop tray's
> legacy **IM 渠道** item (`app.settings:channels`) is aliased to this group.
> `ImChannelsPane.tsx` remains only as a legacy component and is not mounted;
> QQ/Discord credentials are configured on the runtime instance, not through
> the removed legacy credential section. Neither the paused Rust GUI
> (`main/crates/zetawork-gui`) nor the frozen `web-ui/` snapshot is a channel
> settings surface.

> **Owner pause (2026-11-12).** QQ (OneBot v11) and WeCom (企业微信) are
> owner-paused ([ADR-0035](../document/adr/0035-pause-qq-wecom-channels.md)).
> The retained QQ adapter is still registered, so a QQ row can appear in this
> UI; that is **not** a support or release promise, no bridge is bundled, and
> there is no official QQ Bot API adapter or live validation. WeCom has no
> adapter. Feishu remains the existing enterprise channel. Existing UI code is
> retained unchanged.

The pane is a front-end over `/api/channels/instances` and `/api/im/*`. Device,
pairing, remote-token and TOTP actions live next door in **Settings → 身份与设备**
(`SecuritySettingsPane.tsx`); the surface matrix shared by both pages is
documented in [Work Studio surfaces](./studio-surfaces.md). It keeps no state store of its own: `~/.zeta/agent/web.yml` and
the live `serve` channel runtime remain the only truth, shared with
`zetacode channels …` in a terminal. Opening the pane reads the gateway, a
write re-reads it, and nothing renders a value the gateway did not send.

## Routes used

| Surface            | Route                                                                                 | What the page does with it                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Runtime state      | `GET /api/channels/status`                                                            | `{id, running}` per instance; polled while the page is visible                                               |
| Instances          | `GET/PUT /api/channels/instances`                                                     | Per-platform instances, note, enabled, profile, model and masked credentials; writes preserve stored secrets |
| Instance lifecycle | `POST /api/channels/instances/<id>/enable`, `…/disable`, `…/validate`                 | Toggle one instance, validate its credential bag against the platform                                        |
| WeChat login       | `GET /api/channels/instances/<id>/wechat/qrcode`, `POST …/reconnect`, `POST …/unbind` | Per-instance QR + state, fresh login, logout                                                                 |
| Agent profiles     | `GET/PUT /api/im/agents`                                                              | Persona, model, location, tool allowlists and memory backend                                                 |
| Bindings           | `GET/PUT /api/im/bindings`                                                            | Instance + chat + profile + target + session + answer/mention/observe                                        |
| Bot commands       | `GET /api/im/commands`                                                                | Backend-resolved binding/session/model/role/voice/examples                                                   |
| One test message   | `POST /api/channels/send`                                                             | `{channelId, to, text}` through the running channel                                                          |

## Channels and runtime words

One row per adapter — 微信, 飞书 / Lark, Telegram, Discord, QQ (OneBot v11,
retained/owner-paused) — each with an enable switch and two chips. WeCom has no
adapter row because no adapter exists:

- **运行中** — the status list reports the channel running;
- **已停止** — the config disables it;
- **错误：运行时未启动** — the config enables it but the status list does not
  contain it. This is the honest "credentials missing, host refused to start,
  or another process holds the channel lock" state; it is never smoothed into
  either neighbour.

Rows follow the runtime's own channel registry, so a Discord or QQ binding is
never hidden from the table. `POST /api/channels/instances/<id>/enable|disable`
restarts the `serve` channel runtime, so the toggle takes effect immediately.
Disabling never deletes credentials. Discord is deny-by-default until
`channels.discord.allowedChannels` is non-empty and QQ needs
`allowedGroups`/`allowedUsers`; that is why an enabled row can still read
**错误：运行时未启动**. Discord and QQ credentials are edited on the runtime
instance through the shared credential fields and validated by
`POST /api/channels/instances/<id>/validate`; the removed legacy pane's
raw-config note is no longer a user-facing path.

## WeChat login

While WeChat is enabled the pane polls `GET /api/channels/wechat/qrcode` every
two seconds. The route answers `{pending, qrcodeUrl, status}` and, for a page
payload, an additive `svg`; **the gateway renders that symbol from the same
payload the terminal renders as block characters**, so the browser needs no QR
library and the login URL is never sent to an external QR image service. Image
payloads (`data:image/…`, an image URL) are shown as an `<img>` instead and the
route omits `svg`.

| Stage       | Source                                                            | Shown as                      |
| ----------- | ----------------------------------------------------------------- | ----------------------------- |
| `pending`   | `{pending:true,status:"wait"}`                                    | 请用微信扫码                  |
| `scanned`   | `status:"scaned"`                                                 | 已扫码，请在手机上确认        |
| `connected` | `status:"confirmed"`, or a stored bot token with no pending login | 已连接 / 已登录（凭据已保存） |
| `expired`   | `status:"expired"`                                                | 二维码已过期，请重新连接      |
| `unbound`   | `{pending:false}` and no stored token                             | 尚未登录                      |

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

They are not on this page. **Settings → 身份与设备** holds the real paired-device
list (platform, scopes, last-seen, per-device 撤销 and 撤销所有设备), pairing QR,
remote-token rotation/revocation, and the TOTP second factor
(`/api/auth/2fa`; first enrollment is local-only, sensitive remote mutations
need a step-up). Moving them out of the IM pane is what makes 2FA discoverable;
see [Work Studio surfaces](./studio-surfaces.md) for the per-surface matrix.

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
