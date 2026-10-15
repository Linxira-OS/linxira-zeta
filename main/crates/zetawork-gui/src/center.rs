//! The centre column: the 大标签页 strip, the tool strip, the pane grid and the
//! three pane bodies.
//!
//! The strip shows **the active project's workspaces** — 大标签页 *is* 工作区 —
//! so clicking one opens it and its ✕ closes it (refused on the last one of a
//! project). Below it the tool strip drives 新建终端 / 分屏 / 列数, and the body
//! is either the pane grid or, with no workspace open, the welcome panel.
//!
//! The three pane bodies are where the honest line lives: the terminal blits a
//! real ratatui `Buffer` (see [`crate::blit`]), the editor colours the spec's
//! sample code, and the diff draws the spec's hunk rows — and each one starts
//! with a `[占位]` banner naming the data source it will read once that exists.

use egui::{Align, Color32, CornerRadius, Layout, Rect, Sense, Stroke, Ui, pos2, vec2};

use crate::Shell;
use crate::blit::{BufferCache, GridMetrics, paint_buffer_with, paint_cursor};
use crate::icons::{Icon, icon_button, paint};
use crate::seed::{self, DiffRow, Sample};
use crate::state::{Pane, SessionKind, SessionTab};
use crate::theme;
use crate::widgets::{Chip, chip, truncated_mono, truncated_text};

/// The pane grid, or the welcome panel when no workspace is open.
pub fn workspace(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	let open = shell.state.active_workspace().is_some();
	let topbar = Rect::from_min_size(rect.min, vec2(rect.width(), theme::TOPBAR_H));
	let toolstrip = Rect::from_min_size(
		pos2(rect.min.x, topbar.max.y),
		vec2(rect.width(), if open { theme::TOOLSTRIP_H } else { 0.0 }),
	);
	let body = Rect::from_min_max(pos2(rect.min.x, toolstrip.max.y), rect.max);
	for (region, draw) in [
		(topbar, big_tabs as fn(&mut Ui, &mut Shell)),
		(toolstrip, tool_strip as fn(&mut Ui, &mut Shell)),
		(body, body_region as fn(&mut Ui, &mut Shell)),
	] {
		if region.height() <= 1.0 {
			continue;
		}
		let mut child = ui.new_child(egui::UiBuilder::new().max_rect(region));
		draw(&mut child, shell);
	}
}

/// `.ws-topbar` — the 大标签页 strip and ＋.
fn big_tabs(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL_2);
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.max.y - 0.5), pos2(rect.max.x, rect.max.y - 0.5)],
		Stroke::new(1.0, theme::BORDER),
	);
	let mut x = rect.min.x + 8.0;
	let active = shell.state.active_workspace.as_deref().map(str::to_owned);
	let project = shell.state.active_project().cloned();
	if let Some(project) = project {
		for workspace in &project.workspaces {
			let is_active = active.as_deref() == Some(workspace.id.as_str());
			let text_width = (display_cols(&workspace.name) as f32 * 7.4).min(150.0);
			let width = text_width + 40.0;
			let tab = Rect::from_min_max(
				pos2(x, rect.min.y + theme::TOPBAR_H - 32.0 - 1.0),
				pos2(x + width, rect.max.y),
			);
			let close =
				Rect::from_min_size(pos2(tab.max.x - 24.0, tab.center().y - 9.0), vec2(18.0, 18.0));
			let response = ui.interact(tab, ui.id().with(("bigtab", &workspace.id)), Sense::click());
			let close_response =
				ui.interact(close, ui.id().with(("bigtab-close", &workspace.id)), Sense::click());
			if is_active {
				ui.painter().rect_filled(
					Rect::from_min_max(tab.min, pos2(tab.max.x, tab.max.y)),
					CornerRadius { nw: theme::R_PANEL, ne: theme::R_PANEL, sw: 0, se: 0 },
					theme::GROUND,
				);
				ui.painter().rect_stroke(
					Rect::from_min_max(tab.min, pos2(tab.max.x, tab.min.y + 32.0)),
					CornerRadius { nw: theme::R_PANEL, ne: theme::R_PANEL, sw: 0, se: 0 },
					Stroke::new(1.0, theme::BORDER),
					egui::StrokeKind::Inside,
				);
			} else if response.hovered() {
				ui.painter().rect_filled(
					Rect::from_min_max(tab.min, pos2(tab.max.x, tab.max.y)),
					CornerRadius { nw: theme::R_PANEL, ne: theme::R_PANEL, sw: 0, se: 0 },
					theme::PANEL_3,
				);
			}
			truncated_text(
				ui,
				pos2(tab.min.x + 12.0, tab.center().y),
				&workspace.name,
				12.0,
				if is_active {
					theme::TEXT
				} else {
					theme::TEXT_3
				},
				text_width,
			);
			let close_ink = if close_response.hovered() {
				theme::TEXT
			} else {
				theme::TEXT_3
			};
			if close_response.hovered() {
				ui.painter()
					.rect_filled(close, CornerRadius::same(3), theme::PANEL_4);
			}
			paint(ui.painter(), Icon::X, close.shrink(3.0), close_ink, 1.4);
			if close_response.clicked() {
				let id = workspace.id.clone();
				shell.state.act(|s| s.close_workspace(&id));
			} else if response.clicked() {
				let id = workspace.id.clone();
				shell.state.act(|s| s.select_workspace(&id));
			}
			x += width + 2.0;
		}
	}
	let plus_rect = Rect::from_center_size(pos2(x + 14.0, rect.center().y), vec2(28.0, 28.0));
	let mut child = ui.new_child(egui::UiBuilder::new().max_rect(plus_rect));
	if icon_button(&mut child, Icon::Plus, 28.0, false, "在大标签页新建工作区").clicked() {
		let project_id = shell.state.active_project.clone();
		match project_id {
			Some(id) => shell.state.act(|s| s.new_workspace(&id)),
			None => shell
				.state
				.show(crate::state::Notice("先选择一个项目".to_owned())),
		}
	}
}

