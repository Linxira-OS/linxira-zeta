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
//!
//! The tree is also the keyboard's: clicking a row puts [`LeftFocus`] on it,
//! and while that focus is held Up/Down walk the visible rows, Enter opens,
//! F2 renames, Delete removes from the view, Shift+Delete closes and archives,
//! and Ctrl+Shift+Delete arms the gateway's real delete (after confirmation).
//! Every row carries the same actions in its hover `⋯` menu and on right-click.

use crate::t;
use std::path::Path;

use egui::{Align, CornerRadius, Key, Layout, Modifiers, Rect, Sense, Stroke, Ui, pos2, vec2};

use crate::{
	Shell,
	icons::{Icon, icon_button},
	sessions::Conversation,
	state::{AppState, LeftFocus, Project, SessionKind, Workspace},
	theme,
	widgets::{
		foot_button, foot_button_width, status_dot, status_tooltip, status_word, truncated_mono,
		truncated_text,
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

/// Height of the column head. It matches the centre's top bar so the first
/// horizontal rule is not a 4pt step across the three columns.
const HEAD_H: f32 = theme::TOPBAR_H;
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
/// Width of a row's hover `⋯` menu trigger.
const MORE_W: f32 = 18.0;

/// The open column.
pub fn left_column(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	// A click outside the column (the centre, the right column, the status
	// bar) takes the keyboard away from the tree. The `⋯` menus live in their
	// own popup area, so a click inside one also lands here; that only drops
	// the ring, never the action the menu is performing.
	let clicked_outside = ui.input(|input| {
		input
			.pointer
			.interact_pos()
			.is_some_and(|at| !rect.contains(at))
			&& input.pointer.any_pressed()
	});
	if clicked_outside {
		shell.state.left_focus = None;
	}
	// The panel's resize state is stored from the content rect. Every child
	// below is placed with a fixed `max_rect`, so without this the content
	// min_rect stays at `MIN_WIDTH` and egui overwrites the dragged width on
	// the next frame. Taking the available width makes the content rect equal
	// the panel rect, which is what `PanelState` remembers.
	ui.take_available_width();
	// A ground strip around a rounded panel is the smallest change that
	// turns the column from a full-height slab into an island without
	// reflowing every row rectangle.
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::ground());
	ui.painter().rect_filled(
		rect.shrink2(vec2(theme::GAP_ISLAND / 2.0, theme::GAP_ISLAND / 2.0)),
		CornerRadius::same(theme::R_PANEL),
		theme::panel(),
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
	handle_left_keys(ui, shell);
}

/// `.side-head`: brand mark, name, presence, collapse button.
fn head_region(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	// The title bar already carries the product mark and presence dot; the
	// left head used to paint a second zetawork + dot 44pt below it.
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
		[
			pos2(rect.min.x + theme::GAP_ISLAND / 2.0, rect.min.y),
			pos2(rect.max.x - theme::GAP_ISLAND / 2.0, rect.min.y),
		],
		Stroke::new(1.0_f32, theme::border()),
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
		theme::text_3(),
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
		theme::text_2(),
		head.width() - 70.0,
	);
	ui.painter().text(
		pos2(area.max.x - 12.0, head.center().y),
		egui::Align2::RIGHT_CENTER,
		t!("固定"),
		egui::FontId::new(10.0, egui::FontFamily::Proportional),
		theme::text_3(),
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
			let rows: Vec<Conversation> = shell
				.state
				.pinned_conversations()
				.into_iter()
				.cloned()
				.collect();
			for conversation in &rows {
				conversation_row(ui, shell, conversation);
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
	let focus = LeftFocus::Project(project.id.clone());
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
		theme::text_3(),
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
				.frame(egui::Frame::NONE)
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
				theme::panel_3(),
			);
		}
		truncated_text(
			ui,
			pos2(caret.max.x + 5.0, head_rect.center().y),
			&project.name,
			12.0,
			if active_project {
				theme::text()
			} else {
				theme::text_2()
			},
			toggle_rect.width() - 32.0,
		);
		if toggle.clicked() {
			shell.state.left_focus = Some(focus.clone());
			shell.state.act(|state| state.select_project(&project.id));
		}
		if toggle.secondary_clicked() {
			shell.state.left_focus = Some(focus.clone());
		}
		// The hover actions: ⋯ for a registration, `+` for every project row.
		let ink = if row_hovered {
			theme::text_2()
		} else {
			theme::text_3().gamma_multiply(0.45)
		};
		if !local {
			let more_rect = Rect::from_min_size(
				pos2(head_rect.max.x - 48.0, head_rect.center().y - 10.0),
				vec2(20.0, 20.0),
			);
			let more = ui.interact(more_rect, ui.id().with(("proj-more", index)), Sense::click());
			if more.clicked() {
				shell.state.left_focus = Some(focus.clone());
			}
			if more.hovered() {
				ui.painter().rect_filled(
					more_rect,
					CornerRadius::same(theme::R_CONTROL),
					theme::panel_3(),
				);
			}
			crate::icons::paint_more(ui.painter(), more_rect, ink);
			let mut rename = false;
			let mut open_folder = false;
			let mut remove = false;
			let mut menu = |ui: &mut Ui| {
				ui.set_min_width(200.0);
				if ui.button(t!("重命名")).clicked() {
					rename = true;
					ui.close();
				}
				if ui.button(t!("在文件管理器中打开")).clicked() {
					open_folder = true;
					ui.close();
				}
				ui.separator();
				if ui
					.button(t!("从注册表移除（不删除目录）"))
					.on_hover_text(t!("只从项目注册表移除；目录和文件不会被删除"))
					.clicked()
				{
					remove = true;
					ui.close();
				}
			};
			let _ = egui::Popup::menu(&more)
				.id(ui.id().with(("proj-menu", index)))
				.show(&mut menu);
			let _ = egui::Popup::context_menu(&toggle)
				.id(ui.id().with(("proj-context", index)))
				.show(&mut menu);
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
			shell.state.open_new_workspace(&id);
		}
	}
	focus_ring(ui, head_rect, shell.state.left_focus.as_ref() == Some(&focus));
	// A project that is not open is collapsed, exactly as `.proj.collapsed`
	// hides `.ws-list`; clicking its head opens it.
	if !active_project && !renaming {
		ui.add_space(4.0);
		return;
	}
	for workspace in &project.workspaces {
		workspace_row(ui, shell, workspace.clone());
		let rows: Vec<Conversation> = shell
			.state
			.conversations_in(&workspace.id)
			.into_iter()
			.cloned()
			.collect();
		for conversation in &rows {
			conversation_row(ui, shell, conversation);
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

/// What a workspace row's menu asked for.
enum WorkspaceAction {
	NewConversation,
	Rename,
	OpenFolder,
	Remove,
}

fn workspace_menu(
	ui: &mut Ui,
	can_rename: bool,
	can_close: bool,
	action: &mut Option<WorkspaceAction>,
) {
	ui.set_min_width(200.0);
	if ui.button(t!("新建会话")).clicked() {
		*action = Some(WorkspaceAction::NewConversation);
		ui.close();
	}
	let rename = ui.add_enabled(can_rename, egui::Button::new(t!("重命名")));
	if rename.clicked() {
		*action = Some(WorkspaceAction::Rename);
		ui.close();
	}
	if !can_rename {
		rename.on_disabled_hover_text(t!(
			"只有注册项目的首个标签页会持久化命名（本机与新建标签页仅在本次运行有效）"
		));
	}
	if ui.button(t!("在文件管理器中打开")).clicked() {
		*action = Some(WorkspaceAction::OpenFolder);
		ui.close();
	}
	ui.separator();
	let remove = ui.add_enabled(can_close, egui::Button::new(t!("移除工作区（不删除目录）")));
	if remove.clicked() {
		*action = Some(WorkspaceAction::Remove);
		ui.close();
	}
	if !can_close {
		remove.on_disabled_hover_text(t!("每个项目至少保留一个工作区"));
	} else {
		remove.on_hover_text(t!("只从界面移除；目录由你自己删除"));
	}
}

/// `.ws-btn`: name + branch chip, with the accent bar when it is the open one.
fn workspace_row(ui: &mut Ui, shell: &mut Shell, workspace: Workspace) {
	let active = shell.state.active_workspace.as_deref() == Some(workspace.id.as_str());
	let focus = LeftFocus::Workspace(workspace.id.clone());
	let focused = shell.state.left_focus.as_ref() == Some(&focus);
	let (rect, response) = ui.allocate_exact_size(vec2(ui.available_width(), 30.0), Sense::click());
	if active {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::panel_4());
		ui.painter().rect_filled(
			Rect::from_min_size(pos2(rect.min.x + 8.0, rect.center().y - 8.0), vec2(3.0, 16.0)),
			CornerRadius::same(2),
			theme::ACCENT,
		);
	} else if response.hovered() {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::panel_3());
	}
	let chip_width = 24.0 + crate::center::display_cols(&workspace.branch) as f32 * 6.2;
	// Both row actions keep their own slots on the right at all times (the
	// chip is shifted left by them), so hovering does not move the branch text.
	const PLUS_W: f32 = 20.0;
	const MORE_W: f32 = 18.0;
	let plus_rect = Rect::from_min_size(
		pos2(rect.max.x - 6.0 - PLUS_W, rect.center().y - 10.0),
		vec2(PLUS_W, 20.0),
	);
	let more_rect = Rect::from_min_size(
		pos2(plus_rect.min.x - MORE_W - 2.0, rect.center().y - 10.0),
		vec2(MORE_W, 20.0),
	);
	let right = more_rect.min.x - 4.0;
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
	let response = response.on_hover_text(format!(
		"{}\n{}",
		status_tooltip(state),
		t!("右键或悬停 ... 打开菜单 · F2 重命名 · Delete 仅从视图移除（不删除目录）")
	));
	status_dot(ui, pos2(rect.min.x + 13.0, rect.center().y), state);
	truncated_text(
		ui,
		pos2(rect.min.x + 24.0, rect.center().y),
		&workspace.name,
		13.0,
		if active {
			theme::text()
		} else {
			theme::text_2()
		},
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
	let plus =
		ui.interact(plus_rect, ui.id().with(("ws-new-conversation", &workspace.id)), Sense::click());
	let more = ui.interact(more_rect, ui.id().with(("ws-menu", &workspace.id)), Sense::click());
	if response.hovered() || plus.hovered() || more.hovered() {
		ui.painter()
			.rect_filled(plus_rect, CornerRadius::same(theme::R_CONTROL), theme::panel_3());
	}
	if more.hovered() {
		ui.painter()
			.rect_filled(more_rect, CornerRadius::same(theme::R_CONTROL), theme::panel_3());
	}
	crate::icons::paint(
		ui.painter(),
		Icon::Plus,
		plus_rect.shrink(4.0),
		if plus.hovered() {
			theme::text()
		} else {
			theme::text_3()
		},
		1.6,
	);
	crate::icons::paint_more(
		ui.painter(),
		more_rect,
		if more.hovered() || response.hovered() {
			theme::text_2()
		} else {
			theme::text_3().gamma_multiply(0.55)
		},
	);
	let can_rename = shell.state.can_rename_workspace(&workspace.id);
	let can_close = shell
		.state
		.project_of(&workspace.id)
		.is_some_and(|project| project.workspaces.len() > 1);
	let mut action = None;
	let mut menu = |ui: &mut Ui| workspace_menu(ui, can_rename, can_close, &mut action);
	let _ = egui::Popup::menu(&more)
		.id(ui.id().with(("ws-popup", &workspace.id)))
		.show(&mut menu);
	let _ = egui::Popup::context_menu(&response)
		.id(ui.id().with(("ws-context", &workspace.id)))
		.show(&mut menu);
	if more.clicked() {
		shell.state.left_focus = Some(focus.clone());
	}
	let plus_hovered = plus.hovered();
	if plus.on_hover_text(t!("新建会话")).clicked() {
		shell.state.left_focus = Some(focus.clone());
		action = Some(WorkspaceAction::NewConversation);
	} else if action.is_none() && response.clicked() && !plus_hovered && !more.hovered() {
		shell.state.left_focus = Some(focus.clone());
		let id = workspace.id.clone();
		shell.state.act(|s| s.select_workspace(&id));
	} else if response.secondary_clicked() {
		shell.state.left_focus = Some(focus.clone());
	}
	match action {
		Some(WorkspaceAction::NewConversation) => {
			shell.create_conversation(&workspace.id);
		},
		Some(WorkspaceAction::Rename) => {
			let id = workspace.id.clone();
			shell.state.act(|s| s.select_workspace(&id));
			shell.state.begin_rename_workspace(&id);
		},
		Some(WorkspaceAction::OpenFolder) => {
			open_in_file_manager(shell.probe, Path::new(&workspace.path));
		},
		Some(WorkspaceAction::Remove) => {
			let id = workspace.id.clone();
			let notice = shell.remove_workspace_view(&id);
			shell.state.show(notice);
		},
		None => {},
	}
	focus_ring(ui, rect, focused);
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
		let focus = LeftFocus::Agent { pane: row.pane.clone(), tab: row.tab.clone() };
		let focused = shell.state.left_focus.as_ref() == Some(&focus);
		let (rect, response) =
			ui.allocate_exact_size(vec2(ui.available_width(), 20.0), Sense::click());
		let selected = shell
			.agent_target
			.as_ref()
			.is_some_and(|(tab, _)| tab == &row.tab);
		if selected || response.hovered() {
			ui.painter()
				.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::panel_3());
		}
		let more_rect = Rect::from_min_size(
			pos2(rect.max.x - 6.0 - MORE_W + 2.0, rect.center().y - 8.0),
			vec2(16.0, 16.0),
		);
		let more =
			ui.interact(more_rect, ui.id().with(("agent-more", &row.pane, &row.tab)), Sense::click());
		// 等待输入 outranks 运行中: the one that needs the user is the one the
		// dot should shout about.
		let dot = if row.waiting {
			theme::WARN
		} else if row.running {
			theme::ACCENT
		} else {
			theme::text_3()
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
			if selected {
				theme::text()
			} else {
				theme::text_2()
			},
			// The status word and the ⋯ keep the right edge; the title gets
			// the rest.
			(rect.width() - 108.0).max(36.0),
		);
		ui.painter().text(
			pos2(rect.max.x - 28.0, rect.center().y),
			egui::Align2::RIGHT_CENTER,
			&row.status,
			egui::FontId::new(10.0, egui::FontFamily::Monospace),
			if row.waiting {
				theme::WARN
			} else {
				theme::text_3()
			},
		);
		if response.hovered() || more.hovered() {
			ui.painter()
				.rect_filled(more_rect, CornerRadius::same(3), theme::panel_4());
		}
		crate::icons::paint_more(
			ui.painter(),
			more_rect,
			if more.hovered() || response.hovered() {
				theme::text_2()
			} else {
				theme::text_3().gamma_multiply(0.4)
			},
		);
		let mut action = None;
		let mut menu = |ui: &mut Ui| agent_menu(ui, &mut action);
		let _ = egui::Popup::menu(&more)
			.id(ui.id().with(("agent-menu", &row.pane, &row.tab)))
			.show(&mut menu);
		let _ = egui::Popup::context_menu(&response)
			.id(ui.id().with(("agent-context", &row.pane, &row.tab)))
			.show(&mut menu);
		let row_clicked = response.clicked() && !more.hovered();
		if row_clicked || response.secondary_clicked() || more.clicked() {
			shell.state.left_focus = Some(focus.clone());
		}
		if row_clicked || action == Some(AgentAction::Open) {
			open_agent(shell, &row.pane, &row.tab);
		}
		match action {
			Some(AgentAction::Archive) => {
				let notice = shell.close_tab_saving(&row.pane, &row.tab);
				shell.state.show(notice);
			},
			Some(AgentAction::RemoveView) => {
				let notice = shell.close_tab_view(&row.pane, &row.tab);
				shell.state.show(notice);
			},
			Some(AgentAction::Open) | None => {},
		}
		focus_ring(ui, rect, focused);
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
		Stroke::new(1.0_f32, theme::border()),
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
			.frame(egui::Frame::NONE)
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

/// What a conversation row's menu asked for. Applying it after the list walk
/// keeps the row loop's immutable borrow of `AppState` out of the mutation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ConversationAction {
	Open,
	RemoveView,
	Archive,
	Delete,
}

fn conversation_menu(ui: &mut Ui, running: bool, action: &mut Option<ConversationAction>) {
	ui.set_min_width(230.0);
	if ui.button(t!("打开")).clicked() {
		*action = Some(ConversationAction::Open);
		ui.close();
	}
	if ui
		.button(t!("仅从视图移除（保留会话）"))
		.on_hover_text(t!("只关闭右侧标签页；不归档、不删除"))
		.clicked()
	{
		*action = Some(ConversationAction::RemoveView);
		ui.close();
	}
	if ui
		.button(t!("关闭并归档（可恢复）"))
		.on_hover_text(t!("停止会话并归档；之后可在会话管理中恢复"))
		.clicked()
	{
		*action = Some(ConversationAction::Archive);
		ui.close();
	}
	ui.separator();
	let delete = ui.add_enabled(!running, egui::Button::new(t!("删除会话…")));
	if delete.clicked() {
		*action = Some(ConversationAction::Delete);
		ui.close();
	}
	if running {
		delete.on_disabled_hover_text(t!("运行中的会话不能删除，请先关闭并归档"));
	} else {
		delete.on_hover_text(t!("经 zetacode/gateway 软删除，需要在会话管理中确认"));
	}
}

/// One conversation row: the session's title, a running dot, its `⋯` menu, and
/// a click that opens it in the centre.
///
/// The menu keeps the three destructive-looking actions apart: **仅从视图移除**
/// closes the right-side tabs and nothing else, **关闭并归档** stops and
/// archives through the gateway (recoverable from 会话管理), and **删除会话…**
/// arms the gateway's soft delete behind the existing confirmation.
fn conversation_row(ui: &mut Ui, shell: &mut Shell, conversation: &Conversation) {
	let focus = LeftFocus::Conversation(conversation.id.clone());
	let focused = shell.state.left_focus.as_ref() == Some(&focus);
	let (rect, response) =
		ui.allocate_exact_size(vec2(ui.available_width(), CONVERSATION_ROW_H), Sense::click());
	let selected = shell
		.state
		.active_session_tab()
		.is_some_and(|tab| tab.session.as_deref() == Some(conversation.id.as_str()));
	if selected {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::panel_4());
	} else if response.hovered() {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::panel_3());
	}
	let indent = rect.min.x + 34.0;
	if conversation.running {
		ui.painter()
			.circle_filled(pos2(indent - 8.0, rect.center().y), 3.0, theme::ADD);
	}
	let more =
		Rect::from_min_size(pos2(rect.max.x - 22.0, rect.center().y - 10.0), vec2(20.0, 20.0));
	let more_response =
		ui.interact(more, ui.id().with(("conv-more", &conversation.id)), Sense::click());
	if more_response.hovered() {
		ui.painter()
			.rect_filled(more, CornerRadius::same(theme::R_CONTROL), theme::panel_3());
	}
	let response = response.on_hover_text(t!(
		"Enter 打开 · Delete 仅从视图移除 · Shift+Delete 关闭并归档（可恢复） · Ctrl+Shift+Delete 删除会话…"
	));
	crate::icons::paint_more(
		ui.painter(),
		more,
		if more_response.hovered() || response.hovered() {
			theme::text_2()
		} else {
			theme::text_3().gamma_multiply(0.55)
		},
	);
	let available = (more.min.x - indent - 6.0).max(24.0);
	truncated_text(
		ui,
		pos2(indent, rect.center().y),
		conversation.display_title(),
		12.0,
		if selected {
			theme::text()
		} else {
			theme::text_2()
		},
		available,
	);
	let mut action = None;
	let mut menu = |ui: &mut Ui| conversation_menu(ui, conversation.running, &mut action);
	let _ = egui::Popup::menu(&more_response)
		.id(ui.id().with(("conv-menu", &conversation.id)))
		.show(&mut menu);
	let _ = egui::Popup::context_menu(&response)
		.id(ui.id().with(("conv-context", &conversation.id)))
		.show(&mut menu);
	let row_clicked = response.clicked() && !more_response.hovered();
	if row_clicked || response.secondary_clicked() || more_response.clicked() {
		shell.state.left_focus = Some(focus);
	}
	if row_clicked || action == Some(ConversationAction::Open) {
		let id = conversation.id.clone();
		shell.state.act(|state| state.open_conversation(&id));
	} else {
		match action {
			Some(ConversationAction::RemoveView) => {
				let notice = shell.remove_conversation_view(&conversation.id);
				shell.state.show(notice);
			},
			Some(ConversationAction::Archive) => {
				let notice = shell.close_conversation_and_archive(&conversation.id);
				shell.state.show(notice);
			},
			Some(ConversationAction::Delete) => {
				if conversation.running {
					shell
						.state
						.toast(t!("运行中的会话不能删除，请先关闭并归档"));
				} else {
					let notice = shell.request_delete_conversation(&conversation.id);
					shell.state.show(notice);
				}
			},
			Some(ConversationAction::Open) | None => {},
		}
	}
	focus_ring(ui, rect, focused);
}

