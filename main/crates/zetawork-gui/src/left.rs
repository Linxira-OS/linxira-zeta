//! The left column (`aside.side-left`) and its collapsed rail.
//!
//! Content order is the spec's: brand head, 主导航, 项目 (the project → workspace
//! list), then the foot row with 设置 / 帮助 / 聚焦. Collapsing swaps the column
//! for the thin `rail.rail-left` strip that carries only the expand button.
//!
//! The regions are laid out from explicit rectangles rather than by stacking
//! widgets, because the project list has to fill exactly the space between the
//! nav and the foot row no matter how many projects there are.

use egui::{Align, CornerRadius, Layout, Rect, Sense, Stroke, Ui, pos2, vec2};

use crate::Shell;
use crate::chrome::gradient_mark;
use crate::icons::Icon;
use crate::icons::icon_button;
use crate::seed;
use crate::state::{NavItem, Project, Workspace};
use crate::theme;
use crate::widgets::{
	foot_button, nav_row, status_dot, status_tooltip, status_word, truncated_mono, truncated_text,
};

/// Width of the open column (`--side-left-w`).
pub const WIDTH: f32 = 248.0;
/// Width of the collapsed rail (`.rail`).
pub const RAIL_WIDTH: f32 = 44.0;

/// Height of the brand head.
const HEAD_H: f32 = 44.0;
/// Height of the foot row.
const FOOT_H: f32 = 46.0;
/// Height of one nav row.
const NAV_ROW_H: f32 = 30.0;

fn nav_icon(item: NavItem) -> Icon {
	match item {
		NavItem::Search => Icon::Search,
		NavItem::Tasks => Icon::Tasks,
		NavItem::Automations => Icon::Zap,
		// R20: hidden this round, but the slot keeps its icon for the day it
		// comes back.
		NavItem::Mobile => Icon::Hamburger,
	}
}

/// The open column.
pub fn left_column(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	ui.painter().line_segment(
		[pos2(rect.max.x - 0.5, rect.min.y), pos2(rect.max.x - 0.5, rect.max.y)],
		Stroke::new(1.0, theme::BORDER),
	);
	let head = Rect::from_min_size(rect.min, vec2(rect.width(), HEAD_H));
	let nav = Rect::from_min_size(
		pos2(rect.min.x, head.max.y),
		vec2(rect.width(), NAV_ROW_H * NavItem::visible().count() as f32 + 10.0),
	);
	let foot =
		Rect::from_min_size(pos2(rect.min.x, rect.max.y - FOOT_H), vec2(rect.width(), FOOT_H));
	let list = Rect::from_min_max(pos2(rect.min.x, nav.max.y), pos2(rect.max.x, foot.min.y));
	let mut head_ui = ui.new_child(egui::UiBuilder::new().max_rect(head));
	head_region(&mut head_ui, shell);
	let mut nav_ui = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(nav)
			.layout(Layout::top_down(Align::Min)),
	);
	nav_region(&mut nav_ui, shell);
	let mut list_ui = ui.new_child(egui::UiBuilder::new().max_rect(list));
	projects_region(&mut list_ui, shell);
	let mut foot_ui = ui.new_child(egui::UiBuilder::new().max_rect(foot));
	foot_region(&mut foot_ui, shell);
}

/// `.side-head`: brand mark, name, presence, collapse button.
fn head_region(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	let mark =
		Rect::from_min_size(pos2(rect.min.x + 12.0, rect.center().y - 11.0), vec2(22.0, 22.0));
	gradient_mark(ui, mark, "Z");
	ui.painter().text(
		pos2(mark.max.x + 8.0, rect.center().y),
		egui::Align2::LEFT_CENTER,
		crate::APP_TITLE,
		egui::FontId::new(13.0, egui::FontFamily::Proportional),
		theme::TEXT,
	);
	ui.painter()
		.circle_filled(pos2(mark.max.x + 8.0 + 60.0, rect.center().y), 3.5, theme::ADD);
	let mut collapse = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(
		pos2(rect.max.x - 32.0, rect.center().y - 12.0),
		vec2(24.0, 24.0),
	)));
	if icon_button(&mut collapse, Icon::ChevronLeft, 24.0, false, "收起左侧栏").clicked() {
		shell.state.toggle_left();
	}
}

