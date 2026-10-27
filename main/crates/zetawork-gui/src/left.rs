// SPDX-License-Identifier: AGPL-3.0-only
//! The left column (`aside.side-left`) and its collapsed rail.
//!
//! Content order is the spec's: brand head, 项目 (the project → workspace
//! list), then the foot row with 设置 / 帮助 / 聚焦. Collapsing swaps the
//! column for the thin `rail.rail-left` strip that carries only the expand
//! button.
//!
//! The regions are laid out from explicit rectangles rather than by stacking
//! widgets, because the project list has to fill exactly the space between the
//! nav and the foot row no matter how many projects there are.

use crate::t;
use std::path::Path;

use egui::{Align, CornerRadius, Layout, Rect, Sense, Stroke, Ui, pos2, vec2};

use crate::{
	Shell,
	icons::{Icon, icon_button},
	sessions::Conversation,
	state::{AppState, Project, SessionKind, Workspace},
	theme,
	widgets::{
		foot_button, status_dot, status_tooltip, status_word, truncated_mono, truncated_text,
	},
};

/// Width of the open column (`--side-left-w`).
pub const WIDTH: f32 = 248.0;
/// The open column's drag bounds: below `MIN_WIDTH` the card list starts
/// wrapping, above `MAX_WIDTH` it crowds the centre out.
pub const MIN_WIDTH: f32 = 200.0;
pub const MAX_WIDTH: f32 = 420.0;
/// Width of the collapsed rail (`.rail`).
pub const RAIL_WIDTH: f32 = 44.0;

/// Height of the brand head.
const HEAD_H: f32 = 44.0;
/// Height of the foot row.
const FOOT_H: f32 = 46.0;

/// The agent prompt line's height, above the foot (only when one is targeted).
const PROMPT_H: f32 = 30.0;
/// Height of the 默认项目 pinned head.
const PIN_HEAD_H: f32 = 26.0;
/// Height of a workspace row.
const WORKSPACE_ROW_H: f32 = 30.0;
/// Height of one conversation row.
const CONVERSATION_ROW_H: f32 = 24.0;

/// The open column.
pub fn left_column(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	ui.painter().line_segment(
		[pos2(rect.max.x - 0.5, rect.min.y), pos2(rect.max.x - 0.5, rect.max.y)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let head = Rect::from_min_size(rect.min, vec2(rect.width(), HEAD_H));
	let foot =
		Rect::from_min_size(pos2(rect.min.x, rect.max.y - FOOT_H), vec2(rect.width(), FOOT_H));
	// The prompt line takes its strip out of the list, not out of the foot:
	// the foot's buttons stay exactly where they always are.
	let prompt_h = if shell.agent_target.is_some() {
		PROMPT_H
	} else {
		0.0
	};
	let prompt =
		Rect::from_min_size(pos2(rect.min.x, foot.min.y - prompt_h), vec2(rect.width(), prompt_h));
	let list = Rect::from_min_max(pos2(rect.min.x, head.max.y), pos2(rect.max.x, prompt.min.y));
	let mut head_ui = ui.new_child(egui::UiBuilder::new().max_rect(head));
	head_region(&mut head_ui, shell);
	let mut list_ui = ui.new_child(egui::UiBuilder::new().max_rect(list));
	projects_region(&mut list_ui, shell);
	if shell.agent_target.is_some() {
		let mut prompt_ui = ui.new_child(egui::UiBuilder::new().max_rect(prompt));
		prompt_region(&mut prompt_ui, shell);
	}
	let mut foot_ui = ui.new_child(egui::UiBuilder::new().max_rect(foot));
	foot_region(&mut foot_ui, shell);
}

/// `.side-head`: brand mark, name, presence, collapse button.
fn head_region(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	let name_x = rect.min.x + 12.0;
	ui.painter().text(
		pos2(name_x, rect.center().y),
		egui::Align2::LEFT_CENTER,
		crate::APP_TITLE,
		egui::FontId::new(13.0, egui::FontFamily::Proportional),
		theme::TEXT,
	);
	ui.painter()
		.circle_filled(pos2(name_x + 60.0, rect.center().y), 3.5, theme::ADD);
	// 会话管理: the cross-project list, opened over the frame.
	let mut manage = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(
		pos2(rect.max.x - 60.0, rect.center().y - 12.0),
		vec2(24.0, 24.0),
	)));
	if icon_button(&mut manage, Icon::List, 24.0, false, t!("会话管理：搜索、置顶、归档与恢复"))
		.clicked()
	{
		shell.state.toggle_sessions_admin();
	}
	let mut collapse = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(
		pos2(rect.max.x - 32.0, rect.center().y - 12.0),
		vec2(24.0, 24.0),
	)));
	if icon_button(&mut collapse, Icon::ChevronLeft, 24.0, false, t!("收起左侧栏")).clicked() {
		shell.state.toggle_left();
	}
}

