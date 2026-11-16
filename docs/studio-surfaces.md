# Work Studio surfaces and the capability matrix

> Status 2026-11-11. Work Studio is one renderer served to five clients. A
> control that is fine in the desktop app can be a dead button in a remote
> browser or a phone, so the renderer answers "what can this surface do?" from
> one table: `web-app/src/studio/surfaces.ts`.

## The five surfaces

| Surface              | How it is detected                                                                     | What it is                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop app**      | `window.zetaStudioChrome` (window controls and preload chrome API) | The Electron shell's renderer.                                                                                                                      |
| **Local browser**    | No desktop bridge, loopback hostname (`localhost`, `127.0.0.1`, `[::1]`)               | A browser on the machine running `zetacode serve`.                                                                                                  |
| **Remote browser**   | No desktop bridge, non-loopback origin                                                 | A browser reaching the machine through a tunnel/proxy. Being remote is an authorization question (`remote.token` + TOTP), not a capability verdict. |
| **Mobile / WebView** | No desktop bridge, phone-sized coarse pointer or a mobile user agent                   | Binding-scoped chat client. Chat/history plus Settings for the paired-device list, pairing card and read-only TOTP verification; local runtime, credentials and device-admin stay hidden. |
| **TUI**              | Not a renderer surface                                                                 | Listed in the matrix for completeness: CLI/terminal operations.                                                                                     |

`GET /api/desktop/info` tells whether the _serving process_ was spawned by the
shell; it is shown as host provenance and never grants renderer controls. A
remote browser connected to a desktop-spawned serve still gets no window
controls.

The production Zeta `serve` Host exposes authenticated conversation contexts
and its browser transport advertises `supportsContexts: true`. Each context
belongs to the existing authenticated cookie, selects a registered workspace
and an optional session, and uses a separate event/socket namespace. Closing
a context, revoking its owner or expiring the cookie closes its sockets;
stale handles cannot fall back to the root session. A context grants no new
device permissions. Host/auth coverage includes persisted sessions in two
workspaces, foreign handles, nested targets, revocation, expiry and late socket
attachment (98 tests / 407 assertions across the focused Host/auth run).
Desktop SSH forwarding is implemented but real-target and native desktop
acceptance remain open; ADR 0043 stays Proposed until those paths are verified.

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
| SSH execution targets | show⁵ | unavailable⁵ | unavailable⁵ | hidden | pass-through |

1. The host refuses to restart its own in-process runtime (`runtime.ensure` with
   `force`); restart `zetacode serve` or the desktop app.
2. Opening the host's log folder or a native save dialog needs the desktop
   preload; a browser can still copy the diagnostics report.
3. The TUI has no device/TOTP screen; use Work Studio.
4. First TOTP enrollment is local-only on the server. A remote browser shows
   status and names that reason instead of rendering an enrollment button that
   would 403.
5. The desktop SSH bridge (`window.zetaStudioRemote`) is exposed by the
   preload, and the picker renders the SSH target only when that bridge is
   present; non-desktop surfaces remain unavailable. Real SSH target and
   packaging acceptance is being rechecked (2026-11-12), so this is
   source-level availability, not a `VERIFIED` hardware claim.
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
- **Settings → IM 运行时**: per-instance status/QR/credentials/bindings/profiles/bot
  commands through the instance editor. The page is reachable from remote
  browsers with a valid credential; a remote caller with write scope can
  configure channels because the gateway supports it and TOTP gates the
  sensitive mutations.
- **Diagnostics**: the import-local-update, restart and log rows are disabled
  with the matrix reason outside the desktop app.
- **Navigation**: a mobile surface may open `workbench`, `history` and
  `settings`. Settings is what lets a phone pair another device and answer a
  2FA challenge; actions inside it are still decided by the matrix, so only the
  device list, pairing card and TOTP verification render there.

## Discoverability (2026-11-12)