/// `.side-foot`: 设置 + 用量, a spacer, 帮助 and 聚焦.
///
/// The spec's foot carries 设置 and 用量 side by side; both are fixed items
/// (R13: the foot does not take the slot configuration).
fn foot_region(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter().line_segment(
		[
			pos2(rect.min.x + theme::GAP_ISLAND / 2.0, rect.min.y + 0.5),
			pos2(rect.max.x - theme::GAP_ISLAND / 2.0, rect.min.y + 0.5),
		],
		Stroke::new(1.0_f32, theme::border()),
	);
	let inner = Rect::from_min_max(
		pos2(rect.min.x + 8.0, rect.center().y - 15.0),
		pos2(rect.max.x - 8.0, rect.center().y + 15.0),
	);
	let spacing = ui.spacing().item_spacing.x;
	// Two icon-only buttons are 30pt each; the old hard-coded 62 ignored the
	// 6pt item spacing, so the right cluster was already 4pt wider than its
	// box. Compute it instead of guessing.
	let right_width = 30.0 * 2.0 + spacing;
	let left_width = (inner.width() - right_width - spacing).max(0.0);
	let normal_left =
		foot_button_width(ui, t!("设置")) + foot_button_width(ui, t!("用量")) + spacing;
	// At the 200pt minimum the Chinese labels do not fit (and English never
	// does). Degrade to icons with tooltips rather than painting one button
	// over the other.
	let compact = normal_left > left_width;
	let set_label = if compact { "" } else { t!("设置") };
	let usage_label = if compact { "" } else { t!("用量") };
	let mut left = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_max(
				inner.min,
				pos2(inner.max.x - right_width - spacing, inner.max.y),
			))
			.layout(Layout::left_to_right(Align::Center)),
	);
	let set = foot_button(&mut left, Icon::Gear, set_label);
	let set_clicked = set.clicked();
	if compact {
		set.on_hover_text(t!("设置"));
	}
	if set_clicked {
		shell.state.open_settings();
	}
	let usage = foot_button(&mut left, Icon::List, usage_label);
	let usage_clicked = usage.clicked();
	if compact {
		usage.on_hover_text(t!("用量"));
	}
	if usage_clicked {
		open_usage(shell);
	}
	let mut right = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_max(pos2(inner.max.x - right_width, inner.min.y), inner.max))
			.layout(Layout::right_to_left(Align::Center)),
	);
	if foot_button(&mut right, Icon::Focus, "")
		.on_hover_text(t!("聚焦"))
		.clicked()
	{
		shell.state.act(|s| s.focus_mode());
	}
	if foot_button(&mut right, Icon::Help, "")
		.on_hover_text(t!("帮助"))
		.clicked()
	{
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
		.rect_filled(rect, CornerRadius::ZERO, theme::panel());
	ui.painter().line_segment(
		[pos2(rect.max.x - 0.5, rect.min.y), pos2(rect.max.x - 0.5, rect.max.y)],
		Stroke::new(1.0_f32, theme::border()),
	);
	let mut child = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_size(pos2(rect.min.x + 6.0, rect.min.y + 8.0), vec2(32.0, 32.0))),
	);
	if icon_button(&mut child, Icon::Hamburger, 32.0, false, t!("展开左侧栏")).clicked() {
		shell.state.toggle_left();
	}
}

