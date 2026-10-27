// SPDX-License-Identifier: AGPL-3.0-only
//! The command palette: ⌘K / Ctrl+Shift+P, one box that jumps and acts.
//!
//! # What it is
//!
//! A **navigation and desktop-action** surface only: it lists projects,
//! workspaces, conversations and files — and the actions that belong to the
//! shell (switch the active workspace's branch, open 设置 → 远程访问, restart the
//! serve backend, and every command in [`crate::commands`] that is not the
//! palette's own). It is *not* a slash-command surface: typing `/` is a
//! search for a project or file whose name starts with `/`, never a command
//! interpreter, and nothing here types into a terminal. The terminal's input
//! path ([`crate::Shell::forward_terminal_input`]) is untouched; the palette
//! only consumes keys while it is open.
//!
//! # Ranking
//!
//! [`rank`] is pure and unit-tested: every whitespace-separated token must
//! match, on a weighted scale — an exact title beats a title prefix, which
//! beats a word-boundary prefix, which beats a substring, which beats a match
//! in the row's detail line (a path). Ties keep the order the rows were built
//! in, so an empty query shows the shell's own order and a repeated query is
//! stable.
//!
//! # Rows
//!
//! [`build`] takes the shell state plus the two lists that need I/O (files and
//! branches) so the caller can read them once when the palette opens rather
//! than once per frame. [`Shell::open_palette`] is that caller.

use std::path::{Path, PathBuf};

use egui::{Align, CornerRadius, FontId, Layout, Order, Rect, Sense, Stroke, pos2, vec2};

use crate::{
	Shell, git,
	icons::Icon,
	settings::Settings,
	state::AppState,
	t, theme,
	widgets::{truncated_mono, truncated_text},
};

/// What the box lists, in the order sections are drawn.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
	/// Select a project in the left column.
	Project(String),
	/// Select one workspace's 大标签页.
	Workspace(String),
	/// Open a gateway conversation.
	Conversation(String),
	/// Open a file in an editor page.
	File(PathBuf),
	/// Switch the active workspace's checkout to this branch.
	Branch(String),
	/// Open 设置 → 远程访问.
	RemoteSettings,
	/// `zetacode daemon restart`.
	RestartBackend,
	/// A named command from [`crate::commands`] — the same id its chord and
	/// its 设置 row use.
	Command(&'static str),
}

/// One row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
	pub section: &'static str,
	pub title: String,
	pub detail: String,
	pub action: Action,
}

/// The palette's state: the open flag lives in [`AppState`] as `Option<Self>`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Palette {
	pub query: String,
	/// Index into the *ranked* rows, clamped by the renderer.
	pub selected: usize,
	pub items: Vec<Item>,
}

impl Palette {
	/// The rows for `query`, in display order.
	pub fn ranked(&self) -> Vec<usize> {
		rank(&self.items, &self.query)
	}

	/// Move the selection by `delta`, wrapping at both ends.
	pub fn step(&mut self, delta: isize) {
		let count = self.ranked().len();
		if count == 0 {
			self.selected = 0;
			return;
		}
		let count = count as isize;
		let next = (self.selected as isize + delta).rem_euclid(count);
		self.selected = next as usize;
	}

	/// The item Enter would run.
	pub fn chosen(&self) -> Option<&Item> {
		let ranked = self.ranked();
		ranked
			.get(self.selected.min(ranked.len().saturating_sub(1)))
			.map(|index| &self.items[*index])
	}
}

