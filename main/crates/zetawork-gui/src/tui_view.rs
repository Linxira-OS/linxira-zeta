//! The TUI view (`#tuiView`): the same state, rendered the way the terminal
//! surface renders it.
//!
//! Three boxes — 项目/工作区 on the left, 终端 宿主 · 大标签页 in the centre, and the
//! 侧栏 with F1 文件 · F2 历史 · F3 Git on the right — over the data in
//! [`crate::state::AppState`], with a status line that starts with 设置.
//!
//! It is drawn through the same ratatui → egui blit the terminal panes use, so
//! the CJK width rule and the cell grid are exercised here too. The boxes are
//! *mouse-clickable*, like the spec's TUI: each clickable row records the cell
//! range it occupies while the buffer is built, and after the blit those ranges
//! become egui hit regions.

use egui::{Rect as ERect, Sense, Ui, pos2, vec2};
use ratatui::buffer::Buffer;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Widget, Wrap};

use unicode_width::UnicodeWidthStr;

use crate::Shell;
use crate::blit::{self, GridMetrics};
use crate::state::{RightTab, ViewMode};

/// How many grid columns a string occupies — the *display* width, so a wide
/// CJK glyph counts as two. Using `chars().count()` here would let the next
/// label start inside the previous wide glyph and overwrite its tail.
fn cols(text: &str) -> u16 {
	UnicodeWidthStr::width(text).min(usize::from(u16::MAX)) as u16
}

/// What a click on a TUI row does.
#[derive(Clone, Debug, PartialEq, Eq)]
enum TuiAction {
	SelectProject(String),
	SelectWorkspace(String),
	FocusPane(String),
	RightTab(RightTab),
	OpenSettings,
	/// The centre box's page switch: 总面板.
	ShowTotal,
	/// The centre box's page switch: the active workspace's pane grid.
	ShowWorkspace,
}

/// A clickable cell range, resolved to pixels after the blit.
struct Hit {
	row: u16,
	col: u16,
	width: u16,
	action: TuiAction,
}

const ACCENT: Color = Color::Rgb(0x5b, 0x8d, 0xef);
const ACCENT_2: Color = Color::Rgb(0x7e, 0xa9, 0xf5);
const TEXT_2: Color = Color::Rgb(0xaa, 0xb2, 0xc0);
const TEXT_3: Color = Color::Rgb(0x8b, 0x93, 0xa1);
const BORDER: Color = Color::Rgb(0x2f, 0x37, 0x42);
const ADD: Color = Color::Rgb(0x3f, 0xb9, 0x50);
const DEL: Color = Color::Rgb(0xf8, 0x51, 0x49);
const CYAN: Color = Color::Rgb(0x39, 0xc5, 0xcf);
const ACTIVE_BG: Color = Color::Rgb(0x22, 0x31, 0x4d);
const ACTIVE_TEXT: Color = Color::Rgb(0xdc, 0xe7, 0xff);
const BOX_BG: Color = Color::Rgb(0x07, 0x0a, 0x0e);
const TERM_BG: Color = Color::Rgb(0x04, 0x06, 0x0a);

/// Render the TUI view into `ui`.
pub fn view(ui: &mut Ui, shell: &mut Shell) {
	let rect = ui.max_rect();
	ui.painter().rect_filled(
		rect,
		egui::CornerRadius::ZERO,
		egui::Color32::from_rgb(0x05, 0x07, 0x0a),
	);
	let metrics = GridMetrics::for_panel(ui.ctx(), rect, 12.5);
	if metrics.cols < 40 || metrics.rows < 10 {
		ui.painter().text(
			rect.center(),
			egui::Align2::CENTER_CENTER,
			"窗口太小，无法渲染 TUI 视图",
			egui::FontId::new(13.0, egui::FontFamily::Proportional),
			egui::Color32::from_rgb(0x8b, 0x93, 0xa1),
		);
		return;
	}
	let (buffer, hits) = build(shell, metrics.cols, metrics.rows);
	blit::paint_buffer(ui, &buffer, &metrics, egui::Color32::from_rgb(0xc8, 0xd0, 0xdb));

	// The clickable rows, now that the grid is painted.
	let mut actions: Vec<TuiAction> = Vec::new();
	for (index, hit) in hits.iter().enumerate() {
		let at = pos2(
			metrics.origin.x + f32::from(hit.col) * metrics.cell_w,
			metrics.origin.y + f32::from(hit.row) * metrics.cell_h,
		);
		let size = vec2(f32::from(hit.width) * metrics.cell_w, metrics.cell_h);
		let response = ui.interact(
			ERect::from_min_size(at, size),
			ui.id().with(("tui-hit", index)),
			Sense::click(),
		);
		if response.clicked() {
			actions.push(hit.action.clone());
		}
	}
	for action in actions {
		match action {
			TuiAction::SelectProject(id) => shell.state.act(|s| s.select_project(&id)),
			TuiAction::SelectWorkspace(id) => shell.state.act(|s| s.select_workspace(&id)),
			TuiAction::FocusPane(id) => shell.state.toggle_tui_pane(&id),
			TuiAction::RightTab(tab) => shell.state.right_tab = tab,
			TuiAction::OpenSettings => shell.state.open_settings(),
			TuiAction::ShowTotal => shell.state.show_total(),
			TuiAction::ShowWorkspace => {
				shell
					.state
					.set_center_page(crate::state::CenterPage::Workspace);
			},
		}
	}
}

