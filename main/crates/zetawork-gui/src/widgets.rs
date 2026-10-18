// SPDX-License-Identifier: AGPL-3.0-only
//! Small shared pieces of the shell's look: chips, list rows, heads and the
//! label/hint/control row the settings modal is built from.
//!
//! These exist so the panels spell a `.chip` or a `.rp-head` once, the way the
//! spec's stylesheet spells it once, instead of repeating the geometry in every
//! panel.

use egui::{
	Align2, Color32, CornerRadius, FontId, Pos2, Rect, Response, Sense, Stroke, Ui, pos2, vec2,
};

use crate::{
	icons::{Icon, paint},
	status::RunState,
	theme,
};

/// The 状态词表's dot: a 7 pt disc in the state's own ink.
///
/// `None` draws **nothing**: an unknown state is not a colour, and a dim disc
/// would read as one of the seven. The colour and the word both come from
/// [`RunState`], so the left column's workspace rows and the 总面板's 状态
/// column cannot drift apart — which is the whole reason this is here rather
/// than painted twice.
pub fn status_dot(ui: &Ui, centre: Pos2, state: Option<RunState>) {
	let Some(state) = state else {
		return;
	};
	ui.painter().circle_filled(centre, 3.5, state.ink());
}

/// The 状态词表's word at a vertical centre, in the state's ink, clipped to
/// `available`. `None` reads `—`, the same as every other column without a
/// source.
pub fn status_word(ui: &Ui, at: Pos2, state: Option<RunState>, size: f32, available: f32) {
	match state {
		Some(state) => truncated_text(ui, at, state.word(), size, state.ink(), available),
		None => truncated_text(ui, at, "—", size, theme::TEXT_3, available),
	}
}

/// The tooltip that explains a state — or why there is none.
///
/// The seven words are deliberately terse, so the meaning the contract spells
/// out ("说自己干完了，但没验证 —— 不等于 done") is only reachable here.
pub fn status_tooltip(state: Option<RunState>) -> String {
	match state {
		Some(state) => format!("{} — {}", state.word(), state.meaning()),
		None => "还没有会话状态".to_owned(),
	}
}

/// Which `.chip` variant to draw.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Chip {
	/// `.chip` — neutral grey.
	Plain,
	/// `.chip.branch` — the cyan branch chip.
	Branch,
	/// `.chip.is-active` — the selected terminal sub-chip.
	Active,
}

/// A `.chip`: 18pt tall, 4pt radius, 11pt text.
pub fn chip(ui: &mut Ui, label: &str, kind: Chip) -> Response {
	let font = FontId::new(11.0, egui::FontFamily::Monospace);
	let galley = ui
		.painter()
		.layout_no_wrap(label.to_owned(), font, theme::TEXT_3);
	let size = vec2(galley.size().x + 12.0, 18.0);
	let (rect, response) = ui.allocate_exact_size(size, Sense::hover());
	let (ink, fill, border) = match kind {
		Chip::Plain => (theme::TEXT_3, theme::PANEL_3, theme::BORDER),
		Chip::Branch => (theme::CHIP_BRANCH_INK, theme::CHIP_BRANCH_BG, theme::CHIP_BRANCH_BORDER),
		Chip::Active => (theme::TEXT, theme::PANEL_4, theme::BORDER_2),
	};
	ui.painter().rect_filled(rect, CornerRadius::same(4), fill);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(4),
		Stroke::new(1.0_f32, border),
		egui::StrokeKind::Inside,
	);
	ui.painter().text(
		rect.center(),
		Align2::CENTER_CENTER,
		label,
		FontId::new(11.0, egui::FontFamily::Monospace),
		ink,
	);
	response
}

/// A small status badge (`.badge.m`, `.badge.u`).
pub fn badge(ui: &mut Ui, label: &str, warn: bool) {
	let (rect, _) = ui.allocate_exact_size(vec2(16.0, 14.0), Sense::hover());
	let (ink, fill) = if warn {
		(theme::WARN, theme::WARN.gamma_multiply(0.14))
	} else {
		(theme::TEXT_2, theme::TEXT_3.gamma_multiply(0.16))
	};
	ui.painter().rect_filled(rect, CornerRadius::same(3), fill);
	ui.painter().text(
		rect.center(),
		Align2::CENTER_CENTER,
		label,
		FontId::new(10.0, egui::FontFamily::Proportional),
		ink,
	);
}
/// A `.footbtn`: icon over a short label, used by 设置 / 帮助 / 聚焦.
pub fn foot_button(ui: &mut Ui, icon: Icon, label: &str) -> Response {
	let font = FontId::new(12.0, egui::FontFamily::Proportional);
	let width = if label.is_empty() {
		30.0
	} else {
		let galley = ui
			.painter()
			.layout_no_wrap(label.to_owned(), font.clone(), theme::TEXT_2);
		15.0 + 6.0 + galley.size().x + 18.0
	};
	let (rect, response) = ui.allocate_exact_size(vec2(width, 30.0), Sense::click());
	let hovered = response.hovered();
	if hovered {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
		ui.painter().rect_stroke(
			rect,
			CornerRadius::same(theme::R_CONTROL),
			Stroke::new(1.0_f32, theme::BORDER),
			egui::StrokeKind::Inside,
		);
	}
	let ink = if hovered { theme::TEXT } else { theme::TEXT_2 };
	let icon_rect =
		Rect::from_center_size(pos2(rect.min.x + 8.0 + 7.5, rect.center().y), vec2(15.0, 15.0));
	paint(ui.painter(), icon, icon_rect, theme::TEXT_3, 1.5);
	if !label.is_empty() {
		ui.painter().text(
			pos2(rect.min.x + 8.0 + 15.0 + 6.0, rect.center().y),
			Align2::LEFT_CENTER,
			label,
			font,
			ink,
		);
	}
	response
}

