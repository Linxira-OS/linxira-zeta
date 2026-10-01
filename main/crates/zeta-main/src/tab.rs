use crate::layout::{Axis, PaneNode, Side};
use anyhow::{Result, anyhow};
use ratatui::layout::Rect;
use std::path::PathBuf;
use termide_core::Panel;
use termide_panel_terminal::Terminal;

/// Suite bin names, in resolution-priority order. `zeta` is deliberately
/// absent from `AGENT_BINS`: since the npm package split it is the
/// workbench's own bin (`@linxiraos/main`) and resolving the agent pane to
/// it would spawn the workbench recursively.
pub const AGENT_BINS: &[&str] = &["zetacode", "zeta-c", "zeta-cli"];
pub const EDITOR_BINS: &[&str] = &["zetaeditor", "zeta-editor", "zeta-e"];
pub const IDE_BINS: &[&str] = &["zeta-ide", "zeta-i"];
pub const FILES_BINS: &[&str] = &["yazi"];

/// What a pane runs — drives the pane label and the menu entries.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum PaneKind {
	Shell,
	Agent,
	Editor,
	Ide,
	/// Native workbench widgets (no child process): time+calendar dashboard,
	/// pomodoro timer, clipboard history.
	Time,
	Pomodoro,
	Clipboard,
	/// Terminal file manager (yazi) — the files leg.
	Command(String),
	/// One-click bring-up of a missing suite tool: the raw install command
	/// runs inside a modern chained shell (never cmd.exe), the pane stays
	/// open afterwards, and the title stays readable (`install · zeta-c`).
	Install {
		tool: String,
		command: String,
	},
}

impl PaneKind {
	pub fn label(&self) -> String {
		match self {
			PaneKind::Shell => "shell".into(),
			PaneKind::Agent => "zetacode".into(),
			PaneKind::Editor => "zetaeditor".into(),
			PaneKind::Ide => "zetaide".into(),
			PaneKind::Time => "time · calendar".into(),
			PaneKind::Pomodoro => "🍅 pomodoro".into(),
			PaneKind::Clipboard => "📋 clipboard".into(),
			PaneKind::Command(cmd) => cmd.clone(),
			PaneKind::Install { tool, .. } => format!("install · {tool}"),
		}
	}

	/// Native widget panes carry no child process.
	pub fn is_widget(&self) -> bool {
		matches!(self, PaneKind::Time | PaneKind::Pomodoro | PaneKind::Clipboard)
	}

	/// The raw install spec for a suite tool: `(pane label, command)` — no
	/// shell wrapping lives here, the spawn layer picks the shell. The suite
	/// table renders the same strings, so both layers stay in sync.
	pub(crate) fn install_spec(&self) -> Option<(&'static str, &'static str)> {
		match self {
			PaneKind::Agent => Some(("zetacode", "npm install -g @linxiraos/zeta")),
			PaneKind::Editor => Some(("zetaeditor", "npm install -g @linxiraos/editor")),
			PaneKind::Ide => Some(("zetaide", "npm install -g @linxiraos/ide")),
			_ => None,
		}
	}

	/// The install pane kind when this suite tool is missing from PATH.
	///
	/// The workbench offers one-click bring-up of missing suite members: the
	/// returned pane runs the raw install command inside a modern chained
	/// shell (Windows PowerShell → PowerShell 7 → Git Bash — cmd.exe is
	/// never used for installs), keeps the pane open so the output stays
	/// visible, and the next Alt+<tool> finds the freshly installed binary.
	pub fn install_kind(&self) -> Option<PaneKind> {
		let bins = match self {
			PaneKind::Agent => AGENT_BINS,
			PaneKind::Editor => EDITOR_BINS,
			PaneKind::Ide => IDE_BINS,
			_ => return None,
		};
		if resolve_bin(bins).is_some() {
			return None;
		}
		let (tool, command) = self.install_spec()?;
		Some(PaneKind::Install { tool: tool.to_string(), command: command.to_string() })
	}

