// SPDX-License-Identifier: AGPL-3.0-only
//! The shell's state model: projects → workspaces → panes → session tabs.
//!
//! v2 of the UI spec locks the terminology: **大标签页 *is* 工作区**, one to
//! one. The top tab strip is nothing but the active project's workspaces, so
//! there is no second level between a workspace and its panes:
//!
//! ```text
//! Project ──▶ Workspace (大标签页) ──▶ Pane (1..=3 columns) ──▶ SessionTab
//! ```
//!
//! Every mutation the UI can make lives in an `impl AppState` method so the
//! caps are testable without a window: a project keeps at least one workspace
//! and at most [`MAX_WORKSPACES_PER_PROJECT`], a workspace keeps 1..=3 panes
//! and 1..=3 visible columns, and a pane keeps at least one session tab.
//! Refused actions return a [`Notice`] instead of mutating, and the shell
//! shows it as a toast — the same behaviour the spec's mock has.
//!
//! Ids are handed out by one monotonic counter, so a pane id or a session tab
//! id is unique across the whole shell (the mock's `Date.now()`-based ids and
//! its index-based tab ids are not, and reusing an id after a close would make
//! lookups ambiguous).

use crate::t;
use std::{
	path::{Path, PathBuf},
	time::{Duration, Instant},
};

use crate::{settings::Section, status::RunState};

/// The most workspaces (大标签页) one project may hold.
///
/// The spec's mock has no cap; the strip scrolls. A cap keeps the strip and
/// the project list from growing without bound, and the refusal is visible
/// (toast) rather than silent.
pub const MAX_WORKSPACES_PER_PROJECT: usize = 6;

/// A workspace shows at most three panes, in one to three columns.
pub const MAX_PANES: usize = 3;

/// A pane shows at most eight sub-pages — the contract's 子页上限 8
/// (`mock-common.js`'s `MAX_SUBS`, stated in the UI as `子页上限 8`).
pub const MAX_SUBS_PER_PANE: usize = 8;

/// How long a toast stays on screen.
pub const TOAST_TTL: Duration = Duration::from_millis(1800);

/// The right column's four panels — the spec's 文件树 / 历史 / Git / 用量.
///
/// The 用量 tab shows the *active conversation's* own usage and follows the
/// active pane/tab; the global roll-up lives in the 用量 container the left
/// column's foot opens. The two are deliberately different data sources.
///
/// # The reserved slot
///
/// R13/R14 put web-based plugin pages in *this* column (Rust-side plugins are
/// out). Nothing of that is built this round and nothing here forecloses it:
/// a plugin panel becomes one more variant of this enum plus one arm in
/// [`crate::right::right_column`], whose body is handed a plain `Rect` — which
/// is exactly what a WebView2 child window needs to be parented into. The
/// column's width is the spec's `--side-right-w` ([`crate::right::WIDTH`],
/// 324pt), so a page laid out for the sidebar fits without a second layout.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RightTab {
	#[default]
	Files,
	History,
	Git,
	Usage,
}

impl RightTab {
	pub const ALL: [Self; 4] = [Self::Files, Self::History, Self::Git, Self::Usage];

	/// The panel head, spelled as the spec spells it.
	pub fn title(self) -> &'static str {
		match self {
			Self::Files => t!("文件树"),
			Self::History => t!("历史 · Agent 对话"),
			Self::Git => t!("Git 状态"),
			Self::Usage => t!("用量"),
		}
	}

	/// The live source this panel reads, or reports as missing.
	pub fn source(self) -> &'static str {
		match self {
			Self::Files => t!("工作区目录（本地 read_dir）"),
			Self::History => t!("zetacode 会话存储（~/.zeta/agent/agent.db）"),
			Self::Git => t!("git status / log / rev-list（只读）"),
			Self::Usage => t!("活动会话的日志（~/.zeta/agent/sessions）"),
		}
	}
}

/// What a session tab renders.
///
/// 终端 is the default: a new 大标签页 and a new pane both open one. The other
/// five are pages the GUI draws itself (R23) — 编辑器, 差异比较器 and Git read
/// real data; zetaide is the termide panel editor, which this build does not
/// host yet and says so on the page; Agent 会话 reads a gateway session's SSE
/// stream.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionKind {
	/// A terminal page. The shell it would run is recorded on the tab.
	Term,
	/// The GUI's own editor page: a real file, editable, saved to disk.
	Editor,
	/// The GUI's own diff page: `git diff` of the active workspace, read-only.
	Diff,
	/// The GUI's own git page — the same data as the right column's Git panel.
	Git,
	/// The shipped `zetacode` CLI, run as the pane's own process in the
	/// workspace directory. No shell sits between the two, so nothing is
	/// typed into anything.
	Zetacode,
	/// `zetaide` — the termide panel editor (R23: the editor the TUI uses).
	Ide,
	/// A zetacode serve agent session, read through its SSE endpoint.
	///
	/// The gateway owns the session; this page is a viewer that also raises
	/// the **needs input** and **run finished** notifications
	/// ([`crate::agent_sessions`]).
	Agent,
}

impl SessionKind {
	/// The pages the `+` picker offers, in the spec's order.
	pub const PAGES: [Self; 6] =
		[Self::Editor, Self::Diff, Self::Git, Self::Zetacode, Self::Ide, Self::Agent];

	/// The kind's own name, as the picker and the tab tooltips spell it.
	pub fn label(self) -> &'static str {
		match self {
			Self::Term => t!("终端"),
			Self::Editor => t!("编辑器"),
			Self::Diff => t!("差异比较器"),
			Self::Git => "Git",
			Self::Zetacode => "zetacode",
			Self::Ide => "zetaide",
			Self::Agent => t!("Agent 会话"),
		}
	}

	/// The title a freshly opened tab of this kind gets.
	pub fn tab_title(self) -> &'static str {
		match self {
			Self::Term => t!("终端"),
			Self::Editor => t!("编辑器"),
			Self::Diff => t!("改动"),
			Self::Git => "Git",
			Self::Zetacode => "zetacode",
			Self::Ide => "zetaide",
			Self::Agent => "Agent",
		}
	}

	/// What backs this page, or what is still missing behind it.
	pub fn source(self) -> &'static str {
		match self {
			Self::Term => t!("本机 shell（真实 PTY：本进程或 zetacode serve）"),
			Self::Editor => t!("工作区里的真实文件（读 + 写）"),
			Self::Diff => t!("git diff --no-color HEAD（只读）"),
			Self::Git => t!("git status / log（只读）"),
			Self::Zetacode => t!("随包的 zetacode（packages/coding-agent/dist/zeta）"),
			Self::Ide => "termide panel-editor（termide-panel-ide）",
			Self::Agent => t!("zetacode serve 的 SSE 会话流（/api/agent/<id>/events）"),
		}
	}
}

/// One file open in an 编辑器 page: the real bytes on disk plus the buffer.
///
/// The buffer *is* the file's text — editing it and saving writes those exact
/// bytes back, so a round trip through the page is lossless. A file that could
/// not be read keeps `text` empty and carries the OS message in `error`
/// instead of pretending to be an empty document.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EditorDoc {
	pub path: PathBuf,
	pub text: String,
	/// True while the buffer differs from what was last read or written.
	pub dirty: bool,
	/// Why the read or the write failed.
	pub error: Option<String>,
}

impl EditorDoc {
	/// Read `path`. A failure is recorded, never fatal.
	pub fn open(path: &Path) -> Self {
		match std::fs::read_to_string(path) {
			Ok(text) => Self { path: path.to_path_buf(), text, dirty: false, error: None },
			Err(err) => Self {
				path: path.to_path_buf(),
				text: String::new(),
				dirty: false,
				error: Some(format!("{}: {err}", path.display())),
			},
		}
	}

	/// Read `path`, or `None` when `path` is a directory.
	pub fn open_file(path: &Path) -> Option<Self> {
		if path.is_dir() {
			return None;
		}
		Some(Self::open(path))
	}

