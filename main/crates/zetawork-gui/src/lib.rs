//! zetawork — the GUI shell of the Zeta workbench.
//!
//! One window, one state, two renderings of it:
//!
//! ```text
//! ┌ title bar ───────────────────── zetawork · 视图 GUI/TUI · ▁ ▢ ✕ ─┐
//! │ side-left │ 大标签页 strip / tool strip / pane grid │ side-right  │
//! └ statusbar ─────────────────────────────────────────────────────── ┘
//! ```
//!
//! [`Shell`] owns everything the shell knows ([`state::AppState`], the
//! persisted [`settings::Settings`], the read-only file tree and git status, the
//! terminal blit cache) and drives the panels in [`eframe::App::update`]. The
//! GUI view is [`center::workspace`]; the TUI view is [`tui_view::view`] and
//! reads the *same* state, minus the controls that only exist in a window.
//!
//! What is real in this slice: the file tree ([`fsread`]), the git status
//! ([`git`]), the process's own memory (the status bar), and every state
//! transition. What is not: the pane bodies, which are labelled placeholders
//! naming their future source, and everything that would write to a repository.

pub mod blit;
pub mod center;
pub mod chrome;
pub mod fonts;
pub mod fsread;
pub mod git;
pub mod icons;
pub mod left;
pub mod picker;
pub mod right;
pub mod seed;
pub mod settings;
pub mod settings_ui;
pub mod shells;
pub mod state;
pub mod stats;
pub mod statusbar;
pub mod theme;
pub mod tui_view;
pub mod usage;
pub mod widgets;
pub mod zetacode;

use std::path::PathBuf;
use std::time::Instant;

use eframe::egui;
use egui::{Context, ViewportCommand};

use crate::blit::BufferCache;
use crate::fonts::Fonts;
use crate::fsread::FileTree;
use crate::git::GitStatus;
use crate::icons::Icon;
use crate::settings::Settings;
use crate::state::{AppState, ViewMode};

/// The window title and the title bar's brand.
pub const APP_TITLE: &str = "zetawork";
/// The quiet line next to the brand in the title bar.
pub const APP_SUBTITLE: &str = "工作台";
/// 关于 shows this.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The status bar's throughput column has no source in this slice, and says so.
pub const THROUGHPUT_HINT: &str =
	"模型吞吐：需要活动会话（未来数据源：zetacode stats /api/stats/overview）";

/// The 快捷键 section: label, hint, the keys this build actually binds.
pub const BINDINGS: [(&str, &str, &str); 5] = [
	("新建工作区", "在当前项目下新建工作区", "Ctrl N"),
	("拆分面板", "把当前面板左右分屏", "Ctrl \\"),
	("新建终端", "在当前面板新建一个终端", "Ctrl ⇧ T"),
	("打开设置", "打开本设置面板", "Ctrl ,"),
	("切换侧栏", "显示或隐藏左右侧栏", "Ctrl B"),
];

/// The 管理 cards, each naming what it would open.
pub const MANAGE_CARDS: [(&str, &str, Icon, &str); 4] = [
	(
		"管理项目与工作区",
		"重命名、移动或删除项目与工作区",
		Icon::FolderPlus,
		"管理项目：项目注册表尚未接入（未来数据源：zetawork 项目注册表）",
	),
	(
		"管理账户与授权",
		"登录方式、设备与访问令牌",
		Icon::Check,
		"管理账户：授权存储尚未接入（未来数据源：zetacode 授权存储）",
	),
	(
		"数据与存储",
		"缓存与日志的占用情况",
		Icon::Stage,
		"数据与存储：尚未接入（未来数据源：~/.zeta 缓存统计）",
	),
	(
		"扩展与 Agent",
		"已安装的 Agent 运行器与扩展",
		Icon::Term,
		"扩展与 Agent：尚未接入（未来数据源：zetacode 扩展注册表）",
	),
];