	/// The command line this pane types into its chained shell — `None` for
	/// a bare interactive shell. Tool paths are quoted for the target shell;
	/// the shell stays open after the command exits, so install output and
	/// tool panes keep their history.
	fn launch_line(&self, shell: &crate::shell::Shell) -> Option<String> {
		match self {
			PaneKind::Shell | PaneKind::Time | PaneKind::Pomodoro | PaneKind::Clipboard => None,
			PaneKind::Command(line) => Some(line.clone()),
			PaneKind::Install { command, .. } => Some(command.clone()),
			PaneKind::Agent => {
				let candidates = crate::shell::resolve_bin_candidates(AGENT_BINS);
				crate::shell::exec_line(shell, &candidates)
			},
			PaneKind::Editor => {
				let candidates = crate::shell::resolve_bin_candidates(EDITOR_BINS);
				crate::shell::exec_line(shell, &candidates)
			},
			PaneKind::Ide => {
				let candidates = crate::shell::resolve_bin_candidates(IDE_BINS);
				crate::shell::exec_line(shell, &candidates)
			},
		}
	}
}

/// What a pane page contains: a real PTY child terminal, or a native widget
/// rendered by the workbench itself (no child process).
#[allow(clippy::large_enum_variant)]
pub enum PaneBody {
	Pty(Terminal),
	Widget,
}

/// One sub-page of a pane. Pages are live: switching keeps every PTY running
/// so several zeta-c sessions can share one pane slot.
pub struct Page {
	pub kind: PaneKind,
	pub body: PaneBody,
}

/// A single embedded pane: a stack of sub-pages plus which one shows.
pub struct Pane {
	pub pages: Vec<Page>,
	pub page: usize,
}

impl Pane {
	pub fn new(kind: PaneKind, rows: u16, cols: u16, cwd: Option<PathBuf>) -> Result<Self> {
		let mut pane = Self { pages: Vec::new(), page: 0 };
		pane.open_page(kind, rows, cols, cwd)?;
		Ok(pane)
	}

	/// Open a new sub-page and switch to it. Widget pages are free; PTY pages
	/// spawn the chained shell and type the pane's command into it.
	pub fn open_page(
		&mut self,
		kind: PaneKind,
		rows: u16,
		cols: u16,
		cwd: Option<PathBuf>,
	) -> Result<usize> {
		let body = if kind.is_widget() {
			PaneBody::Widget
		} else {
			// Every PTY page is the modern chained shell (Windows
			// PowerShell → PowerShell 7 → Git Bash, cmd.exe only as last
			// resort — never for installs). The pane's command is typed
			// into the interactive shell: quoting stays shell-correct for
			// spaced paths, and the shell keeps the pane open after the
			// command exits so install output remains visible.
			let shell = match &kind {
				PaneKind::Install { .. } => crate::shell::detect_install_shell().ok_or_else(|| {
					anyhow!(
						"no install shell found — installs need Windows PowerShell, \
						 PowerShell 7 or Git Bash; cmd.exe is never used for installs"
					)
				})?,
				_ => crate::shell::detect_shell(),
			};
			let mut term = Terminal::new_with_shell(rows, cols, &shell.path.to_string_lossy(), cwd)?;
			if let Some(line) = kind.launch_line(&shell) {
				// Input is buffered by the pty until the shell reads it,
				// so sending before the first prompt is safe.
				let _ = term.send_command(&line);
			}
			PaneBody::Pty(term)
		};
		self.pages.push(Page { kind, body });
		self.page = self.pages.len() - 1;
		Ok(self.page)
	}

	/// Close sub-page `idx`. Returns true when the pane has no pages left and
	/// must be closed entirely.
	pub fn close_page(&mut self, idx: usize) -> bool {
		if idx < self.pages.len() {
			self.pages.remove(idx);
		}
		if self.page >= self.pages.len() {
			self.page = self.pages.len().saturating_sub(1);
		}
		self.pages.is_empty()
	}

	pub fn active_page(&self) -> Option<&Page> {
		self.pages.get(self.page)
	}

	/// The active page's PTY terminal, when it is a terminal page.
	pub fn as_terminal(&mut self) -> Option<&mut Terminal> {
		match self.pages.get_mut(self.page)?.body {
			PaneBody::Pty(ref mut term) => Some(term),
			PaneBody::Widget => None,
		}
	}

	pub fn is_widget(&self) -> bool {
		self
			.active_page()
			.map(|p| p.kind.is_widget())
			.unwrap_or(false)
	}

