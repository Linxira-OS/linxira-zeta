// SPDX-License-Identifier: AGPL-3.0-only
//! The 用量 container: the embedded view both 用量 entries open.
//!
//! The left column's foot has 用量 and the right column's fourth tab is 上下文用量;
//! the first opens this container, and the tab's expander opens the same one.
//! Its content is the native stats page served by `packages/stats` on loopback —
//! the URL is discovered from `~/.zeta/serve.json` (see [`crate::stats`]) and
//! shown here, never invented.
//!
//! # What this container is
//!
//! The endpoint, the address bar with its provenance, a reload, and a button
//! that opens the page in the host browser. This window hosts no web view, so
//! the container draws no numbers of its own: the stats page is the only
//! renderer of usage figures.

use egui::{Align, CornerRadius, FontId, Layout, Order, Rect, Sense, Stroke, pos2, vec2};

use crate::Shell;
use crate::icons::{Icon, icon_button};
use crate::theme;

/// The dialog's size, clamped to the window.
const DIALOG: [f32; 2] = [980.0, 620.0];

/// The URL this container loads.
pub fn url(shell: &Shell) -> &str {
	shell.stats.usage_url()
}

/// One line naming the endpoint and where it came from, for the address bar and
/// for the tests.
pub fn endpoint_line(shell: &Shell) -> String {
	shell.stats.describe()
}

/// Draw the container, if it is open.
pub fn container(ctx: &egui::Context, shell: &mut Shell) {
	if !shell.state.usage_view_open() {
		return;
	}
	let screen = ctx.content_rect();
	let mut close = false;
	let mut reload = false;
	let address = endpoint_line(shell);
	let url = url(shell).to_owned();
	let probe = shell.probe;
	egui::Area::new(egui::Id::new("zetawork-usage"))
		.order(Order::Foreground)
		.fixed_pos(screen.min)
		.show(ctx, |ui| {
			let (backdrop, backdrop_response) = ui.allocate_exact_size(screen.size(), Sense::click());
			ui.painter().rect_filled(
				backdrop,
				CornerRadius::ZERO,
				egui::Color32::from_rgba_unmultiplied(3, 5, 8, 158),
			);
			if backdrop_response.clicked() {
				close = true;
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
					let head = Rect::from_min_size(rect.min, vec2(rect.width(), 52.0));
					ui.painter().line_segment(
						[pos2(head.min.x, head.max.y - 0.5), pos2(head.max.x, head.max.y - 0.5)],
						Stroke::new(1.0_f32, theme::BORDER),
					);
					ui.painter().text(
						pos2(head.min.x + 14.0, head.center().y),
						egui::Align2::LEFT_CENTER,
						"用量统计",
						FontId::new(14.0, egui::FontFamily::Proportional),
						theme::TEXT,
					);
					let mut head_right = ui.new_child(
						egui::UiBuilder::new()
							.max_rect(head.shrink2(vec2(10.0, 12.0)))
							.layout(Layout::right_to_left(Align::Center)),
					);
					if icon_button(&mut head_right, Icon::X, 28.0, false, "关闭").clicked() {
						close = true;
					}
					if icon_button(&mut head_right, Icon::Refresh, 28.0, false, "重新读取服务地址")
						.clicked()
					{
						reload = true;
					}

					// The address bar: the real endpoint, its provenance, and the
					// copy action — so the same page can be opened in a browser
					// today, while the embedded view is still missing.
					let bar =
						Rect::from_min_size(pos2(rect.min.x, head.max.y), vec2(rect.width(), 46.0));
					ui.painter()
						.rect_filled(bar, CornerRadius::ZERO, theme::PANEL_2);
					ui.painter().line_segment(
						[pos2(bar.min.x, bar.max.y - 0.5), pos2(bar.max.x, bar.max.y - 0.5)],
						Stroke::new(1.0_f32, theme::BORDER),
					);
					ui.painter().text(
						pos2(bar.min.x + 14.0, bar.center().y - 8.0),
						egui::Align2::LEFT_CENTER,
						&url,
						FontId::new(12.0, egui::FontFamily::Monospace),
						theme::TEXT,
					);
					ui.painter().text(
						pos2(bar.min.x + 14.0, bar.center().y + 8.0),
						egui::Align2::LEFT_CENTER,
						&address,
						FontId::new(11.0, egui::FontFamily::Proportional),
						theme::TEXT_3,
					);
					let mut bar_right = ui.new_child(
						egui::UiBuilder::new()
							.max_rect(Rect::from_min_max(
								pos2(bar.max.x - 300.0, bar.min.y),
								pos2(bar.max.x - 10.0, bar.max.y),
							))
							.layout(Layout::right_to_left(Align::Center)),
					);
					if copy_button(&mut bar_right, "复制地址").clicked() {
						ui.ctx().copy_text(url.clone());
					}
					if copy_button(&mut bar_right, "复制 API 根").clicked() {
						ui.ctx()
							.copy_text(format!("{}/api/stats", shell.stats.origin()));
					}

					// The embedded frame: what the web view will paint into.
					let body = Rect::from_min_max(pos2(rect.min.x, bar.max.y), rect.max);
					let inner = body.shrink2(vec2(14.0, 14.0));
					ui.painter()
						.rect_filled(inner, CornerRadius::same(theme::R_PANEL), theme::GROUND);
					ui.painter().rect_stroke(
						inner,
						CornerRadius::same(theme::R_PANEL),
						Stroke::new(1.0_f32, theme::BORDER),
						egui::StrokeKind::Inside,
					);
					let mut body_ui = ui.new_child(egui::UiBuilder::new().max_rect(inner));
					frame_content(&mut body_ui, &url, probe);
				});
		});
	if reload {
		shell.refresh_stats();
	}
	if close {
		shell.state.close_usage();
	}
}

