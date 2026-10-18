// SPDX-License-Identifier: AGPL-3.0-only
//! The centre column: the 大标签页 strip, the tool strip, the pane grid and the
//! three pane bodies.
//!
//! The strip shows **the active project's workspaces** — 大标签页 *is* 工作区 —
//! so clicking one opens it and its ✕ closes it (refused on the last one of a
//! project). Below it the tool strip drives 新建终端 / 分屏 / 列数, and the body
//! is either the pane grid or, with no workspace open, the welcome panel.
//!
//! The three pane bodies are where the honest line lives: the terminal blits a
//! real ratatui `Buffer` (see [`crate::blit`]), the editor colours the spec's
//! sample code, and the diff draws the spec's hunk rows — and each one starts
//! with a `[占位]` banner naming the data source it will read once that exists.

use egui::{Align, Color32, CornerRadius, Layout, Rect, Sense, Stroke, Ui, pos2, vec2};

use crate::Shell;
use crate::agent::RowKind;
use crate::agent_sessions::{EMPTY_HINT, Link};
use crate::blit::{BufferCache, GridMetrics, paint_buffer_with, paint_cursor};
use crate::git::DiffKind;
use crate::icons::{Icon, icon_button, paint};
use crate::seed;
use crate::state::{CenterPage, EditorDoc, Pane, PickerTarget, SessionKind, SessionTab};
use crate::theme;
use crate::widgets::{Chip, chip, empty_note, truncated_mono, truncated_text};

/// The pane grid, or the welcome panel when no workspace is open.
pub fn workspace(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	let open = shell.state.active_workspace().is_some();
	// 总面板 is a page, not a workspace: it has no panes, so the tool strip
	// (新建终端 / 分屏 / 列数) would control nothing while it is on screen.
	let panes_open = open && shell.state.center_page == CenterPage::Workspace;
	let topbar = Rect::from_min_size(rect.min, vec2(rect.width(), theme::TOPBAR_H));
	let toolstrip = Rect::from_min_size(
		pos2(rect.min.x, topbar.max.y),
		vec2(rect.width(), if panes_open { theme::TOOLSTRIP_H } else { 0.0 }),
	);
	let body = Rect::from_min_max(pos2(rect.min.x, toolstrip.max.y), rect.max);
	for (region, draw) in [
		(topbar, big_tabs as fn(&mut Ui, &mut Shell)),
		(toolstrip, tool_strip as fn(&mut Ui, &mut Shell)),
		(body, body_region as fn(&mut Ui, &mut Shell)),
	] {
		if region.height() <= 1.0 {
			continue;
		}
		let mut child = ui.new_child(egui::UiBuilder::new().max_rect(region));
		draw(&mut child, shell);
	}
}

/// `.ws-topbar` — the 大标签页 strip and ＋.
fn big_tabs(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL_2);
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.max.y - 0.5), pos2(rect.max.x, rect.max.y - 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let mut x = rect.min.x + 8.0;
	// 总面板 is the strip's **first** 大标签页 (the contract's ruling). It is
	// always there and never closable — it is a page, not a workspace — and the
	// mock draws its label in `--purple` when it is not the active tab.
	{
		let label = CenterPage::Total.label();
		let text_width = (display_cols(label) as f32 * 7.4).min(150.0);
		let width = text_width + 24.0;
		let tab = Rect::from_min_max(
			pos2(x, rect.min.y + theme::TOPBAR_H - 32.0 - 1.0),
			pos2(x + width, rect.max.y),
		);
		let is_active = shell.state.center_page == CenterPage::Total;
		let response = ui.interact(tab, ui.id().with("bigtab-total"), Sense::click());
		tab_face(ui, tab, is_active, response.hovered());
		truncated_text(
			ui,
			pos2(tab.min.x + 12.0, tab.center().y),
			label,
			12.0,
			if is_active {
				theme::TEXT
			} else {
				theme::PURPLE
			},
			text_width,
		);
		if response.clicked() {
			shell.state.show_total();
		}
		x += width + 2.0;
	}
	let active = shell.state.active_workspace.as_deref().map(str::to_owned);
	let project = shell.state.active_project().cloned();
	if let Some(project) = project {
		for workspace in &project.workspaces {
			let is_active = shell.state.center_page == CenterPage::Workspace
				&& active.as_deref() == Some(workspace.id.as_str());
			let text_width = (display_cols(&workspace.name) as f32 * 7.4).min(150.0);
			let width = text_width + 40.0;
			let tab = Rect::from_min_max(
				pos2(x, rect.min.y + theme::TOPBAR_H - 32.0 - 1.0),
				pos2(x + width, rect.max.y),
			);
			let close =
				Rect::from_min_size(pos2(tab.max.x - 24.0, tab.center().y - 9.0), vec2(18.0, 18.0));
			let response = ui.interact(tab, ui.id().with(("bigtab", &workspace.id)), Sense::click());
			let close_response =
				ui.interact(close, ui.id().with(("bigtab-close", &workspace.id)), Sense::click());
			tab_face(ui, tab, is_active, response.hovered());
			truncated_text(
				ui,
				pos2(tab.min.x + 12.0, tab.center().y),
				&workspace.name,
				12.0,
				if is_active {
					theme::TEXT
				} else {
					theme::TEXT_3
				},
				text_width,
			);
			let close_ink = if close_response.hovered() {
				theme::TEXT
			} else {
				theme::TEXT_3
			};
			if close_response.hovered() {
				ui.painter()
					.rect_filled(close, CornerRadius::same(3), theme::PANEL_4);
			}
			paint(ui.painter(), Icon::X, close.shrink(3.0), close_ink, 1.4);
			if close_response.clicked() {
				let id = workspace.id.clone();
				shell.state.act(|s| s.close_workspace(&id));
			} else if response.clicked() {
				let id = workspace.id.clone();
				shell.state.act(|s| s.select_workspace(&id));
			}
			x += width + 2.0;
		}
	}
	let plus_rect = Rect::from_center_size(pos2(x + 14.0, rect.center().y), vec2(28.0, 28.0));
	let mut child = ui.new_child(egui::UiBuilder::new().max_rect(plus_rect));
	if icon_button(&mut child, Icon::Plus, 28.0, false, "新建大标签页").clicked() {
		// The strip's ＋ lists what the centre can show; the pick decides what
		// the new 大标签页 opens with.
		shell.open_picker(PickerTarget::BigTab, plus_rect);
	}
	// The caps, spelled the way the contract's strip spells them.
	let count = shell
		.state
		.active_project()
		.map(|p| p.workspaces.len())
		.unwrap_or(0);
	let caps = format!(
		"大标签页 {count}/{} · 子页上限 {}",
		crate::state::MAX_WORKSPACES_PER_PROJECT,
		crate::state::MAX_SUBS_PER_PANE
	);
	let caps_x = plus_rect.max.x + 8.0;
	if caps_x + 150.0 < rect.max.x - 8.0 - 116.0 {
		truncated_text(ui, pos2(caps_x, rect.center().y), &caps, 11.0, theme::TEXT_3, 140.0);
	}
}

