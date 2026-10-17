// SPDX-License-Identifier: AGPL-3.0-only
//! The footer `.statusbar`: workspace · branch · ↑↓ · 更改 · memory ·
//! throughput · clock.
//!
//! Every number here is either read from the running process or from `git`.
//! Model throughput has no source in this slice, so it renders as `—` with a
//! tooltip naming what would feed it, rather than the spec's sample `301 t/s`.

use egui::{Align, CornerRadius, Layout, Rect, Sense, Stroke, Ui, pos2, vec2};

use crate::Shell;
use crate::icons::{Icon, paint};
use crate::state::RightTab;
use crate::theme;

/// Draw the status bar. Call from a `TopBottomPanel::bottom` of
/// [`theme::STATUSBAR_H`].
pub fn status_bar(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL_2);
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.min.y + 0.5), pos2(rect.max.x, rect.min.y + 0.5)],
		Stroke::new(1.0, theme::BORDER),
	);
	ui.scope_builder(egui::UiBuilder::new().max_rect(rect.shrink2(vec2(8.0, 0.0))), |ui| {
		ui.horizontal_centered(|ui| {
			ui.spacing_mut().item_spacing.x = 2.0;
			let workspace = shell.state.workspace_label().to_owned();
			if item(ui, Some(Icon::Folder), &workspace, false, "回到首页").clicked() {
				shell.state.go_home();
			}
			let branch = shell.state.branch_label().to_owned();
			let git_response = item(ui, Some(Icon::GitBranch), &branch, true, "打开 Git 状态");
			if git_response.clicked() {
				shell.state.set_right_tab(RightTab::Git);
			}
			let ahead = shell.git.as_ref().map(|g| g.ahead).unwrap_or(0);
			let behind = shell.git.as_ref().map(|g| g.behind).unwrap_or(0);
			let tracked = shell.git.as_ref().map(|g| g.changed.len()).unwrap_or(0);
			let counts = shell
				.git
				.as_ref()
				.filter(|g| g.error.is_none())
				.map(|_| format!("↑{ahead} ↓{behind}"))
				.unwrap_or_else(|| "↑— ↓—".to_owned());
			item(ui, None, &counts, true, "与上游的差异（git rev-list --left-right）");
			let changes = if shell.git.as_ref().is_some_and(|g| g.error.is_none()) {
				format!("{tracked}")
			} else {
				"—".to_owned()
			};
			if badge_item(ui, &changes, "更改").clicked() {
				shell.state.set_right_tab(RightTab::Git);
			}

			// 通知留痕: the fallback chain's last link — the one that always
			// happens. It is allocated **before** the right-aligned group on
			// purpose — a `right_to_left` layout consumes the rest of the row,
			// so anything allocated after it lands past the panel and is
			// clipped away.
			if let Some(trace) = shell.last_trace.clone() {
				let line = trace.message.trace_line();
				let hint = crate::notify::trace_hint(&trace);
				let target = trace.message.target.clone();
				if item(ui, None, &line, false, &hint).clicked() {
					match target {
						Some(id) => {
							shell.state.act(|state| state.select_workspace(&id));
						},
						// `AppState::show` is in-place; `act` is for the verbs
						// that hand a Notice back.
						None => shell.state.show(crate::state::Notice(hint.clone())),
					}
				}
			}

			ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
				if item(ui, None, "关闭", false, "收起状态栏").clicked() {
					shell.state.act(|state| state.toggle_statusbar());
				}
				item(ui, None, &clock(), true, "本地时间");
				// 上文: the current conversation's share of its window. The only
				// source is a live session's context report (R16), so with no
				// session it says so instead of drawing a plausible number.
				let context = shell.state.context_label().to_owned();
				item(ui, None, &context, true, CONTEXT_HINT);
				let throughput = shell.throughput.clone().unwrap_or_else(|| "—".to_owned());
				item(ui, None, &throughput, true, crate::THROUGHPUT_HINT);
				item(ui, None, &shell.memory_label(), true, "本进程常驻内存（sysinfo）");
			});
		});
	});
}

/// The tooltip on the 上文 column: what would have to exist for it to show a
/// percentage.
const CONTEXT_HINT: &str =
	"上下文占用：需要一个运行中的会话（数据源：GET /api/agent/<id>/context）";

