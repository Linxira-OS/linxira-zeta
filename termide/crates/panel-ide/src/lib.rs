//! `panel-ide` — the standard IDE page: **one fixed layout, the same in the TUI
//! and in the GUI**.
//!
//! The page is deliberately *not* a free-form tiling workspace. The familiar
//! shape is the feature:
//!
//! ```text
//! ┌ tabs: a.rs ×  b.rs × ───────────────────────────┐
//! ├──────────────┬──────────────────────────────────┤
//! │ file tree    │                                  │
//! │ ──────────── │            editor                │
//! │ git changes  │                                  │
//! ├──────────────┴──────────────────────────────────┤
//! │ Ln 1, Col 1   Spaces: 4   UTF-8   LF            │
//! └─────────────────────────────────────────────────┘
//! ```
//!
//! Only two dividers move (left width, git height); everything else is fixed,
//! which is what makes the page legible to someone who has used VS Code.
//!
//! The page owns the "a file was chosen" contract: the left pane (the file tree
//! by default) emits [`PanelEvent::OpenFile`] and the page turns that into a
//! tab, so the host app never has to know how the page is composed. Each tab
//! gets an [`Editor`] lazily, on first activation — opening ten files does not
//! parse ten syntax trees, and the LSP config reaches the editor through the
//! panel protocol the app already speaks.
//!
//! Rendering is a `ratatui::Buffer`, so the desktop shell hosts the *same* page
//! through `Panel::render` → blit — the terminal panel already proves that road.

use std::any::Any;
use std::path::PathBuf;
use std::sync::Arc;

use crossterm::event::{KeyCode, KeyModifiers, MouseEvent, MouseEventKind};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use termide_config::Config;
use termide_core::event::PanelEvent;
use termide_core::key_chord::KeyChord;
use termide_core::panel::{Panel, RenderContext, SegmentKind, StatusSegment};
use termide_panel_editor::{Editor, EditorConfig};
use termide_panel_git_log::GitLogPanel;
use termide_panel_git_status::GitStatusPanel;
use termide_theme::Theme;

/// The tab strip is one row: ` title × `.
pub const TAB_HEIGHT: u16 = 1;
/// The status line is one row.
pub const STATUS_HEIGHT: u16 = 1;
/// The left column never shrinks below this.
pub const MIN_LEFT: u16 = 16;
/// The editor keeps at least this much width before the left column collapses.
pub const MIN_EDITOR: u16 = 24;
/// Opening size of the left column.
pub const DEFAULT_LEFT: u16 = 30;
/// Opening height of the git pane inside the left column.
pub const DEFAULT_GIT: u16 = 9;

/// One open file, as a tab.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tab {
    pub path: PathBuf,
    pub title: String,
    pub dirty: bool,
}

impl Tab {
    fn from_path(path: PathBuf) -> Self {
        let title = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());
        Self {
            path,
            title,
            dirty: false,
        }
    }
}

/// A tab and its editor. The editor is created on first activation.
struct TabEntry {
    tab: Tab,
    editor: Option<Editor>,
}

/// The page's rectangles, derived from the area and the two dividers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Layout {
    pub tabs: Rect,
    pub left: Rect,
    pub git: Rect,
    pub editor: Rect,
    pub status: Rect,
    pub left_divider_x: u16,
    pub git_divider_y: u16,
}

impl Layout {
    /// The tree/source area: the left column above the git divider.
    pub fn tree(&self) -> Rect {
        Rect::new(
            self.left.x,
            self.left.y,
            self.left.width,
            self.git.y.saturating_sub(self.left.y),
        )
    }
}

