//! Drawing a [`BlitGrid`] as GPUI elements.
//!
//! The geometry never guesses: a narrow run is drawn as one text element whose
//! box is `len * cell_w` wide (a monospace font advances exactly one cell per
//! char), and a wide grapheme is drawn alone in a box of exactly
//! `width * cell_w` — so a cell *after* a CJK glyph always starts at
//! `x * cell_w` whatever the font's own advance does. The font's advance is
//! measured and reported ([`CellMetrics`]) rather than trusted.

use gpui_kit::{
	AnyElement, Div, Font, FontFallbacks, FontWeight, Hsla, IntoElement, ParentElement as _, Pixels,
	Size, Styled as _, TextRun, Window, black, div, px,
};

use crate::cell_grid::{BlitGrid, GridStyle};

/// The monospace family the cell grid is measured and drawn with.
pub const MONO_FAMILY: &str = "Consolas";

/// CJK fallbacks: without them DirectWrite never sees a glyph for 中文.
pub const CJK_FALLBACKS: [&str; 2] = ["Microsoft YaHei", "SimSun"];

/// Font size of one terminal cell, in logical pixels.
pub const CELL_FONT_SIZE: f32 = 14.0;

/// What one cell measured on this machine, in logical pixels.
#[derive(Clone, Copy, Debug)]
pub struct CellMetrics {
	pub font_size: Pixels,
	/// Advance of a narrow glyph — the width of one terminal cell.
	pub cell_w: Pixels,
	/// Line advance of one terminal row.
	pub line_h: Pixels,
	/// Shaped advance of `M` (the narrow probe).
	pub latin_w: f32,
	/// Shaped advance of `中` (the wide probe).
	pub cjk_w: f32,
}

impl CellMetrics {
	/// `cjk_w / latin_w` — `2.0` means the font's ideographs are exactly two
	/// cells wide, which is what a terminal grid needs.
	pub fn wide_ratio(&self) -> f32 {
		if self.latin_w.abs() < f32::EPSILON {
			return 0.0;
		}
		self.cjk_w / self.latin_w
	}
}

/// The cell font. `fallbacks` is what makes CJK render instead of tofu.
pub fn cell_font(weight: FontWeight) -> Font {
	Font {
		family: MONO_FAMILY.into(),
		fallbacks: Some(FontFallbacks::from_fonts(
			CJK_FALLBACKS.iter().map(|f| (*f).to_string()).collect(),
		)),
		weight,
		..Default::default()
	}
}

/// Measure one cell and one line through the platform text system.
pub fn measure_cells(window: &mut Window, font_size: Pixels) -> CellMetrics {
	let font = cell_font(FontWeight::NORMAL);
	let text_system = window.text_system().clone();

	let advance = |text: &str| -> f32 {
		let run = TextRun {
			len: text.len(),
			font: font.clone(),
			color: black(),
			background_color: None,
			underline: None,
			strikethrough: None,
		};
		f32::from(text_system.layout_line(text, font_size, &[run], None).width)
	};

	let latin_w = advance("M");
	let cjk_w = advance("中");
	let cell_w = if latin_w > 0.0 { latin_w } else { 8.0 };

	CellMetrics {
		font_size,
		cell_w: px(cell_w),
		line_h: px((f32::from(font_size) * 1.25).round()),
		latin_w,
		cjk_w,
	}
}

/// How many whole cells fit in `size`.
pub fn cells_that_fit(size: Size<Pixels>, metrics: &CellMetrics) -> (usize, usize) {
	let cw = f32::from(metrics.cell_w);
	let lh = f32::from(metrics.line_h);
	let cols = if cw > 0.0 {
		(f32::from(size.width) / cw).floor().max(1.0) as usize
	} else {
		1
	};
	let rows = if lh > 0.0 {
		(f32::from(size.height) / lh).floor().max(1.0) as usize
	} else {
		1
	};
	(cols, rows)
}