/// The whole TUI as a cell grid, plus the clickable rows it produced.
fn build(shell: &Shell, cols: u16, rows: u16) -> (Buffer, Vec<Hit>) {
	let mut hits: Vec<Hit> = Vec::new();
	let mut buf = Buffer::empty(Rect::new(0, 0, cols, rows));
	let area = buf.area;
	// The frame: a top line, the box grid, a status line.
	let [top, grid, status] =
		Layout::vertical([Constraint::Length(2), Constraint::Min(0), Constraint::Length(2)])
			.areas(area);
	let cell_w = 7.5_f32;
	let left_cols = (220.0 / cell_w).round() as u16;
	let right_cols = (268.0 / cell_w).round() as u16;
	let [left, centre, right] = Layout::horizontal([
		Constraint::Length(left_cols),
		Constraint::Min(0),
		Constraint::Length(right_cols),
	])
	.spacing(1)
	.areas(grid);
	top_line(&mut buf, top, shell);
	let left_body = box_frame(&mut buf, left, "项目 / 工作区", None);
	projects_box(&mut buf, left_body, shell, &mut hits);
	// The centre box is the same two pages the GUI's strip switches between,
	// driven by the same `center_page`: 总面板 (what the shell opens on) and the
	// active workspace's pane grid. The title says which one is showing.
	let total = shell.state.center_page == crate::state::CenterPage::Total;
	let centre_title = if total {
		"总面板"
	} else {
		"终端 宿主 · 大标签页"
	};
	let centre_body = box_frame(&mut buf, centre, centre_title, None);
	terminal_box(&mut buf, centre_body, shell, &mut hits);
	let right_body = box_frame(&mut buf, right, "侧栏 文件 · 历史 · Git", None);
	sidebar_box(&mut buf, right_body, shell, &mut hits);
	status_line(&mut buf, status, shell, &mut hits);
	(buf, hits)
}

/// The border around a box, returning its inner area.
fn box_frame(buf: &mut Buffer, area: Rect, title: &str, focused: Option<bool>) -> Rect {
	let border = if focused == Some(true) {
		ACCENT
	} else {
		BORDER
	};
	let block = Block::new()
		.borders(Borders::ALL)
		.border_style(Style::new().fg(border))
		.style(Style::new().bg(BOX_BG))
		.title_top(Line::from(vec![
			Span::styled(" ", Style::new()),
			Span::styled(title.to_owned(), Style::new().fg(TEXT_3).add_modifier(Modifier::BOLD)),
			Span::styled(" ", Style::new()),
		]));
	let inner = block.inner(area);
	block.render(area, buf);
	inner
}

fn top_line(buf: &mut Buffer, area: Rect, shell: &Shell) {
	buf.set_style(area, Style::new().bg(BOX_BG));
	let row = area.y;
	let mut spans = vec![
		Span::styled(" zetawork ", Style::new().fg(ACCENT_2).add_modifier(Modifier::BOLD)),
		Span::styled(
			format!(" {} · {} ", shell.state.workspace_label(), shell.state.branch_label()),
			Style::new().fg(TEXT_2),
		),
	];
	let hints = "鼠标可直接点选 · Tab 切换面板 · q 退出";
	let used = cols(
		&spans
			.iter()
			.map(|span| span.content.as_ref())
			.collect::<String>(),
	) as usize;
	if (area.width as usize) > used + hints.chars().count() + 2 {
		let pad = area.width as usize - used - hints.chars().count() - 2;
		spans.push(Span::styled(" ".repeat(pad), Style::new()));
		spans.push(Span::styled(hints.to_owned(), Style::new().fg(TEXT_3)));
	}
	Paragraph::new(Line::from(spans))
		.render(Rect { x: area.x, y: row, width: area.width, height: 1 }, buf);
}

