use crate::layout::{Axis, PaneNode, Side};
use anyhow::{Result, anyhow};
use ratatui::layout::Rect;
use std::path::PathBuf;
use termide_core::Panel;
use termide_panel_terminal::Terminal;

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
	Command(String),
}

impl PaneKind {
	pub fn label(&self) -> String {
		match self {
			PaneKind::Shell => "shell".into(),
			PaneKind::Agent => "zeta-c".into(),
			PaneKind::Editor => "zeta-e".into(),
			PaneKind::Ide => "zeta-ide".into(),
			PaneKind::Time => "time · calendar".into(),
			PaneKind::Pomodoro => "🍅 pomodoro".into(),
			PaneKind::Clipboard => "📋 clipboard".into(),
			PaneKind::Command(cmd) => cmd.clone(),
		}
	}

	/// Native widget panes carry no child process.
	pub fn is_widget(&self) -> bool {
		matches!(self, PaneKind::Time | PaneKind::Pomodoro | PaneKind::Clipboard)
	}

	/// Resolve the PTY command line, or `None` for the default shell.
	fn command_line(&self) -> Option<String> {
		match self {
			PaneKind::Shell | PaneKind::Time | PaneKind::Pomodoro | PaneKind::Clipboard => None,
			PaneKind::Agent => {
				Some(resolve_bin(&["zeta-c", "zeta"]).map(|b| b.to_string_lossy().into_owned())?)
			},
			PaneKind::Editor => {
				Some(resolve_bin(&["zeta-e", "zeta-editor"]).map(|b| b.to_string_lossy().into_owned())?)
			},
			PaneKind::Ide => {
				Some(resolve_bin(&["zeta-i", "zeta-ide"]).map(|b| b.to_string_lossy().into_owned())?)
			},
			PaneKind::Command(cmd) => Some(cmd.clone()),
		}
	}

	/// The npm quick-install command for a suite tool that is not on PATH.
	///
	/// The workbench offers one-click bring-up of missing suite members: the
	/// returned command runs in a dedicated pane (`cmd /k` keeps the pane open
	/// on Windows so the output stays visible), and the next Alt+<tool> finds
	/// the freshly installed binary.
	pub fn install_command(&self) -> Option<String> {
		let raw = match self {
			PaneKind::Agent if resolve_bin(&["zeta-c", "zeta"]).is_none() => {
				"npm i -g @linxiraos/zeta"
			},
			PaneKind::Editor if resolve_bin(&["zeta-e", "zeta-editor"]).is_none() => {
				"npm i -g @linxiraos/editor"
			},
			PaneKind::Ide if resolve_bin(&["zeta-i", "zeta-ide"]).is_none() => {
				"npm i -g @linxiraos/ide"
			},
			_ => return None,
		};
		Some(if cfg!(windows) {
			format!("cmd /k {raw}")
		} else {
			format!("sh -c \"{raw}; exec sh\"")
		})
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
	/// spawn a child.
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
			match kind.command_line() {
				None => PaneBody::Pty(Terminal::new_with_cwd(rows, cols, cwd)?),
				Some(command) => PaneBody::Pty(Terminal::new_with_command(rows, cols, &command)?),
			}
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

	/// Split the focused pane along `axis` and open `kind` in the new slot.
	/// The direction is explicit — the title bar carries `[↔]`/`[↕]` for it.
	pub fn add_pane(
		&mut self,
		kind: PaneKind,
		cwd: Option<PathBuf>,
		focused_rect: Rect,
		axis: Axis,
	) -> Result<()> {
		let id = self.panes.len();
		let mut pane = Pane::new(kind, 24, 80, cwd)?;
		// Size the new pane's first PTY to the actual slot it will occupy.
		let (rows, cols) = slot_grid(focused_rect, axis);
		if let Some(term) = pane.as_terminal() {
			let _ = term.resize(rows, cols);
		}
		self.panes.push(pane);
		self.tree.split(self.active, axis, id);
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

/// First existing binary on PATH among `names`.
pub fn resolve_bin(names: &[&str]) -> Option<PathBuf> {
	let path = std::env::var_os("PATH")?;
	let exe_ext = if cfg!(windows) { ".exe" } else { "" };
	for dir in std::env::split_paths(&path) {
		for name in names {
			let candidate = dir.join(format!("{name}{exe_ext}"));
			if candidate.is_file() {
				return Some(candidate);
			}
		}
	}
	None
}

/// Ensure the Panel trait is linked even if call sites change.
#[allow(dead_code)]
fn _panel_bound(_: &dyn Panel) {}
