// SPDX-License-Identifier: AGPL-3.0-only
//! The 更新 modal: what a check found, and the one 安装 button that acts on it.
//!
//! Opened from the status bar's 检查更新 item. It draws the running version,
//! the newest published desktop release, the installer asset, its size and
//! SHA-256 digest — the same values `crate::updates::DesktopUpdate` parsed from
//! the companion's JSON — and never installs on its own: the click is what
//! starts the download.
//!
//! # Drawing only
//!
//! The modal mutates no data while it paints. Clicks are collected into
//! [`Action`] and applied after the area closes, the same split the 用量
//! container uses, so a headless frame leaves the state exactly as it was.

use crate::t;
use egui::{
	Align, Align2, Color32, CornerRadius, FontId, Layout, Order, Rect, Sense, Stroke, Ui, pos2, vec2,
};

use crate::{
	Shell,
	icons::{Icon, icon_button},
	theme,
	widgets::{truncated_mono, truncated_text},
};

/// The dialog's size, clamped to the window.
const DIALOG: [f32; 2] = [560.0, 400.0];
/// Height of the header and of the footer's button strip.
const HEAD_H: f32 = 52.0;
const FOOT_H: f32 = 56.0;

/// What one frame's clicks asked for.
#[derive(Default)]
struct Action {
	close: bool,
	install: bool,
	retry: bool,
}

/// Draw the modal, if it is open.
pub fn modal(ctx: &egui::Context, shell: &mut Shell) {
	if !shell.state.update_open() {
		return;
	}
	// A worker is running: poll it promptly instead of waiting for the next
	// user input, which is the only thing that would otherwise repaint.
	if shell.updates.busy() {
		ctx.request_repaint_after(std::time::Duration::from_millis(150));
	}
	let screen = ctx.content_rect();
	let mut action = Action::default();
	egui::Area::new(egui::Id::new("zetawork-update-modal"))
		.order(Order::Foreground)
		.fixed_pos(screen.min)
		.show(ctx, |ui| {
			let (backdrop, backdrop_response) = ui.allocate_exact_size(screen.size(), Sense::click());
			ui.painter().rect_filled(
				backdrop,
				CornerRadius::ZERO,
				Color32::from_rgba_unmultiplied(3, 5, 8, 158),
			);
			if backdrop_response.clicked() {
				action.close = true;
			}
			let size =
				vec2(DIALOG[0].min(screen.width() - 48.0), DIALOG[1].min(screen.height() - 48.0));
			let dialog = Rect::from_center_size(screen.center(), size);
			let mut dialog_ui = ui.new_child(egui::UiBuilder::new().max_rect(dialog));
			egui::Frame::new()
				.fill(theme::PANEL)
				.stroke(Stroke::new(1.0_f32, theme::BORDER_2))
				.corner_radius(CornerRadius::same(theme::R_MODAL))
				.show(&mut dialog_ui, |ui| {
					let rect = ui.max_rect();
					ui.painter()
						.rect_filled(rect, CornerRadius::same(theme::R_MODAL), theme::PANEL);
					let head = Rect::from_min_size(rect.min, vec2(rect.width(), HEAD_H));
					ui.painter().line_segment(
						[pos2(head.min.x, head.max.y - 0.5), pos2(head.max.x, head.max.y - 0.5)],
						Stroke::new(1.0_f32, theme::BORDER),
					);
					ui.painter().text(
						pos2(head.min.x + 14.0, head.center().y),
						Align2::LEFT_CENTER,
						t!("更新"),
						FontId::new(14.0, egui::FontFamily::Proportional),
						theme::TEXT,
					);
					let mut head_right = ui.new_child(
						egui::UiBuilder::new()
							.max_rect(head.shrink2(vec2(10.0, 12.0)))
							.layout(Layout::right_to_left(Align::Center)),
					);
					if icon_button(&mut head_right, Icon::X, 28.0, false, t!("取消")).clicked() {
						action.close = true;
					}

					let body = Rect::from_min_max(
						pos2(rect.min.x, head.max.y),
						pos2(rect.max.x, rect.max.y - FOOT_H),
					);
					body_panel(ui, body, shell);

					let footer = Rect::from_min_size(
						pos2(rect.min.x, rect.max.y - FOOT_H),
						vec2(rect.width(), FOOT_H),
					);
					ui.painter().line_segment(
						[pos2(footer.min.x, footer.min.y + 0.5), pos2(footer.max.x, footer.min.y + 0.5)],
						Stroke::new(1.0_f32, theme::BORDER),
					);
					let mut footer_ui = ui.new_child(
						egui::UiBuilder::new()
							.max_rect(footer.shrink2(vec2(14.0, 12.0)))
							.layout(Layout::right_to_left(Align::Center)),
					);
					// Right-to-left: 安装 is allocated first and lands on the
					// right, 取消 immediately left of it.
					let install = button(&mut footer_ui, t!("安装"), true, shell.updates.can_install());
					if install.clicked() {
						action.install = true;
					}
					if button(&mut footer_ui, t!("取消"), false, true).clicked() {
						action.close = true;
					}
					if shell.updates.error().is_some()
						&& button(&mut footer_ui, t!("重试"), false, true).clicked()
					{
						action.retry = true;
					}
				});
		});
	if action.install {
		shell.updates.start_install();
	}
	if action.retry {
		shell.start_update_check();
	}
	if action.close {
		shell.state.close_update();
	}
}

