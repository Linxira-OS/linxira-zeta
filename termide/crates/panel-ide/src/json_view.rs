//! Read-only JSON viewer: parse, fold, locate the first syntax error, copy a
//! node's JSON Pointer or value.
//!
//! Numbers are kept as the exact source text, never as `f64`: a viewer that
//! rounds `12345678901234567890` or changes a decimal's trailing digits lies
//! about the file. Copying a value therefore reproduces the literal as written
//! (including escapes and number precision); the viewer never writes the file.
//!
//! The parser is deliberately small (JSON only, no comments, no trailing
//! commas) and reports the 1-based line/column of the first error.

use std::any::Any;
use std::collections::HashSet;
use std::path::PathBuf;

use crossterm::event::{KeyCode, MouseEvent, MouseEventKind};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use termide_core::event::PanelEvent;
use termide_core::key_chord::KeyChord;
use termide_core::panel::{Panel, RenderContext};

/// Refuse files larger than this; a JSON tree this big is not a viewer target
/// and would spend the frame budget building rows.
pub const MAX_BYTES: usize = 8 * 1024 * 1024;
/// Nesting limit: malformed input must report an error, not overflow the stack.
const MAX_DEPTH: usize = 512;

/// One parsed JSON value. Scalars keep the exact text they came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JsonValue {
    Null,
    Bool(bool),
    /// The number literal exactly as written (`-0`, `1e+9`, arbitrary digits).
    Number(String),
    String {
        /// Decoded text, for display.
        decoded: String,
        /// The quoted literal from the source, escapes intact, for copy.
        raw: String,
    },
    Array(Vec<JsonValue>),
    Object(Vec<(String, JsonValue)>),
}

impl JsonValue {
    fn kind(&self) -> RowKind {
        match self {
            JsonValue::Null => RowKind::Null,
            JsonValue::Bool(_) => RowKind::Bool,
            JsonValue::Number(_) => RowKind::Number,
            JsonValue::String { .. } => RowKind::String,
            JsonValue::Array(_) => RowKind::Array,
            JsonValue::Object(_) => RowKind::Object,
        }
    }

    fn is_container(&self) -> bool {
        matches!(self, JsonValue::Array(_) | JsonValue::Object(_))
    }

    /// The value as a JSON literal. Numbers and string literals are copied
    /// verbatim, so precision and escapes survive; containers are compact.
    pub fn to_json(&self) -> String {
        match self {
            JsonValue::Null => "null".to_owned(),
            JsonValue::Bool(value) => value.to_string(),
            JsonValue::Number(text) => text.clone(),
            JsonValue::String { raw, .. } => raw.clone(),
            JsonValue::Array(items) => {
                let body = items
                    .iter()
                    .map(JsonValue::to_json)
                    .collect::<Vec<_>>()
                    .join(",");
                format!("[{body}]")
            }
            JsonValue::Object(entries) => {
                let body = entries
                    .iter()
                    .map(|(key, value)| format!("{}:{}", quote(key), value.to_json()))
                    .collect::<Vec<_>>()
                    .join(",");
                format!("{{{body}}}")
            }
        }
    }
}

fn quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// First syntax error, located in the source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonError {
    pub line: usize,
    pub column: usize,
    pub message: String,
}

impl JsonError {
    fn at(text: &str, pos: usize, message: String) -> Self {
        let pos = pos.min(text.len());
        let mut line = 1;
        let mut column = 1;
        for (index, ch) in text.char_indices() {
            if index >= pos {
                break;
            }
            if ch == '\n' {
                line += 1;
                column = 1;
            } else {
                column += 1;
            }
        }
        Self {
            line,
            column,
            message,
        }
    }
}

struct Parser<'a> {
    text: &'a str,
    bytes: &'a [u8],
    pos: usize,
    depth: usize,
}

