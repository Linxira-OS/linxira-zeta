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

use std::time::{Duration, Instant};

use crate::settings::Section;

/// The most workspaces (大标签页) one project may hold.
///
/// The spec's mock has no cap; the strip scrolls. A cap keeps the strip and
/// the project list from growing without bound, and the refusal is visible
/// (toast) rather than silent.
pub const MAX_WORKSPACES_PER_PROJECT: usize = 6;

/// A workspace shows at most three panes, in one to three columns.
pub const MAX_PANES: usize = 3;

/// How long a toast stays on screen.
pub const TOAST_TTL: Duration = Duration::from_millis(1800);

/// The left column's navigation entries.
///
/// The spec lists four (搜索 / 任务 / 自动化 / 手机版); this round ships three —
/// the mobile entry is deliberately absent until its design exists, and it
/// comes back as one more variant here plus one entry in [`NavItem::ALL`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NavItem {
	#[default]
	Search,
	Tasks,
	Automations,
}

impl NavItem {
	pub const ALL: [Self; 3] = [Self::Search, Self::Tasks, Self::Automations];

	pub fn label(self) -> &'static str {
		match self {
			Self::Search => "搜索",
			Self::Tasks => "任务",
			Self::Automations => "自动化",
		}
	}

	/// The trailing `.nav-count` text, and whether it is a key hint.
	pub fn trailing(self) -> Option<(&'static str, bool)> {
		match self {
			Self::Search => Some(("⌘K", true)),
			Self::Tasks => Some(("3", false)),
			Self::Automations => None,
		}
	}

	/// What backs this entry. None of them has a data source yet, so clicking
	/// one says so instead of opening an empty page.
	pub fn source(self) -> &'static str {
		match self {
			Self::Search => "zetawork 全局搜索（文件 + 会话 + 命令索引）",
			Self::Tasks => "zetawork 任务队列（agent 任务与后台进程）",
			Self::Automations => "zetawork 自动化规则引擎",
		}
	}
}

/// Which shell is on screen. Both render the *same* state.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ViewMode {
	#[default]
	Gui,
	Tui,
}

/// The right column's three panels (v2 dropped the context/usage tab).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RightTab {
	#[default]
	Files,
	History,
	Git,
}

impl RightTab {
	pub const ALL: [Self; 3] = [Self::Files, Self::History, Self::Git];

	/// The panel head, spelled as the spec spells it.
	pub fn title(self) -> &'static str {
		match self {
			Self::Files => "文件",
			Self::History => "历史 · Agent 对话",
			Self::Git => "Git 状态",
		}
	}
}

/// What a session tab renders.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionKind {
	Term,
	Editor,
	Diff,
}

/// One session tab inside a pane.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionTab {
	pub id: String,
	pub kind: SessionKind,
	pub title: String,
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
}

/// A workspace — the spec's 大标签页. Carries its own pane layout.
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
}

/// A project groups workspaces; a project is what the left column lists.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Project {
	pub id: String,
	pub name: String,
	pub workspaces: Vec<Workspace>,
}

/// One refused action, shown as a toast. An empty notice means "nothing to
/// say" and is not rendered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notice(pub String);

/// The whole shell state.
#[derive(Clone, Debug)]
pub struct AppState {
	pub view: ViewMode,
	pub left_collapsed: bool,
	pub right_collapsed: bool,
	pub right_tab: RightTab,
	pub active_project: Option<String>,
	pub active_workspace: Option<String>,
	/// Whether the git panel's 提交 group is expanded. Kept in the state
	/// because the TUI view shows the same group.
	pub commits_open: bool,
	pub settings_section: Section,
	/// The left column's selected nav entry.
	pub nav: NavItem,
	/// The focused terminal box in the TUI view; `None` = none focused.
	pub tui_pane: Option<String>,
	pub projects: Vec<Project>,
	pub toast: Option<(String, Instant)>,
	settings_open: bool,
	/// Monotonic id source for workspaces, panes and session tabs.
	next_id: u64,
}

impl Default for AppState {
	fn default() -> Self {
		Self {
			view: ViewMode::Gui,
			left_collapsed: false,
			right_collapsed: false,
			right_tab: RightTab::Files,
			active_project: None,
			active_workspace: None,
			commits_open: true,
			settings_section: Section::Appearance,
			nav: NavItem::Search,
			tui_pane: None,
			projects: Vec::new(),
			toast: None,
			settings_open: false,
			next_id: 1,
		}
	}
}

impl AppState {
	/// A shell seeded with the spec's sample projects plus the directory the
	/// shell was started in (see [`crate::seed`]).
	pub fn seeded(cwd: &std::path::Path) -> Self {
		let mut state = Self::default();
		state.projects = crate::seed::projects(cwd);
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
			.unwrap_or("未选择工作区")
	}

