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

use std::path::Path;

use egui::{Align, CornerRadius, Layout, Rect, Sense, Stroke, Ui, pos2, vec2};

use crate::{
	Shell,
	icons::{Icon, icon_button},
	state::{AppState, Project, Workspace},
	theme,
	widgets::{
		foot_button, status_dot, status_tooltip, status_word, truncated_mono, truncated_text,
	},
};

/// Width of the open column (`--side-left-w`).
pub const WIDTH: f32 = 248.0;
/// Width of the collapsed rail (`.rail`).
pub const RAIL_WIDTH: f32 = 44.0;

/// Height of the brand head.
const HEAD_H: f32 = 44.0;
/// Height of the foot row.
const FOOT_H: f32 = 46.0;

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
	let list = Rect::from_min_max(pos2(rect.min.x, head.max.y), pos2(rect.max.x, foot.min.y));
	let mut head_ui = ui.new_child(egui::UiBuilder::new().max_rect(head));
	head_region(&mut head_ui, shell);
	let mut list_ui = ui.new_child(egui::UiBuilder::new().max_rect(list));
	projects_region(&mut list_ui, shell);
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
	let mut collapse = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(
		pos2(rect.max.x - 32.0, rect.center().y - 12.0),
		vec2(24.0, 24.0),
	)));
	if icon_button(&mut collapse, Icon::ChevronLeft, 24.0, false, "收起左侧栏").clicked() {
		shell.state.toggle_left();
	}
}

/// The 项目 section: the section head, the inline add editor when open, then
/// one group per project.
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
		"项目",
		egui::FontId::new(11.0, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	let mut add = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(
		pos2(head.max.x - 30.0, head.center().y - 10.0),
		vec2(20.0, 20.0),
	)));
	if icon_button(&mut add, Icon::Plus, 20.0, shell.state.adding().is_some(), "添加项目").clicked()
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
			.hint_text("项目目录")
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
	if icon_button(&mut ok, Icon::Check, 20.0, false, "添加").clicked() {
		shell.state.act(|state| state.commit_add_project());
	}
	let mut cancel = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(
		pos2(area.max.x - 26.0, area.center().y - 10.0),
		vec2(20.0, 20.0),
	)));
	if icon_button(&mut cancel, Icon::X, 20.0, false, "取消").clicked() {
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
					if ui.button("重命名").clicked() {
						rename = true;
						ui.close();
					}
					if ui.button("在文件管理器中打开").clicked() {
						open_folder = true;
						ui.close();
					}
					if ui.button("从注册表移除").clicked() {
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
		if icon_button(&mut plus, Icon::Plus, 20.0, false, "新建工作区").clicked() {
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
	}
	ui.add_space(4.0);
}

fn many_rect_center(rect: Rect) -> egui::Pos2 {
	pos2(rect.center().x, rect.center().y - 1.0)
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
	// The run state: the dot in front of the name carries its colour, and the
	// word sits before the branch chip. The **name outranks the word** — a row
	// whose name has been squeezed to `…` tells you nothing, and the dot plus
	// the tooltip still carry the state — so the word is only drawn when the
	// name keeps a readable 64 px. A workspace nothing observes shows `—` and no
	// dot; the tooltip says why.
	let state = workspace.run_state;
	let word_width = 3.0_f32.max(crate::center::display_cols("unconfirmed") as f32 * 6.2) + 8.0;
	let show_word = rect.width() - 30.0 - chip_width - word_width - 8.0 >= 64.0;
	let name_available =
		rect.width() - 30.0 - chip_width - if show_word { word_width } else { 0.0 } - 8.0;
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
			pos2(rect.max.x - 12.0 - chip_width - word_width, rect.center().y),
			state,
			11.0,
			word_width - 4.0,
		);
	}
	let chip_rect = Rect::from_min_size(
		pos2(rect.max.x - 8.0 - chip_width, rect.center().y - 9.0),
		vec2(chip_width, 18.0),
	);
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
	if response.clicked() {
		let id = workspace.id.clone();
		shell.state.act(|s| s.select_workspace(&id));
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
	if foot_button(&mut left, Icon::Gear, "设置").clicked() {
		shell.state.open_settings();
	}
	if foot_button(&mut left, Icon::List, "用量").clicked() {
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
	if icon_button(&mut child, Icon::Hamburger, 32.0, false, "展开左侧栏").clicked() {
		shell.state.toggle_left();
	}
}
