//! The `+` picker: everything the centre can display, as one list.
//!
//! Both `+` buttons in the centre open this — the 大标签页 strip's (a new
//! workspace holding the pick) and a pane's (one more session tab) — because
//! both answer the same question (R23): *what can I put in the centre?* The
//! answer is read from this host, not from a fixed list: every shell
//! [`crate::shells::detect`] really finds (`pwsh`, Windows PowerShell, `cmd`,
//! `bash`, Git Bash, WSL), then every page the GUI draws itself (编辑器, 差异比较器,
//! Git, zetaide).
//!
//! The rows are built once, when the picker opens ([`crate::Shell::open_picker`]),
//! so a PATH scan never runs per frame.

use egui::{Align, Color32, CornerRadius, FontId, Layout, Order, Rect, Sense, Stroke, pos2, vec2};

use crate::Shell;
use crate::icons::{Icon, paint};
use crate::state::{PickerEntry, PickerTarget, SessionKind};
use crate::theme;
use crate::widgets::{truncated_mono, truncated_text};

/// Width of the popup.
const WIDTH: f32 = 320.0;
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
		SessionKind::Ide => Icon::Term,
		SessionKind::Agent => Icon::History,
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
		PickerTarget::BigTab => "新建大标签页 · 选择要打开的内容",
		PickerTarget::Pane(_) => "新建标签页 · 选择要打开的内容",
	}
}

/// Draw the picker, if it is open, anchored under the `+` that opened it.
pub fn popup(ctx: &egui::Context, shell: &mut Shell) {
	let Some(target) = shell.state.picker().cloned() else {
		return;
	};
	let entries = shell.picker_entries.clone();
	let height = 12.0
		+ GROUP_H * 2.0
		+ ROW_H * entries.len() as f32
		+ if entries.is_empty() { ROW_H } else { 0.0 };
	let screen = ctx.content_rect();
	let anchor = shell.picker_anchor.unwrap_or(screen);
	// Under the button, but never off the window.
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
		.fixed_pos(rect.min)
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
			let panel = ui.new_child(
				egui::UiBuilder::new()
					.max_rect(rect)
					.layout(Layout::top_down(Align::Min)),
			);
			let painter = panel.painter().clone();
			painter.rect_filled(rect, CornerRadius::same(theme::R_MODAL), theme::PANEL);
			painter.rect_stroke(
				rect,
				CornerRadius::same(theme::R_MODAL),
				Stroke::new(1.0, theme::BORDER_2),
				egui::StrokeKind::Inside,
			);
			painter.text(
				pos2(rect.min.x + 12.0, rect.min.y + 18.0),
				egui::Align2::LEFT_CENTER,
				title(&target),
				FontId::new(12.0, egui::FontFamily::Proportional),
				theme::TEXT_2,
			);
			painter.line_segment(
				[pos2(rect.min.x, rect.min.y + 32.5), pos2(rect.max.x, rect.min.y + 32.5)],
				Stroke::new(1.0, theme::BORDER),
			);
			let mut y = rect.min.y + 34.0;
			if entries.is_empty() {
				truncated_text(
					&panel,
					pos2(rect.min.x + 12.0, y + ROW_H / 2.0),
					"本机没有探测到任何 shell",
					12.5,
					theme::WARN,
					WIDTH - 24.0,
				);
			}
			let mut group = "";
			for entry in &entries {
				if entry.group() != group {
					group = entry.group();
					painter.text(
						pos2(rect.min.x + 12.0, y + GROUP_H / 2.0),
						egui::Align2::LEFT_CENTER,
						group,
						FontId::new(10.5, egui::FontFamily::Proportional),
						theme::TEXT_3,
					);
					y += GROUP_H;
				}
				let row = Rect::from_min_size(
					pos2(rect.min.x + 6.0, y + 1.0),
					vec2(WIDTH - 12.0, ROW_H - 4.0),
				);
				let response =
					panel.interact(row, ui.id().with(("pick", &entry.detail())), Sense::click());
				if response.hovered() {
					panel.painter().rect_filled(
						row,
						CornerRadius::same(theme::R_CONTROL),
						theme::PANEL_3,
					);
				}
				paint(
					panel.painter(),
					entry_icon(entry),
					Rect::from_center_size(pos2(row.min.x + 16.0, row.center().y), vec2(15.0, 15.0)),
					theme::TEXT_3,
					1.5,
				);
				truncated_text(
					&panel,
					pos2(row.min.x + 32.0, row.center().y - 7.0),
					&entry.title(),
					12.5,
					theme::TEXT,
					row.width() - 90.0,
				);
				truncated_mono(
					&panel,
					pos2(row.min.x + 32.0, row.center().y + 7.0),
					&entry.detail(),
					10.5,
					theme::TEXT_3,
					row.width() - 90.0,
				);
				// The kind chip: a shell says which family it is, a page says it
				// is a page.
				let chip = match entry {
					PickerEntry::Shell(shell) => shell.kind.label(),
					PickerEntry::Page(_) => "页面",
				};
				let font = FontId::new(10.5, egui::FontFamily::Monospace);
				let galley = panel
					.painter()
					.layout_no_wrap(chip.to_owned(), font, theme::TEXT_3);
				let chip_rect = Rect::from_center_size(
					pos2(row.max.x - 8.0 - galley.size().x / 2.0 - 6.0, row.center().y),
					vec2(galley.size().x + 12.0, 16.0),
				);
				panel
					.painter()
					.rect_filled(chip_rect, CornerRadius::same(4), theme::PANEL_4);
				panel.painter().galley(
					pos2(chip_rect.min.x + 6.0, chip_rect.center().y - galley.size().y / 2.0),
					galley,
					theme::TEXT_3,
				);
				if response.clicked() {
					picked = Some(entry.clone());
				}
				y += ROW_H;
			}
		});
	if let Some(entry) = picked {
		shell.state.act(|state| state.pick(&entry));
		return;
	}
	if close {
		shell.state.close_picker();
	}
}
