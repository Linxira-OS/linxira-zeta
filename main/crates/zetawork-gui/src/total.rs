// SPDX-License-Identifier: AGPL-3.0-only
//! 总面板 — the centre strip's **first** 大标签页.
//!
//! The contract's ruling (`mock-override.js`, "功能分派"): 总面板 lives in 中间区
//! 第 1 个大标签页 and is **所有项目合并一张表** — it is a table, not a statistics
//! page, and it is not one of the workspaces (a workspace is a 大标签页 of its
//! own, listed after it).
//!
//! ```text
//! 项目   工作区    分支      状态            ±行        未提交
//! 本机   zeta      main      ● working      +184 −22   12
//! 项目 1 工作区 1-1 main      ◐ permission   —          —
//! ```
//!
//! The branch is the draft's `.chip.branch`: cyan mono, no glyph in front of it
//! (the drafts have none, and inventing one would render as tofu).
//! # What is real
//!
//! A row is drawn from the state itself — project, workspace, branch and run
//! state are all known without touching the disk. The two git columns are the
//! only ones with a data source, and that source is per workspace: the shell
//! keeps one snapshot, for the workspace that is open. Every other row therefore
//! shows `—` rather than a plausible number, and the column heads say what would
//! have to be read. Clicking a row opens that workspace, which is how a `—` row
//! gets its numbers.

use egui::{Align2, CornerRadius, FontId, Rect, Sense, Stroke, pos2, vec2};

use crate::Shell;
use crate::state::Notice;
use crate::theme;
use crate::widgets::{status_dot, status_word, truncated_mono, truncated_text};

/// The columns, in the contract's order and with their share of the width.
const COLUMNS: [(&str, f32); 6] = [
	("项目", 0.20),
	("工作区", 0.22),
	("分支", 0.20),
	("状态", 0.15),
	("±行", 0.11),
	("未提交", 0.12),
];

/// `.pad11` — the table's padding inside the page.
const PAD: [f32; 2] = [14.0, 12.0];
/// The height of the head row and of a data row (`.t th` / `.t td`, padding 6+8).
const ROW_H: f32 = 26.0;

/// The foot line, word for word from the contract's 总面板 page.
pub const NOTE: &str = "总面板：所有项目一张表 —— 哪个工作区在哪个项目下、绑哪条分支、多少没提交";

/// The tooltip on the two git columns: they are the only cells that need a read.
const GIT_HINT: &str =
	"±行 / 未提交：只读取已打开工作区的 git 快照（git status、diff --numstat），其余行等开机再读";

/// Draw the page.
pub fn page(ui: &mut egui::Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::GROUND);
	let inner = rect.shrink2(vec2(PAD[0], PAD[1]));
	if inner.width() <= 40.0 || inner.height() <= ROW_H {
		return;
	}
	let widths = column_widths(inner.width());

	let head = Rect::from_min_size(inner.min, vec2(inner.width(), ROW_H));
	head_row(ui, head, &widths);

	let active = shell.state.active_workspace.clone();
	let mut open: Option<(String, String)> = None;
	let mut y = head.max.y;
	for project in &shell.state.projects {
		for workspace in &project.workspaces {
			if y + ROW_H > inner.max.y {
				break;
			}
			let row = Rect::from_min_size(pos2(inner.min.x, y), vec2(inner.width(), ROW_H));
			let is_active = active.as_deref() == Some(workspace.id.as_str());
			let response = ui.interact(row, ui.id().with(("total", &workspace.id)), Sense::click());
			let clicked = row_body(
				ui,
				shell,
				row,
				&widths,
				project.name.as_str(),
				workspace,
				is_active,
				&response,
			);
			if clicked {
				open = Some((workspace.id.clone(), workspace.name.clone()));
			}
			y += ROW_H;
		}
	}
	if let Some((id, name)) = open {
		// `select_workspace` both opens it and leaves the 总面板 tab, so the
		// click does not have to know about either.
		shell.state.act(|state| {
			let notice = state.select_workspace(&id);
			if notice.0.is_empty() {
				Notice(format!("已打开「{name}」"))
			} else {
				notice
			}
		});
	}

	// The foot line sits under the table, with the gap `.note`'s margin-top
	// leaves. A page too short for the table still shows it.
	let note_y = (y + 10.0).min(inner.max.y - 20.0);
	if note_y > head.max.y {
		ui.painter().text(
			pos2(inner.min.x, note_y),
			Align2::LEFT_TOP,
			NOTE,
			FontId::new(11.0, egui::FontFamily::Proportional),
			theme::TEXT_3,
		);
	}
}

