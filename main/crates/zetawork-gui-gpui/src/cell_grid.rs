//! ratatui `Buffer` → GPUI cell-grid (blit) model.
//!
//! # Cell-width basis
//!
//! The blit takes every cell's advance from **`unicode-width` 0.2** (the crate
//! `main/Cargo.toml` path-patches to `termide/crates/unicode-width-fix`, so
//! this grid and termide's terminal grid measure CJK identically by
//! construction), and it has to: measured on ratatui 0.30.2 / ratatui-core
//! 0.1.2, **the buffer does not record how wide a grapheme is**.
//!
//! * `Buffer::set_stringn` writes the grapheme into its first cell and then
//!   `Cell::reset()`s the cells it covers
//!   (`ratatui-core/src/buffer/buffer.rs:358-368`). Those cells come back as
//!   `symbol() == " "` with `diff_option == None` — no width, no flag.
//! * The flag that used to say so, `Cell::skip`, is **deprecated since
//!   ratatui 0.30.1** (`ratatui-core/src/buffer/cell.rs:67-71`, "use
//!   `set_diff_option(CellDiffOption::Skip)` instead") and `set_stringn` no
//!   longer sets it, so a blit must not read it.
//! * `CellDiffOption::ForcedWidth(n)` is the surviving way to state a width
//!   explicitly; [`BlitGrid::from_buffer`] honours it, and falls back to
//!   `unicode-width` for every ordinary cell.
//!
//! Continuation cells are therefore *derived*: after a grapheme of width `w`,
//! the next `w - 1` cells are continuations unless they carry a symbol of their
//! own, which is counted in [`BlitGrid::wide_mismatches`] instead of being
//! swallowed.

use gpui_kit::{Hsla, Rgba};
use ratatui::buffer::{Buffer, CellDiffOption};
use ratatui::layout::Rect;
use ratatui::style::{Color as TuiColor, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, LineGauge, Paragraph, Widget};
use unicode_width::UnicodeWidthStr;

/// Foreground used for `Color::Reset`.
pub const DEFAULT_FG: Rgba = Rgba { r: 0.83, g: 0.84, b: 0.86, a: 1.0 };

/// Background used for `Color::Reset`.
pub const DEFAULT_BG: Rgba = Rgba { r: 0.08, g: 0.09, b: 0.11, a: 1.0 };

/// The xterm 16-colour palette, in ratatui's `Color` order.
const ANSI_16: [(u8, u8, u8); 16] = [
	(0x1c, 0x1c, 0x1c),
	(0xd7, 0x45, 0x45),
	(0x4c, 0xaf, 0x50),
	(0xd7, 0xa8, 0x45),
	(0x4c, 0x86, 0xdf),
	(0xb0, 0x5a, 0xd0),
	(0x3f, 0xbf, 0xbb),
	(0xd0, 0xd0, 0xd0),
	(0x7a, 0x7a, 0x7a),
	(0xf0, 0x6a, 0x6a),
	(0x7c, 0xd8, 0x7f),
	(0xf0, 0xd0, 0x6a),
	(0x7c, 0xa8, 0xf0),
	(0xd8, 0x8a, 0xf0),
	(0x6f, 0xdc, 0xd8),
	(0xff, 0xff, 0xff),
];

fn rgb(r: u8, g: u8, b: u8) -> Rgba {
	Rgba { r: f32::from(r) / 255.0, g: f32::from(g) / 255.0, b: f32::from(b) / 255.0, a: 1.0 }
}

/// The xterm-256 colour cube for `Color::Indexed(i)`.
fn xterm_256(index: u8) -> Rgba {
	match index {
		0..=15 => {
			let (r, g, b) = ANSI_16[usize::from(index)];
			rgb(r, g, b)
		},
		16..=231 => {
			let i = index - 16;
			let steps = [0u8, 95, 135, 175, 215, 255];
			rgb(
				steps[usize::from(i / 36)],
				steps[usize::from((i % 36) / 6)],
				steps[usize::from(i % 6)],
			)
		},
		_ => {
			let v = 8 + 10 * (index - 232);
			rgb(v, v, v)
		},
	}
}

