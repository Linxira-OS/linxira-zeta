//! zetawork's **in-process** editor pane.
//!
//! The editor pane is the only editor this product has: the pane body is
//! termide's own `panel-editor` widget (`PaneKind::Editor`, see `tab.rs`),
//! rendered in-process like the Time/Pomodoro/Clipboard widgets. It gives
//! file open, line numbers, syntax highlighting, and Ctrl+S save-to-disk with
//! no child process and no external program. There is no editor command to
//! install or spawn — the retired `zetaeditor`/`zeta-editor`/`zeta-e` bins
//! are gone (registry: companion-product bins), and link-open falls back to
//! the suite IDE (`zetaide`) instead.
//!
//! ## Language features are intentionally absent
//!
//! No `LspManager` is created and no language server is ever spawned from the
//! embedded pane, so completion / go-to-definition / diagnostics are **not**
//! wired in this slice. The pane header says so out loud
//! ([`LSP_NOTICE`]) — it never pretends a language service is running.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use termide_core::{Panel, PanelConfig, RenderContext, ThemeColors};
use termide_panel_editor::{Editor, EditorConfig};
use termide_theme::Theme;

/// The plain-English notice the header carries while the embedded editor has
/// no language service behind it. Rendered verbatim in the pane's top row.
pub const LSP_NOTICE: &str = "本版未接语言服务";

/// Editor configuration for a zetawork embedded editor pane.
///
/// Syntax highlighting is on (the point of embedding termide's editor), the
/// buffer is editable, and Vim mode is off by default. `prepare_render`
/// re-syncs word-wrap/tab-size/auto-indent from the workbench config on every
/// frame, so these are only the pre-first-frame defaults.
fn editor_config() -> EditorConfig {
	EditorConfig {
		syntax_highlighting: true,
		read_only: false,
		word_wrap: false,
		vim_mode: false,
		tab_size: 4,
		auto_indent: true,
		auto_close_brackets: true,
		initial_directory: None,
		keybindings: termide_config::EditorKeybindings::default(),
	}
}

/// A fresh embedded editor with an empty, untitled buffer (Alt+E before any
/// file has been chosen).
pub fn new_editor() -> Editor {
	Editor::with_config(editor_config())
}

/// An embedded editor opened on `path`, read from disk, editable, saving back
/// to the same path on Ctrl+S.
pub fn open_editor(path: &Path) -> Result<Editor> {
	Editor::open_file_with_config(path.to_path_buf(), editor_config())
}

/// The pane's one-row status header: `path · language · line:col · notice`.
///
/// The full path (not just the base name) is shown so the reader always knows
/// exactly which file the pane has open. The language features notice is
/// always present — see the module docs.
fn header_line(editor: &Editor) -> Line<'static> {
	let info = editor.get_editor_info();
	let path = editor
		.file_path()
		.map(PathBuf::from)
		.map(|p| p.display().to_string())
		.unwrap_or_else(|| "[untitled]".to_string());

	let dim = Style::default().fg(Color::DarkGray);
	let sep = || Span::styled("  ·  ", dim);
	Line::from(vec![
		Span::styled(format!(" {path}"), Style::default().add_modifier(Modifier::BOLD)),
		sep(),
		Span::styled(info.file_type, Style::default().fg(Color::Cyan)),
		sep(),
		Span::styled(format!("{}:{}", info.line, info.column), Style::default().fg(Color::Yellow)),
		sep(),
		Span::styled(LSP_NOTICE, dim),
	])
}

/// Everything the embedded editor needs from the workbench to render — the
/// subset of the draw loop's state that is not the editor itself.
pub struct EditorView<'a> {
	pub theme: &'a Theme,
	pub config: &'a Arc<termide_config::Config>,
	pub panel_config: &'a PanelConfig,
	pub is_focused: bool,
	pub panel_index: usize,
	pub terminal_width: u16,
	pub terminal_height: u16,
	pub border_right_x: Option<u16>,
	pub border_bottom_y: Option<u16>,
}

