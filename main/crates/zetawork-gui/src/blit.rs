// SPDX-License-Identifier: AGPL-3.0-only
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
//! ratatui says so. [`paint_buffer`] advances cells with the fixed-pitch CJK
//! face ([`crate::fonts::GRID_FAMILY`]), whose ASCII advance is half its
//! full-width CJK advance, so the second half of a wide glyph lands on the next
//! column without per-glyph fitting.
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

use crate::t;
use std::{cell::RefCell, convert::Infallible, rc::Rc};

use egui::{Align2, Color32, CornerRadius, FontFamily, FontId, Painter, Pos2, Rect as ERect, Ui};
use ratatui::{
	Frame, Terminal,
	backend::{Backend, ClearType, WindowSize},
	buffer::Buffer,
	layout::{Position, Rect, Size},
	style::Color,
};
use unicode_width::UnicodeWidthStr;

/// Font family whose ASCII advance is half its CJK advance (installed by
/// [`crate::fonts::install`] from the fixed-pitch CJK face).
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
		t!(
			"{}×{} 格 · 单元 {}×{}pt · 字体 {}pt",
			self.cols,
			self.rows,
			format!("{:.2}", self.cell_w),
			format!("{:.2}", self.cell_h),
			format!("{:.0}", self.font_size)
		)
	}
}

/// The grid font: the fixed-pitch CJK family once [`crate::fonts::install`]
/// has been applied, egui's default monospace before that.
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

/// Paint a ratatui [`Buffer`] as a cell grid, one [`painted_cells`] run per
/// row.
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

/// The grid's cell in **device** pixels: the font metrics the painter uses,
/// scaled by the window's pixels-per-point.
///
/// This is the number the emulator answers `CSI 16 t` with, and the unit a
/// Kitty placement's `c`/`r` extents multiply out to, so a raster drawn at
/// `columns × cell.0` lands on exactly that many physical pixels.
pub fn cell_device_px(metrics: &GridMetrics, pixels_per_point: f32) -> (u16, u16) {
	let scale = if pixels_per_point > 0.0 {
		pixels_per_point
	} else {
		1.0
	};
	let round = |points: f32| (points * scale).round().clamp(0.0, f32::from(u16::MAX)) as u16;
	(round(metrics.cell_w).max(1), round(metrics.cell_h).max(1))
}

/// GPU textures for the Kitty images a pane is showing, keyed by pane and id.
///
/// An image is uploaded once per revision (the emulator bumps it on every
/// retransmit), so a repaint of a `a=p` placement costs nothing. Entries whose
/// image the terminal deleted are dropped at the end of the pane's paint pass.
#[derive(Default)]
pub struct ImageTextures {
	entries: std::collections::HashMap<(String, u32), (u64, egui::TextureHandle)>,
}

impl ImageTextures {
	fn texture(
		&mut self,
		ctx: &egui::Context,
		pane: &str,
		image: &termide_panel_terminal::kitty::Image,
	) -> egui::TextureHandle {
		let key = (pane.to_owned(), image.id);
		if let Some((revision, texture)) = self.entries.get(&key) {
			if *revision == image.revision {
				return texture.clone();
			}
		}
		let pixels = egui::ColorImage::from_rgba_unmultiplied(
			[image.width as usize, image.height as usize],
			&image.rgba,
		);
		// NEAREST keeps a raster drawn at the cell size pixel-exact: nothing is
		// filtered on the way to the screen, which is the whole point of
		// answering the density query.
		let texture = ctx.load_texture(
			format!("kitty-{pane}-{}", image.id),
			pixels,
			egui::TextureOptions::NEAREST,
		);
		self.entries.insert(key, (image.revision, texture.clone()));
		texture
	}

	fn retain(&mut self, pane: &str, alive: &std::collections::HashSet<u32>) {
		self
			.entries
			.retain(|(key_pane, id), _| key_pane != pane || alive.contains(id));
	}
}