impl<'a> Parser<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            text,
            bytes: text.as_bytes(),
            pos: 0,
            depth: 0,
        }
    }

    fn error(&self, message: impl Into<String>) -> JsonError {
        JsonError::at(self.text, self.pos, message.into())
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn enter(&mut self) -> Result<(), JsonError> {
        if self.depth >= MAX_DEPTH {
            return Err(self.error("nesting is too deep"));
        }
        self.depth += 1;
        Ok(())
    }

    fn value(&mut self) -> Result<JsonValue, JsonError> {
        self.skip_ws();
        match self.peek() {
            None => Err(self.error("unexpected end of input")),
            Some(b'{') => self.object(),
            Some(b'[') => self.array(),
            Some(b'"') => {
                let (decoded, raw) = self.string()?;
                Ok(JsonValue::String { decoded, raw })
            }
            Some(b't') => self.literal("true", JsonValue::Bool(true)),
            Some(b'f') => self.literal("false", JsonValue::Bool(false)),
            Some(b'n') => self.literal("null", JsonValue::Null),
            Some(b'-' | b'0'..=b'9') => self.number(),
            Some(other) => Err(self.error(format!("unexpected character `{}`", other as char))),
        }
    }

    fn literal(&mut self, word: &str, value: JsonValue) -> Result<JsonValue, JsonError> {
        if self.text[self.pos..].starts_with(word) {
            self.pos += word.len();
            Ok(value)
        } else {
            Err(self.error(format!("expected `{word}`")))
        }
    }

    fn string(&mut self) -> Result<(String, String), JsonError> {
        let start = self.pos;
        self.pos += 1; // opening quote
        let mut out = String::new();
        loop {
            let byte = match self.peek() {
                Some(byte) => byte,
                None => return Err(self.error("unterminated string")),
            };
            match byte {
                b'"' => {
                    self.pos += 1;
                    return Ok((out, self.text[start..self.pos].to_owned()));
                }
                b'\\' => {
                    self.pos += 1;
                    let escape = match self.peek() {
                        Some(escape) => escape,
                        None => return Err(self.error("unterminated escape")),
                    };
                    self.pos += 1;
                    match escape {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let mut code = self.hex4()?;
                            if (0xD800..=0xDBFF).contains(&code) {
                                if self.peek() != Some(b'\\')
                                    || self.bytes.get(self.pos + 1) != Some(&b'u')
                                {
                                    return Err(self.error("unpaired high surrogate"));
                                }
                                self.pos += 2;
                                let low = self.hex4()?;
                                if !(0xDC00..=0xDFFF).contains(&low) {
                                    return Err(self.error("invalid low surrogate"));
                                }
                                code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                            } else if (0xDC00..=0xDFFF).contains(&code) {
                                return Err(self.error("unpaired low surrogate"));
                            }
                            match char::from_u32(code) {
                                Some(ch) => out.push(ch),
                                None => return Err(self.error("invalid unicode escape")),
                            }
                        }
                        other => {
                            return Err(self.error(format!("invalid escape `\\{}`", other as char)))
                        }
                    }
                }
                byte if byte < 0x20 => return Err(self.error("raw control character in string")),
                _ => {
                    let ch = match self.text[self.pos..].chars().next() {
                        Some(ch) => ch,
                        None => return Err(self.error("unterminated string")),
                    };
                    out.push(ch);
                    self.pos += ch.len_utf8();
                }
            }
        }
    }

    fn hex4(&mut self) -> Result<u32, JsonError> {
        let mut value = 0u32;
        for _ in 0..4 {
            let byte = match self.peek() {
                Some(byte) => byte,
                None => return Err(self.error("truncated unicode escape")),
            };
            let digit = match byte {
                b'0'..=b'9' => (byte - b'0') as u32,
                b'a'..=b'f' => (byte - b'a' + 10) as u32,
                b'A'..=b'F' => (byte - b'A' + 10) as u32,
                _ => return Err(self.error("invalid hex digit in unicode escape")),
            };
            value = value * 16 + digit;
            self.pos += 1;
        }
        Ok(value)
    }

    fn number(&mut self) -> Result<JsonValue, JsonError> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        match self.peek() {
            Some(b'0') => {
                self.pos += 1;
                if matches!(self.peek(), Some(b'0'..=b'9')) {
                    return Err(self.error("leading zero in number"));
                }
            }
            Some(b'1'..=b'9') => {
                while matches!(self.peek(), Some(b'0'..=b'9')) {
                    self.pos += 1;
                }
            }
            _ => return Err(self.error("invalid number")),
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.error("digit expected after `.`"));
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.error("digit expected in exponent"));
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        Ok(JsonValue::Number(self.text[start..self.pos].to_owned()))
    }

    fn array(&mut self) -> Result<JsonValue, JsonError> {
        self.enter()?;
        self.pos += 1; // [
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            self.depth -= 1;
            return Ok(JsonValue::Array(items));
        }
        loop {
            items.push(self.value()?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    self.depth -= 1;
                    return Ok(JsonValue::Array(items));
                }
                _ => return Err(self.error("expected `,` or `]`")),
            }
        }
    }

    fn object(&mut self) -> Result<JsonValue, JsonError> {
        self.enter()?;
        self.pos += 1; // {
        let mut entries = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            self.depth -= 1;
            return Ok(JsonValue::Object(entries));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') {
                return Err(self.error("object key must be a string"));
            }
            let (key, _) = self.string()?;
            self.skip_ws();
            if self.peek() != Some(b':') {
                return Err(self.error("expected `:` after object key"));
            }
            self.pos += 1;
            let value = self.value()?;
            entries.push((key, value));
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    self.depth -= 1;
                    return Ok(JsonValue::Object(entries));
                }
                _ => return Err(self.error("expected `,` or `}`")),
            }
        }
    }
}