/// The 项目 section: the section head, the inline add editor when open, the
/// pinned 默认项目 block, then one group per normal project inside the scroll.
///
/// The pinned block is drawn **outside** [`egui::ScrollArea`], so it stays on
/// screen while the project list scrolls — that is the whole reason the two
/// regions are rectangles here rather than one stack.
fn projects_region(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.min.y), pos2(rect.max.x, rect.min.y)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let head = Rect::from_min_size(rect.min, vec2(rect.width(), 28.0));
	// The head is painted, not allocated; move the layout cursor past it so
	// the inline add editor starts under the section head.
	let _ = ui.allocate_exact_size(head.size(), Sense::hover());
	ui.painter().text(
		pos2(head.min.x + 12.0, head.center().y),
		egui::Align2::LEFT_CENTER,
		t!("项目"),
		egui::FontId::new(11.0, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	let mut add = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(
		pos2(head.max.x - 30.0, head.center().y - 10.0),
		vec2(20.0, 20.0),
	)));
	if icon_button(&mut add, Icon::Plus, 20.0, shell.state.adding().is_some(), t!("添加项目"))
		.clicked()
	{
		if shell.state.adding().is_some() {
			shell.state.cancel_add_project();
		} else {
			shell.state.begin_add_project();
		}
	}
	let mut top = head.max.y;
	if shell.state.adding().is_some() {
		top = add_project_row(ui, shell) + 4.0;
	}
	if shell.state.default_project().is_some() {
		top = pinned_region(ui, shell, top) + 4.0;
	}
	let list = Rect::from_min_max(pos2(rect.min.x, top), rect.max);
	let mut list_ui = ui.new_child(egui::UiBuilder::new().max_rect(list));
	egui::ScrollArea::vertical()
		.id_salt("zetawork-left-projects")
		.auto_shrink([false, false])
		.show(&mut list_ui, |ui| {
			ui.spacing_mut().item_spacing.y = 2.0;
			for index in 0..shell.state.projects.len() {
				project_group(ui, shell, index);
			}
		});
}

