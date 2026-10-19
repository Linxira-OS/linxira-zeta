// SPDX-License-Identifier: AGPL-3.0-only
//! The spec's icon set as vector strokes.
//!
//! Every icon in `spec-v22-tui-workspace.html` is an inline SVG on a 24×24
//! viewBox. Rather than pull an icon font in (the stock egui fonts carry no
//! such glyphs, and a font would not follow the theme colour), each path is
//! transcribed here as polylines/arcs and stroked by [`paint`] into whatever
//! rectangle the caller has.
//!
//! Coordinates in the tables below are the spec's own `viewBox` coordinates, so
//! a path can be checked against the HTML line by line.

use egui::{Color32, CornerRadius, Response, Sense, Stroke, Ui, pos2, vec2};

use crate::theme;

/// One icon of the spec's set.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Icon {
	Search,
	Tasks,
	Zap,
	Plus,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	X,
	Hamburger,
	Folder,
	FolderPlus,
	File,
	Term,
	Code,
	Diff,
	/// `.toolbtn[data-act=new-pane]` — a frame with a vertical split.
	Split,
	/// A slot inside a `rect`-framed icon, used by the 列数 control.
	Columns(u8),
	Gear,
	Help,
	Focus,
	Refresh,
	GitBranch,
	GitPr,
	Stage,
	Check,
	Sun,
	Keyboard,
	Info,
	/// 历史 · Agent 对话 — a clock with a rewind arrow.
	History,
	/// The 用量 expander (`.iconbtn[data-act=open-usage]`) — a bulleted list.
	List,
	/// Custom chrome (the spec's mock has no window frame).
	Minimize,
	Maximize,
	Restore,
}

