// SPDX-License-Identifier: AGPL-3.0-only
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
	if icon_button(&mut collapse, Icon::ChevronRight, 26.0, false, "关闭右侧栏").clicked() {
		shell.state.toggle_right();
	}
	let panel = Rect::from_min_max(pos2(rect.min.x, head.max.y), rect.max);
	let mut child = ui.new_child(egui::UiBuilder::new().max_rect(panel));
	match shell.state.right_tab {
		RightTab::Files => files_panel(&mut child, shell),
		RightTab::History => history_panel(&mut child, shell),
		RightTab::Git => git_panel(&mut child, shell, "right"),
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
/// `key` distinguishes the scroll state of the two places it is drawn.
pub(crate) fn git_panel(ui: &mut Ui, shell: &mut Shell, key: &str) {
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
		empty_note(
			ui,
			&format!("无法读取 git 状态：{}", short_git_error(error)),
			"工作区目录里的 git 仓库",
		);
		readonly_hint(ui);
		return;
	}
	egui::ScrollArea::vertical()
		.id_salt(("zetawork-git", key))
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

/// 上下文用量: what this build can state about the *current* session.
///
/// The card draws no invented figures. With no agent pane attached it says so
/// in one line and shows no counters. The mechanism lines are the product's
/// real compaction rules — `shouldCompact` / `findValidCutPoints` in
/// `packages/agent/src/compaction/compaction.ts`, the `compaction.*` defaults in
/// `packages/coding-agent/src/session/context-settings.ts`, and the method list
/// in `packages/coding-agent/src/session/compaction-methods.ts`.
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
	let session = attached_session(shell);
	// 已载入文件 is the one part of this page with a real source today: the
	// 编辑器 pages that are open, whose bytes are in memory.
	let loaded: Vec<String> = shell
		.state
		.visible_panes()
		.iter()
		.flat_map(|pane| pane.tabs.iter())
		.filter_map(|tab| tab.doc.as_ref().map(|doc| doc.path.display().to_string()))
		.collect();
	egui::ScrollArea::vertical()
		.id_salt("zetawork-context")
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
				&format!("分支 {branch}"),
				11.0,
				theme::TEXT_3,
				scope.width() - 8.0,
			);
			// One line, one fact: the session this page is about, or the fact
			// that there is none. No counters are drawn while detached.
			let (status, _) = ui.allocate_exact_size(vec2(ui.available_width(), 24.0), Sense::hover());
			if let Some(id) = &session {
				truncated_mono(
					ui,
					pos2(status.min.x + 4.0, status.center().y),
					&session_line(Some(id)),
					11.0,
					theme::TEXT_2,
					status.width() - 8.0,
				);
			} else {
				truncated_text(
					ui,
					pos2(status.min.x + 4.0, status.center().y),
					&session_line(None),
					11.5,
					theme::TEXT_3,
					status.width() - 8.0,
				);
			}
			// The mechanism, as it actually is.
			egui::Frame::new()
				.fill(theme::PANEL_2)
				.stroke(Stroke::new(1.0_f32, theme::BORDER))
				.corner_radius(CornerRadius::same(theme::R_PANEL))
				.inner_margin(egui::Margin::same(10))
				.show(ui, |ui| {
					ui.set_width(ui.available_width());
					ui.spacing_mut().item_spacing.y = 3.0;
					context_fact(ui, "统计范围", CONTEXT_MEASURED);
					context_fact(ui, "何时压缩", COMPACTION_TRIGGER);
					context_fact(ui, "切点与保留", COMPACTION_CUT);
					context_fact(ui, "压缩方法", COMPACTION_METHODS);
				});
			// 已载入文件 — this part *is* real: it lists the 编辑器 pages that are
			// actually open, which is the same set whose bytes are in memory.
			ui.add_space(2.0);
			let (sub, _) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::hover());
			ui.painter().text(
				pos2(sub.min.x + 6.0, sub.center().y),
				egui::Align2::LEFT_CENTER,
				"已载入文件",
				egui::FontId::new(11.0, egui::FontFamily::Proportional),
				theme::TEXT_3,
			);
			if loaded.is_empty() {
				let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 20.0), Sense::hover());
				ui.painter().text(
					pos2(row.min.x + 6.0, row.center().y),
					egui::Align2::LEFT_CENTER,
					"没有打开的编辑器页面",
					egui::FontId::new(11.0, egui::FontFamily::Proportional),
					theme::TEXT_3,
				);
			}
			for file in &loaded {
				let (row, _) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::hover());
				paint(
					ui.painter(),
					Icon::File,
					Rect::from_center_size(pos2(row.min.x + 12.0, row.center().y), vec2(14.0, 14.0)),
					theme::TEXT_3,
					1.5,
				);
				truncated_mono(
					ui,
					pos2(row.min.x + 24.0, row.center().y),
					file,
					11.0,
					theme::TEXT_2,
					row.width() - 28.0,
				);
			}
		});
}

