/// `zeta --help` — the workspace's own help. The suite map is the product
/// contract: every tool is independently launchable and has its own help.
pub const CLI_HELP: &str = "\
zeta — the Zeta workspace

One terminal, many tools: a nested-terminal workbench with top-level tabs,
tiled panes of embedded terminals (PTY children), and a menu of the Zeta
suite. Each tool below also runs standalone.

USAGE
  zeta                  Launch the workspace in the current directory
  zetawork              Same workspace (joined form; `zeta work` too)
  zeta code [args]      Hand off to the coding CLI (c; zetacode/zeta-c/zeta-cli)
  zeta editor [args]    Hand off to the TTT editor (e; zetaeditor)
  zeta ide [args]       Hand off to the terminal IDE (i; zetaide)
  zeta doctor           Suite install status + exact fixes
  zeta --help           This help
  zeta --version        Workspace version

KEYS (inside the workspace)
  Alt+N    new shell pane          Alt+T    new tab
  Alt+C    pane: zetacode          Alt+W    close tab
  Alt+E    pane: zeta-editor       Alt+1..9 jump to tab n
  Alt+I    pane: zeta-ide          Alt+←/→  prev/next tab
  Alt+S    pane: shell             Alt+O    focus next pane
  Alt+D    pane: time+calendar     Alt+X    close focused pane
  Alt+L    cycle pane layout       F1       help overlay
  Alt+Q    quit

  Mouse: click a tab (or +) in the tab bar, click a pane to focus it.
  Note: an active IME can swallow Alt combos — switch to English input
  if a hotkey does not respond.

THE ZETA SUITE (each with its own --help)
  zetacode / zeta-c / zeta-cli   coding agent CLI      (npm: @linxiraos/zeta)
  zeta-editor / zeta-e           terminal editor (TTT) (npm: @linxiraos/editor)
  zetaide / zeta-ide / zeta-i    terminal IDE (TermIDE) (npm: @linxiraos/ide)

  A suite tool missing from PATH installs itself into a pane on first
  Alt+<tool> (npm install -g <package>); press the same keys afterwards.

PANES
A pane is a real terminal (PTY): anything that runs in a terminal runs in a
pane — zetacode coding sessions, the zetaeditor, plain shells. Panes tile
through the pane tree: split any pane left/right or top/bottom, and each
pane keeps a stack of pages. Free drag-and-drop arrives with the layout
editor iteration.
";

/// In-app help overlay: keymap + suite map, centered.
pub fn overlay_text() -> &'static str {
	"zeta workspace — help\n\
	\n\
	tabs     Alt+T new · Alt+W close · Alt+1..9 jump · Alt+←/→ cycle\n\
	panes    Alt+N shell · Alt+C zeta-c · Alt+E zeta-editor · Alt+I zeta-ide\n\
	          Alt+D time+calendar · Alt+L layout · Alt+O next pane\n\
	          Alt+X close pane\n\
	mouse    click tab bar (switch / +) · click a pane to focus it\n\
	general  F1 help · Alt+Q quit\n\
	\n\
	suite    zeta-c/zeta-cli/zetacode · zeta-editor/zeta-e · zeta-ide/zeta-i\n\
	          files (in selection)\n\
	missing  a missing suite tool installs itself into a pane on first use\n\
	\n\
	note     an active IME can swallow Alt combos — use English input\n\
	press F1 or Esc to close"
}