/// The fixed 默认项目 block: its one system workspace and every pinned
/// conversation, above the scrolling project list.
///
/// The block is bounded to half of the space left under the section head (and
/// never taller than what is left), so a project with a long history cannot
/// push the rest of the tree off the column. When the rows outgrow that bound
/// they scroll *inside* the block, while the block itself stays put.
fn pinned_region(ui: &mut Ui, shell: &mut Shell, top: f32) -> f32 {
	let outer = ui.max_rect();
	let available = (outer.max.y - top).max(0.0);
	let pinned_count = shell
		.state
		.conversations
		.iter()
		.filter(|entry| entry.pinned)
		.count();
	let desired = PIN_HEAD_H + WORKSPACE_ROW_H + pinned_count as f32 * CONVERSATION_ROW_H + 6.0;
	let height = desired.min((available * 0.5).max(96.0)).min(available);
	if height <= 0.0 {
		return top;
	}
	let area = Rect::from_min_max(pos2(outer.min.x, top), pos2(outer.max.x, top + height));
	let mut block = ui.new_child(egui::UiBuilder::new().max_rect(area));
	block.spacing_mut().item_spacing.y = 2.0;

	let (head, _) =
		block.allocate_exact_size(vec2(block.available_width(), PIN_HEAD_H), Sense::hover());
	ui.painter().rect_filled(
		Rect::from_min_size(pos2(area.min.x + 8.0, head.center().y - 7.0), vec2(2.0, 14.0)),
		CornerRadius::same(1),
		theme::ACCENT,
	);
	truncated_text(
		ui,
		pos2(area.min.x + 16.0, head.center().y),
		t!("默认项目"),
		11.5,
		theme::TEXT_2,
		head.width() - 70.0,
	);
	ui.painter().text(
		pos2(area.max.x - 12.0, head.center().y),
		egui::Align2::RIGHT_CENTER,
		t!("固定"),
		egui::FontId::new(10.0, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);

	if let Some(workspace) = shell.state.default_workspace().cloned() {
		workspace_row(&mut block, shell, workspace);
	}
	let rest = Rect::from_min_max(pos2(area.min.x, block.cursor().min.y), area.max);
	if rest.height() <= 0.0 {
		return area.max.y;
	}
	let mut rest_ui = block.new_child(egui::UiBuilder::new().max_rect(rest));
	egui::ScrollArea::vertical()
		.id_salt("zetawork-left-pinned")
		.auto_shrink([false, false])
		.show(&mut rest_ui, |ui| {
			ui.spacing_mut().item_spacing.y = 2.0;
			let clicked = {
				let mut clicked = None;
				for conversation in shell.state.pinned_conversations() {
					if let Some(id) = conversation_row(ui, &shell.state, conversation) {
						clicked = Some(id);
					}
				}
				clicked
			};
			if let Some(id) = clicked {
				shell.state.act(|state| state.open_conversation(&id));
			}
		});
	area.max.y
}

/// The inline 添加项目 path editor: a real directory path, committed with
/// Enter (or ✓) and thrown away with Esc.
fn add_project_row(ui: &mut Ui, shell: &mut Shell) -> f32 {
	let (area, _) = ui.allocate_exact_size(vec2(ui.available_width(), 26.0), Sense::hover());
	let field = Rect::from_min_max(
		pos2(area.min.x + 8.0, area.min.y + 3.0),
		pos2(area.max.x - 54.0, area.max.y - 3.0),
	);
	let mut text = shell.state.adding().unwrap_or_default().to_owned();
	let mut child = ui.new_child(egui::UiBuilder::new().max_rect(field));
	let response = child.add(
		egui::TextEdit::singleline(&mut text)
			.hint_text(t!("项目目录"))
			.desired_width(field.width()),
	);
	if shell.state.take_add_focus() {
		response.request_focus();
	}
	if response.changed() {
		shell.state.set_add_text(text);
	}
	let mut ok = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(
		pos2(area.max.x - 48.0, area.center().y - 10.0),
		vec2(20.0, 20.0),
	)));
	if icon_button(&mut ok, Icon::Check, 20.0, false, t!("添加")).clicked() {
		shell.state.act(|state| state.commit_add_project());
	}
	let mut cancel = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(
		pos2(area.max.x - 26.0, area.center().y - 10.0),
		vec2(20.0, 20.0),
	)));
	if icon_button(&mut cancel, Icon::X, 20.0, false, t!("取消")).clicked() {
		shell.state.cancel_add_project();
	}
	let enter = child.input(|input| input.key_pressed(egui::Key::Enter));
	let escape = child.input(|input| input.key_pressed(egui::Key::Escape));
	if enter {
		shell.state.act(|state| state.commit_add_project());
	} else if escape {
		shell.state.cancel_add_project();
	}
	area.max.y
}