/// The shell: state plus the read-only readers and caches around it.
pub struct Shell {
	pub state: AppState,
	pub settings: Settings,
	/// What `settings` was when the style and fonts were last applied.
	applied: Settings,
	pub fonts: Fonts,
	/// The active workspace's tree; `tree_ws` is the workspace it belongs to.
	pub tree: FileTree,
	tree_ws: String,
	/// The active workspace's git status; `git_ws` is the workspace it belongs
	/// to, and `git_at` when it was read.
	pub git: Option<GitStatus>,
	git_ws: String,
	git_at: Option<Instant>,
	/// The git panel's (disabled) commit message box.
	pub git_message: String,
	/// The active workspace's `git diff HEAD`, read when a 差异比较器 page shows
	/// it; `diff_ws`/`diff_at` are the workspace and the time it was read.
	pub diff: Option<Result<String, String>>,
	diff_ws: String,
	diff_at: Option<Instant>,
	/// Rendered terminal cell grids.
	pub term_buffers: BufferCache,
	/// 模型吞吐 has no source; `None` renders as `—`.
	pub throughput: Option<String>,
	/// The `+` picker's rows for this host, read once when the picker opens.
	pub picker_entries: Vec<state::PickerEntry>,
	/// Where the open picker hangs from.
	picker_anchor: Option<egui::Rect>,
	/// The 用量 container's endpoint, read from `~/.zeta/serve.json`.
	pub stats: stats::StatsEndpoint,
	/// zetacode's own options (设置 target ②), read and written off the UI thread.
	pub remote: settings_ui::ZetacodeCache,
	/// The desktop app's provider catalog (设置 target ③).
	pub providers: settings_ui::ProviderCache,
	/// The `baseUrl` drafts the provider rows edit, keyed by provider id.
	pub drafts: Vec<(String, String)>,
	/// True when this shell is a real run: only then may it spawn `zetacode`.
	/// [`Shell::with_state`] — the headless constructors — leaves this `false`,
	/// so a test never runs a CLI.
	pub probe: bool,
	memory: Memory,
	resizing: chrome::ResizeState,
}

/// The status bar's memory column: this process's RSS, sampled at most every
/// two seconds (a per-frame `refresh_processes` would be pure waste).
struct Memory {
	system: sysinfo::System,
	pid: sysinfo::Pid,
	bytes: u64,
	sampled_at: Option<Instant>,
}

impl Memory {
	const INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

	fn new() -> Self {
		let mut system = sysinfo::System::new();
		let pid = sysinfo::Pid::from_u32(std::process::id());
		system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]));
		let bytes = system
			.process(pid)
			.map(|process| process.memory())
			.unwrap_or(0);
		Self { system, pid, bytes, sampled_at: Some(Instant::now()) }
	}

	fn sample_if_stale(&mut self) {
		let stale = self
			.sampled_at
			.is_none_or(|at| at.elapsed() >= Self::INTERVAL);
		if !stale {
			return;
		}
		self
			.system
			.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[self.pid]));
		self.bytes = self
			.system
			.process(self.pid)
			.map(|process| process.memory())
			.unwrap_or(0);
		self.sampled_at = Some(Instant::now());
	}
}