	/// Title label: active page's tool, page count appended when stacked.
	pub fn label(&self) -> String {
		let base = self
			.active_page()
			.map(|p| p.kind.label())
			.unwrap_or_default();
		if self.pages.len() > 1 {
			format!("{base} ({}/{})", self.page + 1, self.pages.len())
		} else {
			base
		}
	}
}

/// A workspace tab: a pane store plus the layout tree tiling them.
pub struct Tab {
	pub panes: Vec<Pane>,
	pub active: usize,
	pub tree: PaneNode,
}

impl Tab {
	/// A tab starts with a single shell pane; the layout grows by splitting.
	pub fn new_shell(cwd: Option<PathBuf>) -> Result<Self> {
		let pane = Pane::new(PaneKind::Shell, 24, 80, cwd)?;
		Ok(Self { panes: vec![pane], active: 0, tree: PaneNode::single(0) })
	}

	/// Split pane `split_at` along `axis` and open `kind` in the new slot —
	/// the pane whose button you pressed, not the globally focused one. The
	/// direction is explicit — the title bar carries `[↔]`/`[↕]` for it.
	pub fn add_pane(
		&mut self,
		split_at: usize,
		kind: PaneKind,
		cwd: Option<PathBuf>,
		focused_rect: Rect,
		axis: Axis,
	) -> Result<()> {
		// Self-heal a corrupted tree before touching it: duplicates make two
		// panes share a highlight and split together (user-reported bug).
		if self.tree.has_duplicates() {
			let needed = self.tree.deduplicate(self.panes.len());
			while self.panes.len() < needed {
				self
					.panes
					.push(Pane::new(PaneKind::Shell, 24, 80, cwd.clone())?);
			}
			self.active = self.active.min(self.panes.len() - 1);
		}
		let id = self.panes.len();
		let mut pane = Pane::new(kind, 24, 80, cwd)?;
		// Size the new pane's first PTY to the actual slot it will occupy.
		let (rows, cols) = slot_grid(focused_rect, axis);
		if let Some(term) = pane.as_terminal() {
			let _ = term.resize(rows, cols);
		}
		self.panes.push(pane);
		self.tree.split(split_at, axis, id);
		self.active = id;
		Ok(())
	}

	/// Move pane `moved` beside `target` on `side` — the drop-on-edge drag
	/// semantic ("drag to the left edge = becomes the left neighbor").
	/// Contents (the whole pane with all sub-pages) travel.
	pub fn move_pane_relative(&mut self, moved: usize, target: usize, side: Side) {
		if moved == target || moved >= self.panes.len() || target >= self.panes.len() {
			return;
		}
		if !self.tree.detach(moved) {
			return;
		}
		self.tree.insert_beside(moved, target, side);
		self.active = moved;
	}

	/// Take pane `index` out of this tab (caller moves it into a new tab).
	/// Returns None when it is the last pane here.
	pub fn take_pane(&mut self, index: usize) -> Option<Pane> {
		if self.panes.len() <= 1 || index >= self.panes.len() {
			return None;
		}
		if !self.tree.close(index) {
			return None;
		}
		let pane = self.panes.remove(index);
		self.tree.reindex_after_remove(index);
		self.active = self.active.min(self.panes.len() - 1);
		Some(pane)
	}

	/// Close pane `index` (tree collapse + store reindex). No-op on the last.
	pub fn close_pane(&mut self, index: usize) {
		if self.panes.len() <= 1 || index >= self.panes.len() {
			return;
		}
		if !self.tree.close(index) {
			return;
		}
		self.panes.remove(index);
		self.tree.reindex_after_remove(index);
		self.active = self.active.min(self.panes.len() - 1);
	}

	/// Apply a preset tree; missing slots become fresh shell panes. Refuses
	/// (no data loss) when live panes outnumber the preset's slots.
	pub fn apply_preset(&mut self, tree: PaneNode, cwd: Option<PathBuf>) -> Result<()> {
		let leaves = count_leaves(&tree);
		if leaves > self.panes.len() {
			for id in self.panes.len()..leaves {
				self
					.panes
					.push(Pane::new(PaneKind::Shell, 24, 80, cwd.clone())?);
				let _ = id;
			}
		}
		if leaves < self.panes.len() {
			return Err(anyhow!(
				"layout {} holds {} slots — close {} more pane(s) first",
				leaves,
				leaves,
				self.panes.len() - leaves
			));
		}
		self.tree = tree;
		Ok(())
	}