/// Match `item` against `query`, returning a score or `None` when any token
/// misses.
///
/// Scores are deliberately coarse: the absolute value does not matter, only
/// the order of the tiers.
pub fn score(item: &Item, query: &str) -> Option<i32> {
	let query = query.trim();
	if query.is_empty() {
		return Some(0);
	}
	let title = item.title.to_lowercase();
	let detail = item.detail.to_lowercase();
	let mut total = 0;
	for token in query.split_whitespace() {
		let token = token.to_lowercase();
		let token_score = if title == token {
			1000
		} else if title.starts_with(&token) {
			800
		} else if title
			.split(|ch: char| ch.is_whitespace() || matches!(ch, '/' | '\\' | '-' | '_' | '.' | ':'))
			.any(|word| word.starts_with(&token))
		{
			600
		} else if title.contains(&token) {
			400
		} else if detail.contains(&token) {
			150
		} else {
			return None;
		};
		total += token_score;
	}
	// Shorter titles are more specific at the same score tier.
	Some(total - (title.chars().count() as i32).min(40))
}

/// The ranked indices of `items` for `query`.
///
/// Stable: equal scores keep their original order (the sort is by
/// `(score, index)` in reverse). Rows are then grouped by section, with the
/// sections ordered by their best row — so a section heading is painted once
/// and the best match is still on top.
pub fn rank(items: &[Item], query: &str) -> Vec<usize> {
	let mut scored: Vec<(i32, usize)> = items
		.iter()
		.enumerate()
		.filter_map(|(index, item)| score(item, query).map(|score| (score, index)))
		.collect();
	scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
	let mut sections: Vec<&'static str> = Vec::new();
	for (_, index) in &scored {
		let section = items[*index].section;
		if !sections.contains(&section) {
			sections.push(section);
		}
	}
	let mut ranked = Vec::with_capacity(scored.len());
	for section in sections {
		ranked.extend(
			scored
				.iter()
				.filter(|(_, index)| items[*index].section == section)
				.map(|(_, index)| *index),
		);
	}
	ranked
}

/// Build the full row set.
///
/// `files` are absolute paths (the active workspace's), `branches` the active
/// workspace's branches. Both may be empty; the corresponding section then
/// simply does not appear.
pub fn build(
	state: &AppState,
	settings: &Settings,
	files: &[PathBuf],
	branches: &[git::GitBranch],
) -> Palette {
	let mut items = Vec::new();

	// Actions first: the palette is a verb as much as a noun. The two fixed
	// desktop actions stay at the top of the section so a long branch list
	// cannot bury them.
	items.push(Item {
		section: t!("操作"),
		title: t!("打开远程访问设置").to_owned(),
		detail: t!("设置 → 远程访问：绑定地址、TLS、令牌、配对码").to_owned(),
		action: Action::RemoteSettings,
	});
	items.push(Item {
		section: t!("操作"),
		title: t!("重启后端").to_owned(),
		detail: t!("设置 → 常规 → 后台服务").to_owned(),
		action: Action::RestartBackend,
	});
	// Every registry command except the palette itself (a row that reopens the
	// box the user is looking at is noise). The detail carries the chord in
	// effect, so an override in 设置 → 快捷键 shows up here too.
	for command in crate::commands::COMMANDS
		.iter()
		.filter(|command| !command.global)
	{
		let chord = crate::commands::chord(&settings.command_keys, command);
		items.push(Item {
			section: t!("桌面动作"),
			title: crate::i18n::tr(command.label).to_owned(),
			detail: format!("{} · {}", crate::i18n::tr(command.hint), chord.label()),
			action: Action::Command(command.id),
		});
	}
	if !branches.is_empty() {
		for branch in branches.iter().filter(|branch| !branch.current) {
			items.push(Item {
				section: t!("操作"),
				title: t!("切换分支 {}", branch.name),
				detail: if branch.remote {
					t!("远程分支，会创建同名的本地分支").to_owned()
				} else {
					t!("git switch {}", branch.name)
				},
				action: Action::Branch(branch.name.clone()),
			});
		}
	}

	for project in &state.projects {
		items.push(Item {
			section: t!("项目"),
			title: project.name.clone(),
			detail: project.path.display().to_string(),
			action: Action::Project(project.id.clone()),
		});
		for workspace in &project.workspaces {
			items.push(Item {
				section: t!("工作区"),
				title: workspace.name.clone(),
				detail: if workspace.branch.is_empty() || workspace.branch == "—" {
					workspace.path.clone()
				} else {
					format!("{} · {}", workspace.branch, workspace.path)
				},
				action: Action::Workspace(workspace.id.clone()),
			});
		}
	}
	for entry in &state.conversations {
		items.push(Item {
			section: t!("会话"),
			title: entry.conversation.display_title().to_owned(),
			detail: entry.conversation.cwd.display().to_string(),
			action: Action::Conversation(entry.conversation.id.clone()),
		});
	}
	for path in files {
		let title = path
			.file_name()
			.map(|name| name.to_string_lossy().into_owned())
			.unwrap_or_else(|| path.display().to_string());
		items.push(Item {
			section: t!("文件"),
			title,
			detail: path.display().to_string(),
			action: Action::File(path.clone()),
		});
	}

	Palette { query: String::new(), selected: 0, items }
}