/// One project: its head (toggle, name, hover actions) and its workspaces.
///
/// The ⋯ menu and the `+` are drawn dim until the row is hovered; the menu is
/// kept alive by egui's popup memory, so moving the pointer into an open menu
/// does not close it even when the row is no longer hovered.
fn project_group(ui: &mut Ui, shell: &mut Shell, index: usize) {
	let project: Project = shell.state.projects[index].clone();
	// 默认项目 is drawn by `pinned_region`, above the scroll: drawing it here
	// as well would list the same sessions twice.
	if AppState::is_system_project(&project.id) {
		return;
	}
	let local = AppState::is_local_project(&project.id);
	let active_project = shell.state.active_project.as_deref() == Some(project.id.as_str());
	let renaming = shell
		.state
		.renaming()
		.is_some_and(|(id, _)| id == project.id);
	let (head_rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 26.0), Sense::hover());
	let row_hovered = ui.rect_contains_pointer(head_rect);
	let caret =
		Rect::from_center_size(pos2(head_rect.min.x + 12.0, head_rect.center().y), vec2(12.0, 12.0));
	crate::icons::paint(
		ui.painter(),
		if active_project || renaming {
			Icon::ChevronDown
		} else {
			Icon::ChevronRight
		},
		caret,
		theme::TEXT_3,
		2.0,
	);
	if renaming {
		let mut text = shell
			.state
			.renaming()
			.map(|(_, text)| text.to_owned())
			.unwrap_or_default();
		let field = Rect::from_min_max(
			pos2(caret.max.x + 5.0, head_rect.min.y + 3.0),
			pos2(head_rect.max.x - 8.0, head_rect.max.y - 3.0),
		);
		let mut child = ui.new_child(egui::UiBuilder::new().max_rect(field));
		let response = child.add(
			egui::TextEdit::singleline(&mut text)
				.frame(false)
				.desired_width(field.width()),
		);
		if shell.state.take_rename_focus() {
			response.request_focus();
		}
		if response.changed() {
			shell.state.set_rename_text(text);
		}
		let enter = child.input(|input| input.key_pressed(egui::Key::Enter));
		let escape = child.input(|input| input.key_pressed(egui::Key::Escape));
		if enter {
			shell.state.act(|state| state.commit_rename_project());
		} else if escape {
			shell.state.cancel_rename_project();
		}
	} else {
		let toggle_rect =
			Rect::from_min_max(head_rect.min, pos2(head_rect.max.x - 52.0, head_rect.max.y));
		let toggle = ui.interact(toggle_rect, ui.id().with(("proj", index)), Sense::click());
		if toggle.hovered() {
			ui.painter().rect_filled(
				toggle_rect,
				CornerRadius::same(theme::R_CONTROL),
				theme::PANEL_3,
			);
		}
		truncated_text(
			ui,
			pos2(caret.max.x + 5.0, head_rect.center().y),
			&project.name,
			12.0,
			if active_project {
				theme::TEXT
			} else {
				theme::TEXT_2
			},
			toggle_rect.width() - 32.0,
		);
		if toggle.clicked() {
			shell.state.act(|state| state.select_project(&project.id));
		}
		// The hover actions: ⋯ for a registration, `+` for every project row.
		let ink = if row_hovered {
			theme::TEXT_2
		} else {
			theme::TEXT_3.gamma_multiply(0.45)
		};
		if !local {
			let more_rect = Rect::from_min_size(
				pos2(head_rect.max.x - 48.0, head_rect.center().y - 10.0),
				vec2(20.0, 20.0),
			);
			let more = ui.interact(more_rect, ui.id().with(("proj-more", index)), Sense::click());
			if more.hovered() {
				ui.painter().rect_filled(
					more_rect,
					CornerRadius::same(theme::R_CONTROL),
					theme::PANEL_3,
				);
			}
			crate::icons::paint_more(ui.painter(), more_rect, ink);
			let mut rename = false;
			let mut open_folder = false;
			let mut remove = false;
			let _ = egui::Popup::menu(&more)
				.id(ui.id().with(("proj-menu", index)))
				.show(|ui| {
					ui.set_min_width(180.0);
					if ui.button(t!("重命名")).clicked() {
						rename = true;
						ui.close();
					}
					if ui.button(t!("在文件管理器中打开")).clicked() {
						open_folder = true;
						ui.close();
					}
					if ui.button(t!("从注册表移除")).clicked() {
						remove = true;
						ui.close();
					}
				});
			if rename {
				shell.state.begin_rename_project(&project.id);
			}
			if open_folder {
				open_in_file_manager(shell.probe, &project.path);
			}
			if remove {
				let id = project.id.clone();
				shell.state.act(|state| state.remove_project(&id));
			}
		}
		let mut plus = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(
			pos2(head_rect.max.x - 24.0, head_rect.center().y - 10.0),
			vec2(20.0, 20.0),
		)));
		if icon_button(&mut plus, Icon::Plus, 20.0, false, t!("新建工作区")).clicked() {
			let id = project.id.clone();
			shell.state.act(|state| state.new_workspace(&id));
		}
	}
	// A project that is not open is collapsed, exactly as `.proj.collapsed`
	// hides `.ws-list`; clicking its head opens it.
	if !active_project && !renaming {
		ui.add_space(4.0);
		return;
	}
	for workspace in &project.workspaces {
		workspace_row(ui, shell, workspace.clone());
		let clicked = {
			let mut clicked = None;
			for conversation in shell.state.conversations_in(&workspace.id) {
				if let Some(id) = conversation_row(ui, &shell.state, conversation) {
					clicked = Some(id);
				}
			}
			clicked
		};
		if let Some(id) = clicked {
			shell.state.act(|state| state.open_conversation(&id));
		}
	}
	ui.add_space(4.0);
}

