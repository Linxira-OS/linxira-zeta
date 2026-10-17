// SPDX-License-Identifier: AGPL-3.0-only
//! Window chrome: the custom title bar and the resize border.
//!
//! The window is frameless (`decorations: false`), so the shell owes the user
//! three things the OS would otherwise draw: a title bar, the window buttons,
//! and a working resize border. The title bar carries the brand, the current
//! workspace/branch, the 视图 GUI/TUI switch, and 最小化 / 最大化(还原) / 关闭 —
//! which is also why the right column starts *below* it rather than at the top
//! edge: the top-right strip belongs to the window controls.

use egui::{
	Align, Color32, CornerRadius, Id, Layout, Order, Rect, Sense, Stroke, Ui, ViewportCommand, pos2,
	vec2,
};

use crate::Shell;
use crate::icons::{Icon, paint};
use crate::theme;

/// Height of the window-control buttons; the width is Windows-like.
const CONTROL_W: f32 = 44.0;

/// Draw the title bar. Call from a `TopBottomPanel::top` of
/// [`theme::TITLE_BAR_H`].
pub fn title_bar(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	let painter = ui.painter().clone();
	painter.rect_filled(rect, CornerRadius::ZERO, theme::PANEL_2);
	painter.line_segment(
		[pos2(rect.min.x, rect.max.y - 0.5), pos2(rect.max.x, rect.max.y - 0.5)],
		Stroke::new(1.0, theme::BORDER),
	);

	// The whole bar drags the window; the controls inside are separate widgets
	// and win the pointer.
	let drag = ui.interact(rect, Id::new("zetawork-titlebar-drag"), Sense::click_and_drag());
	if drag.dragged() {
		ui.ctx().send_viewport_cmd(ViewportCommand::StartDrag);
	}
	if drag.double_clicked() {
		toggle_maximize(ui);
	}

	// Right: the window controls. 视图 GUI/TUI is *not* here — it switches what
	// the centre draws, so it lives at the end of the centre's 大标签页 strip
	// (`center::big_tabs`), where the information-surface draft puts it.
	ui.scope_builder(egui::UiBuilder::new().max_rect(rect.shrink2(vec2(6.0, 0.0))), |ui| {
		ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
			window_controls(ui, shell);
		});
	});

	// Left: brand, presence, current workspace/branch.
	ui.scope_builder(egui::UiBuilder::new().max_rect(rect.shrink2(vec2(10.0, 0.0))), |ui| {
		ui.with_layout(Layout::left_to_right(Align::Center), |ui| {
			let (mark_rect, _) = ui.allocate_exact_size(vec2(22.0, 22.0), Sense::hover());
			gradient_mark(ui, mark_rect, "Z");
			ui.add_space(4.0);
			ui.label(
				egui::RichText::new("zetawork")
					.size(13.0)
					.strong()
					.color(theme::TEXT),
			);
			let (dot, _) = ui.allocate_exact_size(vec2(7.0, 7.0), Sense::hover());
			ui.painter().circle_filled(dot.center(), 3.5, theme::ADD);
			ui.add_space(6.0);
			ui.label(
				egui::RichText::new(crate::APP_SUBTITLE)
					.size(11.5)
					.color(theme::TEXT_3),
			);
			ui.add_space(10.0);
			let label = format!("{} · {}", shell.state.workspace_label(), shell.state.branch_label());
			ui.label(egui::RichText::new(label).size(12.0).color(theme::TEXT_2));
		});
	});
}

/// The brand mark: a rounded gradient tile with the product's initial, as the
/// spec's `.mark` / `.welcome .wmark`.
pub fn gradient_mark(ui: &Ui, rect: Rect, letter: &str) {
	let painter = ui.painter();
	painter.rect_filled(rect, CornerRadius::same(5), theme::BRAND_A);
	// The CSS is a 150° gradient; eight horizontal bands read the same at this
	// size and need no mesh.
	let bands = 8;
	for band in 0..bands {
		let t0 = band as f32 / bands as f32;
		let t1 = (band + 1) as f32 / bands as f32;
		let top = rect.min.y + rect.height() * t0;
		let bottom = rect.min.y + rect.height() * t1;
		let band_rect = Rect::from_min_max(
			pos2(rect.min.x + 1.0, top),
			pos2(rect.max.x - 1.0, bottom.min(rect.max.y - 1.0)),
		);
		if band_rect.height() <= 0.0 {
			continue;
		}
		let mix = band as f32 / (bands - 1) as f32;
		let color = lerp(theme::BRAND_A, theme::BRAND_B, mix);
		painter.rect_filled(band_rect, CornerRadius::ZERO, color);
	}
	painter.text(
		rect.center(),
		egui::Align2::CENTER_CENTER,
		letter,
		egui::FontId::new(12.0, egui::FontFamily::Monospace),
		Color32::from_rgb(0x06, 0x12, 0x1f),
	);
}

#[allow(clippy::needless_range_loop)]
fn lerp(from: Color32, to: Color32, t: f32) -> Color32 {
	let mix = |a: u8, b: u8| (f32::from(a) + (f32::from(b) - f32::from(a)) * t).round() as u8;
	Color32::from_rgb(mix(from.r(), to.r()), mix(from.g(), to.g()), mix(from.b(), to.b()))
}

