// SPDX-License-Identifier: AGPL-3.0-only
//! The shell's starting data: the pseudo-project for the directory the shell
//! was started in, one project per registration in `~/.zeta/projects.json`,
//! and the sample text the placeholder panes render.
//!
//! # What is real here and what is not
//!
//! * 本机 is the process's own directory: a pseudo-entry that is **not** a
//!   registry row. Its path is the working directory and its branch is read
//!   from `git`.
//! * Every other project comes from the shared registry
//!   ([`workbench_projects`]); its path is a directory the user registered.
//! * The editor, diff and terminal pane bodies are **labelled placeholders**
//!   (see [`placeholder`]): they render the spec's sample text so the look can
//!   be judged, and each one names the data source it will read from.

use std::path::Path;

use crate::blit;
use crate::git;
use crate::state::{Pane, Project, SessionKind, SessionTab, Workspace};

/// The heading 本机's pseudo-project gets.
pub const LOCAL_PROJECT: &str = "本机";

/// Every start: 本机 first, then one project per registry row.
pub fn projects(cwd: &Path, registered: &[workbench_projects::Project]) -> Vec<Project> {
	let mut projects = vec![local_project(cwd)];
	projects.extend(registered.iter().map(registered_project));
	projects
}

/// The project for the directory the shell runs in: real path, real branch.
pub fn local_project(cwd: &Path) -> Project {
	let name = cwd
		.file_name()
		.map(|name| name.to_string_lossy().into_owned())
		.filter(|name| !name.is_empty())
		.unwrap_or_else(|| cwd.display().to_string());
	let status = git::read_status(cwd, 0);
	// A path with no repository is not a problem: the workspace keeps `—` and
	// the git panel explains itself.
	let branch = if status.branch.is_empty() {
		"—".to_owned()
	} else {
		status.branch.clone()
	};
	let mut workspace = Workspace {
		id: "ws-local".to_owned(),
		name,
		branch,
		path: cwd.display().to_string(),
		cols: 2,
		panes: Vec::new(),
		// Nothing observes this directory's state: there is no session state
		// machine and no PTY host, so the row shows `—` rather than a word from
		// the seven that nothing produced.
		run_state: None,
	};
	workspace.panes = default_panes("ws-local");
	Project {
		id: "p-local".to_owned(),
		name: LOCAL_PROJECT.to_owned(),
		path: cwd.to_path_buf(),
		workspaces: vec![workspace],
	}
}

/// One registered project as the GUI models it: a real path, a real branch,
/// and one workspace over that path. The registry owns the registration; the
/// workspace is the shell's own working set.
pub fn registered_project(entry: &workbench_projects::Project) -> Project {
	let status = git::read_status(&entry.path, 0);
	let branch = if status.branch.is_empty() {
		"—".to_owned()
	} else {
		status.branch.clone()
	};
	let ws_id = format!("{}-ws", entry.id);
	Project {
		id: entry.id.clone(),
		name: entry.name.clone(),
		path: entry.path.clone(),
		workspaces: vec![Workspace {
			id: ws_id.clone(),
			name: entry.name.clone(),
			branch,
			path: entry.path.display().to_string(),
			cols: 2,
			panes: default_panes(&ws_id),
			run_state: None,
		}],
	}
}

/// The layout the spec's `layoutFor()` builds: two panes, each with a terminal
/// and one more tab (an editor in the first, a diff in the second).
pub fn default_panes(ws_id: &str) -> Vec<Pane> {
	let mut panes = Vec::with_capacity(2);
	for index in 0..2usize {
		let pane_id = format!("{ws_id}-p{}", index + 1);
		let term_id = format!("{pane_id}-t1");
		let extra_id = format!("{pane_id}-t2");
		let extra = if index == 0 {
			SessionTab::new(extra_id, SessionKind::Editor, "workspace.rs".to_owned())
		} else {
			SessionTab::new(extra_id, SessionKind::Diff, "改动".to_owned())
		};
		panes.push(Pane {
			id: pane_id,
			active: term_id.clone(),
			tabs: vec![
				SessionTab::new(term_id, SessionKind::Term, format!("终端 {}", index + 1)),
				extra,
			],
		});
	}
	panes
}