/// 项目 / 工作区 — projects, and the active project's workspaces.
fn projects_box(buf: &mut Buffer, area: Rect, shell: &Shell, hits: &mut Vec<Hit>) {
	buf.set_style(area, Style::new().bg(BOX_BG));
	let mut row = area.y;
	for (index, project) in shell.state.projects.iter().enumerate() {
		if row >= area.bottom() {
			break;
		}
		let active = shell.state.active_project.as_deref() == Some(project.id.as_str());
		let line = Line::from(vec![
			Span::styled(if active { "▾ " } else { "▸ " }, Style::new().fg(TEXT_3)),
			Span::styled(
				project.name.clone(),
				Style::new().fg(if active { ACTIVE_TEXT } else { TEXT_2 }),
			),
			Span::styled(format!("  {}", project.workspaces.len()), Style::new().fg(CYAN)),
		]);
		let style = if active {
			Style::new().bg(ACTIVE_BG)
		} else {
			Style::new()
		};
		Paragraph::new(line)
			.style(style)
			.render(Rect { x: area.x, y: row, width: area.width, height: 1 }, buf);
		hits.push(Hit {
			row,
			col: area.x,
			width: area.width,
			action: TuiAction::SelectProject(project.id.clone()),
		});
		row += 1;
		if !active {
			continue;
		}
		for workspace in &project.workspaces {
			if row >= area.bottom() {
				break;
			}
			let is_open = shell.state.active_workspace.as_deref() == Some(workspace.id.as_str());
			let line = Line::from(vec![
				Span::styled("    ▸ ", Style::new().fg(TEXT_3)),
				Span::styled(
					workspace.name.clone(),
					Style::new().fg(if is_open { ACTIVE_TEXT } else { TEXT_2 }),
				),
				Span::styled(format!("  {}", workspace.branch), Style::new().fg(CYAN)),
			]);
			let style = if is_open {
				Style::new().bg(ACTIVE_BG)
			} else {
				Style::new()
			};
			Paragraph::new(line)
				.style(style)
				.render(Rect { x: area.x, y: row, width: area.width, height: 1 }, buf);
			hits.push(Hit {
				row,
				col: area.x,
				width: area.width,
				action: TuiAction::SelectWorkspace(workspace.id.clone()),
			});
			row += 1;
		}
		let _ = index;
	}
}

/// 终端 宿主 · 大标签页 — the workspace tabs, the split terminals, the hints row.
fn terminal_box(buf: &mut Buffer, area: Rect, shell: &Shell, hits: &mut Vec<Hit>) {
	buf.set_style(area, Style::new().bg(BOX_BG));
	let [tabs, split, bottom] =
		Layout::vertical([Constraint::Length(2), Constraint::Min(0), Constraint::Length(1)])
			.areas(area);
	buf.set_style(tabs, Style::new().bg(BOX_BG));
	buf.set_style(bottom, Style::new().bg(BOX_BG));
	// 总面板 is a page of this one box, not a box of its own: it takes the whole
	// body and leaves the page switch below it.
	if shell.state.center_page == crate::state::CenterPage::Total {
		let body = Rect {
			x: area.x,
			y: tabs.y,
			width: area.width,
			height: split.bottom().saturating_sub(tabs.y),
		};
		total_box(buf, body, shell, hits);
		page_switch(buf, bottom, shell, hits);
		return;
	}
	// The tabs row lists the active project's workspaces.
	if let Some(project) = shell.state.active_project() {
		let mut x = tabs.x;
		for workspace in &project.workspaces {
			let label = format!(" {} ", workspace.name);
			let width = cols(&label);
			if x + width > tabs.right() {
				break;
			}
			let is_open = shell.state.active_workspace.as_deref() == Some(workspace.id.as_str());
			let style = if is_open {
				Style::new().bg(ACTIVE_BG).fg(ACTIVE_TEXT)
			} else {
				Style::new().fg(TEXT_3)
			};
			Paragraph::new(Line::from(Span::styled(label, style)))
				.render(Rect { x, y: tabs.y, width, height: 1 }, buf);
			hits.push(Hit {
				row: tabs.y,
				col: x,
				width,
				action: TuiAction::SelectWorkspace(workspace.id.clone()),
			});
			x += width + 1;
		}
	}
	let panes = shell.state.visible_panes();
	if panes.is_empty() {
		Paragraph::new(Line::from(Span::styled(
			"选择左侧的项目或工作区以打开终端宿主。",
			Style::new().fg(TEXT_3),
		)))
		.render(split, buf);
		return;
	}
	let columns = panes.len() as u16;
	let constraints: Vec<Constraint> = (0..columns)
		.map(|_| Constraint::Ratio(1, u32::from(columns)))
		.collect();
	let areas: Vec<Rect> = Layout::horizontal(constraints)
		.spacing(1)
		.split(split)
		.to_vec();
	let path = shell
		.state
		.active_workspace()
		.map(|ws| ws.path.clone())
		.unwrap_or_default();
	let branch = shell.state.branch_label().to_owned();
	for (index, pane) in panes.iter().enumerate() {
		let Some(area) = areas.get(index) else { break };
		let focused = shell.state.tui_pane.as_deref() == Some(pane.id.as_str());
		let Some(tab) = pane.active_tab() else {
			continue;
		};
		let title = format!("● {}   {}", tab.title, index + 1);
		let inner = box_frame(buf, *area, &title, Some(focused));
		// The whole box focuses its pane, header row included.
		for row in area.y..=area.bottom().saturating_sub(1) {
			hits.push(Hit {
				row,
				col: area.x,
				width: area.width,
				action: TuiAction::FocusPane(pane.id.clone()),
			});
		}
		let lines = pane_lines(shell, tab.kind, &tab.id, &path, &branch);
		Paragraph::new(lines)
			.style(Style::new().bg(TERM_BG).fg(Color::Rgb(0xb9, 0xc2, 0xce)))
			.wrap(Wrap { trim: false })
			.render(inner, buf);
	}
	page_switch(buf, bottom, shell, hits);
}

