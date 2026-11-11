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
| Draft dictation (composer) | show | hidden⁶ | hidden⁶ | hidden | pass-through |
| Import local update | show | unavailable² | unavailable² | hidden | pass-through |
| Local data cleanup | pass-through | pass-through | pass-through | hidden | pass-through |
| Open / export host logs | show | unavailable² | unavailable² | hidden | pass-through |
| Directory picker | show (native) | pass-through | pass-through | pass-through (host) | pass-through |
| Open in editor / reveal file | show | hidden | hidden | hidden | pass-through |
| IM channels (status, QR, default workspace) | pass-through | pass-through | pass-through | hidden | pass-through |
| IM credentials | pass-through | pass-through | pass-through | hidden | pass-through |
| Paired devices (list / revoke) | show | pass-through | pass-through | list only⁶ | unavailable³ |
| TOTP | show | pass-through | read-only⁴ | read-only⁶ | unavailable³ |
| Remote pairing QR | show | pass-through | pass-through | show⁶ | pass-through |
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
7. Dictation needs the desktop preload's complete live-audio bridge
   (`attachLiveAudio`/`appendLiveAudio`/`detachLiveAudio` + `getUserMedia`) and
   a Host manifest that advertises all five `dictation.*` commands
   (`status`, `prepare`, `start`, `stop`, `cancel`). A browser/remote tab, or a
   Host without the family, renders no dictation control and polls no
   `dictation.*` command.

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
- **Navigation**: a mobile surface may open `workbench`, `history` and
  `settings`. Settings is what lets a phone pair another device and answer a
  2FA challenge; actions inside it are still decided by the matrix, so only the
  device list, pairing card and TOTP verification render there.

## Discoverability (2026-11-11)

The device list and TOTP used to sit at the bottom of **Settings → IM 渠道**,
which is why users could not find 2FA. They now live in **Settings → 身份与设备**
(`web-app/src/studio/settings/SecuritySettingsPane.tsx`), with a command-palette
entry (`set-security`) and a desktop tray item (**Identity & Devices** →
`app.settings:security`). IM channels kept its own group and palette entry
(`set-channels`) and tray item (**IM Channels**).

## Workspace and session identity (2026-11-11)

Work Studio keeps three separate facts; conflating them was the source of the
wrong-project header, Git and Explorer views:

- **Host default/runtime** — `active` / `activeWorkspaceId` names the
  coordinator workspace the gateway runs on. Opening a folder records a registry
  preference; it does not move that runtime.
- **Inventory order** — `projects.list` order is display order only. Every row
  keeps its own `lastOpenedAt`; an empty or never-opened row stays listed with
  `lastOpenedAt: null` and sorts after dated rows. `defaultWorkspaceId` names the
  default even when its row is hidden.
- **Viewer selection** — the renderer follows the viewed history session first,
  then an explicit folder selection, then the default. A refresh updates the
  selected row's name without replacing the identity; a hidden workspace keeps
  its identity while it is being viewed.

Session history rows and home recents carry the canonical `workspaceId` derived
from the session cwd hash, plus a basename-only `workspaceName`. Recent chats
label each row by its own workspace; a row from an older Host with no workspace
facts shows no project label instead of the current project's name. Cold history
opens the entry's workspace, not the default.

`session.create` takes a mandatory `workspaceId`. The Host resolves it through
the hidden-inclusive gateway inventory to the canonical cwd; there is no
process/default fallback. The first prompt of a fresh project draft waits for
that creation instead of being filed against the session the operator just left.
File-tree and Git operations resolve the same opaque id, including hidden
workspaces, and a workspace switch clears stale repository/branch/diff state.

Long project names stay complete in data, DOM text, search and accessible names;
CSS ellipsis constrains the sidebar, recent rows, menus and context strip, and
`data-tip` exposes the full value. Dictation is only mounted when the Host
advertises every `dictation.*` operation and the desktop provides the complete
microphone transport; unsupported surfaces render nothing and do not poll.
Full audio transport remains a separate change.

## Plugin pages and remote step-up (2026-11-11)

A plugin page is a real top-level renderer route,
`/plugins/view/<plugin>/<page entry>` (for example
`/plugins/view/notes/ui/board.html`). The static server already falls back to
`index.html` for extensionless deep links; `App.tsx` parses that path and
renders the exported `PluginPageHost` with the selected/live session id instead
of mounting the project shell. `onBack` replaces the URL with `/` and returns to
the remembered app route, so a plugin page is not a second navigation surface.
The page entry comes from the plugin's declared html panel and is addressed with
the same `pluginViewHref` helper that builds this URL; `plugins.callTool` is the
only bridge back to the Host. The Capabilities plugin view links to the page,
and no extra tray/harness entry is created.

`AuthStepUpBoundary` is mounted once around the routed content. A bound remote
device that receives `403 totp_required` answers the challenge in place and the
transport replays the request exactly once; page-driven commands no longer dead
end in Settings. The production ownership adapter registered by the session
operations resolves both `workspaceOfSession` and `workspaceOfCwd` through the
hidden-inclusive canonical workspace registry and denies unattributable
resources.

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
