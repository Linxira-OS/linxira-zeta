//! Offscreen ratatui rendering and its blit into an egui painter.
//!
//! # Why a blit
//!
//! A terminal pane has to be able to render *anything ratatui can* — box
//! drawing, CJK alignment, per-cell colour — without a terminal attached. The
//! proven path is: run ratatui against a headless [`Backend`] that keeps the
//! cell grid, then paint that grid into the pane's `Ui`.
//!
//! # Cell-width basis
//!
//! Every width on this path comes from `unicode_width::UnicodeWidthStr::width`
//! — the same call `ratatui_core::buffer::CellWidth::cell_width` makes. Because
//! `main/Cargo.toml` patches `unicode-width` to
//! `termide/crates/unicode-width-fix`, the whole workspace resolves *one* build
//! of that crate, so a wide grapheme is two grid columns here exactly when
//! ratatui says so. [`paint_buffer`] advances cells with the CJK face
//! ([`crate::fonts::GRID_FAMILY`]), whose ASCII advance is half its full-width
//! CJK advance, so the second half of a wide glyph lands on the next column
//! without per-glyph fitting.
//!
//! # Deriving wide-cell continuations
//!
//! `Cell::skip` (termide's explicit tail marker) is deprecated in ratatui
//! 0.30.x, so this blit does not read it. [`painted_cells`] instead *derives*
//! the continuation itself: a cell whose symbol is `w` columns wide consumes
//! `w` grid columns, and the columns it covers are never painted. That matches
//! `Buffer::diff`, which skips `cell_width - 1` trailing cells. A covered cell
//! that was painted as a blank would stamp a hole over the glyph's second half
//! and shift everything after it.

use std::cell::RefCell;
use std::convert::Infallible;
use std::rc::Rc;

use egui::{Align2, Color32, CornerRadius, FontFamily, FontId, Painter, Pos2, Rect as ERect, Ui};
use ratatui::backend::{Backend, ClearType, WindowSize};
use ratatui::buffer::Buffer;
use ratatui::layout::{Position, Rect, Size};
use ratatui::style::Color;
use ratatui::{Frame, Terminal};
use unicode_width::UnicodeWidthStr;

/// Font family whose ASCII advance is half its CJK advance (installed by
/// [`crate::fonts::install`]).
pub const GRID_FAMILY: &str = "zetawork-cjk-mono";

