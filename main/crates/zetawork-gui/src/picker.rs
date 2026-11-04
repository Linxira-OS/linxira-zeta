// SPDX-License-Identifier: AGPL-3.0-only
//! The `+` picker: everything the centre can display, as one list.
//!
//! Both `+` buttons in the centre open this — the 大标签页 strip's (a new
//! workspace holding the pick) and a pane's (one more session tab) — because
//! both answer the same question (R23): *what can I put in the centre?* The
//! answer is read from this host, not from a fixed list: every shell
//! [`crate::shells::detect`] really finds (`pwsh`, Windows PowerShell, `cmd`,
//! `bash`, Git Bash, WSL), then every page the GUI draws itself (编辑器,
//! 差异比较器, Git, zetaide).
//!
//! The rows are built once, when the picker opens
//! ([`crate::Shell::open_picker`]), so a PATH scan never runs per frame.

use crate::t;
use egui::{Align, Color32, CornerRadius, FontId, Layout, Order, Rect, Sense, Stroke, pos2, vec2};

use crate::{
	Shell,
	icons::{Icon, paint},
	state::{PickerEntry, PickerTarget, SessionKind},
	theme,
	widgets::{truncated_mono, truncated_text},
};

/// Width of the popup.
const WIDTH: f32 = 320.0;
/// Height of the popup's title band. The old height calculation used 12 for
/// this band while the rows started at 34, so the last row was painted below
/// the panel.
const HEADER_H: f32 = 34.0;
/// Height of one row.
const ROW_H: f32 = 34.0;
/// Height of a group heading.
const GROUP_H: f32 = 24.0;

/// The icon a page row shows.
fn page_icon(kind: SessionKind) -> Icon {
	match kind {
		SessionKind::Term => Icon::Term,
		SessionKind::Editor => Icon::Code,
		SessionKind::Diff => Icon::Diff,
		SessionKind::Git => Icon::GitBranch,
		SessionKind::Zetacode => Icon::Term,
		SessionKind::Ide => Icon::Term,
		SessionKind::Agent => Icon::History,
		SessionKind::Pdf => Icon::File,
	}
}

/// The icon an entry row shows.
fn entry_icon(entry: &PickerEntry) -> Icon {
	match entry {
		PickerEntry::Shell(_) => Icon::Term,
		PickerEntry::Page(kind) => page_icon(*kind),
	}
}

/// The dialog's own title, per target.
fn title(target: &PickerTarget) -> &'static str {
	match target {
		PickerTarget::BigTab => t!("新建大标签页 · 选择要打开的内容"),
		PickerTarget::Pane(_) => t!("新建标签页 · 选择要打开的内容"),
	}
}

