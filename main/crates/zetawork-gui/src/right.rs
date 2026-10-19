// SPDX-License-Identifier: AGPL-3.0-only
//! The right column: 文件 / 历史 · Agent 对话 / Git 状态, plus its collapsed
//! rail.
//!
//! Two of the three panels read live data: the file tree walks the active
//! workspace's directory one level at a time (see [`crate::fsread`]) and the
//! git panel runs read-only `git` (see [`crate::git`]). The history panel has
//! no source yet, so it shows one card that says so. Nothing in this column
//! writes to the repository: 暂存 / 提交 / 创建 PR exist as the spec draws
//! them, and are disabled with a line naming what would back them.

use crate::t;
use std::collections::HashSet;

use egui::{Align, CornerRadius, Layout, Rect, Sense, Stroke, Ui, pos2, vec2};

use crate::{
	Shell, conversation,
	fsread::DirNode,
	icons::{Icon, icon_button, paint},
	state::RightTab,
	theme,
	widgets::{badge, empty_note, panel_head, truncated_mono, truncated_text},
};

/// Width of the open column (`--side-right-w`).
pub const WIDTH: f32 = 324.0;
/// Width of the collapsed rail.
pub const RAIL_WIDTH: f32 = 44.0;

/// The open column.
pub fn right_column(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	ui.painter().line_segment(
		[pos2(rect.min.x + 0.5, rect.min.y), pos2(rect.min.x + 0.5, rect.max.y)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let head = Rect::from_min_size(rect.min, vec2(rect.width(), 44.0));
	ui.painter().line_segment(
		[pos2(head.min.x, head.max.y - 0.5), pos2(head.max.x, head.max.y - 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let mut tabs = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(head.shrink2(vec2(6.0, 6.0)))
			.layout(Layout::left_to_right(Align::Center)),
	);
	for tab in RightTab::ALL {
		let icon = tab_icon(tab);
		let active = shell.state.right_tab == tab;
		if icon_button(&mut tabs, icon, 26.0, active, tab.title()).clicked() {
			shell.state.set_right_tab(tab);
		}
	}
	let mut collapse = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(
				Rect::from_min_max(pos2(head.max.x - 32.0, head.min.y), head.max)
					.shrink2(vec2(0.0, 6.0)),
			)
			.layout(Layout::right_to_left(Align::Center)),
	);
	if icon_button(&mut collapse, Icon::ChevronRight, 26.0, false, t!("关闭右侧栏")).clicked() {
		shell.state.toggle_right();
	}
	let panel = Rect::from_min_max(pos2(rect.min.x, head.max.y), rect.max);
	let mut child = ui.new_child(egui::UiBuilder::new().max_rect(panel));
	match shell.state.right_tab {
		RightTab::Files => files_panel(&mut child, shell),
		RightTab::History => history_panel(&mut child, shell),
		RightTab::Git => git_panel(&mut child, shell, "right"),
		RightTab::Usage => usage_panel(&mut child, shell),
	}
}

fn tab_icon(tab: RightTab) -> Icon {
	match tab {
		RightTab::Files => Icon::Folder,
		RightTab::History => Icon::History,
		RightTab::Git => Icon::GitBranch,
		RightTab::Usage => Icon::List,
	}
}

/// `rail.rail-right`: the same three tabs in a thin strip.
pub fn right_rail(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	ui.painter().line_segment(
		[pos2(rect.min.x + 0.5, rect.min.y), pos2(rect.min.x + 0.5, rect.max.y)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let mut child = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_size(pos2(rect.min.x + 6.0, rect.min.y + 8.0), vec2(32.0, 110.0)))
			.layout(Layout::top_down(Align::Center)),
	);
	for tab in RightTab::ALL {
		if icon_button(&mut child, tab_icon(tab), 32.0, false, tab.title()).clicked() {
			shell.state.set_right_tab(tab);
		}
	}
}

// ── 文件 ──────────────────────────────────────────────────────────────────

fn files_panel(ui: &mut Ui, shell: &mut Shell) {
	panel_head(ui, RightTab::Files.title(), |ui| {
		if icon_button(ui, Icon::Refresh, 20.0, false, t!("重新读取目录")).clicked() {
			shell.reload_tree();
		}
	});
	let path = shell
		.state
		.active_workspace()
		.map(|ws| ws.path.clone())
		.unwrap_or_default();
	let (path_rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 20.0), Sense::hover());
	truncated_mono(
		ui,
		pos2(path_rect.min.x + 6.0, path_rect.center().y),
		&path,
		11.0,
		theme::TEXT_3,
		path_rect.width() - 12.0,
	);
	if let Some(error) = shell.tree.error.clone() {
		empty_note(ui, &error);
		return;
	}
	let changed: HashSet<String> = shell
		.git
		.as_ref()
		.map(|status| {
			status
				.changed
				.iter()
				.map(|file| file.path.clone())
				.collect()
		})
		.unwrap_or_default();
	let root = shell.tree.root().cloned();
	let Some(root) = root else {
		empty_note(ui, t!("先打开一个工作区"));
		return;
	};
	let root_path = std::path::PathBuf::from(&path);
	egui::ScrollArea::vertical()
		.id_salt("zetawork-files")
		.auto_shrink([false, false])
		.show(ui, |ui| {
			ui.spacing_mut().item_spacing.y = 0.0;
			let mut rel: Vec<usize> = Vec::new();
			tree_rows(ui, shell, &root, 0, &root_path, &changed, &mut rel);
		});
}

/// Depth-first rows. Children are only present once the node was expanded —
/// the tree is read one level at a time, so a collapsed directory has no rows
/// to walk into.
fn tree_rows(
	ui: &mut Ui,
	shell: &mut Shell,
	node: &DirNode,
	depth: usize,
	root: &std::path::Path,
	changed: &HashSet<String>,
	rel: &mut Vec<usize>,
) {
	let count = node.children.len();
	for index in 0..count {
		let child = &node.children[index];
		let (rect, response) =
			ui.allocate_exact_size(vec2(ui.available_width(), 26.0), Sense::click());
		if response.hovered() {
			ui.painter()
				.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
		}
		let indent = rect.min.x + 6.0 + depth as f32 * 14.0;
		let mut label_x = indent;
		if child.is_dir {
			let caret = Rect::from_center_size(pos2(indent + 5.5, rect.center().y), vec2(11.0, 11.0));
			paint(
				ui.painter(),
				if child.expanded {
					Icon::ChevronDown
				} else {
					Icon::ChevronRight
				},
				caret,
				theme::TEXT_3,
				1.6,
			);
			label_x = caret.max.x + 5.0;
		}
		let icon_rect =
			Rect::from_center_size(pos2(label_x + 7.0, rect.center().y), vec2(14.0, 14.0));
		paint(
			ui.painter(),
			if child.is_dir {
				Icon::Folder
			} else {
				Icon::File
			},
			icon_rect,
			theme::TEXT_3,
			1.5,
		);
		// The git panel's changed list is repo-relative; the tree is absolute,
		// so the marker takes the path relative to the workspace root.
		let relative = child
			.path
			.strip_prefix(root)
			.map(|rest| rest.to_string_lossy().replace('\\', "/"))
			.unwrap_or_else(|_| child.name.clone());
		let marked = !child.is_dir && changed.contains(&relative);
		let badge_space = if marked { 24.0 } else { 0.0 };
		truncated_text(
			ui,
			pos2(icon_rect.max.x + 7.0, rect.center().y),
			&child.name,
			12.5,
			theme::TEXT_2,
			rect.max.x - icon_rect.max.x - 14.0 - badge_space,
		);
		if marked {
			let mut badge_ui = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(
				pos2(rect.max.x - 24.0, rect.center().y - 7.0),
				vec2(16.0, 14.0),
			)));
			badge(&mut badge_ui, "M", true);
		}
		if response.clicked() {
			if child.is_dir {
				rel.push(index);
				let path = rel.clone();
				shell.tree.toggle(&path);
				rel.pop();
			} else {
				// A file row opens the 编辑器 page in the first visible pane —
				// the real file, editable and savable (R23).
				let file = child.path.clone();
				match shell
					.state
					.visible_panes()
					.first()
					.map(|pane| pane.id.clone())
				{
					Some(pane_id) => {
						let notice = shell.state.open_file(&pane_id, &file);
						shell.state.show(notice);
					},
					None => shell
						.state
						.show(crate::state::Notice(t!("先打开一个工作区，再打开文件").to_owned())),
				}
			}
		}
		if child.is_dir && child.expanded {
			rel.push(index);
			let child = &node.children[index];
			tree_rows(ui, shell, child, depth + 1, root, changed, rel);
			rel.pop();
		}
	}
}

