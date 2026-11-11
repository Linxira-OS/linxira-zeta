//! TODO / FIXME scanner for the workspace.
//!
//! The scan reuses the walker the file manager's project search already uses
//! ([`termide_walk::walker`]): the workspace is what git sees, so ignored
//! directories and `.git` are out without a second ignore implementation.
//! Binary files, huge files and non-UTF-8 content are skipped; the worker
//! honours a cancel flag file by file. Selecting a hit opens the real file in
//! the editor at the exact line and column.

use std::any::Any;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, LazyLock};

use crossterm::event::{KeyCode, MouseEvent, MouseEventKind};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use termide_core::event::PanelEvent;
use termide_core::key_chord::KeyChord;
use termide_core::panel::{Panel, RenderContext, SegmentKind, StatusSegment};

/// Refuse files above this size: a TODO scan is a source scan, not a log scan.
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;
/// Stop after this many hits; the list is a jump table, not an index.
pub const MAX_RESULTS: usize = 2000;

static MARKER_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?i)\b(TODO|FIXME|HACK|XXX)\b").unwrap());

/// One marker occurrence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoItem {
    pub path: PathBuf,
    /// 1-based.
    pub line: usize,
    /// 1-based character column of the marker.
    pub column: usize,
    /// `TODO`, `FIXME`, `HACK` or `XXX` (upper case).
    pub kind: String,
    /// The trimmed source line, capped for the list.
    pub text: String,
}

/// Scan `root` with git's view of the tree, stopping when `cancel` is set.
pub fn scan(root: &Path, cancel: &AtomicBool) -> Vec<TodoItem> {
    let mut items = Vec::new();
    for entry in termide_walk::walker(root, true) {
        if cancel.load(Ordering::Relaxed) || items.len() >= MAX_RESULTS {
            break;
        }
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.len() > MAX_FILE_BYTES {
            continue;
        }
        if termide_core::util::is_binary_file(path) {
            continue;
        }
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        let Ok(text) = String::from_utf8(bytes) else {
            continue;
        };
        for (index, line) in text.lines().enumerate() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            for found in MARKER_RE.find_iter(line) {
                items.push(TodoItem {
                    path: path.to_path_buf(),
                    line: index + 1,
                    column: line[..found.start()].chars().count() + 1,
                    kind: found.as_str().to_ascii_uppercase(),
                    text: line.trim().chars().take(200).collect(),
                });
                if items.len() >= MAX_RESULTS {
                    break;
                }
            }
            if items.len() >= MAX_RESULTS {
                break;
            }
        }
    }
    items.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then(left.line.cmp(&right.line))
            .then(left.column.cmp(&right.column))
    });
    items
}

/// The scanner as a panel: a jump list plus a rescan/cancel.
pub struct TodoPanel {
    root: PathBuf,
    items: Vec<TodoItem>,
    selected: usize,
    scroll: usize,
    cancel: Arc<AtomicBool>,
    rx: Option<Receiver<Vec<TodoItem>>>,
    scanning: bool,
    message: Option<String>,
}

impl TodoPanel {
    /// Start a scan of `root` on a worker thread.
    pub fn new(root: PathBuf) -> Self {
        let mut panel = Self {
            root,
            items: Vec::new(),
            selected: 0,
            scroll: 0,
            cancel: Arc::new(AtomicBool::new(false)),
            rx: None,
            scanning: false,
            message: None,
        };
        panel.start();
        panel
    }

    /// Start (or restart) the scan, cancelling the previous worker if it is
    /// still running.
    pub fn start(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
        let cancel = Arc::new(AtomicBool::new(false));
        self.cancel = cancel.clone();
        let (sender, receiver) = mpsc::channel();
        self.rx = Some(receiver);
        self.scanning = true;
        self.message = None;
        let root = self.root.clone();
        std::thread::spawn(move || {
            let items = scan(&root, &cancel);
            let _ = sender.send(items);
        });
    }