/// The three lines every placeholder pane body starts with: what is not
/// loaded, what will fill it, and that the text below is the spec's sample.
pub fn placeholder(what: &str, source: &str) -> Vec<String> {
	vec![
		format!("[占位] {what}"),
		format!("[占位] 未来数据源：{source}"),
		"[占位] 以下为规格 v2 的示例文本，不是真实数据".to_owned(),
	]
}

// ── the spec's sample text ────────────────────────────────────────────────

/// The sample the TUI view renders for an editor tab.
///
/// The GUI's 编辑器 page reads a real file instead (R23); this sample is what the
/// terminal-shaped view draws, where an editor tab has no window to host a text
/// buffer in.
pub const EDITOR_LINES: &[&str] = &[
	"use crate::term::session::Session;",
	"use crate::ui::panels::Panel;",
	"",
	"pub struct Workspace {",
	"    pub name: String,",
	"    pub branch: String,",
	"    panes: Vec<Panel>,",
	"    sessions: Vec<Session>,",
	"}",
	"",
	"impl Workspace {",
	"    pub fn new(name: &str) -> Self {",
	"        // 每个工作区默认挂载两个终端面板",
	"        Self {",
	"            name: name.to_string(),",
	"            branch: \"main\".to_string(),",
	"            panes: vec![Panel::terminal(), Panel::terminal()],",
	"            sessions: vec![Session::spawn()],",
	"        }",
	"    }",
	"",
	"    pub fn grid(&self) -> usize {",
	"        self.panes.len().min(3)",
	"    }",
	"}",
];

/// A diff row of the sample.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiffRow {
	Hunk,
	Context,
	Add,
	Del,
}

/// The sample the diff pane renders (spec `DIFF_LINES`).
pub const DIFF_LINES: &[(DiffRow, &str)] = &[
	(DiffRow::Hunk, "@@ -12,8 +12,14 @@ impl Workspace {"),
	(DiffRow::Context, "     pub fn new(name: &str) -> Self {"),
	(DiffRow::Del, "-        panes: vec![Panel::terminal()],"),
	(DiffRow::Add, "+        // 每个工作区默认挂载两个终端面板"),
	(DiffRow::Add, "+        panes: vec![Panel::terminal(), Panel::terminal()],"),
	(DiffRow::Context, "         sessions: vec![Session::spawn()],"),
	(DiffRow::Context, "     }"),
	(DiffRow::Hunk, "@@ -26,3 +32,7 @@ impl Workspace {"),
	(DiffRow::Add, "+    pub fn grid(&self) -> usize {"),
	(DiffRow::Add, "+        self.panes.len().min(3)"),
	(DiffRow::Add, "+    }"),
	(DiffRow::Context, " }"),
];

/// The whitespace-separated words the sample highlighter colours as keywords
/// (spec `KW`).
pub const KEYWORDS: &[&str] = &[
	"use", "pub", "struct", "impl", "fn", "let", "mut", "match", "if", "else", "for", "in", "while",
	"loop", "return", "self", "crate", "async", "await", "move", "const", "static", "trait",
	"where", "type", "as", "dyn",
];

/// The ink a sample terminal line is drawn in (spec `.p-*` classes).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ink {
	Plain,
	Dim,
	Path,
	Warn,
	Prompt,
	Cmd,
	Ai,
	Ok,
}

impl Ink {
	/// The egui colour for this ink.
	pub fn color(self) -> egui::Color32 {
		use crate::theme;
		match self {
			Self::Plain => theme::TERM_TEXT,
			Self::Dim => theme::TEXT_3,
			Self::Path => theme::CYAN,
			Self::Warn => theme::WARN,
			Self::Prompt => theme::ADD,
			Self::Cmd => theme::TEXT,
			Self::Ai => theme::ACCENT_2,
			Self::Ok => theme::ADD,
		}
	}

