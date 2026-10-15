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

/// A text-less icon button whose active ink uses the accent, for the session
/// tab type marker.
pub fn paint_marker(ui: &Ui, icon: Icon, rect: egui::Rect, color: Color32) {
	paint(ui.painter(), icon, rect, color, 1.5);
}