/// The frame's content: the endpoint is real, and the page itself opens in the
/// host browser — this window hosts no web view, so it shows no numbers of its
/// own.
fn frame_content(ui: &mut egui::Ui, url: &str, probe: bool) {
	let rect = ui.max_rect();
	let centre = rect.center();
	ui.painter().text(
		pos2(centre.x, centre.y - 20.0),
		egui::Align2::CENTER_CENTER,
		url,
		FontId::new(12.0, egui::FontFamily::Monospace),
		theme::TEXT_2,
	);
	let button = Rect::from_center_size(pos2(centre.x, centre.y + 22.0), vec2(150.0, 30.0));
	if ui
		.put(button, egui::Button::new("在浏览器中打开"))
		.clicked()
	{
		open_in_browser(probe, url);
	}
}

/// Open `url` in the host browser. Only a real run spawns anything.
fn open_in_browser(probe: bool, url: &str) {
	if !probe {
		return;
	}
	#[cfg(windows)]
	let mut command = {
		let mut command = std::process::Command::new("cmd");
		command.args(["/C", "start", "", url]);
		command
	};
	#[cfg(target_os = "macos")]
	let mut command = {
		let mut command = std::process::Command::new("open");
		command.arg(url);
		command
	};
	#[cfg(all(unix, not(target_os = "macos")))]
	let mut command = {
		let mut command = std::process::Command::new("xdg-open");
		command.arg(url);
		command
	};
	let _ = command.spawn();
}

/// A small outlined button, as the address bar's actions use.
fn copy_button(ui: &mut egui::Ui, label: &str) -> egui::Response {
	let font = FontId::new(11.5, egui::FontFamily::Proportional);
	let galley = ui
		.painter()
		.layout_no_wrap(label.to_owned(), font.clone(), theme::TEXT_2);
	let (rect, response) =
		ui.allocate_exact_size(vec2(galley.size().x + 20.0, 26.0), Sense::click());
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(theme::R_CONTROL),
		Stroke::new(1.0_f32, theme::BORDER_2),
		egui::StrokeKind::Inside,
	);
	ui.painter().text(
		rect.center(),
		egui::Align2::CENTER_CENTER,
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

/// The container's own icon, so the two entries that open it look alike.
pub fn entry_icon() -> Icon {
	Icon::List
}