/// The centre box's bottom row: the two pages this box can show, then the
/// hints. Both pages are reachable by a click, which is what the GUI's strip
/// gives you with its tabs.
fn page_switch(buf: &mut Buffer, area: Rect, shell: &Shell, hits: &mut Vec<Hit>) {
	let total = shell.state.center_page == crate::state::CenterPage::Total;
	let mut x = area.x;
	for (label, is_total, action) in
		[(" 总面板 ", true, TuiAction::ShowTotal), (" 终端 宿主 ", false, TuiAction::ShowWorkspace)]
	{
		let width = cols(label);
		if x + width > area.right() {
			break;
		}
		let style = if total == is_total {
			Style::new().bg(ACTIVE_BG).fg(ACTIVE_TEXT)
		} else {
			Style::new().fg(TEXT_3)
		};
		Paragraph::new(Line::from(Span::styled(label, style)))
			.render(Rect { x, y: area.y, width, height: 1 }, buf);
		hits.push(Hit { row: area.y, col: x, width, action });
		x += width + 1;
	}
	let hint = if total {
		"所有项目一张表：项目 · 工作区 · 分支 · 状态 · ±行 · 未提交"
	} else {
		"点击大标签页切换 · 点击面板聚焦"
	};
	// The hint is drawn into what is left *after* the chips: a paragraph renders
	// its whole rect, so drawing it over the row would blank the chips (whose
	// text would then be replaced by the hint's leading padding spaces).
	let rest = Rect { x, y: area.y, width: area.right().saturating_sub(x), height: 1 };
	if rest.width == 0 {
		return;
	}
	let used = cols(hint) as usize;
	let split = format!("split: {}col", shell.state.active_cols());
	let split_width = cols(&split) as usize;
	let room = rest.width as usize;
	if room > used + split_width + 2 {
		let pad = room - used - split_width - 2;
		Paragraph::new(Line::from(vec![
			Span::styled(format!(" {}{}", hint, " ".repeat(pad)), Style::new().fg(TEXT_3)),
			Span::styled(format!(" {split}"), Style::new().fg(TEXT_3)),
		]))
		.render(rest, buf);
	} else {
		// Too tight for both: the hint stays and `split:` goes, because the hint
		// is the contract's own description of the page. The renderer clips it,
		// which is better than dropping it silently.
		Paragraph::new(Line::from(Span::styled(format!(" {hint}"), Style::new().fg(TEXT_3))))
			.render(rest, buf);
	}
}

/// `text` padded to `width` display columns — wide glyphs count as two, so the
/// columns line up the way they look rather than the way they are counted.
fn padded(text: &str, width: usize) -> String {
	let used = cols(text) as usize;
	if used >= width {
		return text.to_owned();
	}
	format!("{text}{}", " ".repeat(width - used))
}