/// 最小化 / 最大化(还原) / 关闭.
///
/// 视图 GUI/TUI is not here: it switches what the *centre* draws, so it lives
/// at the end of the centre's 大标签页 strip (`center::big_tabs`), which is where
/// the information-surface draft puts it.
fn window_controls(ui: &mut Ui, shell: &mut Shell) {
	let maximized = ui.ctx().input(|i| i.viewport().maximized.unwrap_or(false));
	let height = ui.available_height().max(theme::TITLE_BAR_H);
	let close = chrome_button(ui, Icon::X, "关闭", true, height);
	if close.clicked() {
		// 关闭窗口时 decides: 最小化到后台 / 退出应用 / 每次询问. The title bar has
		// no policy of its own — see `crate::lifecycle::request_close`.
		crate::lifecycle::request_close(ui.ctx(), shell);
	}
	let maximize_icon = if maximized {
		Icon::Restore
	} else {
		Icon::Maximize
	};
	let label = if maximized {
		"向下还原"
	} else {
		"最大化"
	};
	let toggle = chrome_button(ui, maximize_icon, label, false, height);
	if toggle.clicked() {
		toggle_maximize(ui);
	}
	let minimize = chrome_button(ui, Icon::Minimize, "最小化", false, height);
	if minimize.clicked() {
		ui.ctx().send_viewport_cmd(ViewportCommand::Minimized(true));
	}
}

fn toggle_maximize(ui: &Ui) {
	let maximized = ui.ctx().input(|i| i.viewport().maximized.unwrap_or(false));
	ui.ctx()
		.send_viewport_cmd(ViewportCommand::Maximized(!maximized));
}

/// One window-control button: a flat cell that fills the bar's height, with the
/// close button's red hover.
fn chrome_button(
	ui: &mut Ui,
	icon: Icon,
	tooltip: &str,
	close: bool,
	height: f32,
) -> egui::Response {
	let (rect, response) = ui.allocate_exact_size(vec2(CONTROL_W, height), Sense::click());
	let hovered = response.hovered();
	if hovered {
		let fill = if close { theme::DEL } else { theme::PANEL_3 };
		ui.painter().rect_filled(rect, CornerRadius::ZERO, fill);
	}
	let ink = if hovered && close {
		Color32::WHITE
	} else {
		theme::TEXT_2
	};
	let box_ = Rect::from_center_size(rect.center(), vec2(11.0, 11.0));
	paint(ui.painter(), icon, box_, ink, if close { 1.4 } else { 1.2 });
	response.on_hover_text(tooltip)
}

/// The resize state: a press on the border is translated into one
/// `BeginResize`, and the window then follows the mouse until release.
#[derive(Default)]
pub struct ResizeState {
	armed: bool,
}

/// The grab band around the window's edge, in points.
const BAND: f32 = 6.0;

/// Handle the resize border.
///
/// Called once per frame before the panels, and skipped while the settings
/// modal is open so the overlay keeps the whole window.
pub fn resize_borders(ctx: &egui::Context, state: &mut ResizeState, modal_open: bool) {
	use egui::viewport::ResizeDirection as Dir;
	if !ctx.input(|i| i.pointer.any_down()) {
		state.armed = false;
	}
	if modal_open {
		return;
	}
	if ctx.input(|i| i.pointer.any_down()) && state.armed {
		return;
	}
	let Some(pos) = ctx.input(|i| i.pointer.hover_pos()) else {
		return;
	};
	let screen = ctx.content_rect();
	let inside = screen.shrink(BAND);
	if inside.contains(pos) {
		return;
	}
	let left = pos.x < inside.min.x;
	let right = pos.x > inside.max.x;
	let top = pos.y < inside.min.y;
	let bottom = pos.y > inside.max.y;
	let direction = match (left, right, top, bottom) {
		(true, _, true, _) => Dir::NorthWest,
		(_, true, true, _) => Dir::NorthEast,
		(true, _, _, true) => Dir::SouthWest,
		(_, true, _, true) => Dir::SouthEast,
		(true, _, _, _) => Dir::West,
		(_, true, _, _) => Dir::East,
		(_, _, true, _) => Dir::North,
		(_, _, _, true) => Dir::South,
		_ => return,
	};
	ctx.set_cursor_icon(cursor_for(direction));
	if ctx.input(|i| i.pointer.any_pressed()) {
		ctx.send_viewport_cmd(ViewportCommand::BeginResize(direction));
		state.armed = true;
	}
}

fn cursor_for(direction: egui::viewport::ResizeDirection) -> egui::CursorIcon {
	use egui::viewport::ResizeDirection as Dir;
	match direction {
		Dir::North | Dir::South => egui::CursorIcon::ResizeVertical,
		Dir::East | Dir::West => egui::CursorIcon::ResizeHorizontal,
		Dir::NorthEast | Dir::SouthWest => egui::CursorIcon::ResizeNeSw,
		Dir::NorthWest | Dir::SouthEast => egui::CursorIcon::ResizeNwSe,
	}
}

/// The toast from the spec's `#toast`: bottom centre, above the status bar.
pub fn toast(ctx: &egui::Context, text: &str) {
	egui::Area::new(Id::new("zetawork-toast"))
		.order(Order::Tooltip)
		.anchor(egui::Align2::CENTER_BOTTOM, vec2(0.0, -(theme::STATUSBAR_H + 22.0)))
		.interactable(false)
		.show(ctx, |ui| {
			egui::Frame::new()
				.fill(theme::PANEL_4)
				.stroke(Stroke::new(1.0, theme::BORDER_2))
				.corner_radius(CornerRadius::same(theme::R_PANEL))
				.inner_margin(egui::Margin::symmetric(16, 9))
				.show(ui, |ui| {
					ui.label(egui::RichText::new(text).size(12.5).color(theme::TEXT));
				});
		});
}