// ── 历史 · Agent 对话 ─────────────────────────────────────────────────────

fn history_panel(ui: &mut Ui, _shell: &mut Shell) {
	panel_head(ui, t!("历史 · Agent 对话"), |_ui| {});
	empty_note(ui, t!("还没有对话记录"));
}

// ── Git 状态 ──────────────────────────────────────────────────────────────

/// The Git panel: the same function draws the right column's Git tab and a
/// `Git` page in the centre grid, so the two can never show different numbers.
/// `key` distinguishes the scroll state of the two places it is drawn.
pub(crate) fn git_panel(ui: &mut Ui, shell: &mut Shell, key: &str) {
	panel_head(ui, RightTab::Git.title(), |ui| {
		if icon_button(ui, Icon::Refresh, 20.0, false, t!("重新读取 git 状态")).clicked() {
			shell.refresh_git();
		}
	});
	if shell.git.is_none() {
		shell.refresh_git();
	}
	let status = shell.git.clone();
	let Some(status) = status else {
		empty_note(ui, t!("正在读取 git 状态…"));
		return;
	};
	if let Some(error) = &status.error {
		empty_note(ui, &t!("无法读取 git 状态：{}", short_git_error(error)));
		return;
	}
	egui::ScrollArea::vertical()
		.id_salt(("zetawork-git", key))
		.auto_shrink([false, false])
		.show(ui, |ui| {
			ui.spacing_mut().item_spacing.y = 4.0;
			branch_row(ui, &status);

			group(ui, t!("更改"), status.changed.len(), "M", true, |ui| {
				for file in &status.changed {
					file_row(ui, &file.path, Some((file.insertions, file.deletions)), Some("M"));
				}
			});
			if !status.untracked.is_empty() {
				group(ui, t!("未跟踪文件"), status.untracked.len(), "U", false, |ui| {
					for file in &status.untracked {
						file_row(ui, &file.path, None, Some("U"));
					}
				});
			}
			let commits_open = shell.state.commits_open;
			let commits: Vec<crate::git::GitCommit> = status.commits.clone();
			let head = group(ui, t!("提交"), commits.len(), "", true, |ui| {
				if commits_open {
					for commit in &commits {
						commit_row(ui, commit);
					}
				}
			});
			if head.clicked() {
				shell.state.commits_open = !shell.state.commits_open;
			}
		});
}

