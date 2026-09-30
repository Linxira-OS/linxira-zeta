use ratatui::layout::{Constraint, Layout, Rect};

/// Fixed pane layout templates. v1 keeps templates keyboard-cycled; the
/// free drag-and-drop editor is a later iteration.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Template {
	/// One pane fills the content area.
	Single,
	/// Two panes side by side (left / right).
	Columns,
	/// Four panes in a 2x2 grid.
	Quad,
}

impl Template {
	pub const ALL: [Template; 3] = [Template::Single, Template::Columns, Template::Quad];

	pub fn slots(self) -> usize {
		match self {
			Template::Single => 1,
			Template::Columns => 2,
			Template::Quad => 4,
		}
	}

	pub fn next(self) -> Template {
		let idx = Self::ALL.iter().position(|t| *t == self).unwrap_or(0);
		Self::ALL[(idx + 1) % Self::ALL.len()]
	}

	pub fn label(self) -> &'static str {
		match self {
			Template::Single => "1x1",
			Template::Columns => "1x2",
			Template::Quad => "2x2",
		}
	}
}

/// Split `area` into `count` pane rectangles for `template`. Extra panes
/// beyond the template's slot count are not placed (the tab cycle refuses to
/// add them instead); fewer panes than slots leave the trailing slots empty.
pub fn pane_areas(area: Rect, template: Template, count: usize) -> Vec<Rect> {
	let cap = template.slots().min(count.max(1));
	match (template, cap) {
		(_, 0 | 1) | (Template::Single, _) => vec![area],
		(Template::Columns, _) | (Template::Quad, 2) => {
			Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)])
				.areas::<2>(area)
				.to_vec()
		},
		(Template::Quad, _) => {
			let top_bottom =
				Layout::vertical([Constraint::Percentage(50), Constraint::Percentage(50)]).split(area);
			let mut out = Vec::with_capacity(4);
			for half in top_bottom.iter() {
				for cell in Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)])
					.areas::<2>(*half)
					.iter()
				{
					out.push(*cell);
				}
			}
			out
		},
	}
}