/// Stroke an icon into `rect`, using the spec's `24 24` viewBox.
pub fn paint(painter: &egui::Painter, icon: Icon, rect: egui::Rect, color: Color32, width: f32) {
	let stroke = Stroke::new(width, color);
	let at = |x: f32, y: f32| {
		pos2(
			rect.min.x + x / theme::ICON_BOX * rect.width(),
			rect.min.y + y / theme::ICON_BOX * rect.height(),
		)
	};
	let line =
		|a: (f32, f32), b: (f32, f32)| painter.line_segment([at(a.0, a.1), at(b.0, b.1)], stroke);
	let poly = |points: &[(f32, f32)]| {
		let points: Vec<egui::Pos2> = points.iter().map(|(x, y)| at(*x, *y)).collect();
		painter.add(egui::Shape::line(points, stroke));
	};
	let frame = |x: f32, y: f32, w: f32, h: f32, radius: f32| {
		painter.rect_stroke(
			egui::Rect::from_min_size(
				at(x, y),
				vec2(w / theme::ICON_BOX * rect.width(), h / theme::ICON_BOX * rect.height()),
			),
			CornerRadius::same((radius / theme::ICON_BOX * rect.width()) as u8),
			stroke,
			egui::StrokeKind::Middle,
		);
	};
	let circle = |cx: f32, cy: f32, r: f32| {
		painter.circle_stroke(at(cx, cy), r / theme::ICON_BOX * rect.width(), stroke);
	};
	let dot = |cx: f32, cy: f32, r: f32| {
		painter.circle_filled(at(cx, cy), r / theme::ICON_BOX * rect.width(), color);
	};
	let arc = |cx: f32, cy: f32, r: f32, from: f32, to: f32| {
		let steps = 16;
		let points: Vec<egui::Pos2> = (0..=steps)
			.map(|step| {
				let t = from + (to - from) * step as f32 / steps as f32;
				let radians = t.to_radians();
				at(cx + r * radians.cos(), cy + r * radians.sin())
			})
			.collect();
		painter.add(egui::Shape::line(points, stroke));
	};

	match icon {
		Icon::Search => {
			circle(11.0, 11.0, 6.5);
			line((20.0, 20.0), (16.4, 16.4));
		},
		Icon::Tasks => {
			line((9.0, 6.0), (20.0, 6.0));
			line((9.0, 12.0), (20.0, 12.0));
			line((9.0, 18.0), (20.0, 18.0));
			poly(&[(4.0, 6.0), (5.4, 7.4), (8.0, 4.6)]);
			poly(&[(4.0, 12.0), (5.4, 13.4), (8.0, 10.6)]);
			poly(&[(4.0, 18.0), (5.4, 19.4), (8.0, 16.6)]);
		},
		Icon::Zap => {
			poly(&[
				(13.0, 2.0),
				(4.5, 13.0),
				(11.0, 13.0),
				(10.0, 22.0),
				(19.5, 11.0),
				(13.0, 11.0),
				(13.0, 2.0),
			]);
		},
		Icon::Plus => {
			line((12.0, 5.0), (12.0, 19.0));
			line((5.0, 12.0), (19.0, 12.0));
		},
		Icon::ChevronDown => poly(&[(6.0, 9.0), (12.0, 15.0), (18.0, 9.0)]),
		Icon::ChevronLeft => poly(&[(15.0, 6.0), (9.0, 12.0), (15.0, 18.0)]),
		Icon::ChevronRight => poly(&[(9.0, 6.0), (15.0, 12.0), (9.0, 18.0)]),
		Icon::X => {
			line((6.0, 6.0), (18.0, 18.0));
			line((18.0, 6.0), (6.0, 18.0));
		},
		Icon::Hamburger => {
			line((4.0, 6.0), (20.0, 6.0));
			line((4.0, 12.0), (20.0, 12.0));
			line((4.0, 18.0), (20.0, 18.0));
		},
		Icon::Folder => {
			poly(&[
				(3.0, 17.0),
				(3.0, 7.0),
				(5.0, 5.0),
				(9.0, 5.0),
				(11.0, 7.0),
				(19.0, 7.0),
				(21.0, 9.0),
				(21.0, 17.0),
				(19.0, 19.0),
				(5.0, 19.0),
				(3.0, 17.0),
			]);
		},
		Icon::FolderPlus => {
			poly(&[
				(3.0, 17.0),
				(3.0, 7.0),
				(5.0, 5.0),
				(9.0, 5.0),
				(11.0, 7.0),
				(19.0, 7.0),
				(21.0, 9.0),
				(21.0, 17.0),
				(19.0, 19.0),
				(5.0, 19.0),
				(3.0, 17.0),
			]);
			line((12.0, 11.0), (12.0, 15.0));
			line((10.0, 13.0), (14.0, 13.0));
		},
		Icon::File => {
			poly(&[(6.0, 3.0), (14.0, 3.0), (18.0, 7.0), (18.0, 21.0), (6.0, 21.0), (6.0, 3.0)]);
			poly(&[(14.0, 3.0), (14.0, 7.0), (18.0, 7.0)]);
		},
		Icon::Term => {
			frame(3.0, 4.0, 18.0, 16.0, 2.0);
			poly(&[(7.0, 9.0), (10.0, 12.0), (7.0, 15.0)]);
			line((13.0, 15.0), (17.0, 15.0));
		},
		Icon::Code => {
			poly(&[(9.0, 6.0), (6.0, 6.0), (4.0, 8.0), (4.0, 16.0), (6.0, 18.0), (9.0, 18.0)]);
			poly(&[(15.0, 6.0), (18.0, 6.0), (20.0, 8.0), (20.0, 16.0), (18.0, 18.0), (15.0, 18.0)]);
		},
		Icon::Diff => {
			line((7.0, 5.0), (7.0, 19.0));
			poly(&[(4.0, 8.0), (7.0, 5.0), (10.0, 8.0)]);
			line((17.0, 5.0), (17.0, 19.0));
			poly(&[(14.0, 16.0), (17.0, 19.0), (20.0, 16.0)]);
		},
		Icon::Split => {
			frame(3.0, 4.0, 18.0, 16.0, 2.0);
			line((12.0, 4.0), (12.0, 20.0));
		},
		Icon::Columns(1) => frame(4.0, 5.0, 16.0, 14.0, 1.5),
		Icon::Columns(2) => {
			frame(4.0, 5.0, 16.0, 14.0, 1.5);
			line((12.0, 5.0), (12.0, 19.0));
		},
		Icon::Columns(_) => {
			frame(3.0, 5.0, 18.0, 14.0, 1.5);
			line((9.0, 5.0), (9.0, 19.0));
			line((15.0, 5.0), (15.0, 19.0));
		},
		Icon::Gear => {
			circle(12.0, 12.0, 3.0);
			line((12.0, 3.0), (12.0, 5.0));
			line((12.0, 19.0), (12.0, 21.0));
			line((3.0, 12.0), (5.0, 12.0));
			line((19.0, 12.0), (21.0, 12.0));
			line((5.6, 5.6), (7.0, 7.0));
			line((17.0, 17.0), (18.4, 18.4));
			line((18.4, 5.6), (17.0, 7.0));
			line((7.0, 17.0), (5.6, 18.4));
		},
		Icon::Help => {
			circle(12.0, 12.0, 9.0);
			arc(12.0, 11.0, 2.9, 200.0, 340.0);
			line((12.0, 14.5), (12.0, 17.0));
			dot(12.0, 17.0, 0.7);
		},
		Icon::Focus => {
			poly(&[(4.0, 9.0), (4.0, 6.0), (6.0, 4.0), (9.0, 4.0)]);
			poly(&[(15.0, 4.0), (18.0, 4.0), (20.0, 6.0), (20.0, 9.0)]);
			poly(&[(20.0, 15.0), (20.0, 18.0), (18.0, 20.0), (15.0, 20.0)]);
			poly(&[(9.0, 20.0), (6.0, 20.0), (4.0, 18.0), (4.0, 15.0)]);
			circle(12.0, 12.0, 2.4);
		},
		Icon::Refresh => {
			arc(12.0, 12.0, 8.0, 160.0, 380.0);
			poly(&[(20.0, 5.0), (20.0, 11.0), (14.0, 11.0)]);
		},
		Icon::GitBranch => {
			circle(6.0, 6.0, 2.4);
			circle(6.0, 18.0, 2.4);
			circle(18.0, 9.0, 2.4);
			line((6.0, 8.4), (6.0, 15.6));
			poly(&[(8.4, 6.0), (14.0, 6.0), (16.0, 8.0), (16.0, 6.6)]);
		},
		Icon::GitPr => {
			circle(6.0, 6.0, 2.4);
			circle(6.0, 18.0, 2.4);
			circle(18.0, 12.0, 2.4);
			line((6.0, 8.4), (6.0, 15.6));
			poly(&[(8.4, 6.0), (14.0, 6.0), (18.0, 10.0)]);
		},
		Icon::Stage => {
			line((12.0, 4.0), (12.0, 16.0));
			poly(&[(7.0, 11.0), (12.0, 16.0), (17.0, 11.0)]);
			line((4.0, 20.0), (20.0, 20.0));
		},
		Icon::Check => poly(&[(20.0, 6.0), (9.0, 17.0), (4.0, 12.0)]),
		Icon::Sun => {
			circle(12.0, 12.0, 4.0);
			line((12.0, 2.0), (12.0, 4.0));
			line((12.0, 20.0), (12.0, 22.0));
			line((2.0, 12.0), (4.0, 12.0));
			line((20.0, 12.0), (22.0, 12.0));
			line((5.0, 5.0), (6.5, 6.5));
			line((17.5, 17.5), (19.0, 19.0));
			line((19.0, 5.0), (17.5, 6.5));
			line((6.5, 17.5), (5.0, 19.0));
		},
		Icon::Keyboard => {
			frame(2.0, 6.0, 20.0, 12.0, 2.0);
			line((6.0, 10.0), (6.0, 10.3));
			line((10.0, 10.0), (10.0, 10.3));
			line((14.0, 10.0), (14.0, 10.3));
			line((18.0, 10.0), (18.0, 10.3));
			line((8.0, 14.0), (16.0, 14.0));
		},
		Icon::Info => {
			circle(12.0, 12.0, 9.0);
			line((12.0, 11.0), (12.0, 16.0));
			line((12.0, 8.0), (12.0, 8.3));
		},
		Icon::History => {
			line((12.0, 8.0), (12.0, 12.0));
			line((12.0, 12.0), (15.0, 14.0));
			arc(12.0, 12.0, 8.5, -70.0, 250.0);
			poly(&[(3.0, 20.0), (3.0, 16.0), (7.0, 16.0)]);
		},
		Icon::List => {
			line((8.0, 6.0), (21.0, 6.0));
			line((8.0, 12.0), (21.0, 12.0));
			line((8.0, 18.0), (21.0, 18.0));
			line((3.5, 6.0), (3.5, 6.3));
			line((3.5, 12.0), (3.5, 12.3));
			line((3.5, 18.0), (3.5, 18.3));
		},
		Icon::Minimize => {
			line((5.0, 12.0), (19.0, 12.0));
		},
		Icon::Maximize => {
			frame(5.0, 5.0, 14.0, 14.0, 1.0);
		},
		Icon::Restore => {
			frame(8.0, 4.0, 12.0, 12.0, 1.0);
			poly(&[(4.0, 8.0), (4.0, 20.0), (16.0, 20.0), (16.0, 16.0)]);
		},
	}
}

