//! A scratch note beside the code, backed by a real file.
//!
//! `.zeta/notepad.md` in the workspace root is the note: it survives restarts,
//! it can be opened in any editor, and it is not a hidden buffer that only this
//! process can read. The panel is the termide editor pointed at that file.

use std::any::Any;
use std::path::{Path, PathBuf};

use crossterm::event::MouseEvent;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use termide_core::event::PanelEvent;
use termide_core::key_chord::KeyChord;
use termide_core::panel::{Panel, RenderContext};
use termide_panel_editor::{Editor, EditorConfig};

/// The note's path inside a workspace.
pub const NOTEPAD: &str = ".zeta/notepad.md";

/// The workspace note.
pub struct NotepadPanel {
    editor: Editor,
    path: PathBuf,
}

impl NotepadPanel {
    /// Open (creating on first use) `<root>/.zeta/notepad.md`.
    pub fn new(root: &Path) -> Self {
        let path = root.join(NOTEPAD);
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if !path.exists() {
            let _ = std::fs::write(&path, "# Notepad\n\n");
        }
        // A note that cannot be parsed as a buffer still opens blank: losing the
        // note is worse than losing the highlighting.
        let editor = Editor::open_file_with_config(path.clone(), EditorConfig::default())
            .unwrap_or_else(|_| Editor::new());
        Self { editor, path }
    }

    /// Where the note lives (the tests and the app both read it).
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Panel for NotepadPanel {
    fn name(&self) -> &'static str {
        "notepad"
    }

    fn title(&self) -> String {
        "Notepad".to_owned()
    }

    fn prepare_render(
        &mut self,
        theme: &termide_theme::Theme,
        config: &std::sync::Arc<termide_config::Config>,
    ) {
        self.editor.prepare_render(theme, config);
    }

    fn render(&mut self, area: Rect, buf: &mut Buffer, ctx: &RenderContext) {
        self.editor.render(area, buf, ctx);
    }

    fn handle_key(&mut self, chord: KeyChord) -> Vec<PanelEvent> {
        self.editor.handle_key(chord)
    }

    fn handle_mouse(&mut self, event: MouseEvent, panel_area: Rect) -> Vec<PanelEvent> {
        self.editor.handle_mouse(event, panel_area)
    }

    fn handle_scroll(&mut self, delta: i32, panel_area: Rect) -> Vec<PanelEvent> {
        self.editor.handle_scroll(delta, panel_area)
    }

    fn tick(&mut self) -> Vec<PanelEvent> {
        self.editor.tick()
    }

    fn status_segments(&self) -> Vec<termide_core::panel::StatusSegment> {
        self.editor.status_segments()
    }

    fn reload(&mut self) -> anyhow::Result<()> {
        self.editor.reload_from_disk()
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_open_creates_the_note_in_the_workspace() {
        let dir = tempfile::tempdir().expect("temp dir");
        let panel = NotepadPanel::new(dir.path());
        let path = dir.path().join(NOTEPAD);
        assert!(path.is_file(), "the note exists at {}", path.display());
        assert_eq!(panel.path(), path, "the panel points at the workspace note");
        assert_eq!(panel.name(), "notepad");
    }

    #[test]
    fn an_existing_note_is_opened_not_overwritten() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir_all(dir.path().join(".zeta")).unwrap();
        let path = dir.path().join(NOTEPAD);
        std::fs::write(&path, "keep me\n").unwrap();
        let _panel = NotepadPanel::new(dir.path());
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(
            content.contains("keep me"),
            "the note survives: {content:?}"
        );
    }
}