// ── keyboard navigation ────────────────────────────────────────────────

/// The rows Up/Down walk, in the order the column draws them: the pinned
/// 默认项目 block first, then every expanded project's workspaces with their
/// Agent tabs and conversations.
///
/// This is a pure reading of the state, so the walk can be tested without a
/// window; [`left_column`] feeds its result to [`step_focus`].
pub fn focus_order(state: &AppState) -> Vec<LeftFocus> {
	let mut rows = Vec::new();
	let mut push = |focus: LeftFocus| rows.push(focus);
	if let Some(workspace) = state.default_workspace() {
		push(LeftFocus::Workspace(workspace.id.clone()));
		for conversation in state.pinned_conversations() {
			push(LeftFocus::Conversation(conversation.id.clone()));
		}
	}
	for project in &state.projects {
		if AppState::is_system_project(&project.id) {
			continue;
		}
		push(LeftFocus::Project(project.id.clone()));
		let expanded = state.active_project.as_deref() == Some(project.id.as_str())
			|| state.renaming().is_some_and(|(id, _)| id == project.id);
		if !expanded {
			continue;
		}
		for workspace in &project.workspaces {
			push(LeftFocus::Workspace(workspace.id.clone()));
			for pane in &workspace.panes {
				for tab in pane
					.tabs
					.iter()
					.filter(|tab| tab.kind == SessionKind::Agent)
				{
					push(LeftFocus::Agent { pane: pane.id.clone(), tab: tab.id.clone() });
				}
			}
			for conversation in state.conversations_in(&workspace.id) {
				push(LeftFocus::Conversation(conversation.id.clone()));
			}
		}
	}
	rows
}