	/// Write the buffer back to `path`. Clears `dirty` only on success.
	pub fn save(&mut self) -> Result<(), String> {
		match std::fs::write(&self.path, self.text.as_bytes()) {
			Ok(()) => {
				self.dirty = false;
				self.error = None;
				Ok(())
			},
			Err(err) => {
				let message = format!("{}: {err}", self.path.display());
				self.error = Some(message.clone());
				Err(message)
			},
		}
	}

	/// The tab title: the file's name.
	pub fn name(&self) -> String {
		self
			.path
			.file_name()
			.map(|name| name.to_string_lossy().into_owned())
			.unwrap_or_else(|| self.path.display().to_string())
	}

	/// Line count, as an editor reports it (a trailing newline opens no line).
	pub fn lines(&self) -> usize {
		self.text.lines().count().max(1)
	}

	/// The buffer was edited.
	pub fn touch(&mut self) {
		self.dirty = true;
	}
}

/// One session tab inside a pane.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionTab {
	pub id: String,
	pub kind: SessionKind,
	pub title: String,
	/// The shell a 终端 page would run; `None` for the seeded sample tabs and
	/// for pages that are not terminals.
	pub shell: Option<crate::shells::ShellKind>,
	/// The command a 终端 page would type into its shell once the PTY is up.
	///
	/// **Always `None` today.** No GUI action types into a shell — a new
	/// workspace opens a plain shell at the project path. The project `+` used
	/// to set the resolved `zetacode` path here, which echoed a stale PATH
	/// binary into every fresh workspace; the field is kept (and asserted
	/// `None`) so that cannot come back by accident.
	pub command: Option<String>,
	/// The process this page runs **instead of a shell**, resolved when the
	/// tab was created. Only a companion page (zetacode) sets it: the binary
	/// is spawned directly in the pane's PTY, so nothing is typed into a
	/// shell; a missing binary carries the sentence the pane shows.
	pub program: Option<crate::zetacode::Launch>,
	/// The open document of an 编辑器 page.
	pub doc: Option<EditorDoc>,
}

impl SessionTab {
	pub fn new(id: String, kind: SessionKind, title: String) -> Self {
		Self { id, kind, title, shell: None, command: None, program: None, doc: None }
	}

	pub fn is_term(&self) -> bool {
		self.kind == SessionKind::Term
	}
}

/// What a `+` opens into.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PickerTarget {
	/// The 大标签页 strip's ＋: a new workspace holding the picked item.
	BigTab,
	/// A pane's ＋: one more session tab in that pane.
	Pane(String),
}

/// One row of the `+` picker: something that can be shown in the centre.
///
/// The spec's rule (R23) is that the picker lists *everything the centre can
/// display*: every shell installed on this host, then every page the GUI draws.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PickerEntry {
	/// A shell found on this host → a 终端 page running it.
	Shell(crate::shells::Shell),
	/// A page the GUI draws itself.
	Page(SessionKind),
}

impl PickerEntry {
	/// Everything the centre can display on this host: the shells that really
	/// exist, then the pages.
	pub fn all() -> Vec<Self> {
		let mut entries: Vec<Self> = crate::shells::detect()
			.into_iter()
			.map(Self::Shell)
			.collect();
		entries.extend(SessionKind::PAGES.into_iter().map(Self::Page));
		entries
	}

	/// The picker's group heading for this row.
	pub fn group(&self) -> &'static str {
		match self {
			Self::Shell(_) => t!("本机 Shell"),
			Self::Page(_) => t!("页面"),
		}
	}

	/// The picker row's label: the shell's name, or the page's own name.
	pub fn title(&self) -> String {
		match self {
			Self::Shell(shell) => shell.label().to_owned(),
			Self::Page(kind) => kind.label().to_owned(),
		}
	}

	/// The tab title the pick produces — shorter than the row's label, so a
	/// 差异比较器 tab reads as the spec's 改动.
	pub fn tab_title(&self) -> String {
		match self {
			Self::Shell(shell) => shell.label().to_owned(),
			Self::Page(kind) => kind.tab_title().to_owned(),
		}
	}

	/// The second line of the row: where it comes from, or what backs it.
	pub fn detail(&self) -> String {
		match self {
			Self::Shell(shell) => shell.path.display().to_string(),
			Self::Page(kind) => kind.source().to_owned(),
		}
	}

	/// The kind of session tab the pick opens.
	pub fn session_kind(&self) -> SessionKind {
		match self {
			Self::Shell(_) => SessionKind::Term,
			Self::Page(kind) => *kind,
		}
	}
}

/// One pane: a session-tab strip over a body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pane {
	pub id: String,
	/// The id of the active session tab. Always one of `tabs`.
	pub active: String,
	pub tabs: Vec<SessionTab>,
}

impl Pane {
	pub fn active_tab(&self) -> Option<&SessionTab> {
		self.tabs.iter().find(|tab| tab.id == self.active)
	}

	pub fn term_count(&self) -> usize {
		self
			.tabs
			.iter()
			.filter(|tab| tab.kind == SessionKind::Term)
			.count()
	}

	/// The pid of the shell this pane's terminal runs, when one is known.
	///
	/// **Always `None` in this build**, and deliberately so: the GUI has no PTY
	/// host yet, so no page owns a process. This is the one place that changes
	/// when one lands — [`crate::lifecycle::pane_is_busy`] and the busy→idle
	/// edge detector already ask here, and nothing invents a number in the
	/// meantime.
	pub fn shell_pid(&self) -> Option<u32> {
		None
	}
}

/// A workspace — the spec's 大标签页. Carries its own pane layout.
///
/// 工作区 and 大标签页 are one level, not two: the workspace-organising draft
/// fills `#bigTabs` — `aria-label="大标签页（项目的工作区）"` — from the active
/// project's workspaces, and the contract's ruling collapses the pair the same
/// way. So this is what the left column lists *and* what the centre's top strip
/// switches between.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Workspace {
	pub id: String,
	pub name: String,
	pub branch: String,
	/// The directory the file tree and the git panel read. `~` is *not*
	/// expanded by the shell: a path that does not resolve is reported as it
	/// is instead of guessed.
	pub path: String,
	/// Visible columns: 1, 2 or 3.
	pub cols: u8,
	pub panes: Vec<Pane>,
	/// The workspace's run state, from the contract's 状态词表 — see
	/// [`crate::status::RunState`]. Shown as a dot and a word on the left
	/// column's row and as the 总面板's 状态 column.
	///
	/// **`None` means no source observes this workspace**, and it renders as `—`
	/// with no dot — *not* as a plausible member of the seven. Nothing in this
	/// build observes a workspace: there is no session state machine (see
	/// [`crate::notify::MISSING_SIGNALS`]) and no PTY host
	/// ([`Pane::shell_pid`]), so every workspace — 本机, a registered project,
	/// a freshly created one — carries `None`.
	pub run_state: Option<RunState>,
}

/// What the centre column shows. The strip's first 大标签页 is always 总面板;
/// it is a page, not a workspace, so it is a second axis of state rather than a
/// member of `Project::workspaces`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CenterPage {
	/// 总面板 — every project in one table (the contract's ruling: 总面板 =
	/// 中间区第 1 个大标签页, 所有项目合并一张表). This build opens on it.
	#[default]
	Total,
	/// The active workspace's pane grid, or the welcome panel when none is
	/// open.
	Workspace,
}

impl CenterPage {
	/// The strip's label for this page.
	pub fn label(self) -> &'static str {
		match self {
			Self::Total => t!("总面板"),
			Self::Workspace => "",
		}
	}
}

/// A project groups workspaces; a project is what the left column lists.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Project {
	pub id: String,
	pub name: String,
	/// The directory this project is rooted at: the process directory for the
	/// 本机 pseudo-entry, the registered path otherwise. New workspaces and the
	/// zetacode pane start here.
	pub path: PathBuf,
	pub workspaces: Vec<Workspace>,
}

/// One refused action, shown as a toast. An empty notice means "nothing to
/// say" and is not rendered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notice(pub String);