/// Open a registered project's directory in the host file manager. Only a
/// real run (not a headless test shell) spawns anything.
fn open_in_file_manager(probe: bool, path: &Path) {
	if !probe {
		return;
	}
	#[cfg(target_os = "windows")]
	let mut command = {
		let mut command = std::process::Command::new("explorer.exe");
		command.arg(path);
		command
	};
	#[cfg(target_os = "macos")]
	let mut command = {
		let mut command = std::process::Command::new("open");
		command.arg(path);
		command
	};
	#[cfg(all(unix, not(target_os = "macos")))]
	let mut command = {
		let mut command = std::process::Command::new("xdg-open");
		command.arg(path);
		command
	};
	if let Ok(child) = command.spawn() {
		crate::spawn_probe::record_command(child.id(), &command);
	}
}

/// `.ws-btn`: name + branch chip, with the accent bar when it is the open one.
fn workspace_row(ui: &mut Ui, shell: &mut Shell, workspace: Workspace) {
	let active = shell.state.active_workspace.as_deref() == Some(workspace.id.as_str());
	let (rect, response) = ui.allocate_exact_size(vec2(ui.available_width(), 30.0), Sense::click());
	if active {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_4);
		ui.painter().rect_filled(
			Rect::from_min_size(pos2(rect.min.x + 8.0, rect.center().y - 8.0), vec2(3.0, 16.0)),
			CornerRadius::same(2),
			theme::ACCENT,
		);
	} else if response.hovered() {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
	}
	let chip_width = 24.0 + crate::center::display_cols(&workspace.branch) as f32 * 6.2;
	// The conversation `+` keeps its own slot on the right at all times (the
	// chip is shifted left by it), so hovering does not move the branch text.
	const PLUS_W: f32 = 20.0;
	let right = rect.max.x - 8.0 - PLUS_W;
	// The run state: the dot in front of the name carries its colour, and the
	// word sits before the branch chip. The **name outranks the word** — a row
	// whose name has been squeezed to `…` tells you nothing, and the dot plus
	// the tooltip still carry the state — so the word is only drawn when the
	// name keeps a readable 64 px. A workspace nothing observes shows `—` and no
	// dot; the tooltip says why.
	let state = workspace.run_state;
	let word_width = 3.0_f32.max(crate::center::display_cols("unconfirmed") as f32 * 6.2) + 8.0;
	let show_word = right - rect.min.x - 30.0 - chip_width - word_width - 8.0 >= 64.0;
	let name_available =
		right - rect.min.x - 30.0 - chip_width - if show_word { word_width } else { 0.0 } - 8.0;
	let response = response.on_hover_text(status_tooltip(state));
	status_dot(ui, pos2(rect.min.x + 13.0, rect.center().y), state);
	truncated_text(
		ui,
		pos2(rect.min.x + 24.0, rect.center().y),
		&workspace.name,
		13.0,
		if active { theme::TEXT } else { theme::TEXT_2 },
		name_available.max(24.0),
	);
	if show_word {
		status_word(
			ui,
			pos2(right - chip_width - word_width, rect.center().y),
			state,
			11.0,
			word_width - 4.0,
		);
	}
	let chip_rect =
		Rect::from_min_size(pos2(right - chip_width, rect.center().y - 9.0), vec2(chip_width, 18.0));
	ui.painter()
		.rect_filled(chip_rect, CornerRadius::same(4), theme::CHIP_BRANCH_BG);
	ui.painter().rect_stroke(
		chip_rect,
		CornerRadius::same(4),
		Stroke::new(1.0_f32, theme::CHIP_BRANCH_BORDER),
		egui::StrokeKind::Inside,
	);
	truncated_mono(
		ui,
		pos2(chip_rect.min.x + 6.0, chip_rect.center().y),
		&workspace.branch,
		11.0,
		theme::CHIP_BRANCH_INK,
		chip_width - 12.0,
	);
	let plus_rect = Rect::from_min_size(
		pos2(rect.max.x - 6.0 - PLUS_W, rect.center().y - 10.0),
		vec2(PLUS_W, 20.0),
	);
	let plus =
		ui.interact(plus_rect, ui.id().with(("ws-new-conversation", &workspace.id)), Sense::click());
	if response.hovered() || plus.hovered() {
		ui.painter()
			.rect_filled(plus_rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
	}
	crate::icons::paint(
		ui.painter(),
		Icon::Plus,
		plus_rect.shrink(4.0),
		if plus.hovered() {
			theme::TEXT
		} else {
			theme::TEXT_3
		},
		1.6,
	);
	let create = plus.on_hover_text(t!("新建会话")).clicked();
	if create {
		shell.create_conversation(&workspace.id);
	} else if response.clicked() {
		let id = workspace.id.clone();
		shell.state.act(|s| s.select_workspace(&id));
	}
	agent_rows(ui, shell, &workspace);
}

