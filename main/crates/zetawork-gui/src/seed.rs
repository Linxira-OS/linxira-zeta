//! The shell's starting data: the spec's sample projects, one real project for
//! the directory the shell was started in, and the sample text the placeholder
//! panes render.
//!
//! # What is real here and what is not
//!
//! * The 本機 project is **real**: its path is the process's working directory
//!   and its branch is read from `git`. Its file tree and git panel show live
//!   data.
//! * The three 项目 N entries are the spec's sample projects, kept so the shell
//!   looks like the spec out of the box. Their paths do not exist on disk, and
//!   the file and git panels say so instead of inventing contents.
//! * The editor, diff and terminal pane bodies are **labelled placeholders**
//!   (see [`placeholder`]): they render the spec's sample text so the look can
//!   be judged, and each one names the data source it will read from.

use std::path::Path;

use crate::blit;
use crate::git;
use crate::state::{Pane, Project, SessionKind, SessionTab, Workspace};

/// The line under the 项目 section head, so the sample entries are never
/// mistaken for the user's own projects.
pub const SAMPLE_NOTE: &str = "示例项目：项目注册表尚未接入；本机 一项读取真实路径";

/// The heading the 本机 project gets.
pub const LOCAL_PROJECT: &str = "本机";

/// Every start: the real project first, then the spec's samples.
pub fn projects(cwd: &Path) -> Vec<Project> {
	let mut projects = vec![local_project(cwd)];
	projects.extend(sample_projects());
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
	};
	workspace.panes = default_panes("ws-local");
	Project { id: "p-local".to_owned(), name: LOCAL_PROJECT.to_owned(), workspaces: vec![workspace] }
}

/// The spec's three sample projects, verbatim.
pub fn sample_projects() -> Vec<Project> {
	/// One sample project: id, name, and its workspaces as (name, branch).
	type SampleProject = (&'static str, &'static str, &'static [(&'static str, &'static str)]);
	let sample: [SampleProject; 3] = [
		("p1", "项目 1", &[("工作区 1-1", "main"), ("工作区 1-2", "main")]),
		("p2", "项目 2", &[("工作区 2-1", "dev")]),
		("p3", "项目 3", &[("工作区 3-1", "main")]),
	];
	sample
		.into_iter()
		.map(|(id, name, workspaces)| Project {
			id: id.to_owned(),
			name: name.to_owned(),
			workspaces: workspaces
				.iter()
				.enumerate()
				.map(|(index, (workspace, branch))| {
					let ws_id = format!("{id}-w{index}");
					Workspace {
						name: (*workspace).to_owned(),
						branch: (*branch).to_owned(),
						path: format!("~/{name}/{workspace}"),
						cols: 2,
						panes: default_panes(&ws_id),
						id: ws_id,
					}
				})
				.collect(),
		})
		.collect()
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
			SessionTab { id: extra_id, kind: SessionKind::Editor, title: "workspace.rs".to_owned() }
		} else {
			SessionTab { id: extra_id, kind: SessionKind::Diff, title: "改动".to_owned() }
		};
		panes.push(Pane {
			id: pane_id,
			active: term_id.clone(),
			tabs: vec![
				SessionTab {
					id: term_id,
					kind: SessionKind::Term,
					title: format!("终端 {}", index + 1),
				},
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

/// The sample the editor pane renders (spec `EDITOR_LINES`).
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
			lines.push(("[agent] ✓ 步骤 1/3 完成  耗时 1.2s".to_owned(), Ink::Ok));
			lines.push(("[agent] ✓ 步骤 2/3 完成  耗时 0.8s".to_owned(), Ink::Ok));
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

/// The one sample a session tab's body is built from, by kind.
pub fn sample_for(kind: SessionKind, tab_id: &str) -> Sample {
	match kind {
		SessionKind::Term => Sample::Term(TermKind::of(tab_id)),
		SessionKind::Editor => Sample::Editor,
		SessionKind::Diff => Sample::Diff,
	}
}

/// Which placeholder body a session tab shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sample {
	Term(TermKind),
	Editor,
	Diff,
}

/// The cell grid the terminal placeholder renders into, so the blit is always
/// asked for a real `Buffer` (the CJK rule included).
pub fn term_buffer(
	width: u16,
	height: u16,
	kind: TermKind,
	path: &str,
	branch: &str,
) -> ratatui::buffer::Buffer {
	use ratatui::style::Style;
	use ratatui::text::{Line, Span};
	use ratatui::widgets::Paragraph;

	let mut lines: Vec<Line<'_>> = Vec::new();
	for note in placeholder("终端窗格未接 PTY 宿主", "termide 会话（Session::spawn）+ 会话生命周期")
	{
		lines.push(Line::styled(note, Style::new().fg(Ink::Warn.ratatui())));
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
	fn the_real_project_comes_first_and_reads_its_branch() {
		let cwd = std::env::current_dir().unwrap();
		let projects = projects(&cwd);
		assert_eq!(projects[0].name, LOCAL_PROJECT);
		assert_eq!(projects[0].workspaces[0].path, cwd.display().to_string());
		assert_eq!(projects.len(), 4, "本机 + 三个示例项目");
		// Every sample workspace has a pane layout and a branch chip.
		for project in &projects[1..] {
			for workspace in &project.workspaces {
				assert_eq!(workspace.panes.len(), 2);
				assert!(!workspace.branch.is_empty());
			}
		}
	}

	#[test]
	fn the_sample_projects_match_the_spec() {
		let projects = sample_projects();
		let names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
		assert_eq!(names, vec!["项目 1", "项目 2", "项目 3"]);
		assert_eq!(projects[0].workspaces.len(), 2);
		assert_eq!(projects[1].workspaces[0].branch, "dev");
		assert_eq!(projects[0].workspaces[0].path, "~/项目 1/工作区 1-1");
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