/// A square icon button, sized like the spec's `.iconbtn` (28×28, 24×24 in a
/// panel head, 20×20 in a section head).
///
/// `active` paints the `is-active` surface; the hover fill is painted here so
/// the button looks like the mock rather than like an egui button.
pub fn icon_button(ui: &mut Ui, icon: Icon, size: f32, active: bool, tooltip: &str) -> Response {
	let (rect, response) = ui.allocate_exact_size(vec2(size, size), Sense::click());
	let hovered = response.hovered();
	let fill = if active {
		theme::PANEL_4
	} else if hovered {
		theme::PANEL_3
	} else {
		Color32::TRANSPARENT
	};
	if fill != Color32::TRANSPARENT {
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), fill);
	}
	let color = if active || hovered {
		theme::TEXT
	} else {
		theme::TEXT_2
	};
	let inset = (size - size * 0.57).max(3.0) / 2.0;
	paint(ui.painter(), icon, rect.shrink(inset), color, 1.6);
	if tooltip.is_empty() {
		response
	} else {
		response.on_hover_text(tooltip)
	}
}

/// The 更多 (⋯) affordance, painted rather than typed.
///
/// The bundled UI font has no `U+22EF`, so the character rendered as a tofu
/// box (seen in a real window capture). Three dots at the same spacing read the
/// same at every DPI and cannot fall back to a missing glyph.
pub fn paint_more(painter: &egui::Painter, rect: egui::Rect, color: Color32) {
	let r = 1.5;
	let gap = 4.0;
	let c = egui::pos2(rect.center().x, rect.center().y - 1.0);
	for offset in [-gap, 0.0, gap] {
		painter.circle_filled(egui::pos2(c.x + offset, c.y), r, color);
	}
}