/// One Up (`delta < 0`) or Down (`delta >= 0`) step through `order`. A current
/// row that is no longer drawn starts at the last row going up and the first
/// going down. Both ends clamp; an empty order has no focus.
pub fn step_focus(
	order: &[LeftFocus],
	current: Option<&LeftFocus>,
	delta: isize,
) -> Option<LeftFocus> {
	if order.is_empty() {
		return None;
	}
	let next = match current.and_then(|row| order.iter().position(|entry| entry == row)) {
		Some(index) if delta < 0 => index.saturating_sub(1),
		Some(index) => (index + 1).min(order.len() - 1),
		None if delta < 0 => order.len() - 1,
		None => 0,
	};
	order.get(next).cloned()
}

/// The keyboard, while the tree owns it: Up/Down move, Enter opens, F2 renames,
/// Delete removes from the view, Shift+Delete closes and archives, and
/// Ctrl+Shift+Delete arms the gateway's real delete.
///
/// The tree only listens while [`AppState::left_focus`] names a row, no widget
/// owns the keyboard (the agent prompt and the inline editors are TextEdits),
/// no popup menu is open, and no modal is up — so a Delete typed into the
/// prompt never reaches the tree.
fn handle_left_keys(ui: &mut Ui, shell: &mut Shell) {
	if shell.state.left_focus.is_none()
		|| ui.ctx().memory(|memory| memory.focused()).is_some()
		|| egui::Popup::is_any_open(ui.ctx())
		|| shell.state.modal_open()
		|| shell.state.renaming().is_some()
		|| shell.state.renaming_workspace().is_some()
		|| shell.state.adding().is_some()
	{
		return;
	}
	let order = focus_order(&shell.state);
	let current = shell.state.left_focus.clone();
	let (down, up) = ui.input_mut(|input| {
		(
			input.consume_key(Modifiers::NONE, Key::ArrowDown),
			input.consume_key(Modifiers::NONE, Key::ArrowUp),
		)
	});
	if down || up {
		if let Some(next) = step_focus(&order, current.as_ref(), if up { -1 } else { 1 }) {
			shell.state.left_focus = Some(next);
		}
		return;
	}
	let Some(focus) = current else {
		return;
	};
	// The most specific chords first: `consume_key` ignores extra Shift/Alt, so
	// Ctrl+Shift+Delete would otherwise satisfy plain Delete too.
	let escape = ui.input_mut(|input| input.consume_key(Modifiers::NONE, Key::Escape));
	if escape {
		shell.state.left_focus = None;
		return;
	}
	let delete_all =
		ui.input_mut(|input| input.consume_key(Modifiers::CTRL | Modifiers::SHIFT, Key::Delete));
	let delete_archive = ui.input_mut(|input| input.consume_key(Modifiers::SHIFT, Key::Delete));
	let delete_view = ui.input_mut(|input| input.consume_key(Modifiers::NONE, Key::Delete));
	let enter = ui.input_mut(|input| input.consume_key(Modifiers::NONE, Key::Enter));
	let rename = ui.input_mut(|input| input.consume_key(Modifiers::NONE, Key::F2));
	if delete_all {
		left_delete_all(shell, focus);
	} else if delete_archive {
		left_delete_archive(shell, focus);
	} else if delete_view {
		left_delete_view(shell, focus);
	} else if enter {
		left_activate(shell, focus);
	} else if rename {
		left_rename(shell, focus);
	}
}