/// A cell surface shared between the headless backend and its owner.
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

	/// Was the cursor left visible by the last frame?
	pub fn cursor_visible(&self) -> bool {
		!self.hidden
	}

	/// The cursor position the last frame asked for.
	pub fn cursor(&self) -> Position {
		self.cursor
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

/// Render `draw` into a `width × height` cell grid with no terminal in the
/// loop, and hand back both the cells and the backend state (cursor).
pub fn render<F>(width: u16, height: u16, draw: F) -> (Buffer, bool, Position)
where
	F: FnOnce(&mut Frame<'_>),
{
	let surface = CellSurface::new(width, height);
	let backend = BufferBackend::new(surface.clone());
	let mut terminal = Terminal::new(backend).expect("headless terminal");
	terminal.draw(draw).expect("headless frame");
	let backend = terminal.backend();
	let cursor = backend.cursor();
	let visible = backend.cursor_visible();
	(surface.snapshot(), visible, cursor)
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

	/// `rows × cols` of the derived grid, for the pane's diagnostic line.
	pub fn describe(&self) -> String {
		format!(
			"{}×{} 格 · 单元 {:.2}×{:.2}pt · 字体 {:.0}pt",
			self.cols, self.rows, self.cell_w, self.cell_h, self.font_size
		)
	}
}

/// The grid font: the CJK family once [`crate::fonts::install`] has been
/// applied, egui's default monospace before that.
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

/// The cells [`paint_buffer`] would paint on `row`, as
/// `(column, symbol, columns_spanned)`.
///
/// This *is* the advance rule: a cell whose symbol is `w` columns wide consumes
/// `w` grid columns, and the columns it covers are skipped rather than painted
/// (mirroring `Buffer::diff`). `max_cols` clips the row to the panel.
pub fn painted_cells(buffer: &Buffer, row: u16, max_cols: u16) -> Vec<(u16, &str, u16)> {
	let mut painted = Vec::new();
	if row >= buffer.area.height || max_cols == 0 {
		return painted;
	}
	let mut col = 0u16;
	while col < buffer.area.width.min(max_cols) {
		let cell = &buffer[(col, row)];
		let width = (UnicodeWidthStr::width(cell.symbol()).max(1)) as u16;
		painted.push((col, cell.symbol(), width));
		col = col.saturating_add(width);
	}
	painted
}

/// Paint a ratatui [`Buffer`] as a cell grid, one [`painted_cells`] run per row.
pub fn paint_buffer(ui: &Ui, buffer: &Buffer, metrics: &GridMetrics, default_fg: Color32) {
	let painter: Painter = ui.painter_at(ERect::from_min_size(metrics.origin, metrics.size()));
	paint_buffer_with(&painter, buffer, metrics, default_fg);
}

/// The same paint, for callers that already hold a clipped painter (the TUI
/// view paints several buffers into one `Ui`).
pub fn paint_buffer_with(
	painter: &Painter,
	buffer: &Buffer,
	metrics: &GridMetrics,
	default_fg: Color32,
) {
	let font = metrics.font.clone();
	for row in 0..buffer.area.height.min(metrics.rows) {
		let row_y = metrics.origin.y + f32::from(row) * metrics.cell_h;
		for (col, symbol, width) in painted_cells(buffer, row, metrics.cols) {
			let cell = &buffer[(col, row)];
			let at = pos2(metrics.origin.x + f32::from(col) * metrics.cell_w, row_y);
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

/// The single cell a cursor sits on, drawn after the blit (the styles come
/// from 设置 → 终端 → 光标样式).
pub fn paint_cursor(
	painter: &Painter,
	metrics: &GridMetrics,
	at: Position,
	style: crate::settings::CursorStyle,
) {
	let area = Rect { x: at.x, y: at.y, width: 1, height: 1 };
	if area.right() > metrics.cols || area.bottom() > metrics.rows {
		return;
	}
	let origin = pos2(
		metrics.origin.x + f32::from(area.x) * metrics.cell_w,
		metrics.origin.y + f32::from(area.y) * metrics.cell_h,
	);
	let full = ERect::from_min_size(origin, egui::vec2(metrics.cell_w, metrics.cell_h));
	let rect = match style {
		crate::settings::CursorStyle::Block => full,
		crate::settings::CursorStyle::Underline => ERect::from_min_size(
			pos2(full.min.x, full.max.y - (metrics.cell_h * 0.12).max(1.5)),
			egui::vec2(metrics.cell_w, (metrics.cell_h * 0.12).max(1.5)),
		),
		crate::settings::CursorStyle::Bar => ERect::from_min_size(
			full.min,
			egui::vec2((metrics.cell_w * 0.14).max(1.5), metrics.cell_h),
		),
	};
	painter.rect_filled(rect, CornerRadius::ZERO, crate::theme::ACCENT_2);
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

/// A tiny cache of rendered cell grids, keyed by everything that changes them.
///
/// A terminal pane re-renders its sample transcript on every frame otherwise,
/// which would allocate a fresh `Buffer` per frame for content that has not
/// changed. The cache is bounded (the shell can show at most three panes at
/// once) and least-recently-used.
#[derive(Default)]
pub struct BufferCache {
	entries: Vec<(String, Buffer)>,
}

impl BufferCache {
	/// How many rendered grids one shell keeps around.
	pub const CAPACITY: usize = 4;

	/// The buffer for `key`, rendering it with `render` on a miss.
	pub fn get_or_render(&mut self, key: String, render: impl FnOnce() -> Buffer) -> &Buffer {
		if let Some(index) = self.entries.iter().position(|(cached, _)| *cached == key) {
			let entry = self.entries.remove(index);
			self.entries.push(entry);
		} else {
			let buffer = render();
			self.entries.push((key, buffer));
			if self.entries.len() > Self::CAPACITY {
				self.entries.remove(0);
			}
		}
		&self.entries.last().expect("just pushed").1
	}
}

/// A ratatui colour → egui colour, spelled once for the whole shell.
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

fn pos2(x: f32, y: f32) -> Pos2 {
	Pos2 { x, y }
}

#[cfg(test)]
mod tests {
	use super::*;
	use ratatui::widgets::Paragraph;

	/// The acceptance test for the width rule: a wide glyph claims two columns
	/// and the next ASCII cell lands two columns later.
	#[test]
	fn a_wide_glyph_claims_two_columns_and_the_next_ascii_lands_on_column_two() {
		let (buffer, _, _) = render(12, 2, |frame| {
			let area = frame.area();
			frame.render_widget(Paragraph::new("中a文b"), area);
		});
		let row = painted_cells(&buffer, 0, 12);
		let cells: Vec<(u16, &str, u16)> = row.iter().copied().take(4).collect();
		assert_eq!(
			cells,
			vec![(0, "中", 2), (2, "a", 1), (3, "文", 2), (5, "b", 1)],
			"wide glyphs must consume two columns"
		);
		// The trailing half of each wide glyph is never reported as its own
		// paint, so nothing stamps a hole over the glyph.
		assert_eq!(row[1].0, 2, "the covering column was skipped");
	}

	#[test]
	fn ascii_only_lines_advance_one_column_per_cell() {
		let (buffer, _, _) = render(8, 2, |frame| {
			let area = frame.area();
			frame.render_widget(Paragraph::new("abcdef"), area);
		});
		let row = painted_cells(&buffer, 0, 8);
		assert_eq!(row[0], (0, "a", 1));
		assert_eq!(row[5], (5, "f", 1));
	}

	#[test]
	fn clipping_a_row_never_reports_a_cell_past_the_limit() {
		let (buffer, _, _) = render(12, 2, |frame| {
			let area = frame.area();
			frame.render_widget(Paragraph::new("中中中中中中"), area);
		});
		let row = painted_cells(&buffer, 0, 5);
		// A wide glyph that *starts* inside the clip is painted (the painter
		// clips its right half); a glyph that starts past the clip is not.
		assert_eq!(row, vec![(0, "中", 2), (2, "中", 2), (4, "中", 2)]);
		assert_eq!(painted_cells(&buffer, 0, 4), vec![(0, "中", 2), (2, "中", 2)]);
		assert!(painted_cells(&buffer, 99, 5).is_empty(), "out of range row");
		assert!(painted_cells(&buffer, 0, 0).is_empty(), "no columns");
	}

	#[test]
	fn the_headless_backend_reports_the_cursor_the_frame_asked_for() {
		let (_, visible, cursor) = render(20, 3, |frame| {
			frame.set_cursor_position(Position { x: 4, y: 1 });
			frame.render_widget(Paragraph::new("$ "), frame.area());
		});
		assert!(visible, "ratatui shows the cursor unless asked to hide it");
		assert_eq!(cursor, Position { x: 4, y: 1 });
	}

	#[test]
	fn ratatui_colours_map_onto_the_theme() {
		assert_eq!(color32(Color::Red), Color32::from_rgb(0xbf, 0x61, 0x6a));
		assert_eq!(color32(Color::Reset), Color32::TRANSPARENT);
		assert_eq!(color32(Color::Indexed(196)), Color32::from_rgb(255, 0, 0));
		assert_eq!(color32(Color::Rgb(1, 2, 3)), Color32::from_rgb(1, 2, 3));
	}
}