/// The fixed layout. `left_width` is clamped so the editor keeps [`MIN_EDITOR`]
/// and the left column keeps [`MIN_LEFT`]; when the area is too small for both,
/// the left column collapses and the editor takes the whole body — the page
/// never draws a column narrower than a path.
pub fn layout(area: Rect, left_width: u16, git_height: u16) -> Layout {
    let tabs = Rect::new(area.x, area.y, area.width, TAB_HEIGHT.min(area.height));
    let status_h = STATUS_HEIGHT.min(area.height.saturating_sub(TAB_HEIGHT));
    let status = Rect::new(
        area.x,
        area.y + area.height - status_h,
        area.width,
        status_h,
    );
    let body = Rect::new(
        area.x,
        area.y + tabs.height,
        area.width,
        area.height - tabs.height - status_h,
    );

    let room = body.width.saturating_sub(MIN_EDITOR + 1); // + the divider column
    if body.width < MIN_LEFT + MIN_EDITOR + 1 {
        // Too narrow for the familiar shape: the editor takes everything.
        return Layout {
            tabs,
            status,
            left: Rect::new(body.x, body.y, 0, body.height),
            git: Rect::new(body.x, body.y, 0, 0),
            editor: body,
            left_divider_x: body.x,
            git_divider_y: body.y,
        };
    }
    let left_w = left_width.clamp(MIN_LEFT, room);
    let left = Rect::new(body.x, body.y, left_w, body.height);
    let editor = Rect::new(
        body.x + left_w + 1,
        body.y,
        body.width - left_w - 1,
        body.height,
    );
    let git_h = git_height.min(body.height.saturating_sub(1));
    let git = Rect::new(left.x, left.y + left.height - git_h, left.width, git_h);
    Layout {
        tabs,
        status,
        left,
        git,
        editor,
        left_divider_x: left.x + left.width,
        git_divider_y: git.y,
    }
}

/// Which divider a drag is moving.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Drag {
    Left,
    Git,
}

/// The page's commit box: one line, active on demand, cleared on commit.
#[derive(Default)]
struct CommitBox {
    text: String,
    active: bool,
}

/// Which side takes keys.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Focus {
    /// The editor area (default).
    Editor,
    /// The left column's file tree.
    Left,
    /// The left column's git pane.
    Git,
}

/// The IDE page.
pub struct IdePage {
    tabs: Vec<TabEntry>,
    active: Option<usize>,
    left_width: u16,
    git_height: u16,
    drag: Option<Drag>,
    /// The left column's top pane — the file tree by default; replaceable so
    /// the app can mount a search view later and so tests can drive it.
    left: Box<dyn Panel>,
    /// The left column's lower pane - git status by default.
    git: Box<dyn Panel>,
    /// The history view, created on first switch (`Ctrl+H`).
    git_log: Option<Box<dyn Panel>>,
    /// Whether the history view is showing instead of changes.
    show_log: bool,
    focus: Focus,
    /// The last load failure, drawn in the status line.
    message: Option<String>,
    /// The repository the git pane shows; the commit box's target.
    repo: Option<PathBuf>,
    /// The commit message box drawn at the bottom of the git pane.
    commit: CommitBox,
}

impl IdePage {
    /// A page with the default geometry and no file open.
    pub fn new() -> Self {
        Self {
            tabs: Vec::new(),
            active: None,
            left_width: DEFAULT_LEFT,
            git_height: DEFAULT_GIT,
            drag: None,
            left: Box::new(termide_panel_file_manager::FileManager::new()),
            git: Box::new(GitStatusPanel::new(&[
                std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
            ])),
            git_log: None,
            show_log: false,
            focus: Focus::Editor,
            message: None,
            repo: std::env::current_dir().ok(),
            commit: CommitBox::default(),
        }
    }

    /// Replace the left-top pane (the app may mount a search view here; the
    /// tests mount a scripted one).
    pub fn set_left(&mut self, panel: Box<dyn Panel>) {
        self.left = panel;
    }

    /// Replace the git pane (the app points it at the open file's repository).
    pub fn set_git(&mut self, panel: Box<dyn Panel>) {
        self.git = panel;
    }

    /// Swap the lower-left pane between changes and history.
    pub fn toggle_git_view(&mut self) -> bool {
        if !self.show_log {
            if self.git_log.is_none() {
                let paths = self.repo.clone().unwrap_or_else(|| PathBuf::from("."));
                self.git_log = Some(Box::new(GitLogPanel::new(&[paths])));
            }
            self.show_log = true;
        } else {
            self.show_log = false;
        }
        true
    }

    /// The lower-left pane currently showing.
    fn git_view(&mut self) -> &mut dyn Panel {
        if self.show_log {
            if let Some(log) = self.git_log.as_mut() {
                return log.as_mut();
            }
        }
        self.git.as_mut()
    }

    /// Point the commit box at `repo`.
    pub fn set_repo(&mut self, repo: PathBuf) {
        self.repo = Some(repo);
    }

    /// The repository the commit box targets.
    pub fn repo(&self) -> Option<&PathBuf> {
        self.repo.as_ref()
    }

