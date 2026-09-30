//! Top chrome: tab bar (left) + menu bar (right), shared hit geometry, and
//! drag-to-reorder support for tabs.
//!
//! Doctrine: the chrome itself stays free of hotkey hints — keys live in the
//! help overlay and menus. Every visible element is mouse-first.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

/// Top-level menus, right-aligned on the tab row. `Settings` opens the
/// settings surface (roadmap: keybindings/theme/shell config); `Help` shows
/// the keymap overlay.
pub const MENUS: &[(&str, &[&str])] = &[
	("File", &["New tab", "Close tab", "Quit"]),
	(
		"Pane",
		&[
			"Split shell",
			"Split zeta-c",
			"Split zeta-e",
			"Split zeta-ide",
			"Time · calendar",
			"🍅 Pomodoro",
			"📋 Clipboard",
			"New subtab (shell)",
			"Close pane",
		],
	),
	("Tab", &["Next tab", "Previous tab"]),
	("Tools", &["Layout 1x1", "Layout 1x2", "Layout 2x2", "Equalize", "Focus next pane"]),
	("Settings", &["Settings (soon)", "Help"]),
];

fn menu_widths() -> Vec<u16> {
	MENUS
		.iter()
		.map(|(name, _)| Span::raw(format!(" {name} ")).width() as u16)
		.collect()
}

/// Hit geometry for the tab bar row, shared by rendering and mouse routing so
/// clicks always agree with what is on screen.
pub struct TabHits {
	/// `‹` previous tab.
	pub prev: (u16, u16),
	/// `(x, width)` per tab, in title order.
	pub tabs: Vec<(u16, u16)>,
	/// `×` close box per tab — the active tab only.
	pub closes: Vec<Option<(u16, u16)>>,
	/// `›` next tab.
	pub next: (u16, u16),
	/// `+` new tab.
	pub plus: (u16, u16),
	/// `(x, width)` per menu trigger, in `MENUS` order (right-aligned).
	pub menus: Vec<(u16, u16)>,
}

pub fn tab_bar_hits(area_width: u16, titles: &[String], active: usize) -> TabHits {
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
	// Menus right-aligned: measure from the right edge backwards.
	let widths = menu_widths();
	let total: u16 = widths.iter().sum();
	let mut menus = Vec::with_capacity(MENUS.len());
	let mut mx = area_width.saturating_sub(total);
	for (name, w) in MENUS.iter().zip(&widths) {
		menus.push((mx, *w));
		mx += w;
		let _ = name;
	}
	TabHits { prev, tabs, closes, next, plus, menus }
}

/// The tab bar row: `‹ ▸ 1 shell ×  2 zeta-c › +` … menus right-aligned.
pub struct TabBar<'a> {
	pub titles: &'a [String],
	pub active: usize,
	/// Index of the open menu, when any.
	pub open_menu: Option<usize>,
}

impl Widget for TabBar<'_> {
	fn render(self, area: Rect, buf: &mut Buffer) {
		if area.height < 1 || area.width < 3 {
			return;
		}
		let dim = Style::default().fg(Color::DarkGray);
		let active_style = Style::default().add_modifier(Modifier::BOLD | Modifier::UNDERLINED);
		let mut spans = Vec::with_capacity(self.titles.len() * 3 + 5 + MENUS.len());
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
		// Right-align menu triggers.
		let widths = menu_widths();
		let total: u16 = widths.iter().sum();
		if area.width > total {
			let mut x = area.x;
			for (span, width) in line_spans(spans.clone()) {
				if x + width > area.x + area.width - total {
					break;
				}
				buf.set_span(x, area.y, &span, width);
				x += width;
			}
			let mut mx = area.x + area.width - total;
			for (idx, ((name, _), width)) in MENUS.iter().zip(&widths).enumerate() {
				let style = if self.open_menu == Some(idx) {
					active_style
				} else {
					Style::default()
				};
				buf.set_span(mx, area.y, &Span::styled(format!(" {name} "), style), *width);
				mx += width;
			}
			return;
		}
		let mut x = area.x;
		for (span, width) in line_spans(spans) {
			if x + width > area.x + area.width {
				break;
			}
			buf.set_span(x, area.y, &span, width);
			x += width;
		}
	}
}