impl Shell {
	/// Build the shell: fonts, style, settings, seed data, first reads.
	pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
		let settings = settings::load();
		theme::apply(&cc.egui_ctx, &settings);
		let fonts = fonts::install(&cc.egui_ctx, &settings);
		let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
		let state = AppState::seeded(&cwd);
		let mut shell = Self {
			state,
			settings,
			applied: settings,
			fonts,
			tree: FileTree::load(std::path::Path::new(".")),
			tree_ws: String::new(),
			git: None,
			git_ws: String::new(),
			git_at: None,
			git_message: String::new(),
			diff: None,
			diff_ws: String::new(),
			diff_at: None,
			term_buffers: BufferCache::default(),
			throughput: None,
			picker_entries: Vec::new(),
			picker_anchor: None,
			stats: crate::stats::discover(),
			remote: settings_ui::ZetacodeCache::default(),
			providers: settings_ui::ProviderCache::default(),
			drafts: Vec::new(),
			probe: true,
			memory: Memory::new(),
			resizing: chrome::ResizeState::default(),
		};
		shell.sync_readers();
		// One read up front so the status bar's ↑↓ / 更改 columns are real
		// from the first frame instead of `—`.
		shell.refresh_git();
		shell
	}

	/// A shell over an explicit state (tests, and the headless checks).
	pub fn with_state(state: AppState, settings: Settings) -> Self {
		Self {
			state,
			settings,
			applied: settings,
			fonts: Fonts::default(),
			tree: FileTree::load(std::path::Path::new(".")),
			tree_ws: String::new(),
			git: None,
			git_ws: String::new(),
			git_at: None,
			git_message: String::new(),
			diff: None,
			diff_ws: String::new(),
			diff_at: None,
			term_buffers: BufferCache::default(),
			throughput: None,
			picker_entries: Vec::new(),
			picker_anchor: None,
			stats: crate::stats::discover(),
			remote: settings_ui::ZetacodeCache::default(),
			providers: settings_ui::ProviderCache::default(),
			drafts: Vec::new(),
			probe: false,
			memory: Memory::new(),
			resizing: chrome::ResizeState::default(),
		}
	}

	// ── the read-only readers ──────────────────────────────────────────

	/// Point the file tree and the git status at the active workspace.
	fn sync_readers(&mut self) {
		let (ws_id, path) = match self.state.active_workspace() {
			Some(workspace) => (workspace.id.clone(), PathBuf::from(&workspace.path)),
			None => (String::new(), PathBuf::new()),
		};
		if ws_id != self.tree_ws {
			self.tree = FileTree::load(&path);
			self.tree_ws = ws_id.clone();
		}
		if ws_id != self.git_ws {
			self.git = None;
			self.git_at = None;
			self.git_ws = ws_id;
		}
	}

	/// Re-read the active workspace's directory (one level).
	pub fn reload_tree(&mut self) {
		let path = self
			.state
			.active_workspace()
			.map(|workspace| PathBuf::from(&workspace.path))
			.unwrap_or_default();
		self.tree = FileTree::load(&path);
		self.tree_ws = self
			.state
			.active_workspace()
			.map(|w| w.id.clone())
			.unwrap_or_default();
	}

	/// A click on a tree row: expand or collapse that directory.
	pub fn tree_click(&mut self, rel: &[usize]) {
		self.tree.toggle(rel);
	}

	/// Read the active workspace's git status (read-only `git` calls).
	pub fn refresh_git(&mut self) {
		let Some(workspace) = self.state.active_workspace() else {
			self.git = None;
			return;
		};
		let path = PathBuf::from(&workspace.path);
		self.git = Some(git::read_status(&path, 8));
		self.git_ws = workspace.id.clone();
		self.git_at = Some(Instant::now());
	}

	/// The git status, read on demand when the git panel is looking at it.
	pub fn git_for_active(&mut self) -> Option<&GitStatus> {
		let ws_id = self
			.state
			.active_workspace()
			.map(|w| w.id.clone())
			.unwrap_or_default();
		let stale = self.git_ws != ws_id
			|| self
				.git_at
				.is_none_or(|at| at.elapsed() >= std::time::Duration::from_secs(15));
		if stale {
			self.refresh_git();
		}
		self.git.as_ref()
	}

	/// The status bar's memory column.
	pub fn memory_label(&self) -> String {
		let bytes = self.memory.bytes;
		if bytes >= 1024 * 1024 * 1024 {
			format!("{:.2} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
		} else if bytes >= 1024 * 1024 {
			format!("{} MB", bytes / (1024 * 1024))
		} else {
			format!("{} KB", bytes / 1024)
		}
	}

	// ── the ＋ picker, the diff page, the 用量 container ─────────────────

	/// Open the `+` picker above the button that asked for it.
	///
	/// The rows are read here, once, so a PATH scan never happens per frame.
	pub fn open_picker(&mut self, target: state::PickerTarget, anchor: egui::Rect) {
		self.picker_entries = state::PickerEntry::all();
		self.picker_anchor = Some(anchor);
		self.state.open_picker(target);
	}

	/// (Re)read the active workspace's `git diff HEAD` when it is stale or
	/// belongs to another workspace. The read is TTL'd, so the diff page can
	/// call this every frame.
	pub fn ensure_diff(&mut self) {
		const TTL: std::time::Duration = std::time::Duration::from_secs(5);
		let ws_id = self
			.state
			.active_workspace()
			.map(|workspace| workspace.id.clone())
			.unwrap_or_default();
		let stale = self.diff_ws != ws_id
			|| self.diff.is_none()
			|| self.diff_at.is_none_or(|at| at.elapsed() >= TTL);
		if !stale {
			return;
		}
		let path = PathBuf::from(
			self
				.state
				.active_workspace()
				.map(|workspace| workspace.path.clone())
				.unwrap_or_default(),
		);
		self.diff = Some(git::read_diff(&path, None));
		self.diff_ws = ws_id;
		self.diff_at = Some(Instant::now());
	}

	/// The diff the 差异比较器 page draws: `None` with no workspace open, `Err`
	/// when `git` refused (with the command's own message).
	pub fn diff_result(&self) -> Option<Result<&str, &str>> {
		match self.diff.as_ref()? {
			Ok(text) => Some(Ok(text.as_str())),
			Err(error) => Some(Err(error.as_str())),
		}
	}

	/// Re-read the stats endpoint published by `zetacode serve`.
	pub fn refresh_stats(&mut self) {
		self.stats = crate::stats::discover();
	}

	/// The editable draft of one provider row, seeded from the file the first
	/// time the row is drawn.
	pub fn draft(&mut self, id: &str, seed: &str) -> &mut String {
		let index = match self.drafts.iter().position(|(key, _)| key == id) {
			Some(index) => index,
			None => {
				self.drafts.push((id.to_owned(), seed.to_owned()));
				self.drafts.len() - 1
			},
		};
		&mut self.drafts[index].1
	}

	/// Drop every draft, so the rows re-seed from the file that was just read.
	pub fn clear_drafts(&mut self) {
		self.drafts.clear();
	}

	// ── settings plumbing ──────────────────────────────────────────────

	/// Nothing to do until `update` notices the settings moved.
	pub fn settings_changed(&self) -> bool {
		self.settings != self.applied
	}

	/// Apply style + fonts, and persist. Called from `update` whenever a
	/// control changed a value.
	pub fn apply_settings(&mut self, ctx: &Context) {
		let fonts_changed = self.settings.mono_font != self.applied.mono_font;
		theme::apply(ctx, &self.settings);
		if fonts_changed {
			self.fonts = fonts::install(ctx, &self.settings);
		}
		if let Err(error) = settings::save(self.settings) {
			self
				.state
				.show(crate::state::Notice(format!("设置保存失败：{error}")));
		}
		self.applied = self.settings;
	}

	// ── keyboard ───────────────────────────────────────────────────────

	/// The spec's shortcuts, with ⌘ mapped to Ctrl on this host, plus the TUI
	/// view's own keys.
	pub fn handle_keys(&mut self, ctx: &Context) {
		if ctx.wants_keyboard_input() {
			return;
		}
		let (escape, ctrl) = ctx.input(|i| {
			(
				i.key_pressed(egui::Key::Escape),
				(
					i.modifiers.command,
					i.key_pressed(egui::Key::N),
					i.key_pressed(egui::Key::Backslash),
					i.key_pressed(egui::Key::T),
					i.key_pressed(egui::Key::Comma),
					i.key_pressed(egui::Key::B),
					i.modifiers.shift,
					i.key_pressed(egui::Key::S),
				),
			)
		});
		let (command, key_n, key_backslash, key_t, key_comma, key_b, shift, key_s) = ctrl;
		if escape {
			self.state.escape();
		}
		if self.state.view == ViewMode::Tui {
			let (tab, quit) =
				ctx.input(|i| (i.key_pressed(egui::Key::Tab), i.key_pressed(egui::Key::Q)));
			if tab {
				self.cycle_tui_focus();
			}
			if quit {
				self.state.set_view(ViewMode::Gui);
			}
		}
		if !command {
			return;
		}
		if key_comma {
			self.state.open_settings();
		}
		if key_s {
			// 保存: every dirty 编辑器 buffer in the open workspace, to disk.
			let notice = self.state.save_dirty_editors();
			self.state.show(notice);
		}
		if key_b {
			self.state.toggle_left();
		}
		if key_n {
			let project = self.state.active_project.clone();
			if let Some(id) = project {
				let notice = self.state.new_workspace(&id);
				self.state.show(notice);
				self.sync_readers();
			}
		}
		if key_backslash {
			let notice = self.state.new_pane();
			self.state.show(notice);
		}
		if key_t {
			let notice = if shift {
				self.state.new_term()
			} else {
				self.state.focus_mode()
			};
			self.state.show(notice);
		}
	}

	/// Tab in the TUI view: move the focused terminal box along.
	pub fn cycle_tui_focus(&mut self) {
		let panes: Vec<String> = self
			.state
			.visible_panes()
			.iter()
			.map(|p| p.id.clone())
			.collect();
		if panes.is_empty() {
			return;
		}
		let next = match self.state.tui_pane.as_ref() {
			None => panes.first().cloned(),
			Some(current) => {
				let index = panes
					.iter()
					.position(|id| id == current)
					.map(|i| i + 1)
					.unwrap_or(0);
				panes.get(index).cloned().or_else(|| panes.first().cloned())
			},
		};
		self.state.tui_pane = next;
	}
}