/// The face of one 大标签页: the active one is filled with the ground colour
/// and outlined on its top and sides (`.bigtab.is-active`); a hovered one is
/// filled with `--panel-3` (`.bigtab:hover`). Shared by 总面板's tab and the
/// workspace tabs so the two cannot drift apart.
fn tab_face(ui: &Ui, tab: Rect, is_active: bool, hovered: bool) {
	let radius = CornerRadius { nw: theme::R_PANEL, ne: theme::R_PANEL, sw: 0, se: 0 };
	if is_active {
		ui.painter().rect_filled(
			Rect::from_min_max(tab.min, pos2(tab.max.x, tab.max.y)),
			radius,
			theme::GROUND,
		);
		ui.painter().rect_stroke(
			Rect::from_min_max(tab.min, pos2(tab.max.x, tab.min.y + 32.0)),
			radius,
			Stroke::new(1.0_f32, theme::BORDER),
			egui::StrokeKind::Inside,
		);
	} else if hovered {
		ui.painter().rect_filled(
			Rect::from_min_max(tab.min, pos2(tab.max.x, tab.max.y)),
			radius,
			theme::PANEL_3,
		);
	}
}

/// `.ws-toolstrip` — 新建终端 / 分屏 / 列数.
fn tool_strip(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	if rect.height() <= 1.0 {
		return;
	}
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.max.y - 0.5), pos2(rect.max.x, rect.max.y - 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let mut left = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_max(
				pos2(rect.min.x + 8.0, rect.min.y),
				pos2(rect.max.x - 120.0, rect.max.y),
			))
			.layout(Layout::left_to_right(Align::Center)),
	);
	if tool_button(&mut left, Icon::Term, "新建终端").clicked() {
		shell.state.act(|s| s.new_term());
	}
	if tool_button(&mut left, Icon::Split, "分屏").clicked() {
		shell.state.act(|s| s.new_pane());
	}
	let mut right = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_max(
				pos2(rect.max.x - 120.0, rect.min.y),
				pos2(rect.max.x - 8.0, rect.max.y),
			))
			.layout(Layout::right_to_left(Align::Center)),
	);
	let cols = shell.state.active_cols();
	let frame = egui::Frame::new()
		.fill(theme::PANEL_2)
		.stroke(Stroke::new(1.0_f32, theme::BORDER))
		.inner_margin(egui::Margin::same(0));
	frame.show(&mut right, |ui| {
		// Same reason as the view switch: the parent here is right-to-left.
		ui.with_layout(Layout::left_to_right(Align::Center), |ui| {
			ui.spacing_mut().item_spacing.x = 0.0;
			for columns in [1u8, 2, 3] {
				let (rect, response) = ui.allocate_exact_size(vec2(26.0, 24.0), Sense::click());
				let on = cols == columns;
				if on {
					ui.painter()
						.rect_filled(rect, CornerRadius::ZERO, theme::PANEL_4);
				} else if response.hovered() {
					ui.painter()
						.rect_filled(rect, CornerRadius::ZERO, theme::PANEL_3);
				}
				let ink = if on { theme::TEXT } else { theme::TEXT_3 };
				paint(ui.painter(), Icon::Columns(columns), rect.shrink(6.0), ink, 1.5);
				let tooltip = match columns {
					1 => "单列",
					2 => "两列",
					_ => "三列",
				};
				if response.on_hover_text(tooltip).clicked() {
					shell.state.act(|s| s.set_cols(columns));
				}
			}
		});
	});
}

fn tool_button(ui: &mut Ui, icon: Icon, label: &str) -> egui::Response {
	let font = egui::FontId::new(12.0, egui::FontFamily::Proportional);
	let galley = ui
		.painter()
		.layout_no_wrap(label.to_owned(), font.clone(), theme::TEXT_2);
	let width = galley.size().x + 14.0 + 6.0 + 18.0;
	let (rect, response) = ui.allocate_exact_size(vec2(width, 24.0), Sense::click());
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_2);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(theme::R_CONTROL),
		Stroke::new(1.0_f32, theme::BORDER),
		egui::StrokeKind::Inside,
	);
	if response.hovered() {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
	}
	paint(
		ui.painter(),
		icon,
		Rect::from_center_size(pos2(rect.min.x + 8.0 + 7.0, rect.center().y), vec2(14.0, 14.0)),
		theme::TEXT_3,
		1.5,
	);
	ui.painter().text(
		pos2(rect.min.x + 8.0 + 14.0 + 6.0, rect.center().y),
		egui::Align2::LEFT_CENTER,
		label,
		font,
		if response.hovered() {
			theme::TEXT
		} else {
			theme::TEXT_2
		},
	);
	response
}

/// `.ws-body`.
fn body_region(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::GROUND);
	// The strip's first 大标签页 owns the whole body when it is selected: 总面板
	// is a page of its own (every project in one table), not a pane layout.
	if shell.state.center_page == CenterPage::Total {
		crate::total::page(ui, shell);
		return;
	}
	if shell.state.active_workspace().is_none() {
		welcome(ui, shell);
		return;
	}
	let panes: Vec<Pane> = shell.state.visible_panes().to_vec();
	if panes.is_empty() {
		welcome(ui, shell);
		return;
	}
	let count = panes.len();
	// Equal columns snapped to whole points. Panes abut, so the only ink
	// between them is the one hairline drawn below — no backdrop band, and no
	// second line where the grid meets the right column's own edge.
	let boundary = |index: usize| {
		if index == count {
			rect.max.x
		} else {
			rect.min.x + (rect.width() * index as f32 / count as f32).round()
		}
	};
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	for (index, pane) in panes.iter().enumerate() {
		let pane_rect = Rect::from_min_max(
			pos2(boundary(index), rect.min.y),
			pos2(boundary(index + 1), rect.max.y),
		);
		let mut child = ui.new_child(egui::UiBuilder::new().max_rect(pane_rect));
		pane_region(&mut child, shell, pane);
	}
	for index in 1..count {
		// Half-point offset: a 1 pt stroke centred on a whole point smears
		// across two pixels, which is the heavy bar this replaced. At +0.5 it
		// lands exactly on one pixel column, like the columns' own hairlines.
		let x = boundary(index) + 0.5;
		ui.painter().line_segment(
			[pos2(x, rect.min.y), pos2(x, rect.max.y)],
			Stroke::new(1.0_f32, theme::BORDER),
		);
	}
}