/// One table row: every cell padded to its column width and joined with a
/// one-column gap, so a cell that fills its column exactly still cannot touch
/// its neighbour.
fn table_row(cells: Vec<(String, Style, usize)>) -> Line<'static> {
	let mut spans: Vec<Span<'static>> = Vec::new();
	for (text, style, width) in cells {
		if !spans.is_empty() {
			spans.push(Span::raw(" "));
		}
		spans.push(Span::styled(padded(&text, width), style));
	}
	Line::from(spans)
}

/// The grid's mirror of one of [`crate::theme`]'s tokens.
///
/// The blit paints ratatui colours, so a state's ink (which comes from the
/// contract's table via [`crate::status::RunState::ink`]) has to be translated.
/// Reading it off the token, rather than repeating the RGB here, keeps the one
/// state palette in one place.
fn tui_ink(ink: egui::Color32) -> Color {
	Color::Rgb(ink.r(), ink.g(), ink.b())
}

/// 总面板 as terminal rows: every project's every workspace on one line, with
/// the 状态 column from the contract's 状态词表.
///
/// The two git columns come from the one snapshot the shell holds, so only the
/// open workspace has numbers; every other row reads `—` rather than a
/// plausible value. A workspace nothing observes reads `—` in 状态 for the same
/// reason.
fn total_box(buf: &mut Buffer, area: Rect, shell: &Shell, hits: &mut Vec<Hit>) {
	buf.set_style(area, Style::new().bg(BOX_BG));
	if area.height == 0 {
		return;
	}
	const W_PROJECT: usize = 14;
	const W_BRANCH: usize = 20;
	const W_STATE: usize = 12;
	const W_DELTA: usize = 12;
	const W_DIRTY: usize = 8;
	// 工作区 takes what is left (the five 1-col gaps included), so the 未提交
	// column cannot fall off the edge of a narrow box — the header says `未提交`
	// and the numbers have to be under it.
	let w_name = (area.width as usize)
		.saturating_sub(W_PROJECT + W_BRANCH + W_STATE + W_DELTA + W_DIRTY + 5 + 1)
		.max(8);
	let header = table_row(vec![
		("项目".to_owned(), Style::new().fg(TEXT_3).add_modifier(Modifier::BOLD), W_PROJECT),
		("工作区".to_owned(), Style::new().fg(TEXT_3).add_modifier(Modifier::BOLD), w_name),
		("分支".to_owned(), Style::new().fg(TEXT_3).add_modifier(Modifier::BOLD), W_BRANCH),
		("状态".to_owned(), Style::new().fg(TEXT_3).add_modifier(Modifier::BOLD), W_STATE),
		("±行".to_owned(), Style::new().fg(TEXT_3).add_modifier(Modifier::BOLD), W_DELTA),
		("未提交".to_owned(), Style::new().fg(TEXT_3).add_modifier(Modifier::BOLD), W_DIRTY),
	]);
	Paragraph::new(header).render(Rect { x: area.x, y: area.y, width: area.width, height: 1 }, buf);

	let mut row = area.y + 1;
	for project in &shell.state.projects {
		for workspace in &project.workspaces {
			if row >= area.bottom() {
				return;
			}
			let open = shell.state.active_workspace.as_deref() == Some(workspace.id.as_str());
			let (delta, dirty) = match (open, shell.git.as_ref()) {
				(true, Some(status)) if status.error.is_none() => (
					format!("+{} −{}", status.insertions, status.deletions),
					status.changed.len().to_string(),
				),
				_ => ("—".to_owned(), "—".to_owned()),
			};
			// Both arms are the egui token; `tui_ink` translates for the grid.
			// Only the *word* is drawn: the bundled fonts have no ◐ (U+25D0) or
			// ✓ (U+2713) — the first attempt at `label()` rendered `?◐`
			// replacements into the table — so the glyphs stay in the tooltip
			// and in the docs, where they are not font-dependent.
			let (state_ink, state_text) = match workspace.run_state {
				Some(state) => (state.ink(), state.word().to_owned()),
				None => (crate::theme::TEXT_3, "—".to_owned()),
			};
			let line = table_row(vec![
				(
					project.name.clone(),
					Style::new().fg(if open { ACTIVE_TEXT } else { TEXT_2 }),
					W_PROJECT,
				),
				(workspace.name.clone(), Style::new().fg(TEXT_2), w_name),
				(workspace.branch.clone(), Style::new().fg(CYAN), W_BRANCH),
				(state_text, Style::new().fg(tui_ink(state_ink)), W_STATE),
				(delta, Style::new().fg(TEXT_3), W_DELTA),
				(dirty, Style::new().fg(TEXT_3), W_DIRTY),
			]);
			Paragraph::new(line)
				.style(Style::new().bg(if open { ACTIVE_BG } else { BOX_BG }))
				.render(Rect { x: area.x, y: row, width: area.width, height: 1 }, buf);
			hits.push(Hit {
				row,
				col: area.x,
				width: area.width,
				action: TuiAction::SelectWorkspace(workspace.id.clone()),
			});
			row += 1;
		}
	}
}

