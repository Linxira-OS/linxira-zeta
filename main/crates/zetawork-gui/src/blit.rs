//! Offscreen ratatui rendering and its blit into an egui painter.
//!
//! # Cell-width basis (the thing this repo has been bitten by before)
//!
//! Every width on this path comes from `unicode_width::UnicodeWidthStr::width`
//! — exactly the call `ratatui_core::buffer::CellWidth::cell_width` makes
//! (`ratatui-core-0.1.2 src/buffer/cell_width.rs:34`). Because
//! `main/Cargo.toml` patches `unicode-width` to
//! `termide/crates/unicode-width-fix`, the whole workspace resolves *one*
//! build of that crate, so a wide grapheme is two grid columns here exactly
//! when ratatui says so. The grid font is the CJK face itself
//! (`GRID_FAMILY`), whose half-width ASCII advance is half its full-width CJK
//! advance, so `advance('中') == 2 * advance('0')` holds and the two halves
//! line up without per-glyph fitting.
//!
//! # Wide cells and `skip`
//!
//! Two conventions exist side by side and both are honoured:
//!
//! * `ratatui` 0.30.2's own `Buffer::set_stringn` writes the wide grapheme in
//!   one cell and *resets* the following cell (blank), while
//!   `Buffer::diff`/`Display` skip `cell_width - 1` trailing cells.
//! * termide marks the trailing cell explicitly with `Cell::skip` (deprecated
//!   in 0.30.2, see `termide/crates/core/src/wide_cells.rs`), and
//!   [`render`] applies termide's fix-up so a variation-selector emoji's tail
//!   is skipped. A skipped cell is never painted, otherwise a blank would be
//!   stamped over the glyph's second half and everything after it would shift.

use std::cell::RefCell;
use std::convert::Infallible;
use std::rc::Rc;

use egui::{Align2, Color32, CornerRadius, FontFamily, FontId, Painter, Pos2, Rect as ERect, Ui};
use ratatui::backend::{Backend, ClearType, WindowSize};
use ratatui::buffer::Buffer;
use ratatui::layout::{Position, Rect, Size};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Gauge, Paragraph};
use ratatui::{Frame, Terminal};
use unicode_width::UnicodeWidthStr;

/// Font family whose ASCII advance is half its CJK advance (installed by
/// `crate::install_grid_fonts`).
pub const GRID_FAMILY: &str = "zeta-cjk-mono";

/// The string the geometry test walks cell by cell: two wide graphemes with
/// ASCII between them, so an off-by-one shows up immediately.
pub const WIDE_PROBE: &str = "中a文b✓";

/// Foreground used by the probe line of [`demo_terminal`]; the screenshot test
/// looks for this ink inside the blitted panel.
pub const PROBE_INK: Color = Color::Rgb(163, 190, 140);

/// Border/title colour of [`demo_terminal`].
pub const FRAME_INK: Color = Color::Rgb(94, 129, 172);

/// Cell surface shared between the offscreen [`BufferBackend`] and its owner.
#[derive(Clone)]
pub struct CellSurface(Rc<RefCell<Buffer>>);

impl CellSurface {
	fn new(width: u16, height: u16) -> Self {
		let width = width.max(1);
		let height = height.max(1);
		Self(Rc::new(RefCell::new(Buffer::empty(Rect::new(0, 0, width, height)))))
	}

	/// The rendered cells, cloned out so the caller does not keep the borrow.
	pub fn snapshot(&self) -> Buffer {
		self.0.borrow().clone()
	}

	fn with<R>(&self, f: impl FnOnce(&mut Buffer) -> R) -> R {
		f(&mut self.0.borrow_mut())
	}
}

/// A ratatui [`Backend`] with no terminal attached: every update the
/// [`Terminal`] diffs out lands in the shared [`CellSurface`].
pub struct BufferBackend {
	surface: CellSurface,
	cursor: Position,
	hidden: bool,
}

impl BufferBackend {
	pub fn new(surface: CellSurface) -> Self {
		Self { surface, cursor: Position { x: 0, y: 0 }, hidden: true }
	}
}