/// `.nav` — 搜索 / 任务 / 自动化.
fn nav_region(ui: &mut Ui, shell: &mut Shell) {
	ui.add_space(5.0);
	let rect = ui.max_rect();
	// `add_space` moved the cursor, so the rows start below it rather than at
	// the region's top.
	let inner = Rect::from_min_max(
		pos2(rect.min.x + 8.0, ui.cursor().top()),
		pos2(rect.max.x - 8.0, rect.max.y),
	);
	let mut child = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(inner)
			.layout(Layout::top_down(Align::Min)),
	);
	for item in NavItem::visible() {
		let active = shell.state.nav == item;
		if nav_row(&mut child, nav_icon(item), item.label(), item.trailing(), active).clicked() {
			shell.state.nav = item;
			shell.state.show(crate::state::Notice(format!(
				"{}：尚未接入（未来数据源：{}）",
				item.label(),
				item.source()
			)));
		}
	}
}

/// The 项目 section: the sample-data note, then one group per project.
fn projects_region(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.min.y), pos2(rect.max.x, rect.min.y)],
		Stroke::new(1.0, theme::BORDER),
	);
	let head = Rect::from_min_size(rect.min, vec2(rect.width(), 28.0));
	let note = Rect::from_min_size(pos2(rect.min.x, head.max.y), vec2(rect.width(), 20.0));
	let list = Rect::from_min_max(pos2(rect.min.x, note.max.y), rect.max);
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
	if icon_button(&mut add, Icon::Plus, 20.0, false, "添加项目").clicked() {
		shell.state.show(crate::state::Notice(
			"添加项目：项目注册表尚未接入（未来数据源：zetawork 项目注册表）".to_owned(),
		));
	}
	truncated_text(
		ui,
		pos2(note.min.x + 12.0, note.center().y),
		seed::SAMPLE_NOTE,
		10.5,
		theme::TEXT_3,
		note.width() - 20.0,
	);
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

/// One project: its head (toggle + ＋新建工作区) and its workspaces.
fn project_group(ui: &mut Ui, shell: &mut Shell, index: usize) {
	let project: Project = shell.state.projects[index].clone();
	let active_project = shell.state.active_project.as_deref() == Some(project.id.as_str());
	let (head_rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 26.0), Sense::hover());
	let toggle_rect =
		Rect::from_min_max(head_rect.min, pos2(head_rect.max.x - 26.0, head_rect.max.y));
	let toggle = ui.interact(toggle_rect, ui.id().with(("proj", index)), Sense::click());
	if toggle.hovered() {
		ui.painter()
			.rect_filled(toggle_rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
	}
	let caret =
		Rect::from_center_size(pos2(head_rect.min.x + 12.0, head_rect.center().y), vec2(12.0, 12.0));
	crate::icons::paint(
		ui.painter(),
		if active_project {
			Icon::ChevronDown
		} else {
			Icon::ChevronRight
		},
		caret,
		theme::TEXT_3,
		2.0,
	);
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
		shell.state.act(|s| s.select_project(&project.id));
	}
	let mut plus = ui.new_child(egui::UiBuilder::new().max_rect(Rect::from_min_size(
		pos2(head_rect.max.x - 24.0, head_rect.center().y - 10.0),
		vec2(20.0, 20.0),
	)));
	if icon_button(&mut plus, Icon::Plus, 20.0, false, "新建工作区").clicked() {
		let id = project.id.clone();
		shell.state.act(|s| s.new_workspace(&id));
	}
	// A project that is not open is collapsed, exactly as `.proj.collapsed`
	// hides `.ws-list`; clicking its head opens it.
	if !active_project {
		ui.add_space(4.0);
		return;
	}
	for workspace in &project.workspaces {
		workspace_row(ui, shell, workspace.clone());
	}
	ui.add_space(4.0);
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
		Stroke::new(1.0, theme::CHIP_BRANCH_BORDER),
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
/// The spec's foot carries 设置 and 用量 side by side; both are fixed items (R13:
/// the foot does not take the slot configuration).
fn foot_region(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.min.y + 0.5), pos2(rect.max.x, rect.min.y + 0.5)],
		Stroke::new(1.0, theme::BORDER),
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
		Stroke::new(1.0, theme::BORDER),
	);
	let mut child = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_size(pos2(rect.min.x + 6.0, rect.min.y + 8.0), vec2(32.0, 32.0))),
	);
	if icon_button(&mut child, Icon::Hamburger, 32.0, false, "展开左侧栏").clicked() {
		shell.state.toggle_left();
	}
}
