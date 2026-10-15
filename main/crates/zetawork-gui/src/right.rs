//! The right column: 文件 / 历史 · Agent 对话 / Git 状态, plus its collapsed rail.
//!
//! Two of the three panels read live data: the file tree walks the active
//! workspace's directory one level at a time (see [`crate::fsread`]) and the git
//! panel runs read-only `git` (see [`crate::git`]). The history panel has no
//! source yet, so it shows one card that says so. Nothing in this column writes
//! to the repository: 暂存 / 提交 / 创建 PR exist as the spec draws them, and are
//! disabled with a line naming what would back them.

use std::collections::HashSet;

use egui::{Align, Color32, CornerRadius, Layout, Rect, Sense, Stroke, Ui, pos2, vec2};

use crate::Shell;
use crate::fsread::DirNode;
use crate::icons::{Icon, icon_button, paint};
use crate::state::RightTab;
use crate::theme;
use crate::widgets::{badge, empty_note, panel_head, truncated_mono, truncated_text};

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
		Stroke::new(1.0, theme::BORDER),
	);
	let head = Rect::from_min_size(rect.min, vec2(rect.width(), 44.0));
	ui.painter().line_segment(
		[pos2(head.min.x, head.max.y - 0.5), pos2(head.max.x, head.max.y - 0.5)],
		Stroke::new(1.0, theme::BORDER),
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
	if icon_button(&mut collapse, Icon::ChevronRight, 26.0, false, "关闭右侧栏").clicked() {
		shell.state.toggle_right();
	}
	let panel = Rect::from_min_max(pos2(rect.min.x, head.max.y), rect.max);
	let mut child = ui.new_child(egui::UiBuilder::new().max_rect(panel));
	match shell.state.right_tab {
		RightTab::Files => files_panel(&mut child, shell),
		RightTab::History => history_panel(&mut child, shell),
		RightTab::Git => git_panel(&mut child, shell),
		RightTab::Context => context_panel(&mut child, shell),
	}
}

fn tab_icon(tab: RightTab) -> Icon {
	match tab {
		RightTab::Files => Icon::Folder,
		RightTab::History => Icon::History,
		RightTab::Git => Icon::GitBranch,
		RightTab::Context => Icon::List,
	}
}

