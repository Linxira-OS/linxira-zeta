# Zeta Desktop

Electron desktop shell for the local Zeta service. It embeds the Web UI and
Stats dashboard, starts the service without a terminal window, and never opens
the system browser.

## Development

```powershell
npm install
npm run dev
```

The shell uses the local `packages/coding-agent/dist/zeta(.exe)` when available,
then falls back to the source CLI.

## Portable Build

```powershell
npm run dist
```

The build produces release artifacts under `../temp/desktop/release/`:

- Windows:
  - `zeta-desktop-<version>-win-x64/` — no-install unpacked app (`Zeta.exe`).
  - `zeta-desktop-<version>-win-x64.zip` — portable green version.
  - `zeta-desktop-<version>-win-x64.exe` — NSIS installer (assisted, per-user).
- Linux:
  - `zeta-desktop-<version>-linux-x64/` plus `.tar.gz` archive.
  - `zeta-desktop-<version>-linux-x86_64.AppImage` — portable AppImage.
  - `zeta-desktop-<version>-linux-amd64.deb` — Debian/Ubuntu package.

Installers and archives are uploaded as GitHub Release assets by CI; the
unpacked directory is a local/CI smoke target only.

Run the app executable directly. It includes Zeta, a Node runtime, and the
standalone Web UI, so the target machine needs neither Bun, Node, a terminal,
nor a system browser.

Validate a built artifact without opening a visible desktop window:

```powershell
npm run smoke -- --app ../temp/desktop/release/zeta-desktop-<version>-win-x64
```