/// Draw the grid. `background` fills the whole area first so the panel never
/// shows through a cell ratatui left blank.
pub fn grid_element(grid: &BlitGrid, metrics: &CellMetrics, background: Hsla) -> Div {
	let cell_w = f32::from(metrics.cell_w);
	let line_h = f32::from(metrics.line_h);
	let font_size = metrics.font_size;
	let normal = cell_font(FontWeight::NORMAL);
	let bold = cell_font(FontWeight::BOLD);

	let mut children: Vec<AnyElement> = Vec::with_capacity(grid.rows * 2);

	for y in 0..grid.rows {
		let top = px(y as f32 * line_h);

		// 1. Row background: coalesced runs of one background colour.
		let mut run_start = 0usize;
		while run_start < grid.cols {
			let bg = grid.cell(run_start, y).style.bg;
			let mut run_end = run_start + 1;
			while run_end < grid.cols && grid.cell(run_end, y).style.bg == bg {
				run_end += 1;
			}
			children.push(
				div()
					.absolute()
					.left(px(run_start as f32 * cell_w))
					.top(top)
					.w(px((run_end - run_start) as f32 * cell_w))
					.h(px(line_h))
					.bg(bg)
					.into_any_element(),
			);
			run_start = run_end;
		}

		// 2. Glyphs: narrow cells coalesce into one shaped run, a wide cell is
		//    positioned alone in a box of exactly `width` cells.
		let mut x = 0usize;
		while x < grid.cols {
			let cell = grid.cell(x, y);
			if cell.continuation || cell.symbol == " " {
				x += 1;
				continue;
			}
			if cell.width > 1 {
				children.push(glyph(
					&cell.symbol,
					&cell.style,
					px(x as f32 * cell_w),
					top,
					px(cell_w * f32::from(cell.width)),
					px(line_h),
					font_size,
					&normal,
					&bold,
				));
				x += usize::from(cell.width);
				continue;
			}

			// A narrow run: same style, all width 1.
			let style = cell.style;
			let start = x;
			let mut text = String::new();
			while x < grid.cols {
				let cell = grid.cell(x, y);
				if cell.continuation || cell.width != 1 || cell.style != style || cell.symbol == " " {
					break;
				}
				text.push_str(&cell.symbol);
				x += 1;
			}
			if text.is_empty() {
				x += 1;
				continue;
			}
			children.push(glyph(
				&text,
				&style,
				px(start as f32 * cell_w),
				top,
				px((x - start) as f32 * cell_w),
				px(line_h),
				font_size,
				&normal,
				&bold,
			));
		}
	}

	div()
		.relative()
		.size_full()
		.overflow_hidden()
		.bg(background)
		.font(cell_font(FontWeight::NORMAL))
		.text_size(font_size)
		.children(children)
}

#[allow(clippy::too_many_arguments)]
fn glyph(
	text: &str,
	style: &GridStyle,
	left: Pixels,
	top: Pixels,
	width: Pixels,
	height: Pixels,
	font_size: Pixels,
	normal: &Font,
	bold: &Font,
) -> AnyElement {
	let (fg, _) = style.colors();
	let font = if style.bold { bold } else { normal };
	let mut element = div()
		.absolute()
		.left(left)
		.top(top)
		.w(width)
		.h(height)
		.overflow_hidden()
		.text_size(font_size)
		.text_color(fg)
		.font(font.clone());
	if style.dim {
		element = element.opacity(0.6);
	}
	element.child(text.to_string()).into_any_element()
}

/// The measured metrics as one line of evidence for the status bar / logs.
pub fn metrics_report(metrics: &CellMetrics) -> String {
	format!(
		"cell={:.2}px line={:.2}px latin(M)={:.2}px cjk(中)={:.2}px ratio={:.2} font={MONO_FAMILY}/{}",
		f32::from(metrics.cell_w),
		f32::from(metrics.line_h),
		metrics.latin_w,
		metrics.cjk_w,
		metrics.wide_ratio(),
		CJK_FALLBACKS.join("+"),
	)
}