/// The whole shell state.
#[derive(Clone, Debug)]
pub struct AppState {
	/// Which 大标签页 the centre shows: 总面板 (the strip's first tab, and what
	/// this build opens on) or the active workspace's pane grid.
	pub center_page: CenterPage,
	pub left_collapsed: bool,
	pub right_collapsed: bool,
	pub right_tab: RightTab,
	pub active_project: Option<String>,
	pub active_workspace: Option<String>,
	/// Whether the git panel's 提交 group is expanded. Kept in the state
	/// because the TUI view shows the same group.
	pub commits_open: bool,
	pub settings_section: Section,
	/// The focused terminal box in the TUI view; `None` = none focused.
	pub tui_pane: Option<String>,
	/// The shell a new 终端 page records (设置 → 终端 的 默认 Shell). The shell
	/// syncs it from the settings file every frame; `None` = 本机默认.
	pub default_shell: Option<crate::shells::ShellKind>,
	pub projects: Vec<Project>,
	/// The shared project registry (`~/.zeta/projects.json`). `projects`
	/// mirrors it plus the 本机 pseudo-entry; project mutations write through
	/// here so the GUI and the TUI see one list.
	pub registry: workbench_projects::Registry,
	/// The inline rename editor: `(project id, working text)`.
	pub renaming_project: Option<(String, String)>,
	/// The 大标签页 rename editor: `(workspace id, working text)`.
	pub renaming_workspace: Option<(String, String)>,
	/// The inline 添加项目 path editor; `None` = closed.
	pub adding_project: Option<String>,
	/// The two inline editors ask for keyboard focus once, when they open.
	rename_focus: bool,
	add_focus: bool,
	pub toast: Option<(String, Instant)>,
	/// The open `+` picker, and what a pick opens into.
	picker: Option<PickerTarget>,
	settings_open: bool,
	/// The 用量 container (the embedded stats page) is open.
	usage_open: bool,
	/// The status bar is drawn; 关闭 collapses it.
	statusbar_open: bool,
	/// A background producer (the agent SSE poll) changed what the frame would
	/// draw since the last tick. The shell consumes it, requests a repaint and
	/// clears it.
	pub needs_redraw: bool,
	/// Monotonic id source for workspaces, panes and session tabs.
	next_id: u64,
}

impl Default for AppState {
	fn default() -> Self {
		Self {
			center_page: CenterPage::Total,
			left_collapsed: false,
			right_collapsed: false,
			// 用量 is the right column's default page (the contract's ruling),
			// so the column is drawn open rather than collapsed: a default
			// page nobody can see is not a default.
			right_tab: RightTab::Usage,
			active_project: None,
			active_workspace: None,
			commits_open: true,
			settings_section: Section::Appearance,
			tui_pane: None,
			default_shell: None,
			projects: Vec::new(),
			registry: workbench_projects::Registry::empty_at(workbench_projects::default_path()),
			renaming_project: None,
			renaming_workspace: None,
			adding_project: None,
			rename_focus: false,
			add_focus: false,
			toast: None,
			picker: None,
			settings_open: false,
			usage_open: false,
			statusbar_open: true,
			needs_redraw: false,
			next_id: 1,
		}
	}
}

impl AppState {
	/// A shell seeded from `~/.zeta/projects.json` plus the directory the shell
	/// was started in (the 本机 pseudo-entry, which is not a registration).
	///
	/// A malformed registry is reported through the shell's toast and the
	/// shell opens with an empty in-memory list; the file is left untouched, so
	/// a later project action is what decides whether it is replaced.
	pub fn seeded(cwd: &std::path::Path) -> Self {
		let registry = match workbench_projects::Registry::load() {
			Ok(registry) => registry,
			Err(error) => {
				let mut state = Self::seeded_with_registry(
					cwd,
					workbench_projects::Registry::empty_at(workbench_projects::default_path()),
				);
				state.show(Notice(t!("项目注册表读取失败：{}", error)));
				return state;
			},
		};
		Self::seeded_with_registry(cwd, registry)
	}

	/// A shell over an explicit registry — the test seam, and what `seeded`
	/// uses once the file has been read.
	pub fn seeded_with_registry(
		cwd: &std::path::Path,
		registry: workbench_projects::Registry,
	) -> Self {
		let mut state = Self::default();
		state.projects = crate::seed::projects(cwd, registry.list());
		state.registry = registry;
		state.active_project = state.projects.first().map(|p| p.id.clone());
		state.active_workspace = state
			.active_project
			.as_ref()
			.and_then(|id| state.project(id))
			.and_then(|p| p.workspaces.first())
			.map(|w| w.id.clone());
		state
	}

	fn fresh_id(&mut self, prefix: &str) -> String {
		let id = format!("{prefix}{}", self.next_id);
		self.next_id += 1;
		id
	}

	// ── lookups ────────────────────────────────────────────────────────

	pub fn project(&self, id: &str) -> Option<&Project> {
		self.projects.iter().find(|project| project.id == id)
	}

	pub fn active_project(&self) -> Option<&Project> {
		self
			.active_project
			.as_deref()
			.and_then(|id| self.project(id))
	}

	pub fn workspace(&self, id: &str) -> Option<&Workspace> {
		self
			.projects
			.iter()
			.flat_map(|p| &p.workspaces)
			.find(|w| w.id == id)
	}

	pub fn active_workspace(&self) -> Option<&Workspace> {
		self
			.active_workspace
			.as_deref()
			.and_then(|id| self.workspace(id))
	}

	/// The project that owns a workspace.
	pub fn project_of(&self, ws_id: &str) -> Option<&Project> {
		self
			.projects
			.iter()
			.find(|p| p.workspaces.iter().any(|w| w.id == ws_id))
	}

	/// The status bar's workspace column: `未选择工作区` with nothing open.
	pub fn workspace_label(&self) -> &str {
		self
			.active_workspace()
			.map(|w| w.name.as_str())
			.unwrap_or(t!("未选择工作区"))
	}

	/// The status bar's branch column: `—` with nothing open.
	pub fn branch_label(&self) -> &str {
		self
			.active_workspace()
			.map(|w| w.branch.as_str())
			.unwrap_or("—")
	}

	/// The focused pane: the one a click last selected, else the first visible
	/// pane. The right column's 用量 page follows this pane's active tab.
	pub fn active_pane(&self) -> Option<&Pane> {
		let panes = self.visible_panes();
		self
			.tui_pane
			.as_deref()
			.and_then(|id| panes.iter().find(|pane| pane.id == id))
			.or_else(|| panes.first())
	}

	/// The active tab on the focused pane.
	pub fn active_session_tab(&self) -> Option<&SessionTab> {
		self.active_pane().and_then(Pane::active_tab)
	}

	fn pane_mut(&mut self, pane_id: &str) -> Option<&mut Pane> {
		self
			.projects
			.iter_mut()
			.flat_map(|p| &mut p.workspaces)
			.flat_map(|w| &mut w.panes)
			.find(|pane| pane.id == pane_id)
	}

	fn workspace_mut(&mut self, ws_id: &str) -> Option<&mut Workspace> {
		self
			.projects
			.iter_mut()
			.flat_map(|p| &mut p.workspaces)
			.find(|w| w.id == ws_id)
	}

	/// A pane holding a single 终端 session.
	fn basic_pane(&mut self, pane_id: &str, number: usize) -> Pane {
		let tab_id = self.fresh_id("tab");
		Pane {
			id: pane_id.to_owned(),
			active: tab_id.clone(),
			tabs: vec![SessionTab::new(
				tab_id,
				SessionKind::Term,
				if number <= 1 {
					SessionKind::Term.tab_title().to_owned()
				} else {
					t!("终端 {}", number)
				},
			)],
		}
	}

	/// One new session tab, from a picker row or from the default (终端).
	///
	/// The default 终端 records the 设置 → 终端 的 默认 Shell, so the tool
	/// strip's 新建终端 and a fresh 大标签页 agree with the settings file.
	fn tab_for(&mut self, entry: Option<&PickerEntry>) -> SessionTab {
		let id = self.fresh_id("tab");
		let Some(entry) = entry else {
			let mut tab =
				SessionTab::new(id, SessionKind::Term, SessionKind::Term.tab_title().to_owned());
			tab.shell = self.default_shell;
			return tab;
		};
		let mut tab = SessionTab::new(id, entry.session_kind(), entry.tab_title());
		match entry {
			PickerEntry::Shell(shell) => tab.shell = Some(shell.kind),
			// A companion page runs the shipped binary itself; resolving here
			// (once per tab) also gives a missing install its sentence.
			PickerEntry::Page(SessionKind::Zetacode) => {
				tab.program = Some(crate::zetacode::launch(crate::zetacode::Companion::Zetacode));
			},
			PickerEntry::Page(_) => {},
		}
		tab
	}

