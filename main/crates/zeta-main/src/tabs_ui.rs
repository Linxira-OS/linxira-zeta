//! Top chrome, two rows: the menu bar (row 0) and the tab bar (row 1) —
//! per the product sketch. Both publish their geometry through layout
//! helpers shared by rendering and mouse hit-testing, so clicks always agree
//! with what is on screen. The chrome carries no hotkey hints; keys live in
//! the help overlay.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;

/// Top-level menus. `Settings` opens the settings surface (roadmap);
/// `Help` shows the keymap overlay.
pub const MENUS: &[(&str, &[&str])] = &[
	("File", &["New tab", "Close tab", "Quit"]),
	(
		"Pane",
		&[
			"💻 Split shell",
			"🤖 Split zetacode",
			"📝 Split zetaeditor",
			"🧩 Split zetaide",
			"🕒 Time · calendar",
			"🍅 Pomodoro",
			"📋 Clipboard",
			"➕ New subtab",
			"🗕 Minimize pane",
			"❌ Close pane",
		],
	),
	("Tab", &["Next tab", "Previous tab"]),
	(
		"Tools",
		&[
			"Layout single",
			"Layout 1+2 (⅓|⅔)",
			"Layout thirds",
			"Layout T",
			"Layout quad",
			"Layout columns (⅓|⅔)",
			"Equalize",
			"Focus next pane",
			"📦 Install missing",
		],
	),
	("Settings", &["Settings", "Suite status", "Help"]),
];

/// Menu bar row: left-aligned triggers. Layout helper shared by render and
/// hit-testing.
pub fn menu_layout(width: u16) -> Vec<(&'static str, u16, u16)> {
	let mut boxes = Vec::with_capacity(MENUS.len());
	let mut x = 1u16;
	for (name, _) in MENUS {
		let w = Span::raw(format!(" {name} ")).width() as u16;
		if x + w > width {
			break;
		}
		boxes.push((*name, x, w));
		x += w;
	}
	boxes
}

/// The menu bar (row 0).
pub struct MenuBar {
	pub open: Option<usize>,
}

impl Widget for MenuBar {
	fn render(self, area: Rect, buf: &mut Buffer) {
		if area.height < 1 {
			return;
		}
		let active = Style::default().add_modifier(Modifier::BOLD | Modifier::UNDERLINED);
		for (name, x, w) in menu_layout(area.width) {
			let idx = MENUS.iter().position(|(n, _)| *n == name).unwrap_or(0);
			let style = if self.open == Some(idx) {
				active
			} else {
				Style::default()
			};
			buf.set_span(area.x + x, area.y, &Span::styled(format!(" {name} "), style), w);
		}
	}
}

/// A dropdown: items stacked under the trigger, rendered as the topmost
/// layer. Item hit boxes come from [`item_rects`].
pub struct MenuDropdown {
	pub menu: usize,
	pub trigger_x: u16,
}

impl MenuDropdown {
	fn rect(&self, frame: Rect) -> Rect {
		let items = MENUS[self.menu].1;
		// +2 beyond the padded text: the render draws " item " (already
		// padded) into width-2 columns, so width = padded_max + 2 is the
		// minimum that never clips the longest item's tail.
		let width = items
			.iter()
			.map(|item| Span::raw(format!(" {item} ")).width() as u16)
			.max()
			.unwrap_or(8)
			.max(10)
			+ 2;
		// Never wider than the screen: on a narrow terminal an overflowing
		// dropdown is skipped by render's fit guard while the hit rects would
		// still be pushed — invisible click targets.
		let width = width.min(frame.width.saturating_sub(2)).max(10);
		let x = self.trigger_x.min(frame.width.saturating_sub(width + 1));
		Rect { x, y: 1, width, height: items.len() as u16 + 2 }
	}

