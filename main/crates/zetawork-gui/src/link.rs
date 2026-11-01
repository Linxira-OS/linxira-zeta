// SPDX-License-Identifier: AGPL-3.0-only
//! Links under the pointer in a painted terminal grid, and the file a click
//! on one opens.
//!
//! The grid is painted from the same `ratatui::Buffer` the TUI drew, so the
//! cell under the pointer is the cell the terminal shows. Paths are resolved
//! with the model every panel shares ([`termide_core::links`]) — never with a
//! second parser — and a `:line[:col]` suffix written after a path is carried
//! into the tab instead of being dropped.
//!
//! Safety is the caller's root set: a link resolves only to a regular file
//! that, canonicalized, still lives under the workspace (or one of the
//! additional directories) or `~/.zeta`. A symlink that leaves those roots is
//! refused, so a terminal line can never talk the GUI into opening
//! `/etc/passwd` through a path that merely starts inside the workspace.

use std::path::{Path, PathBuf};

use egui::Pos2;
use ratatui::buffer::Buffer;
use termide_core::links::{self, LinkTarget};

use crate::blit::GridMetrics;

/// What clicking a link does: opens the file it names, or reports that the
/// path the text spelled does not exist.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Hit {
	/// A regular file this app may open.
	Open(OpenTarget),
	/// Text that reads as a path but resolves nowhere (or is a directory, or
	/// escapes the roots): the caller says so instead of doing nothing.
	Missing(PathBuf),
}

/// A file a link names, with the position it pointed at.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenTarget {
	/// The resolved file, canonicalized.
	pub path: PathBuf,
	/// `:42` — the line the link named.
	pub line: Option<u32>,
	/// `:42:7` — the column after it.
	pub col: Option<u32>,
}

impl OpenTarget {
	/// `agent.ts:42` — the tab title: the file's name plus the position the
	/// link named, so the tab says where the click was going.
	#[must_use]
	pub fn title(&self) -> String {
		let name = self.path.file_name().map_or_else(
			|| self.path.display().to_string(),
			|name| name.to_string_lossy().into_owned(),
		);
		tab_title(&name, self.line, self.col)
	}
}

/// `name:42:7` — the title an editor tab opened from a link carries.
#[must_use]
pub fn tab_title(name: &str, line: Option<u32>, col: Option<u32>) -> String {
	match (line, col) {
		(Some(line), Some(col)) => format!("{name}:{line}:{col}"),
		(Some(line), None) => format!("{name}:{line}"),
		(None, _) => name.to_string(),
	}
}

/// The grid cell under `pos`, when the pointer is inside the grid.
///
/// A cell's own rectangle decides: the pointer at a boundary belongs to the
/// cell to its right (or below), which is what a text cursor does too.
#[must_use]
pub fn cell_at(metrics: &GridMetrics, pos: Pos2) -> Option<(u16, u16)> {
	if metrics.cell_w <= 0.0 || metrics.cell_h <= 0.0 {
		return None;
	}
	let dx = pos.x - metrics.origin.x;
	let dy = pos.y - metrics.origin.y;
	if dx < 0.0 || dy < 0.0 {
		return None;
	}
	let col = (dx / metrics.cell_w).floor();
	let row = (dy / metrics.cell_h).floor();
	if col < 0.0 || row < 0.0 || col >= f32::from(metrics.cols) || row >= f32::from(metrics.rows) {
		return None;
	}
	Some((row as u16, col as u16))
}

