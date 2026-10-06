use std::path::PathBuf;

use anyhow::{Result, anyhow};
use ratatui::layout::Rect;
use termide_core::Panel;
use termide_panel_terminal::Terminal;

use crate::layout::{Axis, PaneNode, Side};

/// Suite bin names, in resolution-priority order. `zeta` is deliberately
/// absent from `AGENT_BINS`: since the npm package split it is the
/// workbench's own bin (`@linxiraos/main`) and resolving the agent pane to
/// it would spawn the workbench recursively.
pub const AGENT_BINS: &[&str] = &["zetacode", "zeta-c", "zeta-cli"];
pub const EDITOR_BINS: &[&str] = &["zetaeditor", "zeta-editor", "zeta-e"];
pub const IDE_BINS: &[&str] = &["zeta-ide", "zeta-i"];

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
	/// A raw command line typed into the pane's shell (used by presets and
	/// ad-hoc commands).
	Command(String),
	/// One-click bring-up of a missing suite tool: the raw install command
	/// runs inside a modern chained shell (never cmd.exe), the pane stays
	/// open afterwards, and the title stays readable (`install · zeta-c`).
	Install {
		tool:    String,
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
	pub page:  usize,
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
						"no install shell found — installs need Windows PowerShell, PowerShell 7 or Git \
						 Bash; cmd.exe is never used for installs"
					)
				})?,
				_ => crate::shell::pick_shell(crate::settings::snapshot().shell),
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

	/// The active PTY page's OSC 0/2 title, when the child announced one.
	/// Widget pages have none.
	pub fn osc_title(&self) -> Option<String> {
		match &self.pages.get(self.page)?.body {
			crate::tab::PaneBody::Pty(term) => term.osc_title(),
			crate::tab::PaneBody::Widget => None,
		}
	}
}

/// A workspace tab: a pane store plus the layout tree tiling them.
pub struct Tab {
	pub panes:     Vec<Pane>,
	/// Minimized panes docked below the workspace. Their PTYs stay alive
	/// while docked; the dock is per-tab — switching top-level tabs shows
	/// that tab's own minimized panes.
	pub minimized: Vec<Pane>,
	pub active:    usize,
	pub tree:      PaneNode,
}

impl Tab {
	/// A tab starts with a single shell pane; the layout grows by splitting.
	pub fn new_shell(cwd: Option<PathBuf>) -> Result<Self> {
		let pane = Pane::new(PaneKind::Shell, 24, 80, cwd)?;
		Ok(Self {
			panes:     vec![pane],
			minimized: Vec::new(),
			active:    0,
			tree:      PaneNode::single(0),
		})
	}

	/// A tab around an existing pane — the promote-pane move: the Pane
	/// object (and its live PTY pages) travels here by value, never
	/// respawned or cloned.
	pub fn with_pane(pane: Pane) -> Self {
		Self {
			panes:     vec![pane],
			minimized: Vec::new(),
			active:    0,
			tree:      PaneNode::single(0),
		}
	}

	/// The pane's unnumbered title: the child's OSC 0/2 name when its active
	/// PTY page announced one, else the pane's default label (active tool,
	/// page count appended).
	pub fn pane_title_base(&self, pane_index: usize) -> String {
		let Some(pane) = self.panes.get(pane_index) else {
			return "pane".into();
		};
		match pane.osc_title() {
			Some(title) if !title.is_empty() => title,
			_ => pane.label(),
		}
	}

	/// The pane's display name: [`Self::pane_title_base`] prefixed with the
	/// pane's 1-based slot number, so identical defaults stay distinguishable
	/// (`1:shell`, `2:shell`). Slots are store positions — they renumber
	/// automatically as panes are promoted out or closed.
	pub fn pane_display_name(&self, pane_index: usize) -> String {
		format!("{}:{}", pane_index + 1, self.pane_title_base(pane_index))
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
		debug_assert!(self.is_consistent(), "pane close desynced tree and store");
	}

	/// Invariant check: the tree tiles exactly the live pane store — one
	/// leaf per pane, every id in range. A violation is the "dead shell"
	/// bug: a tab whose tree outlived its panes renders black content with
	/// an empty label and can never be closed.
	pub fn is_consistent(&self) -> bool {
		let mut ids = Vec::new();
		self.tree.leaf_ids(&mut ids);
		ids.len() == self.panes.len()
			&& ids.iter().all(|id| *id < self.panes.len())
			&& self.panes.iter().all(|pane| !pane.pages.is_empty())
	}

