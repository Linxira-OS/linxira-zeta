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