	/// The ratatui colour `blit` renders, so the terminal buffer carries the
	/// same ink as the spec's classes.
	pub fn ratatui(self) -> ratatui::style::Color {
		match self {
			Self::Ok | Self::Prompt => ratatui::style::Color::Rgb(0x3f, 0xb9, 0x50),
			Self::Path => ratatui::style::Color::Rgb(0x39, 0xc5, 0xcf),
			Self::Warn => ratatui::style::Color::Rgb(0xd2, 0x99, 0x22),
			Self::Ai => ratatui::style::Color::Rgb(0x7e, 0xa9, 0xf5),
			Self::Dim => ratatui::style::Color::Rgb(0x8b, 0x93, 0xa1),
			Self::Cmd => ratatui::style::Color::Rgb(0xe7, 0xea, 0xf0),
			Self::Plain => ratatui::style::Color::Rgb(0xc8, 0xd0, 0xdb),
		}
	}
}

/// Which of the spec's three sample terminal transcripts a session shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TermKind {
	/// `cargo run --release`
	A,
	/// an agent run
	B,
	/// `cargo test`
	C,
}

impl TermKind {
	/// The spec's `termKind(tabId)`: a stable hash of the session id, so two
	/// terminals in one workspace do not show the same sample.
	pub fn of(tab_id: &str) -> Self {
		let mut hash: u32 = 0;
		for byte in tab_id.as_bytes() {
			hash = (hash.wrapping_mul(31).wrapping_add(u32::from(*byte))) % 997;
		}
		match hash % 3 {
			0 => Self::B,
			1 => Self::C,
			_ => Self::A,
		}
	}
}

/// The sample transcript for a terminal session, with the workspace's own path
/// and branch on the first line.
pub fn transcript(kind: TermKind, path: &str, branch: &str) -> Vec<(String, Ink)> {
	let mut lines: Vec<(String, Ink)> = Vec::new();
	lines.push((format!("zetawork   {path}   {branch}"), Ink::Dim));
	match kind {
		TermKind::A => {
			lines.push(("$ cargo run --release".to_owned(), Ink::Prompt));
			lines.push(("   Compiling term-core v0.1.0".to_owned(), Ink::Plain));
			lines.push(("   Compiling app-ui v0.1.0".to_owned(), Ink::Plain));
			lines.push(("    Finished release [optimized] target(s) in 3.42s".to_owned(), Ink::Ok));
			lines.push(("     Running target/release/app".to_owned(), Ink::Dim));
			lines.push(("[agent] 终端已连接 · 等待输入".to_owned(), Ink::Ai));
		},
		TermKind::B => {
			lines.push(("$ agent run --task \"重构分屏渲染\"".to_owned(), Ink::Prompt));
			lines.push(("[agent] 读取 src/ui/workspace.rs …".to_owned(), Ink::Ai));
			lines.push(("[agent] 规划：拆分渲染管线 → 3 步".to_owned(), Ink::Ai));
			lines.push(("[agent] + 步骤 1/3 完成  耗时 1.2s".to_owned(), Ink::Ok));
			lines.push(("[agent] + 步骤 2/3 完成  耗时 0.8s".to_owned(), Ink::Ok));
			lines.push(("[agent] … 步骤 3/3 进行中".to_owned(), Ink::Ai));
		},
		TermKind::C => {
			lines.push(("$ cargo test --workspace".to_owned(), Ink::Prompt));
			lines.push(("   running 48 tests".to_owned(), Ink::Plain));
			lines.push(("test result: ok. 48 passed; 0 failed".to_owned(), Ink::Ok));
			lines.push(("   Doc-tests app-core".to_owned(), Ink::Plain));
			lines.push(("test result: ok. 6 passed; 0 failed".to_owned(), Ink::Ok));
		},
	}
	lines.push(("$ ".to_owned(), Ink::Prompt));
	lines
}

