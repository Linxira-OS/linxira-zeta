// SPDX-License-Identifier: AGPL-3.0-only
//! The TUI's sidebar, drawn natively.
//!
//! A `zetacode` pane runs the TUI inside the PTY: its transcript is ANSI and
//! its sidebar is a 36-cell gutter column painted by the TUI. The TUI also
//! publishes that column's semantic twin on every changed frame as an APC
//! (`ESC _ zeta;sidebar; <base64 JSON> ESC \`, see `packages/tui/src/tui.ts`),
//! so this module draws the same content with egui — themed, crisp at any font
//! size, and free of the escape-sequence pipeline. The body is
//! `{"v":1,"node":<TSP node>}`; anything that does not parse simply leaves the
//! ANSI gutter visible.
//!
//! Display only: no widget, no interaction. The TUI still owns the pane's
//! input, and the terminal grid underneath keeps painting exactly what it did
//! before — this column is an opaque overlay on the last
//! [`ZETA_SIDEBAR_COLS`] cells.

use base64::Engine as _;
use egui::{Align2, Color32, CornerRadius, Painter, Pos2, Rect, Vec2};
use serde_json::Value;
use unicode_width::UnicodeWidthChar;

use crate::blit::GridMetrics;
use crate::theme;

/// The sidebar's width in cells: the TUI's `SIDEBAR_WIDTH`
/// (`packages/coding-agent/src/modes/components/sidebar.ts`) and the width a
/// snapshot describes. Keep the two in step; the native column is only drawn
/// when the pane is at least this wide.
pub const ZETA_SIDEBAR_COLS: u16 = 36;

/// Rows a snapshot may occupy before it is cut. A pathological snapshot must
/// not turn into a full-window paint.
const MAX_LINES: usize = 32;

/// One row of the native sidebar: its text, the TSP `role` that produced it,
/// and the node-level `tone` it carried. One tone per row, because a native
/// line has one color; mixed-color ANSI rows keep their leading glyph instead.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SidebarLine {
	pub text: String,
	pub role: String,
	pub tone: Option<String>,
}

/// Decode one `zeta;sidebar;` APC body into drawable rows.
///
/// `None` means "no snapshot to draw": an empty body (the TUI clearing the
/// column), a payload that is not base64 JSON, or a version this build does
/// not know. The caller keeps — or restores — the ANSI gutter in that case.
pub fn parse_snapshot(payload: &[u8]) -> Option<Vec<SidebarLine>> {
	if payload.is_empty() {
		return None;
	}
	let json = base64::engine::general_purpose::STANDARD
		.decode(payload)
		.ok()?;
	let value: Value = serde_json::from_slice(&json).ok()?;
	if value.get("v").and_then(Value::as_u64) != Some(1) {
		return None;
	}
	let mut lines = Vec::new();
	flatten(value.get("node")?, "", None, &mut lines);
	// Blank rows are spacing, not content: the TUI emits one `rule` between
	// panels and a `spacer` at most, so a run of them carries no information.
	lines.dedup_by(|a, b| a.text.is_empty() && b.text.is_empty());
	lines.truncate(MAX_LINES);
	Some(lines)
}

/// Flatten one node into rows, inheriting the nearest `role` and `tone` so a
/// nested `col`/`row` keeps the panel's identity.
fn flatten(node: &Value, role: &str, tone: Option<&str>, out: &mut Vec<SidebarLine>) {
	let props = node.get("p");
	let role = props
		.and_then(|p| p.get("role"))
		.and_then(Value::as_str)
		.unwrap_or(role);
	let tone = props
		.and_then(|p| p.get("tone"))
		.and_then(Value::as_str)
		.or(tone);
	match node.get("k").and_then(Value::as_str).unwrap_or_default() {
		"col" => {
			for child in children(node) {
				flatten(child, role, tone, out);
			}
		},
		"row" => {
			// A row is one drawn line: every child's text joins it.
			let mut text = String::new();
			for child in children(node) {
				gather_inline(child, &mut text);
			}
			if !text.is_empty() {
				push_line(out, text, role, tone);
			}
		},
		"rule" => push_line(out, "─".repeat(usize::from(ZETA_SIDEBAR_COLS)), role, tone),
		"spacer" => push_line(out, String::new(), role, tone),
		"progress" | "meter" => push_line(out, value_text(props), role, tone),
		"text" | "badge" | "status" | "md" | "code" | "ansi" => {
			let text = props.map(text_of).unwrap_or_default();
			if !text.is_empty() {
				push_line(out, text, role, tone);
			}
		},
		_ => {
			// An unknown kind keeps its own text, then walks its children, so a
			// snapshot from a newer TUI still shows its readable parts.
			if let Some(text) = props.map(text_of).filter(|text| !text.is_empty()) {
				push_line(out, text, role, tone);
			}
			for child in children(node) {
				flatten(child, role, tone, out);
			}
		},
	}
}