    /// Ask the worker to stop; the rows already found stay until it reports.
    pub fn cancel(&mut self) {
        if self.scanning {
            self.cancel.store(true, Ordering::Relaxed);
            self.message = Some("cancelling the scan…".to_owned());
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn items(&self) -> &[TodoItem] {
        &self.items
    }

    pub fn is_scanning(&self) -> bool {
        self.scanning
    }

    fn move_by(&mut self, step: isize) {
        if self.items.is_empty() {
            return;
        }
        let last = self.items.len() - 1;
        self.selected = (self.selected as isize + step).clamp(0, last as isize) as usize;
    }

    fn open_selected(&mut self) -> Vec<PanelEvent> {
        let Some(item) = self.items.get(self.selected) else {
            return Vec::new();
        };
        vec![PanelEvent::OpenFileAt {
            path: item.path.clone(),
            line: item.line,
            column: item.column,
        }]
    }

    fn relative(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .map(|path| path.display().to_string())
            .unwrap_or_else(|_| path.display().to_string())
    }
}

impl Panel for TodoPanel {
    fn name(&self) -> &'static str {
        "todo"
    }

    fn title(&self) -> String {
        if self.scanning {
            "TODO · scanning".to_owned()
        } else {
            format!("TODO ({})", self.items.len())
        }
    }

    fn render(&mut self, area: Rect, buf: &mut Buffer, ctx: &RenderContext) {
        buf.set_style(area, Style::default().bg(ctx.theme.bg).fg(ctx.theme.fg));
        if area.height == 0 {
            return;
        }
        let footer = u16::from(area.height > 1);
        let list_height = area.height - footer;
        if self.scanning && self.items.is_empty() {
            let text = format!("scanning {}…  (x cancels)", self.root.display());
            buf.set_stringn(
                area.x,
                area.y,
                &text,
                area.width as usize,
                Style::default().fg(ctx.theme.disabled),
            );
        } else {
            if self.selected < self.scroll {
                self.scroll = self.selected;
            } else if list_height > 0 && self.selected >= self.scroll + list_height as usize {
                self.scroll = self.selected + 1 - list_height as usize;
            }
            for row in 0..list_height as usize {
                let index = self.scroll + row;
                let Some(item) = self.items.get(index) else {
                    break;
                };
                let style = if index == self.selected {
                    Style::default()
                        .bg(ctx.theme.selection_bg)
                        .fg(ctx.theme.selection_fg)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(ctx.theme.fg)
                };
                let text = format!(
                    "{}:{}:{}  {}  {}",
                    self.relative(&item.path),
                    item.line,
                    item.column,
                    item.kind,
                    item.text
                );
                buf.set_stringn(
                    area.x,
                    area.y + row as u16,
                    &text,
                    area.width as usize,
                    style,
                );
            }
        }
        if footer == 1 {
            let row = area.y + area.height - 1;
            let hint = match self.message.as_deref() {
                Some(message) => message.to_owned(),
                None if self.scanning => "scanning…  x cancel".to_owned(),
                None => {
                    format!(
                        "{} markers · Enter opens the file · r rescan · x cancel",
                        self.items.len()
                    )
                }
            };
            buf.set_stringn(
                area.x,
                row,
                &hint,
                area.width as usize,
                Style::default().fg(ctx.theme.disabled),
            );
        }
    }

    fn handle_key(&mut self, chord: KeyChord) -> Vec<PanelEvent> {
        match chord.raw.code {
            KeyCode::Up | KeyCode::Char('k') => {
                self.move_by(-1);
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Down | KeyCode::Char('j') => {
                self.move_by(1);
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::PageUp => {
                self.move_by(-10);
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::PageDown => {
                self.move_by(10);
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Home => {
                self.selected = 0;
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::End => {
                self.selected = self.items.len().saturating_sub(1);
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Enter | KeyCode::Char('o') => self.open_selected(),
            KeyCode::Char('r') => {
                self.start();
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Char('x') => {
                self.cancel();
                vec![PanelEvent::NeedsRedraw]
            }
            _ => Vec::new(),
        }
    }

    fn handle_mouse(&mut self, event: MouseEvent, panel_area: Rect) -> Vec<PanelEvent> {
        if !matches!(event.kind, MouseEventKind::Down(_)) {
            return Vec::new();
        }
        if !panel_area.contains((event.column, event.row).into()) {
            return Vec::new();
        }
        let footer = u16::from(panel_area.height > 1);
        if event.row >= panel_area.y + panel_area.height - footer {
            return Vec::new();
        }
        let index = self.scroll + (event.row - panel_area.y) as usize;
        if index >= self.items.len() {
            return Vec::new();
        }
        if index == self.selected {
            return self.open_selected();
        }
        self.selected = index;
        vec![PanelEvent::NeedsRedraw]
    }

    fn handle_scroll(&mut self, delta: i32, _panel_area: Rect) -> Vec<PanelEvent> {
        self.move_by(delta as isize);
        vec![PanelEvent::NeedsRedraw]
    }

    fn tick(&mut self) -> Vec<PanelEvent> {
        let Some(receiver) = self.rx.as_ref() else {
            return Vec::new();
        };
        match receiver.try_recv() {
            Ok(items) => {
                self.items = items;
                self.rx = None;
                self.scanning = false;
                self.selected = 0;
                self.scroll = 0;
                self.message = None;
                vec![PanelEvent::NeedsRedraw]
            }
            Err(mpsc::TryRecvError::Empty) => Vec::new(),
            Err(mpsc::TryRecvError::Disconnected) => {
                self.rx = None;
                self.scanning = false;
                vec![PanelEvent::NeedsRedraw]
            }
        }
    }

    fn status_segments(&self) -> Vec<StatusSegment> {
        vec![StatusSegment {
            text: self
                .message
                .clone()
                .unwrap_or_else(|| "Enter opens the hit in the editor · x cancels".to_owned()),
            kind: SegmentKind::Label,
            action: None,
        }]
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
    fn scan_finds_markers_and_skips_ignored_binary_and_oversized_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("target")).unwrap();
        std::fs::write(root.join(".gitignore"), "target/\n").unwrap();
        std::fs::write(
            root.join("src/main.rs"),
            "fn main() {\n    // TODO: wire this up\n    let x = 1; // FIXME later\n}\n",
        )
        .unwrap();
        std::fs::write(root.join("target/skip.rs"), "// TODO hidden\n").unwrap();
        std::fs::write(root.join("binary.rs"), b"// TODO\0binary\n").unwrap();
        let big = format!("// TODO\n{}", "x".repeat(MAX_FILE_BYTES as usize));
        std::fs::write(root.join("big.rs"), big).unwrap();

        let cancel = AtomicBool::new(false);
        let items = scan(root, &cancel);
        assert_eq!(items.len(), 2, "only the two markers in src/main.rs");
        assert_eq!(items[0].kind, "TODO");
        assert_eq!(items[0].line, 2);
        assert_eq!(items[1].kind, "FIXME");
        assert_eq!(items[1].line, 3);
        assert!(items.iter().all(|item| item.column > 1));
    }

    #[test]
    fn an_already_cancelled_scan_returns_nothing() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.rs"), "// TODO nope\n").unwrap();
        let cancel = AtomicBool::new(true);
        assert!(scan(dir.path(), &cancel).is_empty());
    }

    #[test]
    fn the_panel_cancels_without_losing_the_rows_it_has() {
        let dir = tempfile::tempdir().unwrap();
        let mut panel = TodoPanel::new(dir.path().to_path_buf());
        panel.cancel();
        assert!(panel.message.as_deref().unwrap().contains("cancelling"));
    }
}
