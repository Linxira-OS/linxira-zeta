# zetawork — the Zeta workspace

One terminal, many tools: `zetawork` opens a nested-terminal workbench —
top-level tabs, tiled panes of real embedded terminals (PTY children), and a
menu of the Zeta suite. Type `zetawork` in a project directory and everything
is one key away:

- `Alt+C` — a pane running `zetacode` (the coding agent)
- `Alt+E` — the built-in editor pane (no separate editor command exists)
- `Alt+N` / `Alt+S` — a plain shell pane
- `Alt+T` / `Alt+1..9` — new tab / jump between tabs (each tab keeps its own
  layout)
- `Alt+L` — cycle the pane layout (1x1, side-by-side, 2x2)
- `F1` — in-app help; `zetawork --help` — the same map on the command line

A bare `zeta` is the suite index: it prints the help that lists `zetawork`,
`zetacode`, and `zetaide`. `zetawork web` serves the full Web UI on loopback
for your browser. Every command also runs standalone (`zetawork`, `zetacode`,
`zetaide`, each with its own `--help`).

The workspace is Rust (ratatui + portable-pty via the vendored TermIDE panel
crates). This tree is its own Cargo workspace — `cargo build` inside `main/`.

## npm distribution

`@linxiraos/main` (bins `zetawork` and `zeta`) with
`@linxiraos/main-windows-x64` / `@linxiraos/main-linux-x64` platform leaves,
mirroring the editor and ide packages. Platform binaries are built locally and
committed into the leaf `bin/` directories before a release.

### Companions: zetacode and zetaide ship with zetawork

Installing the workbench installs the whole suite: the same
`optionalDependencies` block that pins the platform leaves also pins
`@linxiraos/zeta` (bin `zetacode`) and `@linxiraos/ide` (bin `zetaide`) at this
package's own version. npm therefore materializes all three products under
`node_modules/@linxiraos/`:

| Product    | npm package / binary                                                   |
| ---------- | ---------------------------------------------------------------------- |
| `zetawork` | `@linxiraos/main-windows-x64/bin/zeta.exe` · `@linxiraos/main-linux-x64/bin/zeta-linux-x64` |
| `zetacode` | `@linxiraos/zeta` (published bin `zetacode` → `dist/cli.js`)            |
| `zetaide`  | `@linxiraos/ide-windows-x64/bin/termide.exe` · `@linxiraos/ide-linux-x64/bin/termide-linux-x64` |

**Why `optionalDependencies` and not `dependencies`.** Two reasons, and they
are the same two that govern the platform leaves:

- the companions are pinned to an **exact** version, so make no sense as a
  range; the repo's one-version-line rule makes an exact pin the honest form;
- an install must never fail because one companion is unavailable for the
  host. The companion packages carry their own `os`/`cpu`-gated leaves
  (`os: ["win32"]` / `os: ["linux"]`, `cpu: ["x64"]`), so npm skips the
  foreign binary — a Linux install never drags a Windows `.exe` — and a
  registry/skip failure degrades to a missing command with a resolver message
  instead of aborting the whole workbench install.

No binary is duplicated into a leaf: the workbench binary stays in
`main-<platform>-x64`, `zetacode` stays in `@linxiraos/zeta`, `zetaide` stays in
`@linxiraos/ide-<platform>-x64`. `scripts/check-workbench-bundles.ts` guards the
declaration and the release/packaging steps that carry it.