/// Draw the picker, if it is open, anchored under the `+` that opened it.
pub fn popup(ctx: &egui::Context, shell: &mut Shell) {
	let Some(target) = shell.state.picker().cloned() else {
		return;
	};
	let entries = shell.picker_entries.clone();
	let groups = entries
		.iter()
		.map(PickerEntry::group)
		.collect::<std::collections::BTreeSet<_>>()
		.len();
	let wanted = HEADER_H + GROUP_H * groups as f32 + ROW_H * entries.len().max(1) as f32 + 8.0;
	let screen = ctx.content_rect();
	let anchor = shell.picker_anchor.unwrap_or(screen);
	// Under the button, but never off the window. The list scrolls inside
	// this bound; it no longer paints past the panel's bottom edge.
	let height = wanted.min(screen.height() - 16.0).max(ROW_H + HEADER_H);
	let x = anchor
		.min
		.x
		.clamp(screen.min.x + 8.0, (screen.max.x - WIDTH - 8.0).max(screen.min.x + 8.0));
	let y = (anchor.max.y + 4.0).min((screen.max.y - height - 8.0).max(screen.min.y + 8.0));
	let rect = Rect::from_min_size(pos2(x, y), vec2(WIDTH, height));

	let mut picked: Option<PickerEntry> = None;
	let mut close = false;
	egui::Area::new(egui::Id::new("zetawork-picker"))
		.order(Order::Foreground)
		.fixed_pos(screen.min)
		.show(ctx, |ui| {
			// A click anywhere else dismisses the popup, exactly as a menu does.
			let (backdrop, backdrop_response) = ui.allocate_exact_size(screen.size(), Sense::click());
			if backdrop_response.clicked() {
				close = true;
			}
			ui.painter().rect_filled(
				backdrop,
				CornerRadius::ZERO,
				Color32::from_rgba_unmultiplied(3, 5, 8, 40),
			);
			crate::widgets::click_shield(ui, rect, "picker");
			theme::paint_shadow(ui.painter(), rect, CornerRadius::same(theme::R_MODAL));
			let mut panel = ui.new_child(
				egui::UiBuilder::new()
					.max_rect(rect)
					.layout(Layout::top_down(Align::Min)),
			);
			let painter = panel.painter().clone();
			painter.rect_filled(rect, CornerRadius::same(theme::R_MODAL), theme::panel());
			painter.rect_stroke(
				rect,
				CornerRadius::same(theme::R_MODAL),
				Stroke::new(1.0_f32, theme::border_2()),
				egui::StrokeKind::Inside,
			);
			painter.text(
				pos2(rect.min.x + 12.0, rect.min.y + 18.0),
				egui::Align2::LEFT_CENTER,
				title(&target),
				FontId::new(12.0, egui::FontFamily::Proportional),
				theme::text_2(),
			);
			painter.line_segment(
				[pos2(rect.min.x, rect.min.y + 32.5), pos2(rect.max.x, rect.min.y + 32.5)],
				Stroke::new(1.0_f32, theme::border()),
			);
			let list_rect = Rect::from_min_max(
				pos2(rect.min.x + 6.0, rect.min.y + HEADER_H),
				pos2(rect.max.x - 6.0, rect.max.y - 4.0),
			);
			let mut list_ui = panel.new_child(
				egui::UiBuilder::new()
					.max_rect(list_rect)
					.layout(Layout::top_down(Align::Min)),
			);
			egui::ScrollArea::vertical()
				.id_salt("zetawork-picker-rows")
				.auto_shrink([false, false])
				.show(&mut list_ui, |ui| {
					ui.spacing_mut().item_spacing.y = 0.0;
					if entries.is_empty() {
						let (row, _) =
							ui.allocate_exact_size(vec2(ui.available_width(), ROW_H), Sense::hover());
						truncated_text(
							ui,
							pos2(row.min.x + 6.0, row.center().y),
							t!("本机没有探测到任何 shell"),
							12.5,
							theme::WARN,
							row.width() - 12.0,
						);
					}
					let mut group = "";
					for entry in &entries {
						if entry.group() != group {
							group = entry.group();
							let (head, _) =
								ui.allocate_exact_size(vec2(ui.available_width(), GROUP_H), Sense::hover());
							ui.painter().text(
								pos2(head.min.x + 6.0, head.center().y),
								egui::Align2::LEFT_CENTER,
								group,
								FontId::new(10.5, egui::FontFamily::Proportional),
								theme::text_3(),
							);
						}
						let (row, _) = ui
							.allocate_exact_size(vec2(ui.available_width(), ROW_H - 2.0), Sense::hover());
						let response =
							ui.interact(row, ui.id().with(("pick", &entry.detail())), Sense::click());
						if response.hovered() {
							ui.painter().rect_filled(
								row,
								CornerRadius::same(theme::R_CONTROL),
								theme::panel_3(),
							);
						}
						paint(
							ui.painter(),
							entry_icon(entry),
							Rect::from_center_size(
								pos2(row.min.x + 16.0, row.center().y),
								vec2(15.0, 15.0),
							),
							theme::text_3(),
							1.5,
						);
						truncated_text(
							ui,
							pos2(row.min.x + 32.0, row.center().y - 7.0),
							&entry.title(),
							12.5,
							theme::text(),
							row.width() - 90.0,
						);
						truncated_mono(
							ui,
							pos2(row.min.x + 32.0, row.center().y + 7.0),
							&entry.detail(),
							10.5,
							theme::text_3(),
							row.width() - 90.0,
						);
						// The kind chip: a shell says which family it is, a
						// page says it is a page.
						let chip = match entry {
							PickerEntry::Shell(shell) => shell.kind.label(),
							PickerEntry::Page(_) => t!("页面"),
						};
						let font = FontId::new(10.5, egui::FontFamily::Monospace);
						let galley = ui
							.painter()
							.layout_no_wrap(chip.to_owned(), font, theme::text_3());
						let chip_rect = Rect::from_center_size(
							pos2(row.max.x - 8.0 - galley.size().x / 2.0 - 6.0, row.center().y),
							vec2(galley.size().x + 12.0, 16.0),
						);
						ui.painter()
							.rect_filled(chip_rect, CornerRadius::same(4), theme::panel_4());
						ui.painter().galley(
							pos2(chip_rect.min.x + 6.0, chip_rect.center().y - galley.size().y / 2.0),
							galley,
							theme::text_3(),
						);
						if response.clicked() {
							picked = Some(entry.clone());
						}
					}
				});
		});
	if let Some(entry) = picked {
		shell.state.act(|state| state.pick(&entry));
		return;
	}
	if close {
		shell.state.close_picker();
	}
}