/// Height of the restore strip the collapsed status bar leaves behind.
pub const STRIP_H: f32 = 16.0;

/// The slim strip shown in place of the status bar after 关闭. It is the way
/// back, so collapsing is never a one-way door.
pub fn strip(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL_2);
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.min.y + 0.5), pos2(rect.max.x, rect.min.y + 0.5)],
		Stroke::new(1.0, theme::BORDER),
	);
	let button = Rect::from_center_size(pos2(rect.center().x, rect.center().y), vec2(40.0, 14.0));
	let mut child = ui.new_child(egui::UiBuilder::new().max_rect(button));
	if chrome_like_button(&mut child, "展开状态栏").clicked() {
		shell.state.act(|state| state.toggle_statusbar());
	}
}

/// The strip's own button: a chevron that points up at the workbench.
fn chrome_like_button(ui: &mut Ui, tooltip: &str) -> egui::Response {
	let (rect, response) = ui.allocate_exact_size(vec2(40.0, 14.0), Sense::click());
	let hovered = response.hovered();
	if hovered {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(3), theme::PANEL_3);
	}
	paint(
		ui.painter(),
		Icon::ChevronDown,
		Rect::from_center_size(rect.center(), vec2(11.0, 11.0)),
		if hovered {
			theme::TEXT_2
		} else {
			theme::TEXT_3
		},
		1.4,
	);
	response.on_hover_text(tooltip)
}

fn clock() -> String {
	chrono::Local::now().format("%H:%M").to_string()
}

/// One `.sb-item`: optional icon, optional mono text.
fn item(ui: &mut Ui, icon: Option<Icon>, text: &str, mono: bool, tooltip: &str) -> egui::Response {
	let font = if mono {
		egui::FontId::new(11.5, egui::FontFamily::Monospace)
	} else {
		egui::FontId::new(11.5, egui::FontFamily::Proportional)
	};
	let galley = ui
		.painter()
		.layout_no_wrap(text.to_owned(), font.clone(), theme::TEXT_3);
	let icon_w = if icon.is_some() { 19.0 } else { 0.0 };
	let width = galley.size().x + icon_w + 16.0;
	let (rect, response) = ui.allocate_exact_size(vec2(width, 22.0), Sense::click());
	let hovered = response.hovered();
	if hovered {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
	}
	let ink = if hovered {
		theme::TEXT_2
	} else {
		theme::TEXT_3
	};
	let mut text_left = rect.min.x + 8.0;
	if let Some(icon) = icon {
		let icon_rect = Rect::from_min_size(pos2(text_left, rect.center().y - 6.5), vec2(13.0, 13.0));
		paint(ui.painter(), icon, icon_rect, ink, 1.4);
		text_left += icon_w;
	}
	let galley = ui.painter().layout_no_wrap(text.to_owned(), font, ink);
	ui.painter()
		.galley(pos2(text_left, rect.center().y - galley.size().y / 2.0), galley, ink);
	if tooltip.is_empty() {
		response
	} else {
		response.on_hover_text(tooltip)
	}
}

/// The `.badge.m` + label pair of the 更改 item.
fn badge_item(ui: &mut Ui, count: &str, label: &str) -> egui::Response {
	let (rect, response) = ui.allocate_exact_size(vec2(96.0, 22.0), Sense::click());
	let hovered = response.hovered();
	if hovered {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
	}
	let badge =
		egui::Rect::from_min_size(pos2(rect.min.x + 8.0, rect.center().y - 8.0), vec2(18.0, 16.0));
	ui.painter()
		.rect_filled(badge, CornerRadius::same(3), theme::WARN.gamma_multiply(0.14));
	ui.painter().text(
		badge.center(),
		egui::Align2::CENTER_CENTER,
		count,
		egui::FontId::new(10.0, egui::FontFamily::Proportional),
		theme::WARN,
	);
	ui.painter().text(
		pos2(badge.max.x + 6.0, rect.center().y),
		egui::Align2::LEFT_CENTER,
		label,
		egui::FontId::new(11.5, egui::FontFamily::Proportional),
		if hovered {
			theme::TEXT_2
		} else {
			theme::TEXT_3
		},
	);
	response.on_hover_text("打开 Git 状态")
}
