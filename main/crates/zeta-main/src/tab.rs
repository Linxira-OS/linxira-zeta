use crate::layout::Template;
use anyhow::{Result, anyhow};
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
	/// Native workbench widget: live clock + current-month calendar.
	Time,
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
			PaneKind::Command(cmd) => cmd.clone(),
		}
	}

	/// Native widget panes carry no child process.
	pub fn is_widget(&self) -> bool {
		matches!(self, PaneKind::Time)
	}

	/// Resolve the PTY command line, or `None` for the default shell.
	fn command_line(&self) -> Option<String> {
		match self {
			PaneKind::Shell | PaneKind::Time => None,
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

/// What a pane contains: a real PTY child terminal, or a native widget
/// rendered by the workbench itself (no child process).
pub enum PaneBody {
	Pty(Terminal),
	TimeWidget,
}

/// A single embedded pane: a PTY terminal or a native widget.
pub struct Pane {
	pub kind: PaneKind,
	pub body: PaneBody,
}

impl Pane {
	pub fn new(kind: PaneKind, rows: u16, cols: u16, cwd: Option<PathBuf>) -> Result<Self> {
		let body = if kind.is_widget() {
			PaneBody::TimeWidget
		} else {
			match kind.command_line() {
				None => PaneBody::Pty(Terminal::new_with_cwd(rows, cols, cwd)?),
				Some(command) => PaneBody::Pty(Terminal::new_with_command(rows, cols, &command)?),
			}
		};
		Ok(Self { kind, body })
	}

	/// The PTY terminal, when this is a terminal pane.
	pub fn as_terminal(&mut self) -> Option<&mut Terminal> {
		match &mut self.body {
			PaneBody::Pty(term) => Some(term),
			PaneBody::TimeWidget => None,
		}
	}
}

/// A workspace tab: one pane set and the layout template they tile into.
pub struct Tab {
	pub panes: Vec<Pane>,
	pub active: usize,
	pub template: Template,
}

impl Tab {
	/// A tab starts with a single shell pane; the layout grows with panes.
	pub fn new_shell(cwd: Option<PathBuf>) -> Result<Self> {
		let pane = Pane::new(PaneKind::Shell, 24, 80, cwd)?;
		Ok(Self { panes: vec![pane], active: 0, template: Template::Single })
	}

	pub fn add_pane(&mut self, kind: PaneKind, cwd: Option<PathBuf>) -> Result<()> {
		if self.panes.len() >= Template::Quad.slots() {
			return Err(anyhow!("tab already holds the maximum of 4 panes"));
		}
		let pane = Pane::new(kind, 24, 80, cwd)?;
		self.panes.push(pane);
		self.active = self.panes.len() - 1;
		// Grow the template so every pane has a slot.
		let needed = self.panes.len();
		self.template = Template::ALL
			.iter()
			.rev()
			.find(|t| t.slots() >= needed)
			.copied()
			.unwrap_or(Template::Quad);
		Ok(())
	}

	pub fn close_pane(&mut self, index: usize) {
		if self.panes.len() <= 1 {
			return;
		}
		if index < self.panes.len() {
			self.panes.remove(index);
		}
		self.active = self.active.min(self.panes.len() - 1);
	}

	pub fn resize(&mut self, rows: u16, cols: u16) {
		for pane in &mut self.panes {
			if let Some(term) = pane.as_terminal() {
				let _ = term.resize(rows, cols);
			}
		}
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
