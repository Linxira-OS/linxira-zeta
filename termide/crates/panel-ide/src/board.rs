//! The user board: markdown cards under `<project>/.zeta/board/`.
//!
//! One file per card, front-ruled by a small key/value block:
//!
//! ```text
//! ---
//! title: Fix the parser
//! column: doing
//! tags: [rust, parser]
//! assignee: agent
//! due: 2026-11-01
//! ---
//!
//! The brief an agent gets from `handoff`.
//! ```
//!
//! The file on disk is the only truth: this module is the one parser and the
//! one writer, so the IDE page, the GUI's 看板 page and the TUI's board page
//! cannot drift apart. Edits made in a text editor are picked up by the next
//! [`load`]; edits made in a panel go through [`create_card`], [`save_card`],
//! [`move_card`] and [`delete_card`], which rewrite the same file in the
//! canonical form above.
//!
//! This file began as the workspace TODO-marker scanner; the roadmap's ruling
//! is that the board is that panel's upgrade, not a second parser. Marker
//! scanning is gone, the directory walk and the panel shape remain.

use std::any::Any;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use crossterm::event::{KeyCode, MouseEvent, MouseEventKind};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use termide_core::event::PanelEvent;
use termide_core::key_chord::KeyChord;
use termide_core::panel::{Panel, RenderContext};

/// The directory a project's cards live in, relative to the project root.
pub const BOARD_DIR: &str = ".zeta/board";
/// Card files larger than this are not read (a hand-pasted log is not a card).
const MAX_FILE: u64 = 512 * 1024;

/// A board column. The order is the board's left-to-right order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Column {
    Todo,
    Doing,
    Done,
}

impl Column {
    /// Every column, left to right.
    pub const ALL: [Self; 3] = [Self::Todo, Self::Doing, Self::Done];

    /// The front-matter value.
    pub fn key(self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::Doing => "doing",
            Self::Done => "done",
        }
    }

    /// The heading a panel draws.
    pub fn label(self) -> &'static str {
        match self {
            Self::Todo => "Todo",
            Self::Doing => "Doing",
            Self::Done => "Done",
        }
    }

    /// Parse a front-matter value, case-insensitively.
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "todo" => Some(Self::Todo),
            "doing" => Some(Self::Doing),
            "done" => Some(Self::Done),
            _ => None,
        }
    }

    /// The next column to the right, or `None` at the last one.
    pub fn next(self) -> Option<Self> {
        match self {
            Self::Todo => Some(Self::Doing),
            Self::Doing => Some(Self::Done),
            Self::Done => None,
        }
    }

    /// The previous column to the left, or `None` at the first one.
    pub fn previous(self) -> Option<Self> {
        match self {
            Self::Todo => None,
            Self::Doing => Some(Self::Todo),
            Self::Done => Some(Self::Doing),
        }
    }

    /// The index in [`Self::ALL`].
    pub fn index(self) -> usize {
        match self {
            Self::Todo => 0,
            Self::Doing => 1,
            Self::Done => 2,
        }
    }
}

/// Who owns the card. `Agent` marks a card the user has handed to an agent;
/// the board itself never starts a session.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Assignee {
    User,
    Agent,
}

impl Assignee {
    /// The front-matter value.
    pub fn key(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Agent => "agent",
        }
    }

    /// The short form a card row draws.
    pub fn label(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Agent => "agent",
        }
    }

    /// Parse a front-matter value, case-insensitively.
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "user" => Some(Self::User),
            "agent" => Some(Self::Agent),
            _ => None,
        }
    }
}

/// One card, as read from its file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Card {
    /// The file stem; also the id every mutation takes.
    pub id: String,
    /// `<root>/.zeta/board/<id>.md`.
    pub path: PathBuf,
    pub title: String,
    pub column: Column,
    pub tags: Vec<String>,
    pub assignee: Assignee,
    pub due: Option<String>,
    /// Everything after the closing `---`, trimmed of surrounding blank lines.
    pub body: String,
    /// Front-matter keys this module does not own, kept in order so a
    /// hand-added field survives a panel edit.
    pub extra: Vec<(String, String)>,
}