/// `.ws-toolstrip` — 新建终端 / 分屏 / 列数.
fn tool_strip(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	if rect.height() <= 1.0 {
		return;
	}
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.max.y - 0.5), pos2(rect.max.x, rect.max.y - 0.5)],
		Stroke::new(1.0, theme::BORDER),
	);
	let mut left = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_max(
				pos2(rect.min.x + 8.0, rect.min.y),
				pos2(rect.max.x - 120.0, rect.max.y),
			))
			.layout(Layout::left_to_right(Align::Center)),
	);
	if tool_button(&mut left, Icon::Term, "新建终端").clicked() {
		shell.state.act(|s| s.new_term());
	}
	if tool_button(&mut left, Icon::Split, "分屏").clicked() {
		shell.state.act(|s| s.new_pane());
	}
	let mut right = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_max(
				pos2(rect.max.x - 120.0, rect.min.y),
				pos2(rect.max.x - 8.0, rect.max.y),
			))
			.layout(Layout::right_to_left(Align::Center)),
	);
	let cols = shell.state.active_cols();
	let frame = egui::Frame::new()
		.fill(theme::PANEL_2)
		.stroke(Stroke::new(1.0, theme::BORDER))
		.inner_margin(egui::Margin::same(0));
	frame.show(&mut right, |ui| {
		// Same reason as the view switch: the parent here is right-to-left.
		ui.with_layout(Layout::left_to_right(Align::Center), |ui| {
			ui.spacing_mut().item_spacing.x = 0.0;
			for columns in [1u8, 2, 3] {
				let (rect, response) = ui.allocate_exact_size(vec2(26.0, 24.0), Sense::click());
				let on = cols == columns;
				if on {
					ui.painter()
						.rect_filled(rect, CornerRadius::ZERO, theme::PANEL_4);
				} else if response.hovered() {
					ui.painter()
						.rect_filled(rect, CornerRadius::ZERO, theme::PANEL_3);
				}
				let ink = if on { theme::TEXT } else { theme::TEXT_3 };
				paint(ui.painter(), Icon::Columns(columns), rect.shrink(6.0), ink, 1.5);
				let tooltip = match columns {
					1 => "单列",
					2 => "两列",
					_ => "三列",
				};
				if response.on_hover_text(tooltip).clicked() {
					shell.state.act(|s| s.set_cols(columns));
				}
			}
		});
	});
}

