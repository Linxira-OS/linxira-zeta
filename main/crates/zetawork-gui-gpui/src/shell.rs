//! The spike shell: left rail (buttons + project/workspace/session tree),
//! centre (big tab strip + a dock area per big tab), right dock, status bar.
//!
//! Everything the four design nails touch lives here: the dock
//! (`gpui-component` `DockArea`/`DockSkin`), the `Tree`, the ratatui blit
//! panel, the WebView2 panel and the status bar.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use gpui_kit::component::{
	Sizable as _,
	button::{Button, ButtonVariants as _},
	dock::{BasePanelView, DockArea, DockLayout, DockPlacement, DockSkin, panel_handle},
	h_flex,
	list::ListItem,
	status_bar::StatusBar,
	tab::{Tab, TabBar},
	tree::{TreeEntry, TreeItem, TreeState, tree},
	v_flex,
};
use gpui_kit::*;

use crate::panels::{ContextPanel, ImePanel, NotePanel, RatatuiPanel, rail_button, spike_panel};
use crate::shot;
use crate::webview::WebViewPanel;

const RAIL_BG: u32 = 0x191c21;
const CHROME_BG: u32 = 0x101216;
const LINE: u32 = 0x2a2f38;
const FG: u32 = 0xd6d8dc;
const DIM: u32 = 0x8a9099;

/// Left-rail builtins (R13: the rail carries builtins only, four of them by
/// default).
const RAIL_ITEMS: [(&str, &str); 4] =
	[("search", "搜索"), ("tasks", "任务"), ("automation", "自动化"), ("mobile", "手机端")];

/// How a spike run is configured from the command line.
#[derive(Clone, Debug, Default)]
pub struct Config {
	/// Where screenshots go; `None` runs the shell without capturing.
	pub shot_dir: Option<PathBuf>,
	/// Delay between shot steps, in milliseconds.
	pub shot_delay_ms: u64,
	/// Quit this many ms after the last shot step.
	pub auto_exit_ms: Option<u64>,
	/// Skip WebView2 creation and show the documented fallback panel instead.
	pub no_webview: bool,
}

