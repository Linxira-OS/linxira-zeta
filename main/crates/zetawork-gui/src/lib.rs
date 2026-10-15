//! zetawork GUI feasibility spike: an egui/eframe shell for the workbench.
//!
//! SPIKE ONLY — nothing here is meant to merge; the point is to answer four
//! questions with running code (full evidence in the PR body):
//!
//! 1. **Multi-panel dock.** The centre area is an `egui_dock` [`DockState`]
//!    that opens as two side-by-side leaves with two sub-tabs each (termide /
//!    CLI conversation, web sub-page / diff), so splits, resizes and tab
//!    drag-and-drop all work. The left rail, right context column and bottom
//!    status bar are plain egui panels: the rail is a fixed button column and
//!    the right column is a single pane by design (design §2), and neither
//!    should be draggable away the way a dock tab can be.
//! 2. **ratatui blit.** [`blit`] renders with a real `ratatui::Terminal` over a
//!    terminal-free [`blit::BufferBackend`] and paints the resulting `Buffer`
//!    as a cell grid, wide CJK graphemes included.
//! 3. **WebView2 child window.** [`embed`] hosts a real WebView2 (via `wry`)
//!    as a child of the eframe window, positioned from the dock tab's rect and
//!    resized with the panel.
//! 4. **CJK IME.** The conversation composer is an egui `TextEdit`; every
//!    `Event::Ime` the app sees is journalled (panel + optional log file) so
//!    the OS-IME → winit → egui → widget chain leaves a trace.
//!
//! Metrics (cold start, idle RSS, screenshots) live in the PR body; the numbers
//! are produced by `zetawork-gui --bench <secs>` and by `tests/shell.rs`.

pub mod blit;
pub mod embed;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use egui::{
	Align2, Color32, FontData, FontDefinitions, FontFamily, FontId, Rect, RichText, Sense, Stroke,
	TextEdit, Ui, ViewportCommand, vec2,
};
use egui_dock::{DockArea, DockState, NodeIndex, Style as DockStyle, TabViewer};
use serde::{Deserialize, Serialize};

/// Window title / product line shown in the status bar.
pub const APP_TITLE: &str = "zetawork GUI spike";

/// The sub-pages a dock leaf can hold.
///
/// `Serialize`/`Deserialize` are what make [`DockState`] persistence work:
/// `egui_dock`'s `serde` feature derives the impls for the tree, so the tab
/// payload is the only type the app has to make (de)serializable.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Tab {
	/// termide-style editor pane, drawn by blitting a ratatui buffer.
	Termide,
	/// CLI conversation: the composer is where the IME work happens.
	Conversation,
	/// `chrome=none` web sub-page hosted in a WebView2 child window.
	WebEmbed,
	/// A file diff pane (static mock).
	Diff,
}

impl Tab {
	pub fn title(self) -> &'static str {
		match self {
			Self::Termide => "termide · 编辑器",
			Self::Conversation => "对话 · CLI",
			Self::WebEmbed => "对话 · Web 子页",
			Self::Diff => "文件 diff",
		}
	}
}

/// The two centre leaves the dock opens with (design: split panels, each with
/// its own sub-page tabs).
pub fn default_dock() -> DockState<Tab> {
	let mut dock = DockState::new(vec![Tab::Termide, Tab::Conversation]);
	dock
		.main_surface_mut()
		.split_right(NodeIndex::root(), 0.5, vec![Tab::WebEmbed, Tab::Diff]);
	dock
}

/// Serialize the whole dock layout (split topology, split sizes, tab order,
/// active tab, floating windows) to JSON.
///
/// `egui_dock`'s `serde` feature derives `Serialize`/`Deserialize` for
/// `DockState`/`Surface`/`Tree`/`Node`; the only app-side requirement is a
/// (de)serializable tab payload ([`Tab`]). This is the exact API a
/// `~/.zeta/workbench.toml` layout section would use — see the spike report
/// for the migration caveat (no version field; a missing field is a hard
/// error, so callers must fall back to the default layout).
pub fn dock_to_json(dock: &DockState<Tab>) -> serde_json::Result<String> {
	serde_json::to_string_pretty(dock)
}

/// Rebuild a dock from [`dock_to_json`] output.
pub fn dock_from_json(json: &str) -> serde_json::Result<DockState<Tab>> {
	serde_json::from_str(json)
}

/// Load-or-default: the shape the product would use (design §2 — a corrupt
/// layout must never block startup).
pub fn dock_from_json_or_default(json: &str) -> DockState<Tab> {
	dock_from_json(json).unwrap_or_else(|_| default_dock())
}

/// One big tab in the top bar (the "大标签页" of the design).
#[derive(Clone, Debug)]
pub struct WorkspaceTab {
	pub name: String,
	pub branch: String,
}

/// One builtin button of the left rail (`where = "rail"`, design §2).
#[derive(Clone, Debug)]
pub struct RailSlot {
	pub icon: &'static str,
	pub label: &'static str,
	pub visible: bool,
}