fn tool_button(ui: &mut Ui, icon: Icon, label: &str) -> egui::Response {
	let font = egui::FontId::new(12.0, egui::FontFamily::Proportional);
	let galley = ui
		.painter()
		.layout_no_wrap(label.to_owned(), font.clone(), theme::TEXT_2);
	let width = galley.size().x + 14.0 + 6.0 + 18.0;
	let (rect, response) = ui.allocate_exact_size(vec2(width, 24.0), Sense::click());
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_2);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(theme::R_CONTROL),
		Stroke::new(1.0, theme::BORDER),
		egui::StrokeKind::Inside,
	);
	if response.hovered() {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
	}
	paint(
		ui.painter(),
		icon,
		Rect::from_center_size(pos2(rect.min.x + 8.0 + 7.0, rect.center().y), vec2(14.0, 14.0)),
		theme::TEXT_3,
		1.5,
	);
	ui.painter().text(
		pos2(rect.min.x + 8.0 + 14.0 + 6.0, rect.center().y),
		egui::Align2::LEFT_CENTER,
		label,
		font,
		if response.hovered() {
			theme::TEXT
		} else {
			theme::TEXT_2
		},
	);
	response
}

/// `.ws-body`.
fn body_region(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::GROUND);
	if shell.state.active_workspace().is_none() {
		welcome(ui, shell);
		return;
	}
	let panes: Vec<Pane> = shell.state.visible_panes().to_vec();
	if panes.is_empty() {
		welcome(ui, shell);
		return;
	}
	let count = panes.len() as f32;
	let gap = 1.0;
	let width = (rect.width() - gap * (count - 1.0)) / count;
	// The 1px gaps are painted as the grid's own border colour, as `.panes` does.
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::BORDER);
	for (index, pane) in panes.iter().enumerate() {
		let x = rect.min.x + index as f32 * (width + gap);
		let pane_rect = Rect::from_min_size(pos2(x, rect.min.y), vec2(width, rect.height()));
		let mut child = ui.new_child(egui::UiBuilder::new().max_rect(pane_rect));
		pane_region(&mut child, shell, pane);
	}
}

fn pane_region(ui: &mut Ui, shell: &mut Shell, pane: &Pane) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	let strip = Rect::from_min_size(rect.min, vec2(rect.width(), theme::TABSTRIP_H));
	let body = Rect::from_min_max(pos2(rect.min.x, strip.max.y), rect.max);
	session_strip(ui, shell, pane, strip);
	let mut child = ui.new_child(egui::UiBuilder::new().max_rect(body));
	pane_body(&mut child, shell, pane);
}

