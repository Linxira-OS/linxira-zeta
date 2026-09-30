use crate::layout::Template;
use anyhow::{anyhow, Result};
use std::path::PathBuf;
use termide_core::Panel;
use termide_panel_terminal::Terminal;

/// What a pane runs — drives the pane label and the menu entries.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum PaneKind {
	Shell,
	Agent,
	Editor,
	Command(String),
}

impl PaneKind {
	pub fn label(&self) -> String {
		match self {
			PaneKind::Shell => "shell".into(),
			PaneKind::Agent => "zeta-c".into(),
			PaneKind::Editor => "zeta-e".into(),
			PaneKind::Command(cmd) => cmd.clone(),
		}
	}

	/// Resolve the PTY command line, or `None` for the default shell.
	fn command_line(&self) -> Option<String> {
		match self {
			PaneKind::Shell => None,
			PaneKind::Agent => Some(resolve_bin(&["zeta-c", "zeta"]).map(|b| b.to_string_lossy().into_owned())?),
			PaneKind::Editor => Some(resolve_bin(&["zeta-e", "zeta-editor"]).map(|b| b.to_string_lossy().into_owned())?),
			PaneKind::Command(cmd) => Some(cmd.clone()),
		}
	}
}

/// A single embedded terminal pane (real PTY child).
pub struct Pane {
	pub kind: PaneKind,
	pub term: Terminal,
}

impl Pane {
	pub fn new(kind: PaneKind, rows: u16, cols: u16, cwd: Option<PathBuf>) -> Result<Self> {
		let term = match kind.command_line() {
			None => Terminal::new_with_cwd(rows, cols, cwd)?,
			Some(command) => Terminal::new_with_command(rows, cols, &command)?,
		};
		Ok(Self { kind, term })
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
		self.template = Template::ALL.iter().rev().find(|t| t.slots() >= needed).copied().unwrap_or(Template::Quad);
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
			let _ = pane.term.resize(rows, cols);
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