#[derive(Clone, Debug)]
pub struct TreeBranch {
	pub name: String,
	pub sessions: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct TreeProject {
	pub name: String,
	pub branches: Vec<TreeBranch>,
}

/// One `categories[]` entry of the context report (design §6.5).
#[derive(Clone, Debug)]
pub struct ContextCategory {
	pub label: &'static str,
	pub tokens: u64,
	pub color: Color32,
}

/// Right-column model, shaped after `GET /api/agent/<id>/context`.
#[derive(Clone, Debug)]
pub struct ContextModel {
	pub project: String,
	pub branch: String,
	pub session: String,
	pub window: u64,
	pub used: u64,
	pub auto_compact_buffer: u64,
	pub percent: f32,
	pub categories: Vec<ContextCategory>,
	pub tools: Vec<(String, u64)>,
	pub cost_usd: f64,
	pub calls: u64,
	pub running: bool,
}

#[derive(Clone, Debug)]
pub struct SubagentRow {
	pub name: String,
	pub status: &'static str,
	pub tokens: u64,
	pub cost_usd: f64,
	pub live: bool,
}

/// One observed `Event::Ime` (the CJK input trail).
#[derive(Clone, Debug)]
pub struct ImeEntry {
	pub at_ms: f64,
	pub kind: &'static str,
	pub text: String,
}

/// Everything the UI reads/writes that is not the dock or the webview host.
pub struct UiState {
	pub workspaces: Vec<WorkspaceTab>,
	pub workspace: usize,
	pub rail: Vec<RailSlot>,
	pub rail_active: usize,
	pub tree: Vec<TreeProject>,
	pub tree_selected: Option<String>,
	pub grid_font_size: f32,
	pub grid_rect: Option<Rect>,
	pub blit_report: String,
	pub composer: String,
	pub composer_focus_requested: bool,
	pub ime: Vec<ImeEntry>,
	pub ime_log_path: Option<PathBuf>,
	pub context: ContextModel,
	pub subagents: Vec<SubagentRow>,
	pub embed_rect: Option<Rect>,
	pub embed_drawn: bool,
	pub embed_px: Option<embed::PixelRect>,
	pub embed_status: String,
	pub embed_probe: Option<String>,
	pub embed_messages: Vec<String>,
	pub font_report: String,
	pub font_probe: Option<blit::FontProbe>,
	pub startup_ms: Option<f64>,
	pub frames: u64,
	pub probe_requested: bool,
}

impl UiState {
	pub fn new() -> Self {
		Self {
			workspaces: vec![
				WorkspaceTab { name: "zeta 工作台".to_owned(), branch: "main".to_owned() },
				WorkspaceTab {
					name: "zetawork-gui spike".to_owned(),
					branch: "spike/egui-shell".to_owned(),
				},
			],
			workspace: 0,
			rail: vec![
				RailSlot { icon: "⌕", label: "搜索", visible: true },
				RailSlot { icon: "☰", label: "任务", visible: true },
				RailSlot { icon: "⚙", label: "自动化", visible: true },
				RailSlot { icon: "▤", label: "手机端", visible: true },
				RailSlot { icon: "◔", label: "用量追踪", visible: false },
				RailSlot { icon: "▣", label: "上下文", visible: false },
			],
			rail_active: 1,
			tree: demo_tree(),
			tree_selected: Some("2f19 · 上下文面板".to_owned()),
			grid_font_size: 14.0,
			grid_rect: None,
			blit_report: String::new(),
			composer: String::new(),
			composer_focus_requested: false,
			ime: Vec::new(),
			ime_log_path: None,
			context: demo_context(),
			subagents: demo_subagents(),
			embed_rect: None,
			embed_drawn: false,
			embed_px: None,
			embed_status: "未附加（headless）".to_owned(),
			embed_probe: None,
			embed_messages: Vec::new(),
			font_report: String::new(),
			font_probe: None,
			startup_ms: None,
			frames: 0,
			probe_requested: false,
		}
	}

	/// Record one IME event in the panel and, when asked, in a log file so a
	/// human typing 中文 during a manual run leaves durable evidence.
	pub fn push_ime(&mut self, at_ms: f64, kind: &'static str, text: &str) {
		self
			.ime
			.push(ImeEntry { at_ms, kind, text: text.to_owned() });
		if let Some(path) = &self.ime_log_path {
			let line = format!("{at_ms:.1}ms {kind} {}", text.replace('\n', "\\n"));
			if let Ok(mut file) = std::fs::OpenOptions::new()
				.create(true)
				.append(true)
				.open(path)
			{
				use std::io::Write as _;
				let _ = writeln!(file, "{line}");
			}
		}
	}

	pub fn workspace(&self) -> &WorkspaceTab {
		&self.workspaces[self.workspace.min(self.workspaces.len().saturating_sub(1))]
	}
}

impl Default for UiState {
	fn default() -> Self {
		Self::new()
	}
}

fn demo_tree() -> Vec<TreeProject> {
	vec![
		TreeProject {
			name: "zeta".to_owned(),
			branches: vec![
				TreeBranch {
					name: "main".to_owned(),
					sessions: vec!["8c4a · dock 布局".to_owned(), "b731 · WebView2 探针".to_owned()],
				},
				TreeBranch {
					name: "spike/egui-shell".to_owned(),
					sessions: vec!["2f19 · 上下文面板".to_owned(), "44de · ratatui blit".to_owned()],
				},
			],
		},
		TreeProject {
			name: "termide".to_owned(),
			branches: vec![TreeBranch {
				name: "main".to_owned(),
				sessions: vec!["0a17 · 面板终端".to_owned()],
			}],
		},
	]
}

/// Numbers shaped exactly like the `context` report fields (`window`/`used`/
/// `percent`/`categories[].tokens`), so the panel is a rendering exercise, not
/// an invented data source.
fn demo_context() -> ContextModel {
	let categories = vec![
		ContextCategory {
			label: "系统提示", tokens: 2_400, color: Color32::from_rgb(94, 129, 172)
		},
		ContextCategory {
			label: "系统上下文",
			tokens: 1_100,
			color: Color32::from_rgb(129, 161, 193),
		},
		ContextCategory {
			label: "工具定义(合计)",
			tokens: 8_900,
			color: Color32::from_rgb(136, 192, 208),
		},
		ContextCategory { label: "技能", tokens: 700, color: Color32::from_rgb(143, 188, 187) },
		ContextCategory {
			label: "会话消息",
			tokens: 12_300,
			color: Color32::from_rgb(163, 190, 140),
		},
	];
	let used: u64 = categories.iter().map(|c| c.tokens).sum();
	let window = 200_000;
	ContextModel {
		project: "C:/Users/ETPau/Documents/GITHUB/zeta".to_owned(),
		branch: "spike/egui-shell".to_owned(),
		session: "2f19".to_owned(),
		window,
		used,
		auto_compact_buffer: 40_000,
		percent: used as f32 / window as f32 * 100.0,
		categories,
		tools: vec![("Bash".to_owned(), 4_100), ("Read".to_owned(), 2_600), ("Edit".to_owned(), 900)],
		cost_usd: 0.0431,
		calls: 37,
		running: true,
	}
}

fn demo_subagents() -> Vec<SubagentRow> {
	vec![
		SubagentRow {
			name: "ZetaworkP0Rail2".to_owned(),
			status: "running",
			tokens: 41_200,
			cost_usd: 0.011,
			live: true,
		},
		SubagentRow {
			name: "spike-blit".to_owned(),
			status: "completed",
			tokens: 18_400,
			cost_usd: 0.004,
			live: false,
		},
		SubagentRow {
			name: "desktop-direction".to_owned(),
			status: "parked",
			tokens: 6_100,
			cost_usd: 0.002,
			live: false,
		},
	]
}

/// Runtime options (parsed in `main.rs`, overridable by tests).
#[derive(Clone, Debug)]
pub struct RunOptions {
	/// Auto-exit after this many seconds, printing bench lines to stdout.
	pub bench_secs: Option<f32>,
	/// Append every IME event to this file (manual CJK input evidence).
	pub log_ime: Option<PathBuf>,
	/// Write layout screenshots (live GL framebuffer) into this directory.
	pub capture: Option<PathBuf>,
	/// Attach the WebView2 host (native runs only).
	pub attach_embed: bool,
	pub width: f32,
	pub height: f32,
	/// Process start, for the cold-start number.
	pub process_start: Instant,
}

impl RunOptions {
	pub fn headless() -> Self {
		Self {
			bench_secs: None,
			log_ime: None,
			capture: None,
			attach_embed: false,
			width: 1440.0,
			height: 900.0,
			process_start: Instant::now(),
		}
	}