impl Backend for BufferBackend {
	type Error = Infallible;

	fn draw<'a, I>(&mut self, content: I) -> Result<(), Self::Error>
	where
		I: Iterator<Item = (u16, u16, &'a ratatui::buffer::Cell)>,
	{
		self.surface.with(|buffer| {
			for (x, y, cell) in content {
				buffer[(x, y)] = cell.clone();
			}
		});
		Ok(())
	}

	fn hide_cursor(&mut self) -> Result<(), Self::Error> {
		self.hidden = true;
		Ok(())
	}

	fn show_cursor(&mut self) -> Result<(), Self::Error> {
		self.hidden = false;
		Ok(())
	}

	fn get_cursor_position(&mut self) -> Result<Position, Self::Error> {
		Ok(self.cursor)
	}

	fn set_cursor_position<P: Into<Position>>(&mut self, position: P) -> Result<(), Self::Error> {
		self.cursor = position.into();
		Ok(())
	}

	fn clear(&mut self) -> Result<(), Self::Error> {
		self.surface.with(Buffer::reset);
		Ok(())
	}

	fn clear_region(&mut self, _clear_type: ClearType) -> Result<(), Self::Error> {
		self.clear()
	}

	fn size(&self) -> Result<Size, Self::Error> {
		Ok(self.surface.with(|buffer| buffer.area.as_size()))
	}

	fn window_size(&mut self) -> Result<WindowSize, Self::Error> {
		let size = self.surface.with(|buffer| buffer.area.as_size());
		Ok(WindowSize { columns_rows: size, pixels: Size::new(u16::MAX, u16::MAX) })
	}

	fn flush(&mut self) -> Result<(), Self::Error> {
		Ok(())
	}
}

/// Render `draw` into a `width x height` cell grid with no terminal in the
/// loop, then apply termide's wide-grapheme fix-up.
pub fn render<F>(width: u16, height: u16, draw: F) -> Buffer
where
	F: FnOnce(&mut Frame<'_>),
{
	let surface = CellSurface::new(width, height);
	let backend = BufferBackend::new(surface.clone());
	let mut terminal = Terminal::new(backend).expect("offscreen terminal");
	terminal.draw(draw).expect("offscreen frame");
	let mut buffer = surface.snapshot();
	termide_core::mark_variation_selector_tails(&mut buffer);
	buffer
}

/// The pane content the spike blits: borders, a title, coloured spans, one
/// wide-CJK line, a background-coloured chip and a gauge.
pub fn demo_terminal(width: u16, height: u16) -> Buffer {
	render(width, height, |frame| {
		let area = frame.area();
		let block = Block::new()
			.borders(Borders::ALL)
			.border_style(Style::new().fg(FRAME_INK))
			.title_top(Line::from(vec![
				Span::styled(" ζ ", Style::new().fg(Color::Rgb(136, 192, 208))),
				Span::styled(
					"termide · 面板终端（无终端渲染 → egui blit）",
					Style::new().fg(Color::Rgb(216, 222, 233)),
				),
			]));
		let inner = block.inner(area);
		frame.render_widget(block, area);
		if inner.height == 0 || inner.width == 0 {
			return;
		}
		let gauge_rows = u16::from(inner.height > 3) * 2;
		let text_rows = inner.height.saturating_sub(gauge_rows);
		let body = Rect { x: inner.x, y: inner.y, width: inner.width, height: text_rows };
		let lines = vec![
			Line::from(vec![
				Span::styled("ζ zetacode ", Style::new().fg(Color::Rgb(136, 192, 208))),
				Span::styled("› ", Style::new().fg(Color::Rgb(76, 86, 106))),
				Span::styled("宽字符单元对齐检查：", Style::new().fg(PROBE_INK)),
				Span::styled(WIDE_PROBE, Style::new().fg(PROBE_INK)),
				Span::styled(" ← 中/文 各占 2 格", Style::new().fg(Color::Rgb(143, 188, 187))),
			]),
			Line::from(vec![
				Span::styled("[tool] ", Style::new().fg(Color::Rgb(76, 86, 106))),
				Span::styled("Read ", Style::new().fg(Color::Rgb(163, 190, 140))),
				Span::styled(
					"main/crates/zeta-main/src/app.rs",
					Style::new().fg(Color::Rgb(216, 222, 233)),
				),
				Span::styled(" · 120 行", Style::new().fg(Color::Rgb(143, 188, 187))),
			]),
			Line::from(vec![
				Span::styled("warn: ", Style::new().fg(Color::Rgb(235, 203, 139))),
				Span::styled(
					"冷启动 812ms · RSS 96MB · 布局 1440x900",
					Style::new().fg(Color::Rgb(216, 222, 233)),
				),
			]),
			Line::from(vec![
				Span::styled("error: ", Style::new().fg(Color::Rgb(191, 97, 106))),
				Span::styled(
					"示例错误行（颜色 + 边框证据）",
					Style::new().fg(Color::Rgb(216, 222, 233)),
				),
			]),
			Line::from(vec![
				Span::styled(
					" 状态 ",
					Style::new()
						.bg(Color::Rgb(46, 52, 64))
						.fg(Color::Rgb(235, 203, 139)),
				),
				Span::styled(
					" 背景色 chip ",
					Style::new()
						.bg(Color::Rgb(59, 66, 82))
						.fg(Color::Rgb(216, 222, 233)),
				),
				Span::styled(" 默认 ", Style::new()),
			]),
		];
		frame.render_widget(Paragraph::new(lines), body);
		if gauge_rows > 0 {
			let bar = Rect { x: inner.x, y: inner.y + text_rows + 1, width: inner.width, height: 1 };
			frame.render_widget(
				Gauge::default()
					.ratio(0.127)
					.label("上下文 12.7%（阈值 80%）")
					.gauge_style(
						Style::new()
							.fg(Color::Rgb(163, 190, 140))
							.bg(Color::Rgb(59, 66, 82)),
					),
				bar,
			);
		}
	})
}

/// Deterministic grid used by the geometry test: `WIDE_PROBE` on row 1,
/// starting at column 2, plus a marker on the same row far to the right.
pub fn layout_probe_buffer(width: u16, height: u16) -> Buffer {
	render(width, height, |frame| {
		let buffer = frame.buffer_mut();
		buffer.set_string(2, 1, WIDE_PROBE, Style::new().fg(PROBE_INK));
		buffer.set_string(width.saturating_sub(3), 1, "|", Style::new());
	})
}

/// Advance measurement of the grid font, in points.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FontProbe {
	pub ascii_advance: f32,
	pub space_advance: f32,
	pub cjk_advance: f32,
	pub row_height: f32,
	pub has_cjk_glyphs: bool,
	pub cjk_cells: usize,
}

impl FontProbe {
	/// Measured `advance('中') / advance('0')`; 2.0 means a wide grapheme
	/// covers exactly two grid columns.
	pub fn cjk_ratio(&self) -> f32 {
		if self.ascii_advance > 0.0 {
			self.cjk_advance / self.ascii_advance
		} else {
			0.0
		}
	}
}

/// Measure an arbitrary font through egui's font stack.
///
/// `glyph_width`/`row_height`/`has_glyphs` take `&mut FontsView`, hence
/// `Context::fonts_mut`. Used both for the grid font and to prove that egui's
/// *default* font set carries no CJK glyphs.
pub fn probe_font(ctx: &egui::Context, font: &FontId) -> FontProbe {
	ctx.fonts_mut(|fonts| FontProbe {
		ascii_advance: fonts.glyph_width(font, '0'),
		space_advance: fonts.glyph_width(font, ' '),
		cjk_advance: fonts.glyph_width(font, '中'),
		row_height: fonts.row_height(font),
		has_cjk_glyphs: fonts.has_glyphs(font, "中文宽字符"),
		cjk_cells: UnicodeWidthStr::width("中"),
	})
}

/// Measure the grid font (the one the blit advances cells with).
pub fn probe_grid_font(ctx: &egui::Context, size: f32) -> FontProbe {
	probe_font(ctx, &grid_font_for(ctx, size))
}

/// The grid font used for blitting: the CJK grid family once
/// [`crate::install_grid_fonts`] has been applied, egui's default monospace
/// before that.
///
/// The fallback matters: `set_fonts` only takes effect at the start of the next
/// frame, and asking egui for a `FontFamily::Name` that is not bound yet panics
/// — so the very first frame after startup must use a family that exists.
pub fn grid_font_for(ctx: &egui::Context, size: f32) -> FontId {
	let named = FontFamily::Name(GRID_FAMILY.into());
	let bound = ctx.fonts_mut(|fonts| fonts.definitions().families.contains_key(&named));
	if bound {
		FontId::new(size, named)
	} else {
		FontId::monospace(size)
	}
}

/// Layout of the cell grid inside an egui panel.
#[derive(Clone, Debug)]
pub struct GridMetrics {
	pub origin: Pos2,
	/// The exact font the metrics below were measured with, so the painter and
	/// the grid math can never disagree (first frame: the fallback monospace).
	pub font: FontId,
	pub cell_w: f32,
	pub cell_h: f32,
	pub cols: u16,
	pub rows: u16,
	pub font_size: f32,
}

impl GridMetrics {
	/// Derive the grid from the space the panel actually gives us, the way a
	/// terminal pane does: cell size from the font, count from the rect.
	pub fn for_panel(ctx: &egui::Context, rect: ERect, font_size: f32) -> Self {
		let font = grid_font_for(ctx, font_size);
		let (cell_w, cell_h) =
			ctx.fonts_mut(|fonts| (fonts.glyph_width(&font, '0'), fonts.row_height(&font)));
		let cell_w = if cell_w > 0.0 {
			cell_w
		} else {
			font_size * 0.6
		};
		let cell_h = if cell_h > 0.0 {
			cell_h
		} else {
			font_size * 1.2
		};
		let cols = (rect.width() / cell_w).floor().max(0.0) as u16;
		let rows = (rect.height() / cell_h).floor().max(0.0) as u16;
		Self { origin: rect.min, font, cell_w, cell_h, cols, rows, font_size }
	}