fn line_spans(spans: Vec<Span<'static>>) -> Vec<(Span<'static>, u16)> {
	spans
		.into_iter()
		.map(|s| {
			let w = s.width() as u16;
			(s, w)
		})
		.collect()
}

/// A dropdown menu: items stacked under the trigger, each clickable.
/// Rendered last so it overlaps pane content.
pub struct MenuDropdown {
	pub menu: usize,
	pub area: Rect,
}

impl Widget for MenuDropdown {
	fn render(self, area: Rect, buf: &mut Buffer) {
		let items = MENUS[self.menu].1;
		let trigger_width = menu_widths()[self.menu];
		let width = items
			.iter()
			.map(|item| Span::raw(format!(" {item} ")).width() as u16)
			.max()
			.unwrap_or(trigger_width)
			.max(trigger_width);
		// Clamp inside the frame.
		let x = self.area.x.min(area.width.saturating_sub(width));
		let height = (items.len() + 2) as u16; // border rows
		let y = self.area.y + 1;
		let rect = Rect { x, y, width, height };
		if rect.bottom() > area.bottom() || rect.right() > area.right() {
			return;
		}
		buf.set_style(rect, Style::default());
		let border = Style::default().fg(Color::DarkGray);
		// Frame: corners + edges.
		for col in rect.x..rect.right() {
			buf[(col, rect.y)].set_symbol("─").set_style(border);
			buf[(col, rect.bottom() - 1)]
				.set_symbol("─")
				.set_style(border);
		}
		for row in rect.y..rect.bottom() {
			buf[(rect.x, row)].set_symbol("│").set_style(border);
			buf[(rect.right() - 1, row)]
				.set_symbol("│")
				.set_style(border);
		}
		buf[(rect.x, rect.y)].set_symbol("┌").set_style(border);
		buf[(rect.right() - 1, rect.y)]
			.set_symbol("┐")
			.set_style(border);
		buf[(rect.x, rect.bottom() - 1)]
			.set_symbol("└")
			.set_style(border);
		buf[(rect.right() - 1, rect.bottom() - 1)]
			.set_symbol("┘")
			.set_style(border);
		for (idx, item) in items.iter().enumerate() {
			let line = Line::from(Span::raw(format!(" {item} ")));
			buf.set_line(rect.x + 1, rect.y + 1 + idx as u16, &line, width - 2);
		}
	}
}

/// Hit geometry for an open dropdown: `(x, y, width)` per item row.
pub fn dropdown_hits(area_width: u16, open_menu: usize, trigger_x: u16) -> Rect {
	let items = MENUS[open_menu].1;
	let trigger_width = menu_widths()[open_menu];
	let width = items
		.iter()
		.map(|item| Span::raw(format!(" {item} ")).width() as u16)
		.max()
		.unwrap_or(trigger_width)
		.max(trigger_width);
	let x = trigger_x.min(area_width.saturating_sub(width));
	Rect { x, y: 1, width, height: items.len() as u16 + 2 }
}

/// The bottom status line: focused pane + layout, no hotkey hints (keys live
/// in Help and menus).
pub fn status_text(
	pane_label: &str,
	template: &str,
	pane_index: usize,
	pane_count: usize,
) -> String {
	format!(" [{pane_label}] pane {}/{} · layout {template} ", pane_index + 1, pane_count,)
}

fn truncate(text: &str, max: usize) -> String {
	if text.chars().count() <= max {
		text.to_string()
	} else {
		let cut: String = text.chars().take(max.saturating_sub(1)).collect();
		format!("{cut}…")
	}
}