/// Paint one pane's Kitty placements into the grid.
///
/// `behind` selects the z<0 half (painted before the text) or the z>=0 half
/// (after it); the whole pass is clipped to the grid the cells were laid out
/// in, so an image that overhangs the pane never paints over its neighbours.
/// The destination rectangle comes from the emulator's cell math
/// ([`termide_panel_terminal::kitty::Placement::rect`]), which is device
/// pixels; dividing by the window scale places it 1:1, and the source crop is
/// applied as a UV rectangle so a scrolled placement shows the right slice.
pub fn paint_images(
	painter: &Painter,
	cache: &mut ImageTextures,
	pane: &str,
	placements: &[(
		termide_panel_terminal::kitty::Placement,
		std::sync::Arc<termide_panel_terminal::kitty::Image>,
	)],
	metrics: &GridMetrics,
	cell_px: (u16, u16),
	pixels_per_point: f32,
	behind: bool,
) {
	// Prune even when nothing is on screen: an image the terminal deleted must
	// not keep its texture alive (the pane may still have painted it last frame).
	let alive: std::collections::HashSet<u32> = placements
		.iter()
		.map(|(placement, _)| placement.image)
		.collect();
	cache.retain(pane, &alive);
	if placements.is_empty() {
		return;
	}
	let grid = ERect::from_min_size(metrics.origin, metrics.size());
	let clipped = painter.with_clip_rect(painter.clip_rect().intersect(grid));
	let mut ordered: Vec<&(_, _)> = placements
		.iter()
		.filter(|(p, _)| (p.z < 0) == behind)
		.collect();
	ordered.sort_by_key(|(placement, _)| placement.z);
	for (placement, image) in ordered {
		if image.width == 0 || image.height == 0 {
			continue;
		}
		let destination = image_rect(metrics, cell_px, placement, image, pixels_per_point);
		if destination.width() <= 0.0 || destination.height() <= 0.0 {
			continue;
		}
		let uv = source_uv(placement, image);
		let texture = cache.texture(painter.ctx(), pane, image);
		clipped.image(texture.id(), destination, uv, Color32::WHITE);
	}
}

/// The rectangle one placement is drawn into, in **points** (egui's unit).
///
/// The emulator gives device pixels; dividing by the window scale is what
/// makes a raster drawn at the reported cell density land 1:1 on physical
/// pixels instead of being resampled.
pub fn image_rect(
	metrics: &GridMetrics,
	cell_px: (u16, u16),
	placement: &termide_panel_terminal::kitty::Placement,
	image: &termide_panel_terminal::kitty::Image,
	pixels_per_point: f32,
) -> ERect {
	let scale = if pixels_per_point > 0.0 {
		pixels_per_point
	} else {
		1.0
	};
	let rect = placement.rect(image, cell_px);
	ERect::from_min_size(
		pos2(metrics.origin.x + rect.x as f32 / scale, metrics.origin.y + rect.y as f32 / scale),
		egui::vec2(rect.width as f32 / scale, rect.height as f32 / scale),
	)
}

