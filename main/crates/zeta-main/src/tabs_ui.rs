use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

/// The top-level tab bar: `1 title  2 title …  +`, active tab highlighted.
pub struct TabBar<'a> {
	pub titles: &'a [String],
	pub active: usize,
}

impl Widget for TabBar<'_> {
	fn render(self, area: Rect, buf: &mut Buffer) {
		if area.height < 1 || area.width < 3 {
			return;
		}
		let mut spans = Vec::with_capacity(self.titles.len() * 2 + 2);
		for (idx, title) in self.titles.iter().enumerate() {
			let label = truncate(title, 18);
			let style = if idx == self.active {
				Style::default().add_modifier(Modifier::BOLD | Modifier::REVERSED)
			} else {
				Style::default()
			};
			spans.push(Span::styled(format!(" {}:{} ", idx + 1, label), style));
		}
		spans.push(Span::raw(" + "));
		let line = Line::from(spans);
		let widths: Vec<u16> = line.spans.iter().map(|s| s.width() as u16).collect();
		let mut x = area.x;
		for (span, width) in line.spans.iter().zip(widths) {
			if x + width > area.x + area.width {
				break;
			}
			buf.set_span(x, area.y, span, width);
			x += width;
		}
	}
}

/// The quick-launch menu strip under the tab bar. MVP is a static hint row;
/// interactive menus arrive with the menu subsystem iteration.
pub fn menu_bar_text() -> String {
	" zeta workspace  ·  Alt+N shell · Alt+C zeta-c · Alt+E zeta-e · Alt+L layout · Alt+T tab · F1 help ".into()
}

/// Bottom status line: focused pane + layout + suite reminder.
pub fn status_text(pane_label: &str, template: &str, pane_index: usize, pane_count: usize) -> String {
	format!(
		" [{pane_label}] pane {}/{} · layout {template} · suite: zeta-c · zeta-e · zeta-i · F1 help ",
		pane_index + 1,
		pane_count,
	)
}

fn truncate(text: &str, max: usize) -> String {
	if text.chars().count() <= max {
		text.to_string()
	} else {
		let cut: String = text.chars().take(max.saturating_sub(1)).collect();
		format!("{cut}…")
	}
}
