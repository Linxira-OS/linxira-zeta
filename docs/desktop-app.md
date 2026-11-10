# Work Studio desktop editions

Work Studio ships as a desktop app in two editions built from the same staged
runtime. Both carry Zeta's own kernel — the compiled `zeta` binary (the same
CLI as `zetacode`), the native addons, and the Work Studio renderer
(`web-app/dist`). Neither needs Bun, Node, or a separately installed CLI.

| Edition | What it bundles | Download |
| --- | --- | --- |
| **Full (Electron)** | Chromium, the kernel, the renderer, tray and window chrome | Windows NSIS installer / portable zip, Linux AppImage / deb / tar.gz |
| **Browser** | The kernel and the renderer only; no browser engine | Windows zip, Linux tar.gz, with a launcher that starts `zetacode serve` and opens the default browser |

The Electron shell spawns the bundled `zetacode serve` and loads it inside its
window; the browser edition's launcher does the same but hands the URL to the
user's browser. In both cases the server and the UI are the same Work Studio
that `zetacode serve` produces from a source checkout.

## Runtime layout

The packaged runtime directory (`resources/zeta` in Electron, `zeta/` in the
browser archive) is:

```
zeta[.exe]        compiled kernel (zetacode); embeds the target's native addon
web-app/          Work Studio renderer build
```

The kernel carries the native addon as zstd frames inside the executable
(`packages/natives/scripts/embed-native.ts`) and extracts it into
`~/.zeta/natives/<natives version>/` on first run. Do not stage
`pi_natives.*.node` beside it: each variant is 100–180 MiB and the packaged
copy was never used while the embedded one loaded, so it only duplicated the
kernel (124 MiB of every 1.5.1 Windows install).

The shell sets `ZETA_WEB_APP_DIR` to its bundled `web-app/`; the browser
launcher relies on the same environment being unnecessary because the renderer
sits beside the binary. Everything else (`ZETA_DESKTOP`, the open-bridge
secret) is desktop-only wiring.

## Size

Two payloads dominate the full edition: Chromium inside Electron (~275 MiB
installed) and the compiled kernel (~260 MiB, native addon included). 1.5.1
installed 744 MiB (~780 MB) from a 250 MiB installer; 124 MiB of that was a
second copy of the native addon staged beside the kernel and 42 MiB was
Electron's full locale set. With the addon staging removed and
`electronLanguages` narrowed to `en-US`/`zh-CN`, the same tree installs at
~579 MiB (~600 MB) from a ~195 MiB installer. `package-desktop.mjs` enforces
both invariants through `scripts/packaging-budget.mjs`, so a regression fails
packaging instead of silently bloating the download.

## Naming

* **Work Studio** is the product surface, in the browser and in both desktop
  editions.
* `web-app/` is the renderer; `zetacode serve` is its host.
* `web-ui/` is an abandoned third-party snapshot and ships nothing.
* `zetawork` (Rust TUI/GUI) is paused; no desktop asset comes from it.

## Building locally

```sh
cd desktop
npm ci
ZETA_SERVICE_BINARY=/path/to/zetacode npm run dist   # Electron edition
bun scripts/package-workstudio-browser.ts \
  --version <version> --platform linux|win32 \
  --runtime temp/desktop/staging/zeta --out temp/desktop/release
```

`prepare-runtime.mjs` builds the renderer (`gen:web-app`) and stages the
runtime; `ZETA_SERVICE_BINARY` reuses an already-built CLI binary instead of
recompiling it. Release runs build both editions on their native runners.

Platform support follows the CLI: Windows x64 and Linux x64 (musl is CLI-only).

## Desktop shell contracts

The preload exposes one capability object under **both** `window.piDesktop`
(the window/titlebar contract) and `window.zetaStudioChrome` (the Studio chrome
contract), so the shipped renderer's feature detection works in the installed
app instead of falling back to browser behavior. A plain browser tab has
neither global.

Capabilities the shell owns (paths never cross into the renderer):

* window controls — `minimize`, `maximize` (toggle), `close`, `isMaximized`,
  `onWindowState`;
* project picker — `selectDirectory`, and `pickWorkspace` (native folder
  dialog + `PUT /api/projects` registration);
* host opens — `getOpenTargets`, `openTarget`, `spawnTool` (zetacode / zetaide);
* file shell actions — `openProjectInEditor`, `openProjectDirectory`,
  `openFile`, `openFileWith`, `revealFileInFileManager`,
  `resolveFileAbsolutePath`, `listFileOpeners`, `getPathForFile`,
  `resolveDroppedPaths`, `pickPlanSavePath`;
* app chrome — `getAppVersion`, `checkUpdates`, `openUrl`, `notify`,
  `openLogDir`, `exportLogs`, `sampleProcessMemory`, `onMenuCommand`.

Workspace ids are opaque (`ws-*`). Every action resolves them through the
gateway's `GET /api/projects` inventory and re-checks containment with
`realpath`, so a renderer cannot point an open at a path outside its workspace.

Window lifecycle: closing to the tray hides the window; a real close (or
`activate` with no window) recreates it from the persisted bounds instead of
leaving the process windowless. Tray **Open Settings** sends the Studio
`app.settings` menu command rather than reloading a query-only URL; tray
**IM Channels** sends `app.settings:channels` and **Identity & Devices** sends
`app.settings:security`; both open the same Work Studio settings groups as the
browser. There is no separate desktop channel or security UI.

Launch integration: the shell registers the `zeta://` scheme, handles
`open-url`/`open-file`, and treats a second-instance `--cwd=<dir>` as a request
to register that folder in the project list. Login autostart passes `--hidden`
(Windows args / Linux autostart entry) or `openAsHidden` (macOS) so the app
starts in the tray.

Icons: Windows packages `icon.ico`; Linux and macOS use `icon.png` (an ICO is
not a valid GTK/AppKit icon), and the Linux installer's `.desktop` entry points
at that PNG. Both are rendered from `assets/icon.svg` (the concept-04 Cluster
mark) by `desktop/scripts/generate-icon.mjs`, the first step of `npm run build`
in `desktop/`; that step also refreshes the committed PNG/ICO exports and the
web favicons, so a changed mark is regenerated in one command.

Updates: `checkUpdates` maps the gateway's existing `GET /api/update/check`
answer (runtime artifact availability) into the Studio diagnostics shape. The
Electron bundle itself updates through the released installer asset
`zeta-desktop-<version>-win-x64.exe`; no in-app app-side download is advertised.