impl EditorView<'_> {
	/// Draw the embedded editor into `inner` (the pane's inner rect, borders
	/// already stripped): the status header on the top row, the buffer below.
	/// The same call path serves the live draw loop and the tests.
	pub fn render(&self, editor: &mut Editor, inner: Rect, buf: &mut Buffer) {
		editor.prepare_render(self.theme, self.config);

		// The status header owns the top row; the buffer gets the rest.
		let header_h = u16::from(inner.height > 0);
		if header_h == 1 && inner.width > 0 {
			let line = header_line(editor);
			buf.set_line(inner.x, inner.y, &line, inner.width);
		}

		let body = Rect {
			x: inner.x,
			y: inner.y + header_h,
			width: inner.width,
			height: inner.height.saturating_sub(header_h),
		};
		if body.width == 0 || body.height == 0 {
			return;
		}

		let colors = ThemeColors::from(self.theme);
		let ctx = RenderContext {
			theme: &colors,
			config: self.panel_config,
			is_focused: self.is_focused,
			panel_index: self.panel_index,
			terminal_width: self.terminal_width,
			terminal_height: self.terminal_height,
			border_right_x: self.border_right_x,
			border_bottom_y: self.border_bottom_y,
		};
		editor.render(body, buf, &ctx);
	}
}

/// The rect to hand the editor's own mouse handler for a pane whose outer rect
/// is `area`. The editor computes its content rect by insetting one border cell
/// (`panel-editor`'s `handle_mouse`), while [`EditorView::render`] draws the
/// body starting one row below the pane's inner top (our status header owns
/// that row). Handing it the pane minus the header row makes both agree.
pub fn mouse_area(area: Rect) -> Rect {
	Rect { x: area.x, y: area.y + 1, width: area.width, height: area.height.saturating_sub(1) }
}

#[cfg(test)]
mod tests {
	use ratatui::{Terminal, backend::TestBackend};
	use termide_core::KeyChord;

	use super::*;
	use crate::tab::{Pane, PaneKind};

	/// Render one pane's editor body through a real `TestBackend` and read the
	/// frame back as one whitespace-normalized string per row — the same path
	/// the workbench draws the embedded editor through.
	fn draw(pane: &mut Pane, width: u16, height: u16) -> Vec<String> {
		let theme = Theme::default();
		// Same normalization the workspace applies, so the editor's hotkey
		// table (Ctrl+S) is built exactly as it is at runtime.
		let mut config = termide_config::Config::default();
		config.normalize();
		let config = Arc::new(config);
		let panel_config = PanelConfig::default();
		let mut terminal = Terminal::new(TestBackend::new(width, height)).expect("terminal");
		terminal
			.draw(|frame| {
				let area = frame.area();
				// Mirror the pane chrome: one cell of border on each side, so
				// the editor body lands where the live draw loop puts it.
				let inner = Rect {
					x: area.x + 1,
					y: area.y + 1,
					width: area.width.saturating_sub(2),
					height: area.height.saturating_sub(2),
				};
				let view = EditorView {
					theme: &theme,
					config: &config,
					panel_config: &panel_config,
					is_focused: true,
					panel_index: 0,
					terminal_width: width,
					terminal_height: height,
					border_right_x: Some(area.right().saturating_sub(1)),
					border_bottom_y: Some(area.bottom().saturating_sub(1)),
				};
				let editor = pane.as_editor().expect("pane holds an editor");
				view.render(editor, inner, frame.buffer_mut());
			})
			.expect("draw");
		let buffer = terminal.backend().buffer().clone();
		buffer
			.content
			.chunks(buffer.area.width as usize)
			.map(|row| {
				row.iter()
					.map(|cell| cell.symbol())
					.collect::<String>()
					.trim_end()
					.to_string()
			})
			.collect()
	}

	/// A temp file with `contents` at a path whose base name is `name`.
	fn fixture(dir: &tempfile::TempDir, name: &str, contents: &str) -> PathBuf {
		let path = dir.path().join(name);
		std::fs::write(&path, contents).expect("write fixture");
		path
	}

	/// An editor pane (no PTY — the embedded editor spawns no child process).
	fn editor_pane() -> Pane {
		Pane::new(PaneKind::Editor, 24, 80, None).expect("editor pane")
	}

	/// Open `path` in `pane` exactly as the workbench does: build the editor
	/// from the file first, then swap it into the pane's placeholder page.
	fn open(pane: &mut Pane, path: &Path) {
		let editor = open_editor(path).expect("open editor");
		pane.set_editor_page(editor, path);
	}