	pub fn size(&self) -> egui::Vec2 {
		egui::vec2(f32::from(self.cols) * self.cell_w, f32::from(self.rows) * self.cell_h)
	}

	pub fn describe(&self) -> String {
		format!(
			"{}×{} 格 · cell {:.2}×{:.2} pt · font {:.0}pt",
			self.cols, self.rows, self.cell_w, self.cell_h, self.font_size
		)
	}
}

/// The cells [`paint_buffer`] would paint on `row`, as
/// `(column, cell, columns_spanned)`.
///
/// This *is* the advance rule: a cell whose symbol is `w` columns wide
/// consumes `w` grid columns and the cells it covers are never painted
/// (mirroring `Buffer::diff`, which skips `cell_width - 1` trailing cells).
/// Cells flagged `skip` (termide's wide-grapheme tails) are dropped.
#[allow(deprecated)] // `Cell::skip` is deprecated in ratatui 0.30.2 but is still the flag termide sets.
pub fn painted_cells(
	buffer: &Buffer,
	row: u16,
	max_cols: u16,
) -> Vec<(u16, &ratatui::buffer::Cell, u16)> {
	let mut painted = Vec::new();
	if row >= buffer.area.height || max_cols == 0 {
		return painted;
	}
	let mut col = 0u16;
	while col < buffer.area.width.min(max_cols) {
		let cell = &buffer[(col, row)];
		if cell.skip {
			col += 1;
			continue;
		}
		let width = (UnicodeWidthStr::width(cell.symbol()).max(1)) as u16;
		painted.push((col, cell, width));
		col = col.saturating_add(width);
	}
	painted
}

/// Paint a ratatui [`Buffer`] as a cell grid, one [`painted_cells`] run per row.
pub fn paint_buffer(ui: &mut Ui, buffer: &Buffer, metrics: &GridMetrics, default_fg: Color32) {
	let painter: Painter = ui.painter_at(ERect::from_min_size(metrics.origin, metrics.size()));
	let font = metrics.font.clone();
	for row in 0..buffer.area.height.min(metrics.rows) {
		for (col, cell, width) in painted_cells(buffer, row, metrics.cols) {
			let at = metrics.origin
				+ egui::vec2(f32::from(col) * metrics.cell_w, f32::from(row) * metrics.cell_h);
			if let Some(fill) = background_of(cell) {
				painter.rect_filled(
					ERect::from_min_size(
						at,
						egui::vec2(f32::from(width) * metrics.cell_w, metrics.cell_h),
					),
					CornerRadius::ZERO,
					fill,
				);
			}
			let symbol = cell.symbol();
			if !symbol.is_empty() && symbol != " " {
				painter.text(
					at,
					Align2::LEFT_TOP,
					symbol,
					font.clone(),
					foreground_of(cell, default_fg),
				);
			}
		}
	}
}

/// `Color::Reset` background means "leave the panel background alone".
fn background_of(cell: &ratatui::buffer::Cell) -> Option<Color32> {
	match cell.bg {
		Color::Reset => None,
		other => Some(color32(other)),
	}
}

fn foreground_of(cell: &ratatui::buffer::Cell, default_fg: Color32) -> Color32 {
	match cell.fg {
		Color::Reset => default_fg,
		other => color32(other),
	}
}

/// ratatui colour → egui colour (ANSI 16, the 6×6×6 cube and the grey ramp).
pub fn color32(color: Color) -> Color32 {
	match color {
		Color::Reset => Color32::TRANSPARENT,
		Color::Black => Color32::from_rgb(0x2e, 0x34, 0x40),
		Color::Red => Color32::from_rgb(0xbf, 0x61, 0x6a),
		Color::Green => Color32::from_rgb(0xa3, 0xbe, 0x8c),
		Color::Yellow => Color32::from_rgb(0xeb, 0xcb, 0x8b),
		Color::Blue => Color32::from_rgb(0x81, 0xa1, 0xc1),
		Color::Magenta => Color32::from_rgb(0xb4, 0x8e, 0xad),
		Color::Cyan => Color32::from_rgb(0x88, 0xc0, 0xd0),
		Color::Gray => Color32::from_rgb(0xd8, 0xde, 0xe9),
		Color::DarkGray => Color32::from_rgb(0x4c, 0x56, 0x6a),
		Color::LightRed => Color32::from_rgb(0xbf, 0x61, 0x6a),
		Color::LightGreen => Color32::from_rgb(0xa3, 0xbe, 0x8c),
		Color::LightYellow => Color32::from_rgb(0xeb, 0xcb, 0x8b),
		Color::LightBlue => Color32::from_rgb(0x81, 0xa1, 0xc1),
		Color::LightMagenta => Color32::from_rgb(0xb4, 0x8e, 0xad),
		Color::LightCyan => Color32::from_rgb(0x88, 0xc0, 0xd0),
		Color::White => Color32::from_rgb(0xec, 0xef, 0xf4),
		Color::Rgb(r, g, b) => Color32::from_rgb(r, g, b),
		Color::Indexed(index) => indexed(index),
	}
}

fn indexed(index: u8) -> Color32 {
	match index {
		0..=15 => color32(ansi16(index)),
		16..=231 => {
			let i = index - 16;
			let steps = [0u8, 95, 135, 175, 215, 255];
			let r = steps[usize::from(i / 36)];
			let g = steps[usize::from((i % 36) / 6)];
			let b = steps[usize::from(i % 6)];
			Color32::from_rgb(r, g, b)
		},
		_ => {
			let level = 8 + (index - 232) * 10;
			Color32::from_gray(level)
		},
	}
}

fn ansi16(index: u8) -> Color {
	match index {
		0 => Color::Black,
		1 => Color::Red,
		2 => Color::Green,
		3 => Color::Yellow,
		4 => Color::Blue,
		5 => Color::Magenta,
		6 => Color::Cyan,
		7 => Color::Gray,
		8 => Color::DarkGray,
		9 => Color::LightRed,
		10 => Color::LightGreen,
		11 => Color::LightYellow,
		12 => Color::LightBlue,
		13 => Color::LightMagenta,
		14 => Color::LightCyan,
		_ => Color::White,
	}
}