	/// Item row rects, absolute, in item order — the click path uses these.
	pub fn item_rects(&self, frame: Rect) -> Vec<Rect> {
		let rect = self.rect(frame);
		MENUS[self.menu]
			.1
			.iter()
			.enumerate()
			.map(|(idx, _)| Rect {
				x: rect.x + 1,
				y: rect.y + 1 + idx as u16,
				width: rect.width - 2,
				height: 1,
			})
			.collect()
	}
}

impl Widget for MenuDropdown {
	fn render(self, area: Rect, buf: &mut Buffer) {
		let rect = self.rect(area);
		if rect.bottom() > area.bottom() || rect.right() > area.right() {
			return;
		}
		// Opaque surface: the diff renderer only repaints changed cells, so
		// without this the dropdown interior still holds the previous
		// frame's pane text and bleeds through. Reset every cell to the
		// terminal default first — theme-neutral and fully opaque.
		for row in rect.y..rect.bottom() {
			for col in rect.x..rect.right() {
				buf[(col, row)].reset();
			}
		}
		let border = Style::default().fg(Color::DarkGray);
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
		for (idx, item) in MENUS[self.menu].1.iter().enumerate() {
			let line = Line::from(Span::raw(format!(" {item} ")));
			buf.set_line(rect.x + 1, rect.y + 1 + idx as u16, &line, rect.width - 2);
		}
	}
}

/// Tab-row geometry shared by render and hit-testing. Labels shrink to fit —
/// the collapse behavior for many tabs.
pub struct TabLayout {
	pub prev: (u16, u16),
	/// (label drawn, x, width) per tab.
	pub tabs: Vec<(String, u16, u16)>,
	/// Close box of the active tab, if the row fits it.
	pub active_close: Option<(u16, u16)>,
	pub next: (u16, u16),
	pub plus: (u16, u16),
}

pub fn tab_layout(width: u16, count: usize, active: usize) -> TabLayout {
	// Fixed furniture: " ‹" + " ›" + " +" = 6 cells; active close "×" = 1.
	let fixed = 7u16;
	let per = if count == 0 {
		0
	} else {
		(width.saturating_sub(fixed) / count as u16).max(2)
	};
	let mut x = 0u16;
	let prev = (x, 2);
	x += 2;
	let mut tabs = Vec::with_capacity(count);
	let mut active_close = None;
	for idx in 0..count {
		let raw = if idx == active {
			format!("▸ {}:tab ", idx + 1)
		} else {
			format!(" {}:tab ", idx + 1)
		};
		let label = if per <= 3 {
			format!("{} ", idx + 1)
		} else {
			truncate(&raw, per as usize)
		};
		let w = Span::raw(label.clone()).width() as u16;
		tabs.push((label, x, w));
		x += w;
		if idx == active {
			active_close = Some((x, 1));
			x += 1; // "×"
		}
	}
	let next = (x, 2);
	x += 2;
	let plus = (x, 2);
	TabLayout { prev, tabs, active_close, next, plus }
}

/// The tab bar (row 1): `‹ ▸1:tab × 2:tab › +`. Wheel switching is handled
/// by the app (scroll over this row). Active tab: ▸ + bold/underline + ×.
pub struct TabBar {
	pub layout: TabLayout,
	pub active: usize,
}

impl Widget for TabBar {
	fn render(self, area: Rect, buf: &mut Buffer) {
		if area.height < 1 {
			return;
		}
		let dim = Style::default().fg(Color::DarkGray);
		let active = Style::default().add_modifier(Modifier::BOLD | Modifier::UNDERLINED);
		let layout = self.layout;
		let mut x = area.x;
		let mut put = |x: &mut u16, text: &str, style: Style| {
			let w = Span::raw(text.to_string()).width() as u16;
			if *x + w <= area.x + area.width {
				buf.set_span(*x, area.y, &Span::styled(text.to_string(), style), w);
			}
			*x += w;
		};
		put(&mut x, " ‹", dim);
		for (idx, (label, _, _)) in layout.tabs.iter().enumerate() {
			let style = if idx == self.active { active } else { dim };
			put(&mut x, label, style);
			if idx == self.active {
				put(&mut x, "×", Style::default().add_modifier(Modifier::BOLD));
			}
		}
		put(&mut x, " ›", dim);
		put(&mut x, " +", dim);
	}
}