The device list and TOTP used to sit at the bottom of the legacy IM pane,
which is why users could not find 2FA. They now live in **Settings → 身份与设备**
(`web-app/src/studio/settings/SecuritySettingsPane.tsx`), with a command-palette
entry (`set-security`) and a desktop tray item (**Identity & Devices** →
`app.settings:security`). IM settings now have one advertised group,
**Settings → IM 运行时** (`set-im-runtime`); the legacy `channels` group and
`set-channels` entry are removed, and tray deep links / saved intents using
`channels` are aliased to `imRuntime` rather than rendering the unmounted
legacy pane.

Step-up ownership is single: `AuthStepUpBoundary` only collects the code, and
`createStepUpFetch` performs one `/api/auth/2fa/verify` then replays the
challenged request once. The boundary must not verify the code itself; TOTP
steps are consumed server-side, so a second verify fails and the replay never
runs.

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

## Workspace terminals and files (2026-11-15)

Opening a terminal from a conversation resolves its selected workspace on the
serving Host. A code block command starts a separate shell process in that
directory; retrying the same live command slot reattaches to its output. It
never types a script into an existing interactive shell. The requested shell
must be installed on the target. Command launches reject a simultaneous shell
profile, companion program or file injection. Browser terminals use the local
Host; SSH terminal targets require the desktop transport.

`POST /api/terminal/ensure` accepts `workspaceId`, `cols`, `rows` and
`command: { shell: "bash" | "sh" | "zsh" | "powershell", text }`. The command
must be non-empty, contain no NUL and be at most 1 MiB of UTF-8. An explicit
`cwd` must match the registered workspace. Existing cookie, device-binding,
CSRF/origin checks, one-time tickets and the raw PTY WebSocket remain in use.
The gateway does not advertise ACK-based flow control.

Terminal font family and size are controlled by **Settings → Fonts → Terminal**,
independently of UI and conversation text. Font changes, panel collapse/expand,
window resize, zoom and moving the panel to a native window refit the existing
grid without restarting its shell or discarding output. Native windows use
their mirrored appearance; xterm owns the hidden input's cursor-cell geometry.

File viewers use `workspace.file.inspect` and versioned
`workspace.file.readChunk` (at most 512 KiB per call). The built-in text editor
uses `workspace.file.readText` / `workspace.file.writeText`, supports UTF-8 and
BOM-marked UTF-16 up to 8 MiB, and retains BOM and line endings. Saving against
an older version returns a conflict instead of overwriting a newer file.
Every access resolves the canonical target inside its selected workspace;
links outside that workspace are rejected. Desktop resources use the same
authenticated local/SSH Host transport and are released when their owner
closes.

Office Word/PowerPoint conversion additionally requires a trusted signed
component provider. The upstream public manifest URL is known, but this source
tree supplies no trusted Office signing key. Installation and conversion stay
unavailable until that prerequisite is supplied; Excel/CSV support is separate.
Current-source desktop, real SSH and graphics acceptance remain recorded
separately from unit and type checks. See ADR 0045 and ADR 0046.

## Private browser observation (2026-11-15)

`browser.tabs.get` lists the selected session's Chromium targets and live
registry-proven descendants. `browser.observe.prepare` creates a short-lived
private descriptor for one target. The authenticated conversation must keep
its event socket open. Public replies contain opaque IDs; socket paths,
credentials and frame bytes never enter bootstrap or conversation events.
Desktop discovers the private directory only from a live PID-matched serve
registration (ADR 0047).

Observation preserves the target viewport. Taking human control excludes new
agent actions, waits for pending work, and requires the displayed frame to
remain current before dispatching input. Releasing control, losing descendant
ownership, closing or switching the conversation, disconnecting its last event
socket, revoking or expiring authentication, and disposing the session release
the observation and its control lease. The browser target itself stays alive.
Managed desktop browsing additionally uses `browser.managed.prepare`: its
relay descriptor stays in the same private registration directory and is
owned by one live view. A second view cannot silently replace it. The existing
browser tool uses this relay for the session and proven descendants, waits for
agent work before human takeover, and borrows desktop pages across Runtime
cleanup. Typed WebMCP inspection and invocation retain page/document identity. Desktop
enables Chromium's WebMCP feature (`WebMCPTesting` on Chromium 156, `WebMCP` on
157) process-wide before app ready, so the renderer and plugin pages also see
`document.modelContext`; that grants no IPC or Host authority, and invocation
still goes through the authenticated private relay. A cross-document commit or
renderer crash invalidates the prepared catalog and references; same-document
navigation keeps them.
Computer observation uses the same private registration, described below.