enum ShotStep {
	Scene(&'static str),
	Window(&'static str),
	BigTab(usize),
}

pub struct Shell {
	tree: Entity<TreeState>,
	active_tab: usize,
	rail_view: usize,
	dock_a: Entity<DockArea>,
	dock_b: Entity<DockArea>,
	webview: Option<Entity<WebViewPanel>>,
	webview_b: Option<Entity<WebViewPanel>>,
	webview_note: Option<String>,
	started: Instant,
	first_render_ms: Option<u128>,
}

impl Shell {
	pub fn new(
		window: &mut Window,
		cx: &mut Context<Self>,
		config: Config,
		started: Instant,
	) -> Self {
		let tree = cx.new(|cx| {
			TreeState::new(cx).items(vec![
				TreeItem::new("proj-zeta", "zeta")
					.expanded(true)
					.child(
						TreeItem::new("ws-gpui", "spike/gpui-shell · gpui")
							.expanded(true)
							.child(TreeItem::new("session-1", "会话 #1 · GPUI 面板可用性"))
							.child(TreeItem::new("session-2", "会话 #2 · ratatui blit"))
							.child(TreeItem::new("session-3", "会话 #3 · WebView2 嵌入")),
					)
					.child(TreeItem::new("ws-egui", "spike/egui-shell · egui")),
				TreeItem::new("proj-termide", "termide")
					.child(TreeItem::new("ws-termide-main", "main · termide 0.41.0")),
			])
		});

		let ratatui = cx.new(|cx| RatatuiPanel::new(window, cx));
		let context = cx.new(ContextPanel::new);
		let ime = cx.new(|cx| ImePanel::new(window, cx));
		let session_note = cx.new(|cx| {
			NotePanel::new(
				"SessionPanel",
				"会话",
				vec![
					"这一页与「终端」共用中间区，演示同一大标签页内的可切分面板。".to_string(),
					"P0 的对话内容就是内嵌 CLI（termide），本 spike 不接真实进程。".to_string(),
				],
				cx,
			)
		});

		// Nail 4: WebView2, with an honest fallback if the child window cannot
		// be created (missing runtime, no handle, …).
		let (webview, webview_note, webview_panel) = if config.no_webview {
			(None, Some("--no-webview：按配置跳过了 WebView2 子窗口".to_string()), None)
		} else {
			match WebViewPanel::new(window, cx) {
				Ok(panel) => (Some(panel.clone()), None, Some(panel)),
				Err(err) => {
					let note = format!("WebView2 子窗口创建失败：{err:#}");
					eprintln!("[zeta-spike] {note}");
					(None, Some(note), None)
				},
			}
		};

		let webview_tab = match webview_panel {
			Some(panel) => panel_handle(panel),
			None => {
				let note = webview_note
					.clone()
					.unwrap_or_else(|| "WebView2 未创建".to_string());
				let fallback = cx.new(|cx| {
					NotePanel::new(
						"WebView2Fallback",
						"WebView2 不可用",
						vec![note, "备选：另开一个窗口，或把该页交给系统浏览器打开。".to_string()],
						cx,
					)
				});
				panel_handle(fallback)
			},
		};

		let context_handle = panel_handle(context);
		let ime_handle = panel_handle(ime);
		let session_handle = panel_handle(session_note);
		let ratatui_handle = panel_handle(ratatui);

		let (dock_a, _skin_a) = DockSkin::dock_area("main-dock", Some(1), window, cx);
		let center_a = DockLayout::h_split()
			.child(tabs(vec![ratatui_handle, webview_tab], cx), None)
			.child(tabs(vec![session_handle], cx), Some(px(360.)));
		let right_a = tabs(vec![context_handle, ime_handle], cx);
		dock_a.update(cx, |area, cx| {
			area.set_center(center_a, window, cx);
			area.set_dock(DockPlacement::Right, right_a, window, cx);
			area.set_dock_size(DockPlacement::Right, px(330.), window, cx);
		});

		// Big tab 2: a second workspace with its own layout, so the strip
		// switches between two dock areas.
		let note_one = cx.new(|cx| {
			NotePanel::new(
				"SessionAltOne",
				"会话 A",
				vec!["第二个大标签页：布局与第一个互不相干。".to_string()],
				cx,
			)
		});
		let note_two = cx.new(|cx| {
			NotePanel::new(
				"SessionAltTwo",
				"会话 B",
				vec!["大标签页内的第二个子页（页签）。".to_string()],
				cx,
			)
		});
		let note_three = cx.new(|cx| {
			NotePanel::new(
				"RenderCompare",
				"渲染对比",
				vec![
					"R9：同一份会话内容可以走「终端(ratatui)」或「Web UI」两种渲染。".to_string(),
					"这两种渲染在本 spike 里分别由「终端」页与「WebView2」页代表。".to_string(),
				],
				cx,
			)
		});
		let notes_handle = panel_handle(cx.new(spike_panel));
		// A second WebView2 child window, first tab of the second big tab: the
		// dock has no "activate panel by name" API, so tab order is the only way
		// to make the WebView2 panel the *active* tab in a screenshot.
		let (webview_b, webview_b_handle) = match WebViewPanel::new(window, cx) {
			Ok(panel) => (Some(panel.clone()), panel_handle(panel)),
			Err(err) => {
				eprintln!("[zeta-spike] second WebView2 failed: {err:#}");
				(
					None,
					panel_handle(cx.new(|cx| {
						NotePanel::new(
							"WebView2FallbackB",
							"WebView2 不可用",
							vec![format!("{err:#}")],
							cx,
						)
					})),
				)
			},
		};
		let (dock_b, _skin_b) = DockSkin::dock_area("alt-dock", Some(1), window, cx);
		let center_b = DockLayout::h_split()
			.child(
				tabs(vec![webview_b_handle, panel_handle(note_one), panel_handle(note_two)], cx),
				None,
			)
			.child(tabs(vec![panel_handle(note_three)], cx), Some(px(380.)));
		let right_b = tabs(vec![notes_handle], cx);
		dock_b.update(cx, |area, cx| {
			area.set_center(center_b, window, cx);
			area.set_dock(DockPlacement::Right, right_b, window, cx);
			area.set_dock_size(DockPlacement::Right, px(330.), window, cx);
		});

		if let Some(dir) = config.shot_dir.clone() {
			let steps: VecDeque<ShotStep> = VecDeque::from(vec![
				ShotStep::Scene("01-bigtab-a-scene.png"),
				ShotStep::Window("02-bigtab-a-window-printwindow.png"),
				ShotStep::BigTab(1),
				ShotStep::Scene("03-bigtab-b-scene.png"),
				ShotStep::Window("04-bigtab-b-webview-printwindow.png"),
			]);
			schedule_shots(cx, window, dir, config.shot_delay_ms, config.auto_exit_ms, steps);
		}

		Self {
			tree,
			active_tab: 0,
			rail_view: 0,
			dock_a,
			dock_b,
			webview,
			webview_b,
			webview_note,
			started,
			first_render_ms: None,
		}
	}

	fn set_active_tab(&mut self, tab: usize, _window: &mut Window, cx: &mut Context<Self>) {
		if tab == self.active_tab || tab > 1 {
			return;
		}
		self.active_tab = tab;
		if let Some(webview) = self.webview.clone() {
			let visible = tab == 0;
			webview.update(cx, |panel, cx| panel.set_visible(visible, cx));
		}
		if let Some(webview) = self.webview_b.clone() {
			let visible = tab == 1;
			webview.update(cx, |panel, cx| panel.set_visible(visible, cx));
		}
		cx.notify();
	}

	fn apply_step(
		&mut self,
		step: ShotStep,
		dir: &Path,
		window: &mut Window,
		cx: &mut Context<Self>,
	) {
		match step {
			ShotStep::Scene(name) => {
				if let Err(err) = shot::save_scene(window, &dir.join(name)) {
					eprintln!("[shot] scene {name} failed: {err:#}");
				}
			},
			ShotStep::Window(name) => {
				if let Err(err) = shot::save_window(window, &dir.join(name)) {
					eprintln!("[shot] PrintWindow {name} failed: {err:#}");
				}
			},
			ShotStep::BigTab(tab) => self.set_active_tab(tab, window, cx),
		}
	}

	fn status_left(&self) -> String {
		let workspace = if self.active_tab == 0 {
			"spike/gpui-shell"
		} else {
			"spike/egui-shell"
		};
		format!("pid {} · 工作区 {} · 面板 gpui-component DockSkin", std::process::id(), workspace,)
	}
}

/// The status bar's WebView2 wording, so a failed child window is visible in
/// the UI instead of only in the log.
fn status_webview_state(has_webview: bool, note: Option<&String>) -> String {
	match (has_webview, note) {
		(true, _) => "WebView2 子窗口已创建".to_string(),
		(false, Some(note)) => format!("WebView2 不可用：{note}"),
		(false, None) => "WebView2 未创建".to_string(),
	}
}

fn tabs(panels: Vec<Arc<dyn BasePanelView>>, cx: &mut App) -> DockLayout {
	let mut layout = DockLayout::tabs();
	for panel in panels {
		layout = layout.panel_view(panel, cx);
	}
	layout
}

fn schedule_shots(
	cx: &mut Context<Shell>,
	window: &mut Window,
	dir: PathBuf,
	delay_ms: u64,
	auto_exit_ms: Option<u64>,
	steps: VecDeque<ShotStep>,
) {
	let delay = Duration::from_millis(delay_ms.max(200));
	cx.spawn_in(window, async move |this, cx| {
		for step in steps {
			cx.background_executor().timer(delay).await;
			let dir = dir.clone();
			let _ = this.update_in(cx, move |this, window, cx| {
				this.apply_step(step, &dir, window, cx);
			});
		}
		if let Some(auto_exit_ms) = auto_exit_ms {
			cx.background_executor()
				.timer(Duration::from_millis(auto_exit_ms))
				.await;
			let _ = cx.update(|_, cx| cx.quit());
		}
	})
	.detach();
}

impl Render for Shell {
	fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
		if self.first_render_ms.is_none() {
			let ms = self.started.elapsed().as_millis();
			self.first_render_ms = Some(ms);
			println!("[zeta-spike] first_frame_ms={ms}");
		}

		let this = cx.entity();
		let rail_entity = this.clone();
		let mut rail = v_flex()
			.w(px(240.))
			.h_full()
			.flex_shrink(0.)
			.border_r_1()
			.border_color(rgb(LINE))
			.bg(rgb(RAIL_BG))
			.py_2()
			.gap_1()
			.text_color(rgb(FG));

		for (index, (id, label)) in RAIL_ITEMS.iter().enumerate() {
			let entity = rail_entity.clone();
			rail = rail.child(div().px_2().child(
				rail_button(id, label, index == self.rail_view).on_click(move |_, _, cx| {
					entity.update(cx, |this, cx| {
						this.rail_view = index;
						cx.notify();
					});
				}),
			));
		}

		let tree_view = tree(&self.tree, |ix, entry: &TreeEntry, _selected, _, _| {
			ListItem::new(ix).child(div().text_sm().child(entry.item().label.clone()))
		});

		rail = rail
			.child(
				div()
					.px_3()
					.pt_2()
					.pb_1()
					.text_xs()
					.text_color(rgb(DIM))
					.child("项目 / 工作区 / 会话"),
			)
			.child(div().flex_1().px_1().overflow_hidden().child(tree_view))
			.child(
				div().px_2().child(
					Button::new("settings")
						.label("设置 / 用量追踪")
						.small()
						.ghost(),
				),
			);

		let tabbar = TabBar::new("big-tabs")
			.underline()
			.selected_index(self.active_tab)
			.children(vec![
				Tab::new().label("工作区 A · spike/gpui-shell"),
				Tab::new().label("工作区 B · spike/egui-shell"),
			])
			.on_click({
				let entity = this.clone();
				move |index, window, cx| {
					let index = *index;
					entity.update(cx, |this, cx| this.set_active_tab(index, window, cx));
				}
			});

		let area = if self.active_tab == 0 {
			self.dock_a.clone().into_any_element()
		} else {
			self.dock_b.clone().into_any_element()
		};

		let webview_state = match self.webview.as_ref() {
			Some(panel) => format!("WebView2 {} 已加载", panel.read(cx).url()),
			None => status_webview_state(false, self.webview_note.as_ref()),
		};
		let first_frame = self.first_render_ms.unwrap_or(0);
		let status_left = self.status_left();

		v_flex()
			.size_full()
			.bg(rgb(CHROME_BG))
			.text_color(rgb(FG))
			.child(
				h_flex().flex_1().overflow_hidden().child(rail).child(
					v_flex()
						.flex_1()
						.h_full()
						.overflow_hidden()
						.child(div().px_2().pt_1().child(tabbar))
						.child(div().flex_1().overflow_hidden().child(area)),
				),
			)
			.child(
				StatusBar::new()
					.left(div().child(status_left))
					.right(div().child(webview_state))
					.right(div().child(format!("首帧 {first_frame} ms"))),
			)
	}
}
