use gpui_kit::component::{
	Sizable as _,
	button::{Button, ButtonVariants as _},
	dock::{BasePanel, Panel, PanelEvent},
	h_flex,
	input::{Input, InputEvent, InputState},
	v_flex,
};
use gpui_kit::*;

use crate::cell_grid::{BlitGrid, demo_buffer};
use crate::grid_view::{
	CELL_FONT_SIZE, CellMetrics, cells_that_fit, grid_element, measure_cells, metrics_report,
};

/// Chrome shared by every panel of this spike.
pub const PANEL_BG: u32 = 0x14161a;
pub const PANEL_FG: u32 = 0xd6d8dc;

fn title_text(title: &str) -> impl IntoElement {
	div()
		.text_sm()
		.font_weight(FontWeight::MEDIUM)
		.child(title.to_string())
}

// ---------------------------------------------------------------------------
// ratatui blit panel
// ---------------------------------------------------------------------------

/// The panel that proves nail 3: a ratatui `Buffer` rendered with no terminal
/// at all, blitted cell by cell into a GPUI panel.
pub struct RatatuiPanel {
	focus_handle: FocusHandle,
	metrics: CellMetrics,
	grid: BlitGrid,
	/// Cell grid the current `grid` was built for.
	built_for: (usize, usize),
	mismatches: usize,
}

impl RatatuiPanel {
	pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
		let metrics = measure_cells(window, px(CELL_FONT_SIZE));
		let built_for = (90usize, 26usize);
		let grid = BlitGrid::from_buffer(&demo_buffer(built_for.0 as u16, built_for.1 as u16));
		Self { focus_handle: cx.focus_handle(), metrics, grid, built_for, mismatches: 0 }
	}

	/// Rebuild the ratatui buffer when the panel's cell grid changed.
	fn rebuild_if_needed(&mut self, cols: usize, rows: usize) {
		if (cols, rows) == self.built_for {
			return;
		}
		self.built_for = (cols, rows);
		let buffer = demo_buffer(cols as u16, rows as u16);
		self.grid = BlitGrid::from_buffer(&buffer);
		self.mismatches = self.grid.wide_mismatches;
	}

	fn metrics_line(&self) -> String {
		metrics_report(&self.metrics)
	}
}

impl EventEmitter<PanelEvent> for RatatuiPanel {}

impl Focusable for RatatuiPanel {
	fn focus_handle(&self, _: &App) -> FocusHandle {
		self.focus_handle.clone()
	}
}

impl BasePanel for RatatuiPanel {
	fn panel_name(&self) -> &'static str {
		"RatatuiBlit"
	}
}

impl Panel for RatatuiPanel {
	fn title(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
		title_text("终端缓冲区 (ratatui blit)")
	}

	fn tab_name(&self, _: &App) -> Option<SharedString> {
		Some("终端".into())
	}
}

impl Render for RatatuiPanel {
	fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
		// The panel's own size is only known once it is laid out, so the grid
		// is chosen from the size the canvas measured on the previous frame.
		let this = cx.entity();
		let grid = grid_element(&self.grid, &self.metrics, rgb(PANEL_BG).into());
		let mismatch = self.mismatches;
		let info = self.metrics_line();
		let built_for = self.built_for;

		let measure_canvas = canvas(
			move |bounds, window, cx| {
				let metrics = measure_cells(window, px(CELL_FONT_SIZE));
				let (cols, rows) = cells_that_fit(bounds.size, &metrics);
				this.update(cx, |this, cx| {
					this.metrics = metrics;
					if (cols, rows) != this.built_for {
						this.rebuild_if_needed(cols, rows);
						// One frame late by design: re-render with the grid
						// that actually fits the panel.
						cx.notify();
					}
				});
			},
			|_, _, _, _| {},
		)
		.absolute()
		.size_full();

		v_flex()
			.size_full()
			.bg(rgb(PANEL_BG))
			.text_color(rgb(PANEL_FG))
			.child(
				h_flex()
					.px_2()
					.py_1()
					.gap_2()
					.text_xs()
					.text_color(rgb(0x8a9099))
					.child(format!(
						"grid {}x{} · {info} · unicode-width/skip 不一致 {mismatch}",
						built_for.0, built_for.1
					)),
			)
			.child(div().relative().flex_1().child(grid).child(measure_canvas))
	}
}

// ---------------------------------------------------------------------------
// context panel (right dock)
// ---------------------------------------------------------------------------