/// Resolve a ratatui colour, falling back to `default` for `Color::Reset`.
pub fn resolve(color: TuiColor, default: Rgba) -> Rgba {
	match color {
		TuiColor::Reset => default,
		TuiColor::Black => rgb(ANSI_16[0].0, ANSI_16[0].1, ANSI_16[0].2),
		TuiColor::Red => rgb(ANSI_16[1].0, ANSI_16[1].1, ANSI_16[1].2),
		TuiColor::Green => rgb(ANSI_16[2].0, ANSI_16[2].1, ANSI_16[2].2),
		TuiColor::Yellow => rgb(ANSI_16[3].0, ANSI_16[3].1, ANSI_16[3].2),
		TuiColor::Blue => rgb(ANSI_16[4].0, ANSI_16[4].1, ANSI_16[4].2),
		TuiColor::Magenta => rgb(ANSI_16[5].0, ANSI_16[5].1, ANSI_16[5].2),
		TuiColor::Cyan => rgb(ANSI_16[6].0, ANSI_16[6].1, ANSI_16[6].2),
		TuiColor::Gray => rgb(ANSI_16[7].0, ANSI_16[7].1, ANSI_16[7].2),
		TuiColor::DarkGray => rgb(ANSI_16[8].0, ANSI_16[8].1, ANSI_16[8].2),
		TuiColor::LightRed => rgb(ANSI_16[9].0, ANSI_16[9].1, ANSI_16[9].2),
		TuiColor::LightGreen => rgb(ANSI_16[10].0, ANSI_16[10].1, ANSI_16[10].2),
		TuiColor::LightYellow => rgb(ANSI_16[11].0, ANSI_16[11].1, ANSI_16[11].2),
		TuiColor::LightBlue => rgb(ANSI_16[12].0, ANSI_16[12].1, ANSI_16[12].2),
		TuiColor::LightMagenta => rgb(ANSI_16[13].0, ANSI_16[13].1, ANSI_16[13].2),
		TuiColor::LightCyan => rgb(ANSI_16[14].0, ANSI_16[14].1, ANSI_16[14].2),
		TuiColor::White => rgb(ANSI_16[15].0, ANSI_16[15].1, ANSI_16[15].2),
		TuiColor::Indexed(i) => xterm_256(i),
		TuiColor::Rgb(r, g, b) => rgb(r, g, b),
	}
}

/// Everything the blit needs from a cell, resolved to plain values.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GridStyle {
	pub fg: Rgba,
	pub bg: Rgba,
	pub bold: bool,
	pub dim: bool,
	pub italic: bool,
	pub underline: bool,
	pub crossed_out: bool,
}

impl GridStyle {
	fn from_cell(fg: TuiColor, bg: TuiColor, modifier: Modifier) -> Self {
		let reversed = modifier.contains(Modifier::REVERSED);
		let mut style = Self {
			fg: resolve(fg, DEFAULT_FG),
			bg: resolve(bg, DEFAULT_BG),
			bold: modifier.contains(Modifier::BOLD),
			dim: modifier.contains(Modifier::DIM),
			italic: modifier.contains(Modifier::ITALIC),
			underline: modifier.contains(Modifier::UNDERLINED),
			crossed_out: modifier.contains(Modifier::CROSSED_OUT),
		};
		if reversed {
			core::mem::swap(&mut style.fg, &mut style.bg);
		}
		style
	}

	/// The style as a GPUI pair of colours.
	pub fn colors(&self) -> (Hsla, Hsla) {
		(self.fg.into(), self.bg.into())
	}
}

/// One cell of the blit grid.
#[derive(Clone, Debug)]
pub struct BlitCell {
	/// The grapheme cluster ratatui stored, `" "` for an empty cell, empty for
	/// a continuation cell.
	pub symbol: String,
	/// `true` when this cell is the second half of a wide grapheme that starts
	/// to its left: it owns background, no glyph.
	pub continuation: bool,
	/// Advance in terminal cells: `unicode-width` of `symbol`, `0` for a
	/// continuation, or `CellDiffOption::ForcedWidth` when ratatui said so.
	pub width: u16,
	pub style: GridStyle,
}

impl BlitCell {
	fn blank() -> Self {
		Self {
			symbol: String::from(" "),
			continuation: false,
			width: 1,
			style: GridStyle::from_cell(TuiColor::Reset, TuiColor::Reset, Modifier::empty()),
		}
	}
}