	pub fn from_args<I: Iterator<Item = String>>(args: I) -> Self {
		let mut opts = Self { attach_embed: true, ..Self::headless() };
		let mut args = args.peekable();
		while let Some(arg) = args.next() {
			match arg.as_str() {
				"--bench" => opts.bench_secs = args.next().and_then(|v| v.parse().ok()),
				"--log-ime" => opts.log_ime = args.next().map(PathBuf::from),
				"--capture" => opts.capture = args.next().map(PathBuf::from),
				"--no-embed" => opts.attach_embed = false,
				"--size" => {
					if let Some((w, h)) = args.next().and_then(|v| parse_size(&v)) {
						opts.width = w;
						opts.height = h;
					}
				},
				_ => {},
			}
		}
		if opts.capture.is_some() && opts.bench_secs.is_none() {
			// Screenshots are only meaningful on an unattended run.
			opts.bench_secs = Some(6.0);
		}
		opts
	}
}

fn parse_size(value: &str) -> Option<(f32, f32)> {
	let (w, h) = value.split_once('x')?;
	Some((w.trim().parse().ok()?, h.trim().parse().ok()?))
}

/// How far the bench script has come.
#[derive(Default, Clone, Copy, Debug)]
struct BenchProgress {
	probed: bool,
	resized: bool,
	probed_after_resize: bool,
	reported: bool,
}

/// One `--capture` step: stage a page (focus / prefill), then save the next
/// frame's GL framebuffer as a PNG.
#[derive(Clone, Debug)]
struct Shot {
	at: f32,
	name: &'static str,
	focus: Option<Tab>,
	prefill: Option<&'static str>,
	staged: bool,
	captured: bool,
}

/// The three screenshots the spike reports: whole shell + blit pane, the IME
/// composer with CJK text, and the web sub-page panel.
fn capture_plan() -> Vec<Shot> {
	let shot = |at: f32, name: &'static str, focus: Option<Tab>, prefill: Option<&'static str>| {
		Shot { at, name, focus, prefill, staged: false, captured: false }
	};
	vec![
		shot(0.9, "01-shell-overview.png", Some(Tab::Termide), None),
		shot(
			1.7,
			"02-ime-composer.png",
			Some(Tab::Conversation),
			Some("中文输入测试：宽字符占两格 ✓"),
		),
		shot(2.5, "03-web-embed-panel.png", Some(Tab::WebEmbed), None),
	]
}

/// Screenshot the live GL framebuffer instead of standing up a GPU test rig
/// (`egui_kittest`'s wgpu renderer cannot compile for `x86_64-pc-windows-gnu`:
/// wgpu-hal's D3D12 backend needs `windows` features the GNU target lacks).
///
/// The read has to happen *inside* the paint pass: `eframe` runs `update` first
/// and paints afterwards, so a read from `update` sees the back buffer between
/// the swap and the next paint (all-black in practice). `egui_glow::CallbackFn`
/// gives us the glow context after this frame's shapes are drawn and before the
/// buffer swap.
fn push_capture_callback(ui: &egui::Ui, name: String, dir: PathBuf) {
	let callback = eframe::egui_glow::CallbackFn::new(move |info, painter| {
		let size = info.screen_size_px;
		match gl_framebuffer_rgba(painter.gl(), size) {
			Some((width, height, rgba)) => {
				if let Err(err) = std::fs::create_dir_all(&dir) {
					println!("[shots] mkdir {} failed: {err}", dir.display());
				}
				let path = dir.join(&name);
				match write_png(&path, width, height, &rgba) {
					Ok(()) => println!("[shots] {} ({width}x{height})", path.display()),
					Err(err) => println!("[shots] {} failed: {err}", path.display()),
				}
			},
			None => println!("[shots] {name} skipped: no GL context"),
		}
	});
	ui.painter()
		.add(egui::PaintCallback { rect: ui.max_rect(), callback: std::sync::Arc::new(callback) });
}

/// Read `size` RGBA pixels from the current framebuffer, top-down (GL rows are
/// bottom-up).
fn gl_framebuffer_rgba(gl: &eframe::glow::Context, size: [u32; 2]) -> Option<(u32, u32, Vec<u8>)> {
	use eframe::glow::HasContext as _;
	let [width, height] = size;
	if width == 0 || height == 0 {
		return None;
	}
	let mut pixels = vec![0u8; width as usize * height as usize * 4];
	unsafe {
		gl.read_pixels(
			0,
			0,
			width as i32,
			height as i32,
			eframe::glow::RGBA,
			eframe::glow::UNSIGNED_BYTE,
			eframe::glow::PixelPackData::Slice(Some(&mut pixels)),
		);
	}
	let stride = width as usize * 4;
	let mut flipped = vec![0u8; pixels.len()];
	for row in 0..height as usize {
		let source = (height as usize - 1 - row) * stride;
		flipped[row * stride..(row + 1) * stride].copy_from_slice(&pixels[source..source + stride]);
	}
	Some((width, height, flipped))
}

fn write_png(path: &std::path::Path, width: u32, height: u32, rgba: &[u8]) -> Result<(), String> {
	let file = std::fs::File::create(path).map_err(|err| err.to_string())?;
	let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), width, height);
	encoder.set_color(png::ColorType::Rgba);
	encoder.set_depth(png::BitDepth::Eight);
	let mut writer = encoder.write_header().map_err(|err| err.to_string())?;
	writer
		.write_image_data(rgba)
		.map_err(|err| err.to_string())?;
	writer.finish().map_err(|err| err.to_string())?;
	Ok(())
}

