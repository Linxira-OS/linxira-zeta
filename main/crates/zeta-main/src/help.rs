// SPDX-License-Identifier: AGPL-3.0-only
/// `zetawork --help` (and the bare-`zeta` index) — the workspace's own help.
/// The suite map is the product contract: three commands, each with its own
/// help.
pub const CLI_HELP: &str = "\
zeta — the Zeta suite index

One terminal, many tools: zetawork is a nested-terminal workbench with
top-level tabs, tiled panes of embedded terminals (PTY children), and a
menu of the Zeta suite. Each tool below also runs standalone.

USAGE
  zetawork              Launch the workspace in the current directory
  zetawork web          Serve the full Web UI on loopback for your browser
  zetawork doctor       Suite install status + exact fixes
  zeta                  This help (the suite index)
  zetawork --help       This help
  zetawork --version    Workbench version

The other suite tools hand off from inside the workspace: the coding and IDE
panes run zetacode and zetaide, and the editor pane is a built-in editor
(Alt+C / E / I).

KEYS (inside the workspace)
  Alt+N    new shell pane          Alt+T    new tab
  Alt+C    pane: zetacode          Alt+W    close tab
  Alt+E    pane: editor (built in) Alt+1..9 jump to tab n
  Alt+I    pane: zetaide           Alt+←/→  prev/next tab
  Alt+S    pane: shell             Alt+O    focus next pane
  Alt+D    pane: time+calendar     Alt+X    close focused pane
  Alt+L    cycle pane layout       Alt+M    minimize focused pane
  Alt+B    pane → new tab          Alt+Q    quit
  Alt+V    paste image as path     F1       help overlay

  Any other Alt chord is forwarded to the focused pane — unbound host
  combinations (zetacode's own Alt shortcuts) reach the child.

  Mouse: click a tab (or +) in the tab bar; click a pane to focus it;
  drag a shared border to resize (left/right and top/bottom); drag a
  pane by its title onto another pane to swap or reposition it; the –
  button (or the Pane menu) minimizes a pane into the dock at the
  bottom — click its chip there to restore it. Double-click a tab or a
  pane's title to rename it (Enter saves, Esc cancels).
  Rail: the left column's buttons are the builtin views (search, tasks,
  automation and projects by default; the mobile view is listed but
  starts hidden). Click one to switch the pane canvas to that view,
  click it again (or Esc) to go back. The projects view reads the same
  ~/.zeta/projects.json as the GUI: j/k selects, x removes a
  registration (the directory is kept). The + under the buttons opens
  the manager, which shows/hides and reorders them; the choice is saved
  to ~/.zeta/workbench.toml. The rail holds builtin views only — it
  takes no custom URL.
  Paste: bracketed paste keeps multi-line clipboard text whole; an image
  on the clipboard pastes as a temp-file path (Alt+V), which zetacode
  loads as an attachment.
  Note: an active IME can swallow Alt combos — switch to English input
  if a hotkey does not respond.

THE ZETA SUITE (each with its own --help)
  zetacode                       coding agent CLI       (npm: @linxiraos/zeta)
  zetaide                        terminal IDE (TermIDE) (npm: @linxiraos/ide)

  A suite tool missing from PATH installs itself into a pane on first
  Alt+<tool> (npm install -g <package>); press the same keys afterwards.

PANES
A pane is a real terminal (PTY): anything that runs in a terminal runs in a
pane — zetacode coding sessions, plain shells. The editor pane is the
exception: it is a built-in, in-process editor (open a file, edit, Ctrl+S to
save; its language bar shows the file, language and cursor, and notes that no
language service is wired in yet). Panes tile through the pane tree: split
any pane left/right or top/bottom, then drag borders to taste — the Tools
menu carries smart presets (1+2 gives the left pane a third of the width;
thirds, T, quad, and columns cover the wider shapes). Each pane keeps a
stack of pages; minimizing docks the pane (still running) at the bottom of
its tab.
";

/// In-app help overlay: keymap + suite map, centered.
pub fn overlay_text() -> &'static str {
	"zetawork — help\n\ntabs     Alt+T new · Alt+W close · Alt+1..9 jump · Alt+←/→ cycle\nrail     \
	 click a view button · + manages the buttons · Esc back to the panes\npanes    Alt+N shell · \
	 Alt+C zetacode · Alt+E editor (built in) · Alt+I zetaide\nAlt+D time+calendar · Alt+L layout · \
	 Alt+O next pane\nAlt+X close pane · Alt+M minimize pane (dock below)\nAlt+B move pane to its \
	 own new tab · Alt+V paste image (path)\nAlt+any other chord is forwarded to the pane\nmouse    \
	 click tab bar · click pane to focus · drag border = resize\ndrag pane title onto a pane = swap \
	 / reposition\ndouble-click a tab or pane title = rename (Enter save · Esc cancel)\ndock     \
	 minimized panes wait at the bottom — click a chip to restore\npaste    bracketed paste keeps \
	 multi-line clipboard text whole\ngeneral  F1 help · Alt+Q quit\n\nsuite    zetacode · \
	 zetaide\nmissing  a missing suite tool installs itself into a pane on first use\n\nnote     an \
	 active IME can swallow Alt combos — use English input\npress F1 or Esc to close"
}