	// ── the project registry ──────────────────────────────────────────

	/// 本机 is a pseudo-project: it always exists and is never a registry row,
	/// so it has no rename/remove action.
	pub fn is_local_project(id: &str) -> bool {
		id == "p-local"
	}

	/// Start the inline rename editor on a registered project.
	pub fn begin_rename_project(&mut self, id: &str) {
		if let Some(project) = self.project(id) {
			if Self::is_local_project(id) {
				return;
			}
			self.renaming_project = Some((id.to_owned(), project.name.clone()));
			self.rename_focus = true;
		}
	}

	/// `(id, working text)` of the open rename editor.
	pub fn renaming(&self) -> Option<(&str, &str)> {
		self
			.renaming_project
			.as_ref()
			.map(|(id, text)| (id.as_str(), text.as_str()))
	}

	pub fn set_rename_text(&mut self, text: String) {
		if let Some((_, current)) = self.renaming_project.as_mut() {
			*current = text;
		}
	}

	pub fn take_rename_focus(&mut self) -> bool {
		std::mem::take(&mut self.rename_focus)
	}

	pub fn cancel_rename_project(&mut self) {
		self.renaming_project = None;
		self.rename_focus = false;
	}

	/// Commit the rename editor: the registry is written first, and the GUI's
	/// copy follows only when that write succeeded.
	pub fn commit_rename_project(&mut self) -> Notice {
		let Some((id, text)) = self.renaming_project.clone() else {
			return Notice(String::new());
		};
		let name = text.trim().to_owned();
		if name.is_empty() {
			return Notice(t!("项目名不能为空").to_owned());
		}
		match self.registry.rename(&id, &name) {
			Ok(()) => {
				if let Some(project) = self.projects.iter_mut().find(|project| project.id == id) {
					let previous = project.name.clone();
					project.name = name.clone();
					for workspace in &mut project.workspaces {
						if workspace.name == previous {
							workspace.name = name.clone();
						}
					}
				}
				self.renaming_project = None;
				self.rename_focus = false;
				Notice(t!("已重命名为 {}", name))
			},
			Err(error) => Notice(t!("重命名失败：{}", error)),
		}
	}

	/// Start the inline rename editor on one 大标签页. The local pseudo-project
	/// has no registry entry, so its workspace rename would not survive a
	/// restart; it is not offered there (see [`Self::can_rename_workspace`]).
	pub fn begin_rename_workspace(&mut self, workspace_id: &str) {
		let Some(workspace) = self.workspace(workspace_id) else {
			return;
		};
		self.renaming_workspace = Some((workspace_id.to_owned(), workspace.name.clone()));
		self.rename_focus = true;
	}

	/// Whether a workspace's name can be persisted: it must belong to a
	/// registered project, and be that project's seeded (first) workspace —
	/// the only one the registry knows how to name.
	pub fn can_rename_workspace(&self, workspace_id: &str) -> bool {
		let Some(project) = self
			.projects
			.iter()
			.find(|project| project.workspaces.iter().any(|ws| ws.id == workspace_id))
		else {
			return false;
		};
		if Self::is_local_project(&project.id) {
			return false;
		}
		project
			.workspaces
			.first()
			.is_some_and(|first| first.id == workspace_id)
			&& self.registry.get(&project.id).is_some()
	}

	/// `(id, working text)` of the open 大标签页 rename editor.
	pub fn renaming_workspace(&self) -> Option<(&str, &str)> {
		self
			.renaming_workspace
			.as_ref()
			.map(|(id, text)| (id.as_str(), text.as_str()))
	}

	pub fn set_workspace_rename_text(&mut self, text: String) {
		if let Some((_, current)) = self.renaming_workspace.as_mut() {
			*current = text;
		}
	}

	pub fn cancel_rename_workspace(&mut self) {
		self.renaming_workspace = None;
		self.rename_focus = false;
	}

	/// Commit the 大标签页 rename: the registry is written first, and the
	/// in-memory copy follows only when that write succeeded — so a failed
	/// write cannot leave the tab showing a name that is not stored.
	pub fn commit_rename_workspace(&mut self) -> Notice {
		let Some((id, text)) = self.renaming_workspace.clone() else {
			return Notice(String::new());
		};
		let name = text.trim().to_owned();
		if name.is_empty() {
			return Notice(t!("标签页名不能为空").to_owned());
		}
		let Some(project_id) = self
			.projects
			.iter()
			.find(|project| project.workspaces.iter().any(|ws| ws.id == id))
			.map(|project| project.id.clone())
		else {
			self.renaming_workspace = None;
			self.rename_focus = false;
			return Notice(t!("这个标签页已经关闭").to_owned());
		};
		if !self.can_rename_workspace(&id) {
			// Only the seeded workspace is stored by the registry; anything
			// else lives for this run, and saying so is better than a silent
			// reset on the next launch.
			if let Some(workspace) = self
				.projects
				.iter_mut()
				.flat_map(|project| project.workspaces.iter_mut())
				.find(|ws| ws.id == id)
			{
				workspace.name = name.clone();
			}
			self.renaming_workspace = None;
			self.rename_focus = false;
			return Notice(t!("已重命名为 {}（仅本次运行）", name));
		}
		match self.registry.rename_workspace(&project_id, &name) {
			Ok(()) => {
				if let Some(workspace) = self
					.projects
					.iter_mut()
					.flat_map(|project| project.workspaces.iter_mut())
					.find(|ws| ws.id == id)
				{
					workspace.name = name.clone();
				}
				self.renaming_workspace = None;
				self.rename_focus = false;
				Notice(t!("已重命名为 {}", name))
			},
			Err(error) => Notice(t!("重命名失败：{}", error)),
		}
	}

	/// Open the inline 添加项目 path editor.
	pub fn begin_add_project(&mut self) {
		self.adding_project = Some(String::new());
		self.add_focus = true;
	}

	pub fn adding(&self) -> Option<&str> {
		self.adding_project.as_deref()
	}

	pub fn set_add_text(&mut self, text: String) {
		if let Some(current) = self.adding_project.as_mut() {
			*current = text;
		}
	}

	pub fn take_add_focus(&mut self) -> bool {
		std::mem::take(&mut self.add_focus)
	}

	pub fn cancel_add_project(&mut self) {
		self.adding_project = None;
		self.add_focus = false;
	}

	/// Commit the path editor. The path itself is what decides success: a
	/// missing directory or a duplicate is reported, never registered.
	pub fn commit_add_project(&mut self) -> Notice {
		let Some(text) = self.adding_project.clone() else {
			return Notice(String::new());
		};
		let text = text.trim().to_owned();
		if text.is_empty() {
			return Notice(t!("请输入项目目录").to_owned());
		}
		self.add_project(Path::new(&text))
	}

	/// Register a directory and append it to the shell's project list.
	pub fn add_project(&mut self, path: &Path) -> Notice {
		match self.registry.add(path) {
			Ok(row) => {
				let project = crate::seed::registered_project(&row);
				self.active_project = Some(row.id.clone());
				self.active_workspace = project.workspaces.first().map(|w| w.id.clone());
				self.projects.push(project);
				self.adding_project = None;
				self.add_focus = false;
				self.center_page = CenterPage::Workspace;
				self.tui_pane = None;
				Notice(t!("已添加项目：{}", row.name))
			},
			Err(error) => Notice(t!("添加项目失败：{}", error)),
		}
	}