    /// Open (or focus) `path` as a tab.
    pub fn open(&mut self, path: PathBuf) {
        if let Some(index) = self.tabs.iter().position(|entry| entry.tab.path == path) {
            self.active = Some(index);
            return;
        }
        self.tabs.push(TabEntry {
            tab: Tab::from_path(path),
            editor: None,
        });
        self.active = Some(self.tabs.len() - 1);
    }

    /// The tab strip's titles, in order (the renderer and the tests both read
    /// this rather than duplicating the `title ×` rule).
    pub fn titles(&self) -> Vec<String> {
        self.tabs
            .iter()
            .map(|entry| {
                let tab = &entry.tab;
                if tab.dirty {
                    format!("{} *", tab.title)
                } else {
                    tab.title.clone()
                }
            })
            .collect()
    }

    /// Close the active tab; the neighbour to the left becomes active.
    pub fn close_active(&mut self) -> bool {
        let Some(index) = self.active else {
            return false;
        };
        self.tabs.remove(index);
        self.active = if self.tabs.is_empty() {
            None
        } else {
            Some(index.min(self.tabs.len() - 1))
        };
        true
    }

    /// Move the active tab by `step` (wrapping).
    pub fn cycle(&mut self, step: isize) {
        let count = self.tabs.len();
        if count == 0 {
            return;
        }
        let current = self.active.unwrap_or(0) as isize;
        let next = (current + step).rem_euclid(count as isize) as usize;
        self.active = Some(next);
    }

    /// Whether the active tab's editor is mounted (loaded on demand).
    pub fn active_editor_loaded(&self) -> bool {
        self.active
            .is_some_and(|index| self.tabs[index].editor.is_some())
    }

    /// Load the active tab's editor on first activation. A file that fails to
    /// open leaves the tab visible with the reason in the status line, which is
    /// better than silently showing an empty buffer.
    fn ensure_editor(&mut self) {
        let Some(index) = self.active else {
            return;
        };
        let mut failure = None;
        {
            let entry = &mut self.tabs[index];
            if entry.editor.is_none() && entry.tab.path.is_file() {
                match Editor::open_file_with_config(entry.tab.path.clone(), EditorConfig::default())
                {
                    Ok(editor) => entry.editor = Some(editor),
                    Err(error) => failure = Some(format!("无法打开 {}: {error}", entry.tab.title)),
                }
            }
        }
        if failure.is_some() {
            self.message = failure;
        }
    }

    /// The page owns the "a file was chosen" contract: sub-panels emit
    /// [`PanelEvent::OpenFile`] and the page opens a tab for it; every other
    /// event passes through to the app.
    fn absorb(&mut self, events: Vec<PanelEvent>) -> Vec<PanelEvent> {
        let mut rest = Vec::with_capacity(events.len());
        for event in events {
            match event {
                PanelEvent::OpenFile(path) => self.open(path),
                other => rest.push(other),
            }
        }
        rest
    }

    /// The x range of tab `index` in the tab strip.
    fn tab_span(&self, index: usize) -> (u16, u16) {
        let mut x = 0;
        for (position, title) in self.titles().iter().enumerate() {
            let width = title.chars().count() as u16 + 3; // " title ×"
            if position == index {
                return (x, x + width);
            }
            x += width;
        }
        (x, x)
    }

    /// Which tab a click at `column` inside the tab strip selects.
    fn tab_at(&self, column: u16) -> Option<usize> {
        (0..self.tabs.len()).find(|&index| {
            let (start, end) = self.tab_span(index);
            column >= start && column < end
        })
    }

    fn active_editor_mut(&mut self) -> Option<&mut Editor> {
        self.active
            .and_then(|index| self.tabs.get_mut(index))?
            .editor
            .as_mut()
    }
}

impl Default for IdePage {
    fn default() -> Self {
        Self::new()
    }
}