/// One heading plus one wrapped paragraph of the context card.
fn context_fact(ui: &mut Ui, heading: &str, body: &str) {
	ui.add(egui::Label::new(egui::RichText::new(heading).size(11.0).color(theme::TEXT_3)).wrap());
	ui.add(egui::Label::new(egui::RichText::new(body).size(11.5).color(theme::TEXT_2)).wrap());
	ui.add_space(5.0);
}

/// The first agent pane's attached gateway session, if any pane has one.
///
/// This is the "current session" the 上下文 page is about: a `SessionKind::Agent`
/// tab whose pane holds a session id. An empty agent pane is not a session.
fn attached_session(shell: &Shell) -> Option<String> {
	shell
		.state
		.visible_panes()
		.iter()
		.flat_map(|pane| pane.tabs.iter())
		.filter(|tab| tab.kind == crate::state::SessionKind::Agent)
		.find_map(|tab| {
			shell
				.agents
				.pane(&tab.id)
				.and_then(|pane| pane.session.clone())
		})
}

/// The card's status line: the attached session, or the plain fact that there
/// is none. Kept pure so the empty state can be tested for carrying no number.
pub fn session_line(session: Option<&str>) -> String {
	match session {
		Some(id) => format!("已连接会话 {id}"),
		None => NO_SESSION.to_owned(),
	}
}

/// What the card says with no session attached. No number, no promise of one.
pub const NO_SESSION: &str = "当前没有连接的会话";

/// What the card measures, and where the numbers come from.
pub const CONTEXT_MEASURED: &str =
	"当前会话的上下文 token 数、窗口上限与占比，数字取自运行中会话的用量报告。";

/// When compaction runs.
pub const COMPACTION_TRIGGER: &str = "上下文超过提示预算时压缩：窗口预留 15%（默认约 85%）；compaction.thresholdPercent 或 compaction.thresholdTokens 可覆盖。";

/// Where the cut lands, and how much stays verbatim.
pub const COMPACTION_CUT: &str =
	"切点落在工具调用 / 结果对之外；最近 20000 token 原样保留，更早的历史交给配置的压缩方法。";

/// The methods a compaction pass can use, in the product's own names.
pub const COMPACTION_METHODS: &str = "服务端压缩 · Snapcompact · Handoff · 软压缩（LLM 摘要）· Shake（丢弃可恢复的重内容，不调用 LLM）";

/// A git failure reduced to one short, human clause.
///
/// `git`'s own text is the whole command line plus a `fatal:` dump. The panel
/// already says `无法读取 git 状态`, so the reason only has to finish the
/// sentence: the refusals a user can act on get a plain word, and anything
/// else is cut to a fixed budget with an ellipsis.
fn short_git_error(error: &str) -> String {
	for (needle, phrase) in [
		("cwd does not exist", "目录不存在"),
		("cannot change to", "目录不存在"),
		("does not exist", "目录不存在"),
		("not a git repository", "不是 git 仓库"),
		("ambiguous argument", "还没有提交"),
		("unknown revision", "还没有提交"),
		("permission denied", "没有权限"),
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

fn readonly_hint(ui: &mut Ui) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 34.0), Sense::hover());
	truncated_text(
		ui,
		pos2(rect.min.x + 4.0, rect.min.y + 10.0),
		"本切片只读：暂存 / 提交 / 创建 PR 未接入（未来：git add、git commit、gh pr create）",
		11.0,
		theme::WARN,
		rect.width() - 8.0,
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

	/// The card's whole visible copy, so a banned sentence cannot hide in one
	/// constant while the test checks another.
	fn context_copy() -> String {
		[NO_SESSION, CONTEXT_MEASURED, COMPACTION_TRIGGER, COMPACTION_CUT, COMPACTION_METHODS]
			.join("\n")
	}

	#[test]
	fn the_demo_copy_is_gone() {
		let copy = context_copy();
		for banned in [
			"上下文数字未接线",
			"上下文接近 80%",
			"自动压缩较早的工具输出",
			"只统计这一个会话",
			"未来数据源",
		] {
			assert!(!copy.contains(banned), "placeholder copy survived: {banned}");
		}
	}

	#[test]
	fn the_card_states_the_real_mechanism() {
		let copy = context_copy();
		for fact in [
			"token",
			"窗口",
			"占比",
			"用量报告",
			"15%",
			"85%",
			"compaction.thresholdPercent",
			"compaction.thresholdTokens",
			"工具调用",
			"20000",
			"服务端压缩",
			"Snapcompact",
			"Handoff",
			"软压缩",
			"Shake",
		] {
			assert!(copy.contains(fact), "the real mechanism is missing {fact}");
		}
	}

	#[test]
	fn the_empty_state_is_one_line_and_has_no_number() {
		let line = session_line(None);
		assert_eq!(line, NO_SESSION);
		assert!(!line.chars().any(|c| c.is_ascii_digit()), "empty state must not show a number");
		assert!(!line.contains('—'));
	}

	#[test]
	fn an_attached_session_names_itself() {
		assert_eq!(session_line(Some("sess-42")), "已连接会话 sess-42");
	}
}