/// The source slice of the image a placement shows, as normalized UVs.
fn source_uv(
	placement: &termide_panel_terminal::kitty::Placement,
	image: &termide_panel_terminal::kitty::Image,
) -> ERect {
	let crop = placement.crop;
	if crop.width == 0 || crop.height == 0 {
		return ERect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0));
	}
	let (w, h) = (image.width.max(1) as f32, image.height.max(1) as f32);
	let x0 = (crop.x as f32 / w).clamp(0.0, 1.0);
	let y0 = (crop.y as f32 / h).clamp(0.0, 1.0);
	let x1 = ((crop.x + crop.width) as f32 / w).clamp(0.0, 1.0);
	let y1 = ((crop.y + crop.height) as f32 / h).clamp(0.0, 1.0);
	ERect::from_min_max(pos2(x0, y0), pos2(x1, y1))
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
	use std::io::{Result as IoResult, Write};
	use std::sync::{Arc, Mutex, RwLock};

	use base64::Engine;
	use ratatui::widgets::Paragraph;

	use super::*;

	/// A 2×2 PNG (red, green / blue, white) committed beside this crate; the
	/// image test transmits it through the terminal emulator the pane uses.
	const KITTY_PNG: &[u8] = include_bytes!("../testdata/kitty-2x2.png");

	/// A sink for the replies a terminal writes back to its child.
	struct Capture(Arc<Mutex<Vec<u8>>>);

	impl Write for Capture {
		fn write(&mut self, buf: &[u8]) -> IoResult<usize> {
			self.0.lock().unwrap().extend_from_slice(buf);
			Ok(buf.len())
		}

		fn flush(&mut self) -> IoResult<()> {
			Ok(())
		}
	}

	/// The grid the painter is handed in a real pane: `origin` where the pane
	/// put it, cell metrics from the grid font, and the window's scale.
	fn grid(cell_w: f32, cell_h: f32) -> GridMetrics {
		GridMetrics {
			origin: pos2(100.0, 200.0),
			font: egui::FontId::monospace(13.0),
			cell_w,
			cell_h,
			cols: 80,
			rows: 24,
			font_size: 13.0,
		}
	}

	/// The acceptance test for the width rule: a wide glyph claims two columns
	/// and the next ASCII cell lands two columns later.
	#[test]
	fn a_wide_glyph_claims_two_columns_and_the_next_ascii_lands_on_column_two() {
		let (buffer, ..) = render(12, 2, |frame| {
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
		let (buffer, ..) = render(8, 2, |frame| {
			let area = frame.area();
			frame.render_widget(Paragraph::new("abcdef"), area);
		});
		let row = painted_cells(&buffer, 0, 8);
		assert_eq!(row[0], (0, "a", 1));
		assert_eq!(row[5], (5, "f", 1));
	}

	#[test]
	fn clipping_a_row_never_reports_a_cell_past_the_limit() {
		let (buffer, ..) = render(12, 2, |frame| {
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

	/// The end-to-end evidence for terminal images: a kitty APC from a
	/// committed PNG goes through the same emulator the pane runs, and the
	/// rectangle the painter would draw covers exactly the device pixels the
	/// emulator measured — 10×5 cells of 12×24 px at 1.5× DPI.
	#[test]
	fn a_kitty_image_paints_the_device_pixels_the_emulator_measured() {
		let replies = Arc::new(Mutex::new(Vec::new()));
		let screen = Arc::new(RwLock::new(termide_panel_terminal::TerminalScreen::new(24, 80)));
		// What `sync_cell_pixels` reports each frame, and what `CSI 16 t`
		// answers with: the real device-pixel cell of the grid font.
		screen.write().unwrap().cell_px = (12, 24);
		let writer =
			Arc::new(Mutex::new(Box::new(Capture(Arc::clone(&replies))) as Box<dyn Write + Send>));
		let mut stream = termide_panel_terminal::StreamParser::new(writer, Arc::clone(&screen));

		// A hosted TUI reserves rows, parks the cursor on the block's first row
		// (row 4, column 6 in 1-based CSI) and transmits+displays the raster,
		// exactly as `encodeKitty` does.
		let payload = base64::engine::general_purpose::STANDARD.encode(KITTY_PNG);
		stream.feed(b"\x1b[4;6H");
		stream.feed(format!("\x1b_Ga=T,f=100,i=7,c=10,r=5,q=2;{payload}\x1b\\").as_bytes());
		stream.feed(b"after");
		stream.flush();

		assert!(replies.lock().unwrap().is_empty(), "q=2 asks for no reply");
		let placements = screen.read().unwrap().graphics.placements();
		assert_eq!(placements.len(), 1, "one placement, painted above the grid");
		let (placement, image) = &placements[0];
		assert_eq!((image.width, image.height), (2, 2), "the PNG decoded");
		assert_eq!((placement.row, placement.column), (3, 5), "anchored at the cursor");

		// The text after the APC stays on the placement's own row: the image
		// never moves the cursor.
		let text: String = {
			let screen = screen.read().unwrap();
			let mut text = String::new();
			for cell in &screen.active_buffer()[3] {
				cell.push_text(&mut text);
			}
			text.trim_end().to_owned()
		};
		assert_eq!(text, "     after", "C=1 leaves the cursor where it was");

		let cell_px = (12, 24);
		let ppp = 1.5_f32;
		let metrics = grid(8.0, 16.0);
		let painted = image_rect(&metrics, cell_px, placement, image, ppp);
		// Back to device pixels, measured from the grid's own origin (which is
		// itself in points and scales with the window): the assertion is the
		// evidence that the raster lands where the emulator said it would.
		let device = ERect::from_min_size(
			pos2(painted.min.x * ppp, painted.min.y * ppp),
			egui::vec2(painted.width() * ppp, painted.height() * ppp),
		);
		assert_eq!(
			(
				device.min.x - metrics.origin.x * ppp,
				device.min.y - metrics.origin.y * ppp,
				device.width(),
				device.height()
			),
			(5.0 * 12.0, 3.0 * 24.0, 10.0 * 12.0, 5.0 * 24.0),
			"the image covers exactly 10x5 device-pixel cells"
		);
		assert_eq!((painted.min.x, painted.min.y), (140.0, 248.0), "points = px / scale");
		// And the renderer's own cell report is the number the child asked for.
		assert_eq!(cell_device_px(&metrics, ppp), (12, 24), "12x24 device pixels per cell");

		// A delete frees the placement, so the next frame paints nothing there.
		stream.feed(b"\x1b_Ga=d,d=I,i=7,q=2\x1b\\");
		assert!(screen.read().unwrap().graphics.placements().is_empty());
	}

	#[test]
	fn ratatui_colours_map_onto_the_theme() {
		assert_eq!(color32(Color::Red), Color32::from_rgb(0xbf, 0x61, 0x6a));
		assert_eq!(color32(Color::Reset), Color32::TRANSPARENT);
		assert_eq!(color32(Color::Indexed(196)), Color32::from_rgb(255, 0, 0));
		assert_eq!(color32(Color::Rgb(1, 2, 3)), Color32::from_rgb(1, 2, 3));
	}
}