	/// Minimize pane `index`: it leaves the tiling — its space flows to the
	/// siblings, so a maximized neighbor stretches over it — and the pane
	/// docks at the bottom of this tab with its PTY alive. Refused on the
	/// last pane (nothing left to flow the space to).
	pub fn minimize_pane(&mut self, index: usize) -> bool {
		if self.panes.len() <= 1 || index >= self.panes.len() {
			return false;
		}
		if !self.tree.close(index) {
			return false;
		}
		let pane = self.panes.remove(index);
		self.tree.reindex_after_remove(index);
		self.active = self.active.min(self.panes.len() - 1);
		self.minimized.push(pane);
		true
	}

	/// Restore docked pane `slot` into the tiling beside the focused pane on
	/// `side`; focus follows the restored pane.
	pub fn restore_pane(&mut self, slot: usize, side: Side) -> bool {
		if slot >= self.minimized.len() || self.panes.is_empty() {
			return false;
		}
		let pane = self.minimized.remove(slot);
		let id = self.panes.len();
		self.panes.push(pane);
		self.tree.insert_beside(id, self.active, side);
		self.active = id;
		true
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

/// What closing the focused pane takes with it: just the pane, the whole
/// tab (the pane was its last leaf), or — for the last pane of the last
/// tab — nothing: the tab is replaced by a fresh default shell, so a dead
/// or closed pane can never leave an empty shell behind (nor quit the app).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaneClose {
	Pane,
	Tab,
	FreshShell,
}

/// Pure decision for the close-focused-pane action.
pub fn pane_close_target(panes_in_tab: usize, tab_count: usize) -> PaneClose {
	match (panes_in_tab, tab_count) {
		(1, 1) => PaneClose::FreshShell,
		(1, _) => PaneClose::Tab,
		_ => PaneClose::Pane,
	}
}

/// Visible-text open target for a clicked link: the path plus `:line[:col]`
/// when the link knew a cursor position — the form the suite IDE bins accept.
pub fn link_target_text(path: &std::path::Path, line: Option<u32>, col: Option<u32>) -> String {
	let mut text = path.to_string_lossy().into_owned();
	if let Some(line) = line {
		text.push_str(&format!(":{line}"));
		if let Some(col) = col {
			text.push_str(&format!(":{col}"));
		}
	}
	text
}

/// Shell line that opens `target_text` in the suite IDE: `IDE_BINS` first,
/// `EDITOR_BINS` as the fallback, `None` when neither is on PATH.
pub fn ide_open_command(shell: &crate::shell::Shell, target_text: &str) -> Option<String> {
	for bins in [IDE_BINS, EDITOR_BINS] {
		let candidates = crate::shell::resolve_bin_candidates(bins);
		if let Some(bin) = crate::shell::exec_line(shell, &candidates) {
			return Some(format!("{bin} {}", shell.quote_arg(target_text)));
		}
	}
	None
}

/// Ensure the Panel trait is linked even if call sites change.
#[allow(dead_code)]
fn _panel_bound(_: &dyn Panel) {}

#[cfg(test)]
mod tests {
	use super::*;

	fn widget_tab(count: usize) -> Tab {
		let kinds = [PaneKind::Time, PaneKind::Pomodoro, PaneKind::Clipboard, PaneKind::Time];
		let panes: Vec<Pane> = (0..count)
			.map(|i| Pane::new(kinds[i % 4].clone(), 24, 80, None).unwrap())
			.collect();
		let children: Vec<(u32, PaneNode)> =
			(0..count).map(|id| (1000, PaneNode::Leaf(id))).collect();
		Tab {
			panes,
			minimized: Vec::new(),
			active: 0,
			tree: PaneNode::Split { axis: crate::layout::Axis::Row, children },
		}
	}