/// The application: dock state, UI state and (natively) the webview host.
pub struct ShellApp {
	pub dock: DockState<Tab>,
	pub state: UiState,
	pub embed: Option<embed::EmbedHost>,
	/// Loopback server that serves the `chrome=none` page to the webview.
	pub embed_server: Option<embed::EmbedServer>,
	pub opts: RunOptions,
	fonts_installed: bool,
	theme_sent: bool,
	bench: BenchProgress,
	shots: Vec<Shot>,
	/// Set by the bench/script tick, consumed inside the paint pass so the
	/// screenshot has the *current* frame in the framebuffer. A queue, not a
	/// slot: an unfocused debug build paints only a few frames per second, so
	/// several shots can be due before the next paint.
	capture_request: Vec<(String, PathBuf)>,
}

impl ShellApp {
	/// UI-only instance: no window, no webview. Drives the headless tests.
	pub fn new_headless() -> Self {
		let state = UiState::new();
		Self {
			dock: default_dock(),
			state,
			embed: None,
			embed_server: None,
			opts: RunOptions::headless(),
			fonts_installed: false,
			theme_sent: false,
			bench: BenchProgress::default(),
			shots: Vec::new(),
			capture_request: Vec::new(),
		}
	}

	/// Native instance: installs fonts and (on Windows) attaches the WebView2
	/// child window to the eframe window.
	pub fn new_native(cc: &eframe::CreationContext<'_>, opts: RunOptions) -> Self {
		let mut app = Self { opts, ..Self::new_headless() };
		app.state.ime_log_path = app.opts.log_ime.clone();
		if app.opts.capture.is_some() {
			app.shots = capture_plan();
		}
		if app.opts.attach_embed {
			match embed::EmbedServer::start() {
				Ok(server) => {
					let url = server.url("session", &app.state.context.session);
					let placeholder = embed::PixelRect { x: 0, y: 0, width: 4, height: 4 };
					match embed::EmbedHost::attach(cc, url.clone(), placeholder) {
						Ok(host) => {
							app.state.embed_status =
								format!("已附加 WebView2（初始化 {:.0}ms）· {}", host.attach_ms, url);
							app.embed = Some(host);
						},
						Err(err) => app.state.embed_status = format!("附加失败：{err}"),
					}
					app.embed_server = Some(server);
				},
				Err(err) => app.state.embed_status = format!("起本地 embed 服务失败：{err}"),
			}
		}
		app
	}

	/// Focus a dock tab by its page (used by tests and the big tab bar).
	pub fn focus_tab(&mut self, tab: Tab) -> bool {
		let surface = self.dock.main_surface_mut();
		match surface.find_tab(&tab) {
			Some((node, tab_index)) => {
				surface.set_active_tab(node, tab_index);
				true
			},
			None => false,
		}
	}

	/// Ask the page for its geometry (page → shell `zeta-probe` reply).
	pub fn probe_webview(&mut self) {
		let Some(host) = self.embed.as_ref() else {
			return;
		};
		if let Err(err) = host.probe() {
			self.state.embed_status = format!("probe 失败：{err}");
		}
	}

	/// One frame: the whole shell.
	pub fn draw(&mut self, ctx: &egui::Context) {
		if !self.fonts_installed {
			self.state.font_report = install_grid_fonts(ctx);
			self.fonts_installed = true;
		}
		self.state.frames += 1;
		if self.state.frames == 2 {
			self.state.font_probe = Some(blit::probe_grid_font(ctx, self.state.grid_font_size));
		}
		if self.state.startup_ms.is_none() {
			let ms = self.opts.process_start.elapsed().as_secs_f64() * 1000.0;
			self.state.startup_ms = Some(ms);
			println!(
				"[bench] first_frame_ms={ms:.1} ppp={:.2} viewport={:.0}x{:.0}",
				ctx.pixels_per_point(),
				ctx.content_rect().width(),
				ctx.content_rect().height()
			);
		}
		self.collect_ime(ctx);
		self.state.embed_drawn = false;
		self.state.embed_rect = None;

		egui::TopBottomPanel::top("zw-big-tabs")
			.exact_height(34.0)
			.show(ctx, |ui| {
				big_tab_bar(ui, &mut self.state);
			});
		egui::TopBottomPanel::bottom("zw-status")
			.exact_height(24.0)
			.show(ctx, |ui| {
				status_bar(ui, &self.state, self.embed.as_ref());
			});
		egui::SidePanel::left("zw-rail")
			.exact_width(232.0)
			.resizable(false)
			.show(ctx, |ui| {
				rail_panel(ui, &mut self.state);
			});
		egui::SidePanel::right("zw-right")
			.default_width(324.0)
			.width_range(280.0..=460.0)
			.show(ctx, |ui| {
				context_panel(ui, &self.state);
			});
		egui::CentralPanel::default()
			.frame(egui::Frame::NONE)
			.show(ctx, |ui| {
				let mut viewer = Viewer { state: &mut self.state, embed: self.embed.as_ref() };
				DockArea::new(&mut self.dock)
					.style(DockStyle::from_egui(ctx.style().as_ref()))
					.show_inside(ui, &mut viewer);
				// One shot per paint pass: two callbacks in the same pass would
				// write the same framebuffer twice (and a debug build paints
				// only a couple of frames per second).
				if !self.capture_request.is_empty() {
					let (name, dir) = self.capture_request.remove(0);
					push_capture_callback(ui, name, dir);
				}
			});

		self.pump_embed();
		self.sync_embed_geometry(ctx);
		if std::mem::take(&mut self.state.probe_requested) {
			self.probe_webview();
		}
		self.tick_bench(ctx);
	}

	/// Journals every `Event::Ime` the frame contains.
	fn collect_ime(&mut self, ctx: &egui::Context) {
		let events = ctx.input(|input| input.events.clone());
		for event in events {
			let egui::Event::Ime(ime) = event else {
				continue;
			};
			let at = self.opts.process_start.elapsed().as_secs_f64() * 1000.0;
			match ime {
				egui::ImeEvent::Enabled => self.state.push_ime(at, "Enabled", ""),
				egui::ImeEvent::Disabled => self.state.push_ime(at, "Disabled", ""),
				egui::ImeEvent::Preedit(text) => self.state.push_ime(at, "Preedit", &text),
				egui::ImeEvent::Commit(text) => self.state.push_ime(at, "Commit", &text),
			}
		}
	}