/// The link under one cell of a painted grid.
///
/// `cwd` is what a relative path is taken from; `allowed` is the root set a
/// file must stay inside. `None` means the cell holds plain text — no link is
/// invented for it.
#[must_use]
pub fn target_at(
	buf: &Buffer,
	metrics: &GridMetrics,
	row: u16,
	col: u16,
	cwd: &Path,
	allowed: &[PathBuf],
) -> Option<Hit> {
	if row >= metrics.rows || col >= metrics.cols {
		return None;
	}
	let (text, char_at) = line_text(buf, metrics, row);
	let at = *char_at.get(usize::from(col))?;
	if let Some((range, target)) = links::link_at(&text, at, cwd) {
		let LinkTarget::Path(path) = target else {
			// A web address is not a file: phase 1 opens files only.
			return None;
		};
		let (line, col) = suffix_after(&text, range.end);
		return Some(match resolve(&path, allowed) {
			Some(path) => Hit::Open(OpenTarget { path, line, col }),
			None => Hit::Missing(path),
		});
	}
	// No link covers the cell. Text that still reads as a path gets the same
	// treatment as a link, because `links_in` only reports a path it could
	// already `exists()`-check: a path this app can resolve itself (after
	// expanding `~` and dropping a `:line[:col]` suffix) must open, not read as
	// missing. Anything left over is reported with its reason.
	let token = token_at(&text, at)?;
	let (stem, line, col) = split_position(&token);
	let path = expand(stem, cwd);
	Some(match resolve(&path, allowed) {
		Some(path) => Hit::Open(OpenTarget { path, line, col }),
		None => Hit::Missing(path),
	})
}

/// A token split into its path and the `:line[:col]` position written after it.
fn split_position(token: &str) -> (&str, Option<u32>, Option<u32>) {
	// From the end: `:col`, then `:line`; a bare `agent.ts` has neither.
	let Some((head, tail)) = token.rsplit_once(':') else {
		return (token, None, None);
	};
	if let Some(last) = number(tail) {
		// `:col` only reads as a column when a `:line` precedes it; a lone
		// number is the line (`agent.ts:42`).
		if let Some((stem, line)) = head.rsplit_once(':') {
			if let Some(line) = number(line) {
				return (stem, Some(line), Some(last));
			}
		}
		return (head, Some(last), None);
	}
	(token, None, None)
}

/// One row of the grid as text, plus the char offset each column starts at.
///
/// A wide character occupies its own cell and leaves the following one with an
/// empty symbol; joining the symbols therefore yields the row as read, and the
/// offsets stay aligned with columns.
fn line_text(buf: &Buffer, metrics: &GridMetrics, row: u16) -> (String, Vec<usize>) {
	let width = metrics.cols.min(buf.area.width);
	let mut text = String::new();
	let mut char_at = Vec::with_capacity(usize::from(width));
	for col in 0..width {
		char_at.push(text.chars().count());
		let symbol = buf[(col, row)].symbol();
		if !symbol.is_empty() {
			text.push_str(symbol);
		}
	}
	(text, char_at)
}

/// `:42` or `:42:7` written right after a path: the line and column it names.
fn suffix_after(text: &str, end: usize) -> (Option<u32>, Option<u32>) {
	let rest: String = text.chars().skip(end).collect();
	let mut parts = rest.split(':');
	if parts.next() != Some("") {
		return (None, None);
	}
	let line = parts.next().and_then(|part| number(part));
	let col = parts.next().and_then(|part| number(part));
	if line.is_none() {
		return (None, None);
	}
	(line, col)
}

/// A run of ASCII digits, and nothing else: `42x` belongs to the text.
fn number(part: &str) -> Option<u32> {
	if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
		return None;
	}
	part.parse().ok()
}

/// The whitespace-delimited word around char `at`, plain prose allowed.
fn token_at(text: &str, at: usize) -> Option<String> {
	const BREAK: [char; 12] = [' ', '\t', '"', '\'', '`', '<', '>', '(', ')', '[', ']', '{'];
	let chars: Vec<char> = text.chars().collect();
	let mut start = at.min(chars.len().saturating_sub(1));
	while start > 0 && !BREAK.contains(&chars[start - 1]) {
		start -= 1;
	}
	let mut end = at.min(chars.len());
	while end < chars.len() && !BREAK.contains(&chars[end]) {
		end += 1;
	}
	if start >= end {
		return None;
	}
	let token: String = chars[start..end].iter().collect();
	let token = token.trim_end_matches([',', ';', ':', '!', '?', '.']);
	// Only something shaped like a path: one separator, or a dotted leaf.
	let dotted = token
		.rsplit_once('.')
		.is_some_and(|(stem, ext)| !stem.is_empty() && !ext.is_empty());
	if token.contains(['/', '\\']) || dotted {
		Some(token.to_string())
	} else {
		None
	}
}

