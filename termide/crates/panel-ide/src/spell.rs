//! Spell check: run the system dictionary over a file and list what it does not
//! know.
//!
//! There is no dictionary in this repository, and bundling one would put a
//! multi-megabyte English wordlist into every install while doing nothing for
//! identifiers or Chinese prose. So the panel drives whichever checker the
//! machine already has (`aspell` or `hunspell`) and says so plainly when
//! neither is installed.

use std::any::Any;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crossterm::event::{KeyCode, MouseEvent, MouseEventKind};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use termide_core::event::PanelEvent;
use termide_core::key_chord::KeyChord;
use termide_core::panel::{Panel, RenderContext};

/// Checkers in preference order, with the argv that makes them report only the
/// unknown words on stdout.
const CHECKERS: [(&str, &[&str]); 2] = [("aspell", &["list"]), ("hunspell", &["-l"])];

/// The first installed checker.
pub fn checker() -> Option<(&'static str, &'static [&'static str])> {
    CHECKERS.iter().copied().find(|(tool, _)| {
        Command::new(tool)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    })
}

/// Count the reported words, in first-seen order.
pub fn count_words(stdout: &str) -> Vec<(String, usize)> {
    let mut words: Vec<(String, usize)> = Vec::new();
    for word in stdout
        .lines()
        .map(str::trim)
        .filter(|word| !word.is_empty())
    {
        match words.iter_mut().find(|(seen, _)| seen == word) {
            Some((_, count)) => *count += 1,
            None => words.push((word.to_owned(), 1)),
        }
    }
    words
}

/// Run the checker over `path`.
pub fn check(path: &Path) -> Result<Vec<(String, usize)>, String> {
    // The file is read first so a bad path is reported as such even on a machine
    // with no dictionary installed.
    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    let (tool, args) =
        checker().ok_or_else(|| "No dictionary found — install aspell or hunspell.".to_owned())?;
    let mut child = Command::new(tool)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("cannot run {tool}: {error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| format!("{tool} has no stdin"))?
        .write_all(text.as_bytes())
        .map_err(|error| format!("cannot feed {tool}: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("{tool} failed: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "{tool} exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(count_words(&String::from_utf8_lossy(&output.stdout)))
}

/// The spell-check panel for one file.
pub struct SpellPanel {
    path: PathBuf,
    words: Vec<(String, usize)>,
    error: Option<String>,
    selected: usize,
    scroll: usize,
    message: Option<String>,
}

impl SpellPanel {
    pub fn new(path: PathBuf) -> Self {
        let mut panel = Self {
            path,
            words: Vec::new(),
            error: None,
            selected: 0,
            scroll: 0,
            message: None,
        };
        panel.reload();
        panel
    }

    fn reload(&mut self) {
        self.selected = 0;
        self.scroll = 0;
        match check(&self.path) {
            Ok(words) => {
                self.words = words;
                self.error = None;
            }
            Err(error) => {
                self.words.clear();
                self.error = Some(error);
            }
        }
    }

    fn move_by(&mut self, step: isize) {
        if self.words.is_empty() {
            return;
        }
        let last = self.words.len() as isize - 1;
        self.selected = (self.selected as isize + step).clamp(0, last) as usize;
    }
}

impl Panel for SpellPanel {
    fn name(&self) -> &'static str {
        "spell"
    }

    fn title(&self) -> String {
        let name = self
            .path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        format!("Spell · {name}")
    }

    fn render(&mut self, area: Rect, buf: &mut Buffer, ctx: &RenderContext) {
        buf.set_style(area, Style::default().bg(ctx.theme.bg).fg(ctx.theme.fg));
        let visible = area.height as usize;
        if visible == 0 {
            return;
        }
        if let Some(error) = &self.error {
            buf.set_stringn(
                area.x,
                area.y,
                error,
                area.width as usize,
                Style::default().fg(ctx.theme.error),
            );
            return;
        }
        if self.words.is_empty() {
            let done = "No unknown words.";
            buf.set_stringn(
                area.x,
                area.y,
                done,
                area.width as usize,
                Style::default().fg(ctx.theme.success),
            );
            return;
        }
        if self.selected < self.scroll {
            self.scroll = self.selected;
        } else if self.selected >= self.scroll + visible {
            self.scroll = self.selected + 1 - visible;
        }
        for row in 0..visible {
            let index = self.scroll + row;
            let Some((word, count)) = self.words.get(index) else {
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
            let line = format!("{word} ×{count}");
            buf.set_stringn(
                area.x,
                area.y + row as u16,
                &line,
                area.width as usize,
                style,
            );
        }
        if let Some(message) = &self.message {
            let row = area.y + area.height.saturating_sub(1);
            buf.set_stringn(
                area.x,
                row,
                message,
                area.width as usize,
                Style::default().fg(ctx.theme.warning),
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
            KeyCode::Enter => {
                if let Some((word, _)) = self.words.get(self.selected) {
                    self.message = Some(match termide_clipboard::copy(word.as_str()) {
                        Ok(()) => format!("Copied {word}"),
                        Err(error) => format!("Cannot copy: {error}"),
                    });
                }
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Char('r') => {
                self.message = None;
                self.reload();
                vec![PanelEvent::NeedsRedraw]
            }
            _ => Vec::new(),
        }
    }

    fn handle_mouse(&mut self, event: MouseEvent, panel_area: Rect) -> Vec<PanelEvent> {
        if let MouseEventKind::Down(_) = event.kind {
            if panel_area.contains((event.column, event.row).into()) {
                let index = self.scroll + (event.row - panel_area.y) as usize;
                if index < self.words.len() {
                    self.selected = index;
                    return vec![PanelEvent::NeedsRedraw];
                }
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

    #[test]
    fn the_counts_follow_first_appearance_and_ignore_blank_lines() {
        let words = count_words("teh\nrecieve\nteh\n\nrecieve\n");
        assert_eq!(
            words,
            vec![("teh".to_owned(), 2), ("recieve".to_owned(), 2)]
        );
    }

    #[test]
    fn a_missing_file_reports_its_path() {
        let error = check(Path::new("definitely/not/here.md")).expect_err("missing file");
        assert!(error.contains("cannot read"), "{error}");
    }

    #[test]
    fn the_panel_says_which_checker_is_missing_rather_than_showing_an_empty_list() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        std::fs::write(&path, "hello world").unwrap();
        let panel = SpellPanel::new(path);
        // Whether a checker exists is a property of the machine; both outcomes are
        // honest, and neither may be an empty word list with no explanation.
        assert!(
            panel.error.is_some() || !panel.words.is_empty(),
            "either an explanation or words, never a silent empty list"
        );
    }
}