	/// Pull page → shell messages out of the webview and answer the handshake.
	fn pump_embed(&mut self) {
		let Some(host) = self.embed.as_ref() else {
			return;
		};
		while let Some(message) = host.try_recv() {
			let kind = serde_json::from_str::<serde_json::Value>(&message)
				.ok()
				.and_then(|value| {
					value
						.get("type")
						.and_then(|t| t.as_str())
						.map(str::to_owned)
				})
				.unwrap_or_else(|| "<unparsed>".to_owned());
			if kind == "zeta-probe" {
				println!("[webview] probe {message}");
				self.state.embed_probe = Some(message.clone());
			} else {
				println!("[webview] page->shell {kind} {message}");
			}
			self
				.state
				.embed_messages
				.push(format!("{kind} ← {message}"));
			if self.state.embed_messages.len() > 12 {
				self.state.embed_messages.remove(0);
			}
		}
		if host.page_loaded() && !self.theme_sent {
			self.theme_sent = true;
			if let Err(err) = host.diagnose() {
				println!("[webview] diagnose failed: {err}");
			}
			let message = format!(
				r#"{{"type":"zeta-theme","theme":"dark","session":"{}"}}"#,
				self.state.context.session
			);
			match host.send_to_page(&message) {
				Ok(()) => {
					self
						.state
						.embed_messages
						.push(format!("zeta-theme → {message}"));
					println!("[webview] shell->page zeta-theme sent");
				},
				Err(err) => self.state.embed_status = format!("send 失败：{err}"),
			}
		}
		while let Some(diag) = host.try_recv_diag() {
			println!("[webview] diag {diag}");
			let status = format!("{} · diag {diag}", self.state.embed_status);
			self.state.embed_status = status;
		}
	}

	/// Keep the child window glued to the tab's rectangle (dock splits, window
	/// resizes and tab switches all land here).
	fn sync_embed_geometry(&mut self, ctx: &egui::Context) {
		let Some(host) = self.embed.as_mut() else {
			return;
		};
		let ppp = ctx.pixels_per_point();
		let screen = ctx.content_rect();
		let rect = self.state.embed_rect.filter(|_| self.state.embed_drawn);
		let Some(rect) = rect else {
			if host.bounds.is_some() {
				host.bounds = None;
				let _ = host.set_visible(false);
			}
			self.state.embed_px = None;
			return;
		};
		let local = rect.translate(-screen.min.to_vec2()) * ppp;
		let px = embed::PixelRect {
			x: local.min.x.round() as i32,
			y: local.min.y.round() as i32,
			width: local.width().round().max(1.0) as u32,
			height: local.height().round().max(1.0) as u32,
		};
		self.state.embed_px = Some(px);
		if let Err(err) = host.set_bounds(px) {
			self.state.embed_status = format!("set_bounds 失败：{err}");
			return;
		}
		let _ = host.set_visible(!px.is_empty());
	}

	/// `--bench`: probe, resize, probe again, then close. Every step prints a
	/// raw line so the numbers in the report have a provenance.
	fn tick_bench(&mut self, ctx: &egui::Context) {
		let Some(total) = self.opts.bench_secs else {
			return;
		};
		let elapsed = self.opts.process_start.elapsed().as_secs_f32();
		if !self.bench.probed && elapsed > 0.8 {
			self.bench.probed = true;
			println!("[bench] t={elapsed:.2}s probe (initial)");
			self.probe_webview();
		}
		if !self.bench.resized && elapsed > 3.4 {
			self.bench.resized = true;
			println!("[bench] t={elapsed:.2}s resize viewport 1120x720");
			ctx.send_viewport_cmd(ViewportCommand::InnerSize(vec2(1120.0, 720.0)));
		}
		if !self.bench.probed_after_resize && elapsed > 4.2 {
			self.bench.probed_after_resize = true;
			println!("[bench] t={elapsed:.2}s probe (after resize)");
			self.probe_webview();
		}
		if !self.bench.reported && elapsed > 5.0 {
			self.bench.reported = true;
			let inner = self
				.state
				.embed_probe
				.as_deref()
				.and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
				.map(|value| {
					value
						.get("inner")
						.cloned()
						.unwrap_or(serde_json::Value::Null)
				})
				.map(|value| value.to_string())
				.unwrap_or_else(|| "<no probe reply>".to_owned());
			println!(
				"[bench] frames={} embed_px={:?} page_inner={} status={}",
				self.state.frames, self.state.embed_px, inner, self.state.embed_status
			);
		}
		if elapsed > total {
			println!(
				"[bench] exit_ms={:.1} frames={} (wall clock from process start)",
				elapsed * 1000.0,
				self.state.frames
			);
			ctx.send_viewport_cmd(ViewportCommand::Close);
		}
		// Continuous frames: the capture schedule is wall-clock based, and a
		// 50 ms repaint timer starves it on an unfocused window.
		ctx.request_repaint();
	}
}

impl ShellApp {
	/// `--capture`: stage each page, then queue the framebuffer read for the
	/// next paint pass (see [`push_capture_callback`]).
	fn capture_tick(&mut self) {
		let Some(dir) = self.opts.capture.clone() else {
			return;
		};
		let elapsed = self.opts.process_start.elapsed().as_secs_f32();
		for index in 0..self.shots.len() {
			let shot = self.shots[index].clone();
			if !shot.staged && elapsed >= shot.at {
				self.shots[index].staged = true;
				if let Some(prefill) = shot.prefill {
					if self.state.composer.is_empty() {
						self.state.composer = prefill.to_owned();
					}
				}
				if let Some(tab) = shot.focus {
					self.focus_tab(tab);
				}
				continue;
			}
			if shot.staged && !shot.captured && elapsed >= shot.at + 0.12 {
				self.shots[index].captured = true;
				self
					.capture_request
					.push((shot.name.to_owned(), dir.clone()));
			}
		}
	}
}

impl eframe::App for ShellApp {
	fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
		self.draw(ctx);
		self.capture_tick();
	}
}

/// The dock's tab renderer.
struct Viewer<'a> {
	state: &'a mut UiState,
	embed: Option<&'a embed::EmbedHost>,
}

impl TabViewer for Viewer<'_> {
	type Tab = Tab;

	fn title(&mut self, tab: &mut Self::Tab) -> egui::WidgetText {
		tab.title().into()
	}

	fn ui(&mut self, ui: &mut Ui, tab: &mut Self::Tab) {
		match tab {
			Tab::Termide => termide_tab(ui, self.state),
			Tab::Conversation => conversation_tab(ui, self.state),
			Tab::WebEmbed => web_tab(ui, self.state, self.embed),
			Tab::Diff => diff_tab(ui),
		}
	}

	fn is_closeable(&self, _tab: &Self::Tab) -> bool {
		false
	}
}