/// Enter on a focused row: select a project/workspace, open a conversation, or
/// open (and aim the prompt line at) an Agent tab.
fn left_activate(shell: &mut Shell, focus: LeftFocus) {
	match focus {
		LeftFocus::Project(id) => shell.state.act(|state| state.select_project(&id)),
		LeftFocus::Workspace(id) => shell.state.act(|state| state.select_workspace(&id)),
		LeftFocus::Conversation(id) => shell.state.act(|state| state.open_conversation(&id)),
		LeftFocus::Agent { pane, tab } => open_agent(shell, &pane, &tab),
	}
}

/// F2: the inline project editor, or the 大标签页 editor for a workspace whose
/// name the registry can persist.
fn left_rename(shell: &mut Shell, focus: LeftFocus) {
	match focus {
		LeftFocus::Project(id) => shell.state.begin_rename_project(&id),
		LeftFocus::Workspace(id) => {
			if shell.state.can_rename_workspace(&id) {
				let _ = shell.state.select_workspace(&id);
				shell.state.begin_rename_workspace(&id);
			} else {
				shell
					.state
					.toast(t!("只有注册项目的首个标签页会持久化命名"));
			}
		},
		LeftFocus::Conversation(_) | LeftFocus::Agent { .. } => {},
	}
}

/// Delete: remove the row from the view only. No directory, transcript, or
/// gateway record is touched; a project leaves the registry (its directory
/// stays), a workspace and a conversation leave the centre, and an Agent row
/// closes its tab.
fn left_delete_view(shell: &mut Shell, focus: LeftFocus) {
	match focus {
		LeftFocus::Project(id) => shell.state.act(|state| state.remove_project(&id)),
		LeftFocus::Workspace(id) => {
			let notice = shell.remove_workspace_view(&id);
			shell.state.show(notice);
		},
		LeftFocus::Conversation(id) => {
			let notice = shell.remove_conversation_view(&id);
			shell.state.show(notice);
		},
		LeftFocus::Agent { pane, tab } => {
			let notice = shell.close_tab_view(&pane, &tab);
			shell.state.show(notice);
		},
	}
}