	/// Remove one registration from the shared file and from the shell's list.
	/// The directory and any conversation history are untouched.
	pub fn remove_project(&mut self, id: &str) -> Notice {
		if Self::is_local_project(id) {
			return Notice(t!("本机 是当前目录，不在项目注册表里").to_owned());
		}
		let name = self.project(id).map(|project| project.name.clone());
		let workspace_ids: Vec<String> = self
			.project(id)
			.map(|project| {
				project
					.workspaces
					.iter()
					.map(|workspace| workspace.id.clone())
					.collect()
			})
			.unwrap_or_default();
		match self.registry.remove(id) {
			Ok(false) => Notice(t!("注册表里没有这个项目：{}", id)),
			Ok(true) => {
				self.projects.retain(|project| project.id != id);
				if self
					.active_workspace
					.as_deref()
					.is_some_and(|active| workspace_ids.iter().any(|id| id == active))
				{
					self.active_workspace = None;
				}
				if self.active_project.as_deref() == Some(id) {
					self.active_project = self.projects.first().map(|project| project.id.clone());
					if self.active_workspace.is_none() {
						self.active_workspace = self
							.active_project
							.as_ref()
							.and_then(|id| self.project(id))
							.and_then(|project| project.workspaces.first())
							.map(|workspace| workspace.id.clone());
					}
					self.tui_pane = None;
				}
				Notice(t!("已从注册表移除 {}（目录未删除）", name.unwrap_or_else(|| id.to_owned())))
			},
			Err(error) => Notice(t!("移除项目失败：{}", error)),
		}
	}

	// ── selection ──────────────────────────────────────────────────────

	/// Selecting a project also selects one of its workspaces (the first when
	/// the previously active one is not in it), exactly as v2 does.
	pub fn select_project(&mut self, id: &str) -> Notice {
		let Some(project) = self.project(id) else {
			return Notice(t!("没有这个项目：{}", id));
		};
		let project_id = project.id.clone();
		let keeps = project
			.workspaces
			.iter()
			.any(|w| Some(w.id.as_str()) == self.active_workspace.as_deref());
		let first = project.workspaces.first().map(|w| w.id.clone());
		self.active_project = Some(project_id);
		if !keeps {
			self.active_workspace = first;
		}
		self.tui_pane = None;
		Notice(String::new())
	}

	pub fn select_workspace(&mut self, id: &str) -> Notice {
		let Some(owner) = self.project_of(id).map(|p| p.id.clone()) else {
			return Notice(t!("没有这个工作区：{}", id));
		};
		self.active_workspace = Some(id.to_owned());
		self.active_project = Some(owner);
		// Clicking a workspace — in the left column or on the 总面板's row —
		// opens its pane grid, so the 总面板 tab is left behind.
		self.center_page = CenterPage::Workspace;
		self.tui_pane = None;
		Notice(String::new())
	}

	/// The strip's 总面板 tab: the centre goes back to the all-projects table.
	/// Nothing else changes, so the open workspace survives the round trip.
	pub fn show_total(&mut self) {
		self.center_page = CenterPage::Total;
	}

	/// A centre-page switch from the strip. Selecting [`CenterPage::Workspace`]
	/// with no workspace open lands on the welcome panel, which is what the
	/// status bar's 回到首页 does.
	pub fn set_center_page(&mut self, page: CenterPage) {
		self.center_page = page;
	}

	/// The status bar's home button: no workspace open → the welcome panel.
	pub fn go_home(&mut self) {
		self.active_workspace = None;
		self.center_page = CenterPage::Workspace;
		self.tui_pane = None;
	}

	/// ＋新建大标签页 / ＋新建工作区 / a project row's `+`: a new workspace over
	/// the project directory.
	///
	/// The workspace opens on the spec's default — one pane, one 终端 page, one
	/// column (R23: 新开的默认是终端页), running a plain shell with its working
	/// directory at the project path. Nothing is typed into it: starting a
	/// program is the user's call, not a side effect of creating a workspace.
	/// Use [`Self::new_workspace_with`] when the `+` picker already knows what
	/// should be on that page.
	pub fn new_workspace(&mut self, project_id: &str) -> Notice {
		self.new_workspace_with(project_id, None)
	}

	/// ＋新建大标签页, with the `+` picker's choice as the new workspace's first
	/// page. A refused creation leaves no residue — the tab is only built once
	/// the caps have passed.
	pub fn new_workspace_with(&mut self, project_id: &str, entry: Option<&PickerEntry>) -> Notice {
		self.new_workspace_inner(project_id, entry)
	}

	fn new_workspace_inner(&mut self, project_id: &str, entry: Option<&PickerEntry>) -> Notice {
		let Some(pos) = self.projects.iter().position(|p| p.id == project_id) else {
			return Notice(t!("没有这个项目：{}", project_id));
		};
		if self.projects[pos].workspaces.len() >= MAX_WORKSPACES_PER_PROJECT {
			return Notice(t!("每个项目最多 {} 个工作区（大标签页）", MAX_WORKSPACES_PER_PROJECT));
		}
		let project_path = self.projects[pos].path.clone();
		let name = t!("新工作区 {}", self.projects[pos].workspaces.len() + 1);
		let id = self.fresh_id("ws");
		let pane_id = self.fresh_id("pane");
		let tab = self.tab_for(entry);
		let panes = vec![Pane { id: pane_id, active: tab.id.clone(), tabs: vec![tab] }];
		self.projects[pos].workspaces.push(Workspace {
			id: id.clone(),
			name,
			branch: "main".to_owned(),
			// The workspace is the project directory itself: the terminal's
			// cwd, the file tree and zetacode all start where the project is.
			path: project_path.display().to_string(),
			cols: 1,
			panes,
			// Nothing observes a workspace the user just created, so it has no
			// state of the seven — `—` is the honest answer.
			run_state: None,
		});
		self.active_project = Some(project_id.to_owned());
		self.active_workspace = Some(id);
		self.center_page = CenterPage::Workspace;
		self.tui_pane = None;
		Notice(String::new())
	}

	/// ✕ on a 大标签页. The last workspace of a project cannot be closed.
	pub fn close_workspace(&mut self, ws_id: &str) -> Notice {
		let Some(project) = self.project_of(ws_id).map(|p| p.id.clone()) else {
			return Notice(t!("没有这个工作区：{}", ws_id));
		};
		let Some(pos) = self.projects.iter().position(|p| p.id == project) else {
			return Notice(String::new());
		};
		if self.projects[pos].workspaces.len() <= 1 {
			return Notice(t!("每个项目至少保留一个工作区").to_owned());
		}
		self.projects[pos].workspaces.retain(|w| w.id != ws_id);
		if self.active_workspace.as_deref() == Some(ws_id) {
			self.active_workspace = self.projects[pos].workspaces.first().map(|w| w.id.clone());
		}
		self.tui_pane = None;
		Notice(String::new())
	}

	// ── session tabs ───────────────────────────────────────────────────

	pub fn select_tab(&mut self, pane_id: &str, tab_id: &str) {
		if let Some(pane) = self.pane_mut(pane_id) {
			if pane.tabs.iter().any(|t| t.id == tab_id) {
				pane.active = tab_id.to_owned();
			}
		}
	}

	/// ＋ in a pane's tab strip: one more terminal session.
	/// Add a sub-page of `kind` to `pane_id` (the `+` picker's pages and the
	/// IDE page's "open the diff" event both come through here).
	pub fn add_tab_of(&mut self, pane_id: &str, kind: SessionKind, title: String) -> Notice {
		if self.pane_mut(pane_id).is_none() {
			return Notice(t!("没有这个面板：{}", pane_id));
		}
		let id = self.fresh_id("tab");
		let Some(pane) = self.pane_mut(pane_id) else {
			return Notice(String::new());
		};
		if pane.tabs.len() >= MAX_SUBS_PER_PANE {
			return Notice(t!(
				"每个面板最多 {} 个子页（子页上限 {}）",
				MAX_SUBS_PER_PANE,
				MAX_SUBS_PER_PANE
			));
		}
		pane.tabs.push(SessionTab::new(id.clone(), kind, title));
		pane.active = id;
		Notice(String::new())
	}