fn big_tab_bar(ui: &mut Ui, state: &mut UiState) {
	ui.horizontal_centered(|ui| {
		for index in 0..state.workspaces.len() {
			let tab = state.workspaces[index].clone();
			let active = index == state.workspace;
			let label = RichText::new(format!("{} {}", index + 1, tab.name)).size(14.0);
			if ui.selectable_label(active, label).clicked() {
				state.workspace = index;
			}
		}
		ui.separator();
		if ui.button("＋ 新建大标签页").clicked() {
			let n = state.workspaces.len() + 1;
			state
				.workspaces
				.push(WorkspaceTab { name: format!("工作区 {n}"), branch: "main".to_owned() });
			state.workspace = n - 1;
		}
		ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
			ui.label(RichText::new(format!("分支 {}", state.workspace().branch)).weak());
		});
	});
}

fn status_bar(ui: &mut Ui, state: &UiState, embed: Option<&embed::EmbedHost>) {
	ui.horizontal_centered(|ui| {
		ui.label(RichText::new(format!("ζ {APP_TITLE}")).strong());
		ui.separator();
		ui.label(RichText::new(format!("egui/eframe · {} 帧", state.frames)).weak());
		ui.separator();
		ui.label(match state.startup_ms {
			Some(ms) => {
				RichText::new(format!("冷启动 {ms:.0}ms")).color(Color32::from_rgb(163, 190, 140))
			},
			None => RichText::new("冷启动 —").weak(),
		});
		ui.separator();
		ui.label(format!("上下文 {:.1}% · ${:.4}", state.context.percent, state.context.cost_usd));
		ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
			let web = match (embed, state.embed_px) {
				(Some(_), Some(px)) => format!("WebView2 {}×{}px", px.width, px.height),
				(Some(_), None) => "WebView2 已附加（隐藏）".to_owned(),
				(None, _) => "WebView2 未附加".to_owned(),
			};
			ui.label(RichText::new(web).weak());
			ui.separator();
			ui.label(RichText::new(&state.font_report).weak());
		});
	});
}

fn rail_panel(ui: &mut Ui, state: &mut UiState) {
	ui.add_space(4.0);
	ui.label(
		RichText::new("工作区 · 内建按钮（左栏只放内建）")
			.weak()
			.size(11.0),
	);
	for index in 0..state.rail.len() {
		let slot = state.rail[index].clone();
		if !slot.visible {
			continue;
		}
		let active = index == state.rail_active;
		let label = RichText::new(format!("{}  {}", slot.icon, slot.label)).size(13.0);
		if ui
			.add_sized([ui.available_width(), 24.0], egui::Button::selectable(active, label))
			.clicked()
		{
			state.rail_active = index;
		}
	}
	ui.add_space(2.0);
	ui.horizontal(|ui| {
		if ui.small_button("＋ 管理按钮").clicked() {
			state.rail_active = state.rail.len() - 1;
		}
		if ui.small_button("⚙ 设置 / 用量追踪").clicked() {
			state.tree_selected = Some("全局用量追踪（stats 面）".to_owned());
		}
	});
	ui.separator();
	ui.label(RichText::new("项目 / 工作区 / 会话").weak().size(11.0));
	let tree = state.tree.clone();
	egui::ScrollArea::vertical()
		.auto_shrink([false, false])
		.show(ui, |ui| {
			for project in &tree {
				egui::CollapsingHeader::new(RichText::new(&project.name).strong())
					.default_open(true)
					.show(ui, |ui| {
						for branch in &project.branches {
							egui::CollapsingHeader::new(
								RichText::new(format!("⑂ {}", branch.name)).weak(),
							)
							.default_open(true)
							.show(ui, |ui| {
								for session in &branch.sessions {
									let selected = state.tree_selected.as_deref() == Some(session.as_str());
									if ui
										.selectable_label(
											selected,
											RichText::new(format!("⌘ {session}")).size(12.0),
										)
										.clicked()
									{
										state.tree_selected = Some(session.clone());
									}
								}
							});
						}
					});
			}
		});
}