/// One pane's session-tab strip: the tabs, their ✕, ＋ and the pane's ✕.
fn session_strip(ui: &mut Ui, shell: &mut Shell, pane: &Pane, strip: Rect) {
	ui.painter()
		.rect_filled(strip, CornerRadius::ZERO, theme::PANEL_2);
	ui.painter().line_segment(
		[pos2(strip.min.x, strip.max.y - 0.5), pos2(strip.max.x, strip.max.y - 0.5)],
		Stroke::new(1.0, theme::BORDER),
	);
	let mut x = strip.min.x + 6.0;
	let reserved = 60.0;
	for tab in &pane.tabs {
		let icon = match tab.kind {
			SessionKind::Term => Icon::Term,
			SessionKind::Editor => Icon::Code,
			SessionKind::Diff => Icon::Diff,
		};
		let is_active = tab.id == pane.active;
		let text_width = (display_cols(&tab.title) as f32 * 7.2).min(120.0);
		let width = text_width + 46.0;
		if x + width > strip.max.x - reserved {
			break;
		}
		let tab_rect = Rect::from_min_size(pos2(x, strip.min.y + 3.5), vec2(width, 28.0));
		let close = Rect::from_min_size(
			pos2(tab_rect.max.x - 20.0, tab_rect.center().y - 8.0),
			vec2(16.0, 16.0),
		);
		let response = ui.interact(tab_rect, ui.id().with(("stab", &tab.id)), Sense::click());
		let close_response =
			ui.interact(close, ui.id().with(("stab-close", &tab.id)), Sense::click());
		if is_active {
			ui.painter()
				.rect_filled(tab_rect, CornerRadius::same(theme::R_CONTROL), theme::GROUND);
			ui.painter().rect_stroke(
				tab_rect,
				CornerRadius::same(theme::R_CONTROL),
				Stroke::new(1.0, theme::BORDER),
				egui::StrokeKind::Inside,
			);
		} else if response.hovered() {
			ui.painter()
				.rect_filled(tab_rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
		}
		let ink = if is_active {
			theme::TEXT
		} else {
			theme::TEXT_3
		};
		paint(
			ui.painter(),
			icon,
			Rect::from_center_size(
				pos2(tab_rect.min.x + 9.0 + 7.0, tab_rect.center().y),
				vec2(14.0, 14.0),
			),
			if is_active {
				theme::ACCENT_2
			} else {
				theme::TEXT_3
			},
			1.5,
		);
		truncated_text(
			ui,
			pos2(tab_rect.min.x + 9.0 + 14.0 + 6.0, tab_rect.center().y),
			&tab.title,
			12.0,
			ink,
			text_width,
		);
		let close_ink = if close_response.hovered() {
			theme::TEXT
		} else {
			theme::TEXT_3
		};
		if close_response.hovered() {
			ui.painter()
				.rect_filled(close, CornerRadius::same(3), theme::PANEL_4);
		}
		paint(ui.painter(), Icon::X, close.shrink(2.5), close_ink, 1.3);
		if close_response.clicked() {
			let (pane_id, tab_id) = (pane.id.clone(), tab.id.clone());
			shell.state.act(|s| s.close_tab(&pane_id, &tab_id));
		} else if response.clicked() {
			let (pane_id, tab_id) = (pane.id.clone(), tab.id.clone());
			shell.state.select_tab(&pane_id, &tab_id);
		}
		x += width + 2.0;
	}
	let plus = Rect::from_center_size(pos2(strip.max.x - 46.0, strip.center().y), vec2(28.0, 28.0));
	let mut plus_ui = ui.new_child(egui::UiBuilder::new().max_rect(plus));
	if icon_button(&mut plus_ui, Icon::Plus, 28.0, false, "新建小标签页").clicked() {
		let pane_id = pane.id.clone();
		shell.state.act(|s| s.add_tab(&pane_id));
	}
	let close_pane =
		Rect::from_center_size(pos2(strip.max.x - 18.0, strip.center().y), vec2(28.0, 28.0));
	let mut close_ui = ui.new_child(egui::UiBuilder::new().max_rect(close_pane));
	if icon_button(&mut close_ui, Icon::X, 28.0, false, "关闭面板").clicked() {
		let pane_id = pane.id.clone();
		shell.state.act(|s| s.close_pane(&pane_id));
	}
}

/// The active session tab's body.
fn pane_body(ui: &mut Ui, shell: &mut Shell, pane: &Pane) {
	let Some(tab) = pane.active_tab() else {
		return;
	};
	let tab = tab.clone();
	match seed::sample_for(tab.kind, &tab.id) {
		Sample::Term(kind) => term_body(ui, shell, pane, &tab, kind),
		Sample::Editor => editor_body(ui, shell),
		Sample::Diff => diff_body(ui),
	}
}

/// A terminal pane: the `.termsub` chip row over a blitted ratatui buffer.
fn term_body(ui: &mut Ui, shell: &mut Shell, pane: &Pane, tab: &SessionTab, kind: seed::TermKind) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::TERM_BG);
	let sub = Rect::from_min_size(rect.min, vec2(rect.width(), 30.0));
	ui.painter()
		.rect_filled(sub, CornerRadius::ZERO, theme::TERM_SUB_BG);
	ui.painter().line_segment(
		[pos2(sub.min.x, sub.max.y - 0.5), pos2(sub.max.x, sub.max.y - 0.5)],
		Stroke::new(1.0, theme::BORDER),
	);
	// The sub-chips are this pane's terminal sessions: clicking one switches
	// the session tab, and ＋ opens another — the same actions as the strip
	// above, which is what the spec's `.termsub` is for.
	let mut chips = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(sub.shrink2(vec2(8.0, 5.0)))
			.layout(Layout::left_to_right(Align::Center)),
	);
	for session in pane.tabs.iter().filter(|t| t.kind == SessionKind::Term) {
		let active = session.id == tab.id;
		let label = format!("终端 {}", session.title.trim_start_matches("终端 "));
		let response = chip(&mut chips, &label, if active { Chip::Active } else { Chip::Plain });
		if response.clicked() && !active {
			shell.state.select_tab(&pane.id, &session.id);
		}
	}
	let mut add = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_size(pos2(sub.max.x - 30.0, sub.min.y + 5.0), vec2(20.0, 20.0))),
	);
	if icon_button(&mut add, Icon::Plus, 20.0, false, "新建终端会话").clicked() {
		let pane_id = pane.id.clone();
		shell.state.act(|s| s.add_tab(&pane_id));
	}

	let grid = Rect::from_min_max(pos2(rect.min.x, sub.max.y), rect.max);
	let metrics = GridMetrics::for_panel(ui.ctx(), grid, f32::from(shell.settings.terminal_size));
	let columns = metrics.cols.max(1);
	let path = shell
		.state
		.active_workspace()
		.map(|ws| ws.path.clone())
		.unwrap_or_default();
	let branch = shell.state.branch_label().to_owned();
	let lines = seed::transcript(kind, &path, &branch).len() + 3;
	let rows = (lines as u16 + 1).max(metrics.rows);
	let key = format!("{}|{columns}x{rows}|{:?}", tab.id, kind);
	let paint_settings = shell.settings;
	let buffer = shell
		.term_buffers
		.get_or_render(key, || seed::term_buffer(columns, rows, kind, &path, &branch));
	egui::ScrollArea::vertical()
		.auto_shrink([false, false])
		.show(ui, |ui| {
			let size = vec2(f32::from(columns) * metrics.cell_w, f32::from(rows) * metrics.cell_h);
			let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
			let metrics = GridMetrics {
				origin: rect.min,
				font: metrics.font.clone(),
				cell_w: metrics.cell_w,
				cell_h: metrics.cell_h,
				cols: columns,
				rows,
				font_size: metrics.font_size,
			};
			paint_buffer_with(ui.painter(), buffer, &metrics, theme::TERM_TEXT);
			// The cursor sits on the sample's last prompt line, drawn in the style
			// the 设置 modal picked.
			let last = (lines as u16).saturating_sub(1);
			paint_cursor(
				ui.painter(),
				&metrics,
				ratatui::layout::Position { x: 2, y: last },
				paint_settings.cursor,
			);
		});
}