/// The cell grid the terminal placeholder renders into, so the blit is always
/// asked for a real `Buffer` (the CJK rule included).
///
/// `shell` is the host shell the `+` picker found, when the page came from the
/// picker: it is named in the banner, because a terminal page that cannot start
/// a process yet has to say what it would have started.
pub fn term_buffer(
	width: u16,
	height: u16,
	kind: TermKind,
	path: &str,
	branch: &str,
	shell: Option<&str>,
) -> ratatui::buffer::Buffer {
	use ratatui::style::Style;
	use ratatui::text::{Line, Span};
	use ratatui::widgets::Paragraph;

	let mut lines: Vec<Line<'_>> = Vec::new();
	for note in placeholder("终端窗格未接 PTY 宿主", "termide 会话（Session::spawn）+ 会话生命周期")
	{
		lines.push(Line::styled(note, Style::new().fg(Ink::Warn.ratatui())));
	}
	if let Some(shell) = shell {
		lines.push(Line::styled(
			format!("[占位] 该页指定的 shell：{shell}（探测自 $PATH / 系统目录）"),
			Style::new().fg(Ink::Dim.ratatui()),
		));
	}
	for (text, ink) in transcript(kind, path, branch) {
		lines.push(Line::from(Span::styled(text, Style::new().fg(ink.ratatui()))));
	}
	let (buffer, _, _) = blit::render(width, height, |frame| {
		let area = frame.area();
		frame.render_widget(Paragraph::new(lines), area);
	});
	buffer
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_local_pseudo_project_comes_first_and_reads_its_branch() {
		let cwd = std::env::current_dir().unwrap();
		let projects = projects(&cwd, &[]);
		assert_eq!(projects.len(), 1, "本机 与 no registrations");
		assert_eq!(projects[0].name, LOCAL_PROJECT);
		assert_eq!(projects[0].workspaces[0].path, cwd.display().to_string());
		assert!(!projects[0].workspaces[0].branch.is_empty());
		assert_eq!(projects[0].workspaces[0].panes.len(), 2);
	}

	#[test]
	fn a_registration_becomes_one_real_project() {
		let dir = tempfile::tempdir().expect("temp dir");
		let path = dir.path().join("demo");
		std::fs::create_dir_all(&path).unwrap();
		let entry = workbench_projects::Project {
			id: "p-1".to_owned(),
			name: "演示".to_owned(),
			path: path.clone(),
			added_at: 0,
		};
		let project = registered_project(&entry);
		assert_eq!(project.id, "p-1");
		assert_eq!(project.name, "演示");
		assert_eq!(project.path, path);
		assert_eq!(project.workspaces.len(), 1);
		assert_eq!(project.workspaces[0].path, path.display().to_string());
		assert_eq!(project.workspaces[0].panes.len(), 2);
		assert!(project.workspaces[0].run_state.is_none(), "nothing observes it yet");
	}

	#[test]
	fn the_thumbnail_kind_is_stable_and_spreads_over_the_three_samples() {
		let mut kinds = std::collections::HashSet::new();
		for id in ["p1-t1", "p1-t2", "p2-t1", "p2-t2", "p3-t1", "p3-t2"] {
			let kind = TermKind::of(id);
			assert_eq!(kind, TermKind::of(id), "the same id gives the same sample");
			kinds.insert(format!("{kind:?}"));
		}
		assert!(kinds.len() > 1, "the ids must not all pick one sample");
	}

	#[test]
	fn every_placeholder_names_its_future_source() {
		let lines = placeholder("编辑器窗格未打开文件", "工作区内的只读文本");
		assert_eq!(lines.len(), 3);
		assert!(lines[0].starts_with("[占位]"));
		assert!(lines[1].contains("未来数据源"));
	}
}