/// A file under `.zeta/board/` that is not a card the panel can show.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Warning {
    pub file: String,
    pub reason: String,
}

/// The result of one directory read: usable cards plus the files skipped.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LoadedBoard {
    pub cards: Vec<Card>,
    pub warnings: Vec<Warning>,
}

/// A card to create; `id` is derived from the title.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewCard {
    pub title: String,
    pub column: Column,
    pub tags: Vec<String>,
    pub assignee: Assignee,
    pub due: Option<String>,
    pub body: String,
}

impl NewCard {
    /// A card in `Todo`, owned by the user, with nothing else set.
    pub fn titled(title: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            column: Column::Todo,
            tags: Vec::new(),
            assignee: Assignee::User,
            due: None,
            body: String::new(),
        }
    }
}

/// What went wrong while reading or writing one card.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CardError {
    /// The id is not a file stem this module will touch.
    InvalidId,
    /// No file at `<board>/<id>.md`.
    NotFound,
    /// The file is not a card (see `parse_card`).
    Malformed(String),
    /// The filesystem refused the read or the write.
    Io(String),
}

impl fmt::Display for CardError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidId => formatter.write_str("invalid card id"),
            Self::NotFound => formatter.write_str("card not found"),
            Self::Malformed(reason) => write!(formatter, "not a card: {reason}"),
            Self::Io(reason) => write!(formatter, "card file error: {reason}"),
        }
    }
}

impl std::error::Error for CardError {}

impl From<std::io::Error> for CardError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

/// `<root>/.zeta/board`.
pub fn board_dir(root: &Path) -> PathBuf {
    root.join(BOARD_DIR)
}

/// Whether `id` is a file stem this module accepts: ASCII letters, digits,
/// `.`, `_` and `-`, not hidden, and never a traversal.
pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('.')
        && id.len() <= 80
        && id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

/// Read every card under `root`'s board directory.
///
/// A missing directory is an empty board, not an error. Files that do not end
/// in `.md`, subdirectories and hidden files are ignored; `.md` files that do
/// not parse are reported in [`LoadedBoard::warnings`] and do not hide the
/// rest of the board.
pub fn load(root: &Path) -> LoadedBoard {
    let directory = board_dir(root);
    let Ok(entries) = fs::read_dir(&directory) else {
        return LoadedBoard::default();
    };
    let mut board = LoadedBoard::default();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let Some(stem) = name.strip_suffix(".md") else {
            continue;
        };
        if !is_valid_id(stem) {
            board.warnings.push(Warning {
                file: name.into_owned(),
                reason: "file name is not a card id".to_owned(),
            });
            continue;
        }
        if entry
            .metadata()
            .map(|meta| meta.len() > MAX_FILE)
            .unwrap_or(true)
        {
            board.warnings.push(Warning {
                file: name.into_owned(),
                reason: "file is too large to be a card".to_owned(),
            });
            continue;
        }
        match fs::read_to_string(&path) {
            Ok(text) => match parse_card(stem, path, &text) {
                Ok(card) => board.cards.push(card),
                Err(reason) => board.warnings.push(Warning {
                    file: name.into_owned(),
                    reason,
                }),
            },
            Err(error) => board.warnings.push(Warning {
                file: name.into_owned(),
                reason: error.to_string(),
            }),
        }
    }
    board.cards.sort_by(|left, right| left.id.cmp(&right.id));
    board
        .warnings
        .sort_by(|left, right| left.file.cmp(&right.file));
    board
}

/// Read one card by id.
pub fn read_card(root: &Path, id: &str) -> Result<Card, CardError> {
    if !is_valid_id(id) {
        return Err(CardError::InvalidId);
    }
    let path = board_dir(root).join(format!("{id}.md"));
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(CardError::NotFound)
        }
        Err(error) => return Err(CardError::Io(error.to_string())),
    };
    parse_card(id, path, &text).map_err(CardError::Malformed)
}