/// The right-hand context panel from the design (`local://zetawork-webbridge-design.md`
/// §6.5). This spike draws the shape with sample numbers: it is **not** wired
/// to `GET /api/agent/<id>/context`, and the label says so.
pub struct ContextPanel {
	focus_handle: FocusHandle,
}

impl ContextPanel {
	pub fn new(cx: &mut Context<Self>) -> Self {
		Self { focus_handle: cx.focus_handle() }
	}
}

impl EventEmitter<PanelEvent> for ContextPanel {}

impl Focusable for ContextPanel {
	fn focus_handle(&self, _: &App) -> FocusHandle {
		self.focus_handle.clone()
	}
}

impl BasePanel for ContextPanel {
	fn panel_name(&self) -> &'static str {
		"ContextPanel"
	}
}

impl Panel for ContextPanel {
	fn title(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
		title_text("上下文")
	}

	fn tab_name(&self, _: &App) -> Option<SharedString> {
		Some("上下文".into())
	}
}

impl Render for ContextPanel {
	fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
		// 5 categories, in the order `packages/tui/src/status-line/context-usage.ts:85` fixes.
		let segments: [(&str, u32, f32); 5] = [
			("系统提示", 0x4c86df, 0.12),
			("系统上下文", 0x3fbfbb, 0.05),
			("工具定义", 0xb05ad0, 0.21),
			("技能", 0xd7a845, 0.04),
			("会话消息", 0x4caf50, 0.16),
		];
		let bar = h_flex()
			.h(px(14.))
			.w_full()
			.rounded(px(4.))
			.overflow_hidden()
			.bg(rgb(0x2a2e35))
			.children(
				segments
					.iter()
					.map(|(_, color, frac)| div().h_full().flex_grow(*frac).bg(rgb(*color))),
			);

		v_flex()
			.size_full()
			.p_3()
			.gap_3()
			.bg(rgb(PANEL_BG))
			.text_color(rgb(PANEL_FG))
			.child(
				v_flex()
					.gap_1()
					.text_xs()
					.text_color(rgb(0x8a9099))
					.child("示例数据：spike 未接 web-gateway")
					.child("路径 C:/…/zeta · 分支 spike/gpui-shell · 会话 #1"),
			)
			.child(
				v_flex()
					.items_center()
					.justify_center()
					.py_4()
					.child(div().text_3xl().font_weight(FontWeight::BOLD).child("58%"))
					.child(
						div()
							.text_xs()
							.text_color(rgb(0x8a9099))
							.child("已用 128k / 窗口 220k"),
					),
			)
			.child(bar)
			.child(
				v_flex()
					.gap_1()
					.text_xs()
					.children(segments.iter().map(|(name, color, frac)| {
						h_flex()
							.gap_2()
							.items_center()
							.child(div().size(px(8.)).rounded_full().bg(rgb(*color)))
							.child(format!("{name} {:.0}%", frac * 100.0))
					})),
			)
			.child(
				div()
					.mt_auto()
					.text_xs()
					.text_color(rgb(0x8a9099))
					.child("子代理 0 活跃 / 0 已关闭 · 花费 $0.00"),
			)
	}
}

// ---------------------------------------------------------------------------
// IME input panel
// ---------------------------------------------------------------------------

/// Nail 5: a real text input to type Chinese into with the system IME.
pub struct ImePanel {
	focus_handle: FocusHandle,
	input: Entity<InputState>,
	value: String,
	events: Vec<String>,
}

impl ImePanel {
	pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
		let input = cx.new(|cx| {
			InputState::new(window, cx)
				.placeholder("在这里用微软拼音输入中文，例如：中文字符对齐")
				.default_value("")
		});

		let this_value = input.clone();
		cx.subscribe(&input, move |this: &mut Self, _input, event: &InputEvent, cx| match event {
			InputEvent::Change => {
				let value = this_value.read(cx).value().to_string();
				let chars = value.chars().count();
				this.events.push(format!("Change → {chars} 字符: {value}"));
				this.value = value;
				if this.events.len() > 8 {
					this.events.remove(0);
				}
				cx.notify();
			},
			InputEvent::PressEnter { .. } => {
				this.events.push("PressEnter".to_string());
				cx.notify();
			},
			InputEvent::Focus => this.events.push("Focus".to_string()),
			InputEvent::Blur => this.events.push("Blur".to_string()),
		})
		.detach();