/// 用量: the active conversation's own usage, following the active pane/tab.
///
/// The page never draws an invented figure. With no resolvable conversation it
/// says so in one line ([`conversation::NO_SESSION`]); a percentage appears
/// only when the journal reports the model's window. The complete resolution
/// order lives in [`crate::conversation::resolve`].
fn usage_panel(ui: &mut Ui, shell: &mut Shell) {
	panel_head(ui, RightTab::Usage.title(), |ui| {
		if icon_button(ui, Icon::Refresh, 20.0, false, t!("重新读取会话用量")).clicked() {
			shell.conversation.invalidate();
		}
	});
	let path = shell
		.state
		.active_workspace()
		.map(|ws| ws.path.clone())
		.unwrap_or_default();
	let branch = shell.state.branch_label().to_owned();
	let resolved = shell.conversation.resolved().cloned();
	egui::ScrollArea::vertical()
		.id_salt("zetawork-usage")
		.auto_shrink([false, false])
		.show(ui, |ui| {
			ui.spacing_mut().item_spacing.y = 6.0;
			// The scope line: 当前路径 + 当前分支.
			let (scope, _) = ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::hover());
			truncated_mono(
				ui,
				pos2(scope.min.x + 4.0, scope.min.y + 9.0),
				&path,
				11.0,
				theme::TEXT_2,
				scope.width() - 8.0,
			);
			truncated_mono(
				ui,
				pos2(scope.min.x + 4.0, scope.min.y + 24.0),
				&t!("分支 {}", branch),
				11.0,
				theme::TEXT_3,
				scope.width() - 8.0,
			);
			match &resolved {
				Some(resolved) => usage_card(ui, resolved),
				None => {
					let (row, _) =
						ui.allocate_exact_size(vec2(ui.available_width(), 24.0), Sense::hover());
					truncated_text(
						ui,
						pos2(row.min.x + 4.0, row.center().y),
						crate::i18n::tr(conversation::NO_SESSION),
						11.5,
						theme::TEXT_3,
						row.width() - 8.0,
					);
				},
			}
		});
}