/// A node tree's children (`c`) that carry a TSP node body.
fn children(node: &Value) -> impl Iterator<Item = &Value> {
	node
		.get("c")
		.and_then(Value::as_array)
		.into_iter()
		.flatten()
}

/// A node's text: `p.text` when present, else its `p.spans` joined — a span's
/// style tokens only pick the row's tone, which the nodes themselves carry.
fn text_of(props: &Value) -> String {
	if let Some(text) = props.get("text") {
		return text_value(text);
	}
	props.get("spans").map(text_value).unwrap_or_default()
}

/// A `TspText` (a string, or an array of `{t,s}` spans) as plain text.
fn text_value(value: &Value) -> String {
	match value {
		Value::String(text) => text.clone(),
		Value::Array(spans) => spans
			.iter()
			.filter_map(|span| span.get("t").and_then(Value::as_str))
			.collect(),
		_ => String::new(),
	}
}

/// A `progress`/`meter` row: its label when it has one, else the percentage.
fn value_text(props: Option<&Value>) -> String {
	let Some(props) = props else {
		return String::new();
	};
	if let Some(label) = props.get("label") {
		let label = text_value(label);
		if !label.is_empty() {
			return label;
		}
	}
	match props.get("value").and_then(Value::as_f64) {
		Some(value) => format!("{}%", (value * 100.0).round() as i64),
		None => String::new(),
	}
}

/// Text of a node and everything under it, for a `row`'s single line.
fn gather_inline(node: &Value, out: &mut String) {
	if let Some(props) = node.get("p") {
		out.push_str(&text_of(props));
	}
	for child in children(node) {
		gather_inline(child, out);
	}
}

fn push_line(out: &mut Vec<SidebarLine>, text: String, role: &str, tone: Option<&str>) {
	out.push(SidebarLine { text, role: role.to_owned(), tone: tone.map(str::to_owned) });
}

/// Paint the native sidebar column over `rect`.
///
/// The background is opaque on purpose: it covers the ANSI gutter the TUI
/// painted underneath, so the pane never shows the column twice. The one-pixel
/// left edge separates it from the transcript; text uses the grid's own font
/// (already monospace, already at the terminal's size), so a row lands exactly
/// on `grid.cell_h` and lines up with the cells beside it.
pub fn paint(painter: &Painter, lines: &[SidebarLine], grid: &GridMetrics, rect: Rect) {
	if grid.cell_h <= 0.0 {
		return;
	}
	let painter = painter.with_clip_rect(rect);
	painter.rect_filled(rect, CornerRadius::ZERO, theme::PANEL_2);
	painter.rect_filled(
		Rect::from_min_size(rect.min, Vec2::new(1.0, rect.height())),
		CornerRadius::ZERO,
		theme::BORDER,
	);
	let rows = ((rect.height() / grid.cell_h).floor().max(0.0) as usize).min(lines.len());
	for (row, line) in lines.iter().take(rows).enumerate() {
		if line.text.is_empty() {
			continue;
		}
		painter.text(
			Pos2::new(rect.min.x + 1.0, rect.min.y + row as f32 * grid.cell_h),
			Align2::LEFT_TOP,
			truncate_to_cells(&line.text, usize::from(ZETA_SIDEBAR_COLS)),
			grid.font.clone(),
			line_color(line),
		);
	}
}