/// The lines one terminal box shows: the placeholder banner plus the sample.
fn pane_lines(
	shell: &Shell,
	kind: crate::state::SessionKind,
	tab_id: &str,
	path: &str,
	branch: &str,
) -> Vec<Line<'static>> {
	match kind {
		crate::state::SessionKind::Term => {
			let mut lines: Vec<Line<'static>> = crate::seed::placeholder(
				"终端窗格未接 PTY 宿主",
				"termide 会话（Session::spawn）+ 会话生命周期",
			)
			.into_iter()
			.map(|text| Line::from(Span::styled(text, Style::new().fg(Color::Rgb(0xd2, 0x99, 0x22)))))
			.collect();
			for (text, ink) in crate::seed::transcript(crate::seed::TermKind::of(tab_id), path, branch)
			{
				lines.push(Line::from(Span::styled(text, Style::new().fg(ink.ratatui()))));
			}
			lines
		},
		crate::state::SessionKind::Editor => {
			let mut lines: Vec<Line<'static>> = crate::seed::placeholder(
				"编辑器窗格未打开文件",
				"工作区内的只读文本（文件树点击打开）",
			)
			.into_iter()
			.map(|text| Line::from(Span::styled(text, Style::new().fg(Color::Rgb(0xd2, 0x99, 0x22)))))
			.collect();
			for (index, text) in crate::seed::EDITOR_LINES.iter().enumerate().take(12) {
				lines.push(Line::from(vec![
					Span::styled(
						format!("{:>3}  ", index + 1),
						Style::new().fg(Color::Rgb(0x4c, 0x55, 0x63)),
					),
					Span::styled((*text).to_owned(), Style::new().fg(Color::Rgb(0xc8, 0xd0, 0xdb))),
				]));
			}
			lines
		},
		crate::state::SessionKind::Diff => {
			let mut lines: Vec<Line<'static>> =
				crate::seed::placeholder("diff 窗格未调用 git", "git diff --no-color（只读）")
					.into_iter()
					.map(|text| {
						Line::from(Span::styled(text, Style::new().fg(Color::Rgb(0xd2, 0x99, 0x22))))
					})
					.collect();
			for (row, text) in crate::seed::DIFF_LINES.iter() {
				let (sign, color) = match row {
					crate::seed::DiffRow::Hunk => ('@', ACCENT_2),
					crate::seed::DiffRow::Add => ('+', ADD),
					crate::seed::DiffRow::Del => ('-', DEL),
					crate::seed::DiffRow::Context => (' ', TEXT_2),
				};
				lines.push(Line::from(Span::styled(format!("{sign} {text}"), Style::new().fg(color))));
			}
			lines
		},
		// The Git page draws the same snapshot the right column's F3 does, so
		// the terminal form shows the numbers, not a second copy of the data.
		crate::state::SessionKind::Git => {
			let mut lines: Vec<Line<'static>> = Vec::new();
			match &shell.git {
				Some(status) if status.error.is_none() => {
					lines.push(Line::from(vec![
						Span::styled(status.branch.clone(), Style::new().fg(TEXT_2)),
						Span::styled(
							format!("  ↑{} ↓{}", status.ahead, status.behind),
							Style::new().fg(TEXT_3),
						),
					]));
					lines.push(Line::from(vec![
						Span::styled(format!("+{} ", status.insertions), Style::new().fg(ADD)),
						Span::styled(format!("-{}", status.deletions), Style::new().fg(DEL)),
						Span::styled(format!("  {} 更改", status.changed.len()), Style::new().fg(TEXT_3)),
					]));
				},
				_ => lines.push(Line::from(Span::styled(
					"git 状态不可读（看 F3 的说明）",
					Style::new().fg(TEXT_3),
				))),
			}
			lines
		},
		// R23: the terminal form's editor is zetaide. This view draws what the
		// page is, since hosting the panel needs a terminal host it has not got.
		crate::state::SessionKind::Ide => vec![
			Line::from(Span::styled("zetaide", Style::new().fg(ACCENT_2))),
			Line::from(Span::styled(
				"终端形态的编辑器走 zetaide（termide panel-editor）",
				Style::new().fg(TEXT_2),
			)),
			Line::from(Span::styled(format!("$ zetaide {path}"), Style::new().fg(TEXT_3))),
		],
	}
}