/// The agent sessions this workspace holds, one line each, under its row.
///
/// An agent tab is invisible until someone opens it, which is exactly the
/// state a waiting agent leaves the user in. The line says which sessions
/// exist and how each is doing, a click opens that tab, and the same click
/// aims the prompt line at its session.
fn agent_rows(ui: &mut Ui, shell: &mut Shell, workspace: &Workspace) {
	struct Row {
		pane: String,
		tab: String,
		/// The gateway session this row sends to: the tab's own id when it has
		/// one (a tab attached from a conversation), else what the pane was
		/// last attached to.
		session: Option<String>,
		status: String,
		waiting: bool,
		running: bool,
	}
	let rows: Vec<Row> = workspace
		.panes
		.iter()
		.flat_map(|pane| {
			pane
				.tabs
				.iter()
				.filter(|tab| tab.kind == SessionKind::Agent)
				.map(move |tab| (pane.id.clone(), tab))
		})
		.map(|(pane, tab)| {
			let agent = shell.agents.pane(&tab.id);
			Row {
				pane,
				tab: tab.id.clone(),
				session: tab
					.session
					.clone()
					.or_else(|| agent.and_then(|agent| agent.session.clone())),
				status: agent
					.map(|agent| agent.status_line())
					.unwrap_or_else(|| "detached".to_owned()),
				waiting: agent.is_some_and(|agent| agent.awaiting_input()),
				running: agent.is_some_and(|agent| agent.is_live()),
			}
		})
		.collect();
	for row in rows {
		let (rect, response) =
			ui.allocate_exact_size(vec2(ui.available_width(), 20.0), Sense::click());
		let selected = shell
			.agent_target
			.as_ref()
			.is_some_and(|(tab, _)| tab == &row.tab);
		if selected || response.hovered() {
			ui.painter()
				.rect_filled(rect, CornerRadius::ZERO, theme::PANEL_3);
		}
		// 等待输入 outranks 运行中: the one that needs the user is the one the
		// dot should shout about.
		let dot = if row.waiting {
			theme::WARN
		} else if row.running {
			theme::ACCENT
		} else {
			theme::TEXT_3
		};
		ui.painter()
			.circle_filled(pos2(rect.min.x + 30.0, rect.center().y), 3.0, dot);
		let title = row
			.session
			.clone()
			.unwrap_or_else(|| t!("（未命名会话）").to_owned());
		truncated_mono(
			ui,
			pos2(rect.min.x + 38.0, rect.center().y),
			&title,
			11.0,
			if selected { theme::TEXT } else { theme::TEXT_2 },
			// The status word keeps the right edge; the title gets the rest.
			(rect.width() - 86.0).max(40.0),
		);
		ui.painter().text(
			pos2(rect.max.x - 8.0, rect.center().y),
			egui::Align2::RIGHT_CENTER,
			&row.status,
			egui::FontId::new(10.0, egui::FontFamily::Monospace),
			if row.waiting {
				theme::WARN
			} else {
				theme::TEXT_3
			},
		);
		if response.clicked() {
			shell.state.select_workspace(&workspace.id);
			shell.state.select_tab(&row.pane, &row.tab);
			// No session id means nothing to send to: the row still opens the
			// tab, it just does not aim the prompt line at a name it does not
			// have.
			shell.agent_target = row
				.session
				.clone()
				.map(|session| (row.tab.clone(), session));
			shell.agent_prompt.clear();
		}
	}
}