/// The source chip plus every figure the active conversation has.
fn usage_card(ui: &mut Ui, resolved: &conversation::Resolved) {
	let summary = &resolved.summary;
	source_chip(ui, resolved.source_line());
	egui::Frame::new()
		.fill(theme::PANEL_2)
		.stroke(Stroke::new(1.0_f32, theme::BORDER))
		.corner_radius(CornerRadius::same(theme::R_PANEL))
		.inner_margin(egui::Margin::same(10))
		.show(ui, |ui| {
			ui.set_width(ui.available_width());
			ui.spacing_mut().item_spacing.y = 1.0;
			usage_row(ui, t!("会话"), summary.id.as_deref().unwrap_or("—"), true);
			usage_row(ui, t!("标题"), summary.title.as_deref().unwrap_or("—"), false);
			usage_row(ui, t!("输入"), &format!("{} tokens", grouped(summary.input)), true);
			usage_row(ui, t!("输出"), &format!("{} tokens", grouped(summary.output)), true);
			usage_row(ui, t!("总计"), &format!("{} tokens", grouped(summary.total)), true);
			let cost = summary.cost_text().unwrap_or_else(|| {
				if summary.usage_entries > 0 {
					t!("未定价")
				} else {
					"—"
				}
				.to_owned()
			});
			usage_row(ui, t!("费用"), &cost, true);
			usage_row(ui, t!("模型"), summary.model.as_deref().unwrap_or("—"), true);
			usage_row(ui, t!("最后一条"), summary.last_text().as_deref().unwrap_or("—"), true);
			ui.add_space(6.0);
			context_share(ui, summary);
		});
	if summary.usage_entries == 0 {
		let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::hover());
		ui.painter().text(
			pos2(row.min.x + 4.0, row.center().y),
			egui::Align2::LEFT_CENTER,
			t!("会话日志里还没有 usage 条目"),
			egui::FontId::new(11.0, egui::FontFamily::Proportional),
			theme::TEXT_3,
		);
	}
}

/// The context share: a bar and `tokens / window · percent`, or tokens alone.
fn context_share(ui: &mut Ui, summary: &conversation::UsageSummary) {
	let tokens = grouped(summary.context_tokens());
	let (head, _) = ui.allocate_exact_size(vec2(ui.available_width(), 20.0), Sense::hover());
	ui.painter().text(
		pos2(head.min.x + 2.0, head.center().y),
		egui::Align2::LEFT_CENTER,
		t!("上下文"),
		egui::FontId::new(11.0, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	let value = match (summary.window, summary.percent()) {
		(Some(window), Some(percent)) => {
			format!("{tokens} / {} · {percent:.0}%", grouped(window))
		},
		_ => format!("{tokens} tokens"),
	};
	ui.painter().text(
		pos2(head.max.x - 2.0, head.center().y),
		egui::Align2::RIGHT_CENTER,
		value,
		egui::FontId::new(11.0, egui::FontFamily::Monospace),
		theme::TEXT_2,
	);
	match summary.percent() {
		Some(percent) => usage_bar(ui, (percent / 100.0) as f32),
		None => {
			let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 18.0), Sense::hover());
			ui.painter().text(
				pos2(row.min.x + 2.0, row.center().y),
				egui::Align2::LEFT_CENTER,
				t!("窗口未知，不显示占比"),
				egui::FontId::new(10.5, egui::FontFamily::Proportional),
				theme::TEXT_3,
			);
		},
	}
}

