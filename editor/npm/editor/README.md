# @linxiraos/editor

Zeta's built-in terminal editor, as a per-platform binary payload.

The editor is a full-screen text editor with LSP (completion, code actions,
diagnostics), tree-sitter highlighting, vim mode and git diff markers — the
`panel-editor` of the vendored TermIDE workspace (`termide/`), built as its
own **editor-only entry point** (`termide/src/bin/termide-editor.rs`). It
opens files the way `$EDITOR` consumers expect:

```sh
# Absolute path to the payload, then the editor's own command line:
termide-editor FILE[:line[:col]]... [DIRECTORY]
```

- `FILE:line:col` / `FILE:line` / `FILE` — open with the cursor placed
  (1-based; a Windows drive letter is never a position separator).
- `DIRECTORY` — becomes the project root (LSP/git/config resolve there).
- No argument — one empty editor in the current directory.
- The process blocks until the editor is closed, and closing the last panel
  returns control to the caller, so it works as `$EDITOR` for `git commit`,
  `crontab -e`, `visudo`, and for tools that spawn an editor by path.

## No command, by design

This package installs **no command**: there is no `bin` entry, and the editor
is not part of the user-visible command surface (`zetawork` / `zetacode` /
`zetaide`). Consumers resolve the platform leaf's executable and spawn it:

| Consumer | How it resolves the payload |
|---|---|
| `plugins/official/pi-messenger` (`/editor`) | `editor-binary.ts` — `require.resolve("@linxiraos/editor-<platform>-<arch>/bin/…")`, auto-installing this package when missing |
| other integrations | `node_modules/@linxiraos/editor/launcher.js` (`node launcher.js FILE[:line[:col]]`), or `require("@linxiraos/editor/launcher.js").resolveEditor()` |

The platform leaf that matches your system (`@linxiraos/editor-windows-x64`,
`@linxiraos/editor-linux-x64`) carries the executable in its `bin/`
directory through `optionalDependencies`.

## Install

```sh
npm install -g @linxiraos/editor
```

Or as a dependency:

```sh
npm install @linxiraos/editor
```

## Platform support

| Package | OS | Arch | Status |
|---|---|---|---|
| `@linxiraos/editor-windows-x64` | Windows | x64 | supported |
| `@linxiraos/editor-linux-x64` | Linux | x64 | supported |

Only **x64 (amd64)** builds of Linux and Windows are provided. macOS and ARM
(arm64/armv7) builds are **not** available yet.

## License

MIT. The payload is built from the vendored TermIDE snapshot; see
[`VENDOR.md`](./VENDOR.md) and `termide/VENDOR.md` in the source repository
for the modification-layer ledger.