/// A row-major snapshot of a ratatui `Buffer`, ready to be drawn.
#[derive(Clone, Debug, Default)]
pub struct BlitGrid {
	pub cols: usize,
	pub rows: usize,
	cells: Vec<BlitCell>,
	/// Cells where the derived continuation run disagreed with what the buffer
	/// held (a symbol where a continuation was expected, or the other way
	/// round). Zero for every buffer ratatui's own widgets produce; a non-zero
	/// count is surfaced in the panel instead of being hidden.
	pub wide_mismatches: usize,
}

impl BlitGrid {
	pub fn cell(&self, x: usize, y: usize) -> &BlitCell {
		&self.cells[y * self.cols + x]
	}

	/// The row as text, with continuation cells dropped — the string a real
	/// terminal shows. Test-only: the panel draws cells, not rows.
	#[cfg(test)]
	pub fn row_text(&self, y: usize) -> String {
		let mut out = String::new();
		for x in 0..self.cols {
			let cell = self.cell(x, y);
			if cell.continuation {
				continue;
			}
			out.push_str(&cell.symbol);
		}
		out.trim_end().to_string()
	}

	/// Snapshot `buffer` into a grid.
	pub fn from_buffer(buffer: &Buffer) -> Self {
		let area = *buffer.area();
		let cols = usize::from(area.width);
		let rows = usize::from(area.height);
		let mut cells = Vec::with_capacity(cols * rows);
		let mut wide_mismatches = 0usize;

		for y in 0..rows {
			// How many more cells the previous wide grapheme claims, and the
			// style it claims them with: ratatui `reset()`s the covered cells,
			// but a real terminal paints the wide glyph — and its background —
			// across both halves, so a continuation inherits the first cell's
			// style instead of the reset one.
			let mut claimed = 0usize;
			let mut claimed_style: Option<GridStyle> = None;
			for x in 0..cols {
				let Some(cell) = buffer.cell((area.x + x as u16, area.y + y as u16)) else {
					claimed = claimed.saturating_sub(1);
					cells.push(BlitCell::blank());
					continue;
				};
				let style = GridStyle::from_cell(cell.fg, cell.bg, cell.modifier);
				let symbol = cell.symbol().to_string();

				// `CellDiffOption::Skip` means "something else owns this cell".
				if cell.diff_option == CellDiffOption::Skip {
					claimed = claimed.saturating_sub(1);
					cells.push(BlitCell {
						symbol: String::new(),
						continuation: true,
						width: 0,
						style: claimed_style.unwrap_or(style),
					});
					continue;
				}

				let width = match cell.diff_option {
					CellDiffOption::ForcedWidth(width) => usize::from(width.get()),
					_ => UnicodeWidthStr::width(symbol.as_str()).max(1),
				};

				if claimed > 0 {
					if symbol == " " {
						claimed -= 1;
						cells.push(BlitCell {
							symbol: String::new(),
							continuation: true,
							width: 0,
							style: claimed_style.unwrap_or(style),
						});
						continue;
					}
					// A symbol sits where the wide grapheme said its second
					// half was: keep the symbol and report the disagreement.
					wide_mismatches += 1;
				}

				claimed = width.saturating_sub(1);
				claimed_style = if claimed > 0 { Some(style) } else { None };
				cells.push(BlitCell {
					symbol,
					continuation: false,
					width: u16::try_from(width).unwrap_or(u16::MAX),
					style,
				});
			}
		}

		Self { cols, rows, cells, wide_mismatches }
	}
}

