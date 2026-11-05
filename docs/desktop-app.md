# Desktop app (paused) — use Work Studio instead

> **Status (2026-11-06).** There is **no shipped desktop application**. The Rust
> GUI (`main/crates/zetawork-gui`, egui + WebView2) is paused, is not built by
> releases, and publishes no installers. `zetawork` remains only as a bin name in
> the paused `@linxiraos/main` package; the name is reserved for the
> main/super-agent surface.

The desktop surface of Zeta is the browser:

```sh
npm i -g @linxiraos/zeta
zetacode serve            # serves Work Studio on loopback
```

Work Studio is the renderer in `web-app/`, packaged inside `@linxiraos/zeta` at
`dist/web-app`; `ZETA_WEB_APP_DIR` points `serve` at a custom build. See
[`zetacode serve` and `zetacode web`](./zeta-serve-web.md) for ports, the
renderer resolution order, and packaging. Platform support is listed in the
repository README.

## What happened to the packaged app

The Windows NSIS installer, portable zip, Linux AppImage and Arch package, the
system tray, and the GUI's own command palette all belonged to the Rust GUI. Since
the 2026-11-05 ruling the release no longer builds or uploads those assets (the
`release_desktop_archives` job is dispatch-only), and the GUI crates stay in the
tree as history. If that line ever returns it needs a new ruling and its own
staging — see `document/release.md`.

The GUI-only pages in this documentation tree (`gui-*.md`) are kept as design
history; they describe software that does not ship.