/// An editor pane: the sample code with the spec's keyword colouring.
fn editor_body(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	let etabs = Rect::from_min_size(rect.min, vec2(rect.width(), 34.0));
	ui.painter()
		.rect_filled(etabs, CornerRadius::ZERO, theme::PANEL_2);
	ui.painter().line_segment(
		[pos2(etabs.min.x, etabs.max.y - 0.5), pos2(etabs.max.x, etabs.max.y - 0.5)],
		Stroke::new(1.0, theme::BORDER),
	);
	truncated_mono(
		ui,
		pos2(etabs.min.x + 10.0, etabs.center().y),
		"src/ui/workspace.rs",
		11.0,
		theme::TEXT_3,
		etabs.width() - 120.0,
	);
	let foot = Rect::from_min_size(pos2(rect.min.x, rect.max.y - 24.0), vec2(rect.width(), 24.0));
	let code = Rect::from_min_max(pos2(rect.min.x, etabs.max.y), pos2(rect.max.x, foot.min.y));

	let banner = seed::placeholder("编辑器窗格未打开文件", "工作区内的只读文本（文件树点击打开）");
	let size = f32::from(shell.settings.editor_size);
	let line_height = (size * 1.6).max(14.0);
	let style = EditorStyle {
		size,
		line_numbers: shell.settings.editor_line_numbers,
		wrap: shell.settings.editor_wrap,
	};
	let mut y = code.min.y + 8.0;
	for (index, line) in banner.iter().enumerate() {
		let used = editor_line(ui, code, y, index as u32 + 1, line, theme::WARN, style);
		y += used.max(line_height);
	}
	y += 4.0;
	for (index, line) in seed::EDITOR_LINES.iter().enumerate() {
		let used =
			editor_line(ui, code, y, index as u32 + banner.len() as u32 + 1, line, theme::TEXT, style);
		y += used.max(line_height);
		if y > code.max.y {
			break;
		}
	}
	ui.painter()
		.rect_filled(foot, CornerRadius::ZERO, theme::PANEL_2);
	ui.painter().line_segment(
		[pos2(foot.min.x, foot.min.y + 0.5), pos2(foot.max.x, foot.min.y + 0.5)],
		Stroke::new(1.0, theme::BORDER),
	);
	for (index, label) in ["Rust", "UTF-8", "LF", "只读占位"].iter().enumerate() {
		ui.painter().text(
			pos2(foot.min.x + 12.0 + index as f32 * 74.0, foot.center().y),
			egui::Align2::LEFT_CENTER,
			*label,
			egui::FontId::new(11.0, egui::FontFamily::Monospace),
			theme::TEXT_3,
		);
	}
	ui.painter().text(
		pos2(foot.max.x - 12.0, foot.center().y),
		egui::Align2::RIGHT_CENTER,
		format!("{size:.0}px"),
		egui::FontId::new(11.0, egui::FontFamily::Monospace),
		theme::TEXT_3,
	);
}