/// The theme color of one row: an explicit tone wins, then the role says what
/// kind of row it is (a header or muted detail vs. body text).
fn line_color(line: &SidebarLine) -> Color32 {
	match line.tone.as_deref() {
		Some("accent") => return theme::ACCENT,
		Some("success") => return theme::ADD,
		Some("warning") => return theme::WARN,
		Some("error") => return theme::DEL,
		Some("info") => return theme::CYAN,
		Some("muted" | "neutral" | "pending") => return theme::TEXT_3,
		_ => {},
	}
	let role = line.role.as_str();
	if role == "zeta.sidebar.separator" {
		return theme::BORDER_2;
	}
	if role.ends_with(".header") || role.ends_with(".commit") || role.ends_with(".summary") {
		return theme::TEXT_3;
	}
	theme::TEXT_2
}

/// Clip `text` to `cells` terminal columns, dropping a wide glyph that would
/// straddle the edge rather than letting it overlap the transcript.
fn truncate_to_cells(text: &str, cells: usize) -> String {
	let mut used = 0usize;
	let mut out = String::new();
	for ch in text.chars() {
		let width = ch.width().unwrap_or(0);
		if used + width > cells {
			break;
		}
		used += width;
		out.push(ch);
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;

	fn snapshot(node: Value) -> String {
		base64::engine::general_purpose::STANDARD
			.encode(serde_json::json!({ "v": 1, "node": node }).to_string())
	}

	#[test]
	fn decodes_a_col_of_roles_and_tones() {
		let payload = snapshot(serde_json::json!({
			"k": "col",
			"p": { "role": "zeta.sidebar", "gap": "xs" },
			"c": [
				{ "k": "text", "p": { "role": "zeta.sidebar.todos.header", "tone": "accent", "text": "Todos · 1/2" } },
				{ "k": "rule", "p": { "role": "zeta.sidebar.separator", "tone": "muted" } },
				{ "k": "col", "p": { "role": "zeta.sidebar.todos" }, "c": [
					{ "k": "text", "p": { "role": "zeta.sidebar.todos.item", "tone": "success", "text": "done" } }
				] }
			]
		}));
		let lines = parse_snapshot(payload.as_bytes()).expect("snapshot parses");
		assert_eq!(lines.len(), 3);
		assert_eq!(lines[0].text, "Todos · 1/2");
		assert_eq!(lines[0].tone.as_deref(), Some("accent"));
		assert_eq!(lines[1].role, "zeta.sidebar.separator");
		assert_eq!(lines[1].text.chars().count(), usize::from(ZETA_SIDEBAR_COLS));
		assert_eq!(lines[2].text, "done");
		assert_eq!(lines[2].tone.as_deref(), Some("success"));
		assert_eq!(lines[2].role, "zeta.sidebar.todos.item");
	}

	#[test]
	fn joins_spans_and_rows_on_one_line() {
		let payload = snapshot(serde_json::json!({
			"k": "row",
			"p": { "role": "zeta.sidebar.mcp.counts" },
			"c": [
				{ "k": "text", "p": { "spans": [{ "t": "●", "s": "success" }, { "t": "2" }] } },
				{ "k": "text", "p": { "text": "  ▲1" } }
			]
		}));
		let lines = parse_snapshot(payload.as_bytes()).expect("snapshot parses");
		assert_eq!(lines.len(), 1);
		assert_eq!(lines[0].text, "●2  ▲1");
		assert_eq!(lines[0].role, "zeta.sidebar.mcp.counts");
	}

	#[test]
	fn rejects_empty_foreign_and_unknown_version_payloads() {
		assert_eq!(parse_snapshot(b""), None);
		assert_eq!(parse_snapshot(b"not base64!"), None);
		assert_eq!(parse_snapshot(b"eyJ2IjoyfQ=="), None, "version 2 is not ours");
	}

	#[test]
	fn collapses_blank_runs_and_caps_the_row_count() {
		let mut children =
			vec![serde_json::json!({ "k": "spacer" }), serde_json::json!({ "k": "spacer" })];
		for index in 0..MAX_LINES + 5 {
			children.push(serde_json::json!({ "k": "text", "p": { "text": format!("row {index}") } }));
		}
		let payload = snapshot(serde_json::json!({ "k": "col", "c": children }));
		let lines = parse_snapshot(payload.as_bytes()).expect("snapshot parses");
		assert_eq!(lines[0].text, "");
		assert!(!lines[1].text.is_empty(), "the blank run collapses to one row");
		assert_eq!(lines.len(), MAX_LINES);
	}
}
