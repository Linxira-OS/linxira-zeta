// SPDX-License-Identifier: AGPL-3.0-only
//! The native sidebar's painter, rasterized headlessly.
//!
//! `sidebar_tsp::paint` is the whole visual contract between the TUI's snapshot
//! and the GUI: an opaque column over the pane's last cells, a one-pixel left
//! edge, one themed line per row, and a hard clip so nothing overlaps the
//! transcript. This renders it through the same offscreen pipeline the shell
//! screenshots use (`tests/support/raster.rs`) and asserts pixels, so a
//! regression is caught without a window.
//!
//! Set `ZETA_SIDEBAR_SHOT=<path>` to keep the raster as a PNG for inspection.

#[path = "support/raster.rs"]
mod raster;

use egui::{Color32, Rect, pos2, vec2};
use zetawork_gui::blit::{GridMetrics, grid_font_for};
use zetawork_gui::settings::Settings;
use zetawork_gui::sidebar_tsp::{self, SidebarLine};
use zetawork_gui::{fonts, theme};

/// Window size in points: wide enough for an 80-column grid plus a margin.
const SIZE: [f32; 2] = [700.0, 120.0];
/// Device pixels per point: the window's own reported scale in the shot.
const PP: f32 = 2.0;
const ORIGIN: (f32, f32) = (10.0, 10.0);
const CELL: (f32, f32) = (8.0, 16.0);
const COLS: u16 = 80;
const ROWS: u16 = 5;

fn line(text: &str, role: &str, tone: Option<&str>) -> SidebarLine {
	SidebarLine { text: text.to_owned(), role: role.to_owned(), tone: tone.map(str::to_owned) }
}

/// The column the pane would give the sidebar: its last 36 cells.
fn sidebar_rect() -> Rect {
	let width = f32::from(sidebar_tsp::ZETA_SIDEBAR_COLS);
	let left = ORIGIN.0 + (f32::from(COLS) - width) * CELL.0;
	Rect::from_min_size(pos2(left, ORIGIN.1), vec2(width * CELL.0, f32::from(ROWS) * CELL.1))
}

fn sidebar_lines() -> Vec<SidebarLine> {
	vec![
		line("Todos · 1/2", "zeta.sidebar.todos.header", Some("muted")),
		line("Ship it", "zeta.sidebar.todos.item", Some("accent")),
		line("─", "zeta.sidebar.separator", Some("muted")),
	]
}

/// Rasterize `lines` through the sidebar painter over the terminal background.
///
/// The grid is built inside the frame: `grid_font_for` reads the font atlas,
/// which only exists once `Context::run` has started (as in `center.rs`).
fn paint_shot(lines: &[SidebarLine], cell_h: f32) -> raster::Canvas {
	let ctx = egui::Context::default();
	let settings = Settings::default();
	theme::apply(&ctx, &settings);
	fonts::install(&ctx, &settings);
	ctx.set_pixels_per_point(PP);
	let mut textures = raster::Textures::default();
	let sidebar = sidebar_rect();
	let output = ctx.run(
		egui::RawInput {
			screen_rect: Some(Rect::from_min_size(pos2(0.0, 0.0), vec2(SIZE[0], SIZE[1]))),
			..Default::default()
		},
		|ctx| {
			let painter = ctx.layer_painter(egui::LayerId::background());
			painter.rect_filled(
				Rect::from_min_size(pos2(0.0, 0.0), vec2(SIZE[0], SIZE[1])),
				0.0,
				theme::TERM_BG,
			);
			sidebar_tsp::paint(&painter, lines, &grid(ctx, cell_h), sidebar);
		},
	);
	textures.apply(&output.textures_delta);
	let primitives = ctx.tessellate(output.shapes, output.pixels_per_point);
	raster::render(&primitives, &textures, SIZE, PP, theme::TERM_BG)
}

fn grid(ctx: &egui::Context, cell_h: f32) -> GridMetrics {
	GridMetrics {
		origin: pos2(ORIGIN.0, ORIGIN.1),
		font: grid_font_for(ctx, 13.0),
		cell_w: CELL.0,
		cell_h,
		cols: COLS,
		rows: ROWS,
		font_size: 13.0,
	}
}

fn rgba(color: Color32) -> [u8; 4] {
	[color.r(), color.g(), color.b(), color.a()]
}

#[test]
fn paints_an_opaque_themed_column_and_clips_it_to_its_cells() {
	let canvas = paint_shot(&sidebar_lines(), CELL.1);
	if let Some(path) = std::env::var_os("ZETA_SIDEBAR_SHOT") {
		std::fs::write(path, canvas.to_png()).expect("write the sidebar shot");
	}
	let at = |x: f32, y: f32| canvas.pixels[(y * PP) as usize * canvas.width + (x * PP) as usize];

	// The column's own fill, on an empty row (only three of the five rows carry
	// text): the ANSI gutter underneath is fully covered.
	let rect = sidebar_rect();
	assert_eq!(at(rect.max.x - 4.0, rect.max.y - 4.0), rgba(theme::PANEL_2));
	// Its one-pixel left edge separates it from the transcript.
	assert_eq!(at(rect.min.x + 0.5, rect.max.y - 4.0), rgba(theme::BORDER));
	// Text actually rasterized: some pixel in the first row's band is neither
	// the fill nor the edge.
	let min_x = ((rect.min.x + 2.0) * PP) as usize;
	let max_x = ((rect.min.x + 24.0 * CELL.0) * PP) as usize;
	let min_y = ((rect.min.y + 1.0) * PP) as usize;
	let max_y = ((rect.min.y + CELL.1 - 1.0) * PP) as usize;
	let mut text_pixels = 0;
	for y in min_y..max_y {
		for x in min_x..max_x {
			let pixel = canvas.pixels[y * canvas.width + x];
			if pixel != rgba(theme::PANEL_2) && pixel != rgba(theme::BORDER) {
				text_pixels += 1;
			}
		}
	}
	assert!(text_pixels > 20, "the first row drew {text_pixels} glyph pixels");

	// Nothing paints outside the column: the transcript keeps its background.
	assert_eq!(at(rect.max.x + 5.0, rect.min.y + 5.0), rgba(theme::TERM_BG));
	assert_eq!(at(rect.min.x - 5.0, rect.min.y + 5.0), rgba(theme::TERM_BG));
}

#[test]
fn a_grid_without_height_draws_nothing() {
	let canvas = paint_shot(&sidebar_lines(), 0.0);
	let rect = sidebar_rect();
	let index =
		((rect.min.y + 4.0) * PP) as usize * canvas.width + ((rect.min.x + 4.0) * PP) as usize;
	assert_eq!(canvas.pixels[index], rgba(theme::TERM_BG), "no cell height, no column");
}