/// A text-less icon button whose active ink uses the accent, for the session
/// tab type marker.
pub fn paint_marker(ui: &Ui, icon: Icon, rect: egui::Rect, color: Color32) {
	paint(ui.painter(), icon, rect, color, 1.5);
}

// ── 应用图标 ──────────────────────────────────────────────────────────────
//
// The desktop mark is the repository's `assets/icon.svg`, rasterized once at
// 256×256 into `assets/icon.png` beside this crate (so a clean build needs no
// SVG renderer and no network). The PNG is committed full-bleed and the
// rounded corners are masked here, by [`rounded_alpha`], at the same radius
// the shell uses for cards — scaled from the 48 pt size the 关于 page draws it
// at, so the 32 px taskbar and the 256 px window raster read the same.

/// The committed raster of the repository's `assets/icon.svg`.
pub const APP_ICON_PNG: &[u8] = include_bytes!("../assets/icon.png");

/// The size, in points, at which the 关于 page draws [`APP_ICON_PNG`]. The
/// card radius below is `theme::R_PANEL` at this size, then proportional.
pub const APP_ICON_DESIGN_SIZE: f32 = 48.0;

/// Corner radius, in pixels, for an icon raster `size` pixels wide.
///
/// `theme::R_PANEL` is the radius every card in the shell uses; scaling it by
/// the icon's own size keeps the silhouette identical at 32 px (taskbar), 48 pt
/// (关于) and the 256 px window raster, rather than turning the 256 px one into
/// a square block or a stadium.
pub fn app_icon_corner_radius(size: u32) -> f32 {
	(size as f32 * f32::from(theme::R_PANEL) / APP_ICON_DESIGN_SIZE)
		.round()
		.max(1.0)
}