/// Read the active workspace's file list for the palette.
///
/// `git ls-files` is the fast path; a directory that is not a repository gets
/// a bounded walk instead, skipping the trees nobody wants in a jump list.
pub fn collect_files(root: &Path, limit: usize) -> Vec<PathBuf> {
	if let Ok(rows) = git::list_files(root, limit) {
		return rows.into_iter().map(|path| root.join(path)).collect();
	}
	let mut out = Vec::new();
	walk(root, root, 4, limit, &mut out);
	out.sort();
	out
}

/// Bounded depth-first walk for a non-git directory.
fn walk(root: &Path, dir: &Path, depth: usize, limit: usize, out: &mut Vec<PathBuf>) {
	if depth == 0 || out.len() >= limit {
		return;
	}
	let Ok(entries) = std::fs::read_dir(dir) else {
		return;
	};
	let mut entries: Vec<_> = entries.flatten().collect();
	entries.sort_by_key(|entry| entry.file_name());
	for entry in entries {
		if out.len() >= limit {
			return;
		}
		let name = entry.file_name().to_string_lossy().into_owned();
		if name.starts_with('.') {
			continue;
		}
		let path = entry.path();
		if path.is_dir() {
			if matches!(
				name.as_str(),
				"node_modules" | "target" | "dist" | "build" | "vendor" | "out" | "__pycache__"
			) {
				continue;
			}
			walk(root, &path, depth - 1, limit, out);
		} else if path.is_file() {
			let _ = root;
			out.push(path);
		}
	}
}

/// Run one action. Returns what the shell should say (empty for a silent
/// jump, so a successful navigation never flashes a toast).
pub fn run(shell: &mut Shell, action: &Action) -> crate::state::Notice {
	use crate::state::Notice;
	match action {
		Action::Project(id) => shell.state.select_project(id),
		Action::Workspace(id) => shell.state.select_workspace(id),
		Action::Conversation(id) => shell.state.open_conversation(id),
		Action::File(path) => match shell
			.state
			.active_pane()
			.map(|pane| pane.id.clone())
			.or_else(|| {
				shell
					.state
					.active_workspace()
					.and_then(|workspace| workspace.panes.first())
					.map(|pane| pane.id.clone())
			}) {
			Some(pane) => shell.state.open_file(&pane, path),
			None => Notice(t!("没有可以打开文件的面板").to_owned()),
		},
		Action::Branch(name) => {
			let Some(path) = shell
				.state
				.active_workspace()
				.map(|workspace| PathBuf::from(&workspace.path))
			else {
				return Notice(t!("没有打开的工作区").to_owned());
			};
			let Ok(branches) = git::read_branches(&path) else {
				return Notice(t!("无法读取分支列表：{}", path.display()));
			};
			match branches.into_iter().find(|branch| &branch.name == name) {
				Some(branch) => {
					shell.switch_git_branch(&branch);
					shell
						.git_notice
						.clone()
						.map(|(_, line)| Notice(line))
						.unwrap_or(Notice(String::new()))
				},
				None => Notice(t!("没有这个分支：{}", name)),
			}
		},
		Action::RemoteSettings => {
			shell
				.state
				.open_settings_section(crate::settings::Section::Remote);
			Notice(String::new())
		},
		Action::RestartBackend => restart_backend(shell),
		Action::Command(id) => {
			if shell.run_command(id) {
				Notice(String::new())
			} else {
				Notice(t!("这条命令现在不可用").to_owned())
			}
		},
	}
}