/// Parse a card file. The front matter must open and close with a `---` line
/// and must carry a non-empty `title`; `column` defaults to [`Column::Todo`]
/// and `assignee` to [`Assignee::User`], because a card written by hand with
/// only a title is still a card.
pub fn parse_card(id: &str, path: PathBuf, text: &str) -> Result<Card, String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let normalized;
    let text = if text.contains('\r') {
        normalized = text.replace("\r\n", "\n");
        normalized.as_str()
    } else {
        text
    };
    let mut lines = text.lines();
    let opening = lines.next().unwrap_or_default();
    if opening.trim() != "---" {
        return Err("missing front matter".to_owned());
    }

    let mut title: Option<String> = None;
    let mut column = Column::Todo;
    let mut tags = Vec::new();
    let mut assignee = Assignee::User;
    let mut due = None;
    let mut extra = Vec::new();
    let mut closed = false;
    for line in lines.by_ref() {
        if line.trim() == "---" {
            closed = true;
            break;
        }
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            return Err(format!("front matter line is not `key: value`: {line}"));
        };
        let key = key.trim().to_ascii_lowercase();
        let value = unquote(value.trim());
        match key.as_str() {
            "title" => title = Some(value),
            "column" => {
                column = Column::parse(&value)
                    .ok_or_else(|| format!("unknown column `{value}` (todo, doing or done)"))?
            }
            "tags" => tags = parse_tags(&value),
            "assignee" => {
                assignee = Assignee::parse(&value)
                    .ok_or_else(|| format!("unknown assignee `{value}` (user or agent)"))?
            }
            "due" => {
                if !value.is_empty() {
                    due = Some(value);
                }
            }
            _ => extra.push((key, value)),
        }
    }
    if !closed {
        return Err("front matter is not closed with ---".to_owned());
    }

    let title = title
        .map(|title| title.trim().to_owned())
        .unwrap_or_default();
    if title.is_empty() {
        return Err("front matter has no title".to_owned());
    }
    let body = lines.collect::<Vec<_>>().join("\n");
    let body = body.trim_start_matches('\n').trim_end().to_owned();

    Ok(Card {
        id: id.to_owned(),
        path,
        title,
        column,
        tags,
        assignee,
        due,
        body,
        extra,
    })
}

/// Render a card in the canonical file form (what [`save_card`] writes).
pub fn render_card(card: &Card) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("title: {}\n", one_line(&card.title)));
    out.push_str(&format!("column: {}\n", card.column.key()));
    if !card.tags.is_empty() {
        out.push_str(&format!("tags: [{}]\n", card.tags.join(", ")));
    }
    out.push_str(&format!("assignee: {}\n", card.assignee.key()));
    if let Some(due) = card.due.as_deref().filter(|due| !due.trim().is_empty()) {
        out.push_str(&format!("due: {}\n", one_line(due)));
    }
    for (key, value) in &card.extra {
        out.push_str(&format!("{key}: {value}\n"));
    }
    out.push_str("---\n");
    let body = card.body.trim_matches('\n').trim_end();
    if !body.is_empty() {
        out.push('\n');
        out.push_str(body);
        out.push('\n');
    }
    out
}

/// Write a loaded card back to its own file.
pub fn save_card(root: &Path, card: &Card) -> Result<(), CardError> {
    if !is_valid_id(&card.id) {
        return Err(CardError::InvalidId);
    }
    write_at(
        board_dir(root).join(format!("{}.md", card.id)),
        &render_card(card),
    )
    .map(|_| ())
}

/// Create a card file and return the card it wrote. The id is a slug of the
/// title, de-duplicated with `-2`, `-3`, …
pub fn create_card(root: &Path, new: NewCard) -> Result<Card, CardError> {
    let title = one_line(&new.title);
    if title.is_empty() {
        return Err(CardError::Malformed("a card needs a title".to_owned()));
    }
    let due = new
        .due
        .map(|due| one_line(&due))
        .filter(|due| !due.is_empty());
    let mut card = Card {
        id: String::new(),
        path: PathBuf::new(),
        title,
        column: new.column,
        tags: new
            .tags
            .into_iter()
            .map(|tag| one_line(&tag))
            .filter(|tag| !tag.is_empty())
            .collect(),
        assignee: new.assignee,
        due,
        body: new.body.trim_end().to_owned(),
        extra: Vec::new(),
    };
    let directory = board_dir(root);
    fs::create_dir_all(&directory)?;
    let base = slugify(&card.title);
    let mut candidate = base.clone();
    let mut suffix = 2;
    while directory.join(format!("{candidate}.md")).exists() {
        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }
    card.id = candidate;
    card.path = directory.join(format!("{}.md", card.id));
    write_at(card.path.clone(), &render_card(&card))?;
    Ok(card)
}

