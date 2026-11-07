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
zeta[.exe]        compiled kernel (zetacode)
web-app/          Work Studio renderer build
pi_natives.*.node native addons for the target
```

The shell sets `ZETA_WEB_APP_DIR` to its bundled `web-app/`; the browser
launcher relies on the same environment being unnecessary because the renderer
sits beside the binary. Everything else (`ZETA_DESKTOP`, the open-bridge
secret) is desktop-only wiring.

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