/// `agent.prompt`: one line to the agent selected above. Enter sends, and the
/// text stays until the backend has accepted it.
fn prompt_region(ui: &mut Ui, shell: &mut Shell) {
	let Some((_, session)) = shell.agent_target.clone() else {
		return;
	};
	let rect = ui.max_rect();
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.min.y + 0.5), pos2(rect.max.x, rect.min.y + 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let field = Rect::from_min_max(
		pos2(rect.min.x + 8.0, rect.min.y + 5.0),
		pos2(rect.max.x - 8.0, rect.max.y - 5.0),
	);
	let mut child = ui.new_child(egui::UiBuilder::new().max_rect(field));
	let hint = format!("{} {session}", t!("发给"));
	let edit = child.add_sized(
		field.size(),
		egui::TextEdit::singleline(&mut shell.agent_prompt)
			.frame(false)
			.font(egui::TextStyle::Monospace)
			.hint_text(hint),
	);
	let entered = edit.lost_focus() && child.input(|input| input.key_pressed(egui::Key::Enter));
	if entered {
		let text = std::mem::take(&mut shell.agent_prompt);
		if shell.send_agent_prompt(&session, &text) {
			edit.request_focus();
		} else {
			shell.agent_prompt = text;
		}
	}
}

/// One conversation row: the session's title, a running dot, and a click that
/// opens it in the centre.
///
/// A conversation the default project owns is pinned (it is drawn above the
/// scroll), but the row itself is the same: pinned rows are never archived or
/// hidden, so there is no second, dimmer treatment for them.
fn conversation_row(ui: &mut Ui, state: &AppState, conversation: &Conversation) -> Option<String> {
	let (rect, response) =
		ui.allocate_exact_size(vec2(ui.available_width(), CONVERSATION_ROW_H), Sense::click());
	let selected = state
		.active_session_tab()
		.is_some_and(|tab| tab.session.as_deref() == Some(conversation.id.as_str()));
	if selected {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_4);
	} else if response.hovered() {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
	}
	let indent = rect.min.x + 34.0;
	if conversation.running {
		ui.painter()
			.circle_filled(pos2(indent - 8.0, rect.center().y), 3.0, theme::ADD);
	}
	let available = (rect.max.x - indent - 8.0).max(24.0);
	truncated_text(
		ui,
		pos2(indent, rect.center().y),
		conversation.display_title(),
		12.0,
		if selected { theme::TEXT } else { theme::TEXT_2 },
		available,
	);
	if response.clicked() {
		Some(conversation.id.clone())
	} else {
		None
	}
}

/// `.side-foot`: 设置 + 用量, a spacer, 帮助 and 聚焦.
///
/// The spec's foot carries 设置 and 用量 side by side; both are fixed items
/// (R13: the foot does not take the slot configuration).
fn foot_region(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.min.y + 0.5), pos2(rect.max.x, rect.min.y + 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let inner = Rect::from_min_max(
		pos2(rect.min.x + 8.0, rect.center().y - 15.0),
		pos2(rect.max.x - 8.0, rect.center().y + 15.0),
	);
	let mut left = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(inner)
			.layout(Layout::left_to_right(Align::Center)),
	);
	if foot_button(&mut left, Icon::Gear, t!("设置")).clicked() {
		shell.state.open_settings();
	}
	if foot_button(&mut left, Icon::List, t!("用量")).clicked() {
		open_usage(shell);
	}
	let mut right = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_max(pos2(inner.max.x - 62.0, inner.min.y), inner.max))
			.layout(Layout::right_to_left(Align::Center)),
	);
	if foot_button(&mut right, Icon::Focus, "").clicked() {
		shell.state.act(|s| s.focus_mode());
	}
	if foot_button(&mut right, Icon::Help, "").clicked() {
		shell.state.act(|s| s.help());
	}
}

/// 用量: open the container, re-reading the stats endpoint first, so the URL is
/// whatever `zetacode serve` published this session.
pub fn open_usage(shell: &mut Shell) {
	shell.refresh_stats();
	shell.state.open_usage();
}

/// `rail.rail-left`: only the expand button.
pub fn left_rail(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	ui.painter().line_segment(
		[pos2(rect.max.x - 0.5, rect.min.y), pos2(rect.max.x - 0.5, rect.max.y)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let mut child = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_size(pos2(rect.min.x + 6.0, rect.min.y + 8.0), vec2(32.0, 32.0))),
	);
	if icon_button(&mut child, Icon::Hamburger, 32.0, false, t!("展开左侧栏")).clicked() {
		shell.state.toggle_left();
	}
}