/// Restart through the shell's backend state machine: this honors
/// `backend.enabled` and restarts in `backend.workspace` instead of running a
/// bare daemon command from the GUI's own cwd.
pub fn restart_backend(shell: &mut Shell) -> crate::state::Notice {
	use crate::state::Notice;
	if shell.backend.phase().busy() {
		return Notice(t!("正在重启后端…").to_owned());
	}
	if !shell.probe {
		// A headless shell (`with_state`) never starts a CLI.
		return Notice(t!("（无窗口模式）将重启后台服务").to_owned());
	}
	shell.backend.restart();
	Notice(t!("正在重启后端…").to_owned())
}

/// The palette's own key handling. Returns true when it consumed the frame's
/// keys (so the shell's hotkeys and the terminal must not also see them).
pub fn keys(ctx: &egui::Context, shell: &mut Shell) -> bool {
	if shell.state.palette().is_none() {
		return false;
	}
	let (up, down, enter, escape) = ctx.input(|input| {
		(
			input.key_pressed(egui::Key::ArrowUp),
			input.key_pressed(egui::Key::ArrowDown),
			input.key_pressed(egui::Key::Enter),
			input.key_pressed(egui::Key::Escape),
		)
	});
	if escape {
		shell.state.close_palette();
		return true;
	}
	if up {
		if let Some(palette) = shell.state.palette_mut() {
			palette.step(-1);
		}
	}
	if down {
		if let Some(palette) = shell.state.palette_mut() {
			palette.step(1);
		}
	}
	let chosen = if enter {
		shell
			.state
			.palette()
			.and_then(|palette| palette.chosen().cloned())
	} else {
		None
	};
	if let Some(item) = chosen {
		let notice = run(shell, &item.action);
		shell.state.close_palette();
		shell.state.show(notice);
	}
	// While open, every key belongs to the box: the terminal keeps its hands
	// off and the shell's hotkeys stay put.
	true
}

/// Width of the box.
const WIDTH: f32 = 560.0;
/// Height of one row.
const ROW_H: f32 = 34.0;
/// Rows visible before the list scrolls.
const VISIBLE_ROWS: usize = 10;