/// Parse one JSON document.
pub fn parse(text: &str) -> Result<JsonValue, JsonError> {
    let mut parser = Parser::new(text);
    let value = parser.value()?;
    parser.skip_ws();
    if let Some(byte) = parser.peek() {
        return Err(parser.error(format!(
            "trailing data after the document (`{}`)",
            byte as char
        )));
    }
    Ok(value)
}

/// The value type, for row colouring.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowKind {
    Null,
    Bool,
    Number,
    String,
    Array,
    Object,
}

/// One rendered line of the folded tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonRow {
    pub depth: usize,
    /// `None` only for the root.
    pub key: Option<String>,
    /// What follows the key (a scalar literal or a folded container summary).
    pub preview: String,
    /// JSON Pointer to this node (`""` is the root).
    pub pointer: String,
    pub kind: RowKind,
    pub collapsible: bool,
    pub expanded: bool,
}

fn pointer_child(parent: &str, key: &str) -> String {
    let escaped = key.replace('~', "~0").replace('/', "~1");
    format!("{parent}/{escaped}")
}

fn build_rows(
    value: &JsonValue,
    key: Option<&str>,
    pointer: &str,
    depth: usize,
    collapsed: &HashSet<String>,
    out: &mut Vec<JsonRow>,
) {
    let expanded = value.is_container() && !collapsed.contains(pointer);
    let preview = match value {
        JsonValue::Null => "null".to_owned(),
        JsonValue::Bool(value) => value.to_string(),
        JsonValue::Number(text) => text.clone(),
        JsonValue::String { raw, .. } => raw.clone(),
        JsonValue::Array(items) if expanded => format!("[{} items]", items.len()),
        JsonValue::Array(items) => format!("[…] {} items", items.len()),
        JsonValue::Object(entries) if expanded => format!("{{{} keys}}", entries.len()),
        JsonValue::Object(entries) => format!("{{…}} {} keys", entries.len()),
    };
    out.push(JsonRow {
        depth,
        key: key.map(str::to_owned),
        preview,
        pointer: pointer.to_owned(),
        kind: value.kind(),
        collapsible: value.is_container(),
        expanded,
    });
    if !expanded {
        return;
    }
    match value {
        JsonValue::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                let child = pointer_child(pointer, &index.to_string());
                build_rows(item, None, &child, depth + 1, collapsed, out);
            }
        }
        JsonValue::Object(entries) => {
            for (name, item) in entries {
                let child = pointer_child(pointer, name);
                build_rows(item, Some(name), &child, depth + 1, collapsed, out);
            }
        }
        _ => {}
    }
}