fn context_panel(ui: &mut Ui, state: &UiState) {
	let context = &state.context;
	ui.add_space(4.0);
	ui.horizontal(|ui| {
		ui.label(RichText::new("上下文").strong());
		ui.label(
			RichText::new(if context.running {
				"● 运行中"
			} else {
				"○ 未在运行"
			})
			.weak()
			.size(11.0),
		);
	});
	ui.label(
		RichText::new(format!(
			"{} · {} · 会话 {}",
			short_path(&context.project),
			context.branch,
			context.session
		))
		.weak()
		.size(11.0),
	);
	ui.separator();

	let (ring_rect, _) =
		ui.allocate_exact_size(vec2(ui.available_width().min(180.0), 150.0), Sense::hover());
	let painter = ui.painter();
	let center = ring_rect.center();
	let radius = 58.0;
	painter.circle_stroke(center, radius, Stroke::new(12.0, Color32::from_gray(60)));
	let mut angle = -std::f32::consts::FRAC_PI_2;
	for category in &context.categories {
		let sweep = category.tokens as f32 / context.window as f32 * std::f32::consts::TAU;
		arc(painter, center, radius, angle, angle + sweep, 12.0, category.color);
		angle += sweep;
	}
	// Autocompact threshold as a tick on the ring (design §6.5).
	let threshold = (context.window - context.auto_compact_buffer) as f32 / context.window as f32;
	let tick = -std::f32::consts::FRAC_PI_2 + threshold * std::f32::consts::TAU;
	painter.line_segment(
		[
			center + vec2(tick.cos(), tick.sin()) * (radius - 9.0),
			center + vec2(tick.cos(), tick.sin()) * (radius + 9.0),
		],
		Stroke::new(2.0, Color32::from_rgb(235, 203, 139)),
	);
	painter.text(
		center,
		Align2::CENTER_CENTER,
		format!("已用 {:.1}%", context.percent),
		FontId::proportional(15.0),
		Color32::WHITE,
	);
	painter.text(
		center + vec2(0.0, 18.0),
		Align2::CENTER_CENTER,
		format!("{} / {} · 空闲 {}", context.used, context.window, context.window - context.used),
		FontId::proportional(10.0),
		Color32::from_gray(150),
	);

	// Stacked bar over the 5 categories.
	let (bar_rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 16.0), Sense::hover());
	let painter = ui.painter();
	let mut x = bar_rect.left();
	for category in &context.categories {
		let width = bar_rect.width() * category.tokens as f32 / context.window as f32;
		painter.rect_filled(
			Rect::from_min_size(
				egui::pos2(x, bar_rect.top()),
				vec2(width.max(1.0), bar_rect.height()),
			),
			egui::CornerRadius::ZERO,
			category.color,
		);
		x += width;
	}
	painter.rect_stroke(
		bar_rect,
		egui::CornerRadius::ZERO,
		Stroke::new(1.0, Color32::from_gray(80)),
		egui::StrokeKind::Inside,
	);

	ui.add_space(4.0);
	for category in &context.categories {
		ui.horizontal(|ui| {
			let (chip, _) = ui.allocate_exact_size(vec2(9.0, 9.0), Sense::hover());
			ui.painter()
				.rect_filled(chip, egui::CornerRadius::ZERO, category.color);
			ui.label(RichText::new(category.label).size(11.5));
			ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
				ui.label(
					RichText::new(format!("{} tok", category.tokens))
						.size(11.0)
						.weak(),
				);
			});
		});
	}
	ui.add_space(2.0);
	ui.label(
		RichText::new("工具占用（tools[]，按 tokens 降序）")
			.weak()
			.size(11.0),
	);
	for (name, tokens) in &context.tools {
		ui.horizontal(|ui| {
			ui.label(RichText::new(name).size(11.0));
			ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
				ui.label(RichText::new(format!("{tokens} tok")).size(11.0).weak());
			});
		});
	}
	ui.separator();
	ui.horizontal(|ui| {
		ui.label(RichText::new("子代理").strong().size(12.0));
		ui.label(RichText::new("活跃在前").weak().size(10.0));
	});
	egui::ScrollArea::vertical()
		.max_height(120.0)
		.auto_shrink([false, false])
		.show(ui, |ui| {
			for row in &state.subagents {
				ui.horizontal(|ui| {
					let color = if row.live {
						Color32::from_rgb(163, 190, 140)
					} else {
						Color32::from_gray(130)
					};
					ui.label(
						RichText::new(if row.live { "●" } else { "○" })
							.color(color)
							.size(11.0),
					);
					ui.label(RichText::new(&row.name).size(11.5));
					ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
						ui.label(
							RichText::new(format!("{} tok · ${:.4}", row.tokens, row.cost_usd))
								.size(10.5)
								.weak(),
						);
						ui.label(RichText::new(row.status).size(10.5).color(color));
					});
				});
			}
		});
	ui.separator();
	ui.horizontal(|ui| {
		ui.label(
			RichText::new(format!("累计花费 ${:.4}", context.cost_usd))
				.strong()
				.size(12.0),
		);
		ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
			ui.label(
				RichText::new(format!("{} 次调用", context.calls))
					.weak()
					.size(11.0),
			);
		});
	});
	if let Some(probe) = &state.font_probe {
		ui.add_space(4.0);
		ui.label(
			RichText::new(format!(
				"字体：{:?} · CJK/ASCII={:.3} · 宽字 {} 格",
				probe.has_cjk_glyphs,
				probe.cjk_ratio(),
				probe.cjk_cells
			))
			.weak()
			.size(10.5),
		);
	}
}

fn arc(
	painter: &egui::Painter,
	center: egui::Pos2,
	radius: f32,
	from: f32,
	to: f32,
	width: f32,
	color: Color32,
) {
	let steps = (((to - from).abs() / 0.08).ceil() as usize).clamp(2, 512);
	let points: Vec<egui::Pos2> = (0..=steps)
		.map(|i| {
			let t = from + (to - from) * i as f32 / steps as f32;
			center + vec2(t.cos(), t.sin()) * radius
		})
		.collect();
	painter.add(egui::Shape::line(points, Stroke::new(width, color)));
}

fn termide_tab(ui: &mut Ui, state: &mut UiState) {
	ui.horizontal(|ui| {
		ui.label(
			RichText::new("ratatui（无终端）→ egui cell blit")
				.strong()
				.size(12.0),
		);
		ui.label(RichText::new(&state.blit_report).weak().size(11.0));
	});
	let rect = ui.available_rect_before_wrap();
	let metrics = blit::GridMetrics::for_panel(ui.ctx(), rect, state.grid_font_size);
	let buffer = blit::demo_terminal(metrics.cols, metrics.rows);
	let default_fg = ui.visuals().text_color();
	blit::paint_buffer(ui, &buffer, &metrics, default_fg);
	state.grid_rect = Some(rect);
	state.blit_report = metrics.describe();
}

fn conversation_tab(ui: &mut Ui, state: &mut UiState) {
	ui.label(
		RichText::new("对话 · CLI（输入框是 egui TextEdit，中文走 IME）")
			.strong()
			.size(12.0),
	);
	ui.label(
		RichText::new(
			"IME 链路：OS IME → winit WindowEvent::Ime → egui Event::Ime(Preedit/Commit) → TextEdit 插入",
		)
		.weak()
		.size(11.0),
	);
	ui.add_space(4.0);
	ui.label(RichText::new("你").weak().size(11.0));
	let response = ui.add(
		TextEdit::multiline(&mut state.composer)
			.desired_rows(3)
			.desired_width(f32::INFINITY)
			.hint_text("在这里用中文输入法打一句话（--log-ime 会把事件写进文件）"),
	);
	if state.composer_focus_requested {
		response.request_focus();
		state.composer_focus_requested = false;
	}
	ui.add_space(4.0);
	ui.horizontal(|ui| {
		ui.label(
			RichText::new(format!("composer = {} 字符", state.composer.chars().count()))
				.weak()
				.size(11.0),
		);
		ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
			if ui.button("清空").clicked() {
				state.composer.clear();
			}
			ui.label(
				RichText::new(match &state.ime_log_path {
					Some(path) => format!("IME 日志 → {}", path.display()),
					None => "IME 日志：未写文件（用 --log-ime <file>）".to_owned(),
				})
				.weak()
				.size(10.5),
			);
		});
	});
	ui.separator();
	ui.label(
		RichText::new(format!("IME 事件（{}）", state.ime.len()))
			.strong()
			.size(12.0),
	);
	ui.label(
		RichText::new(
			"手测步骤：启动后点进这个输入框 → 切中文输入法 → 打「中文测试」→ 看下面的 Preedit/Commit 行",
		)
		.weak()
		.size(10.5),
	);
	ui.label(
		RichText::new("ζ zetacode › 收到，中文输入正常。这是对话消息（假数据）。")
			.color(Color32::from_rgb(163, 190, 140))
			.size(12.0),
	);
	egui::ScrollArea::vertical()
		.auto_shrink([false, false])
		.show(ui, |ui| {
			for entry in state.ime.iter().rev().take(24) {
				let (label, color) = match entry.kind {
					"Commit" => ("Commit", Color32::from_rgb(163, 190, 140)),
					"Preedit" => ("Preedit", Color32::from_rgb(235, 203, 139)),
					_ => (entry.kind, Color32::from_gray(150)),
				};
				ui.label(
					RichText::new(format!("{:>9.0}ms {label:<8} {}", entry.at_ms, entry.text))
						.monospace()
						.size(11.0)
						.color(color),
				);
			}
		});
}

