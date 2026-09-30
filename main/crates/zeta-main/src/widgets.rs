//! First-party widget panes: native ratatui-rendered content that shares the
//! pane grid with PTY panes. Flagship: time + calendar on one page.
//!
//! Widgets are workbench-drawn (no child process, no PTY) — they exist so a
//! layout like "terminal panes left, dashboard right" is a pure layout
//! decision, and so the mouse-first doctrine covers them like every pane.

use chrono::{Datelike, Local, Timelike};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

/// Time + calendar on one page: big clock with seconds, full date and
/// weekday, then the current month (Monday-first) with today marked.
/// Colorless chrome: bold/underline only, terminal's own background.
pub fn render_time_calendar(area: Rect, buf: &mut Buffer) {
	if area.height < 5 || area.width < 22 {
		return;
	}
	let now = Local::now();
	let dim = Style::default().fg(Color::DarkGray);
	let strong = Style::default().add_modifier(Modifier::BOLD);
	let today = Style::default().add_modifier(Modifier::BOLD | Modifier::UNDERLINED);

	// Big clock with small seconds, then the full date line.
	let clock = Line::from(vec![
		Span::styled(format!("{:02}:{:02}", now.hour(), now.minute()), strong),
		Span::styled(format!(" {:02}", now.second()), dim),
	])
	.centered();
	buf.set_line(area.x, area.y + 1, &clock, area.width);
	let date = Line::from(Span::styled(now.format("%Y-%m-%d %a").to_string(), dim)).centered();
	buf.set_line(area.x, area.y + 2, &date, area.width);
	if area.height < 10 {
		return;
	}

	// Current month, Monday-first, today underlined.
	let month = Line::from(Span::styled(now.format("%B %Y").to_string(), strong)).centered();
	buf.set_line(area.x, area.y + 4, &month, area.width);
	let header = Line::from(Span::styled("Mo Tu We Th Fr Sa Su", dim)).centered();
	buf.set_line(area.x, area.y + 5, &header, area.width);

	let first = chrono::NaiveDate::from_ymd_opt(now.year(), now.month(), 1);
	let offset = first
		.map(|d| d.weekday().num_days_from_monday() as usize)
		.unwrap_or(0);
	let days = days_in_month(now.year(), now.month());
	let mut col = offset;
	let mut spans: Vec<Span> = Vec::with_capacity(8);
	let mut row = area.y + 6;
	for day in 1..=days {
		let cell = format!("{:2} ", day);
		spans.push(Span::styled(
			cell,
			if day == now.day() {
				today
			} else {
				Style::default()
			},
		));
		col += 1;
		if col == 7 {
			let line = Line::from(spans.clone()).centered();
			buf.set_line(area.x, row, &line, area.width);
			spans.clear();
			col = 0;
			row += 1;
			if row >= area.bottom() {
				break;
			}
		}
	}
	if !spans.is_empty() && row < area.bottom() {
		let line = Line::from(spans).centered();
		buf.set_line(area.x, row, &line, area.width);
	}
}

fn days_in_month(year: i32, month: u32) -> u32 {
	let (next_year, next_month) = if month == 12 {
		(year + 1, 1)
	} else {
		(year, month + 1)
	};
	chrono::NaiveDate::from_ymd_opt(next_year, next_month, 1)
		.and_then(|d| d.pred_opt())
		.map(|d| d.day())
		.unwrap_or(30)
}