	pub fn add_tab(&mut self, pane_id: &str) -> Notice {
		if self.pane_mut(pane_id).is_none() {
			return Notice(t!("没有这个面板：{}", pane_id));
		}
		let id = self.fresh_id("tab");
		let Some(pane) = self.pane_mut(pane_id) else {
			return Notice(String::new());
		};
		if pane.tabs.len() >= MAX_SUBS_PER_PANE {
			return Notice(t!(
				"每个面板最多 {} 个子页（子页上限 {}）",
				MAX_SUBS_PER_PANE,
				MAX_SUBS_PER_PANE
			));
		}
		let n = pane.term_count() + 1;
		pane
			.tabs
			.push(SessionTab::new(id.clone(), SessionKind::Term, t!("终端 {}", n)));
		pane.active = id;
		Notice(String::new())
	}

	/// ✕ on a session tab: refused when it would empty the pane.
	pub fn close_tab(&mut self, pane_id: &str, tab_id: &str) -> Notice {
		let Some(pane) = self.pane_mut(pane_id) else {
			return Notice(t!("没有这个面板：{}", pane_id));
		};
		if pane.tabs.len() <= 1 {
			return Notice(t!("至少保留一个小标签页").to_owned());
		}
		pane.tabs.retain(|tab| tab.id != tab_id);
		if pane.active == tab_id {
			pane.active = pane.tabs[0].id.clone();
		}
		Notice(String::new())
	}

	// ── pages, the ＋ picker, and the editor ───────────────────────────

	/// ＋ in a pane's tab strip, with a page kind: opens that page as a tab.
	pub fn open_page(&mut self, pane_id: &str, kind: SessionKind) -> Notice {
		if self.pane_mut(pane_id).is_none() {
			return Notice(t!("没有这个面板：{}", pane_id));
		}
		let tab = self.tab_for(Some(&PickerEntry::Page(kind)));
		self.push_tab(pane_id, tab)
	}

	/// ＋ in a pane's tab strip, with a shell the host really has: opens a
	/// 终端 page that records it.
	pub fn open_shell(&mut self, pane_id: &str, shell: crate::shells::Shell) -> Notice {
		if self.pane_mut(pane_id).is_none() {
			return Notice(t!("没有这个面板：{}", pane_id));
		}
		let tab = self.tab_for(Some(&PickerEntry::Shell(shell)));
		self.push_tab(pane_id, tab)
	}

	fn push_tab(&mut self, pane_id: &str, tab: SessionTab) -> Notice {
		let Some(pane) = self.pane_mut(pane_id) else {
			return Notice(t!("没有这个面板：{}", pane_id));
		};
		if pane.tabs.len() >= MAX_SUBS_PER_PANE {
			return Notice(t!(
				"每个面板最多 {} 个子页（子页上限 {}）",
				MAX_SUBS_PER_PANE,
				MAX_SUBS_PER_PANE
			));
		}
		pane.active = tab.id.clone();
		pane.tabs.push(tab);
		Notice(String::new())
	}

	/// Open a real file in a pane's 编辑器 page.
	///
	/// A file that is already open in that pane is *activated*, not reloaded:
	/// an unsaved buffer is the user's work and is never silently discarded. A
	/// path that is a directory is refused rather than opened as empty.
	pub fn open_file(&mut self, pane_id: &str, path: &Path) -> Notice {
		let Some(doc) = EditorDoc::open_file(path) else {
			return Notice(t!("{} 是目录，编辑器只打开文件", path.display()));
		};
		let existing = self.pane_mut(pane_id).and_then(|pane| {
			pane
				.tabs
				.iter()
				.find(|tab| {
					tab.kind == SessionKind::Editor
						&& tab.doc.as_ref().is_some_and(|open| open.path == path)
				})
				.map(|tab| tab.id.clone())
		});
		if let Some(tab_id) = existing {
			self.select_tab(pane_id, &tab_id);
			return Notice(String::new());
		}
		let io_error = doc.error.clone();
		let mut tab = SessionTab::new(self.fresh_id("tab"), SessionKind::Editor, doc.name());
		tab.doc = Some(doc);
		let notice = self.push_tab(pane_id, tab);
		if notice.0.is_empty() {
			if let Some(error) = io_error {
				return Notice(t!("打不开文件：{}", error));
			}
		}
		notice
	}

	/// One session tab, mutably.
	pub fn tab_mut(&mut self, pane_id: &str, tab_id: &str) -> Option<&mut SessionTab> {
		self
			.pane_mut(pane_id)?
			.tabs
			.iter_mut()
			.find(|tab| tab.id == tab_id)
	}

	/// The open document behind a pane's session tab.
	pub fn doc_mut(&mut self, pane_id: &str, tab_id: &str) -> Option<&mut EditorDoc> {
		self.tab_mut(pane_id, tab_id)?.doc.as_mut()
	}

	/// Write one editor buffer back to its file.
	pub fn save_editor(&mut self, pane_id: &str, tab_id: &str) -> Notice {
		let Some(doc) = self.doc_mut(pane_id, tab_id) else {
			return Notice(t!("这个标签页没有打开文件").to_owned());
		};
		let path = doc.path.display().to_string();
		match doc.save() {
			Ok(()) => Notice(t!("已保存 {}", path)),
			Err(error) => Notice(t!("保存失败：{}", error)),
		}
	}

	/// 保存 (Ctrl+S): every dirty editor buffer in the open workspace.
	pub fn save_dirty_editors(&mut self) -> Notice {
		let targets: Vec<(String, String)> = self
			.visible_panes()
			.iter()
			.flat_map(|pane| {
				pane
					.tabs
					.iter()
					.filter(|tab| tab.doc.as_ref().is_some_and(|doc| doc.dirty))
					.map(|tab| (pane.id.clone(), tab.id.clone()))
			})
			.collect();
		if targets.is_empty() {
			return Notice(String::new());
		}
		let mut saved = 0usize;
		let mut failed: Vec<String> = Vec::new();
		for (pane_id, tab_id) in targets {
			let Some(doc) = self.doc_mut(&pane_id, &tab_id) else {
				continue;
			};
			match doc.save() {
				Ok(()) => saved += 1,
				Err(error) => failed.push(error),
			}
		}
		if !failed.is_empty() {
			return Notice(t!("保存失败：{}", failed.join("；")));
		}
		Notice(t!("已保存 {} 个文件", saved))
	}

	/// Open the ＋ picker for a target: the 大标签页 strip, or one pane.
	pub fn open_picker(&mut self, target: PickerTarget) {
		self.picker = Some(target);
		self.settings_open = false;
		self.usage_open = false;
	}

	pub fn close_picker(&mut self) {
		self.picker = None;
	}

	pub fn picker(&self) -> Option<&PickerTarget> {
		self.picker.as_ref()
	}

	/// A picker row was clicked: open it where the picker was opened from.
	pub fn pick(&mut self, entry: &PickerEntry) -> Notice {
		match self.picker.take() {
			None => Notice(String::new()),
			Some(PickerTarget::BigTab) => {
				let Some(project) = self.active_project.clone() else {
					return Notice(t!("先选择一个项目").to_owned());
				};
				self.new_workspace_with(&project, Some(entry))
			},
			Some(PickerTarget::Pane(pane_id)) => {
				let tab = self.tab_for(Some(entry));
				self.push_tab(&pane_id, tab)
			},
		}
	}

	/// 左栏底部的 用量: open the
	/// stats container. The numbers are read from `packages/stats` on loopback;
	/// see [`crate::stats`] for the URL and [`crate::usage`] for the panel.
	pub fn open_usage(&mut self) {
		self.usage_open = true;
		self.settings_open = false;
		self.picker = None;
	}

	pub fn close_usage(&mut self) {
		self.usage_open = false;
	}

	pub fn usage_view_open(&self) -> bool {
		self.usage_open
	}

	/// The status bar's 关闭: collapse the bar. The bar's own slim restore strip
	/// brings it back, so the button is never a one-way door.
	pub fn toggle_statusbar(&mut self) -> Notice {
		self.statusbar_open = !self.statusbar_open;
		if self.statusbar_open {
			Notice(t!("状态栏已展开").to_owned())
		} else {
			Notice(t!("状态栏已收起").to_owned())
		}
	}

