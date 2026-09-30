use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

/// Hit geometry for the tab bar, shared by `TabBar::render` and mouse
/// routing so clicks always agree with what is on screen.
pub struct TabHits {
	/// `‹` previous tab.
	pub prev: (u16, u16),
	/// `(x, width)` per tab, in title order.
	pub tabs: Vec<(u16, u16)>,
	/// `×` close box per tab — present on the active tab only.
	pub closes: Vec<Option<(u16, u16)>>,
	/// `›` next tab.
	pub next: (u16, u16),
	/// `+` new tab.
	pub plus: (u16, u16),
}

pub fn tab_bar_hits(titles: &[String], active: usize) -> TabHits {
	let mut x: u16 = 0;
	let prev = (x, 2); // " ‹"
	x += 2;
	let mut tabs = Vec::with_capacity(titles.len());
	let mut closes = Vec::with_capacity(titles.len());
	for (idx, title) in titles.iter().enumerate() {
		let text = if idx == active {
			format!("▸ {}:{} ", idx + 1, truncate(title, 18))
		} else {
			format!(" {}:{} ", idx + 1, truncate(title, 18))
		};
		let width = Span::raw(text).width() as u16;
		tabs.push((x, width));
		x += width;
		if idx == active {
			closes.push(Some((x, 2))); // " ×"
			x += 2;
		} else {
			closes.push(None);
		}
	}
	let next = (x, 2); // " ›"
	x += 2;
	let plus = (x, 2); // " +"
	TabHits { prev, tabs, closes, next, plus }
}

/// The top-level tab bar: `‹ ▸ 1 shell ×  2 zeta-c › +`.
///
/// Mouse-first: every element is clickable (prev/next steppers, tab switch,
/// active-tab ×, new tab). Active tab is marked with ▸ plus bold+underline;
/// the rest are dim. The chrome stays colorless by design.
pub struct TabBar<'a> {
	pub titles: &'a [String],
	pub active: usize,
}

impl Widget for TabBar<'_> {
	fn render(self, area: Rect, buf: &mut Buffer) {
		if area.height < 1 || area.width < 3 {
			return;
		}
		let dim = Style::default().fg(Color::DarkGray);
		let active_style = Style::default().add_modifier(Modifier::BOLD | Modifier::UNDERLINED);
		let mut spans = Vec::with_capacity(self.titles.len() * 3 + 5);
		spans.push(Span::styled(" ‹", dim));
		for (idx, title) in self.titles.iter().enumerate() {
			let label = truncate(title, 18);
			if idx == self.active {
				spans.push(Span::styled(format!("▸ {}:{} ", idx + 1, label), active_style));
				spans.push(Span::styled("×", Style::default().add_modifier(Modifier::BOLD)));
			} else {
				spans.push(Span::styled(format!(" {}:{} ", idx + 1, label), dim));
			}
		}
		spans.push(Span::styled(" ›", dim));
		spans.push(Span::styled(" +", dim));
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
/// the full menu-bar subsystem (File/Pane/Tab/Tools/Settings trees) is a
/// roadmap iteration.
pub fn menu_bar_text() -> String {
	" zeta workspace  ·  Alt+N shell · Alt+C zeta-c · Alt+E zeta-e · Alt+I zeta-ide · Alt+D time · Alt+L layout · Alt+O focus · Alt+X close pane · Alt+W close tab · F1 help · Alt+Q quit ".into()
}

/// Bottom status line: focused pane + layout + suite reminder.
pub fn status_text(
	pane_label: &str,
	template: &str,
	pane_index: usize,
	pane_count: usize,
) -> String {
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
