# Zeta Desktop

Electron desktop shell for the local Zeta service. It embeds the Work Studio
Web UI and Stats dashboard, starts the standalone Zeta kernel without a
terminal window, and never opens the system browser.

## Runtime facts

- Electron **45.3.0** (Chromium 156, Node 24.22); pinned in `package.json` and
  `electron-builder.yml`.
- The service is the compiled standalone Bun kernel (`zeta` / `zeta.exe`). It
  serves the staged `web-app` build itself — there is no separate Node runtime,
  Next standalone server, or runtime `node_modules` inside the package.
- `app.asar` contains only `dist/**` and `package.json`; native addons embedded
  in the kernel are extracted to the user cache on first run, not staged beside
  it.
- SSH execution targets use the system OpenSSH client and an `ssh -L` tunnel to
  the remote loopback Studio host. No password is persisted and unknown host
  keys are never auto-accepted.
- Terminal recordings are `.studiocast` JSONL files under the app's `userData`;
  playback is served through `zeta-artifact://` and export uses the native save
  dialog.
- Diagnostics samples desktop memory through the existing
  `pi:sample-memory` IPC (boot + 60s heartbeat + on-demand), with no separate
  telemetry exporter.

## Development

```powershell
npm install
npm run dev
```

The shell uses the local `packages/coding-agent/dist/zeta(.exe)` when available,
then falls back to the source CLI.

## Portable build

```powershell
npm run dist
```

Artifacts land under `../temp/desktop/release/`:

- Windows: `zeta-desktop-<version>-win-x64/`, `.zip`, NSIS `.exe`.
- Linux: unpacked directory, `.tar.gz`, `.AppImage`, `.deb`.

Installers/archives are release assets; the unpacked directory is the local/CI
smoke target. The target machine needs neither Bun, Node, a terminal, nor a
system browser.

## Smoke

Validate a packaged artifact without opening an Electron window:

```powershell
npm run smoke -- --app ../temp/desktop/release/zeta-desktop-<version>-win-x64
```

The script checks the staged kernel + `web-app/index.html`, starts `zeta serve`
on free loopback ports, and verifies the default workspace, SSE stream, built
assets, API, and Stats dashboard.