/// One head cell's share of the width, in points.
fn column_widths(total: f32) -> [f32; 6] {
	let mut widths = [0.0f32; 6];
	for (index, (_, share)) in COLUMNS.iter().enumerate() {
		widths[index] = total * share;
	}
	widths
}

fn head_row(ui: &egui::Ui, rect: Rect, widths: &[f32; 6]) {
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL_2);
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.max.y - 0.5), pos2(rect.max.x, rect.max.y - 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let mut x = rect.min.x;
	for (index, (label, _)) in COLUMNS.iter().enumerate() {
		truncated_text(ui, pos2(x, rect.center().y), label, 11.5, theme::TEXT_2, widths[index] - 8.0);
		if *label == "±行" {
			ui.interact(
				Rect::from_min_size(pos2(x, rect.min.y), vec2(widths[index], rect.height())),
				ui.id().with("total-git-hint"),
				Sense::hover(),
			)
			.on_hover_text(GIT_HINT);
		}
		x += widths[index];
	}
}

/// Draw one workspace's row. Returns true when the row was clicked.
#[allow(clippy::too_many_arguments)]
fn row_body(
	ui: &egui::Ui,
	shell: &Shell,
	rect: Rect,
	widths: &[f32; 6],
	project: &str,
	workspace: &crate::state::Workspace,
	is_active: bool,
	response: &egui::Response,
) -> bool {
	// Hovering and the open workspace both light the row, as `table.t tr:hover`
	// and `.wscard.on` do in the spec.
	if is_active {
		ui.painter()
			.rect_filled(rect, CornerRadius::ZERO, theme::PANEL_2);
	} else if response.hovered() {
		ui.painter()
			.rect_filled(rect, CornerRadius::ZERO, theme::PANEL_2.gamma_multiply(0.7));
	}
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.max.y - 0.5), pos2(rect.max.x, rect.max.y - 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	// The active-workspace marker: `.ws-btn.is-active::before`, turned on its
	// side for a table row.
	if is_active {
		ui.painter().rect_filled(
			Rect::from_min_size(pos2(rect.min.x, rect.min.y + 5.0), vec2(3.0, rect.height() - 10.0)),
			CornerRadius::same(2),
			theme::ACCENT,
		);
	}

	let baseline = rect.center().y;
	let mut x = rect.min.x;
	let ink = if is_active {
		theme::TEXT
	} else {
		theme::TEXT_2
	};

	// 项目
	truncated_text(ui, pos2(x + 6.0, baseline), project, 12.5, ink, widths[0] - 12.0);
	x += widths[0];
	// 工作区
	truncated_text(ui, pos2(x, baseline), &workspace.name, 12.5, ink, widths[1] - 8.0);
	x += widths[1];
	// 分支 — the draft's `.chip.branch`: cyan mono, no glyph in front of it.
	truncated_mono(ui, pos2(x, baseline), &workspace.branch, 11.5, theme::ACCENT, widths[2] - 8.0);
	x += widths[2];
	// 状态 — the contract's 状态词表, through the two shared widgets: the dot is
	// the mock's own mechanism (`.d-work` … are coloured discs) and the word is
	// what makes the column scannable. A workspace nothing observes reads `—`
	// and draws no dot, like the two git columns.
	status_dot(ui, pos2(x + 5.0, baseline), workspace.run_state);
	status_word(ui, pos2(x + 13.0, baseline), workspace.run_state, 12.0, widths[3] - 20.0);
	x += widths[3];
	// ±行 / 未提交 — only the open workspace has a snapshot in hand.
	let (delta, dirty) = match (is_active, shell.git.as_ref()) {
		(true, Some(status)) if status.error.is_none() => {
			(format!("+{} −{}", status.insertions, status.deletions), status.changed.len().to_string())
		},
		_ => ("—".to_owned(), "—".to_owned()),
	};
	truncated_mono(ui, pos2(x, baseline), &delta, 11.5, theme::TEXT_3, widths[4] - 8.0);
	x += widths[4];
	truncated_mono(ui, pos2(x, baseline), &dirty, 11.5, theme::TEXT_3, widths[5] - 8.0);

	response.clicked()
}
