# zetawork — the Zeta workspace

One terminal, many tools: `zetawork` opens a nested-terminal workbench —
top-level tabs, tiled panes of real embedded terminals (PTY children), and a
menu of the Zeta suite. Type `zetawork` in a project directory and everything
is one key away:

- `Alt+C` — a pane running `zetacode` (the coding agent)
- `Alt+E` — the built-in editor pane (no separate editor command exists)
- `Alt+N` / `Alt+S` — a plain shell pane
- Left rail — one button per builtin view (search, tasks, automation, mobile by
  default; usage and context start hidden). Clicking one switches the pane
  canvas to that view, clicking it again (or `Esc`) returns. The `+` under the
  buttons opens the manager: show/hide each slot and reorder it, saved to
  `~/.zeta/workbench.toml`. The rail holds builtin views only — there is no
  custom-URL entry.
- `Alt+T` / `Alt+1..9` — new tab / jump between tabs (each tab keeps its own
  layout)
- `Alt+L` — cycle the pane layout (1x1, side-by-side, 2x2)
- `Alt+V` — paste the clipboard image as a temp-file path (the host terminal
  usually swallows image pastes; zetacode loads the path as an attachment)
- `F1` — in-app help; `zetawork --help` — the same map on the command line
- Unbound `Alt` chords are forwarded to the focused pane, so a child
  (`zetacode`) keeps its own `Alt` shortcuts.
- Mouse: double-click a tab — or a pane's title bar — to rename it
  (`Enter` saves, `Esc` cancels). Bracketed paste keeps multi-line clipboard
  text whole instead of submitting line by line.

A bare `zeta` is the suite index: it prints the help that lists `zetawork`,
`zetacode`, and `zetaide`. `zetawork web` serves the full Web UI on loopback
for your browser. Every command also runs standalone (`zetawork`, `zetacode`,
`zetaide`, each with its own `--help`).

New shell panes pick the best installed shell automatically — PowerShell 7
(`pwsh`) first, because its in-box PSReadLine is what gives panes inline
history completion, then Windows PowerShell 5.1 (which ships PSReadLine 2.0.0
and has no prediction), then Git Bash, then cmd. Pin one in Settings →
`default shell` (`auto` · `powershell` · `pwsh` · `git-bash`).

The workspace is Rust (ratatui + portable-pty via the vendored TermIDE panel
crates). This tree is its own Cargo workspace — `cargo build` inside `main/`.

## npm distribution

`@linxiraos/main` (bins `zetawork` and `zeta`) with
`@linxiraos/main-windows-x64` / `@linxiraos/main-linux-x64` platform leaves,
mirroring the editor and ide packages. Platform binaries are built locally and
committed into the leaf `bin/` directories before a release.