	pub fn statusbar_visible(&self) -> bool {
		self.statusbar_open
	}

	// ── panes and columns ──────────────────────────────────────────────

	/// 分屏: one more pane, refused past three.
	pub fn new_pane(&mut self) -> Notice {
		let Some(ws_id) = self.active_workspace.clone() else {
			return Notice(t!("先打开一个工作区").to_owned());
		};
		let current = self.workspace(&ws_id).map(|ws| ws.panes.len()).unwrap_or(0);
		if current >= MAX_PANES {
			return Notice(t!("最多分屏 {} 列", MAX_PANES));
		}
		let pane_id = self.fresh_id("pane");
		let pane = self.basic_pane(&pane_id, current + 1);
		let Some(ws) = self.workspace_mut(&ws_id) else {
			return Notice(String::new());
		};
		ws.panes.push(pane);
		ws.cols = ws.cols.max(ws.panes.len() as u8).min(MAX_PANES as u8);
		Notice(String::new())
	}

	/// ✕ on a pane: refused when it is the workspace's only one.
	pub fn close_pane(&mut self, pane_id: &str) -> Notice {
		let Some(ws_id) = self.active_workspace.clone() else {
			return Notice(t!("先打开一个工作区").to_owned());
		};
		let Some(ws) = self.workspace_mut(&ws_id) else {
			return Notice(String::new());
		};
		if ws.panes.len() <= 1 {
			return Notice(t!("至少保留一个面板").to_owned());
		}
		ws.panes.retain(|pane| pane.id != pane_id);
		ws.cols = ws.cols.min(ws.panes.len() as u8).max(1);
		Notice(String::new())
	}

	/// 新建终端 in the tool strip: a terminal session in the first pane.
	pub fn new_term(&mut self) -> Notice {
		let Some(pane_id) = self
			.active_workspace()
			.and_then(|ws| ws.panes.first())
			.map(|pane| pane.id.clone())
		else {
			return Notice(t!("先打开一个工作区").to_owned());
		};
		self.add_tab(&pane_id)
	}

	/// 列数 1 · 2 · 3: creates the panes the requested column count needs.
	pub fn set_cols(&mut self, cols: u8) -> Notice {
		let Some(ws_id) = self.active_workspace.clone() else {
			return Notice(t!("先打开一个工作区").to_owned());
		};
		let cols = cols.clamp(1, MAX_PANES as u8);
		let current = self.workspace(&ws_id).map(|ws| ws.panes.len()).unwrap_or(0);
		let mut new_panes = Vec::new();
		for n in current + 1..=usize::from(cols) {
			let pane_id = self.fresh_id("pane");
			new_panes.push(self.basic_pane(&pane_id, n));
		}
		let Some(ws) = self.workspace_mut(&ws_id) else {
			return Notice(String::new());
		};
		ws.panes.extend(new_panes);
		ws.cols = cols;
		Notice(String::new())
	}

	/// The panes the grid shows: the first `cols`, exactly as v2 slices them.
	pub fn visible_panes(&self) -> &[Pane] {
		match self.active_workspace() {
			Some(ws) if !ws.panes.is_empty() => {
				let n = usize::from(ws.cols).clamp(1, ws.panes.len());
				&ws.panes[..n]
			},
			_ => &[],
		}
	}

	/// The columns the tool strip's segmented control highlights (0 = no
	/// workspace open, so nothing is highlighted).
	pub fn active_cols(&self) -> u8 {
		self.active_workspace().map(|ws| ws.cols).unwrap_or(0)
	}

	// ── misc UI verbs ──────────────────────────────────────────────────

	/// 聚焦当前窗口: collapse both columns.
	pub fn focus_mode(&mut self) -> Notice {
		self.left_collapsed = true;
		self.right_collapsed = true;
		Notice(t!("已聚焦当前窗口").to_owned())
	}

	pub fn toggle_left(&mut self) {
		self.left_collapsed = !self.left_collapsed;
	}

	pub fn toggle_right(&mut self) {
		self.right_collapsed = !self.right_collapsed;
	}

	/// A right-column tab click always opens the column.
	pub fn set_right_tab(&mut self, tab: RightTab) {
		self.right_tab = tab;
		self.right_collapsed = false;
	}

	/// Escape: close the topmost overlay, else leave the TUI view.
	pub fn escape(&mut self) -> bool {
		if self.picker.is_some() {
			self.picker = None;
			return true;
		}
		if self.usage_open {
			self.usage_open = false;
			return true;
		}
		if self.settings_open {
			self.settings_open = false;
			return true;
		}
		false
	}

	/// The focused TUI terminal box, toggled by a click.
	pub fn toggle_tui_pane(&mut self, pane_id: &str) {
		self.tui_pane = if self.tui_pane.as_deref() == Some(pane_id) {
			None
		} else {
			Some(pane_id.to_owned())
		};
	}

	pub fn help(&mut self) -> Notice {
		self.toast(t!("帮助：⌘K 搜索 · ⌘B 切换侧栏 · 设置内可管理项目"))
	}

	/// Run one state action and show whatever it had to say.
	///
	/// Every panel goes through this, so a refused action (a cap, a missing
	/// selection) always reaches the toast and never leaves a half-applied
	/// change behind.
	pub fn act(&mut self, action: impl FnOnce(&mut Self) -> Notice) {
		let notice = action(self);
		self.show(notice);
	}

	/// Set the toast text and hand the notice back.
	pub fn toast(&mut self, message: impl Into<String>) -> Notice {
		let notice = Notice(message.into());
		self.show(notice.clone());
		notice
	}

	pub fn show(&mut self, notice: Notice) {
		if !notice.0.is_empty() {
			self.toast = Some((notice.0, Instant::now()));
		}
	}

	/// Drop an expired toast; returns the text while it is still fresh.
	pub fn live_toast(&self) -> Option<&str> {
		self
			.toast
			.as_ref()
			.filter(|(_, at)| at.elapsed() < TOAST_TTL)
			.map(|(text, _)| text.as_str())
	}

	// ── the settings modal ─────────────────────────────────────────────

	/// Any overlay is on screen: the 设置 modal, the 用量 container, or a `+`
	/// picker. The resize border stands down while one is.
	pub fn modal_open(&self) -> bool {
		self.settings_open || self.usage_open || self.picker.is_some()
	}

	/// Specifically the 设置 modal.
	pub fn settings_open(&self) -> bool {
		self.settings_open
	}

	pub fn open_settings(&mut self) {
		self.settings_open = true;
		self.usage_open = false;
		self.picker = None;
	}