		Self { focus_handle: cx.focus_handle(), input, value: String::new(), events: Vec::new() }
	}
}

impl EventEmitter<PanelEvent> for ImePanel {}

impl Focusable for ImePanel {
	fn focus_handle(&self, _: &App) -> FocusHandle {
		self.focus_handle.clone()
	}
}

impl BasePanel for ImePanel {
	fn panel_name(&self) -> &'static str {
		"ImePanel"
	}
}

impl Panel for ImePanel {
	fn title(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
		title_text("输入法 (IME)")
	}

	fn tab_name(&self, _: &App) -> Option<SharedString> {
		Some("输入法".into())
	}
}

impl Render for ImePanel {
	fn render(&mut self, _: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
		let char_count = self.value.chars().count();
		let value = if self.value.is_empty() {
			"(空)".to_string()
		} else {
			self.value.clone()
		};
		let events = self.events.clone();

		v_flex()
			.size_full()
			.p_3()
			.gap_3()
			.bg(rgb(PANEL_BG))
			.text_color(rgb(PANEL_FG))
			.child(
				div()
					.text_xs()
					.text_color(rgb(0x8a9099))
					.child("gpui 走平台输入法（Windows: WM_IME_* + ImmGetCompositionStringW）"),
			)
			.child(Input::new(&self.input))
			.child(
				v_flex()
					.gap_1()
					.child(div().text_sm().child(format!("已输入 {char_count} 字符")))
					.child(div().text_sm().child(value)),
			)
			.child(
				v_flex()
					.gap_1()
					.text_xs()
					.text_color(rgb(0x8a9099))
					.children(events.into_iter().map(|event| div().child(event))),
			)
	}
}

// ---------------------------------------------------------------------------
// plain text panel (used for the second big tab's sub-pages)
// ---------------------------------------------------------------------------

pub struct NotePanel {
	focus_handle: FocusHandle,
	panel_name: &'static str,
	tab: SharedString,
	lines: Vec<String>,
}

impl NotePanel {
	pub fn new(
		panel_name: &'static str,
		tab: &str,
		lines: Vec<String>,
		cx: &mut Context<Self>,
	) -> Self {
		Self { focus_handle: cx.focus_handle(), panel_name, tab: tab.into(), lines }
	}
}

impl EventEmitter<PanelEvent> for NotePanel {}

impl Focusable for NotePanel {
	fn focus_handle(&self, _: &App) -> FocusHandle {
		self.focus_handle.clone()
	}
}

impl BasePanel for NotePanel {
	fn panel_name(&self) -> &'static str {
		self.panel_name
	}
}

impl Panel for NotePanel {
	fn title(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
		title_text(&self.tab)
	}

	fn tab_name(&self, _: &App) -> Option<SharedString> {
		Some(self.tab.clone())
	}
}

impl Render for NotePanel {
	fn render(&mut self, _: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
		let lines = self.lines.clone();
		v_flex()
			.size_full()
			.p_4()
			.gap_2()
			.bg(rgb(PANEL_BG))
			.text_color(rgb(PANEL_FG))
			.child(div().text_lg().child(self.tab.clone()))
			.children(lines.into_iter().map(|line| div().text_sm().child(line)))
	}
}

/// A right-dock page that lists what this spike does and does not prove, so the
/// screenshot carries its own caveats.
pub fn spike_panel(cx: &mut Context<NotePanel>) -> NotePanel {
	NotePanel::new(
		"SpikeNotes",
		"本 spike 说明",
		vec![
			"① windows-gnu 构建：见 PR 描述与构建日志。".to_string(),
			"② dock/多面板：gpui-component DockArea + DockSkin，左栏 Tree，底部 StatusBar。"
				.to_string(),
			"③ ratatui blit：无终端 Buffer → 单元格网格，CJK 宽字符按 2 格定位。".to_string(),
			"④ WebView2：gpui-wry(lb-wry) 子窗口，随面板尺寸变化。".to_string(),
			"⑤ 中文输入法：见「输入法」页，需人工用系统 IME 实测。".to_string(),
			"本面板数据均为示例，未接 web-gateway。".to_string(),
		],
		cx,
	)
}

/// Small helper so the shell can put a "settings" button at the rail bottom.
pub fn rail_button(id: &'static str, label: &'static str, active: bool) -> Button {
	let button = Button::new(id).label(label).small().ghost();
	if active { button.primary() } else { button }
}