impl Panel for IdePage {
    fn name(&self) -> &'static str {
        "ide"
    }

    fn title(&self) -> String {
        "IDE".to_owned()
    }

    fn prepare_render(&mut self, theme: &Theme, config: &Arc<Config>) {
        self.left.prepare_render(theme, config);
        self.git.prepare_render(theme, config);
        if let Some(log) = self.git_log.as_mut() {
            log.prepare_render(theme, config);
        }
        for entry in &mut self.tabs {
            if let Some(editor) = entry.editor.as_mut() {
                editor.prepare_render(theme, config);
            }
        }
    }

    fn render(&mut self, area: Rect, buf: &mut Buffer, ctx: &RenderContext) {
        self.ensure_editor();
        buf.set_style(area, Style::default().bg(ctx.theme.bg).fg(ctx.theme.fg));
        let layout = layout(area, self.left_width, self.git_height);

        // The left column's tree, above the git divider.
        if layout.left.width > 0 {
            let tree = layout.tree();
            if tree.height > 0 {
                self.left.render(tree, buf, ctx);
            }
        }

        // The git pane, below its divider; its last row is the commit box.
        if layout.git.height > 0 {
            let box_rows = u16::from(layout.git.height >= 2);
            let pane = Rect::new(
                layout.git.x,
                layout.git.y,
                layout.git.width,
                layout.git.height - box_rows,
            );
            if pane.height > 0 {
                self.git_view().render(pane, buf, ctx);
            }
            if box_rows == 1 && !self.show_log {
                let row = layout.git.y + layout.git.height - 1;
                let text = if self.commit.active {
                    format!("Commit: {}", self.commit.text)
                } else {
                    "Commit: (Ctrl+Enter to write a message)".to_owned()
                };
                let ink = if self.commit.active {
                    ctx.theme.selection_fg
                } else {
                    ctx.theme.fg
                };
                buf.set_stringn(
                    layout.git.x,
                    row,
                    &text,
                    layout.git.width as usize,
                    Style::default().fg(ink),
                );
            }
        }

        // The active tab's editor, or the empty-page hint.
        let mut editor_drawn = false;
        if let Some(index) = self.active {
            if let Some(editor) = self.tabs[index].editor.as_mut() {
                editor.render(layout.editor, buf, ctx);
                editor_drawn = true;
            }
        }
        if self.tabs.is_empty() && !editor_drawn {
            let hint = "Ctrl+P 打开文件";
            let x = layout.editor.x
                + layout
                    .editor
                    .width
                    .saturating_sub(hint.chars().count() as u16)
                    / 2;
            let y = layout.editor.y + layout.editor.height / 2;
            if layout.editor.width as usize >= hint.chars().count() {
                buf.set_stringn(
                    x,
                    y,
                    hint,
                    hint.chars().count(),
                    Style::default().fg(Color::DarkGray),
                );
            }
        }

        // Tab strip: titles, the active one emphasised.
        let mut x = layout.tabs.x;
        for (index, title) in self.titles().iter().enumerate() {
            let text = format!(" {title} ×");
            let active = self.active == Some(index);
            let style = if active {
                Style::default()
                    .bg(ctx.theme.selection_bg)
                    .fg(ctx.theme.selection_fg)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().bg(ctx.theme.bg).fg(ctx.theme.fg)
            };
            buf.set_stringn(
                x,
                layout.tabs.y,
                &text,
                layout
                    .tabs
                    .width
                    .saturating_sub(x.saturating_sub(layout.tabs.x)) as usize,
                style,
            );
            x += text.chars().count() as u16;
        }

        // The two dividers.
        if layout.left.width > 0 && layout.editor.height > 0 {
            for row in layout.editor.y..layout.editor.y + layout.editor.height {
                buf.set_stringn(
                    layout.left_divider_x,
                    row,
                    "│",
                    1,
                    Style::default().fg(ctx.theme.fg),
                );
            }
            for column in layout.left.x..layout.left.x + layout.left.width {
                buf.set_stringn(
                    column,
                    layout.git_divider_y,
                    "─",
                    1,
                    Style::default().fg(ctx.theme.fg),
                );
            }
        }

        // Status line: the load failure takes the row when there is one.
        let status = match self.message.as_deref() {
            Some(message) => format!(" {message}"),
            None => {
                let segments = self.status_segments();
                let joined = segments
                    .iter()
                    .map(|segment| segment.text.as_str())
                    .collect::<Vec<_>>()
                    .join("   ");
                format!(" {joined}")
            }
        };
        buf.set_stringn(
            layout.status.x,
            layout.status.y,
            &status,
            layout.status.width as usize,
            Style::default().bg(ctx.theme.bg).fg(ctx.theme.fg),
        );
    }

    fn handle_key(&mut self, chord: KeyChord) -> Vec<PanelEvent> {
        let code = chord.raw.code;
        if self.commit.active {
            match (code, chord.raw.modifiers.contains(KeyModifiers::CONTROL)) {
                (KeyCode::Esc, _) => {
                    self.commit.active = false;
                    self.commit.text.clear();
                    return vec![PanelEvent::NeedsRedraw];
                }
                (KeyCode::Enter, false) => {
                    let message = self.commit.text.trim().to_owned();
                    self.commit.active = false;
                    self.commit.text.clear();
                    if message.is_empty() {
                        return vec![PanelEvent::NeedsRedraw];
                    }
                    return match self.repo.clone() {
                        Some(repo) => vec![
                            PanelEvent::NeedsRedraw,
                            PanelEvent::GitCommit {
                                repo_path: repo,
                                message,
                            },
                        ],
                        None => vec![PanelEvent::NeedsRedraw],
                    };
                }
                (KeyCode::Backspace, _) => {
                    self.commit.text.pop();
                    return vec![PanelEvent::NeedsRedraw];
                }
                (KeyCode::Char(c), false) => {
                    self.commit.text.push(c);
                    return vec![PanelEvent::NeedsRedraw];
                }
                _ => return Vec::new(),
            }
        }
        let ctrl = chord.raw.modifiers.contains(KeyModifiers::CONTROL);
        let shift = chord.raw.modifiers.contains(KeyModifiers::SHIFT);
        match (code, ctrl) {
            (KeyCode::Char('w'), true) if self.close_active() => vec![PanelEvent::NeedsRedraw],
            (KeyCode::Tab, true) => {
                self.cycle(if shift { -1 } else { 1 });
                vec![PanelEvent::NeedsRedraw]
            }
            _ if self.focus == Focus::Left => {
                let events = self.left.handle_key(chord);
                self.absorb(events)
            }
            (KeyCode::Char('h'), true) => {
                self.toggle_git_view();
                vec![PanelEvent::NeedsRedraw]
            }
            (KeyCode::Enter, true) if self.focus == Focus::Git => {
                self.commit.active = true;
                vec![PanelEvent::NeedsRedraw]
            }
            _ if self.focus == Focus::Git => {
                let events = self.git_view().handle_key(chord);
                self.absorb(events)
            }
            _ => {
                self.ensure_editor();
                let events = match self.active_editor_mut() {
                    Some(editor) => editor.handle_key(chord),
                    None => Vec::new(),
                };
                self.absorb(events)
            }
        }
    }

    fn status_segments(&self) -> Vec<StatusSegment> {
        // The editor owns the real numbers (Ln/Col, indentation, encoding, EOL);
        // the page only supplies the empty-page placeholder.
        if let Some(index) = self.active {
            if let Some(editor) = self.tabs[index].editor.as_ref() {
                let segments = editor.status_segments();
                if !segments.is_empty() {
                    return segments;
                }
            }
        }
        vec![StatusSegment {
            text: "Ln 1, Col 1".to_owned(),
            kind: SegmentKind::Label,
            action: None,
        }]
    }

    fn tick(&mut self) -> Vec<PanelEvent> {
        let mut events = self.left.tick();
        events.extend(self.git.tick());
        if let Some(log) = self.git_log.as_mut() {
            events.extend(log.tick());
        }
        for entry in &mut self.tabs {
            if let Some(editor) = entry.editor.as_mut() {
                events.extend(editor.tick());
            }
        }
        self.absorb(events)
    }

    fn handle_mouse(&mut self, event: MouseEvent, panel_area: Rect) -> Vec<PanelEvent> {
        let layout = layout(panel_area, self.left_width, self.git_height);
        let column = event.column;
        let row = event.row;
        match event.kind {
            MouseEventKind::Down(_) => {
                let tree = layout.tree();
                if layout.left.width > 0 && tree.contains((column, row).into()) {
                    self.focus = Focus::Left;
                    let events = self.left.handle_mouse(event, tree);
                    return self.absorb(events);
                }
                if layout.git.height >= 2 && row == layout.git.y + layout.git.height - 1 {
                    self.focus = Focus::Git;
                    self.commit.active = true;
                    return vec![PanelEvent::NeedsRedraw];
                }
                if layout.git.height > 0 && layout.git.contains((column, row).into()) {
                    self.focus = Focus::Git;
                    let events = self.git_view().handle_mouse(event, layout.git);
                    return self.absorb(events);
                }
                if layout.editor.contains((column, row).into()) {
                    self.focus = Focus::Editor;
                    self.ensure_editor();
                    if let Some(editor) = self.active_editor_mut() {
                        let events = editor.handle_mouse(event, layout.editor);
                        return self.absorb(events);
                    }
                }
                if row == layout.tabs.y && column < layout.tabs.x + layout.tabs.width {
                    if let Some(index) = self.tab_at(column.saturating_sub(layout.tabs.x)) {
                        self.active = Some(index);
                        return vec![PanelEvent::NeedsRedraw];
                    }
                }
                if layout.left.width > 0 && column == layout.left_divider_x {
                    self.drag = Some(Drag::Left);
                } else if layout.left.width > 0
                    && row == layout.git_divider_y
                    && column < layout.left.x + layout.left.width
                {
                    self.drag = Some(Drag::Git);
                }
            }
            MouseEventKind::Drag(_) => match self.drag {
                Some(Drag::Left) => {
                    self.left_width = column.saturating_sub(layout.left.x).max(MIN_LEFT);
                    return vec![PanelEvent::NeedsRedraw];
                }
                Some(Drag::Git) => {
                    let bottom = layout.left.y + layout.left.height;
                    let height = bottom
                        .saturating_sub(row)
                        .min(layout.left.height.saturating_sub(1));
                    self.git_height = height;
                    return vec![PanelEvent::NeedsRedraw];
                }
                None => {}
            },
            MouseEventKind::Up(_) => self.drag = None,
            _ => {}
        }
        Vec::new()
    }

    fn handle_scroll(&mut self, delta: i32, panel_area: Rect) -> Vec<PanelEvent> {
        let layout = layout(panel_area, self.left_width, self.git_height);
        if self.focus == Focus::Left {
            let events = self.left.handle_scroll(delta, layout.tree());
            return self.absorb(events);
        }
        if self.focus == Focus::Git {
            let events = self.git_view().handle_scroll(delta, layout.git);
            return self.absorb(events);
        }
        let events = match self.active_editor_mut() {
            Some(editor) => editor.handle_scroll(delta, layout.editor),
            None => Vec::new(),
        };
        self.absorb(events)
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

    const AREA: Rect = Rect {
        x: 0,
        y: 0,
        width: 100,
        height: 30,
    };

    #[test]
    fn the_familiar_shape_is_fixed_except_two_dividers() {
        let layout = layout(AREA, 30, 9);
        assert_eq!(layout.tabs.height, TAB_HEIGHT);
        assert_eq!(layout.status.y, AREA.y + AREA.height - 1);
        assert_eq!(layout.left.width + 1 + layout.editor.width, AREA.width);
        assert_eq!(layout.left_divider_x, 30);
        assert_eq!(layout.git.height, 9, "the git pane keeps its height");
        assert_eq!(layout.git.y, layout.left.y + layout.left.height - 9);
        assert_eq!(
            layout.editor.height, layout.left.height,
            "the editor spans the body"
        );
        assert_eq!(
            layout.tree().height,
            layout.left.height - 9,
            "the tree ends at the git divider"
        );
    }

    #[test]
    fn a_narrow_area_collapses_the_left_column_instead_of_squeezing_it() {
        let narrow = Rect {
            x: 0,
            y: 0,
            width: MIN_LEFT + MIN_EDITOR,
            height: 12,
        };
        let layout = layout(narrow, DEFAULT_LEFT, DEFAULT_GIT);
        assert_eq!(layout.left.width, 0);
        assert_eq!(layout.editor.width, narrow.width);
    }

    #[test]
    fn the_left_width_is_clamped_so_the_editor_keeps_its_floor() {
        let layout = layout(AREA, 200, 9);
        assert!(layout.editor.width >= MIN_EDITOR);
        assert_eq!(layout.left.width + 1 + layout.editor.width, AREA.width);
    }

    #[test]
    fn opening_the_same_file_twice_focuses_its_tab() {
        let mut page = IdePage::new();
        page.open(PathBuf::from("a.rs"));
        page.open(PathBuf::from("b.rs"));
        page.open(PathBuf::from("a.rs"));
        assert_eq!(page.titles(), vec!["a.rs".to_owned(), "b.rs".to_owned()]);
        assert_eq!(page.active, Some(0));
    }

    #[test]
    fn closing_and_cycling_keep_the_active_tab_inside_the_strip() {
        let mut page = IdePage::new();
        for name in ["a.rs", "b.rs", "c.rs"] {
            page.open(PathBuf::from(name));
        }
        page.cycle(1);
        assert_eq!(page.active, Some(0), "c wraps to a");
        page.cycle(-1);
        assert_eq!(page.active, Some(2), "a wraps back to c");
        assert!(page.close_active());
        assert_eq!(page.titles(), vec!["a.rs".to_owned(), "b.rs".to_owned()]);
        assert_eq!(page.active, Some(1), "the left neighbour takes over");
    }

    /// A left pane that answers every interaction with `OpenFile`, standing in
    /// for the file tree (whose real events are exercised in its own suite).
    struct Scripted;

    impl Panel for Scripted {
        fn name(&self) -> &'static str {
            "scripted"
        }
        fn title(&self) -> String {
            "scripted".to_owned()
        }
        fn render(&mut self, _area: Rect, _buf: &mut Buffer, _ctx: &RenderContext) {}
        fn handle_key(&mut self, _chord: KeyChord) -> Vec<PanelEvent> {
            vec![PanelEvent::OpenFile(PathBuf::from("picked.rs"))]
        }
        fn as_any(&self) -> &dyn Any {
            self
        }
        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }
    }

    fn key(code: KeyCode) -> KeyChord {
        let raw = crossterm::event::KeyEvent::new(code, KeyModifiers::NONE);
        KeyChord {
            raw,
            canonical: raw,
        }
    }

    #[test]
    fn the_page_owns_the_open_file_contract() {
        let mut page = IdePage::new();
        page.absorb(vec![PanelEvent::OpenFile(PathBuf::from("a.rs"))]);
        page.absorb(vec![
            PanelEvent::NeedsRedraw,
            PanelEvent::OpenFile(PathBuf::from("b.rs")),
        ]);
        assert_eq!(page.titles(), vec!["a.rs".to_owned(), "b.rs".to_owned()]);
        // Non-open events pass through to the app.
        assert_eq!(page.absorb(vec![PanelEvent::NeedsRedraw]).len(), 1);
    }

    #[test]
    fn clicking_the_left_column_focuses_it_and_keys_go_there() {
        let mut page = IdePage::new();
        page.set_left(Box::new(Scripted));
        let down = MouseEvent {
            kind: MouseEventKind::Down(crossterm::event::MouseButton::Left),
            column: 2,
            row: 2,
            modifiers: KeyModifiers::NONE,
        };
        page.handle_mouse(down, AREA);
        assert_eq!(page.focus, Focus::Left);
        // A plain key is forwarded to the left pane, which answers with OpenFile.
        page.handle_key(key(KeyCode::Enter));
        assert_eq!(page.titles(), vec!["picked.rs".to_owned()]);
    }

    #[test]
    fn opening_a_real_file_mounts_its_editor_on_first_use() {
        let dir = std::env::temp_dir().join("panel-ide-tests");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("hello.rs");
        std::fs::write(&path, "fn main() {}\n").expect("write the fixture");
        let mut page = IdePage::new();
        page.open(path);
        assert!(
            !page.active_editor_loaded(),
            "lazy until the editor is needed"
        );
        let _ = page.handle_key(key(KeyCode::Char('a')));
        assert!(
            page.active_editor_loaded(),
            "the first key press mounts the editor"
        );
        assert!(
            page.message.is_none(),
            "loading a real file reports no failure"
        );
    }

    #[test]
    fn the_page_draws_its_chrome_into_a_buffer() {
        use termide_core::panel::{PanelConfig, ThemeColors};

        let mut page = IdePage::new();
        page.open(PathBuf::from("a.rs"));
        let area = Rect::new(0, 0, 80, 24);
        let mut buf = Buffer::empty(area);
        let theme = ThemeColors::default();
        let config = PanelConfig::default();
        let ctx = RenderContext {
            theme: &theme,
            config: &config,
            is_focused: true,
            panel_index: 0,
            terminal_width: area.width,
            terminal_height: area.height,
            border_right_x: None,
            border_bottom_y: None,
        };
        page.render(area, &mut buf, &ctx);

        let tabs: String = (0..20).map(|x| buf[(x, 0)].symbol().to_string()).collect();
        assert!(
            tabs.contains("a.rs"),
            "the tab strip names the open file: {tabs:?}"
        );
        let divider: String = (1..10).map(|y| buf[(30, y)].symbol().to_string()).collect();
        assert!(
            divider.contains("\u{2502}"),
            "the left divider is drawn: {divider:?}"
        );
        let status: String = (0..24).map(|x| buf[(x, 23)].symbol().to_string()).collect();
        assert!(status.contains("Ln"), "the status row is drawn: {status:?}");
    }

    #[test]
    fn the_commit_box_emits_the_typed_message() {
        let mut page = IdePage::new();
        page.set_repo(PathBuf::from("/tmp/repo"));
        let layout = layout(AREA, DEFAULT_LEFT, DEFAULT_GIT);
        let down = MouseEvent {
            kind: MouseEventKind::Down(crossterm::event::MouseButton::Left),
            column: layout.git.x + 1,
            row: layout.git.y + 1,
            modifiers: KeyModifiers::NONE,
        };
        page.handle_mouse(down, AREA);
        let ctrl_enter = KeyChord {
            raw: crossterm::event::KeyEvent::new(KeyCode::Enter, KeyModifiers::CONTROL),
            canonical: crossterm::event::KeyEvent::new(KeyCode::Enter, KeyModifiers::CONTROL),
        };
        page.handle_key(ctrl_enter);
        for c in "fix: the thing".chars() {
            page.handle_key(key(KeyCode::Char(c)));
        }
        let events = page.handle_key(key(KeyCode::Enter));
        assert!(
            events.iter().any(|e| matches!(e, PanelEvent::GitCommit { message, .. } if message == "fix: the thing")),
            "the box hands the message to the app: {events:?}"
        );
        assert!(!page.commit.active, "the box closes after the commit");
    }

    #[test]
    fn ctrl_h_swaps_the_lower_pane_between_changes_and_history() {
        let mut page = IdePage::new();
        assert!(!page.show_log, "changes is the default view");
        page.toggle_git_view();
        assert!(page.show_log, "history takes the lower pane");
        assert!(
            page.git_log.is_some(),
            "the history panel is created lazily"
        );
        page.toggle_git_view();
        assert!(!page.show_log, "the second toggle goes back to changes");
    }

    #[test]
    fn escape_cancels_the_commit_box_without_emitting() {
        let mut page = IdePage::new();
        page.set_repo(PathBuf::from("/tmp/repo"));
        page.focus = Focus::Git;
        let ctrl_enter = KeyChord {
            raw: crossterm::event::KeyEvent::new(KeyCode::Enter, KeyModifiers::CONTROL),
            canonical: crossterm::event::KeyEvent::new(KeyCode::Enter, KeyModifiers::CONTROL),
        };
        page.handle_key(ctrl_enter);
        page.handle_key(key(KeyCode::Char('x')));
        let events = page.handle_key(key(KeyCode::Esc));
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, PanelEvent::GitCommit { .. })),
            "escape emits nothing"
        );
        assert!(page.commit.text.is_empty(), "escape clears the draft");
    }

    #[test]
    fn clicking_the_git_pane_focuses_it() {
        let mut page = IdePage::new();
        let layout = layout(AREA, DEFAULT_LEFT, DEFAULT_GIT);
        let down = MouseEvent {
            kind: MouseEventKind::Down(crossterm::event::MouseButton::Left),
            column: layout.git.x + 1,
            row: layout.git.y + 1,
            modifiers: KeyModifiers::NONE,
        };
        page.handle_mouse(down, AREA);
        assert_eq!(
            page.focus,
            Focus::Git,
            "the git pane takes focus above the tree"
        );
    }

    #[test]
    fn the_status_line_reports_the_editors_own_segments() {
        let dir = std::env::temp_dir().join("panel-ide-tests");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("status.rs");
        std::fs::write(
            &path,
            "let answer = 42;
",
        )
        .expect("write the fixture");
        let mut page = IdePage::new();
        page.open(path);
        let _ = page.handle_key(key(KeyCode::Char('b')));
        let segments = page.status_segments();
        let joined = segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            joined.contains("Pos:") && joined.contains("UTF-8"),
            "the mounted editor contributes its fields: {joined:?}"
        );
    }

    #[test]
    fn a_click_selects_the_tab_under_the_pointer() {
        let mut page = IdePage::new();
        page.open(PathBuf::from("a.rs"));
        page.open(PathBuf::from("b.rs"));
        let (start, end) = page.tab_span(1);
        assert_eq!(page.tab_at(start + 1), Some(1));
        assert_eq!(page.tab_at(end + 1), None);
    }
}