## Computer workspace and private frames (2026-11-15)

The Computer pane reads activity from the selected native session and its
registry-proven descendants. Screenshots are private media: public state,
events and conversation results contain opaque frame references and bounded
metadata. A local Desktop surface must adopt the exact `computer.observe.open`
lease before reading that lease's frames. Separate windows and contexts keep
independent leases. Hiding, navigating, switching scope, disconnecting,
revoking authentication or disposing a session releases its private views.

Observation requires a native addon that positively supports passive
construction. It never starts an input controller as a fallback. X11 passive
reads do not install the user-input watcher; Wayland requires the
`wayland-pipewire` build and ScreenCast/PipeWire runtime, without RemoteDesktop
input. An older addon reports unavailable before constructing an input-enabled
session. OS permissions, screen lock and backend availability remain separate
from the presence of the Desktop IPC bridge.

Stop revokes current native permits and persists the stop state. Continue
uses the exact displayed revision and a user-attributed nonce consumed only
when the native session executes that message; queued admission does not
mean input has resumed. Existing foreground approval and physical Escape
rules still apply. Historical frames are never replaced by a fresh capture.
Saving frames to the ArtifactLibrary is unavailable until binary promotion
exists; the pane exposes no save action.

## Input prediction (2026-11-16)

Studio's composer uses the existing native text-prediction daemon with an
explicit Studio profile. Its history and learned state live in the private
profile's `studio-predict` directory, separate from the TUI corpus. The daemon
does not bootstrap Claude Code/Codex histories for this profile and a draft
query never downloads model weights; only authoritative user messages add
confirmed prompts, and importing an external JSONL file is an explicit action.

The authenticated Host owns prediction settings (`spelling.autocomplete`,
`composer.predictions`) and channel preparation. Each resident native session
owns one producer: word completion over a private socket, and next-message
prediction through the existing native composer controller with ranked
alternatives. Every channel belongs to one live authenticated view and exact
session instance; closing the context, losing the last event socket, revoking
or expiring authentication, disposing/replacing the session, or hiding,
minimizing, navigating or closing the Desktop window releases the channel and
cancels its active next-message prediction. Public results carry only channel
and session identity plus expiry; socket paths, tokens and private directories
never enter bootstrap, events or receipts.

Desktop adopts the prepared descriptor through trusted top-frame IPC, validates
the exact endpoint/token/expiry, requires a visible window, and uses a file
picker for history import (the renderer cannot pass arbitrary paths). A plain
browser, remote browser or mobile surface has no private transport, so it shows
the settings and corpus controls but no draft ghost text. Clearing the corpus
stops that exact Studio daemon and removes its learned state without touching
the shared verified model cache or the TUI history.

Local acceptance used the current-source Host plus Electron 45.3.0 with a local
protocol fixture: ranked next-message ghost inserted by Tab, word completion
from the Studio corpus, and a picker import reporting 80 learned prompts. This
is local-fixture product evidence; external-provider, packaged and
source-matched-native acceptance remain separate. ADR 0053 records the
decision and stays Proposed.

## Evaluations (2026-11-15)

The evaluation workspace uses the selected native session's benchmark,
instruction, judgment and Ratchet execution. Provider credentials, model
availability and isolation prerequisites are checked by those native paths.
Closing a view releases its review lease while paid execution continues;
session disposal, identity replacement or Host shutdown cancels the execution
and retains completed or partial results. Reopening a record does not rerun it.
Review responses require the current lease generation.

History, rows and exports are bounded private-profile records partitioned by
session. Limits include eight active evaluations, 512 retained records,
20,000 rows per evaluation, 200 rows per page, 64 MiB per report and 48 KiB
export chunks. Public output excludes credentials, private endpoints and
native report paths. Local fixtures do not establish external-provider or
packaged-product acceptance.

## Time Travel (2026-11-15)

