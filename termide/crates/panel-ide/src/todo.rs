//! A workspace TODO scanner: the markers a reader leaves behind, as a list.
//!
//! The scan is a plain directory walk (no git, no shell) so it works in any
//! checkout and is cheap to test: markers are matched as whole words, generated
//! trees are skipped, and the list is capped so a large repository cannot stall
//! the page.

use std::any::Any;
use std::path::{Path, PathBuf};

use crossterm::event::{KeyCode, MouseEvent, MouseEventKind};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use termide_core::event::PanelEvent;
use termide_core::key_chord::KeyChord;
use termide_core::panel::{Panel, RenderContext};

/// The markers the scan looks for, as whole words.
const MARKERS: [&str; 4] = ["TODO", "FIXME", "XXX", "HACK"];
/// Trees that never hold the reader's own markers.
const SKIP_DIRS: [&str; 7] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".hg",
    ".svn",
];
/// The list stops here; the page is a reminder, not an index.
const MAX_HITS: usize = 500;
/// Files larger than this are not scanned (a lockfile's comments are not tasks).
const MAX_FILE: u64 = 512 * 1024;

/// One marker found in the tree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hit {
    pub path: PathBuf,
    pub line: usize,
    pub text: String,
}

/// Scan `root` for markers, depth first, skipping generated trees.
pub fn scan(root: &Path) -> Vec<Hit> {
    let mut hits = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if !SKIP_DIRS.contains(&name.as_ref()) {
                    stack.push(path);
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if entry
                .metadata()
                .map(|meta| meta.len() > MAX_FILE)
                .unwrap_or(true)
            {
                continue;
            }
            let Ok(contents) = std::fs::read_to_string(&path) else {
                continue;
            };
            for (index, line) in contents.lines().enumerate() {
                if !has_marker(line) {
                    continue;
                }
                let text = line.trim();
                let text = if text.chars().count() > 200 {
                    text.chars().take(200).collect::<String>() + "..."
                } else {
                    text.to_owned()
                };
                hits.push(Hit {
                    path: path.clone(),
                    line: index + 1,
                    text,
                });
                if hits.len() >= MAX_HITS {
                    return hits;
                }
            }
        }
    }
    hits.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)));
    hits
}

/// Whether `line` carries one of the markers as a whole word (`TODOS` does not).
fn has_marker(line: &str) -> bool {
    line.split(|character: char| !character.is_alphanumeric() && character != '_')
        .any(|word| MARKERS.contains(&word))
}

/// The scanner as a panel: the list, the selection, and "open at the marker".
pub struct TodoPanel {
    root: PathBuf,
    hits: Vec<Hit>,
    selected: usize,
    scroll: usize,
}

impl TodoPanel {
    pub fn new(root: PathBuf) -> Self {
        let hits = scan(&root);
        Self {
            root,
            hits,
            selected: 0,
            scroll: 0,
        }
    }

    pub fn hits(&self) -> &[Hit] {
        &self.hits
    }

    fn selected_hit(&self) -> Option<&Hit> {
        self.hits.get(self.selected)
    }

    fn move_by(&mut self, step: isize) {
        if self.hits.is_empty() {
            return;
        }
        let last = self.hits.len() - 1;
        let next = (self.selected as isize + step).clamp(0, last as isize) as usize;
        self.selected = next;
    }

    /// The label of a hit: path relative to the scan root, then the line.
    fn label(&self, hit: &Hit) -> String {
        let relative = hit
            .path
            .strip_prefix(&self.root)
            .unwrap_or(hit.path.as_path());
        format!("{}:{}  {}", relative.display(), hit.line, hit.text)
    }
}

impl Panel for TodoPanel {
    fn name(&self) -> &'static str {
        "todo"
    }

    fn title(&self) -> String {
        format!("TODO ({})", self.hits.len())
    }

    fn render(&mut self, area: Rect, buf: &mut Buffer, ctx: &RenderContext) {
        buf.set_style(area, Style::default().bg(ctx.theme.bg).fg(ctx.theme.fg));
        let visible = area.height as usize;
        if visible == 0 {
            return;
        }
        // Keep the selection in the window.
        if self.selected < self.scroll {
            self.scroll = self.selected;
        } else if self.selected >= self.scroll + visible {
            self.scroll = self.selected + 1 - visible;
        }
        for row in 0..visible {
            let index = self.scroll + row;
            let Some(hit) = self.hits.get(index) else {
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
            let label = self.label(hit);
            buf.set_stringn(
                area.x,
                area.y + row as u16,
                &label,
                area.width as usize,
                style,
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
            KeyCode::Enter => match self.selected_hit() {
                Some(hit) => {
                    let event = PanelEvent::OpenFileAt {
                        path: hit.path.clone(),
                        line: hit.line,
                        column: 1,
                    };
                    vec![event]
                }
                None => Vec::new(),
            },
            KeyCode::Char('r') => {
                self.hits = scan(&self.root);
                self.selected = 0;
                self.scroll = 0;
                vec![PanelEvent::NeedsRedraw]
            }
            _ => Vec::new(),
        }
    }

    fn handle_mouse(&mut self, event: MouseEvent, panel_area: Rect) -> Vec<PanelEvent> {
        if matches!(event.kind, MouseEventKind::Down(_))
            && panel_area.contains((event.column, event.row).into())
        {
            let row = (event.row - panel_area.y) as usize;
            let index = self.scroll + row;
            if index < self.hits.len() {
                self.selected = index;
                return vec![PanelEvent::NeedsRedraw];
            }
        }
        Vec::new()
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

    fn tree() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = dir.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("node_modules")).unwrap();
        std::fs::write(
            root.join("src/a.rs"),
            "let x = 1; // TODO: wire this\nfn main() {}\n",
        )
        .unwrap();
        std::fs::write(
            root.join("src/b.rs"),
            "// FIXME: leak\n// TODOS is not a marker\n",
        )
        .unwrap();
        std::fs::write(root.join("node_modules/c.rs"), "// TODO: not ours\n").unwrap();
        std::fs::write(root.join("plain.txt"), "no markers here\n").unwrap();
        dir
    }

    #[test]
    fn markers_are_whole_words_and_generated_trees_are_skipped() {
        let dir = tree();
        let hits = scan(dir.path());
        // Compare names, not rendered paths: Windows spells the separator differently.
        let labels: Vec<(String, usize)> = hits
            .iter()
            .map(|hit| {
                let name = hit
                    .path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default();
                (name, hit.line)
            })
            .collect();
        assert_eq!(
            labels,
            vec![("a.rs".to_owned(), 1), ("b.rs".to_owned(), 1)],
            "node_modules and TODOS are out"
        );
    }

    #[test]
    fn the_list_opens_the_hit_at_its_line() {
        let dir = tree();
        let mut panel = TodoPanel::new(dir.path().to_path_buf());
        assert_eq!(panel.hits().len(), 2);
        panel.move_by(1);
        let events = panel.handle_key(KeyChord {
            raw: crossterm::event::KeyEvent::new(
                KeyCode::Enter,
                crossterm::event::KeyModifiers::NONE,
            ),
            canonical: crossterm::event::KeyEvent::new(
                KeyCode::Enter,
                crossterm::event::KeyModifiers::NONE,
            ),
        });
        assert!(
            matches!(events.as_slice(), [PanelEvent::OpenFileAt { line: 1, .. }]),
            "the second hit is b.rs:1: {events:?}"
        );
    }
}
