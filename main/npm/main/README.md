# zeta — the Zeta workspace

One terminal, many tools: `zeta` opens a nested-terminal workbench — top-level
tabs, tiled panes of real embedded terminals (PTY children), and a menu of the
Zeta suite. Type `zeta` in a project directory and everything is one key away:

- `Alt+C` — a pane running `zeta-c` (the coding agent)
- `Alt+E` — a pane running `zeta-e` (the terminal editor)
- `Alt+N` / `Alt+S` — a plain shell pane
- `Alt+T` / `Alt+1..9` — new tab / jump between tabs (each tab keeps its own
  layout)
- `Alt+L` — cycle the pane layout (1x1, side-by-side, 2x2)
- `F1` — in-app help; `zeta --help` — the same map on the command line

Every tool also runs standalone (`zeta-c`, `zeta-editor`/`zeta-e`,
`zeta-ide`/`zeta-i`, each with its own `--help`).

The workspace is Rust (ratatui + portable-pty via the vendored TermIDE panel
crates). This tree is its own Cargo workspace — `cargo build` inside `main/`.

## npm distribution

`@linxiraos/main` (bin `zeta`) with `@linxiraos/main-windows-x64` /
`@linxiraos/main-linux-x64` platform leaves, mirroring the editor and ide
packages. Platform binaries are built locally and committed into the leaf
`bin/` directories before a release.