/// 侧栏 — F1 文件 · F2 历史 · F3 Git.
fn sidebar_box(buf: &mut Buffer, area: Rect, shell: &Shell, hits: &mut Vec<Hit>) {
	buf.set_style(area, Style::new().bg(BOX_BG));
	let [tabs, content] = Layout::vertical([Constraint::Length(2), Constraint::Min(0)]).areas(area);
	buf.set_style(tabs, Style::new().bg(BOX_BG));
	buf.set_style(content, Style::new().bg(BOX_BG));
	let mut x = tabs.x;
	for (tab, label) in
		[(RightTab::Files, "F1 文件"), (RightTab::History, "F2 历史"), (RightTab::Git, "F3 Git")]
	{
		let text = format!(" {label} ");
		let width = cols(&text);
		if x + width > tabs.right() {
			break;
		}
		let active = shell.state.right_tab == tab;
		let style = if active {
			Style::new().bg(ACTIVE_BG).fg(ACTIVE_TEXT)
		} else {
			Style::new().fg(TEXT_3)
		};
		Paragraph::new(Line::from(Span::styled(text, style)))
			.render(Rect { x, y: tabs.y, width, height: 1 }, buf);
		hits.push(Hit { row: tabs.y, col: x, width, action: TuiAction::RightTab(tab) });
		x += width + 1;
	}
	match shell.state.right_tab {
		RightTab::Files => {
			let mut lines: Vec<Line<'static>> = Vec::new();
			match (shell.tree.root(), &shell.tree.error) {
				(_, Some(error)) => lines.push(Line::from(Span::styled(
					error.clone(),
					Style::new().fg(Color::Rgb(0xd2, 0x99, 0x22)),
				))),
				(Some(root), None) => {
					for child in root.children.iter().take(content.height as usize) {
						let mut spans = vec![Span::styled(
							if child.is_dir {
								format!("▾ {}/", child.name)
							} else {
								child.name.clone()
							},
							Style::new().fg(if child.is_dir { TEXT_2 } else { TEXT_3 }),
						)];
						if !child.is_dir {
							spans.push(Span::styled("  ·", Style::new().fg(BORDER)));
						}
						lines.push(Line::from(spans));
					}
				},
				(None, None) => {
					lines.push(Line::from(Span::styled("先打开一个工作区", Style::new().fg(TEXT_3))))
				},
			}
			Paragraph::new(lines).render(content, buf);
		},
		RightTab::History => {
			Paragraph::new(vec![
				Line::from(Span::styled("还没有对话记录", Style::new().fg(TEXT_2))),
				Line::from(Span::styled(
					"未来数据源：zetacode 会话（~/.zeta/agent/agent.db）",
					Style::new().fg(TEXT_3),
				)),
			])
			.render(content, buf);
		},
		RightTab::Git => {
			let mut lines: Vec<Line<'static>> = Vec::new();
			match &shell.git {
				None => {
					lines.push(Line::from(Span::styled("正在读取 git 状态…", Style::new().fg(TEXT_3))))
				},
				Some(status) if status.error.is_some() => lines.push(Line::from(Span::styled(
					status.error.clone().unwrap_or_default(),
					Style::new().fg(Color::Rgb(0xd2, 0x99, 0x22)),
				))),
				Some(status) => {
					let upstream = status
						.upstream
						.clone()
						.unwrap_or_else(|| "无上游".to_owned());
					lines.push(Line::from(vec![
						Span::styled(
							format!("{} → {}", status.branch, upstream),
							Style::new().fg(TEXT_2),
						),
						Span::styled(
							format!("   ↑{} ↓{}", status.ahead, status.behind),
							Style::new().fg(TEXT_3),
						),
					]));
					lines.push(Line::from(vec![
						Span::styled(format!("+{} ", status.insertions), Style::new().fg(ADD)),
						Span::styled(format!("-{}", status.deletions), Style::new().fg(DEL)),
						Span::styled(
							format!("   {} 更改", status.changed.len()),
							Style::new().fg(TEXT_3),
						),
					]));
					lines.push(Line::from(Span::styled("─ 更改 ────────────", Style::new().fg(BORDER))));
					for file in status.changed.iter().take(6) {
						lines.push(Line::from(vec![
							Span::styled(format!("+{:<5}", file.insertions), Style::new().fg(ADD)),
							Span::styled(format!("-{:<5}", file.deletions), Style::new().fg(DEL)),
							Span::styled(file.path.clone(), Style::new().fg(TEXT_2)),
						]));
					}
					lines.push(Line::from(Span::styled("─ 提交 ────────────", Style::new().fg(BORDER))));
					for commit in status.commits.iter().take(5) {
						lines.push(Line::from(vec![
							Span::styled("● ", Style::new().fg(ACCENT_2)),
							Span::styled(commit.subject.clone(), Style::new().fg(TEXT_2)),
						]));
					}
				},
			}
			Paragraph::new(lines).render(content, buf);
		},
		// R23: the terminal form has no usage page (zetacode's input box already
		// shows the live conversation's usage, and the global roll-up is the
		// stats page behind `zetacode /stats`). The tab can still be selected —
		// the GUI shares this state — so it says so instead of drawing numbers.
		RightTab::Context => {
			Paragraph::new(vec![
				Line::from(Span::styled("终端形态不显示用量页", Style::new().fg(TEXT_2))),
				Line::from(Span::styled(
					"全局用量：zetacode 里 /stats 弹网页（stats 服务 :3847）",
					Style::new().fg(TEXT_3),
				)),
				Line::from(Span::styled(
					"当前对话用量：zetacode 输入框已显示",
					Style::new().fg(TEXT_3),
				)),
			])
			.render(content, buf);
		},
	}
}