/// Draw the palette, if it is open.
pub fn popup(ctx: &egui::Context, shell: &mut Shell) {
	if shell.state.palette().is_none() {
		return;
	}
	let screen = ctx.content_rect();
	let x = (screen.center().x - WIDTH / 2.0).max(screen.min.x + 12.0);
	let y = screen.min.y + 96.0;
	let rect = Rect::from_min_size(pos2(x, y), vec2(WIDTH, 540.0));

	let mut run_action: Option<Action> = None;
	let mut close = false;
	egui::Area::new(egui::Id::new("zetawork-palette"))
		.order(Order::Foreground)
		.fixed_pos(rect.min)
		.show(ctx, |ui| {
			let (backdrop, backdrop_response) = ui.allocate_exact_size(screen.size(), Sense::click());
			if backdrop_response.clicked() {
				close = true;
			}
			ui.painter().rect_filled(
				backdrop,
				CornerRadius::ZERO,
				egui::Color32::from_rgba_unmultiplied(3, 5, 8, 60),
			);
			let mut panel = ui.new_child(
				egui::UiBuilder::new()
					.max_rect(rect)
					.layout(Layout::top_down(Align::Min)),
			);
			let painter = panel.painter().clone();
			painter.rect_filled(rect, CornerRadius::same(theme::R_MODAL), theme::PANEL);
			painter.rect_stroke(
				rect,
				CornerRadius::same(theme::R_MODAL),
				Stroke::new(1.0_f32, theme::BORDER_2),
				egui::StrokeKind::Inside,
			);
			// The search field is the box's whole input; it owns the keyboard.
			let field = Rect::from_min_size(rect.min, vec2(rect.width(), 44.0));
			let mut field_ui = panel.new_child(
				egui::UiBuilder::new()
					.max_rect(field.shrink2(vec2(12.0, 8.0)))
					.layout(Layout::left_to_right(Align::Center)),
			);
			crate::icons::paint(
				field_ui.painter(),
				Icon::Search,
				Rect::from_center_size(pos2(field.min.x + 22.0, field.center().y), vec2(15.0, 15.0)),
				theme::TEXT_3,
				1.5,
			);
			field_ui.add_space(22.0);
			let edit = egui::TextEdit::singleline(&mut shell.state.palette_mut().expect("open").query)
				.hint_text(t!("跳转到项目、工作区、会话、文件，或运行一个桌面动作"))
				.frame(false)
				.desired_width(field.width() - 60.0)
				.font(egui::TextStyle::Body);
			let response = field_ui.add(edit);
			response.request_focus();
			painter.line_segment(
				[pos2(rect.min.x, field.max.y + 0.5), pos2(rect.max.x, field.max.y + 0.5)],
				Stroke::new(1.0_f32, theme::BORDER),
			);

			let Some(palette) = shell.state.palette() else {
				return;
			};
			let ranked = palette.ranked();
			let selected = if ranked.is_empty() {
				0
			} else {
				palette.selected.min(ranked.len() - 1)
			};
			let items = &palette.items;
			let mut list = panel.new_child(
				egui::UiBuilder::new()
					.max_rect(Rect::from_min_size(
						pos2(rect.min.x, field.max.y + 2.0),
						vec2(rect.width(), ROW_H * VISIBLE_ROWS as f32 + 8.0),
					))
					.layout(Layout::top_down(Align::Min)),
			);
			egui::ScrollArea::vertical()
				.id_salt("zetawork-palette-rows")
				.auto_shrink([false, false])
				.show(&mut list, |ui| {
					if items.is_empty() {
						truncated_text(
							ui,
							pos2(ui.cursor().min.x + 14.0, ui.cursor().min.y + ROW_H / 2.0),
							t!("没有可跳转的内容"),
							12.0,
							theme::TEXT_3,
							rect.width() - 28.0,
						);
						return;
					}
					if ranked.is_empty() {
						truncated_text(
							ui,
							pos2(ui.cursor().min.x + 14.0, ui.cursor().min.y + ROW_H / 2.0),
							&t!("没有匹配「{}」的行", palette.query.trim()),
							12.0,
							theme::TEXT_3,
							rect.width() - 28.0,
						);
						return;
					}
					let mut section = "";
					for (position, index) in ranked.iter().enumerate() {
						let item = &items[*index];
						if item.section != section {
							section = item.section;
							let (head, _) =
								ui.allocate_exact_size(vec2(ui.available_width(), 20.0), Sense::hover());
							ui.painter().text(
								pos2(head.min.x + 14.0, head.center().y),
								egui::Align2::LEFT_CENTER,
								section,
								FontId::new(10.0, egui::FontFamily::Proportional),
								theme::TEXT_3,
							);
						}
						let (row, response) =
							ui.allocate_exact_size(vec2(ui.available_width(), ROW_H), Sense::click());
						let active = position == selected;
						if active {
							ui.painter().rect_filled(
								row.shrink2(vec2(8.0, 1.0)),
								CornerRadius::same(theme::R_CONTROL),
								theme::PANEL_4,
							);
							ui.scroll_to_rect(row, None);
						} else if response.hovered() {
							ui.painter().rect_filled(
								row.shrink2(vec2(8.0, 1.0)),
								CornerRadius::same(theme::R_CONTROL),
								theme::PANEL_3,
							);
						}
						truncated_text(
							ui,
							pos2(row.min.x + 20.0, row.center().y - 7.0),
							&item.title,
							12.0,
							theme::TEXT,
							row.width() - 40.0,
						);
						truncated_mono(
							ui,
							pos2(row.min.x + 20.0, row.center().y + 7.0),
							&item.detail,
							9.5,
							theme::TEXT_3,
							row.width() - 40.0,
						);
						if response.clicked() {
							run_action = Some(item.action.clone());
						}
					}
				});
			painter.text(
				pos2(rect.min.x + 14.0, rect.max.y - 16.0),
				egui::Align2::LEFT_CENTER,
				t!("↑↓ 选择 · Enter 执行 · Esc 关闭"),
				FontId::new(9.5, egui::FontFamily::Proportional),
				theme::TEXT_3,
			);
		});
	if let Some(action) = run_action {
		let notice = run(shell, &action);
		shell.state.close_palette();
		shell.state.show(notice);
	} else if close {
		shell.state.close_palette();
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::state::AppState;

	fn item(section: &'static str, title: &str, detail: &str) -> Item {
		Item {
			section,
			title: title.to_owned(),
			detail: detail.to_owned(),
			action: Action::RestartBackend,
		}
	}

	#[test]
	fn ranking_prefers_exact_then_prefix_then_word_then_detail() {
		let items = vec![
			item("文件", "parser.rs", "src/parser.rs"),
			item("项目", "zeta", "/work/zeta"),
			item("会话", "Fix the parser", "/work/zeta"),
			item("项目", "parser", "/work/parser-tools"),
		];
		let ranked: Vec<&str> = rank(&items, "parser")
			.iter()
			.map(|index| items[*index].title.as_str())
			.collect();
		assert_eq!(
			ranked,
			["parser", "parser.rs", "Fix the parser"],
			"exact, prefix, word; the unrelated project drops out"
		);
	}

	#[test]
	fn every_token_must_match_and_empty_query_keeps_order() {
		let items = vec![
			item("项目", "zeta", "/work/zeta"),
			item("会话", "Fix the parser", "/work/zeta"),
			item("文件", "README.md", "/work/zeta/README.md"),
		];
		assert_eq!(rank(&items, ""), [0, 1, 2], "an empty query shows the build order");
		assert_eq!(rank(&items, "zeta fix"), [1], "a detail and a title token combine");
		assert!(rank(&items, "nope").is_empty());
		assert!(rank(&items, "zeta").len() >= 2);
	}

	#[test]
	fn selection_wraps_and_enter_picks_the_ranked_row() {
		let mut palette = Palette {
			query: String::new(),
			selected: 0,
			items: vec![
				item("操作", "打开远程访问设置", ""),
				item("项目", "zeta", "/work/zeta"),
				item("工作区", "主工作区", "/work/zeta"),
			],
		};
		assert_eq!(palette.chosen().unwrap().title, "打开远程访问设置");
		palette.step(1);
		assert_eq!(palette.chosen().unwrap().title, "zeta");
		palette.step(2);
		assert_eq!(palette.selected, 0, "the selection wraps");
		palette.step(-1);
		assert_eq!(palette.selected, 2);
		palette.query = "remote".to_owned();
		assert!(palette.chosen().is_none(), "a query with no rows chooses nothing");
		palette.query = "zeta".to_owned();
		palette.selected = 0;
		assert_eq!(palette.chosen().unwrap().section, "项目");
	}

	#[test]
	fn files_come_from_git_and_from_a_walk_without_a_repository() {
		let root = std::env::temp_dir().join(format!("zetawork-gui-palette-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&root);
		std::fs::create_dir_all(root.join("src")).unwrap();
		std::fs::write(root.join("src/main.rs"), "fn main() {}\n").unwrap();
		std::fs::write(root.join("notes.txt"), "notes\n").unwrap();
		std::fs::create_dir_all(root.join("node_modules")).unwrap();
		std::fs::write(root.join("node_modules/x.js"), "x\n").unwrap();

		let files = collect_files(&root, 100);
		assert_eq!(files.len(), 2, "the ignored-by-convention tree is skipped");
		assert!(files.iter().any(|path| path.ends_with("src/main.rs")));
		assert_eq!(collect_files(&root, 1).len(), 1);

		let git = std::process::Command::new("git")
			.arg("-C")
			.arg(&root)
			.arg("init")
			.arg("--quiet")
			.output()
			.expect("git must be on PATH for this test");
		assert!(git.status.success());
		let files = collect_files(&root, 100);
		assert!(files.iter().any(|path| path.ends_with("notes.txt")));
		let _ = std::fs::remove_dir_all(&root);
	}

	#[test]
	fn a_project_row_dispatches_to_the_project_selection() {
		let dir =
			std::env::temp_dir().join(format!("zetawork-gui-palette-state-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		let state = AppState::seeded_with_registry(
			&dir,
			workbench_projects::Registry::empty_at(dir.join("projects.json")),
		);
		let target = state.projects.last().expect("a project").id.clone();
		let mut shell = crate::Shell::with_state(state, crate::settings::Settings::default());
		let palette = build(&shell.state, &shell.settings, &[], &[]);
		assert!(palette.items.iter().any(|item| item.section == t!("操作")));
		assert!(palette.items.iter().any(|item| item.section == t!("项目")));

		let notice = run(&mut shell, &Action::Project(target.clone()));
		assert_eq!(notice.0, "");
		assert_eq!(shell.state.active_project.as_deref(), Some(target.as_str()));

		let remote = run(&mut shell, &Action::RemoteSettings);
		assert_eq!(remote.0, "");
		assert!(shell.state.settings_open());
		assert_eq!(shell.state.settings_section, crate::settings::Section::Remote);

		let headless = run(&mut shell, &Action::RestartBackend);
		assert!(
			headless.0.contains("重启后台服务"),
			"a headless shell names the state transition instead of starting it: {headless:?}"
		);
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn a_branch_action_switches_a_real_checkout() {
		let repo =
			std::env::temp_dir().join(format!("zetawork-gui-palette-branch-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&repo);
		std::fs::create_dir_all(&repo).unwrap();
		let git = |args: &[&str]| {
			let out = std::process::Command::new("git")
				.arg("-C")
				.arg(&repo)
				.args(args)
				.output()
				.expect("git must be on PATH for this test");
			assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
		};
		git(&["init", "--quiet"]);
		std::fs::write(repo.join("a.txt"), "a\n").unwrap();
		git(&["add", "a.txt"]);
		git(&[
			"-c",
			"user.email=zetawork@test",
			"-c",
			"user.name=zetawork",
			"commit",
			"--quiet",
			"-m",
			"seed",
		]);
		git(&["branch", "feat/palette"]);

		let mut state = AppState::seeded_with_registry(
			&repo,
			workbench_projects::Registry::empty_at(repo.join("projects.json")),
		);
		// 本机 is the first project and points at the process directory; point
		// its workspace at the scratch repository so the action is about it.
		let ws = state.projects[0].workspaces[0].id.clone();
		state.retarget(ws, &repo, "unused");
		let mut shell = crate::Shell::with_state(state, crate::settings::Settings::default());
		let notice = run(&mut shell, &Action::Branch("feat/palette".to_owned()));
		assert!(notice.0.contains("feat/palette"), "{notice:?}");
		assert_eq!(shell.state.branch_label(), "feat/palette");
		let missing = run(&mut shell, &Action::Branch("nope".to_owned()));
		assert!(missing.0.contains("nope"));
		let _ = std::fs::remove_dir_all(&repo);
	}
}