	#[test]
	fn minimize_docks_and_restore_replants() {
		let mut tab = widget_tab(3);
		assert!(tab.minimize_pane(1), "middle pane minimizes");
		assert_eq!(tab.panes.len(), 2);
		assert_eq!(tab.minimized.len(), 1);
		assert_eq!(tab.active, 0);
		let mut ids: Vec<usize> = Vec::new();
		collect_test_ids(&tab.tree, &mut ids);
		assert_eq!(ids, vec![0, 1], "the tree sheds the leaf; ids above it shift down");

		// The last tiled pane cannot be minimized — nothing to flow space to.
		assert!(tab.minimize_pane(0));
		assert!(!tab.minimize_pane(0), "the only remaining pane refuses");

		assert!(tab.restore_pane(0, Side::Right), "docked pane replants");
		assert_eq!(tab.panes.len(), 2);
		assert_eq!(tab.active, 1, "focus follows the restored pane");
		ids.clear();
		collect_test_ids(&tab.tree, &mut ids);
		assert_eq!(ids, vec![0, 1], "restored beside the focused pane");
		assert!(!tab.restore_pane(9, Side::Left), "bogus slot refused");
	}

	fn collect_test_ids(node: &PaneNode, out: &mut Vec<usize>) {
		match node {
			PaneNode::Leaf(id) => out.push(*id),
			PaneNode::Split { children, .. } => {
				for (_, n) in children {
					collect_test_ids(n, out);
				}
			},
		}
	}

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
			tool:    "zetacode".into(),
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
	}

	#[test]
	fn link_target_text_appends_position_only_when_known() {
		let path = std::path::Path::new("/repo/src/app.rs");
		assert_eq!(link_target_text(path, None, None), "/repo/src/app.rs");
		assert_eq!(link_target_text(path, Some(42), None), "/repo/src/app.rs:42");
		assert_eq!(link_target_text(path, Some(42), Some(7)), "/repo/src/app.rs:42:7");
	}

	#[test]
	fn promote_moves_pane_into_a_focused_tab_without_respawn() {
		// Two widget panes in a row; promote the right one.
		let mut tab = widget_tab(2);
		let moved = tab.take_pane(1).expect("a non-last pane moves out");
		assert_eq!(tab.panes.len(), 1);
		assert_eq!(tab.active, 0, "the old tab focuses the surviving sibling");
		// The same Pane object arrives in the new tab: pages and kind travel
		// with it (a respawned pane would be a fresh shell, and Pane is not
		// Clone — the move is the only way this compiles).
		assert_eq!(moved.pages.len(), 1);
		assert_eq!(moved.pages[0].kind, PaneKind::Pomodoro);

		let new_tab = Tab::with_pane(moved);
		assert_eq!(new_tab.panes.len(), 1);
		assert_eq!(new_tab.panes[0].pages[0].kind, PaneKind::Pomodoro);
		assert_eq!(new_tab.active, 0, "the new tab focuses the moved pane");
		assert_eq!(count_leaves(&new_tab.tree), 1, "the new tab's tree is a single leaf");
	}

	#[test]
	fn promote_refuses_the_last_pane_and_bogus_indexes() {
		let mut tab = widget_tab(1);
		assert!(tab.take_pane(0).is_none(), "the last pane cannot leave");
		assert_eq!(tab.panes.len(), 1, "the refused move keeps the tab intact");

		let mut tab = widget_tab(2);
		assert!(tab.take_pane(9).is_none(), "out-of-range index refused");
	}

	/// (0 | 1) | (2 | 3): a three-level tree with two splits at the root.
	fn nested_tree() -> PaneNode {
		PaneNode::Split {
			axis:     crate::layout::Axis::Row,
			children: vec![
				(1000, PaneNode::Split {
					axis:     crate::layout::Axis::Column,
					children: vec![(1000, PaneNode::Leaf(0)), (1000, PaneNode::Leaf(1))],
				}),
				(1000, PaneNode::Split {
					axis:     crate::layout::Axis::Row,
					children: vec![(1000, PaneNode::Leaf(2)), (1000, PaneNode::Leaf(3))],
				}),
			],
		}
	}

	#[test]
	fn promote_collapse_folds_three_level_trees() {
		let mut tab = widget_tab(4);
		tab.tree = nested_tree();

		// Take the middle-left leaf (1): its parent split collapses to the
		// lone sibling, ids above 1 shift down.
		assert!(tab.take_pane(1).is_some());
		let mut ids = Vec::new();
		collect_test_ids(&tab.tree, &mut ids);
		assert_eq!(ids, vec![0, 1, 2]);

		// Take the left-most leaf (0): the emptied left parent lifts away
		// entirely and the root's first child becomes a plain leaf.
		assert!(tab.take_pane(0).is_some());
		ids.clear();
		collect_test_ids(&tab.tree, &mut ids);
		assert_eq!(ids, vec![0, 1]);
		assert!(matches!(
			&tab.tree,
			PaneNode::Split { children, .. } if matches!(children[0].1, PaneNode::Leaf(_))
		));

		// Take the last remaining right leaf: the tree degenerates to a
		// single bare leaf — a plain one-pane tab again.
		assert!(tab.take_pane(1).is_some());
		ids.clear();
		collect_test_ids(&tab.tree, &mut ids);
		assert_eq!(ids, vec![0]);
		assert!(matches!(tab.tree, PaneNode::Leaf(0)));
	}