/// A pane/section head (`.rp-head`): uppercase-ish label, plus room for
/// buttons the caller draws itself.
pub fn panel_head(ui: &mut Ui, label: &str, right: impl FnOnce(&mut Ui)) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 32.0), Sense::hover());
	ui.painter().text(
		pos2(rect.min.x + 4.0, rect.center().y),
		Align2::LEFT_CENTER,
		label,
		FontId::new(11.0, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	let mut child = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_max(pos2(rect.max.x - 140.0, rect.min.y), rect.max))
			.layout(egui::Layout::right_to_left(egui::Align::Center)),
	);
	right(&mut child);
}

/// A galley for `text`, shortened with an ellipsis until it fits `available`.
fn fitted(
	ui: &Ui,
	text: &str,
	font: &FontId,
	color: Color32,
	available: f32,
) -> std::sync::Arc<egui::Galley> {
	let mut text = text.to_owned();
	let mut galley = ui
		.painter()
		.layout_no_wrap(text.clone(), font.clone(), color);
	if galley.size().x > available && available > 8.0 {
		while !text.is_empty() && galley.size().x > available {
			text.pop();
			galley = ui
				.painter()
				.layout_no_wrap(format!("{text}…"), font.clone(), color);
		}
	}
	galley
}

/// Text clipped to `available` points, with an ellipsis when it does not fit.
pub fn truncated_text(
	ui: &Ui,
	at: egui::Pos2,
	text: &str,
	size: f32,
	color: Color32,
	available: f32,
) {
	let font = FontId::new(size, egui::FontFamily::Proportional);
	let galley = fitted(ui, text, &font, color, available);
	ui.painter()
		.galley(pos2(at.x, at.y - galley.size().y / 2.0), galley, color);
}

/// [`truncated_text`] ending at `right` instead of starting at `left`: the
/// right-hand columns of a row or chart title use this so a long value cannot
/// paint past the panel's edge.
pub fn truncated_text_right(
	ui: &Ui,
	right: f32,
	centre_y: f32,
	text: &str,
	size: f32,
	color: Color32,
	available: f32,
) {
	let font = FontId::new(size, egui::FontFamily::Proportional);
	let galley = fitted(ui, text, &font, color, available);
	let width = galley.size().x;
	ui.painter()
		.galley(pos2(right - width, centre_y - galley.size().y / 2.0), galley, color);
}

/// [`truncated_text`] centred on `centre_x`.
pub fn truncated_text_center(
	ui: &Ui,
	centre_x: f32,
	centre_y: f32,
	text: &str,
	size: f32,
	color: Color32,
	available: f32,
) {
	let font = FontId::new(size, egui::FontFamily::Proportional);
	let galley = fitted(ui, text, &font, color, available);
	let width = galley.size().x;
	ui.painter().galley(
		pos2(centre_x - width / 2.0, centre_y - galley.size().y / 2.0),
		galley,
		color,
	);
}

/// Mono text clipped to `available` points.
pub fn truncated_mono(
	ui: &Ui,
	at: egui::Pos2,
	text: &str,
	size: f32,
	color: Color32,
	available: f32,
) {
	let font = FontId::new(size, egui::FontFamily::Monospace);
	let mut text = text.to_owned();
	let mut galley = ui
		.painter()
		.layout_no_wrap(text.clone(), font.clone(), color);
	if galley.size().x > available && available > 8.0 {
		while !text.is_empty() && galley.size().x > available {
			text.pop();
			galley = ui
				.painter()
				.layout_no_wrap(format!("{text}…"), font.clone(), color);
		}
	}
	ui.painter()
		.galley(pos2(at.x, at.y - galley.size().y / 2.0), galley, color);
}

/// The one quiet line a panel shows when it has nothing to list.
///
/// The line is clipped to the card's own width: a note whose headline carries a
/// tool's error (a `fatal:` dump, a missing path) must end in an ellipsis at
/// the panel edge, never be painted past it.
pub fn empty_note(ui: &mut Ui, headline: &str) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 44.0), Sense::hover());
	let painter = ui.painter();
	painter.rect_filled(rect, CornerRadius::same(theme::R_PANEL), theme::PANEL_2);
	painter.rect_stroke(
		rect,
		CornerRadius::same(theme::R_PANEL),
		Stroke::new(1.0_f32, theme::BORDER),
		egui::StrokeKind::Inside,
	);
	let available = (rect.width() - 20.0).max(0.0);
	truncated_text(
		ui,
		pos2(rect.min.x + 10.0, rect.center().y),
		headline,
		12.5,
		theme::TEXT_2,
		available,
	);
}