/// Shift+Delete: close, stop, and archive — recoverable from 会话管理. Projects
/// and workspaces have no archive, so the chord is a no-op there.
fn left_delete_archive(shell: &mut Shell, focus: LeftFocus) {
	match focus {
		LeftFocus::Conversation(id) => {
			let notice = shell.close_conversation_and_archive(&id);
			shell.state.show(notice);
		},
		LeftFocus::Agent { pane, tab } => {
			let notice = shell.close_tab_saving(&pane, &tab);
			shell.state.show(notice);
		},
		LeftFocus::Project(_) | LeftFocus::Workspace(_) => {
			shell
				.state
				.toast(t!("项目和工作区没有归档；Delete 只从视图移除"));
		},
	}
}

/// Ctrl+Shift+Delete: arm the gateway's real (soft) delete. Conversations only,
/// never while one is running; the 会话管理 confirmation still has to be
/// accepted before anything is deleted.
fn left_delete_all(shell: &mut Shell, focus: LeftFocus) {
	let LeftFocus::Conversation(id) = focus else {
		shell.state.toast(t!("只有会话可以删除"));
		return;
	};
	let running = shell
		.state
		.conversation(&id)
		.is_some_and(|entry| entry.conversation.running);
	if running {
		shell
			.state
			.toast(t!("运行中的会话不能删除，请先关闭并归档"));
		return;
	}
	let notice = shell.request_delete_conversation(&id);
	shell.state.show(notice);
}