	/// Resize every PTY page (window resize fans out to the whole store).
	pub fn resize(&mut self, rows: u16, cols: u16) {
		for pane in &mut self.panes {
			for page in &mut pane.pages {
				if let PaneBody::Pty(term) = &mut page.body {
					let _ = term.resize(rows, cols);
				}
			}
		}
	}
}

/// Grid size for a new pane occupying half of `area` across `axis`.
fn slot_grid(area: Rect, axis: Axis) -> (u16, u16) {
	let (w, h) = match axis {
		Axis::Row => (area.width / 2, area.height),
		Axis::Column => (area.width, area.height / 2),
	};
	(h.saturating_sub(2).max(1), w.saturating_sub(2).max(1))
}

fn count_leaves(node: &PaneNode) -> usize {
	match node {
		PaneNode::Leaf(_) => 1,
		PaneNode::Split { children, .. } => children.iter().map(|(_, n)| count_leaves(n)).sum(),
	}
}

/// First existing binary among `names`, via the shell layer's PATHEXT-aware
/// probe: process PATH (the same value the pty child inherits), then npm/
/// native global-bin dirs a stale GUI PATH may be missing, then `where.exe`.
///
/// npm's Windows installs are shims — `name`, `name.ps1`, `name.cmd` — with
/// no `name.exe`; probing only `.exe` reported installed tools as missing
/// and opened bogus install panes.
pub fn resolve_bin(names: &[&str]) -> Option<PathBuf> {
	crate::shell::resolve_bin_candidates(names)
		.into_iter()
		.next()
}

/// Ensure the Panel trait is linked even if call sites change.
#[allow(dead_code)]
fn _panel_bound(_: &dyn Panel) {}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn install_specs_map_to_npm_packages() {
		assert_eq!(
			PaneKind::Agent.install_spec(),
			Some(("zetacode", "npm install -g @linxiraos/zeta"))
		);
		assert_eq!(
			PaneKind::Editor.install_spec(),
			Some(("zetaeditor", "npm install -g @linxiraos/editor"))
		);
		assert_eq!(PaneKind::Ide.install_spec(), Some(("zetaide", "npm install -g @linxiraos/ide")));
		assert_eq!(PaneKind::Shell.install_spec(), None, "shells never install");
	}

	#[test]
	fn install_pane_title_is_readable_and_never_a_command_line() {
		let kind = PaneKind::Install {
			tool: "zetacode".into(),
			command: "npm install -g @linxiraos/zeta".into(),
		};
		assert_eq!(kind.label(), "install · zetacode");
		assert!(!kind.label().contains("cmd"), "no shell invocation in titles");
		assert!(!kind.label().contains("npm"), "the raw command stays out of the title");
	}

	#[test]
	fn install_specs_never_wrap_in_cmd() {
		// Regression guard: install panes used to run `cmd /k npm …` on
		// Windows. The spec layer must stay raw — shell choice belongs to
		// the spawn layer, and cmd.exe is banned there for installs.
		for kind in [PaneKind::Agent, PaneKind::Editor, PaneKind::Ide, PaneKind::Shell] {
			if let Some((_, command)) = kind.install_spec() {
				assert!(!command.contains("cmd /k"), "cmd /k leaked into {command}");
				assert!(!command.contains("sh -c"), "sh -c leaked into {command}");
			}
		}
	}

	#[test]
	fn agent_bins_skip_the_workbench_itself() {
		// `zeta` is the workbench's own npm bin (@linxiraos/main) since the
		// package split; resolving the Agent pane to it would spawn the
		// workbench recursively. Whatever the alias order, the workbench bin
		// itself must never enter any suite resolution list.
		assert!(!AGENT_BINS.contains(&"zeta"), "agent must not resolve to the workbench bin");
		assert!(!EDITOR_BINS.contains(&"zeta"));
		assert!(!IDE_BINS.contains(&"zeta"));
		assert!(!FILES_BINS.contains(&"zeta"));
	}
}