/// Move one card to another column and rewrite its file.
pub fn move_card(root: &Path, id: &str, column: Column) -> Result<Card, CardError> {
    let mut card = read_card(root, id)?;
    card.column = column;
    save_card(root, &card)?;
    Ok(card)
}

/// Delete one card file.
pub fn delete_card(root: &Path, id: &str) -> Result<(), CardError> {
    if !is_valid_id(id) {
        return Err(CardError::InvalidId);
    }
    let path = board_dir(root).join(format!("{id}.md"));
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(CardError::NotFound),
        Err(error) => Err(CardError::Io(error.to_string())),
    }
}

/// The card's brief for an agent: title, the front-matter facts that matter
/// to a worker, then the body. The gateway's `handoff` action returns the
/// same shape.
pub fn brief(card: &Card) -> String {
    let mut out = format!("# {}\n\n", one_line(&card.title));
    out.push_str(&format!("- column: {}\n", card.column.key()));
    if !card.tags.is_empty() {
        out.push_str(&format!("- tags: {}\n", card.tags.join(", ")));
    }
    out.push_str(&format!("- assignee: {}\n", card.assignee.key()));
    if let Some(due) = card.due.as_deref() {
        out.push_str(&format!("- due: {due}\n"));
    }
    let body = card.body.trim();
    if !body.is_empty() {
        out.push('\n');
        out.push_str(body);
        out.push('\n');
    }
    out
}

/// A title-safe file stem: lowercase ASCII alphanumerics, `-` between words,
/// capped at 40 characters. A title with no ASCII letters or digits (a
/// Chinese-only title, say) gets a stable short hash so two cards never share
/// the generic `card` id.
fn slugify(title: &str) -> String {
    let mut slug = String::new();
    let mut pending_dash = false;
    for character in title.chars() {
        if character.is_ascii_alphanumeric() {
            if pending_dash && !slug.is_empty() {
                slug.push('-');
            }
            pending_dash = false;
            slug.push(character.to_ascii_lowercase());
            if slug.len() >= 40 {
                break;
            }
        } else if character.is_alphanumeric() {
            // Non-ASCII letters carry into the fallback, not the ASCII stem.
            pending_dash = !slug.is_empty();
        } else {
            pending_dash = !slug.is_empty();
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        let mut hash: u32 = 2166136261;
        for byte in title.as_bytes() {
            hash ^= u32::from(*byte);
            hash = hash.wrapping_mul(16777619);
        }
        format!("card-{:06x}", hash & 0x00ff_ffff)
    } else {
        slug
    }
}

/// Split a `tags:` value: `[a, b]`, `a, b` and `"a b"` all work.
fn parse_tags(value: &str) -> Vec<String> {
    let value = value.trim();
    let value = value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(value);
    value
        .split(',')
        .map(|tag| unquote(tag.trim()))
        .filter(|tag| !tag.is_empty())
        .collect()
}

/// Strip one pair of matching quotes, if present.
fn unquote(value: &str) -> String {
    let bytes = value.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' || first == b'\'') && first == last {
            return value[1..value.len() - 1].to_owned();
        }
    }
    value.to_owned()
}