/// `rail.rail-right`: the same three tabs in a thin strip.
pub fn right_rail(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	ui.painter().line_segment(
		[pos2(rect.min.x + 0.5, rect.min.y), pos2(rect.min.x + 0.5, rect.max.y)],
		Stroke::new(1.0, theme::BORDER),
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
		if icon_button(ui, Icon::Refresh, 20.0, false, "重新读取目录").clicked() {
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
		empty_note(ui, &error, "工作区目录（可读的本地路径）");
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
		empty_note(ui, "先打开一个工作区", "左侧的项目 → 工作区");
		return;
	};
	let root_path = std::path::PathBuf::from(&path);
	egui::ScrollArea::vertical()
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
						.show(crate::state::Notice("先打开一个工作区，再打开文件".to_owned())),
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

fn history_panel(ui: &mut Ui, shell: &mut Shell) {
	panel_head(ui, "历史 · Agent 对话", |ui| {
		if icon_button(ui, Icon::Plus, 20.0, false, "新会话").clicked() {
			shell.state.show(crate::state::Notice(
				"新会话：会话宿主尚未接入（未来数据源：zetacode 会话）".to_owned(),
			));
		}
	});
	empty_note(
		ui,
		"还没有对话记录",
		"zetacode 会话存储（~/.zeta/agent/agent.db）与 zetacode stats /api/sessions",
	);
}

// ── Git 状态 ──────────────────────────────────────────────────────────────

/// The Git panel: the same function draws the right column's Git tab and a
/// `Git` page in the centre grid, so the two can never show different numbers.
pub(crate) fn git_panel(ui: &mut Ui, shell: &mut Shell) {
	panel_head(ui, RightTab::Git.title(), |ui| {
		if icon_button(ui, Icon::Refresh, 20.0, false, "重新读取 git 状态").clicked() {
			shell.refresh_git();
		}
	});
	if shell.git.is_none() {
		shell.refresh_git();
	}
	let status = shell.git.clone();
	let Some(status) = status else {
		empty_note(ui, "正在读取 git 状态…", "git status/log/rev-list（只读）");
		return;
	};
	if let Some(error) = &status.error {
		empty_note(ui, &format!("无法读取 git 状态：{error}"), "工作区目录里的 git 仓库");
		readonly_hint(ui);
		return;
	}
	egui::ScrollArea::vertical()
		.auto_shrink([false, false])
		.show(ui, |ui| {
			ui.spacing_mut().item_spacing.y = 4.0;
			// 创建 PR — the spec's green button, disabled: this slice does not push.
			let (rect, response) =
				ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::click());
			ui.painter().rect_filled(
				rect,
				CornerRadius::same(theme::R_PANEL),
				theme::PR_GREEN.gamma_multiply(0.45),
			);
			paint(
				ui.painter(),
				Icon::GitPr,
				Rect::from_center_size(pos2(rect.center().x - 26.0, rect.center().y), vec2(15.0, 15.0)),
				Color32::from_gray(0xdd),
				1.6,
			);
			ui.painter().text(
				pos2(rect.center().x + 6.0, rect.center().y),
				egui::Align2::CENTER_CENTER,
				"创建 PR",
				egui::FontId::new(13.0, egui::FontFamily::Proportional),
				Color32::from_gray(0xdd),
			);
			let _ = response.on_hover_text("本切片只读：创建 PR 未接入（未来：gh pr create）");

			branch_row(ui, &status);
			readonly_hint(ui);

			let (message_rect, _) =
				ui.allocate_exact_size(vec2(ui.available_width(), 56.0), Sense::hover());
			let mut message = shell.git_message.clone();
			let mut child = ui.new_child(egui::UiBuilder::new().max_rect(message_rect));
			child.add_enabled(
				false,
				egui::TextEdit::multiline(&mut message)
					.hint_text("提交信息（本切片只读）")
					.desired_width(f32::INFINITY)
					.desired_rows(2),
			);
			shell.git_message = message;

			group(ui, "更改", status.changed.len(), "M", true, |ui| {
				for file in &status.changed {
					file_row(ui, &file.path, Some((file.insertions, file.deletions)), Some("M"));
				}
			});
			if !status.untracked.is_empty() {
				group(ui, "未跟踪文件", status.untracked.len(), "U", false, |ui| {
					for file in &status.untracked {
						file_row(ui, &file.path, None, Some("U"));
					}
				});
			}
			let commits_open = shell.state.commits_open;
			let commits: Vec<crate::git::GitCommit> = status.commits.clone();
			let head = group(ui, "提交", commits.len(), "", true, |ui| {
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

/// 上下文用量: the *current* session's context (R16/R17), not the global roll-up.
///
/// The ring, the legend and the sub-agent list are drawn from
/// `GET /api/agent/<id>/context` and `GET /api/agent/<id>/subagents` — an API
/// this crate has no client for, and only answers while a session is running.
/// So the panel draws the scope it is about (the real path and branch) and the
/// shape it will fill, and sends the user to the 用量 container for the real
/// numbers that exist today. It never invents a percentage.
fn context_panel(ui: &mut Ui, shell: &mut Shell) {
	panel_head(ui, RightTab::Context.title(), |ui| {
		if icon_button(ui, Icon::List, 20.0, false, "展开用量统计").clicked() {
			crate::left::open_usage(shell);
		}
	});
	let path = shell
		.state
		.active_workspace()
		.map(|ws| ws.path.clone())
		.unwrap_or_default();
	let branch = shell.state.branch_label().to_owned();
	egui::ScrollArea::vertical()
		.auto_shrink([false, false])
		.show(ui, |ui| {
			ui.spacing_mut().item_spacing.y = 6.0;
			// The scope line: 当前路径 + 当前分支 (R17's panel head).
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
				&format!("分支 {branch} · 当前会话"),
				11.0,
				theme::TEXT_3,
				scope.width() - 8.0,
			);
			// The ring's frame, empty: no live session, so no arc.
			let (ring, _) = ui.allocate_exact_size(vec2(ui.available_width(), 118.0), Sense::hover());
			let centre = pos2(ring.center().x - 58.0, ring.center().y);
			ui.painter()
				.circle_stroke(centre, 46.0, Stroke::new(10.0, theme::PANEL_4));
			ui.painter().text(
				centre,
				egui::Align2::CENTER_CENTER,
				"无活动会话",
				egui::FontId::new(11.5, egui::FontFamily::Proportional),
				theme::TEXT_3,
			);
			for (index, label) in ["系统提示", "系统上下文", "工具定义", "技能", "会话消息"]
				.iter()
				.enumerate()
			{
				let y = ring.min.y + 12.0 + index as f32 * 20.0;
				ui.painter().rect_filled(
					Rect::from_min_size(pos2(ring.center().x + 6.0, y), vec2(8.0, 8.0)),
					CornerRadius::same(2),
					theme::PANEL_4,
				);
				ui.painter().text(
					pos2(ring.center().x + 22.0, y + 4.0),
					egui::Align2::LEFT_CENTER,
					*label,
					egui::FontId::new(11.5, egui::FontFamily::Proportional),
					theme::TEXT_3,
				);
				ui.painter().text(
					pos2(ring.max.x - 4.0, y + 4.0),
					egui::Align2::RIGHT_CENTER,
					"—",
					egui::FontId::new(11.0, egui::FontFamily::Monospace),
					theme::TEXT_3,
				);
			}
			empty_note(
				ui,
				"上下文数字未接线：需要一个运行中的会话",
				"GET /api/agent/<id>/context · /subagents（zetacode web gateway，仅 live 会话）",
			);
			let (button, response) =
				ui.allocate_exact_size(vec2(ui.available_width(), 30.0), Sense::click());
			ui.painter()
				.rect_filled(button, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
			ui.painter().text(
				button.center(),
				egui::Align2::CENTER_CENTER,
				"打开用量统计（stats 页面）",
				egui::FontId::new(12.0, egui::FontFamily::Proportional),
				if response.hovered() {
					theme::TEXT
				} else {
					theme::TEXT_2
				},
			);
			if response.clicked() {
				crate::left::open_usage(shell);
			}
		});
}

fn readonly_hint(ui: &mut Ui) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::hover());
	ui.painter().text(
		pos2(rect.min.x + 4.0, rect.min.y + 10.0),
		egui::Align2::LEFT_TOP,
		"本切片只读：暂存 / 提交 / 创建 PR 未接入（未来：git add、git commit、gh pr create）",
		egui::FontId::new(11.0, egui::FontFamily::Proportional),
		theme::WARN,
	);
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
		.unwrap_or_else(|| "无上游分支".to_owned());
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
			2.0,
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
	ui.painter().text(
		pos2(rect.min.x + 20.0, rect.min.y + 24.0),
		egui::Align2::LEFT_CENTER,
		refs,
		egui::FontId::new(10.5, egui::FontFamily::Monospace),
		theme::CHIP_BRANCH_INK,
	);
}