/// The status line: 设置, ── INS ──, the project/workspace crumb, memory, clock.
fn status_line(buf: &mut Buffer, area: Rect, shell: &Shell, hits: &mut Vec<Hit>) {
	let row = Rect { x: area.x, y: area.y, width: area.width, height: 1 };
	buf.set_style(row, Style::new().bg(TERM_BG));
	// 设置 first: the crumb is drawn to the right of it, not over it.
	let settings = " 设置 ";
	let settings_width = cols(settings);
	if area.width > settings_width + 2 {
		Paragraph::new(Line::from(Span::styled(
			settings,
			Style::new().fg(TEXT_2).bg(Color::Rgb(0x17, 0x1b, 0x22)),
		)))
		.render(Rect { x: area.x + 1, y: area.y, width: settings_width, height: 1 }, buf);
		hits.push(Hit {
			row: area.y,
			col: area.x + 1,
			width: settings_width,
			action: TuiAction::OpenSettings,
		});
	}
	let rest = Rect {
		x: area.x + settings_width + 2,
		y: area.y,
		width: area.width.saturating_sub(settings_width + 3),
		height: 1,
	};
	if rest.width == 0 {
		return;
	}
	let project = shell
		.state
		.active_project()
		.map(|p| p.name.clone())
		.unwrap_or_else(|| "—".to_owned());
	let crumb = format!("── INS ──  {}/{}", project, shell.state.workspace_label());
	let throughput = shell.throughput.clone().unwrap_or_else(|| "—".to_owned());
	let tail = format!("{} · {}   {} ", shell.memory_label(), throughput, clock());
	let used = cols(&crumb) as usize;
	let mut spans = vec![Span::styled(crumb, Style::new().fg(TEXT_3))];
	if (rest.width as usize) > used + tail.chars().count() {
		let pad = rest.width as usize - used - tail.chars().count();
		spans.push(Span::styled(" ".repeat(pad), Style::new()));
		spans.push(Span::styled(tail, Style::new().fg(TEXT_3)));
	}
	Paragraph::new(Line::from(spans)).render(rest, buf);
}

fn clock() -> String {
	chrono::Local::now().format("%H:%M").to_string()
}

/// The TUI view is only rendered in [`ViewMode::Tui`].
pub fn active(shell: &Shell) -> bool {
	shell.state.view == ViewMode::Tui
}

/// The TUI as plain text, for the tests and for the acceptance check that both
/// views read the *same* state: everything the GUI shows about a workspace
/// (its name, its branch, its panes' session tabs, the right column's tab)
/// appears here too.
pub fn snapshot(shell: &Shell, cols: u16, rows: u16) -> String {
	let (buffer, hits) = build(shell, cols.max(1), rows.max(1));
	let mut text = String::new();
	for row in 0..buffer.area.height {
		// Rebuild the row *by column*, so a wide glyph keeps the two columns
		// it occupies and a row reads the way it looks on screen.
		let mut line = String::new();
		let mut col = 0u16;
		for (start, symbol, width) in blit::painted_cells(&buffer, row, buffer.area.width) {
			while col < start {
				line.push(' ');
				col += 1;
			}
			line.push_str(symbol);
			col = col.saturating_add(width);
		}
		text.push_str(line.trim_end());
		text.push('\n');
	}
	text.push_str(&format!("[hits: {}]\n", hits.len()));
	text
}