fn web_tab(ui: &mut Ui, state: &mut UiState, embed: Option<&embed::EmbedHost>) {
	let rect = ui.available_rect_before_wrap();
	state.embed_rect = Some(rect);
	state.embed_drawn = true;
	ui.horizontal(|ui| {
		ui.label(
			RichText::new("右栏/中间区的 web 子页（chrome=none）")
				.strong()
				.size(12.0),
		);
		ui.label(
			RichText::new("WebView2 子窗口覆盖这块矩形")
				.weak()
				.size(11.0),
		);
		ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
			if ui.button("重新 probe").clicked() {
				state.probe_requested = true;
			}
		});
	});
	ui.label(RichText::new(&state.embed_status).weak().size(11.0));
	match embed {
		Some(host) => {
			ui.label(
				RichText::new(format!("url = {}", host.url))
					.weak()
					.size(10.5),
			);
			ui.label(
				RichText::new(format!("页面 = chrome=none（内置 {} 字节）", embed::embed_page_bytes()))
					.weak()
					.size(10.5),
			);
			if let Some(px) = state.embed_px {
				ui.label(
					RichText::new(format!(
						"面板矩形 = {}×{} px @ ({}, {})",
						px.width, px.height, px.x, px.y
					))
					.color(Color32::from_rgb(136, 192, 208))
					.size(11.0),
				);
			}
			ui.label(
				RichText::new("上面这几行会被 WebView2 子窗口盖住（原生子窗口永远在 GL 画布之上）")
					.weak()
					.size(10.5),
			);
		},
		None => {
			ui.label(
				RichText::new(
					"headless / 未附加：原生窗口里这块矩形会被 WebView2 子窗口完全覆盖；egui_kittest 截不到子窗口",
				)
				.weak()
				.size(11.0),
			);
		},
	}
	ui.separator();
	if let Some(raw) = &state.embed_probe {
		ui.label(
			RichText::new("页面 probe 回包（页 → 壳 postMessage）")
				.strong()
				.size(11.5),
		);
		ui.label(
			RichText::new(raw)
				.monospace()
				.size(10.5)
				.color(Color32::from_rgb(163, 190, 140)),
		);
	}
	ui.label(
		RichText::new(format!("消息日志（{}）", state.embed_messages.len()))
			.strong()
			.size(11.5),
	);
	egui::ScrollArea::vertical()
		.auto_shrink([false, false])
		.show(ui, |ui| {
			for message in state.embed_messages.iter().rev() {
				ui.label(
					RichText::new(message)
						.monospace()
						.size(10.0)
						.color(Color32::from_rgb(136, 192, 208)),
				);
			}
		});
}

fn diff_tab(ui: &mut Ui) {
	ui.label(
		RichText::new("文件 diff（静态 mock，只为占位第二个子页签）")
			.strong()
			.size(12.0),
	);
	let lines = [
		("--- a/main/crates/zeta-main/src/app.rs", Color32::from_gray(150)),
		("+++ b/main/crates/zeta-main/src/app.rs", Color32::from_gray(150)),
		("@@ -1,4 +1,5 @@", Color32::from_rgb(136, 192, 208)),
		("- let rail = None;", Color32::from_rgb(191, 97, 106)),
		("+ let rail = Some(Rail::builtin());", Color32::from_rgb(163, 190, 140)),
		("+ let web = Embed::webview2(\"chrome=none\");", Color32::from_rgb(163, 190, 140)),
	];
	for (line, color) in lines {
		ui.label(RichText::new(line).monospace().size(11.5).color(color));
	}
}

fn short_path(path: &str) -> String {
	let parts: Vec<&str> = path.split(['/', '\\']).collect();
	parts
		.iter()
		.rev()
		.take(2)
		.rev()
		.copied()
		.collect::<Vec<_>>()
		.join("/")
}

/// Font files tried for the grid font and for CJK fallback text.
pub fn cjk_font_candidates() -> Vec<(PathBuf, u32)> {
	let mut candidates = Vec::new();
	#[cfg(windows)]
	{
		for path in [
			r"C:\Windows\Fonts\simhei.ttf",
			r"C:\Windows\Fonts\msyh.ttc",
			r"C:\Windows\Fonts\Deng.ttf",
			r"C:\Windows\Fonts\NotoSansSC-VF.ttf",
			r"C:\Windows\Fonts\simsun.ttc",
		] {
			candidates.push((PathBuf::from(path), 0));
		}
	}
	#[cfg(target_os = "linux")]
	{
		for path in [
			"/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
			"/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
			"/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
			"/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
			"/usr/share/fonts/truetype/arphic/uming.ttc",
		] {
			candidates.push((PathBuf::from(path), 0));
		}
	}
	candidates
}

/// Load the first CJK face that exists; returns the bytes, the face index and
/// the path actually used.
pub fn load_cjk_font() -> Option<(Vec<u8>, u32, PathBuf)> {
	for (path, index) in cjk_font_candidates() {
		if let Ok(bytes) = std::fs::read(&path) {
			return Some((bytes, index, path));
		}
	}
	None
}

/// Install the CJK face as the grid family's first font and as a fallback for
/// the proportional/monospace families. Returns a human-readable report.
pub fn install_grid_fonts(ctx: &egui::Context) -> String {
	let mut definitions = FontDefinitions::default();
	let Some((bytes, index, path)) = load_cjk_font() else {
		ctx.set_fonts(definitions);
		return "未找到 CJK 字体：中文会显示为豆腐块".to_owned();
	};
	let name = "cjk-grid".to_owned();
	definitions.font_data.insert(
		name.clone(),
		Arc::new(FontData { font: bytes.into(), index, tweak: Default::default() }),
	);
	for family in [FontFamily::Proportional, FontFamily::Monospace] {
		definitions
			.families
			.entry(family)
			.or_default()
			.push(name.clone());
	}
	definitions
		.families
		.insert(FontFamily::Name(blit::GRID_FAMILY.into()), vec![name, "Hack".to_owned()]);
	ctx.set_fonts(definitions);
	format!("CJK 字体 = {}（face {index}）", path.display())
}