impl eframe::App for Shell {
	fn update(&mut self, ctx: &Context, _frame: &mut eframe::Frame) {
		self.tick(ctx);
		self.draw(ctx);
	}
}

impl Shell {
	/// The per-frame work that is not drawing: settings, the memory sample,
	/// keys, the read-only readers.
	pub fn tick(&mut self, ctx: &Context) {
		if self.settings_changed() {
			self.apply_settings(ctx);
		}
		self.memory.sample_if_stale();
		self.handle_keys(ctx);
		self.sync_readers();
		// 设置 → 终端 的 默认 Shell: the shell a new 终端 page records.
		self.state.default_shell = self.settings.shell.kind();
		// A finished zetacode job (读取 / 写入) reports itself once.
		if let Some(notice) = self.remote.poll() {
			self.state.show(state::Notice(notice));
		}
		// git is read when the git panel is looking at it, and once after a
		// workspace change so the status bar and the file tree's markers are
		// real too. Six `git` invocations per refresh are not worth spending
		// on a panel nobody is looking at, so it is not polled.
		let git_tab =
			!self.state.right_collapsed && self.state.right_tab == crate::state::RightTab::Git;
		if git_tab || self.git.is_none() {
			let _ = self.git_for_active();
		}
		// Same rule for the diff: read it only while a 差异比较器 page can see it.
		let diff_page = self.state.visible_panes().iter().any(|pane| {
			pane
				.active_tab()
				.is_some_and(|tab| tab.kind == state::SessionKind::Diff)
		});
		if diff_page {
			self.ensure_diff();
		}
	}