/// Decode a PNG into unmultiplied RGBA. `None` for data this build cannot
/// render — the caller then leaves the window on egui's default mark instead of
/// panicking over a corrupt asset.
pub fn decode_icon_png(png: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
	let mut decoder = png::Decoder::new(std::io::Cursor::new(png));
	decoder.set_transformations(png::Transformations::normalize_to_color8());
	let mut reader = decoder.read_info().ok()?;
	let mut buffer = vec![0; reader.output_buffer_size()?];
	let info = reader.next_frame(&mut buffer).ok()?;
	buffer.truncate(info.buffer_size());
	let rgba = match info.color_type {
		png::ColorType::Rgba => buffer,
		png::ColorType::Rgb => {
			let mut rgba = Vec::with_capacity(buffer.len() / 3 * 4);
			for pixel in buffer.chunks_exact(3) {
				rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
			}
			rgba
		},
		_ => return None,
	};
	Some((rgba, info.width, info.height))
}

/// Mask `rgba`'s alpha with a rounded rectangle of `radius` pixels.
///
/// The corner test is a signed distance to the rounded rect, so edge pixels get
/// one pixel of coverage instead of a jagged staircase. Pixels outside the
/// shape become fully transparent; the shape's own ink is untouched.
pub fn rounded_alpha(rgba: &mut [u8], width: u32, height: u32, radius: f32) {
	let (w, h) = (width as f32, height as f32);
	let radius = radius.clamp(0.0, w.min(h) / 2.0);
	let (half_w, half_h) = (w / 2.0, h / 2.0);
	for y in 0..height {
		for x in 0..width {
			let px = x as f32 + 0.5 - half_w;
			let py = y as f32 + 0.5 - half_h;
			let qx = px.abs() - (half_w - radius);
			let qy = py.abs() - (half_h - radius);
			let outside = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt();
			let distance = outside + qx.max(qy).min(0.0) - radius;
			let coverage = (0.5 - distance).clamp(0.0, 1.0);
			let alpha = ((y * width + x) * 4 + 3) as usize;
			if let Some(value) = rgba.get_mut(alpha) {
				*value = (f32::from(*value) * coverage).round() as u8;
			}
		}
	}
}

/// The window, taskbar and 关于 icon: the committed raster with its corners
/// rounded.
pub fn app_icon() -> Option<egui::IconData> {
	let (mut rgba, width, height) = decode_icon_png(APP_ICON_PNG)?;
	rounded_alpha(&mut rgba, width, height, app_icon_corner_radius(width));
	Some(egui::IconData { rgba, width, height })
}

/// [`app_icon`] as the texture source the 关于 page draws.
pub fn app_icon_image() -> Option<egui::ColorImage> {
	let icon = app_icon()?;
	Some(egui::ColorImage::from_rgba_unmultiplied(
		[icon.width as usize, icon.height as usize],
		&icon.rgba,
	))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_committed_raster_is_rgba_and_square() {
		let (rgba, width, height) = decode_icon_png(APP_ICON_PNG).expect("committed icon decodes");
		assert_eq!((width, height), (256, 256));
		assert_eq!(rgba.len(), (width * height * 4) as usize);
	}

	#[test]
	fn the_corner_radius_follows_the_shell_card_radius() {
		assert_eq!(app_icon_corner_radius(48), f32::from(theme::R_PANEL));
		// Proportional at every size, and never a square corner.
		assert_eq!(app_icon_corner_radius(96), f32::from(theme::R_PANEL) * 2.0);
		assert!(app_icon_corner_radius(32) >= 1.0);
		assert_eq!(app_icon_corner_radius(256), 32.0);
	}

	#[test]
	fn corners_are_masked_and_the_middle_survives() {
		let mut pixels = vec![255u8; 16 * 16 * 4];
		rounded_alpha(&mut pixels, 16, 16, 4.0);
		let alpha = |x: u32, y: u32| pixels[((y * 16 + x) * 4 + 3) as usize];
		assert_eq!(alpha(0, 0), 0, "the corner is outside the rounded rect");
		assert_eq!(alpha(15, 15), 0);
		assert_eq!(alpha(8, 8), 255, "the centre keeps its alpha");
		assert_eq!(alpha(8, 0), 255, "the straight top edge is opaque");
	}

	#[test]
	fn the_app_icon_has_no_square_corner() {
		let icon = app_icon().expect("committed icon decodes");
		let alpha = |x: u32, y: u32| icon.rgba[((y * icon.width + x) * 4 + 3) as usize];
		for (x, y) in [(0, 0), (255, 0), (0, 255), (255, 255)] {
			assert_eq!(alpha(x, y), 0, "corner ({x}, {y}) must be transparent");
		}
		assert_eq!(alpha(128, 16), 255, "the top edge stays part of the mark");
	}
}