/// A path as written, relative to `cwd`; `~` is the user's home.
fn expand(text: &str, cwd: &Path) -> PathBuf {
	if let Some(rest) = text.strip_prefix("~/") {
		if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
			return PathBuf::from(home).join(rest);
		}
	}
	let path = Path::new(text);
	if path.is_absolute() {
		path.to_path_buf()
	} else {
		cwd.join(path)
	}
}

/// Extensions a click opens in the IDE page instead of the text editor.
///
/// The page hosts the same `panel-ide` the TUI runs, so the set is "source and
/// config a developer reads with structure": anything not listed falls back to
/// the editor, which can always show the bytes.
const IDE_EXTENSIONS: [&str; 26] = [
	"rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "c", "h", "cc", "cpp", "hpp", "java",
	"kt", "swift", "rb", "php", "cs", "css", "html", "json", "toml", "yaml", "yml",
];

/// Whether a linked file belongs in the IDE page rather than the editor.
#[must_use]
pub fn opens_in_ide(path: &Path) -> bool {
	path
		.extension()
		.and_then(|ext| ext.to_str())
		.is_some_and(|ext| {
			IDE_EXTENSIONS
				.iter()
				.any(|known| ext.eq_ignore_ascii_case(known))
		})
}

/// The file `path` names, when it is a regular file inside one of the roots.
///
/// Canonicalizing first is what makes a symlink answerable: the link may sit
/// inside the workspace while its target does not, and only the target's real
/// location decides.
fn resolve(path: &Path, allowed: &[PathBuf]) -> Option<PathBuf> {
	let canonical = path.canonicalize().ok()?;
	if !canonical.is_file() {
		return None;
	}
	let inside = allowed
		.iter()
		.filter_map(|root| root.canonicalize().ok())
		.any(|root| canonical.starts_with(&root));
	inside.then_some(canonical)
}

#[cfg(test)]
mod tests {
	use super::*;

	fn metrics() -> GridMetrics {
		GridMetrics {
			origin: Pos2::new(10.0, 20.0),
			font: egui::FontId::monospace(13.0),
			cell_w: 8.0,
			cell_h: 16.0,
			cols: 40,
			rows: 10,
			font_size: 13.0,
		}
	}

	fn buffer(line: &str) -> Buffer {
		let mut buf = Buffer::empty(ratatui::layout::Rect::new(0, 0, 40, 10));
		for (col, ch) in line.chars().enumerate() {
			if col >= 40 {
				break;
			}
			buf[(col as u16, 0)].set_symbol(&ch.to_string());
		}
		buf
	}

	fn tempdir() -> PathBuf {
		let dir = std::env::temp_dir().join(format!(
			"zeta-gui-link-{}-{:?}",
			std::process::id(),
			std::thread::current().id()
		));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		dir
	}

	#[test]
	fn a_pixel_belongs_to_the_cell_it_covers() {
		let m = metrics();
		assert_eq!(cell_at(&m, Pos2::new(10.0, 20.0)), Some((0, 0)));
		assert_eq!(cell_at(&m, Pos2::new(18.0, 20.0)), Some((0, 1)));
		assert_eq!(cell_at(&m, Pos2::new(9.0, 20.0)), None);
		assert_eq!(cell_at(&m, Pos2::new(10.0, 19.0)), None);
		assert_eq!(cell_at(&m, Pos2::new(10.0 + 40.0 * 8.0, 20.0)), None);
	}

	#[test]
	fn source_files_open_in_the_ide_page() {
		assert!(opens_in_ide(Path::new("src/main.rs")));
		assert!(opens_in_ide(Path::new("web/App.TSX")));
		// Markdown has its own rendered page; plain text is the editor's.
		assert!(!opens_in_ide(Path::new("README.md")));
		assert!(!opens_in_ide(Path::new("notes.txt")));
	}