	/// The status bar's branch column: `—` with nothing open.
	pub fn branch_label(&self) -> &str {
		self
			.active_workspace()
			.map(|w| w.branch.as_str())
			.unwrap_or("—")
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

	/// The layout a fresh workspace starts with: two panes, the first holding a
	/// terminal and an editor tab, the second a terminal and a diff tab —
	/// exactly the spec's `layoutFor()`.
	fn default_layout(&mut self, ws_id: &str) -> (Vec<Pane>, u8) {
		let mut panes = Vec::with_capacity(2);
		for (index, extra) in
			[(0usize, Some(SessionKind::Editor)), (1, Some(SessionKind::Diff))].into_iter()
		{
			let pane_id = self.fresh_id("pane");
			let mut pane = self.basic_pane(&pane_id, index + 1);
			if let Some(kind) = extra {
				let tab_id = self.fresh_id("tab");
				let title = match kind {
					SessionKind::Editor => "workspace.rs".to_owned(),
					_ => "改动".to_owned(),
				};
				pane.tabs.push(SessionTab { id: tab_id, kind, title });
			}
			panes.push(pane);
		}
		let _ = ws_id;
		(panes, 2)
	}

	/// A pane holding a single terminal session.
	fn basic_pane(&mut self, pane_id: &str, number: usize) -> Pane {
		let tab_id = self.fresh_id("tab");
		Pane {
			id: pane_id.to_owned(),
			active: tab_id.clone(),
			tabs: vec![SessionTab {
				id: tab_id,
				kind: SessionKind::Term,
				title: format!("终端 {number}"),
			}],
		}
	}

	// ── selection ──────────────────────────────────────────────────────

	/// Selecting a project also selects one of its workspaces (the first when
	/// the previously active one is not in it), exactly as v2 does.
	pub fn select_project(&mut self, id: &str) -> Notice {
		let Some(project) = self.project(id) else {
			return Notice(format!("没有这个项目：{id}"));
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
			return Notice(format!("没有这个工作区：{id}"));
		};
		self.active_workspace = Some(id.to_owned());
		self.active_project = Some(owner);
		self.tui_pane = None;
		Notice(String::new())
	}

	/// The status bar's home button: no workspace open → the welcome panel.
	pub fn go_home(&mut self) {
		self.active_workspace = None;
		self.tui_pane = None;
	}

	/// ＋新建大标签页 / ＋新建工作区: a new workspace under a project.
	pub fn new_workspace(&mut self, project_id: &str) -> Notice {
		let Some(pos) = self.projects.iter().position(|p| p.id == project_id) else {
			return Notice(format!("没有这个项目：{project_id}"));
		};
		if self.projects[pos].workspaces.len() >= MAX_WORKSPACES_PER_PROJECT {
			return Notice(format!("每个项目最多 {MAX_WORKSPACES_PER_PROJECT} 个工作区（大标签页）"));
		}
		let project_name = self.projects[pos].name.clone();
		let name = format!("新工作区 {}", self.projects[pos].workspaces.len() + 1);
		let id = self.fresh_id("ws");
		let (panes, cols) = self.default_layout(&id);
		self.projects[pos].workspaces.push(Workspace {
			id: id.clone(),
			name,
			branch: "main".to_owned(),
			path: format!("~/{project_name}/新工作区"),
			cols,
			panes,
		});
		self.active_project = Some(project_id.to_owned());
		self.active_workspace = Some(id);
		self.tui_pane = None;
		Notice(String::new())
	}

	/// ✕ on a 大标签页. The last workspace of a project cannot be closed.
	pub fn close_workspace(&mut self, ws_id: &str) -> Notice {
		let Some(project) = self.project_of(ws_id).map(|p| p.id.clone()) else {
			return Notice(format!("没有这个工作区：{ws_id}"));
		};
		let Some(pos) = self.projects.iter().position(|p| p.id == project) else {
			return Notice(String::new());
		};
		if self.projects[pos].workspaces.len() <= 1 {
			return Notice("每个项目至少保留一个工作区".to_owned());
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
	pub fn add_tab(&mut self, pane_id: &str) -> Notice {
		if self.pane_mut(pane_id).is_none() {
			return Notice(format!("没有这个面板：{pane_id}"));
		}
		let id = self.fresh_id("tab");
		let Some(pane) = self.pane_mut(pane_id) else {
			return Notice(String::new());
		};
		let n = pane.term_count() + 1;
		pane.tabs.push(SessionTab {
			id: id.clone(),
			kind: SessionKind::Term,
			title: format!("终端 {n}"),
		});
		pane.active = id;
		Notice(String::new())
	}

	/// ✕ on a session tab: refused when it would empty the pane.
	pub fn close_tab(&mut self, pane_id: &str, tab_id: &str) -> Notice {
		let Some(pane) = self.pane_mut(pane_id) else {
			return Notice(format!("没有这个面板：{pane_id}"));
		};
		if pane.tabs.len() <= 1 {
			return Notice("至少保留一个小标签页".to_owned());
		}
		pane.tabs.retain(|tab| tab.id != tab_id);
		if pane.active == tab_id {
			pane.active = pane.tabs[0].id.clone();
		}
		Notice(String::new())
	}

	// ── panes and columns ──────────────────────────────────────────────

	/// 分屏: one more pane, refused past three.
	pub fn new_pane(&mut self) -> Notice {
		let Some(ws_id) = self.active_workspace.clone() else {
			return Notice("先打开一个工作区".to_owned());
		};
		let current = self.workspace(&ws_id).map(|ws| ws.panes.len()).unwrap_or(0);
		if current >= MAX_PANES {
			return Notice(format!("最多分屏 {MAX_PANES} 列"));
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
			return Notice("先打开一个工作区".to_owned());
		};
		let Some(ws) = self.workspace_mut(&ws_id) else {
			return Notice(String::new());
		};
		if ws.panes.len() <= 1 {
			return Notice("至少保留一个面板".to_owned());
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
			return Notice("先打开一个工作区".to_owned());
		};
		self.add_tab(&pane_id)
	}

	/// 列数 1 · 2 · 3: creates the panes the requested column count needs.
	pub fn set_cols(&mut self, cols: u8) -> Notice {
		let Some(ws_id) = self.active_workspace.clone() else {
			return Notice("先打开一个工作区".to_owned());
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
		Notice("已聚焦当前窗口".to_owned())
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

	pub fn set_view(&mut self, view: ViewMode) {
		self.view = view;
	}

	/// Escape: close the settings modal, else leave the TUI view.
	pub fn escape(&mut self) -> bool {
		if self.modal_open() {
			self.close_modal();
			return true;
		}
		if self.view == ViewMode::Tui {
			self.view = ViewMode::Gui;
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
		self.toast("帮助：⌘K 搜索 · ⌘B 切换侧栏 · 设置内可管理项目")
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

	pub fn modal_open(&self) -> bool {
		self.settings_open
	}

	pub fn open_settings(&mut self) {
		self.settings_open = true;
	}

	pub fn close_modal(&mut self) {
		self.settings_open = false;
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A workspace with `cols` columns and the spec's default two panes.
	fn state() -> AppState {
		AppState::seeded(std::path::Path::new("."))
	}

	#[test]
	fn seeds_the_spec_projects_and_opens_the_first_workspace() {
		let state = state();
		assert_eq!(state.projects.len(), 4, "三个示例项目 + 本机");
		assert!(state.active_project().is_some());
		assert!(state.active_workspace().is_some());
		assert_eq!(state.active_workspace().unwrap().panes.len(), 2);
		assert_eq!(state.active_cols(), 2);
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
		assert!(pane.tabs.len() >= 2);
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
		// 3 columns were reached from 2 panes.
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
		assert_eq!(state.active_cols(), 2);
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
		let target = state.projects[1].workspaces[0].id.clone();
		assert!(state.select_workspace(&target).0.is_empty());
		assert_eq!(state.active_project.as_deref(), Some(state.projects[1].id.as_str()));
		assert_eq!(state.active_workspace.as_deref(), Some(target.as_str()));
		// A project that does not contain the active workspace moves to its first.
		let other = state.projects[2].id.clone();
		assert!(state.select_project(&other).0.is_empty());
		assert!(
			state
				.active_workspace()
				.unwrap()
				.id
				.starts_with(&state.projects[2].workspaces[0].id)
		);
	}

	#[test]
	fn escape_closes_the_modal_before_leaving_the_tui_view() {
		let mut state = state();
		state.set_view(ViewMode::Tui);
		state.open_settings();
		assert!(state.escape(), "the modal swallowed the first escape");
		assert!(!state.modal_open());
		assert_eq!(state.view, ViewMode::Tui, "still in the TUI view");
		assert!(state.escape());
		assert_eq!(state.view, ViewMode::Gui);
		assert!(!state.escape(), "nothing left to close");
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
		let mut seen = std::collections::HashSet::new();
		// Repeatedly add and close, which is where an index-based id scheme
		// starts reusing ids.
		for _ in 0..8 {
			let notice = state.add_tab(&pane);
			assert!(notice.0.is_empty());
			let tab = state
				.workspace(&ws_id)
				.unwrap()
				.panes
				.iter()
				.find(|p| p.id == pane)
				.unwrap()
				.active
				.clone();
			assert!(seen.insert(tab.clone()), "duplicate id {tab}");
		}
		assert_eq!(state.workspace(&ws_id).unwrap().panes[0].tabs.len(), 10);
	}
}