/// A read-only JSON document panel.
pub struct JsonPanel {
    path: PathBuf,
    source: String,
    value: Option<JsonValue>,
    error: Option<JsonError>,
    collapsed: HashSet<String>,
    rows: Vec<JsonRow>,
    selected: usize,
    scroll: usize,
    /// Visible rows in the last render, for keyboard folding.
    height: usize,
    message: Option<String>,
}

impl JsonPanel {
    /// Read and parse `path`. A read or parse failure keeps the panel open with
    /// the error on screen; it never falls back to writing anything.
    pub fn from_path(path: PathBuf) -> Self {
        let mut panel = Self {
            path,
            source: String::new(),
            value: None,
            error: None,
            collapsed: HashSet::new(),
            rows: Vec::new(),
            selected: 0,
            scroll: 0,
            height: 1,
            message: None,
        };
        panel.reload();
        panel
    }

    /// Re-read the file. The viewer is read-only: this never writes.
    pub fn reload(&mut self) {
        self.error = None;
        self.value = None;
        self.rows.clear();
        self.source.clear();
        self.selected = 0;
        self.scroll = 0;
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) => {
                self.error = Some(JsonError {
                    line: 1,
                    column: 1,
                    message: format!("cannot read {}: {error}", self.path.display()),
                });
                return;
            }
        };
        if bytes.len() > MAX_BYTES {
            self.error = Some(JsonError {
                line: 1,
                column: 1,
                message: format!(
                    "file is {} bytes; the viewer limit is {MAX_BYTES}",
                    bytes.len()
                ),
            });
            return;
        }
        self.source = String::from_utf8_lossy(&bytes).into_owned();
        match parse(&self.source) {
            Ok(value) => {
                build_rows(&value, None, "", 0, &self.collapsed, &mut self.rows);
                self.value = Some(value);
            }
            Err(error) => self.error = Some(error),
        }
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    pub fn rows(&self) -> &[JsonRow] {
        &self.rows
    }

    pub fn error(&self) -> Option<&JsonError> {
        self.error.as_ref()
    }

    fn rebuild(&mut self) {
        self.rows.clear();
        if let Some(value) = self.value.as_ref() {
            build_rows(value, None, "", 0, &self.collapsed, &mut self.rows);
        }
        self.selected = self.selected.min(self.rows.len().saturating_sub(1));
    }

    fn toggle(&mut self) {
        let Some(row) = self.rows.get(self.selected).cloned() else {
            return;
        };
        if !row.collapsible {
            return;
        }
        if !self.collapsed.remove(&row.pointer) {
            self.collapsed.insert(row.pointer);
        }
        self.rebuild();
        self.ensure_visible(self.height);
    }

    fn move_by(&mut self, step: isize) {
        if self.rows.is_empty() {
            return;
        }
        let last = self.rows.len() - 1;
        self.selected = (self.selected as isize + step).clamp(0, last as isize) as usize;
    }

    fn ensure_visible(&mut self, visible: usize) {
        let visible = visible.max(1);
        if self.selected < self.scroll {
            self.scroll = self.selected;
        } else if self.selected >= self.scroll + visible {
            self.scroll = self.selected + 1 - visible;
        }
    }

    fn copy_value(&mut self) {
        let Some(row) = self.rows.get(self.selected) else {
            return;
        };
        let Some(value) = self.value_for(&row.pointer) else {
            return;
        };
        let text = value.to_json();
        match termide_clipboard::copy(&text) {
            Ok(()) => self.message = Some(format!("copied value ({} chars)", text.chars().count())),
            Err(error) => self.message = Some(format!("copy failed: {error}")),
        }
    }

    fn copy_pointer(&mut self) {
        let Some(row) = self.rows.get(self.selected) else {
            return;
        };
        let pointer = if row.pointer.is_empty() {
            "$".to_owned()
        } else {
            format!("${}", row.pointer)
        };
        match termide_clipboard::copy(&pointer) {
            Ok(()) => self.message = Some(format!("copied path {pointer}")),
            Err(error) => self.message = Some(format!("copy failed: {error}")),
        }
    }

    /// Resolve a JSON Pointer produced by [`build_rows`].
    fn value_for(&self, pointer: &str) -> Option<&JsonValue> {
        let mut value = self.value.as_ref()?;
        for token in pointer.split('/').filter(|token| !token.is_empty()) {
            let token = token.replace("~1", "/").replace("~0", "~");
            value = match value {
                JsonValue::Array(items) => items.get(token.parse::<usize>().ok()?)?,
                JsonValue::Object(entries) => &entries.iter().find(|(key, _)| key == &token)?.1,
                _ => return None,
            };
        }
        Some(value)
    }

    fn line_text(&self, line: usize) -> &str {
        self.source
            .lines()
            .nth(line.saturating_sub(1))
            .unwrap_or("")
    }
}