Enable Time Travel in **Settings → General and notifications** before the
turns to capture. It defaults off. Each execution Host keeps its own snapshots
in the private profile's `time-travel` directory. Enabling adds filesystem
work before user delivery and after terminal completion, including queued
follow-ups and interrupted turns. Capture follows the native session and
continues when the renderer disconnects.

Profile settings use the local authenticated client even while a conversation
or SSH target is selected. Bootstrap establishes its event connection before
settings/storage reads or command receipts; opening a scoped conversation alone
does not establish that profile connection.

The history timeline offers **code**, **conversation**, or **both** restoration.
Code restore previews additions, modifications and deletions, rejects a stale
preview, and creates a safety snapshot before applying files. Git's tracked
and untracked inventory, ignore rules and configured exclusions determine
captured files; restore does not rewrite the Git index. Symlink-parent and
workspace confinement checks prevent writes outside the selected workspace.
These snapshots do not reverse external commands, remote services or database
side effects.

Conversation restore selects the exact native tree position, including the
empty root, and preserves later branches. Restoration requires idle resident
sessions in the same canonical workspace and blocks new work until the
filesystem/tree transition finishes. If only part succeeds, the result names
that part and retains the safety backup. This is separate from message-only
checkpoints. Disabling retains existing snapshots; retention and explicit
cleanup remove snapshots and unreferenced shared blobs.


## Project services (2026-11-15)

The Services pane and background-task dock use the same workspace launch
broker as named bash services and `proc://`. Open a live conversation before
controlling its workspace services. Studio starts return after launch and
never replace an existing name. Readiness continues in the broker and appears
in subsequent service reads. Relative launch directories must remain within
the selected workspace after resolving symlinks.

Stop, restart, input, mode changes and logs carry the exact launch instance.
A request from before a restart or replacement is rejected; refresh the list
before trying again. If a resident broker predates instance fencing, restart
that broker with the updated Runtime before using Studio controls. This does
not weaken cookie/CSRF, device binding or 2FA: project-wide service operations
remain unavailable to conversation-bound devices.

Service rows show the real native owner ID and PID. A named bash web server
can declare `previewUrl`, an absolute HTTP(S) URL without embedded credentials.
Studio uses that declaration to open its page; it does not guess an address
from logs. Restart and broker recovery retain the declaration. Commands,
environment variables and private runtime directories are not service-row
fields. Session, persistent and detached modes retain their existing native
lifetimes; detaching the shared managed-browser process is refused.

## Binary artifacts (2026-11-16)

Image, video and archive bytes never travel through `/api/v1/query|command`
JSON. The same authenticated Host that owns sessions serves them:

- `GET /api/v1/artifacts/<opaque id>?contextId=<opaque context>` returns the
  exact stored bytes with `Range` support (`206`/`416`), `no-store`,
  `nosniff`, a sandbox CSP and `accept-ranges: bytes`. `HEAD` answers the same
  metadata with no body.
- `POST /api/v1/artifacts?sessionId=&kind=&name=&mimeType=&contextId=` accepts
  a raw body up to 28 MiB and answers `201 { artifact }`. Text, graphic
  (`svg`), recording (`studiocast`/`cast`) and `export` (`tar`/`zip`) imports
  are accepted; `audio` creation stays owner-held. The stored name is generated
  from the kind and a UUID, so the renderer never chooses a path.
- Both routes require the existing cookie/CSRF/device/2FA/scope checks and the
  still-open selected conversation context. A **write** additionally requires
  the live event socket and the exact resident native session; a read only
  needs the open context, so a preview cannot race socket attach. A context
  close, device revoke, session disposal or selection switch rejects the
  request before bytes are committed; an upload that loses its authority is
  discarded rather than left as a ghost file.
- Writes and the session trash move are serialized per session, so a delete
  cannot race a late artifact write into a resurrected directory.

The renderer asks the Host for the URL (`artifacts.resource`) and renders the
relative URL in a browser. Desktop converts it to
`zeta-artifact://library/<id>?contextId=…&targetId=…`, where Main resolves the
exact local or SSH connection and never falls back to local for a disconnected
remote. Import/export use native dialogs in Main; the renderer never supplies a
filesystem path. Export rechecks the captured Host connection and context after
writing its temporary file, immediately before the atomic destination rename;
revocation removes the temporary file. Native terminal recordings use
`zeta-artifact://recorder/<recording>` independently of the context-bound library.

