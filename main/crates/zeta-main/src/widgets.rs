//! First-party widget panes: native ratatui-rendered content that shares the
//! pane grid with PTY panes — time+calendar dashboard, pomodoro timer,
//! clipboard history. Widgets are workbench-drawn (no child process, no PTY)
//! so a layout like "terminals left, dashboard right" is a pure layout
//! decision, and the mouse-first doctrine covers them like every pane.
//!
//! Emoji renders as plain text (🍅 📋); combining-sequence emoji are avoided
//! (unicode-width ambiguity, ratatui #2357).

use chrono::{Datelike, Local, Timelike};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

/// Shared, workspace-lifetime state for interactive widgets. Cloned per draw
/// frame (small); mutations go through the mouse path which owns `&mut self`.
#[derive(Clone, Default)]
pub struct WidgetState {
	pub pomodoro: Pomodoro,
	/// Most recent first, de-duplicated, capped.
	pub clipboard: Vec<String>,
}

// ---------------------------------------------------------------------------
// Time + calendar
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pomodoro
// ---------------------------------------------------------------------------

const WORK_SECS: u64 = 25 * 60;
const BREAK_SECS: u64 = 5 * 60;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Phase {
	#[default]
	Work,
	Break,
}

/// A pomodoro timer: 25-minute work / 5-minute break, auto-advancing phases,
/// start-pause-reset by clicking the buttons under the clock.
#[derive(Clone, Debug, Default)]
pub struct Pomodoro {
	/// When the current run started (None = paused).
	pub running: Option<std::time::Instant>,
	/// Seconds accumulated into the current phase before the last pause.
	pub accumulated_secs: u64,
	pub phase: Phase,
	pub completed_work: u32,
}

impl Pomodoro {
	fn cap(&self) -> u64 {
		match self.phase {
			Phase::Work => WORK_SECS,
			Phase::Break => BREAK_SECS,
		}
	}

	fn elapsed(&self) -> u64 {
		self.accumulated_secs + self.running.map(|t| t.elapsed().as_secs()).unwrap_or(0)
	}

	pub fn remaining(&self) -> u64 {
		self.cap().saturating_sub(self.elapsed())
	}

	pub fn toggle(&mut self) {
		if let Some(started) = self.running.take() {
			self.accumulated_secs += started.elapsed().as_secs();
		} else {
			self.running = Some(std::time::Instant::now());
		}
	}

	pub fn reset(&mut self) {
		self.running = None;
		self.accumulated_secs = 0;
		self.phase = Phase::Work;
	}

	/// Flip phases when the current one runs out (auto-starts the next).
	pub fn tick(&mut self) {
		if self.elapsed() >= self.cap() {
			if self.phase == Phase::Work {
				self.completed_work += 1;
				self.phase = Phase::Break;
			} else {
				self.phase = Phase::Work;
			}
			self.accumulated_secs = 0;
			self.running = Some(std::time::Instant::now());
		}
	}
}

/// Render the pomodoro page: 🍅 + phase + big remaining clock, a progress
/// bar, and the button row. Hit geometry is deterministic via
/// [`pomodoro_click`].
pub fn render_pomodoro(pom: &Pomodoro, area: Rect, buf: &mut Buffer) {
	if area.height < 6 || area.width < 20 {
		return;
	}
	let dim = Style::default().fg(Color::DarkGray);
	let strong = Style::default().add_modifier(Modifier::BOLD);

	let title = Line::from(Span::styled(
		format!(
			"🍅 {} · round {}",
			match pom.phase {
				Phase::Work => "work",
				Phase::Break => "break",
			},
			pom.completed_work + 1,
		),
		dim,
	))
	.centered();
	buf.set_line(area.x, area.y + 1, &title, area.width);

	let remaining = pom.remaining();
	let clock =
		Line::from(Span::styled(format!("{:02}:{:02}", remaining / 60, remaining % 60), strong))
			.centered();
	buf.set_line(area.x, area.y + 3, &clock, area.width);

	// Progress bar over the phase (20 cells).
	let width = 20usize;
	let filled = ((width as u64) * pom.elapsed() / pom.cap()) as usize;
	let bar: Vec<Span> = (0..width)
		.map(|i| {
			if i < filled {
				Span::styled("━", Style::default().add_modifier(Modifier::BOLD))
			} else {
				Span::styled("─", dim)
			}
		})
		.collect();
	buf.set_line(area.x, area.y + 4, &Line::from(bar).centered(), area.width);

	let toggle_label = if pom.running.is_some() {
		"[pause]"
	} else {
		"[start]"
	};
	let buttons =
		Line::from(Span::styled(toggle_label, Style::default().add_modifier(Modifier::BOLD)))
			.centered();
	buf.set_line(area.x, area.y + 6, &buttons, area.width);
	let reset = Line::from(Span::styled("[reset]", dim)).centered();
	buf.set_line(area.x, area.y + 7, &reset, area.width);
}