/// A ratatui render that needs no terminal: three widgets into a plain
/// `Buffer` — a rounded, coloured border, coloured spans including a CJK wide
/// character, and a `LineGauge`.
pub fn demo_buffer(cols: u16, rows: u16) -> Buffer {
	let area = Rect::new(0, 0, cols, rows);
	let mut buffer = Buffer::empty(area);
	if cols < 12 || rows < 6 {
		return buffer;
	}

	let outer = Block::bordered()
		.border_type(BorderType::Rounded)
		.border_style(Style::new().fg(TuiColor::Cyan))
		.title(Span::styled(
			" ratatui 0.30 缓冲区 → GPUI 面板 ",
			Style::new().fg(TuiColor::LightYellow).bold(),
		));
	let inner = outer.inner(area);
	outer.render(area, &mut buffer);

	let body = Rect::new(inner.x, inner.y, inner.width, inner.height.saturating_sub(3));
	let lines = vec![
		Line::from(vec![
			Span::styled("普通 ASCII: ", Style::new().fg(TuiColor::Gray)),
			Span::styled("Hello, termide!", Style::new().fg(TuiColor::LightGreen)),
		]),
		Line::from(vec![
			Span::styled("CJK 宽字符: ", Style::new().fg(TuiColor::Gray)),
			Span::styled("中文｜对齐｜测试", Style::new().fg(TuiColor::LightCyan).bold()),
		]),
		Line::from(vec![
			Span::styled("混排: ", Style::new().fg(TuiColor::Gray)),
			Span::styled("abc中def", Style::new().fg(TuiColor::LightMagenta)),
			Span::styled(" ← 宽 2 格", Style::new().fg(TuiColor::DarkGray)),
		]),
		Line::from(vec![
			Span::styled("索引色: ", Style::new().fg(TuiColor::Gray)),
			Span::styled("●", Style::new().fg(TuiColor::Indexed(208))),
			Span::styled(" ●", Style::new().fg(TuiColor::Indexed(39))),
			Span::styled(" ●", Style::new().fg(TuiColor::Rgb(120, 220, 160))),
			Span::styled("  反色段", Style::new().fg(TuiColor::Black).bg(TuiColor::Yellow)),
		]),
	];
	Paragraph::new(lines).render(body, &mut buffer);

	if inner.height >= 4 {
		let gauge_area = Rect::new(inner.x, inner.y + inner.height - 2, inner.width, 1);
		LineGauge::default()
			.ratio(0.42)
			.label(Span::styled(" 上下文 42% ", Style::new().fg(TuiColor::LightBlue)))
			.filled_style(Style::new().fg(TuiColor::LightBlue))
			.render(gauge_area, &mut buffer);
	}

	buffer
}

#[cfg(test)]
mod tests {
	use super::*;
	use core::num::NonZeroU16;
	use ratatui::widgets::Widget;

	#[test]
	fn cjk_wide_char_takes_two_cells_wide() {
		// The width basis itself: the crate the workspace path-patches.
		assert_eq!(UnicodeWidthStr::width("中"), 2);
		assert_eq!(UnicodeWidthStr::width("A"), 1);
	}

	#[test]
	fn ratatui_0_30_does_not_record_wide_cell_continuations() {
		// The finding the blit is built on: `set_stringn` resets the covered
		// cells and marks nothing, so the consumer must derive the width.
		let area = Rect::new(0, 0, 12, 1);
		let mut buffer = Buffer::empty(area);
		buffer.set_string(0, 0, "中文A中", Style::new().fg(TuiColor::LightCyan).bg(TuiColor::Black));

		assert_eq!(buffer.cell((0, 0)).unwrap().symbol(), "中");
		assert_eq!(buffer.cell((1, 0)).unwrap().symbol(), " ");
		assert_eq!(
			buffer.cell((1, 0)).unwrap().diff_option,
			CellDiffOption::None,
			"the continuation cell carries no width and no flag"
		);
		assert_eq!(buffer.cell((2, 0)).unwrap().symbol(), "文");
		assert_eq!(buffer.cell((3, 0)).unwrap().symbol(), " ");
		assert_eq!(buffer.cell((4, 0)).unwrap().symbol(), "A");
		assert_eq!(buffer.cell((5, 0)).unwrap().symbol(), "中");
		assert_eq!(buffer.cell((6, 0)).unwrap().symbol(), " ");
	}

	#[test]
	fn blit_grid_derives_cjk_continuations_and_keeps_columns_aligned() {
		let area = Rect::new(0, 0, 12, 1);
		let mut buffer = Buffer::empty(area);
		buffer.set_string(0, 0, "中文A中", Style::new().fg(TuiColor::LightCyan).bg(TuiColor::Black));

		let grid = BlitGrid::from_buffer(&buffer);
		assert_eq!(grid.wide_mismatches, 0);

		assert_eq!(grid.cell(0, 0).symbol, "中");
		assert_eq!(grid.cell(0, 0).width, 2);
		assert!(!grid.cell(0, 0).continuation);
		assert!(grid.cell(1, 0).continuation, "2nd half of 中");
		assert_eq!(grid.cell(1, 0).width, 0);

		assert_eq!(grid.cell(2, 0).symbol, "文");
		assert_eq!(grid.cell(2, 0).width, 2);
		assert!(grid.cell(3, 0).continuation);

		// Column maths: 中(0,1) 文(2,3) A(4) 中(5,6)
		assert_eq!(grid.cell(4, 0).symbol, "A");
		assert_eq!(grid.cell(4, 0).width, 1);
		assert!(!grid.cell(4, 0).continuation);
		assert_eq!(grid.cell(5, 0).symbol, "中");
		assert_eq!(grid.cell(5, 0).width, 2);
		assert!(grid.cell(6, 0).continuation);
		assert_eq!(grid.row_text(0), "中文A中");

		// The wide grapheme and its continuation share the first cell's style.
		let fg = resolve(TuiColor::LightCyan, DEFAULT_FG);
		let bg = resolve(TuiColor::Black, DEFAULT_BG);
		assert_eq!(grid.cell(0, 0).style.fg, fg);
		assert_eq!(grid.cell(1, 0).style.fg, fg);
		assert_eq!(grid.cell(0, 0).style.bg, bg);
	}