/// The body: one line per answer field, or the state that has no answer yet.
fn body_panel(ui: &Ui, body: Rect, shell: &Shell) {
	let inner = body.shrink2(vec2(14.0, 14.0));
	ui.painter()
		.rect_filled(inner, CornerRadius::same(theme::R_PANEL), theme::GROUND);
	ui.painter().rect_stroke(
		inner,
		CornerRadius::same(theme::R_PANEL),
		Stroke::new(1.0_f32, theme::BORDER),
		egui::StrokeKind::Inside,
	);
	let content = inner.shrink2(vec2(12.0, 10.0));

	if shell.updates.checking() {
		truncated_text(
			ui,
			pos2(content.min.x, content.center().y),
			t!("正在检查…"),
			12.5,
			theme::TEXT_2,
			content.width(),
		);
		return;
	}

	let Some(update) = shell.updates.update() else {
		let message = shell
			.updates
			.error()
			.map(str::to_owned)
			.unwrap_or_else(|| t!("检查更新").to_owned());
		truncated_text(
			ui,
			pos2(content.min.x, content.center().y),
			&message,
			12.0,
			theme::TEXT_2,
			content.width(),
		);
		return;
	};

	let mut y = content.min.y + 12.0;
	field(ui, content, y, t!("当前版本"), &update.current, theme::TEXT);
	y += 28.0;
	if update.available {
		field(ui, content, y, t!("最新版本"), &update.latest, theme::ACCENT);
	} else {
		field(ui, content, y, t!("最新版本"), &update.latest, theme::TEXT_2);
	}
	y += 28.0;
	field(ui, content, y, t!("安装包"), &update.asset, theme::TEXT);
	y += 28.0;
	field(ui, content, y, t!("大小"), &size_label(update.size), theme::TEXT);
	y += 28.0;
	field_mono(ui, content, y, t!("摘要"), &update.digest, theme::TEXT_2);
	y += 32.0;
	if shell.updates.installing() {
		truncated_text(
			ui,
			pos2(content.min.x, y),
			t!("正在下载并启动安装程序…"),
			11.5,
			theme::TEXT_2,
			content.width(),
		);
	} else if let Some(error) = shell.updates.error() {
		truncated_text(
			ui,
			pos2(content.min.x, y),
			&t!("更新检查失败：{}", error),
			11.5,
			theme::DEL,
			content.width(),
		);
	} else if !update.available {
		truncated_text(
			ui,
			pos2(content.min.x, y),
			t!("当前版本不低于最新版本，不能安装"),
			11.5,
			theme::TEXT_3,
			content.width(),
		);
	}
}

/// One `label  value` row with the value in the proportional face.
fn field(ui: &Ui, content: Rect, y: f32, label: &str, value: &str, color: Color32) {
	ui.painter().text(
		pos2(content.min.x, y),
		Align2::LEFT_CENTER,
		label,
		FontId::new(11.0, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	truncated_text(ui, pos2(content.min.x + 72.0, y), value, 12.0, color, content.width() - 72.0);
}

/// [`field`] with the value in the monospace face (the digest reads as hex).
fn field_mono(ui: &Ui, content: Rect, y: f32, label: &str, value: &str, color: Color32) {
	ui.painter().text(
		pos2(content.min.x, y),
		Align2::LEFT_CENTER,
		label,
		FontId::new(11.0, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	truncated_mono(ui, pos2(content.min.x + 72.0, y), value, 11.0, color, content.width() - 72.0);
}

/// `123.4 MB (129,436,672 B)` — the asset size the release metadata reported.
fn size_label(bytes: u64) -> String {
	let mib = bytes as f64 / (1024.0 * 1024.0);
	format!("{mib:.1} MB ({bytes} B)")
}

/// A footer button: 安装 is filled with the accent, everything else is a
/// bordered panel button. A disabled button still paints (the reason is the
/// body's line) but allocates no click sense.
fn button(ui: &mut Ui, label: &str, primary: bool, enabled: bool) -> egui::Response {
	let font = FontId::new(12.0, egui::FontFamily::Proportional);
	let galley = ui
		.painter()
		.layout_no_wrap(label.to_owned(), font.clone(), theme::TEXT);
	let sense = if enabled {
		Sense::click()
	} else {
		Sense::hover()
	};
	let (rect, response) = ui.allocate_exact_size(vec2(galley.size().x + 30.0, 28.0), sense);
	let (fill, stroke) = if !enabled {
		(theme::PANEL_2, theme::BORDER)
	} else if primary {
		(theme::ACCENT, theme::ACCENT)
	} else {
		(theme::PANEL_3, theme::BORDER_2)
	};
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), fill);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(theme::R_CONTROL),
		Stroke::new(1.0_f32, stroke),
		egui::StrokeKind::Inside,
	);
	let color = if !enabled {
		theme::TEXT_3
	} else if primary {
		theme::GROUND
	} else if response.hovered() {
		theme::TEXT
	} else {
		theme::TEXT_2
	};
	ui.painter()
		.text(rect.center(), Align2::CENTER_CENTER, label, font, color);
	response
}