/// The bottom status line: focused pane + layout, no hotkey hints.
pub fn status_text(
	pane_label: &str,
	template: &str,
	pane_index: usize,
	pane_count: usize,
) -> String {
	format!(" [{pane_label}] pane {}/{} · layout {template} ", pane_index + 1, pane_count)
}

/// Truncate to a **display-column** budget (CJK and emoji are 2 columns),
/// marking the cut with a 1-column ellipsis. Callers pass column budgets, so
/// a chars()-based cut used to overflow the rect for wide glyphs.
pub fn truncate(text: &str, max: usize) -> String {
	if max == 0 {
		return String::new();
	}
	let width = Span::raw(text).width();
	if width <= max {
		return text.to_string();
	}
	let budget = max.saturating_sub(1); // reserve one column for the ellipsis
	let mut cut = String::new();
	let mut used = 0usize;
	for ch in text.chars() {
		let w = Span::raw(ch.to_string()).width();
		if used + w > budget {
			break;
		}
		cut.push(ch);
		used += w;
	}
	format!("{cut}…")
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn truncate_respects_display_columns_for_wide_glyphs() {
		// CJK: 3 chars are 6 columns; a 5-column budget keeps 2 chars + ellipsis.
		let out = truncate("日历视图", 5);
		assert_eq!(Span::raw(&out).width(), 5);
		assert!(out.ends_with('…'));

		// Emoji are 2 columns: a 12-col label into 8 keeps 7 cols + ellipsis.
		let out = truncate("🍅 pomodoro", 8);
		assert_eq!(Span::raw(&out).width(), 8);

		// ASCII unchanged when it fits.
		assert_eq!(truncate("shell", 12), "shell");

		// Zero budget is empty, one column is just the ellipsis.
		assert_eq!(truncate("abc", 0), "");
		assert_eq!(truncate("abc", 1), "…");
	}

	#[test]
	fn dropdown_never_exceeds_the_screen() {
		let frame = Rect { x: 0, y: 0, width: 24, height: 20 };
		let dd = MenuDropdown { menu: 1, trigger_x: 1 };
		let rect = dd.rect(frame);
		assert!(rect.right() <= frame.right(), "dropdown {} overflows {}", rect.width, frame.width);
		let rects = dd.item_rects(frame);
		assert_eq!(rects.len(), MENUS[1].1.len());
		for r in &rects {
			assert!(r.right() <= frame.right());
		}
	}

	#[test]
	fn menu_layout_is_left_aligned_and_in_order() {
		let boxes = menu_layout(120);
		assert_eq!(boxes.len(), MENUS.len());
		assert!(boxes[0].1 > 0);
		for w in boxes.windows(2) {
			assert!(w[0].1 + w[0].2 <= w[1].1, "menus run left to right");
		}
	}

	#[test]
	fn tab_layout_shrinks_labels_when_crowded() {
		let wide = tab_layout(200, 3, 0);
		assert!(wide.tabs[0].2 >= 8, "plenty of room: full labels");
		let narrow = tab_layout(40, 12, 2);
		let total: u16 = narrow.tabs.iter().map(|(_, _, w)| w).sum::<u16>() + 7;
		assert!(total <= 40, "crowded row collapses into the available width");
		assert_eq!(narrow.tabs.len(), 12);
	}

	#[test]
	fn dropdown_items_live_below_the_trigger() {
		let dd = MenuDropdown { menu: 0, trigger_x: 10 };
		let frame = Rect::new(0, 0, 120, 40);
		let rects = dd.item_rects(frame);
		assert_eq!(rects.len(), MENUS[0].1.len());
		assert_eq!(rects[0].y, 2, "first item under the border row");
	}
}
