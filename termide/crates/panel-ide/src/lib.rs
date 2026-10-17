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
//! tab, so the host app never has to know how the page is composed.
//!
//! Rendering is a `ratatui::Buffer`, so the desktop shell hosts the *same* page
//! through `Panel::render` → blit — the terminal panel already proves that road.

use std::any::Any;
use std::path::PathBuf;

use crossterm::event::{KeyCode, KeyModifiers, MouseEvent, MouseEventKind};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use termide_core::event::PanelEvent;
use termide_core::key_chord::KeyChord;
use termide_core::panel::{Panel, RenderContext};

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

/// Which side takes keys.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Focus {
    /// The editor area (default).
    Editor,
    /// The left column (file tree).
    Left,
}

/// The IDE page.
pub struct IdePage {
    tabs: Vec<Tab>,
    active: Option<usize>,
    left_width: u16,
    git_height: u16,
    drag: Option<Drag>,
    /// The left column's top pane — the file tree by default; replaceable so
    /// the app can mount a search view later and so tests can drive it.
    left: Box<dyn Panel>,
    focus: Focus,
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
            focus: Focus::Editor,
        }
    }

    /// Replace the left-top pane (the app may mount a search view here; the
    /// tests mount a scripted one).
    pub fn set_left(&mut self, panel: Box<dyn Panel>) {
        self.left = panel;
    }

    /// Open (or focus) `path` as a tab.
    pub fn open(&mut self, path: PathBuf) {
        if let Some(index) = self.tabs.iter().position(|tab| tab.path == path) {
            self.active = Some(index);
            return;
        }
        self.tabs.push(Tab::from_path(path));
        self.active = Some(self.tabs.len() - 1);
    }

    /// The tab strip's titles, in order (the renderer and the tests both read
    /// this rather than duplicating the `title ×` rule).
    pub fn titles(&self) -> Vec<String> {
        self.tabs
            .iter()
            .map(|tab| {
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

    fn render(&mut self, area: Rect, buf: &mut Buffer, ctx: &RenderContext) {
        buf.set_style(area, Style::default().bg(ctx.theme.bg).fg(ctx.theme.fg));
        let layout = layout(area, self.left_width, self.git_height);

        // The left column's tree, above the git divider.
        if layout.left.width > 0 {
            let tree = layout.tree();
            if tree.height > 0 {
                self.left.render(tree, buf, ctx);
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

        // Status line: the fixed set of fields, always in the same slots.
        let status = " Ln 1, Col 1   Spaces: 4   UTF-8   LF";
        buf.set_stringn(
            layout.status.x,
            layout.status.y,
            status,
            layout.status.width as usize,
            Style::default().bg(ctx.theme.bg).fg(ctx.theme.fg),
        );
        // The page's own hint so an empty page reads as "no file", not broken.
        if self.tabs.is_empty() {
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
    }

    fn handle_key(&mut self, chord: KeyChord) -> Vec<PanelEvent> {
        let code = chord.raw.code;
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
            _ => Vec::new(),
        }
    }

    fn tick(&mut self) -> Vec<PanelEvent> {
        let events = self.left.tick();
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
                if layout.editor.contains((column, row).into()) {
                    self.focus = Focus::Editor;
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
    fn a_click_selects_the_tab_under_the_pointer() {
        let mut page = IdePage::new();
        page.open(PathBuf::from("a.rs"));
        page.open(PathBuf::from("b.rs"));
        let (start, end) = page.tab_span(1);
        assert_eq!(page.tab_at(start + 1), Some(1));
        assert_eq!(page.tab_at(end + 1), None);
    }
}