## History metadata and BTW image paste

History rows can rename or explicitly pin a saved conversation in the selected
workspace. Changes use the same durable title and pin writers as the TUI.
A device bound to one session cannot change another session's metadata.

The BTW composer resolves pasted image paths through the native image loader
using the live selected conversation's working directory. It returns image
payloads without resolved filesystem paths; a closed or disconnected view
cannot read them. Unsupported files and image-size limits are reported by the
Host. Ordinary pasted text remains text.

Native BTW branch promotion rekeys the resident wrapper before its receipt and
moves only the initiating conversation's selection. A newer selection survives
a branch that finishes later. Resources use kindless `resource.local.list`,
`resource.local.open` and versioned `resource.local.save` inputs; asynchronous
reads/saves retain the invoking view's authority. Recorded shell reads are
confined to that session's transcript bucket or its registry-proven descendant,
and a device session binding also applies to the recorded source.

Queue takeback, ack, removal and steering retain their invoking view inside the
serialized mutation. If takeback loses that view during image staging, the
message stays pending and staged artifacts are removed.

## Operation validation (2026-11-16)

Studio requests use the existing authenticated Zeta Host. The Host and gateway
validate operation inputs where they are consumed; the shared client protocol
does not duplicate Runtime request parsing or validate typed in-process results.
Launch specifications, workspace paths, exact service instances, runtime setting
values, native or paid work limits, and private Desktop/socket inputs retain
their owning checks. Client-side form checks do not replace authorization.
See [ADR 0052](../document/adr/0052-studio-input-validation-authority.md).

## Gaps

- **Host producer gaps (2026-11-16, updated).** A hidden control is never a
  working one: a surface appears only when its `/api/v1/query|command` family is
  registered. `accounts.*`, `agent.btw.*`, `agent.model.inspect`,
  `annotations.*`, `extensions.links.*`, `ida.*`, `media.*`,
  `search.credentials.*`, `session.compaction.*`, `session.queue.*`,
  `worktrees.session.*`, `preferences.features.*`, `models.compaction.*`,
  `session.titles.inspect`, `session.portability.*`, `maintenance.compression.*`,
  `archive.*`, `session.lease.read|inspect` and the binary artifact routes are
  now registered. The old `benchmarks.*`,
  `judgments.*` and `ratchet.*` namespaces are deliberately replaced by
  `evaluations.*` (legacy history imports into it; no compatibility adapter).
  `skillshare.*` stays retired by ADR 0047 and `live.audio.*` stays owner-held
  by ADR 0034. Remaining unregistered families include `context.view.*`,
  `templates.*`/`mcp.runtime.status`, `preferences.native.*` and GUI preference
  schemas, `session.restore.inspect`, `runtime.pause`, advisor configuration
  and `tan.start`. Their retained contracts/components do not establish working
  Host behavior; they remain acceptance gaps. Main BTW, local resources and
  shell views are now registered through the native session utility family.
  Desktop also dropped upstream's office-preview, chrome-api,
  remote-provisioning and desktop git/GitHub services because those reads now
  live in Host ops or are retired (Office needs a trusted signed component).
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
- **SSH targets** are source-available in the desktop app while the desktop
  bridge is present; real SSH target/packaging acceptance is still being
  rechecked, and non-desktop surfaces remain unavailable.
- **Multi-terminal manager page is owner-held, not started.** The requested
  dedicated page (left list of multiple terminals, Orca-like) has no chosen
  architecture: extending `zetaide` vs reusing the old `zetawork` TUI rendering
  is undecided, and [ELYTerminal](https://github.com/ELY-Open-Source/ELYTerminal)
  is only a public reference. The existing multi-tab terminal remains; this
  manager page does not exist. See the
  [roadmap Owner holds](../document/roadmap.md#owner-holds-2026-11-12) and
  [ADR 0034](../document/adr/0034-owner-scope-holds-2026-11-12.md).