impl Panel for JsonPanel {
    fn name(&self) -> &'static str {
        "json"
    }

    fn title(&self) -> String {
        let name = self
            .path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.path.display().to_string());
        format!("JSON · {name}")
    }

    fn render(&mut self, area: Rect, buf: &mut Buffer, ctx: &RenderContext) {
        buf.set_style(area, Style::default().bg(ctx.theme.bg).fg(ctx.theme.fg));
        if area.height == 0 {
            return;
        }
        if let Some(error) = self.error.as_ref() {
            let head = format!(
                "JSON error at line {}, column {}: {}",
                error.line, error.column, error.message
            );
            buf.set_stringn(
                area.x,
                area.y,
                &head,
                area.width as usize,
                Style::default()
                    .fg(ctx.theme.error)
                    .add_modifier(Modifier::BOLD),
            );
            if area.height > 1 {
                let source = format!("  {}", self.line_text(error.line));
                buf.set_stringn(
                    area.x,
                    area.y + 1,
                    &source,
                    area.width as usize,
                    Style::default().fg(ctx.theme.disabled),
                );
            }
            return;
        }
        if self.rows.is_empty() {
            return;
        }
        self.height = area.height as usize;
        self.ensure_visible(area.height as usize);
        for row in 0..area.height as usize {
            let index = self.scroll + row;
            let Some(line) = self.rows.get(index) else {
                break;
            };
            let indent = "  ".repeat(line.depth);
            let marker = if line.collapsible {
                if line.expanded {
                    "▾ "
                } else {
                    "▸ "
                }
            } else {
                "  "
            };
            let key = line
                .key
                .as_deref()
                .map(|key| format!("{key}: "))
                .unwrap_or_default();
            let text = format!("{indent}{marker}{key}{}", line.preview);
            let style = if index == self.selected {
                Style::default()
                    .bg(ctx.theme.selection_bg)
                    .fg(ctx.theme.selection_fg)
                    .add_modifier(Modifier::BOLD)
            } else {
                let colour = match line.kind {
                    RowKind::Null => ctx.theme.disabled,
                    RowKind::Bool => ctx.theme.info,
                    RowKind::Number => ctx.theme.warning,
                    RowKind::String => ctx.theme.success,
                    RowKind::Array | RowKind::Object => ctx.theme.cursor,
                };
                Style::default().fg(colour)
            };
            buf.set_stringn(
                area.x,
                area.y + row as u16,
                &text,
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
                self.selected = self.rows.len().saturating_sub(1);
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Left => {
                // Collapse the row; an already collapsed row jumps to its parent.
                let Some(row) = self.rows.get(self.selected).cloned() else {
                    return Vec::new();
                };
                if row.collapsible && row.expanded {
                    self.collapsed.insert(row.pointer);
                    self.rebuild();
                } else {
                    self.selected = self
                        .rows
                        .iter()
                        .rposition(|candidate| {
                            candidate.depth < row.depth
                                && row.pointer.starts_with(&candidate.pointer)
                        })
                        .unwrap_or(0);
                }
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Right => {
                let Some(row) = self.rows.get(self.selected).cloned() else {
                    return Vec::new();
                };
                if row.collapsible && !row.expanded {
                    self.collapsed.remove(&row.pointer);
                    self.rebuild();
                }
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Enter | KeyCode::Char(' ') => {
                self.toggle();
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Char('c') => {
                self.copy_value();
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Char('p') => {
                self.copy_pointer();
                vec![PanelEvent::NeedsRedraw]
            }
            KeyCode::Char('r') => {
                self.reload();
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
        let index = self.scroll + (event.row - panel_area.y) as usize;
        if index >= self.rows.len() {
            return Vec::new();
        }
        let collapsible = self.rows[index].collapsible;
        if index == self.selected && collapsible {
            self.toggle();
        } else {
            self.selected = index;
        }
        vec![PanelEvent::NeedsRedraw]
    }

    fn handle_scroll(&mut self, delta: i32, _panel_area: Rect) -> Vec<PanelEvent> {
        self.move_by(delta as isize);
        vec![PanelEvent::NeedsRedraw]
    }

    fn status_segments(&self) -> Vec<termide_core::panel::StatusSegment> {
        vec![termide_core::panel::StatusSegment {
            text: self
                .message
                .clone()
                .unwrap_or_else(|| "↑↓ move · ←→ fold · c value · p path · readonly".to_owned()),
            kind: termide_core::panel::SegmentKind::Label,
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
    fn numbers_keep_their_exact_source_text() {
        let value = parse(r#"{"big":123456789012345678901234567890,"exp":1e+9}"#).unwrap();
        let JsonValue::Object(entries) = &value else {
            panic!("object expected");
        };
        assert_eq!(
            entries[0].1,
            JsonValue::Number("123456789012345678901234567890".into())
        );
        assert_eq!(entries[1].1, JsonValue::Number("1e+9".into()));
        // Copying the value returns the literal, not a rounded float.
        assert_eq!(entries[0].1.to_json(), "123456789012345678901234567890");
    }

    #[test]
    fn strings_decode_escapes_but_copy_keeps_the_literal() {
        let value = parse(r#""a\n\u0041\ud83d\ude00""#).unwrap();
        let JsonValue::String { decoded, raw } = &value else {
            panic!("string expected");
        };
        assert_eq!(decoded.as_str(), "a\nA😀");
        assert_eq!(raw, r#""a\n\u0041\ud83d\ude00""#);
        assert_eq!(value.to_json(), raw.as_str());
    }

    #[test]
    fn errors_report_one_based_line_and_column() {
        let error = parse("{\n  \"a\": 1,\n  \"b\": }\n").unwrap_err();
        assert_eq!((error.line, error.column), (3, 8));
        assert!(error.message.contains("unexpected character"));
    }

    #[test]
    fn rows_fold_and_unfold_containers() {
        let value = parse(r#"{"a":[1,2],"b":{"c":true}}"#).unwrap();
        let mut collapsed = HashSet::new();
        let mut rows = Vec::new();
        build_rows(&value, None, "", 0, &collapsed, &mut rows);
        assert_eq!(rows.len(), 6, "root + a + 2 items + b + c");
        assert_eq!(rows[1].pointer, "/a");
        assert!(rows[1].expanded);

        collapsed.insert("/a".to_owned());
        rows.clear();
        build_rows(&value, None, "", 0, &collapsed, &mut rows);
        assert_eq!(rows.len(), 4, "the two array items are folded away");
        assert!(!rows[1].expanded);
        assert_eq!(rows[1].preview, "[…] 2 items");
    }

    #[test]
    fn pointer_lookup_handles_escaped_keys_and_indices() {
        let value = parse(r#"{"a/b":{"~x":[10,20]}}"#).unwrap();
        let panel = JsonPanel {
            path: PathBuf::new(),
            source: String::new(),
            value: Some(value),
            error: None,
            collapsed: HashSet::new(),
            rows: Vec::new(),
            selected: 0,
            scroll: 0,
            height: 1,
            message: None,
        };
        let pointer = pointer_child("", "a/b");
        let pointer = pointer_child(&pointer, "~x");
        let pointer = pointer_child(&pointer, "1");
        assert_eq!(
            panel.value_for(&pointer),
            Some(&JsonValue::Number("20".into()))
        );
    }

    #[test]
    fn a_broken_file_keeps_the_error_and_no_rows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, "{\"a\": [1, }").unwrap();
        let panel = JsonPanel::from_path(path);
        assert!(panel.error().is_some());
        assert!(panel.rows().is_empty());
    }
}
