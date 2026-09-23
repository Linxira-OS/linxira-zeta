# @linxiraos/editor

Zeta's bundled terminal editor (vendored [TTT Editor](https://github.com/eugenioenko/ttt) v1.5.0, MIT).

This package installs the editor binary for your platform via `optionalDependencies` and provides a `zeta-editor` launcher that execs it.

## Install

```sh
npm install -g @linxiraos/editor
zeta-editor            # launches the editor
```

Or as a dependency:

```sh
npm install @linxiraos/editor
npx zeta-editor --version
```

## Platform support

| Package                         | OS      | Arch | Status    |
| ------------------------------- | ------- | ---- | --------- |
| `@linxiraos/editor-windows-x64` | Windows | x64  | supported |
| `@linxiraos/editor-linux-x64`   | Linux   | x64  | supported |

Only **x64 (amd64)** builds of Linux and Windows are provided. macOS and ARM (arm64/armv7) builds are **not** available yet. On unsupported platforms the launcher exits with a clear error; the rest of Zeta is unaffected.

## License

The vendored editor is MIT-licensed (see [upstream](https://github.com/eugenioenko/ttt)). Zeta packaging is part of [linxira-zeta](https://github.com/Linxira-OS/linxira-zeta) (MIT).