	#[test]
	fn a_symbol_written_into_a_wide_cells_second_half_is_kept_and_reported() {
		let area = Rect::new(0, 0, 8, 1);
		let mut buffer = Buffer::empty(area);
		buffer.set_string(0, 0, "中", Style::default());
		// A careless caller writes into the cell 中 covers.
		buffer.set_string(1, 0, "X", Style::default());

		let grid = BlitGrid::from_buffer(&buffer);
		assert_eq!(grid.wide_mismatches, 1, "reported, not swallowed");
		assert_eq!(grid.cell(1, 0).symbol, "X");
		assert!(!grid.cell(1, 0).continuation);
	}

	#[test]
	fn forced_width_and_skip_diff_options_are_honoured() {
		let area = Rect::new(0, 0, 8, 1);
		let mut buffer = Buffer::empty(area);
		buffer.set_string(0, 0, "abcde", Style::default());
		buffer
			.cell_mut((0, 0))
			.unwrap()
			.set_diff_option(CellDiffOption::ForcedWidth(NonZeroU16::new(3).expect("3 is not zero")));
		buffer
			.cell_mut((3, 0))
			.unwrap()
			.set_diff_option(CellDiffOption::Skip);

		let grid = BlitGrid::from_buffer(&buffer);
		assert_eq!(grid.cell(0, 0).symbol, "a");
		assert_eq!(grid.cell(0, 0).width, 3, "the forced width is the advance");
		// The forced cell claims 3 columns but ratatui left `b` in the next one,
		// so the disagreement is reported instead of the symbol being dropped.
		assert_eq!(grid.wide_mismatches, 1);
		assert!(!grid.cell(1, 0).continuation);
		assert_eq!(grid.cell(1, 0).symbol, "b");
		// `Skip` is the diff option that does hide a cell.
		assert!(grid.cell(3, 0).continuation);
		assert_eq!(grid.cell(4, 0).symbol, "e");
	}

	#[test]
	fn demo_buffer_renders_border_colour_and_cjk_through_ratatui() {
		let buffer = demo_buffer(60, 12);
		let grid = BlitGrid::from_buffer(&buffer);
		assert_eq!(grid.wide_mismatches, 0, "ratatui and unicode-width agree");

		// Rounded border corner from `Block::bordered()`.
		assert_eq!(grid.cell(0, 0).symbol, "╭");
		// The title is CJK-bearing, so the title row must contain a 2-wide cell.
		let title_widths: Vec<u16> = (0..60).map(|x| grid.cell(x, 0).width).collect();
		assert!(title_widths.contains(&2), "title row has a wide glyph: {title_widths:?}");

		let rows: Vec<String> = (0..12).map(|y| grid.row_text(y)).collect();
		assert!(
			rows.iter().any(|r| r.contains("中文｜对齐｜测试")),
			"CJK row survived the blit: {rows:#?}"
		);
		assert!(rows.iter().any(|r| r.contains("abc中def ← 宽 2 格")));
	}

	#[test]
	fn a_paragraph_of_cjk_keeps_later_columns_aligned() {
		// 6 wide glyphs = 12 columns; the ASCII that follows must start at 12.
		let area = Rect::new(0, 0, 20, 1);
		let mut buffer = Buffer::empty(area);
		let text = "中文中文中文X";
		Paragraph::new(text).render(area, &mut buffer);
		let grid = BlitGrid::from_buffer(&buffer);
		assert_eq!(grid.cell(12, 0).symbol, "X");
		assert_eq!(grid.row_text(0), text);
	}
}