/// One label/value row of the card.
fn usage_row(ui: &mut Ui, label: &str, value: &str, mono: bool) {
	let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::hover());
	ui.painter().text(
		pos2(row.min.x + 2.0, row.center().y),
		egui::Align2::LEFT_CENTER,
		label,
		egui::FontId::new(11.0, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	let x = row.min.x + 62.0;
	if mono {
		truncated_mono(ui, pos2(x, row.center().y), value, 11.0, theme::TEXT, row.width() - 68.0);
	} else {
		truncated_text(ui, pos2(x, row.center().y), value, 11.5, theme::TEXT, row.width() - 68.0);
	}
}

/// The page's source badge (`当前会话` / `最新会话`).
fn source_chip(ui: &mut Ui, label: &str) {
	let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::hover());
	let width = crate::center::display_cols(label) as f32 * 11.0 + 14.0;
	let rect = Rect::from_min_size(pos2(row.min.x + 4.0, row.center().y - 9.0), vec2(width, 18.0));
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::CHIP_BRANCH_BG);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(theme::R_CONTROL),
		Stroke::new(1.0_f32, theme::CHIP_BRANCH_BORDER),
		egui::StrokeKind::Middle,
	);
	ui.painter().text(
		rect.center(),
		egui::Align2::CENTER_CENTER,
		label,
		egui::FontId::new(10.5, egui::FontFamily::Monospace),
		theme::CHIP_BRANCH_INK,
	);
}

/// A thin context bar; the fill is the real share, never a placeholder.
fn usage_bar(ui: &mut Ui, fraction: f32) {
	let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 10.0), Sense::hover());
	let rect = Rect::from_min_size(
		pos2(row.min.x + 2.0, row.center().y - 3.0),
		vec2((row.width() - 4.0).max(1.0), 6.0),
	);
	ui.painter()
		.rect_filled(rect, CornerRadius::same(3), theme::PANEL_4);
	let filled = (rect.width() * fraction.clamp(0.0, 1.0)).max(0.0);
	if filled > 0.0 {
		ui.painter().rect_filled(
			Rect::from_min_size(rect.min, vec2(filled, rect.height())),
			CornerRadius::same(3),
			theme::ACCENT,
		);
	}
}

/// `1234567` → `1,234,567` (the token rows read as counts, not identifiers).
fn grouped(value: u64) -> String {
	let digits = value.to_string();
	let mut out = String::with_capacity(digits.len() + digits.len() / 3);
	for (index, digit) in digits.chars().enumerate() {
		if index > 0 && (digits.len() - index).is_multiple_of(3) {
			out.push(',');
		}
		out.push(digit);
	}
	out
}

/// A git failure reduced to one short, human clause.
///
/// `git`'s own text is the whole command line plus a `fatal:` dump. The panel
/// already says `无法读取 git 状态`, so the reason only has to finish the
/// sentence: the refusals a user can act on get a plain word, and anything
/// else is cut to a fixed budget with an ellipsis.
fn short_git_error(error: &str) -> String {
	for (needle, phrase) in [
		("cwd does not exist", t!("目录不存在")),
		("cannot change to", t!("目录不存在")),
		("does not exist", t!("目录不存在")),
		("not a git repository", t!("不是 git 仓库")),
		("ambiguous argument", t!("还没有提交")),
		("unknown revision", t!("还没有提交")),
		("permission denied", t!("没有权限")),
	] {
		if error.contains(needle) {
			return phrase.to_owned();
		}
	}
	let detail = error
		.rsplit_once("fatal: ")
		.map(|(_, rest)| rest)
		.or_else(|| error.rsplit_once(": ").map(|(_, rest)| rest))
		.unwrap_or(error)
		.trim();
	if detail.chars().count() <= 20 {
		return detail.to_owned();
	}
	let mut short: String = detail.chars().take(19).collect();
	short.push('…');
	short
}

fn branch_row(ui: &mut Ui, status: &crate::git::GitStatus) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 24.0), Sense::hover());
	paint(
		ui.painter(),
		Icon::GitBranch,
		Rect::from_center_size(pos2(rect.min.x + 10.0, rect.center().y), vec2(14.0, 14.0)),
		theme::CYAN,
		1.5,
	);
	let branch = status.branch.clone();
	truncated_mono(ui, pos2(rect.min.x + 23.0, rect.center().y), &branch, 12.0, theme::TEXT, 150.0);
	let upstream = status
		.upstream
		.as_ref()
		.map(|name| format!("→ {name}"))
		.unwrap_or_else(|| t!("无上游分支").to_owned());
	truncated_mono(
		ui,
		pos2(rect.min.x + 23.0 + 120.0, rect.center().y),
		&upstream,
		11.0,
		theme::TEXT_3,
		90.0,
	);
	ui.painter().text(
		pos2(rect.max.x - 4.0, rect.center().y),
		egui::Align2::RIGHT_CENTER,
		format!("+{} -{}", status.insertions, status.deletions),
		egui::FontId::new(11.0, egui::FontFamily::Monospace),
		theme::TEXT_2,
	);
}

