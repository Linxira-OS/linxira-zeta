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
	let centre_body = box_frame(&mut buf, centre, "终端 宿主 · 大标签页", None);
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
	Paragraph::new(Line::from(vec![
		Span::styled("点击大标签页切换 · 点击面板聚焦", Style::new().fg(TEXT_3)),
		Span::styled(
			format!(
				"{:>width$}split: {}col",
				"",
				shell.state.active_cols(),
				width = split.width.saturating_sub(36) as usize
			),
			Style::new().fg(TEXT_3),
		),
	]))
	.render(bottom, buf);
}

/// The lines one terminal box shows: the placeholder banner plus the sample.
fn pane_lines(
	_shell: &Shell,
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
