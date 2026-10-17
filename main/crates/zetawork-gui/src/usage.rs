// SPDX-License-Identifier: AGPL-3.0-only
//! The 用量 container: the embedded view both 用量 entries open.
//!
//! The left column's foot has 用量 and the right column's fourth tab is 上下文用量;
//! the first opens this container, and the tab's expander opens the same one.
//! Its content is the native stats page served by `packages/stats` on loopback —
//! the URL is discovered from `~/.zeta/serve.json` (see [`crate::stats`]) and
//! shown here, never invented.
//!
//! # What this container is, and what it is not
//!
//! It is the *container and the wiring*: the endpoint, the address, the reload,
//! and the frame the page will be painted into. It is **not** a web view yet —
//! see [`crate::stats::CONTAINER_OBSTACLE`] for exactly what is missing. Until
//! that lands, this dialog shows the URL, the endpoint's provenance, what the
//! stats page renders, and nothing that would look like a number it does not
//! have.

use egui::{Align, CornerRadius, FontId, Layout, Order, Rect, Sense, Stroke, pos2, vec2};

use crate::Shell;
use crate::icons::{Icon, icon_button};
use crate::theme;

/// The dialog's size, clamped to the window.
const DIALOG: [f32; 2] = [980.0, 620.0];

/// The three blocks the native stats dashboard renders, named so the container
/// says what will appear in the frame instead of drawing numbers it does not
/// have. (The page itself is `packages/stats`'s dashboard.)
const DASHBOARD_SECTIONS: [&str; 3] = [
	"顶部汇总卡片（今日输入 / 输出 token、平均吞吐、当前上下文占用）",
	"近 12 小时用量柱图（按小时聚合）",
	"会话明细表（会话 / 时间 / 输入 / 输出 / 首字延迟）",
];

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
	let dashboard = DASHBOARD_SECTIONS;
	let obstacle = crate::stats::CONTAINER_OBSTACLE;
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
					embed_placeholder(&mut body_ui, &url, dashboard, obstacle);
				});
		});
	if reload {
		shell.refresh_stats();
	}
	if close {
		shell.state.close_usage();
	}
}

/// What the frame holds until a web view can paint the page itself: the honest
/// statement of the missing piece, plus what the page will show.
fn embed_placeholder(ui: &mut egui::Ui, url: &str, sections: [&str; 3], obstacle: &str) {
	let rect = ui.max_rect();
	let mut y = rect.min.y + 22.0;
	ui.painter().text(
		pos2(rect.min.x + 20.0, y),
		egui::Align2::LEFT_TOP,
		"嵌入式视图尚未接线",
		FontId::new(15.0, egui::FontFamily::Proportional),
		theme::WARN,
	);
	y += 26.0;
	for line in wrap(obstacle, 92) {
		ui.painter().text(
			pos2(rect.min.x + 20.0, y),
			egui::Align2::LEFT_TOP,
			line,
			FontId::new(12.0, egui::FontFamily::Proportional),
			theme::TEXT_2,
		);
		y += 19.0;
	}
	y += 12.0;
	ui.painter().text(
		pos2(rect.min.x + 20.0, y),
		egui::Align2::LEFT_TOP,
		format!("WebView2 载入后，这个框里就是 {url} 这个页面："),
		FontId::new(12.0, egui::FontFamily::Proportional),
		theme::TEXT_2,
	);
	y += 24.0;
	for section in sections {
		let dot = Rect::from_min_size(pos2(rect.min.x + 24.0, y + 5.0), vec2(6.0, 6.0));
		ui.painter()
			.rect_filled(dot, CornerRadius::same(2), theme::ACCENT);
		ui.painter().text(
			pos2(rect.min.x + 40.0, y),
			egui::Align2::LEFT_TOP,
			section,
			FontId::new(12.0, egui::FontFamily::Proportional),
			theme::TEXT_3,
		);
		y += 20.0;
	}
	ui.painter().text(
		pos2(rect.min.x + 20.0, rect.max.y - 18.0),
		egui::Align2::LEFT_BOTTOM,
		"此框不显示任何数字：用量数字只由 stats 页面自己渲染。",
		FontId::new(11.5, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
}

/// Break `text` into lines of at most `cols` characters, at spaces where it can.
fn wrap(text: &str, cols: usize) -> Vec<String> {
	let mut lines = Vec::new();
	let mut line = String::new();
	for word in text.split_whitespace() {
		let too_long = !line.is_empty() && line.chars().count() + 1 + word.chars().count() > cols;
		if too_long {
			lines.push(std::mem::take(&mut line));
		}
		if !line.is_empty() {
			line.push(' ');
		}
		line.push_str(word);
	}
	if !line.is_empty() {
		lines.push(line);
	}
	lines
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