/// A `.grp` with its head row.
fn group(
	ui: &mut Ui,
	title: &str,
	count: usize,
	badge_label: &str,
	chevron: bool,
	body: impl FnOnce(&mut Ui),
) -> egui::Response {
	let (head, response) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::click());
	if chevron {
		paint(
			ui.painter(),
			Icon::ChevronDown,
			Rect::from_center_size(pos2(head.min.x + 10.0, head.center().y), vec2(12.0, 12.0)),
			theme::TEXT_3,
			1.6,
		);
	}
	ui.painter().text(
		pos2(head.min.x + 22.0, head.center().y),
		egui::Align2::LEFT_CENTER,
		title,
		egui::FontId::new(11.0, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	ui.painter().text(
		pos2(head.min.x + 22.0 + crate::center::display_cols(title) as f32 * 12.0, head.center().y),
		egui::Align2::LEFT_CENTER,
		count.to_string(),
		egui::FontId::new(11.0, egui::FontFamily::Monospace),
		theme::TEXT_2,
	);
	if !badge_label.is_empty() {
		let mut child = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(
			pos2(head.max.x - 22.0, head.center().y - 7.0),
			vec2(16.0, 14.0),
		)));
		badge(&mut child, badge_label, badge_label == "M");
	}
	body(ui);
	ui.add_space(6.0);
	response
}

fn file_row(ui: &mut Ui, name: &str, stats: Option<(u32, u32)>, badge_label: Option<&str>) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 28.0), Sense::hover());
	paint(
		ui.painter(),
		Icon::File,
		Rect::from_center_size(pos2(rect.min.x + 13.0, rect.center().y), vec2(14.0, 14.0)),
		theme::TEXT_3,
		1.5,
	);
	let stats_width = if stats.is_some() { 96.0 } else { 0.0 };
	truncated_mono(
		ui,
		pos2(rect.min.x + 26.0, rect.center().y),
		name,
		12.0,
		theme::TEXT_2,
		rect.width() - 40.0 - stats_width,
	);
	if let Some((insertions, deletions)) = stats {
		let text = format!("+{insertions} -{deletions}");
		ui.painter().text(
			pos2(rect.max.x - 30.0, rect.center().y),
			egui::Align2::RIGHT_CENTER,
			text,
			egui::FontId::new(11.0, egui::FontFamily::Monospace),
			if insertions > 0 {
				theme::ADD
			} else {
				theme::DEL
			},
		);
	}
	if let Some(label) = badge_label {
		let mut child = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(
			pos2(rect.max.x - 22.0, rect.center().y - 7.0),
			vec2(16.0, 14.0),
		)));
		badge(&mut child, label, label == "M");
	}
}

fn commit_row(ui: &mut Ui, commit: &crate::git::GitCommit) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::hover());
	let dot = pos2(rect.min.x + 8.0, rect.min.y + 10.0);
	ui.painter().circle_stroke(
		dot,
		3.5,
		Stroke::new(
			2.0_f32,
			if commit.merge {
				theme::CYAN
			} else {
				theme::ACCENT
			},
		),
	);
	truncated_text(
		ui,
		pos2(rect.min.x + 20.0, rect.min.y + 10.0),
		&commit.subject,
		12.5,
		theme::TEXT_2,
		rect.width() - 30.0,
	);
	let refs = if commit.refs.is_empty() {
		commit.hash.clone()
	} else {
		commit.refs.join(" · ")
	};
	truncated_mono(
		ui,
		pos2(rect.min.x + 20.0, rect.min.y + 24.0),
		&refs,
		10.5,
		theme::CHIP_BRANCH_INK,
		rect.width() - 30.0,
	);
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_empty_state_is_one_line_and_has_no_number() {
		assert_eq!(conversation::NO_SESSION, "这一页没有会话");
		assert!(
			!conversation::NO_SESSION.chars().any(|c| c.is_ascii_digit()),
			"empty state must not show a number"
		);
	}

	#[test]
	fn token_counts_are_grouped() {
		assert_eq!(grouped(0), "0");
		assert_eq!(grouped(999), "999");
		assert_eq!(grouped(1600), "1,600");
		assert_eq!(grouped(1234567), "1,234,567");
	}
}