/// How the editor pane draws its rows (设置 → 编辑器: 字号 / 自动换行 / 显示行号).
#[derive(Clone, Copy)]
struct EditorStyle {
	size: f32,
	line_numbers: bool,
	wrap: bool,
}

/// One code row: gutter number plus the sample highlighter's spans.
///
/// Returns the height the row took, so the caller advances by the real height
/// when 自动换行 is on and a long line becomes several rows.
fn editor_line(
	ui: &Ui,
	area: Rect,
	y: f32,
	number: u32,
	line: &str,
	default_ink: Color32,
	style: EditorStyle,
) -> f32 {
	let font = crate::fonts::editor_font_for(ui.ctx(), style.size);
	let mut x = area.min.x + 12.0;
	if style.line_numbers {
		let gutter = area.min.x + 40.0;
		ui.painter().text(
			pos2(gutter, y),
			egui::Align2::RIGHT_TOP,
			number.to_string(),
			font.clone(),
			theme::GUTTER,
		);
		x = gutter + 14.0;
	}
	let spans = highlight(line, default_ink);
	let text: String = spans.iter().map(|(part, _)| part.as_str()).collect();
	let mut byte = 0usize;
	let sections: Vec<egui::text::LayoutSection> = spans
		.iter()
		.map(|(part, color)| {
			let section = egui::text::LayoutSection {
				leading_space: 0.0,
				byte_range: byte..byte + part.len(),
				format: egui::TextFormat { font_id: font.clone(), color: *color, ..Default::default() },
			};
			byte += part.len();
			section
		})
		.collect();
	let job = egui::text::LayoutJob {
		wrap: egui::text::TextWrapping {
			max_width: if style.wrap {
				(area.max.x - x - 8.0).max(24.0)
			} else {
				f32::INFINITY
			},
			break_anywhere: style.wrap,
			..Default::default()
		},
		sections,
		text,
		..Default::default()
	};
	let galley = ui.painter().layout_job(job);
	let height = galley.size().y;
	ui.painter().galley(pos2(x, y), galley, default_ink);
	height
}

/// The spec's `hl()`: comments, strings, numbers, keywords, identifiers.
///
/// The spec does it with one regex; the same split is done here in two passes
/// (cut a trailing `//` comment, then walk the code with a string-state
/// machine) so the result is a list of coloured spans without pulling a regex
/// engine in.
fn highlight(line: &str, default_ink: Color32) -> Vec<(String, Color32)> {
	use crate::theme::syntax;
	let (code, comment) = split_comment(line);
	let mut spans: Vec<(String, Color32)> = Vec::new();
	let mut word = String::new();
	let mut string: Option<char> = None;
	let flush = |word: &mut String, spans: &mut Vec<(String, Color32)>| {
		if word.is_empty() {
			return;
		}
		let color = if seed::KEYWORDS.contains(&word.as_str()) {
			syntax::KEYWORD
		} else if word.chars().all(|ch| ch.is_ascii_digit() || ch == '_') {
			syntax::NUMBER
		} else {
			syntax::IDENT
		};
		spans.push((std::mem::take(word), color));
	};
	for ch in code.chars() {
		if let Some(quote) = string {
			word.push(ch);
			if ch == quote {
				string = None;
				spans.push((std::mem::take(&mut word), syntax::STRING));
			}
			continue;
		}
		match ch {
			'"' | '\'' => {
				flush(&mut word, &mut spans);
				string = Some(ch);
				word.push(ch);
			},
			ch if ch.is_alphanumeric() || ch == '_' => word.push(ch),
			ch => {
				flush(&mut word, &mut spans);
				spans.push((ch.to_string(), default_ink));
			},
		}
	}
	flush(&mut word, &mut spans);
	if !comment.is_empty() {
		spans.push((comment, syntax::COMMENT));
	}
	spans
}