/// Deterministic hit boxes for the pomodoro buttons, shared by rendering and
/// the click path: `(rect, action)`.
pub fn pomodoro_buttons(area: Rect) -> Vec<(Rect, &'static str)> {
	if area.height < 8 || area.width < 20 {
		return Vec::new();
	}
	let toggle_width = 7u16;
	let x = area.x + area.width.saturating_sub(toggle_width) / 2;
	let toggle = Rect { x, y: area.y + 6, width: toggle_width, height: 1 };
	let reset = Rect { x, y: area.y + 7, width: 7, height: 1 };
	vec![(toggle, "toggle"), (reset, "reset")]
}

/// Act on a pomodoro button click. Returns true when the click was consumed.
pub fn pomodoro_click(pom: &mut Pomodoro, area: Rect, column: u16, row: u16) -> bool {
	for (rect, action) in pomodoro_buttons(area) {
		if row == rect.y && column >= rect.x && column < rect.x + rect.width {
			match action {
				"toggle" => pom.toggle(),
				"reset" => pom.reset(),
				_ => {},
			}
			return true;
		}
	}
	false
}

// ---------------------------------------------------------------------------
// Clipboard history
// ---------------------------------------------------------------------------

/// Render the clipboard page: a capture button and the most recent entries.
pub fn render_clipboard(state: &WidgetState, area: Rect, buf: &mut Buffer) {
	if area.height < 4 || area.width < 16 {
		return;
	}
	let dim = Style::default().fg(Color::DarkGray);
	let strong = Style::default().add_modifier(Modifier::BOLD);
	let button = Line::from(Span::styled("📋 [capture now]", strong)).centered();
	buf.set_line(area.x, area.y + 1, &button, area.width);
	let hint = Line::from(Span::styled("newest first — click to capture", dim)).centered();
	buf.set_line(area.x, area.y + 2, &hint, area.width);

	for (idx, entry) in state.clipboard.iter().enumerate() {
		let row = area.y + 4 + idx as u16;
		if row >= area.bottom() {
			break;
		}
		let one_line: String = entry
			.lines()
			.next()
			.unwrap_or("")
			.chars()
			.take(area.width as usize - 4)
			.collect();
		let line = Line::from(Span::styled(
			format!(" 📋 {one_line}"),
			if idx == 0 { strong } else { Style::default() },
		));
		buf.set_line(area.x, row, &line, area.width);
	}
}

/// The capture button's hit box, shared by rendering and the click path.
pub fn clipboard_capture_rect(area: Rect) -> Option<Rect> {
	if area.height < 4 || area.width < 16 {
		return None;
	}
	Some(Rect { x: area.x + area.width / 4, y: area.y + 1, width: area.width / 2, height: 1 })
}

/// Read the system clipboard and record it (newest first, de-duplicated).
pub fn clipboard_capture(state: &mut WidgetState) {
	let Ok(mut clip) = arboard::Clipboard::new() else {
		return;
	};
	if let Ok(text) = clip.get_text() {
		let text = text.trim().to_string();
		if text.is_empty() {
			return;
		}
		state.clipboard.retain(|e| e != &text);
		state.clipboard.insert(0, text);
		state.clipboard.truncate(20);
	}
}