	#[test]
	fn a_position_suffix_is_split_off_a_token() {
		assert_eq!(split_position("agent.ts"), ("agent.ts", None, None));
		assert_eq!(split_position("agent.ts:42"), ("agent.ts", Some(42), None));
		assert_eq!(split_position("agent.ts:42:7"), ("agent.ts", Some(42), Some(7)));
		// A drive letter is not a position.
		assert_eq!(split_position("C:\\repo\\a.rs"), ("C:\\repo\\a.rs", None, None));
	}

	#[test]
	fn a_path_in_the_grid_opens_relative_to_the_workspace() {
		let dir = tempdir();
		std::fs::create_dir_all(dir.join("docs")).unwrap();
		std::fs::write(dir.join("docs/plan.md"), "# plan").unwrap();
		let hit = target_at(&buffer("see docs/plan.md here"), &metrics(), 0, 8, &dir, &[dir.clone()]);
		match hit {
			Some(Hit::Open(target)) => {
				assert_eq!(target.path, dir.join("docs/plan.md").canonicalize().unwrap());
				assert_eq!(target.line, None);
				assert_eq!(target.title(), "plan.md");
			},
			other => panic!("expected an open hit, got {other:?}"),
		}
	}

	#[test]
	fn a_trailing_position_is_carried_into_the_target() {
		let dir = tempdir();
		std::fs::write(dir.join("agent.ts"), "x").unwrap();
		let line = "src agent.ts:42:7";
		let hit = target_at(&buffer(line), &metrics(), 0, 5, &dir, &[dir.clone()]);
		match hit {
			Some(Hit::Open(target)) => {
				assert_eq!(target.line, Some(42));
				assert_eq!(target.col, Some(7));
				assert_eq!(target.title(), "agent.ts:42:7");
			},
			other => panic!("expected an open hit, got {other:?}"),
		}
		let hit = target_at(&buffer("agent.ts:9"), &metrics(), 0, 0, &dir, &[dir.clone()]);
		match hit {
			Some(Hit::Open(target)) => {
				assert_eq!(target.line, Some(9));
				assert_eq!(target.col, None);
				assert_eq!(target.title(), "agent.ts:9");
			},
			other => panic!("expected an open hit, got {other:?}"),
		}
	}

	#[test]
	fn a_file_outside_the_roots_is_refused() {
		let dir = tempdir();
		let outside = tempdir().join("secret.txt");
		std::fs::write(&outside, "no").unwrap();
		let text = format!("see {}", outside.display());
		let hit = target_at(&buffer(&text), &metrics(), 0, 4, &dir, &[dir.clone()]);
		assert!(matches!(hit, Some(Hit::Missing(_))), "outside root must refuse: {hit:?}");
	}

	#[test]
	fn a_symlink_that_leaves_the_workspace_is_refused() {
		let dir = tempdir();
		let outside = tempdir().join("secret.txt");
		std::fs::write(&outside, "no").unwrap();
		let link = dir.join("inside.txt");
		if std::os::windows::fs::symlink_file(&outside, &link).is_err() {
			// Windows without Developer Mode cannot create a symlink: nothing
			// to prove here, and the root check above already covers the case.
			return;
		}
		let hit = target_at(&buffer("inside.txt"), &metrics(), 0, 0, &dir, &[dir.clone()]);
		assert!(matches!(hit, Some(Hit::Missing(_))), "symlink escape must refuse: {hit:?}");
	}

	#[test]
	fn a_directory_is_not_a_link() {
		let dir = tempdir();
		std::fs::create_dir_all(dir.join("docs")).unwrap();
		// Path-shaped (a separator), and it exists — but it is a directory, so
		// the page would have nothing to show.
		let hit = target_at(&buffer("open docs/ now"), &metrics(), 0, 6, &dir, &[dir.clone()]);
		assert!(matches!(hit, Some(Hit::Missing(_))), "a directory must not open: {hit:?}");
	}

	#[test]
	fn plain_prose_names_no_link() {
		let dir = tempdir();
		let hit =
			target_at(&buffer("Build succeeded in 3.2s"), &metrics(), 0, 2, &dir, &[dir.clone()]);
		assert_eq!(hit, None);
	}
}