	#[test]
	fn close_pane_outcome_cascades_to_tab_and_fresh_shell() {
		use crate::tab::{PaneClose, pane_close_target};
		// Multiple panes: only the pane goes.
		assert_eq!(pane_close_target(3, 2), PaneClose::Pane);
		assert_eq!(pane_close_target(2, 1), PaneClose::Pane);
		// Last leaf of a tab that is not the only tab: the whole tab closes.
		assert_eq!(pane_close_target(1, 3), PaneClose::Tab);
		// Last pane of the last tab: replaced by a fresh shell — the app
		// stays up and no dead shell tab remains.
		assert_eq!(pane_close_target(1, 1), PaneClose::FreshShell);
	}

	#[test]
	fn a_pageless_pane_is_the_dead_shell_state_and_closes_its_tab() {
		// The reported bug: closing a single-pane tab's only page (pane ✕ or
		// the process exiting) used to leave the pane in store and tree with
		// zero pages — black content, `[]` label, uncloseable.
		let mut tab = widget_tab(1);
		assert!(tab.panes[0].close_page(0), "the last page closes its pane");
		assert!(tab.panes[0].pages.is_empty());
		assert!(!tab.is_consistent(), "a page-less pane violates the live-pane invariant");
		// The healing decision for that state is the FreshShell cascade.
		assert_eq!(pane_close_target(1, 1), PaneClose::FreshShell);
		assert_eq!(pane_close_target(1, 4), PaneClose::Tab);
	}

	#[test]
	fn tabs_stay_consistent_through_promote_and_close() {
		let mut tab = widget_tab(4);
		tab.tree = nested_tree();
		assert!(tab.is_consistent());
		assert!(tab.take_pane(1).is_some());
		assert!(tab.is_consistent(), "promote desynced the tree");
		assert!(tab.take_pane(0).is_some());
		assert!(tab.is_consistent());
		tab.close_pane(0);
		assert!(tab.is_consistent(), "close desynced the tree");
		// The last pane cannot be closed away: the store keeps it and the
		// invariant holds (the workspace cascade replaces the tab instead).
		tab.close_pane(0);
		assert_eq!(tab.panes.len(), 1);
		assert!(tab.is_consistent());
	}

	#[test]
	fn pane_display_names_number_slots_and_renumber_after_removal() {
		let mut tab = widget_tab(2);
		assert_eq!(tab.pane_display_name(0), "1:time · calendar");
		assert_eq!(tab.pane_display_name(1), "2:🍅 pomodoro");
		assert_eq!(tab.pane_title_base(1), "🍅 pomodoro");

		// Removing the first pane renumbers the survivor (slots are store
		// positions).
		assert!(tab.take_pane(0).is_some());
		assert_eq!(tab.pane_display_name(0), "1:🍅 pomodoro");
	}

	#[test]
	fn ide_open_command_orders_ide_bins_before_editor() {
		// Resolution order is the contract: a zeta-ide on PATH must win over
		// zeta-editor regardless of alias order inside each list.
		assert_eq!(IDE_BINS, ["zeta-ide", "zeta-i"]);
		assert_eq!(EDITOR_BINS, ["zetaeditor", "zeta-editor", "zeta-e"]);
	}

	#[test]
	fn ide_command_line_quotes_target_for_the_shell() {
		// The composition the workbench types into the new pane: resolved bin
		// word + one shell-correct argument covering spaces and the position.
		let shell = crate::shell::Shell {
			path:   "powershell.exe".into(),
			flavor: crate::shell::ShellFlavor::PowerShell,
		};
		let target = link_target_text(std::path::Path::new("C:/repo/a b.rs"), Some(4), Some(2));
		assert_eq!(format!("zeta-ide {}", shell.quote_arg(&target)), "zeta-ide 'C:/repo/a b.rs:4:2'");
	}
}
