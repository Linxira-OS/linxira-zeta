# Work Studio surfaces and the capability matrix

> Status 2026-11-11. Work Studio is one renderer served to five clients. A
> control that is fine in the desktop app can be a dead button in a remote
> browser or a phone, so the renderer answers "what can this surface do?" from
> one table: `web-app/src/studio/surfaces.ts`.

## The five surfaces

| Surface | How it is detected | What it is |
| --- | --- | --- |
| **Desktop app** | `window.piDesktop` (window controls) or `window.zetaStudioChrome` (preload chrome API) | The Electron shell's renderer. |
| **Local browser** | No desktop bridge, loopback hostname (`localhost`, `127.0.0.1`, `[::1]`) | A browser on the machine running `zetacode serve`. |
| **Remote browser** | No desktop bridge, non-loopback origin | A browser reaching the machine through a tunnel/proxy. Being remote is an authorization question (`remote.token` + TOTP), not a capability verdict. |
| **Mobile / WebView** | No desktop bridge, phone-sized coarse pointer or a mobile user agent | Binding-scoped chat client. Chat and the current project's conversations only. |
| **TUI** | Not a renderer surface | Listed in the matrix for completeness: CLI/terminal operations. |

`GET /api/desktop/info` tells whether the *serving process* was spawned by the
shell; it is shown as host provenance and never grants renderer controls. A
remote browser connected to a desktop-spawned serve still gets no window
controls.

## Decisions

`show` — this surface owns the control. `pass-through` — the request executes on
the host/machine through the gateway. `read-only` — facts are visible, mutations
are not offered. `hidden` — the action is meaningless here and no control is
drawn. `unavailable` — meaningful, but a named piece is missing; the UI shows
the reason.

| Action | Desktop | Local browser | Remote browser | Mobile | TUI |
| --- | --- | --- | --- | --- | --- |
| Window controls | show | hidden | hidden | hidden | hidden |
| Runtime install / update | pass-through | pass-through | pass-through | hidden | pass-through |
| Runtime restart | unavailable¹ | unavailable¹ | unavailable¹ | hidden | unavailable¹ |
| Import local update | show | unavailable² | unavailable² | hidden | pass-through |
| Local data cleanup | pass-through | pass-through | pass-through | hidden | pass-through |
| Open / export host logs | show | unavailable² | unavailable² | hidden | pass-through |
| Directory picker | show (native) | pass-through | pass-through | pass-through (host) | pass-through |
| Open in editor / reveal file | show | hidden | hidden | hidden | pass-through |
| IM channels (status, QR, default workspace) | pass-through | pass-through | pass-through | hidden | pass-through |
| IM credentials | pass-through | pass-through | pass-through | hidden | pass-through |
| Paired devices (list / revoke) | show | pass-through | pass-through | hidden | unavailable³ |
| TOTP | show | pass-through | read-only⁴ | read-only⁶ | unavailable³ |
| Remote pairing QR | show | pass-through | pass-through | hidden | pass-through |
| Remote token rotate / revoke | show | pass-through | pass-through | hidden | pass-through |
| SSH execution targets | unavailable⁵ | unavailable⁵ | unavailable⁵ | hidden | pass-through |

1. The host refuses to restart its own in-process runtime (`runtime.ensure` with
   `force`); restart `zetacode serve` or the desktop app.
2. Opening the host's log folder or a native save dialog needs the desktop
   preload; a browser can still copy the diagnostics report.
3. The TUI has no device/TOTP screen; use Work Studio.
4. First TOTP enrollment is local-only on the server. A remote browser shows
   status and names that reason instead of rendering an enrollment button that
   would 403.
5. The desktop SSH bridge (`window.zetaStudioRemote`) has not shipped; the picker
   already says so.
6. A phone may **verify** a code (a remote write answers `totp_required`), but
   enrollment, policy and disable stay on the machine; the pane hides them and
   names why.

## Where the matrix is used

- **Settings → 身份与设备**: shows the current surface, the full matrix with the
  reason for each `unavailable`/`hidden` row, and the security actions
  themselves (devices, pairing, remote token, TOTP).
- **Settings → IM 渠道**: channel status/QR/credentials/bindings. The pane is
  reachable from remote browsers with a valid credential; a remote caller with
  write scope can configure channels because the gateway supports it and TOTP
  gates the sensitive mutations.
- **Diagnostics**: the import-local-update, restart and log rows are disabled
  with the matrix reason outside the desktop app.
- **Navigation**: a mobile surface may open `workbench` and `history` only. Any
  other route (deep link or restored session) lands on chat with a notice.
  Settings entries are not rendered in the mobile menus.

## Discoverability (2026-11-11)

The device list and TOTP used to sit at the bottom of **Settings → IM 渠道**,
which is why users could not find 2FA. They now live in **Settings → 身份与设备**
(`web-app/src/studio/settings/SecuritySettingsPane.tsx`), with a command-palette
entry (`set-security`) and a desktop tray item (**Identity & Devices** →
`app.settings:security`). IM channels kept its own group and palette entry
(`set-channels`) and tray item (**IM Channels**).

## Gaps

- **Mobile binding scope** is enforced only by navigation today: the renderer
  hides local runtime, credentials and device admin and lands on chat, but the
  server still authorizes a device token against the whole authority, and the
  host directory picker still works (matrix: pass-through). A real
  binding-scoped session view needs a binding id on the device/token model
  (server work), so the mobile banner says "chat and this project's
  conversations" rather than claiming a per-binding filter.
- **Remote access token UI** rotates/revokes the machine token, but editing the
  TLS/`publicUrl`/plain-HTTP settings still requires the raw web config
  (Advanced → Raw configuration).
- **Remote renderer authentication** is still incomplete: the gateway gate
  requires `remote.token` (or a device token) for non-loopback `/api/*`, and
  the renderer does not yet inject the token from a pairing fragment. A remote
  browser therefore reaches these panes only when something in front of it adds
  the credential; otherwise each read shows the gateway's `unauthorized` error.
  The matrix still advertises the actions because the host supports them; the
  missing piece is renderer plumbing, not authorization policy.
- **SSH targets** remain unavailable until the desktop bridge ships.