	/// The whole frame: title bar, status bar, both columns, the centre, the
	/// settings modal and the toast.
	///
	/// Split out of [`eframe::App::update`] so the tests can render exactly the
	/// same frame headlessly — there is no window in the test harness.
	pub fn draw(&mut self, ctx: &Context) {
		let no_margin = egui::Frame::new().inner_margin(egui::Margin::ZERO);
		// The window chrome (title bar with the controls and the view switch)
		// stays in both views; the workbench's own GUI widgets — columns,
		// status bar — belong to the GUI view only, so TUI mode renders the
		// TUI over the whole body.
		let gui = self.state.view == ViewMode::Gui;
		egui::TopBottomPanel::top("zetawork-titlebar")
			.exact_height(theme::TITLE_BAR_H)
			.frame(no_margin)
			.show(ctx, |ui| chrome::title_bar(ui, self));
		if gui {
			let height = if self.state.statusbar_visible() {
				theme::STATUSBAR_H
			} else {
				statusbar::STRIP_H
			};
			egui::TopBottomPanel::bottom("zetawork-statusbar")
				.exact_height(height)
				.frame(no_margin)
				.show(ctx, |ui| {
					if self.state.statusbar_visible() {
						statusbar::status_bar(ui, self);
					} else {
						statusbar::strip(ui, self);
					}
				});
		}

		if gui && self.state.left_collapsed {
			egui::SidePanel::left("zetawork-rail-left")
				.exact_width(left::RAIL_WIDTH)
				.resizable(false)
				.frame(no_margin)
				.show(ctx, |ui| left::left_rail(ui, self));
		} else if gui {
			egui::SidePanel::left("zetawork-side-left")
				.exact_width(left::WIDTH)
				.resizable(false)
				.frame(no_margin)
				.show(ctx, |ui| left::left_column(ui, self));
		}
		if gui && self.state.right_collapsed {
			egui::SidePanel::right("zetawork-rail-right")
				.exact_width(right::RAIL_WIDTH)
				.resizable(false)
				.frame(no_margin)
				.show(ctx, |ui| right::right_rail(ui, self));
		} else if gui {
			egui::SidePanel::right("zetawork-side-right")
				.exact_width(right::WIDTH)
				.resizable(false)
				.frame(no_margin)
				.show(ctx, |ui| right::right_column(ui, self));
		}
		egui::CentralPanel::default()
			.frame(no_margin)
			.show(ctx, |ui| match self.state.view {
				ViewMode::Gui => center::workspace(ui, self),
				ViewMode::Tui => tui_view::view(ui, self),
			});

		settings_ui::modal(ctx, self);
		usage::container(ctx, self);
		picker::popup(ctx, self);
		if let Some(text) = self.state.live_toast() {
			let text = text.to_owned();
			chrome::toast(ctx, &text);
			ctx.request_repaint_after(crate::state::TOAST_TTL);
		}
		chrome::resize_borders(ctx, &mut self.resizing, self.state.modal_open());
	}
}

/// Run the shell. The window is frameless: [`chrome`] draws the title bar and
/// handles the resize border.
pub fn run() -> eframe::Result<()> {
	let options = eframe::NativeOptions {
		viewport: egui::ViewportBuilder::default()
			.with_title(APP_TITLE)
			.with_decorations(false)
			.with_inner_size([1440.0, 900.0])
			.with_min_inner_size([900.0, 560.0])
			.with_resizable(true),
		..Default::default()
	};
	eframe::run_native(APP_TITLE, options, Box::new(|cc| Ok(Box::new(Shell::new(cc)))))
}

/// Close the window from anywhere (used by the tests to prove the command is
/// wired without opening one).
pub fn close_command() -> ViewportCommand {
	ViewportCommand::Close
}