/// Fold a value onto one line so it cannot break the front matter.
fn one_line(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Write through a sibling temp file, so a crash mid-write leaves either the
/// old card or the new one, never half of each.
fn write_at(path: PathBuf, contents: &str) -> Result<(), CardError> {
    let temp = path.with_extension("md.tmp");
    fs::write(&temp, contents)?;
    fs::rename(&temp, &path)?;
    Ok(())
}

/// The board as the IDE page's lower-left panel: column groups, one selected
/// card, and keys that write through to the card file.
pub struct BoardPanel {
    root: PathBuf,
    board: LoadedBoard,
    selected: usize,
    scroll: usize,
    status: Option<String>,
}

impl BoardPanel {
    /// Read the board under `root` (a missing `.zeta/board/` is an empty one).
    pub fn new(root: PathBuf) -> Self {
        let board = load(&root);
        Self {
            root,
            board,
            selected: 0,
            scroll: 0,
            status: None,
        }
    }

    /// The cards currently shown, in board order.
    pub fn board(&self) -> &LoadedBoard {
        &self.board
    }

    /// Re-read the directory, keeping the selection on the same card.
    pub fn reload(&mut self) {
        let selected = self.selected_id();
        self.board = load(&self.root);
        if let Some(id) = selected {
            if let Some(index) = self
                .visible()
                .iter()
                .position(|index| self.board.cards[*index].id == id)
            {
                self.selected = index;
            }
        }
        self.clamp();
    }

    /// Re-read the directory (the `r` key and the host both use this).
    pub fn refresh(&mut self) {
        self.reload();
    }

    /// Indices into `board.cards`, grouped by column in board order.
    fn visible(&self) -> Vec<usize> {
        let mut visible = Vec::with_capacity(self.board.cards.len());
        for column in Column::ALL {
            for (index, card) in self.board.cards.iter().enumerate() {
                if card.column == column {
                    visible.push(index);
                }
            }
        }
        visible
    }

    /// The drawing rows: one heading per column, one row per card.
    fn rows(&self) -> Vec<Row> {
        let mut rows = Vec::with_capacity(self.board.cards.len() + Column::ALL.len());
        for column in Column::ALL {
            let count = self
                .board
                .cards
                .iter()
                .filter(|card| card.column == column)
                .count();
            rows.push(Row::Heading(column, count));
            for (index, card) in self.board.cards.iter().enumerate() {
                if card.column == column {
                    rows.push(Row::Card(index));
                }
            }
        }
        rows
    }

    fn selected_id(&self) -> Option<String> {
        let index = *self.visible().get(self.selected)?;
        Some(self.board.cards[index].id.clone())
    }

    fn selected_card(&self) -> Option<&Card> {
        let index = *self.visible().get(self.selected)?;
        self.board.cards.get(index)
    }

    fn clamp(&mut self) {
        let count = self.visible().len();
        self.selected = self.selected.min(count.saturating_sub(1));
    }

    fn move_by(&mut self, step: isize) {
        let count = self.visible().len();
        if count == 0 {
            return;
        }
        let last = (count - 1) as isize;
        self.selected = (self.selected as isize + step).clamp(0, last) as usize;
    }

    /// Move the selected card one column left or right, writing the file.
    fn shift_column(&mut self, forward: bool) {
        let Some(card) = self.selected_card().cloned() else {
            return;
        };
        let next = if forward {
            card.column.next()
        } else {
            card.column.previous()
        };
        let Some(next) = next else {
            return;
        };
        self.status = Some(match move_card(&self.root, &card.id, next) {
            Ok(_) => format!("{} → {}", card.title, next.label()),
            Err(error) => error.to_string(),
        });
        self.reload();
    }

    /// The label of one card row: title, then tags / owner / due.
    fn card_label(card: &Card) -> String {
        let mut line = card.title.clone();
        let mut facts = Vec::new();
        if !card.tags.is_empty() {
            facts.push(format!("#{}", card.tags.join(" #")));
        }
        facts.push(format!("@{}", card.assignee.label()));
        if let Some(due) = card.due.as_deref() {
            facts.push(format!("due {due}"));
        }
        if !facts.is_empty() {
            line.push_str("  ");
            line.push_str(&facts.join(" · "));
        }
        line
    }
}

impl Panel for BoardPanel {
    fn name(&self) -> &'static str {
        "board"
    }

    fn title(&self) -> String {
        format!("Board ({})", self.board.cards.len())
    }

    fn render(&mut self, area: Rect, buf: &mut Buffer, ctx: &RenderContext) {
        buf.set_style(area, Style::default().bg(ctx.theme.bg).fg(ctx.theme.fg));
        let visible = area.height as usize;
        if visible == 0 || area.width == 0 {
            return;
        }

        // The selection is a flat index over the card rows, so scrolling and
        // drawing agree.
        let selected_index = self.visible().get(self.selected).copied();
        let rows = self.rows();
        let selected_row = rows
            .iter()
            .position(|row| matches!(row, Row::Card(index) if Some(*index) == selected_index))
            .unwrap_or(0);
        if selected_row < self.scroll {
            self.scroll = selected_row;
        } else if selected_row >= self.scroll + visible {
            self.scroll = selected_row + 1 - visible;
        }

        let dim = Style::default().fg(ctx.theme.disabled);
        for (offset, row) in rows.iter().skip(self.scroll).take(visible).enumerate() {
            let y = area.y + offset as u16;
            match row {
                Row::Heading(column, count) => {
                    let label = format!(" {} · {count} ", column.label());
                    buf.set_stringn(
                        area.x,
                        y,
                        &label,
                        area.width as usize,
                        dim.add_modifier(Modifier::BOLD),
                    );
                }
                Row::Card(index) => {
                    let card = &self.board.cards[*index];
                    let style = if Some(*index) == selected_index {
                        Style::default()
                            .bg(ctx.theme.selection_bg)
                            .fg(ctx.theme.selection_fg)
                            .add_modifier(Modifier::BOLD)
                    } else {
                        Style::default().fg(ctx.theme.fg)
                    };
                    let label = Self::card_label(card);
                    buf.set_stringn(area.x, y, &label, area.width as usize, style);
                }
            }
        }
        if let Some(status) = &self.status {
            let bottom = area.bottom().saturating_sub(1);
            if bottom > area.y {
                buf.set_stringn(area.x, bottom, status, area.width as usize, dim);
            }
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
            KeyCode::Left | KeyCode::Char('h') => {
                self.shift_column(false);
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Right | KeyCode::Char('l') | KeyCode::Char(' ') => {
                self.shift_column(true);
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Enter => match self.selected_card() {
                Some(card) => vec![PanelEvent::OpenFileAt {
                    path: card.path.clone(),
                    line: 1,
                    column: 1,
                }],
                None => Vec::new(),
            },
            KeyCode::Char('r') => {
                self.reload();
                vec![PanelEvent::NeedsRedraw]
            }
            _ => Vec::new(),
        }
    }

    fn handle_mouse(&mut self, event: MouseEvent, panel_area: Rect) -> Vec<PanelEvent> {
        if matches!(event.kind, MouseEventKind::Down(_))
            && panel_area.contains((event.column, event.row).into())
        {
            // A click on a card row selects it; headings have no target.
            let row = (event.row - panel_area.y) as usize + self.scroll;
            if let Some(Row::Card(index)) = self.rows().get(row) {
                let visible = self.visible();
                if let Some(selected) = visible.iter().position(|candidate| candidate == index) {
                    self.selected = selected;
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

/// One drawn row of the panel's column list.
enum Row {
    Heading(Column, usize),
    Card(usize),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board_dir_of(root: &Path) -> PathBuf {
        let dir = board_dir(root);
        fs::create_dir_all(&dir).expect("board dir");
        dir
    }

    fn write_card_file(root: &Path, name: &str, text: &str) {
        let dir = board_dir_of(root);
        fs::write(dir.join(name), text).expect("card file");
    }

    #[test]
    fn a_minimal_card_defaults_to_todo_and_the_user() {
        let card = parse_card(
            "fix-parser",
            PathBuf::from(".zeta/board/fix-parser.md"),
            "---\ntitle: Fix the parser\n---\n\nBody line.\n",
        )
        .expect("card");
        assert_eq!(card.title, "Fix the parser");
        assert_eq!(card.column, Column::Todo);
        assert_eq!(card.assignee, Assignee::User);
        assert_eq!(card.due, None);
        assert!(card.tags.is_empty());
        assert_eq!(card.body, "Body line.");
    }

    #[test]
    fn front_matter_carries_every_field_and_unknown_keys_survive() {
        let text = "---\n\
            title: \"Ship the board\"\n\
            column: Doing\n\
            tags: [rust, ui]\n\
            assignee: agent\n\
            due: 2026-11-01\n\
            estimate: 3\n\
            ---\n\n\
            Hand this to an agent.\n";
        let card = parse_card("ship-board", PathBuf::new(), text).expect("card");
        assert_eq!(card.title, "Ship the board");
        assert_eq!(card.column, Column::Doing);
        assert_eq!(card.tags, vec!["rust".to_owned(), "ui".to_owned()]);
        assert_eq!(card.assignee, Assignee::Agent);
        assert_eq!(card.due.as_deref(), Some("2026-11-01"));
        assert_eq!(card.extra, vec![("estimate".to_owned(), "3".to_owned())]);
        assert_eq!(card.body, "Hand this to an agent.");

        let rendered = render_card(&card);
        let reparsed = parse_card("ship-board", PathBuf::new(), &rendered).expect("round trip");
        assert_eq!(reparsed, card);
    }

    #[test]
    fn tags_accept_brackets_or_plain_commas() {
        let plain = parse_card(
            "a",
            PathBuf::new(),
            "---\ntitle: A\ntags: one, \"two three\"\n---\n",
        )
        .expect("card");
        assert_eq!(plain.tags, vec!["one".to_owned(), "two three".to_owned()]);
        let brackets =
            parse_card("b", PathBuf::new(), "---\ntitle: B\ntags: [x, y]\n---\n").expect("card");
        assert_eq!(brackets.tags, vec!["x".to_owned(), "y".to_owned()]);
    }

    #[test]
    fn malformed_and_foreign_files_are_rejected_with_a_reason() {
        let missing = parse_card("a", PathBuf::new(), "# Notes\n\nnot a card\n");
        assert_eq!(missing.unwrap_err(), "missing front matter");

        let unclosed = parse_card("a", PathBuf::new(), "---\ntitle: A\n");
        assert!(unclosed.unwrap_err().contains("closed"));

        let no_title = parse_card("a", PathBuf::new(), "---\ncolumn: todo\n---\n");
        assert!(no_title.unwrap_err().contains("no title"));

        let bad_column = parse_card("a", PathBuf::new(), "---\ntitle: A\ncolumn: someday\n---\n");
        assert!(bad_column.unwrap_err().contains("unknown column"));

        let bad_assignee = parse_card("a", PathBuf::new(), "---\ntitle: A\nassignee: robot\n---\n");
        assert!(bad_assignee.unwrap_err().contains("unknown assignee"));
    }

    #[test]
    fn load_skips_foreign_files_and_reports_malformed_cards() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_card_file(
            dir.path(),
            "done.md",
            "---\ntitle: Ship\ncolumn: done\n---\n",
        );
        write_card_file(dir.path(), "not-a-card.md", "# README\n");
        write_card_file(dir.path(), "notes.txt", "ignore me");
        write_card_file(dir.path(), ".hidden.md", "---\ntitle: Hidden\n---\n");

        let board = load(dir.path());
        assert_eq!(board.cards.len(), 1, "only the valid card loads");
        assert_eq!(board.warnings.len(), 1, "the malformed card is reported");
        assert_eq!(board.warnings[0].file, "not-a-card.md");
    }

    #[test]
    fn create_move_and_delete_rewrite_the_same_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = dir.path();
        let mut new = NewCard::titled("Fix the parser");
        new.tags = vec!["rust".to_owned()];
        new.due = Some("2026-11-01".to_owned());
        new.body = "The brief.".to_owned();
        let card = create_card(root, new).expect("create");
        assert_eq!(card.id, "fix-the-parser");
        let path = board_dir(root).join("fix-the-parser.md");
        assert_eq!(card.path, path);
        let text = fs::read_to_string(&path).expect("card file");
        assert!(text.contains("title: Fix the parser"));
        assert!(text.contains("The brief."));

        // A second card with the same title gets a distinct id.
        let second = create_card(root, NewCard::titled("Fix the parser")).expect("second");
        assert_eq!(second.id, "fix-the-parser-2");

        let moved = move_card(root, &card.id, Column::Doing).expect("move");
        assert_eq!(moved.column, Column::Doing);
        let on_disk = read_card(root, &card.id).expect("re-read");
        assert_eq!(
            on_disk.column,
            Column::Doing,
            "the move was written, not cached"
        );
        assert!(
            fs::read_to_string(&path)
                .expect("card file")
                .contains("column: doing"),
            "the same path holds the moved card"
        );

        delete_card(root, &card.id).expect("delete");
        assert!(!path.exists());
        assert_eq!(
            delete_card(root, &card.id).unwrap_err(),
            CardError::NotFound
        );
    }

    #[test]
    fn ids_cannot_escape_the_board_directory() {
        for id in ["", "..", "../x", "a/b", "a\\b", ".hidden", "a b"] {
            assert!(!is_valid_id(id), "{id:?} must be rejected");
            let dir = tempfile::tempdir().expect("temp dir");
            assert_eq!(read_card(dir.path(), id).unwrap_err(), CardError::InvalidId);
            assert_eq!(
                delete_card(dir.path(), id).unwrap_err(),
                CardError::InvalidId
            );
        }
    }

    #[test]
    fn a_non_ascii_title_still_gets_a_stable_distinct_id() {
        let dir = tempfile::tempdir().expect("temp dir");
        let first = create_card(dir.path(), NewCard::titled("修复解析器")).expect("first");
        let second = create_card(dir.path(), NewCard::titled("修复解析器")).expect("second");
        assert!(first.id.starts_with("card-"), "{}", first.id);
        assert_ne!(first.id, second.id);
    }

    #[test]
    fn the_brief_carries_the_body_and_the_facts() {
        let card = parse_card(
            "a",
            PathBuf::new(),
            "---\ntitle: Fix it\ntags: [rust]\nassignee: agent\ndue: 2026-11-01\n---\n\nDo the thing.\n",
        )
        .expect("card");
        let brief = brief(&card);
        assert!(brief.starts_with("# Fix it\n"));
        assert!(brief.contains("- tags: rust"));
        assert!(brief.contains("- assignee: agent"));
        assert!(brief.contains("Do the thing."));
    }

    #[test]
    fn the_panel_renders_columns_and_moves_on_a_key() {
        let dir = tempfile::tempdir().expect("temp dir");
        write_card_file(dir.path(), "a.md", "---\ntitle: First\ntags: [x]\n---\n");
        write_card_file(
            dir.path(),
            "b.md",
            "---\ntitle: Second\ncolumn: doing\nassignee: agent\n---\n",
        );
        let mut panel = BoardPanel::new(dir.path().to_path_buf());
        assert_eq!(panel.title(), "Board (2)");

        let mut buffer = Buffer::empty(Rect::new(0, 0, 60, 12));
        let theme = termide_core::panel::ThemeColors::default();
        let config = termide_core::panel::PanelConfig::default();
        let ctx = RenderContext {
            theme: &theme,
            config: &config,
            is_focused: true,
            panel_index: 0,
            terminal_width: 60,
            terminal_height: 12,
            border_right_x: None,
            border_bottom_y: None,
        };
        panel.render(Rect::new(0, 0, 60, 12), &mut buffer, &ctx);
        let rendered = buffer
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(rendered.contains("Todo"), "the Todo heading is drawn");
        assert!(rendered.contains("Doing"), "the Doing heading is drawn");
        assert!(rendered.contains("Done"), "the Done heading is drawn");
        assert!(rendered.contains("First"));
        assert!(rendered.contains("Second"));

        // Down selects the Doing card; Left moves it into Todo and writes.
        let chord = |code| KeyChord {
            raw: crossterm::event::KeyEvent::new(code, crossterm::event::KeyModifiers::NONE),
            canonical: crossterm::event::KeyEvent::new(code, crossterm::event::KeyModifiers::NONE),
        };
        panel.handle_key(chord(KeyCode::Down));
        panel.handle_key(chord(KeyCode::Left));
        let moved = read_card(dir.path(), "b").expect("card");
        assert_eq!(moved.column, Column::Todo);
    }
}