	pub fn close_modal(&mut self) {
		self.settings_open = false;
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A shell over an empty registry: 本机 with its single seeded pane.
	fn state() -> AppState {
		static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
		let unique = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
		AppState::seeded_with_registry(
			std::path::Path::new("."),
			workbench_projects::Registry::empty_at(
				std::env::temp_dir()
					.join(format!("zetawork-gui-state-tests-{}-{unique}", std::process::id()))
					.join("projects.json"),
			),
		)
	}

	#[test]
	fn a_page_of_any_kind_can_be_added() {
		let mut state = state();
		let pane = state.active_workspace().unwrap().panes[0].id.clone();
		let seen = state.active_workspace().unwrap().panes[0].tabs.len();
		let notice = state.add_tab_of(&pane, SessionKind::Diff, "改动".to_owned());
		assert!(notice.0.is_empty(), "accepted: {}", notice.0);
		let after = &state.active_workspace().unwrap().panes[0];
		assert_eq!(after.tabs.len(), seen + 1);
		assert_eq!(
			after.tabs.last().unwrap().kind,
			SessionKind::Diff,
			"the kind is the one asked for"
		);
		assert_eq!(after.active, after.tabs.last().unwrap().id, "the new page takes focus");
	}

	#[test]
	fn seeds_the_local_project_and_opens_the_first_workspace() {
		let state = state();
		assert_eq!(state.projects.len(), 1, "本机 is the only project without registrations");
		assert!(state.active_project().is_some());
		assert!(state.active_workspace().is_some());
		assert_eq!(state.active_workspace().unwrap().panes.len(), 1);
		assert_eq!(state.active_cols(), 1);
	}

	#[test]
	fn seventh_workspace_is_refused() {
		let mut state = state();
		let project = state.projects[0].id.clone();
		let start = state.projects[0].workspaces.len();
		for _ in start..MAX_WORKSPACES_PER_PROJECT {
			let notice = state.new_workspace(&project);
			assert!(notice.0.is_empty(), "refused early: {}", notice.0);
		}
		assert_eq!(state.projects[0].workspaces.len(), MAX_WORKSPACES_PER_PROJECT);
		let notice = state.new_workspace(&project);
		assert_eq!(state.projects[0].workspaces.len(), MAX_WORKSPACES_PER_PROJECT);
		assert!(notice.0.contains("最多"), "got {notice:?}");
	}

	#[test]
	fn last_workspace_of_a_project_cannot_be_closed() {
		let mut state = state();
		let project = state
			.projects
			.iter()
			.position(|p| p.workspaces.len() == 1)
			.unwrap();
		let ws = state.projects[project].workspaces[0].id.clone();
		let notice = state.close_workspace(&ws);
		assert_eq!(state.projects[project].workspaces.len(), 1);
		assert!(notice.0.contains("至少"), "got {notice:?}");
	}

	#[test]
	fn a_pane_keeps_at_least_one_session_tab() {
		let mut state = state();
		let ws = state.active_workspace().unwrap().clone();
		let pane = ws.panes[0].clone();
		assert!(!pane.tabs.is_empty());
		// Close every tab but one: allowed.
		loop {
			let tabs = state
				.workspace(&ws.id)
				.unwrap()
				.panes
				.iter()
				.find(|p| p.id == pane.id)
				.unwrap()
				.tabs
				.clone();
			if tabs.len() <= 1 {
				break;
			}
			let notice = state.close_tab(&pane.id, &tabs.last().unwrap().id);
			assert!(notice.0.is_empty(), "unexpected refusal: {}", notice.0);
		}
		let last = state.workspace(&ws.id).unwrap().panes[0].tabs[0].id.clone();
		let notice = state.close_tab(&pane.id, &last);
		assert_eq!(state.workspace(&ws.id).unwrap().panes[0].tabs.len(), 1);
		assert!(notice.0.contains("至少"), "got {notice:?}");
		// The active tab is never left dangling.
		let pane = &state.workspace(&ws.id).unwrap().panes[0];
		assert_eq!(pane.active, last);
	}

	#[test]
	fn a_workspace_keeps_at_least_one_pane_and_at_most_three() {
		let mut state = state();
		let ws_id = state.active_workspace().unwrap().id.clone();
		let first = state.workspace(&ws_id).unwrap().panes[0].id.clone();
		while state.workspace(&ws_id).unwrap().panes.len() < MAX_PANES {
			let notice = state.new_pane();
			assert!(notice.0.is_empty(), "refused early: {}", notice.0);
		}
		assert_eq!(state.workspace(&ws_id).unwrap().panes.len(), MAX_PANES);
		let notice = state.new_pane();
		assert_eq!(state.workspace(&ws_id).unwrap().panes.len(), MAX_PANES);
		assert!(notice.0.contains("最多"), "got {notice:?}");
		// Three panes were added from the single seeded pane.
		assert_eq!(state.active_cols(), 3);
		// Now closing is allowed down to one pane, then refused.
		let second = state.workspace(&ws_id).unwrap().panes[1].id.clone();
		let third = state.workspace(&ws_id).unwrap().panes[2].id.clone();
		assert!(state.close_pane(&third).0.is_empty());
		assert!(state.close_pane(&second).0.is_empty());
		assert_eq!(state.active_cols(), 1);
		let notice = state.close_pane(&first);
		assert_eq!(state.workspace(&ws_id).unwrap().panes.len(), 1);
		assert!(notice.0.contains("至少"), "got {notice:?}");
	}

	#[test]
	fn column_control_creates_the_panes_it_needs() {
		let mut state = state();
		let ws_id = state.active_workspace().unwrap().id.clone();
		assert_eq!(state.active_cols(), 1, "a fresh workspace starts at one column");
		assert!(state.set_cols(3).0.is_empty());
		assert_eq!(state.workspace(&ws_id).unwrap().panes.len(), 3);
		assert_eq!(state.active_cols(), 3);
		assert!(state.set_cols(1).0.is_empty());
		assert_eq!(state.active_cols(), 1);
		assert_eq!(
			state.workspace(&ws_id).unwrap().panes.len(),
			3,
			"panes are kept, the grid shows 1"
		);
		assert_eq!(state.visible_panes().len(), 1);
	}

	#[test]
	fn opening_a_workspace_selects_its_project() {
		let mut state = state();
		let dir = tempfile::tempdir().expect("temp dir");
		for name in ["alpha", "beta"] {
			let path = dir.path().join(name);
			std::fs::create_dir_all(&path).unwrap();
			let notice = state.add_project(&path);
			assert!(notice.0.contains("已添加项目"), "{name}: {}", notice.0);
		}
		let target = state.projects[1].workspaces[0].id.clone();
		assert!(state.select_workspace(&target).0.is_empty());
		assert_eq!(state.active_project.as_deref(), Some(state.projects[1].id.as_str()));
		assert_eq!(state.active_workspace.as_deref(), Some(target.as_str()));
		// A project that does not contain the active workspace moves to its
		// first.
		let other = state.projects[2].id.clone();
		assert!(state.select_project(&other).0.is_empty());
		assert_eq!(
			state.active_workspace().unwrap().id.as_str(),
			state.projects[2].workspaces[0].id.as_str()
		);
	}

	#[test]
	fn go_home_shows_the_welcome_panel() {
		let mut state = state();
		state.go_home();
		assert!(state.active_workspace().is_none());
		assert!(state.visible_panes().is_empty());
		assert_eq!(state.workspace_label(), "未选择工作区");
		assert_eq!(state.branch_label(), "—");
	}

	#[test]
	fn ids_stay_unique_across_panes_and_tabs() {
		let mut state = state();
		let ws_id = state.active_workspace().unwrap().id.clone();
		let pane = state.workspace(&ws_id).unwrap().panes[0].id.clone();
		let active = |state: &AppState| {
			state
				.workspace(&ws_id)
				.unwrap()
				.panes
				.iter()
				.find(|p| p.id == pane)
				.unwrap()
				.active
				.clone()
		};
		let tabs = |state: &AppState| state.workspace(&ws_id).unwrap().panes[0].tabs.len();
		let mut seen = std::collections::HashSet::new();
		// Repeatedly add and close, which is where an index-based id scheme
		// starts reusing ids. The pane starts with the two seeded tabs, so
		// 子页上限 8 is reached after six more.
		let seeded = tabs(&state);
		for added in 0..(MAX_SUBS_PER_PANE - seeded) {
			let notice = state.add_tab(&pane);
			assert!(notice.0.is_empty(), "{added}: {}", notice.0);
			let tab = active(&state);
			assert!(seen.insert(tab.clone()), "duplicate id {tab}");
		}
		assert_eq!(tabs(&state), MAX_SUBS_PER_PANE, "the pane is full");
		// 子页上限 8: the ninth is refused, says so, and changes nothing.
		let refused = state.add_tab(&pane);
		assert!(refused.0.contains("8"), "{}", refused.0);
		assert_eq!(tabs(&state), MAX_SUBS_PER_PANE);
		// Closing frees exactly one slot, and the id that replaces it is still
		// fresh — the add/close cycle the old index-based scheme failed.
		for _ in 0..2 {
			let closing = active(&state);
			assert!(state.close_tab(&pane, &closing).0.is_empty());
			let notice = state.add_tab(&pane);
			assert!(notice.0.is_empty(), "{}", notice.0);
			let tab = active(&state);
			assert_ne!(tab, closing, "a freed tab id must not come back");
			assert!(seen.insert(tab.clone()), "duplicate id {tab}");
		}
		assert_eq!(tabs(&state), MAX_SUBS_PER_PANE);
	}
}