/// `line` split at the first `//` that is not inside a string literal.
fn split_comment(line: &str) -> (String, String) {
	let chars: Vec<char> = line.chars().collect();
	let mut string: Option<char> = None;
	let mut index = 0;
	while index < chars.len() {
		let ch = chars[index];
		if let Some(quote) = string {
			if ch == '\\' {
				index += 1;
			} else if ch == quote {
				string = None;
			}
		} else if ch == '"' || ch == '\'' {
			string = Some(ch);
		} else if ch == '/' && chars.get(index + 1) == Some(&'/') {
			let code: String = chars[..index].iter().collect();
			let comment: String = chars[index..].iter().collect();
			return (code, comment);
		}
		index += 1;
	}
	(line.to_owned(), String::new())
}

/// A diff pane: the spec's `hunk / add / del / ctx` rows.
fn diff_body(ui: &mut Ui) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::TERM_BG);
	let mut y = rect.min.y + 8.0;
	let line_height = 20.0;
	for text in seed::placeholder("diff 窗格未调用 git", "git diff --no-color（只读）") {
		diff_row(ui, rect, y, DiffRow::Context, text.as_str(), theme::WARN);
		y += line_height;
	}
	for (kind, text) in seed::DIFF_LINES.iter() {
		diff_row(ui, rect, y, *kind, text, theme::TEXT);
		y += line_height;
		if y > rect.max.y {
			break;
		}
	}
}

fn diff_row(ui: &Ui, area: Rect, y: f32, kind: DiffRow, text: &str, _default: Color32) {
	let (sign, ink, background) = match kind {
		DiffRow::Hunk => ('@', theme::ACCENT_2, Some(theme::ACCENT.gamma_multiply(0.08))),
		DiffRow::Add => {
			('+', Color32::from_rgb(0xa9, 0xe6, 0xb4), Some(theme::ADD.gamma_multiply(0.09)))
		},
		DiffRow::Del => {
			('-', Color32::from_rgb(0xf0, 0xb6, 0xb2), Some(theme::DEL.gamma_multiply(0.09)))
		},
		DiffRow::Context => (' ', Color32::from_rgb(0x9a, 0xa3, 0xb0), None),
	};
	let row = Rect::from_min_size(pos2(area.min.x, y), vec2(area.width(), 20.0));
	if let Some(fill) = background {
		ui.painter().rect_filled(row, CornerRadius::ZERO, fill);
	}
	let font = crate::fonts::editor_font_for(ui.ctx(), theme::MONO_SIZE);
	ui.painter().text(
		pos2(row.min.x + 12.0, row.min.y),
		egui::Align2::LEFT_TOP,
		sign.to_string(),
		font.clone(),
		theme::GUTTER,
	);
	let galley = ui.painter().layout_no_wrap(text.to_owned(), font, ink);
	ui.painter()
		.galley(pos2(row.min.x + 28.0, row.min.y), galley, ink);
}