/// Open an Agent tab from the tree, select the workspace it lives in, and aim
/// the prompt line at its session.
fn open_agent(shell: &mut Shell, pane_id: &str, tab_id: &str) {
	let mut owner = None;
	let mut session = None;
	for project in &shell.state.projects {
		for workspace in &project.workspaces {
			for pane in &workspace.panes {
				if pane.id != pane_id {
					continue;
				}
				owner = Some(workspace.id.clone());
				session = pane
					.tabs
					.iter()
					.find(|tab| tab.id == tab_id)
					.and_then(|tab| tab.session.clone());
			}
		}
	}
	let session = session.or_else(|| {
		shell
			.agents
			.pane(tab_id)
			.and_then(|agent| agent.session.clone())
	});
	if let Some(workspace) = owner {
		let _ = shell.state.select_workspace(&workspace);
	}
	shell.state.select_tab(pane_id, tab_id);
	shell.agent_target = session.map(|session| (tab_id.to_owned(), session));
	shell.agent_prompt.clear();
}

/// The visible focus ring: the accent stroke on the row the keyboard walks.
fn focus_ring(ui: &Ui, rect: Rect, focused: bool) {
	if !focused {
		return;
	}
	ui.painter().rect_stroke(
		rect.shrink(1.0),
		CornerRadius::same(theme::R_CONTROL),
		Stroke::new(1.5_f32, theme::ACCENT),
		egui::StrokeKind::Inside,
	);
}

/// What an Agent row's menu asked for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AgentAction {
	Open,
	Archive,
	RemoveView,
}

fn agent_menu(ui: &mut Ui, action: &mut Option<AgentAction>) {
	ui.set_min_width(200.0);
	if ui.button(t!("打开")).clicked() {
		*action = Some(AgentAction::Open);
		ui.close();
	}
	if ui
		.button(t!("关闭并归档（可恢复）"))
		.on_hover_text(t!("停止会话并归档；之后可在会话管理中恢复"))
		.clicked()
	{
		*action = Some(AgentAction::Archive);
		ui.close();
	}
	if ui
		.button(t!("仅从视图移除"))
		.on_hover_text(t!("只关闭这个标签页；会话本身保留"))
		.clicked()
	{
		*action = Some(AgentAction::RemoveView);
		ui.close();
	}
}
