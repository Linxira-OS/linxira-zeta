/// `zeta --help` — the workspace's own help. The suite map is the product
/// contract: every tool is independently launchable and has its own help.
pub const CLI_HELP: &str = "\
zeta — the Zeta workspace

One terminal, many tools: a nested-terminal workbench with top-level tabs,
tiled panes of embedded terminals (PTY children), and a menu of the Zeta
suite. Each tool below also runs standalone.

USAGE
  zeta                  Launch the workspace in the current directory
  zeta --help           This help
  zeta --version        Workspace version

KEYS (inside the workspace)
  Alt+N    new shell pane          Alt+T    new tab
  Alt+C    pane: zeta-c            Alt+W    close tab
  Alt+E    pane: zeta-e            Alt+1..9 jump to tab n
  Alt+S    pane: shell             Alt+←/→  prev/next tab
  Alt+L    cycle pane layout       Alt+O    focus next pane
  Alt+X    close focused pane      F1       help overlay
  Alt+Q    quit

THE ZETA SUITE (each with its own --help)
  zeta-c / zeta-cli / zetacode   coding agent CLI      (npm: @linxiraos/zeta)
  zeta-editor / zeta-e           terminal editor (TTT) (npm: @linxiraos/editor)
  zeta-ide / zeta-i              terminal IDE (TermIDE)(npm: @linxiraos/ide)
  files                          terminal file manager (in selection)

PANES
A pane is a real terminal (PTY): anything that runs in a terminal runs in a
pane — zeta-c coding sessions, the zeta-e editor, plain shells. Panes tile by
layout template (1x1, side-by-side, quad); free drag-and-drop arrives with
the layout editor iteration.
";

/// In-app help overlay: keymap + suite map, centered.
pub fn overlay_text() -> &'static str {
	"zeta workspace — help\n\
	\n\
	tabs     Alt+T new · Alt+W close · Alt+1..9 jump · Alt+←/→ cycle\n\
	panes    Alt+N shell · Alt+C zeta-c · Alt+E zeta-e · Alt+L layout\n\
	          Alt+O next pane · Alt+X close pane\n\
	general  F1 help · Alt+Q quit\n\
	\n\
	suite    zeta-c/zeta-cli/zetacode · zeta-editor/zeta-e · zeta-ide/zeta-i\n\
	          files (in selection)\n\
	\n\
	press F1 or Esc to close"
}