	#[test]
	fn shows_the_real_file_lines_with_line_numbers() {
		let dir = tempfile::tempdir().expect("tempdir");
		let path = fixture(&dir, "notes.txt", "alpha first\nbeta second\ngamma third\n");
		let mut pane = editor_pane();
		open(&mut pane, &path);

		let rows = draw(&mut pane, 60, 12);
		let frame = rows.join("\n");

		// ① the real line contents are visible in the panel …
		assert!(frame.contains("alpha first"), "first line missing:\n{frame}");
		assert!(frame.contains("beta second"), "second line missing:\n{frame}");
		assert!(frame.contains("gamma third"), "third line missing:\n{frame}");
		// … with the line-number gutter termide draws.
		assert!(rows.iter().any(|r| r.trim_start().starts_with("1 ")), "no line number:\n{frame}");
	}

	#[test]
	fn header_row_shows_the_file_path_and_language() {
		let dir = tempfile::tempdir().expect("tempdir");
		let path = fixture(&dir, "main.rs", "fn main() {}\n");
		let mut pane = editor_pane();
		open(&mut pane, &path);

		let rows = draw(&mut pane, 100, 12);

		// ② the panel's top row (the first row inside the pane border)
		// carries the file's real path.
		let header = rows
			.iter()
			.find(|r| !r.trim().is_empty())
			.expect("a header row");
		assert!(
			header.contains(&path.display().to_string()),
			"header row {header:?} does not show the path {path:?}"
		);
		// … plus the language and the cursor position, and the honest notice
		// that no language service is attached. The notice is CJK, so its
		// glyphs span two cells and the read-back row interleaves blanks —
		// compare with all whitespace removed.
		assert!(header.contains("Rust"), "header lacks the language: {header:?}");
		assert!(header.contains("1:1"), "header lacks line:col: {header:?}");
		let flat: String = header.chars().filter(|c| !c.is_whitespace()).collect();
		let notice: String = LSP_NOTICE.chars().filter(|c| !c.is_whitespace()).collect();
		assert!(flat.contains(&notice), "header lacks the LSP notice: {header:?}");
	}

	#[test]
	fn editing_a_line_and_saving_writes_the_disk() {
		let dir = tempfile::tempdir().expect("tempdir");
		let path = fixture(&dir, "todo.txt", "one\ntwo\nthree\n");
		let mut pane = editor_pane();
		open(&mut pane, &path);

		// A first draw builds the editor's hotkey table (Ctrl+S → save).
		let _ = draw(&mut pane, 60, 12);

		{
			let editor = pane.as_editor().expect("editor");
			// Insert a marker at the very start of the buffer…
			editor.insert_text("MARK ").expect("insert");
			// … then save with the real Ctrl+S chord (not a direct `save()`
			// call), so the keybinding wiring is what the test exercises.
			let _ = editor.handle_key(KeyChord::identity(crossterm::event::KeyEvent::new(
				crossterm::event::KeyCode::Char('s'),
				crossterm::event::KeyModifiers::CONTROL,
			)));
		}

		// ③ the file on disk really changed.
		let on_disk = std::fs::read_to_string(&path).expect("read back");
		assert!(on_disk.contains("MARK "), "disk not updated: {on_disk:?}");
	}

	#[test]
	fn opening_a_second_file_keeps_the_first_intact() {
		let dir = tempfile::tempdir().expect("tempdir");
		let first = fixture(&dir, "a.txt", "first file\n");
		let second = fixture(&dir, "b.txt", "second file\n");

		// The workbench opens each file in its own editor pane: two panes get
		// two independent buffers.
		let mut pane_a = editor_pane();
		open(&mut pane_a, &first);
		let mut pane_b = editor_pane();
		open(&mut pane_b, &second);

		// ④ the second open neither panics nor bleeds into the first pane.
		let frame_a = draw(&mut pane_a, 60, 8).join("\n");
		assert!(frame_a.contains("first file"), "first pane lost its content:\n{frame_a}");
		assert!(!frame_a.contains("second file"), "second file bled in:\n{frame_a}");

		let frame_b = draw(&mut pane_b, 60, 8).join("\n");
		assert!(frame_b.contains("second file"), "second pane missing content:\n{frame_b}");
		assert!(!frame_b.contains("first file"), "first file bled in:\n{frame_b}");
	}
}