fn pane_region(ui: &mut Ui, shell: &mut Shell, pane: &Pane) {
	// A click anywhere on the pane focuses it: the focused pane is where the
	// keyboard types, and its live terminal receives the keys.
	let focus =
		ui.interact(ui.max_rect(), ui.id().with(("pane-focus", pane.id.as_str())), Sense::click());
	if focus.clicked() {
		shell.state.tui_pane = Some(pane.id.clone());
	}
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	let strip = Rect::from_min_size(rect.min, vec2(rect.width(), theme::TABSTRIP_H));
	let body = Rect::from_min_max(pos2(rect.min.x, strip.max.y), rect.max);
	session_strip(ui, shell, pane, strip);
	let mut child = ui.new_child(egui::UiBuilder::new().max_rect(body));
	pane_body(&mut child, shell, pane);
}

/// One pane's session-tab strip: the tabs, their ✕, ＋ and the pane's ✕.
fn session_strip(ui: &mut Ui, shell: &mut Shell, pane: &Pane, strip: Rect) {
	ui.painter()
		.rect_filled(strip, CornerRadius::ZERO, theme::PANEL_2);
	ui.painter().line_segment(
		[pos2(strip.min.x, strip.max.y - 0.5), pos2(strip.max.x, strip.max.y - 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let mut x = strip.min.x + 6.0;
	let reserved = 60.0;
	for tab in &pane.tabs {
		let icon = match tab.kind {
			SessionKind::Term => Icon::Term,
			SessionKind::Editor => Icon::Code,
			SessionKind::Diff => Icon::Diff,
			SessionKind::Git => Icon::GitBranch,
			SessionKind::Ide => Icon::Term,
			SessionKind::Agent => Icon::History,
		};
		let is_active = tab.id == pane.active;
		let text_width = (display_cols(&tab.title) as f32 * 7.2).min(120.0);
		let width = text_width + 46.0;
		if x + width > strip.max.x - reserved {
			break;
		}
		let tab_rect = Rect::from_min_size(pos2(x, strip.min.y + 3.5), vec2(width, 28.0));
		let close = Rect::from_min_size(
			pos2(tab_rect.max.x - 20.0, tab_rect.center().y - 8.0),
			vec2(16.0, 16.0),
		);
		let response = ui.interact(tab_rect, ui.id().with(("stab", &tab.id)), Sense::click());
		let close_response =
			ui.interact(close, ui.id().with(("stab-close", &tab.id)), Sense::click());
		if is_active {
			ui.painter()
				.rect_filled(tab_rect, CornerRadius::same(theme::R_CONTROL), theme::GROUND);
			ui.painter().rect_stroke(
				tab_rect,
				CornerRadius::same(theme::R_CONTROL),
				Stroke::new(1.0_f32, theme::BORDER),
				egui::StrokeKind::Inside,
			);
		} else if response.hovered() {
			ui.painter()
				.rect_filled(tab_rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
		}
		let ink = if is_active {
			theme::TEXT
		} else {
			theme::TEXT_3
		};
		paint(
			ui.painter(),
			icon,
			Rect::from_center_size(
				pos2(tab_rect.min.x + 9.0 + 7.0, tab_rect.center().y),
				vec2(14.0, 14.0),
			),
			if is_active {
				theme::ACCENT_2
			} else {
				theme::TEXT_3
			},
			1.5,
		);
		truncated_text(
			ui,
			pos2(tab_rect.min.x + 9.0 + 14.0 + 6.0, tab_rect.center().y),
			&tab.title,
			12.0,
			ink,
			text_width,
		);
		let close_ink = if close_response.hovered() {
			theme::TEXT
		} else {
			theme::TEXT_3
		};
		if close_response.hovered() {
			ui.painter()
				.rect_filled(close, CornerRadius::same(3), theme::PANEL_4);
		}
		paint(ui.painter(), Icon::X, close.shrink(2.5), close_ink, 1.3);
		if close_response.clicked() {
			let (pane_id, tab_id) = (pane.id.clone(), tab.id.clone());
			shell.state.act(|s| s.close_tab(&pane_id, &tab_id));
		} else if response.clicked() {
			let (pane_id, tab_id) = (pane.id.clone(), tab.id.clone());
			shell.state.select_tab(&pane_id, &tab_id);
		}
		x += width + 2.0;
	}
	let plus = Rect::from_center_size(pos2(strip.max.x - 46.0, strip.center().y), vec2(28.0, 28.0));
	let mut plus_ui = ui.new_child(egui::UiBuilder::new().max_rect(plus));
	if icon_button(&mut plus_ui, Icon::Plus, 28.0, false, "新建标签页").clicked() {
		shell.open_picker(PickerTarget::Pane(pane.id.clone()), plus);
	}
	let close_pane =
		Rect::from_center_size(pos2(strip.max.x - 18.0, strip.center().y), vec2(28.0, 28.0));
	let mut close_ui = ui.new_child(egui::UiBuilder::new().max_rect(close_pane));
	if icon_button(&mut close_ui, Icon::X, 28.0, false, "关闭面板").clicked() {
		let pane_id = pane.id.clone();
		shell.state.act(|s| s.close_pane(&pane_id));
	}
}

/// The active session tab's body.
///
/// 终端 is a real grid over either PTY backend (serve's, reached over the
/// gateway WebSocket, with this process's own PTY as the unreachable-serve
/// fallback), and the other four pages are the GUI's own, reading real data:
/// the editor opens and writes real files, the diff page renders a real
/// `git diff`, the git page renders the same snapshot the right column's Git
/// panel does, and the zetaide page says what still has to be linked before it
/// can host the termide panel editor.
fn pane_body(ui: &mut Ui, shell: &mut Shell, pane: &Pane) {
	let Some(tab) = pane.active_tab() else {
		return;
	};
	let tab = tab.clone();
	match tab.kind {
		SessionKind::Term => term_body(ui, shell, pane, &tab, seed::TermKind::of(&tab.id)),
		SessionKind::Editor => editor_body(ui, shell, pane, &tab),
		SessionKind::Diff => diff_body(ui, shell, pane),
		SessionKind::Git => crate::right::git_panel(ui, shell, pane.id.as_str()),
		SessionKind::Ide => ide_body(ui, shell, &tab),
		SessionKind::Agent => agent_body(ui, shell, &tab),
	}
}

/// A terminal pane: the `.termsub` chip row over a blitted ratatui buffer.
fn term_body(ui: &mut Ui, shell: &mut Shell, pane: &Pane, tab: &SessionTab, kind: seed::TermKind) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::TERM_BG);
	let sub = Rect::from_min_size(rect.min, vec2(rect.width(), 30.0));
	ui.painter()
		.rect_filled(sub, CornerRadius::ZERO, theme::TERM_SUB_BG);
	ui.painter().line_segment(
		[pos2(sub.min.x, sub.max.y - 0.5), pos2(sub.max.x, sub.max.y - 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	// The sub-chips are this pane's terminal sessions: clicking one switches
	// the session tab, and ＋ opens another — the same actions as the strip
	// above, which is what the spec's `.termsub` is for.
	let mut chips = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(sub.shrink2(vec2(8.0, 5.0)))
			.layout(Layout::left_to_right(Align::Center)),
	);
	for session in pane.tabs.iter().filter(|t| t.kind == SessionKind::Term) {
		let active = session.id == tab.id;
		let label = format!("终端 {}", session.title.trim_start_matches("终端 "));
		let response = chip(&mut chips, &label, if active { Chip::Active } else { Chip::Plain });
		if response.clicked() && !active {
			shell.state.select_tab(&pane.id, &session.id);
		}
	}
	let mut add = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_min_size(pos2(sub.max.x - 30.0, sub.min.y + 5.0), vec2(20.0, 20.0))),
	);
	if icon_button(&mut add, Icon::Plus, 20.0, false, "新建终端会话").clicked() {
		let pane_id = pane.id.clone();
		shell.state.act(|s| s.add_tab(&pane_id));
	}

	let grid = Rect::from_min_max(pos2(rect.min.x, sub.max.y), rect.max);
	// The backend line is the pane's own status line: which PTY is behind the
	// grid, and, on a fallback, the one reason serve could not be used.
	let status_h = if grid.height() > crate::terminal_service::STATUS_HEIGHT + 32.0 {
		crate::terminal_service::STATUS_HEIGHT
	} else {
		0.0
	};
	let term_grid =
		Rect::from_min_max(grid.min, pos2(grid.max.x, (grid.max.y - status_h).max(grid.min.y)));
	let metrics =
		GridMetrics::for_panel(ui.ctx(), term_grid, f32::from(shell.settings.terminal_size));
	let columns = metrics.cols.max(1);
	let path = shell
		.state
		.active_workspace()
		.map(|ws| ws.path.clone())
		.unwrap_or_default();
	let branch = shell.state.branch_label().to_owned();
	let shell_name = tab.shell.map(|kind| kind.label().to_owned());
	// A serve-backed PTY replaces the seeded transcript when the gateway is
	// reachable; otherwise the in-process PTY below does. `ensure` picks once
	// per tab, so a mid-stream failure moves it to `Local` permanently.
	let rows = metrics.rows.max(1);
	let cwd = shell
		.state
		.active_workspace()
		.map(|ws| std::path::PathBuf::from(&ws.path));
	// A headless shell (`Shell::with_state`, every test) must not dial a live
	// gateway: only a real run may own a serve attach.
	let origin = if shell.probe {
		shell
			.stats
			.info
			.as_ref()
			.and_then(|info| info.web_url.clone())
	} else {
		None
	};
	shell
		.terminals
		.ensure(tab.id.as_str(), origin.as_deref(), cwd.clone(), columns, rows);
	// A project's `+` opens a zetacode pane: once the backend exists, type the
	// command into it at the workspace path. The serve backend queues it on the
	// socket; the local PTY below sends it after its spawn.
	if let Some(command) = tab.command.as_deref() {
		if !shell.launched_commands.contains(&tab.id) && !shell.terminals.is_local(&tab.id) {
			let line = format!("{command}\r");
			if shell.terminals.send_bytes(&tab.id, line.as_bytes()) {
				shell.launched_commands.insert(tab.id.clone());
			}
		}
	}
	let status = shell
		.terminals
		.label(tab.id.as_str())
		.unwrap_or_else(|| "后端：本地 PTY".to_owned());
	let area = ratatui::layout::Rect::new(0, 0, columns, rows);
	let mut grid_buf = ratatui::buffer::Buffer::empty(area);
	if shell.terminals.render(tab.id.as_str(), area, &mut grid_buf) {
		paint_terminal_grid(ui, &metrics, columns, rows, &grid_buf);
		paint_terminal_status(ui, grid, &status);
		return;
	}
	// The serve tab fell back: today's in-process PTY takes the same grid.
	if shell.terminals.is_local(tab.id.as_str())
		&& shell.live.ensure(tab.id.as_str(), columns, rows, cwd)
	{
		if let Some(command) = tab.command.as_deref() {
			if !shell.launched_commands.contains(&tab.id) {
				shell
					.live
					.send_text(tab.id.as_str(), &format!("{command}\r"));
				shell.launched_commands.insert(tab.id.clone());
			}
		}
		let mut grid_buf = ratatui::buffer::Buffer::empty(area);
		if shell.live.render(tab.id.as_str(), area, &mut grid_buf) {
			paint_terminal_grid(ui, &metrics, columns, rows, &grid_buf);
			paint_terminal_status(ui, grid, &status);
			return;
		}
	}
	// The banner (which an unstarted terminal page owes the user) adds three
	// lines, plus one more when the page names a shell.
	let banner_rows = 3 + usize::from(shell_name.is_some());
	let lines = seed::transcript(kind, &path, &branch).len() + banner_rows;
	let rows = (lines as u16 + 1).max(metrics.rows);
	let key = format!("{}|{columns}x{rows}|{:?}|{:?}", tab.id, kind, tab.shell);
	let paint_settings = shell.settings;
	let buffer = shell.term_buffers.get_or_render(key, || {
		seed::term_buffer(columns, rows, kind, &path, &branch, shell_name.as_deref())
	});
	// One id per session tab: two panes rendering the same widget from the same
	// call site would otherwise share one scroll state (and egui warns about the
	// second use of the id).
	egui::ScrollArea::vertical()
		.id_salt(("zetawork-term", tab.id.as_str()))
		.auto_shrink([false, false])
		.show(ui, |ui| {
			let size = vec2(f32::from(columns) * metrics.cell_w, f32::from(rows) * metrics.cell_h);
			let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
			let metrics = GridMetrics {
				origin: rect.min,
				font: metrics.font.clone(),
				cell_w: metrics.cell_w,
				cell_h: metrics.cell_h,
				cols: columns,
				rows,
				font_size: metrics.font_size,
			};
			paint_buffer_with(ui.painter(), buffer, &metrics, theme::TERM_TEXT);
			// The cursor sits on the sample's last prompt line, drawn in the style
			// the 设置 modal picked.
			let last = (lines as u16).saturating_sub(1);
			paint_cursor(
				ui.painter(),
				&metrics,
				ratatui::layout::Position { x: 2, y: last },
				paint_settings.cursor,
			);
		});
	paint_terminal_status(ui, grid, &status);
}

/// Paint one rendered terminal grid into the pane and return nothing: the
/// caller has already reserved the area.
fn paint_terminal_grid(
	ui: &mut Ui,
	metrics: &GridMetrics,
	columns: u16,
	rows: u16,
	buf: &ratatui::buffer::Buffer,
) {
	let size = vec2(f32::from(columns) * metrics.cell_w, f32::from(rows) * metrics.cell_h);
	let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
	let grid = GridMetrics {
		origin: rect.min,
		font: metrics.font.clone(),
		cell_w: metrics.cell_w,
		cell_h: metrics.cell_h,
		cols: columns,
		rows,
		font_size: metrics.font_size,
	};
	paint_buffer_with(ui.painter(), buf, &grid, theme::TERM_TEXT);
}

/// The pane's backend line, at the bottom of the terminal body.
///
/// One line, clipped to the pane: the label is already short, but a legacy
/// reason or a narrow pane still has to end in an ellipsis at the pane's own
/// right edge rather than run under the next one.
fn paint_terminal_status(ui: &Ui, area: Rect, status: &str) {
	if area.height() <= crate::terminal_service::STATUS_HEIGHT + 32.0 {
		return;
	}
	let y = area.max.y - crate::terminal_service::STATUS_HEIGHT / 2.0;
	truncated_mono(ui, pos2(area.min.x + 8.0, y), status, 11.0, theme::TEXT_3, area.width() - 16.0);
}

/// An 编辑器 page: a real file, editable in place and saved to disk.
///
/// The buffer is the file's text; Ctrl+S (or the footer's 保存) writes it back
/// through [`crate::state::EditorDoc::save`]. The gutter numbers come from the
/// text layout itself — one number per visual line, continuation rows of a
/// wrapped line sharing their line's number — so 自动换行 and 显示行号 agree even
/// when a long line breaks.
fn editor_body(ui: &mut Ui, shell: &mut Shell, pane: &Pane, tab: &SessionTab) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	let etabs = Rect::from_min_size(rect.min, vec2(rect.width(), 34.0));
	ui.painter()
		.rect_filled(etabs, CornerRadius::ZERO, theme::PANEL_2);
	ui.painter().line_segment(
		[pos2(etabs.min.x, etabs.max.y - 0.5), pos2(etabs.max.x, etabs.max.y - 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let head = tab
		.doc
		.as_ref()
		.map(|doc| {
			if doc.dirty {
				format!("{} · {}（未保存）", doc.name(), doc.path.display())
			} else {
				format!("{} · {}", doc.name(), doc.path.display())
			}
		})
		.unwrap_or_else(|| "未打开文件".to_owned());
	let dirty = tab.doc.as_ref().is_some_and(|doc| doc.dirty);
	truncated_mono(
		ui,
		pos2(etabs.min.x + 10.0, etabs.center().y),
		&head,
		11.0,
		if dirty { theme::WARN } else { theme::TEXT_3 },
		etabs.width() - 130.0,
	);
	let foot = Rect::from_min_size(pos2(rect.min.x, rect.max.y - 24.0), vec2(rect.width(), 24.0));
	let code = Rect::from_min_max(pos2(rect.min.x, etabs.max.y), pos2(rect.max.x, foot.min.y));
	let settings = shell.settings;
	let size = f32::from(settings.editor_size);
	let font = crate::fonts::editor_font_for(ui.ctx(), size);
	let widget_font = font.clone();
	let gutter = if settings.editor_line_numbers {
		46.0
	} else {
		0.0
	};
	let (pane_id, tab_id) = (pane.id.clone(), tab.id.clone());

	let Some(doc) = shell.state.doc_mut(&pane_id, &tab_id) else {
		empty_note(ui, "这个编辑器标签页没有打开文件", "右栏 文件树 里点一个文件，或 ＋ 里选 编辑器");
		return;
	};
	// Split borrows: the text buffer goes to the widget, the flags stay here.
	let EditorDoc { text, dirty, .. } = doc;
	let text_rect = Rect::from_min_max(pos2(code.min.x + gutter, code.min.y), code.max);
	let mut text_ui = ui.new_child(egui::UiBuilder::new().max_rect(text_rect.shrink(6.0)));
	let wrap = settings.editor_wrap;
	let mut layouter = move |ui: &egui::Ui, buffer: &dyn egui::TextBuffer, wrap_width: f32| {
		let job = egui::text::LayoutJob::simple(
			buffer.as_str().to_owned(),
			font.clone(),
			theme::TEXT,
			if wrap { wrap_width } else { f32::INFINITY },
		);
		ui.painter().layout_job(job)
	};
	let output = egui::TextEdit::multiline(text)
		.id(egui::Id::new(("zetawork-editor", &tab_id)))
		.font(widget_font)
		.text_color(theme::TEXT)
		.code_editor()
		.frame(false)
		.desired_width(text_ui.available_width())
		.desired_rows(24)
		.lock_focus(true)
		.layouter(&mut layouter)
		.show(&mut text_ui);
	let changed = output.response.changed();
	let cursor_index = output.cursor_range.map(|range| range.primary.index);
	// The gutter, drawn where the text itself was placed.
	if gutter > 0.0 {
		let painter = ui.painter().with_clip_rect(code.shrink(2.0));
		let number_font = crate::fonts::editor_font_for(ui.ctx(), size - 1.0);
		let mut number = 1usize;
		for placed in output.galley.rows.iter() {
			let row_top = output.galley_pos.y + placed.pos.y;
			let row =
				egui::Rect::from_min_size(pos2(code.min.x, row_top), vec2(gutter, placed.row.size.y));
			if row.max.y >= code.min.y && row.min.y <= code.max.y {
				painter.text(
					pos2(code.min.x + gutter - 8.0, row.center().y),
					egui::Align2::RIGHT_CENTER,
					number.to_string(),
					number_font.clone(),
					theme::GUTTER,
				);
			}
			if placed.ends_with_newline {
				number += 1;
			}
		}
	}
	if changed {
		*dirty = true;
	}
	// The footer's cursor position, read from the text edit's own cursor.
	let line_col = cursor_index.map(|index| line_col_of(text, index));
	let lines = text.lines().count().max(1);

	ui.painter()
		.rect_filled(foot, CornerRadius::ZERO, theme::PANEL_2);
	ui.painter().line_segment(
		[pos2(foot.min.x, foot.min.y + 0.5), pos2(foot.max.x, foot.min.y + 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let eol = if text.contains("\r\n") { "CRLF" } else { "LF" };
	let language = doc
		.path
		.extension()
		.map(|ext| ext.to_string_lossy().to_lowercase())
		.map(|ext| language_label(&ext))
		.unwrap_or("Text");
	let position = match line_col {
		Some((line, column)) => format!("行 {line}, 列 {column}"),
		None => format!("{lines} 行"),
	};
	let mut x = foot.min.x + 12.0;
	for label in [language, "UTF-8", eol, position.as_str()] {
		let galley = ui.painter().layout_no_wrap(
			label.to_owned(),
			egui::FontId::new(11.0, egui::FontFamily::Monospace),
			if *dirty { theme::WARN } else { theme::TEXT_3 },
		);
		ui.painter().galley(
			pos2(x, foot.center().y - galley.size().y / 2.0),
			galley.clone(),
			theme::TEXT_3,
		);
		x += galley.size().x + 18.0;
	}
	ui.painter().text(
		pos2(foot.max.x - 12.0, foot.center().y),
		egui::Align2::RIGHT_CENTER,
		format!("{size:.0}px"),
		egui::FontId::new(11.0, egui::FontFamily::Monospace),
		theme::TEXT_3,
	);
}

/// The one-based line and column of a character index in `text`.
fn line_col_of(text: &str, index: usize) -> (usize, usize) {
	let mut line = 1usize;
	let mut column = 1usize;
	for (offset, ch) in text.chars().enumerate() {
		if offset >= index {
			break;
		}
		if ch == '\n' {
			line += 1;
			column = 1;
		} else {
			column += 1;
		}
	}
	(line, column)
}

/// The footer's language label, from the file's extension.
fn language_label(extension: &str) -> &'static str {
	match extension {
		"rs" => "Rust",
		"ts" | "tsx" => "TypeScript",
		"js" | "jsx" | "mjs" | "cjs" => "JavaScript",
		"json" => "JSON",
		"toml" => "TOML",
		"yml" | "yaml" => "YAML",
		"md" => "Markdown",
		"sh" | "bash" => "Shell",
		"ps1" => "PowerShell",
		"py" => "Python",
		"go" => "Go",
		"css" => "CSS",
		"html" | "htm" => "HTML",
		_ => "Text",
	}
}

/// The spec's `hl()`: comments, strings, numbers, keywords, identifiers.
///
/// The spec does it with one regex; the same split is done here in two passes
/// (cut a trailing `//` comment, then walk the code with a string-state
/// machine) so the result is a list of coloured spans without pulling a regex
/// engine in.
///
/// Nothing calls this yet: the 编辑器 page edits a real buffer through
/// [`egui::TextEdit`], and colouring it would mean rebuilding a layout job for
/// the whole file every frame. It stays for the read-only code views (the IDE
/// page and the diff page's context lines) that want the spec's palette.
#[allow(dead_code)]
fn highlight(line: &str, default_ink: Color32) -> Vec<(String, Color32)> {
	use crate::theme::syntax;
	let (code, comment) = split_comment(line);
	let mut spans: Vec<(String, Color32)> = Vec::new();
	let mut word = String::new();
	let mut string: Option<char> = None;
	let flush = |word: &mut String, spans: &mut Vec<(String, Color32)>| {
		if word.is_empty() {
			return;
		}
		let color = if seed::KEYWORDS.contains(&word.as_str()) {
			syntax::KEYWORD
		} else if word.chars().all(|ch| ch.is_ascii_digit() || ch == '_') {
			syntax::NUMBER
		} else {
			syntax::IDENT
		};
		spans.push((std::mem::take(word), color));
	};
	for ch in code.chars() {
		if let Some(quote) = string {
			word.push(ch);
			if ch == quote {
				string = None;
				spans.push((std::mem::take(&mut word), syntax::STRING));
			}
			continue;
		}
		match ch {
			'"' | '\'' => {
				flush(&mut word, &mut spans);
				string = Some(ch);
				word.push(ch);
			},
			ch if ch.is_alphanumeric() || ch == '_' => word.push(ch),
			ch => {
				flush(&mut word, &mut spans);
				spans.push((ch.to_string(), default_ink));
			},
		}
	}
	flush(&mut word, &mut spans);
	if !comment.is_empty() {
		spans.push((comment, syntax::COMMENT));
	}
	spans
}

/// `line` split at the first `//` that is not inside a string literal.
fn split_comment(line: &str) -> (String, String) {
	let chars: Vec<char> = line.chars().collect();
	let mut string: Option<char> = None;
	let mut index = 0;
	while index < chars.len() {
		let ch = chars[index];
		if let Some(quote) = string {
			if ch == '\\' {
				index += 1;
			} else if ch == quote {
				string = None;
			}
		} else if ch == '"' || ch == '\'' {
			string = Some(ch);
		} else if ch == '/' && chars.get(index + 1) == Some(&'/') {
			let code: String = chars[..index].iter().collect();
			let comment: String = chars[index..].iter().collect();
			return (code, comment);
		}
		index += 1;
	}
	(line.to_owned(), String::new())
}

/// A 差异比较器 page: the active workspace's real `git diff`, read-only.
///
/// The rows come straight from the cached diff text (no per-frame row list):
/// [`crate::git::classify_line`] decides each line's kind as it is drawn. With
/// no repository, or with `git` refusing, the page says so instead of drawing
/// an empty diff.
fn diff_body(ui: &mut Ui, shell: &mut Shell, pane: &Pane) {
	shell.ensure_diff();
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::TERM_BG);
	let _ = pane;
	let header = Rect::from_min_size(rect.min, vec2(rect.width(), 26.0));
	ui.painter()
		.rect_filled(header, CornerRadius::ZERO, theme::TERM_SUB_BG);
	ui.painter().line_segment(
		[pos2(header.min.x, header.max.y - 0.5), pos2(header.max.x, header.max.y - 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let path = shell
		.state
		.active_workspace()
		.map(|ws| ws.path.clone())
		.unwrap_or_default();
	truncated_mono(
		ui,
		pos2(header.min.x + 10.0, header.center().y),
		&format!("git diff --no-color HEAD · {path}"),
		11.0,
		theme::TEXT_3,
		header.width() - 20.0,
	);
	let body = Rect::from_min_max(pos2(rect.min.x, header.max.y), rect.max);
	let result = shell.diff_result();
	let Some(result) = result else {
		let mut child = ui.new_child(egui::UiBuilder::new().max_rect(body.shrink(10.0)));
		empty_note(&mut child, "先打开一个工作区", "工作区目录里的 git 仓库");
		return;
	};
	let text = match result {
		Ok(text) if text.trim().is_empty() => {
			let mut child = ui.new_child(egui::UiBuilder::new().max_rect(body.shrink(10.0)));
			empty_note(&mut child, "与 HEAD 没有差异", "git diff --no-color HEAD（只读）");
			return;
		},
		Ok(text) => text,
		Err(error) => {
			let mut child = ui.new_child(egui::UiBuilder::new().max_rect(body.shrink(10.0)));
			empty_note(&mut child, &format!("无法读取 git diff：{error}"), "工作区目录里的 git 仓库");
			return;
		},
	};
	let mut body_ui = ui.new_child(egui::UiBuilder::new().max_rect(body));
	egui::ScrollArea::both()
		.id_salt(("zetawork-diff", pane.id.as_str()))
		.auto_shrink([false, false])
		.show(&mut body_ui, |ui| {
			ui.spacing_mut().item_spacing.y = 0.0;
			let width = ui.available_width().max(600.0);
			for line in text.lines() {
				let Some(kind) = crate::git::classify_line(line) else {
					continue;
				};
				let (rect, _) = ui.allocate_exact_size(vec2(width, DIFF_ROW_H), Sense::hover());
				diff_row(ui, rect, kind, line);
			}
		});
}

/// Height of one diff row.
const DIFF_ROW_H: f32 = 20.0;

/// One diff row: its sign, its colour and, for a header, the file it names.
fn diff_row(ui: &Ui, row: Rect, kind: DiffKind, line: &str) {
	let (sign, ink, background) = match kind {
		DiffKind::Header => ('≡', theme::TEXT, Some(theme::PANEL_2)),
		DiffKind::Hunk => ('@', theme::ACCENT_2, Some(theme::ACCENT.gamma_multiply(0.08))),
		DiffKind::Add => {
			('+', Color32::from_rgb(0xa9, 0xe6, 0xb4), Some(theme::ADD.gamma_multiply(0.09)))
		},
		DiffKind::Del => {
			('-', Color32::from_rgb(0xf0, 0xb6, 0xb2), Some(theme::DEL.gamma_multiply(0.09)))
		},
		DiffKind::Context => (' ', Color32::from_rgb(0x9a, 0xa3, 0xb0), None),
	};
	if let Some(fill) = background {
		ui.painter().rect_filled(row, CornerRadius::ZERO, fill);
	}
	let font = crate::fonts::editor_font_for(ui.ctx(), theme::MONO_SIZE);
	ui.painter().text(
		pos2(row.min.x + 12.0, row.center().y),
		egui::Align2::LEFT_CENTER,
		sign.to_string(),
		font.clone(),
		theme::GUTTER,
	);
	let text = if kind == DiffKind::Header {
		format!("── {} ──", line.trim_start_matches("+++ ").trim())
	} else {
		line.to_owned()
	};
	let galley = ui.painter().layout_no_wrap(text, font, ink);
	ui.painter()
		.galley(pos2(row.min.x + 28.0, row.center().y - galley.size().y / 2.0), galley, ink);
}

/// An Agent 会话 page: the gateway session id, its busy state, the last
/// `extension_ui_request` and the transcript the reducer built.
///
/// The page is a **viewer**: it never writes to the session, and the PTY path
/// is untouched. The connection is opened from here, but the dial happens on
/// the SSE reader's thread, so a serve that is down is reported in the body
/// instead of freezing the frame.
fn agent_body(ui: &mut Ui, shell: &mut Shell, tab: &SessionTab) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::PANEL);
	let head = Rect::from_min_size(rect.min, vec2(rect.width(), 34.0));
	ui.painter()
		.rect_filled(head, CornerRadius::ZERO, theme::PANEL_2);
	ui.painter().line_segment(
		[pos2(head.min.x, head.max.y - 0.5), pos2(head.max.x, head.max.y - 0.5)],
		Stroke::new(1.0_f32, theme::BORDER),
	);
	let origin = shell.stats.origin().to_owned();
	let pane = shell.agents.ensure(&tab.id);
	let title = match pane.session.as_deref() {
		Some(session) => format!("Agent · {session}"),
		None => "Agent 会话".to_owned(),
	};
	truncated_mono(
		ui,
		pos2(head.min.x + 10.0, head.center().y),
		&title,
		11.0,
		theme::ACCENT_2,
		head.width() - 200.0,
	);
	let (status, ink) = match &pane.link {
		Link::Live if pane.view.running => ("running".to_owned(), theme::ADD),
		Link::Live => ("not-running".to_owned(), theme::TEXT_3),
		Link::Connecting => (pane.link.label().to_owned(), theme::WARN),
		Link::Failed(_) => (pane.link.label().to_owned(), theme::DEL),
		Link::Detached | Link::Ended => (pane.link.label().to_owned(), theme::TEXT_3),
	};
	ui.painter().text(
		pos2(head.max.x - 10.0, head.center().y),
		egui::Align2::RIGHT_CENTER,
		status,
		egui::FontId::new(11.0, egui::FontFamily::Monospace),
		ink,
	);

	let body = Rect::from_min_max(pos2(rect.min.x, head.max.y), rect.max);
	let mut child = ui.new_child(egui::UiBuilder::new().max_rect(body.shrink(12.0)));
	child.spacing_mut().item_spacing = vec2(8.0, 6.0);

	// The session id is user-supplied: the gateway knows it, this shell does
	// not guess it.
	child.horizontal(|ui| {
		ui.label(egui::RichText::new("会话 id").color(theme::TEXT_3));
		ui.add(
			egui::TextEdit::singleline(&mut pane.draft)
				.desired_width(260.0)
				.font(egui::FontId::new(11.5, egui::FontFamily::Monospace))
				.hint_text("agent session id"),
		);
		if ui.button("连接").clicked() {
			let draft = pane.draft.clone();
			let _ = pane.connect(&origin, &draft);
		}
		if matches!(pane.link, Link::Live | Link::Connecting) && ui.button("断开").clicked() {
			pane.disconnect();
		}
	});

	if let Some(reason) = pane.error.as_deref() {
		let ink = if matches!(pane.link, Link::Failed(_)) {
			theme::DEL
		} else {
			theme::TEXT_3
		};
		child.label(egui::RichText::new(format!("原因：{reason}")).color(ink));
	}

	if pane.session.is_none() {
		empty_note(&mut child, "尚未连接 agent 会话", EMPTY_HINT);
		return;
	}

	if let Some(summary) = pane.request_summary() {
		let (label, ink) = if pane.awaiting_input() {
			("等待你的输入", theme::WARN)
		} else {
			("最近一次请求", theme::TEXT_2)
		};
		child.horizontal_wrapped(|ui| {
			ui.label(egui::RichText::new(label).color(ink).strong());
			ui.label(egui::RichText::new(summary).color(theme::TEXT_2));
		});
	}

	let rows = &pane.view.rows;
	egui::ScrollArea::vertical()
		.id_salt(("zetawork-agent", tab.id.as_str()))
		.auto_shrink([false, false])
		.show(&mut child, |ui| {
			if rows.is_empty() {
				ui.label(
					egui::RichText::new("还没有会话记录；新的 durable entry 会出现在这里。")
						.color(theme::TEXT_3),
				);
			}
			for row in rows {
				let (prefix, ink) = match row.kind {
					RowKind::User => ("你：", theme::TEXT),
					RowKind::Assistant => ("助手：", theme::TEXT_2),
					RowKind::Tool => ("工具：", theme::TEXT_3),
					RowKind::Error => ("错误：", theme::DEL),
					RowKind::Notice => ("· ", theme::TEXT_3),
				};
				ui.label(
					egui::RichText::new(format!("{prefix}{}", row.text))
						.monospace()
						.color(ink),
				);
			}
		});
}

/// A `zetaide` page. R23 gives the TUI form of the editor to `zetaide` (the
/// termide `panel-editor`); the GUI form is this crate's own 编辑器 page
/// instead, so this page is honest about the piece that is still missing.
/// The IDE page: `termide-panel-ide`, the same `Panel` the TUI mounts.
///
/// The page renders into a ratatui `Buffer` sized to this pane's grid and the
/// cells are blitted — the road the terminal pane already proves.
fn ide_body(ui: &mut Ui, shell: &mut Shell, tab: &SessionTab) {
	let rect = ui.max_rect();
	ui.painter()
		.rect_filled(rect, CornerRadius::ZERO, theme::TERM_BG);
	let metrics = GridMetrics::for_panel(ui.ctx(), rect, f32::from(shell.settings.terminal_size));
	let columns = metrics.cols.max(1);
	let rows = metrics.rows.max(1);
	let area = ratatui::layout::Rect::new(0, 0, columns, rows);
	let mut grid_buf = ratatui::buffer::Buffer::empty(area);
	shell.pages.ensure(tab.id.as_str());
	if !shell.pages.render(tab.id.as_str(), area, &mut grid_buf) {
		return;
	}
	let size = vec2(f32::from(columns) * metrics.cell_w, f32::from(rows) * metrics.cell_h);
	let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
	let grid = GridMetrics {
		origin: rect.min,
		font: metrics.font.clone(),
		cell_w: metrics.cell_w,
		cell_h: metrics.cell_h,
		cols: columns,
		rows,
		font_size: metrics.font_size,
	};
	paint_buffer_with(ui.painter(), &grid_buf, &grid, theme::TERM_TEXT);
}

/// The welcome panel (spec `welcomeHTML`).
fn welcome(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	let centre = rect.center();
	let mark = Rect::from_center_size(pos2(centre.x, centre.y - 130.0), vec2(64.0, 64.0));
	crate::chrome::gradient_mark(ui, mark, "Z");
	ui.painter().text(
		pos2(centre.x, mark.max.y + 18.0),
		egui::Align2::CENTER_CENTER,
		"zetawork",
		egui::FontId::new(26.0, egui::FontFamily::Proportional),
		theme::TEXT,
	);
	ui.painter().text(
		pos2(centre.x, mark.max.y + 46.0),
		egui::Align2::CENTER_CENTER,
		"从侧边栏中选择一个工作区开始",
		egui::FontId::new(13.0, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	let cta_y = mark.max.y + 88.0;
	let mut open_btn = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_center_size(pos2(centre.x - 80.0, cta_y), vec2(140.0, 34.0)))
			.layout(Layout::left_to_right(Align::Center)),
	);
	if wide_button(&mut open_btn, Icon::Plus, "添加项目", false).clicked() {
		shell.state.show(crate::state::Notice(
			"添加项目：项目注册表尚未接入（未来数据源：zetawork 项目注册表）".to_owned(),
		));
	}
	let mut new_btn = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(Rect::from_center_size(pos2(centre.x + 80.0, cta_y), vec2(140.0, 34.0)))
			.layout(Layout::left_to_right(Align::Center)),
	);
	// 创建工作区 is the draft's label for this button, and creating a workspace in
	// the active project is exactly what it can really do. `active_project` on
	// the state is the project's **id**, which is what `new_workspace` takes.
	if wide_button(&mut new_btn, Icon::Plus, "创建工作区", true).clicked() {
		match shell.state.active_project.clone() {
			Some(project) => {
				shell.state.act(|s| s.new_workspace(&project));
			},
			None => {
				shell.state.show(crate::state::Notice(
					"创建工作区：先添加一个项目（项目注册表尚未接入）".to_owned(),
				));
			},
		}
	}
	// The three shortcuts the build really binds; the draft's own list names
	// macOS keys and two moves this shell does not have.
	let shortcuts = [("创建大标签页", "Ctrl N"), ("拆分面板", "Ctrl \\"), ("打开设置", "Ctrl ,")];
	let mut y = cta_y + 44.0;
	for (label, keys) in shortcuts {
		ui.painter().text(
			pos2(centre.x - 190.0, y),
			egui::Align2::LEFT_CENTER,
			label,
			egui::FontId::new(12.5, egui::FontFamily::Proportional),
			theme::TEXT_2,
		);
		let rect = Rect::from_center_size(pos2(centre.x + 160.0, y), vec2(60.0, 20.0));
		ui.painter()
			.rect_filled(rect, CornerRadius::same(5), theme::PANEL_3);
		ui.painter().rect_stroke(
			rect,
			CornerRadius::same(5),
			Stroke::new(1.0_f32, theme::BORDER),
			egui::StrokeKind::Inside,
		);
		ui.painter().text(
			rect.center(),
			egui::Align2::CENTER_CENTER,
			keys,
			egui::FontId::new(11.0, egui::FontFamily::Monospace),
			theme::TEXT_2,
		);
		y += 30.0;
	}
	let line = Rect::from_min_size(pos2(centre.x - 190.0, y - 22.0), vec2(380.0, 1.0));
	ui.painter()
		.line_segment([line.min, pos2(line.max.x, line.min.y)], Stroke::new(1.0_f32, theme::BORDER));
}

/// The welcome panel's `.btn`.
fn wide_button(ui: &mut Ui, icon: Icon, label: &str, primary: bool) -> egui::Response {
	let (rect, response) = ui.allocate_exact_size(vec2(140.0, 34.0), Sense::click());
	let fill = if primary {
		theme::BRAND_A
	} else {
		theme::PANEL_2
	};
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), fill);
	if !primary {
		ui.painter().rect_stroke(
			rect,
			CornerRadius::same(theme::R_CONTROL),
			Stroke::new(1.0_f32, theme::BORDER_2),
			egui::StrokeKind::Inside,
		);
	}
	let ink = if primary { Color32::WHITE } else { theme::TEXT };
	paint(
		ui.painter(),
		icon,
		Rect::from_center_size(pos2(rect.min.x + 14.0 + 7.5, rect.center().y), vec2(15.0, 15.0)),
		ink,
		1.5,
	);
	ui.painter().text(
		pos2(rect.min.x + 14.0 + 15.0 + 8.0, rect.center().y),
		egui::Align2::LEFT_CENTER,
		label,
		egui::FontId::new(13.0, egui::FontFamily::Proportional),
		ink,
	);
	if response.hovered() {
		ui.painter().rect_stroke(
			rect,
			CornerRadius::same(theme::R_CONTROL),
			Stroke::new(1.0_f32, theme::BORDER_2),
			egui::StrokeKind::Inside,
		);
	}
	response
}

/// The buffer cache lives on the shell so a pane does not re-render its sample
/// transcript every frame.
pub type TermBuffers = BufferCache;

/// How many grid columns a string occupies: the *display* width, so a wide CJK
/// glyph counts as two. Every width estimate in the shell goes through this,
/// because `chars().count()` would under-size a Chinese label and let the text
/// after it start on top of it.
pub fn display_cols(text: &str) -> usize {
	unicode_width::UnicodeWidthStr::width(text)
}
