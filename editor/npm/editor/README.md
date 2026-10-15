# @linxiraos/editor

Zeta's bundled terminal editor binaries (vendored [TTT Editor](https://github.com/eugenioenko/ttt) v1.5.0, MIT).

This package installs the editor binary for your platform through `optionalDependencies`. It ships **no command**: `zetawork`'s editor pane is built in (in-process), `zetaide` is the terminal IDE, and the plugin surface resolves the platform binary directly (`plugins/official/pi-messenger/editor-binary.ts`). The editor's retired command names are gone.

## Install

```sh
npm install -g @linxiraos/editor
```

Or as a dependency:

```sh
npm install @linxiraos/editor
```

The platform leaf that matches your system (`@linxiraos/editor-windows-x64`, `@linxiraos/editor-linux-x64`) carries the executable in its `bin/` directory.

## Platform support

| Package | OS | Arch | Status |
|---|---|---|---|
| `@linxiraos/editor-windows-x64` | Windows | x64 | supported |
| `@linxiraos/editor-linux-x64` | Linux | x64 | supported |

Only **x64 (amd64)** builds of Linux and Windows are provided. macOS and ARM (arm64/armv7) builds are **not** available yet.

## License

The vendored editor is MIT-licensed (see [upstream](https://github.com/eugenioenko/ttt)). Zeta packaging is part of [linxira-zeta](https://github.com/Linxira-OS/linxira-zeta) (MIT).