/// The welcome panel (spec `welcomeHTML`).
fn welcome(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	let centre = rect.center();
	let mark = Rect::from_center_size(pos2(centre.x, centre.y - 130.0), vec2(64.0, 64.0));
	crate::chrome::gradient_mark(ui, mark, "Z");
	ui.painter().text(
		pos2(centre.x, mark.max.y + 18.0),
		egui::Align2::CENTER_CENTER,
		"zetawork",
		egui::FontId::new(26.0, egui::FontFamily::Proportional),
		theme::TEXT,
	);
	ui.painter().text(
		pos2(centre.x, mark.max.y + 46.0),
		egui::Align2::CENTER_CENTER,
		"在左侧选择一个项目或工作区开始",
		egui::FontId::new(13.0, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	let cta_y = mark.max.y + 88.0;
	let mut open_btn = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_center_size(pos2(centre.x - 80.0, cta_y), vec2(140.0, 34.0)))
			.layout(Layout::left_to_right(Align::Center)),
	);
	if wide_button(&mut open_btn, Icon::Plus, "添加项目", false).clicked() {
		shell.state.show(crate::state::Notice(
			"添加项目：项目注册表尚未接入（未来数据源：zetawork 项目注册表）".to_owned(),
		));
	}
	let mut new_btn = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_center_size(pos2(centre.x + 80.0, cta_y), vec2(140.0, 34.0)))
			.layout(Layout::left_to_right(Align::Center)),
	);
	if wide_button(&mut new_btn, Icon::Folder, "打开工作区", true).clicked() {
		if let Some(id) = shell
			.state
			.active_project()
			.and_then(|p| p.workspaces.first())
			.map(|w| w.id.clone())
		{
			shell.state.act(|s| s.select_workspace(&id));
		}
	}
	let shortcuts = [("创建工作区", "⌘ N"), ("打开项目", "⌘ O"), ("切换大标签页", "⌃ Tab")];
	let mut y = cta_y + 44.0;
	for (label, keys) in shortcuts {
		ui.painter().text(
			pos2(centre.x - 190.0, y),
			egui::Align2::LEFT_CENTER,
			label,
			egui::FontId::new(12.5, egui::FontFamily::Proportional),
			theme::TEXT_2,
		);
		let rect = Rect::from_center_size(pos2(centre.x + 160.0, y), vec2(60.0, 20.0));
		ui.painter()
			.rect_filled(rect, CornerRadius::same(5), theme::PANEL_3);
		ui.painter().rect_stroke(
			rect,
			CornerRadius::same(5),
			Stroke::new(1.0, theme::BORDER),
			egui::StrokeKind::Inside,
		);
		ui.painter().text(
			rect.center(),
			egui::Align2::CENTER_CENTER,
			keys,
			egui::FontId::new(11.0, egui::FontFamily::Monospace),
			theme::TEXT_2,
		);
		y += 30.0;
	}
	let line = Rect::from_min_size(pos2(centre.x - 190.0, y - 22.0), vec2(380.0, 1.0));
	ui.painter()
		.line_segment([line.min, pos2(line.max.x, line.min.y)], Stroke::new(1.0, theme::BORDER));
}

/// The welcome panel's `.btn`.
fn wide_button(ui: &mut Ui, icon: Icon, label: &str, primary: bool) -> egui::Response {
	let (rect, response) = ui.allocate_exact_size(vec2(140.0, 34.0), Sense::click());
	let fill = if primary {
		theme::BRAND_A
	} else {
		theme::PANEL_2
	};
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), fill);
	if !primary {
		ui.painter().rect_stroke(
			rect,
			CornerRadius::same(theme::R_CONTROL),
			Stroke::new(1.0, theme::BORDER_2),
			egui::StrokeKind::Inside,
		);
	}
	let ink = if primary { Color32::WHITE } else { theme::TEXT };
	paint(
		ui.painter(),
		icon,
		Rect::from_center_size(pos2(rect.min.x + 14.0 + 7.5, rect.center().y), vec2(15.0, 15.0)),
		ink,
		1.5,
	);
	ui.painter().text(
		pos2(rect.min.x + 14.0 + 15.0 + 8.0, rect.center().y),
		egui::Align2::LEFT_CENTER,
		label,
		egui::FontId::new(13.0, egui::FontFamily::Proportional),
		ink,
	);
	if response.hovered() {
		ui.painter().rect_stroke(
			rect,
			CornerRadius::same(theme::R_CONTROL),
			Stroke::new(1.0, theme::BORDER_2),
			egui::StrokeKind::Inside,
		);
	}
	response
}

/// The buffer cache lives on the shell so a pane does not re-render its sample
/// transcript every frame.
pub type TermBuffers = BufferCache;

/// How many grid columns a string occupies: the *display* width, so a wide CJK
/// glyph counts as two. Every width estimate in the shell goes through this,
/// because `chars().count()` would under-size a Chinese label and let the text
/// after it start on top of it.
pub fn display_cols(text: &str) -> usize {
	unicode_width::UnicodeWidthStr::width(text)
}
