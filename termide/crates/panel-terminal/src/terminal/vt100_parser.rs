//! VT100/ANSI escape sequence parser implementation.
//!
//! This module provides the VtPerformer struct which implements the vte::Perform trait
//! to parse and handle VT100/ANSI escape sequences for terminal emulation.

#![allow(clippy::needless_range_loop)]

use std::io::Write;
use std::sync::{Arc, Mutex, RwLock};
use vte::{Params, Perform};

use super::{
    csi_handlers::{handle_cursor_movement, handle_private_sequence, handle_sgr},
    Cell, KeyboardProtocolMode, TerminalScreen,
};

/// Batched screen operation to reduce mutex contention.
///
/// Instead of acquiring a lock for each character, we batch operations
/// and apply them all at once with a single lock.
#[derive(Clone)]
pub enum ScreenOp {
    PutChar(char),
    Newline,
    CarriageReturn,
    Backspace,
    Tab,
}

/// VT100 parser and performer.
///
/// Implements the vte::Perform trait to handle ANSI/VT100 escape sequences
/// and update the terminal screen state accordingly.
///
/// Uses batching to reduce lock contention: simple operations (print, execute)
/// are collected in a buffer and applied with a single lock via `flush()`.
pub struct VtPerformer {
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub screen: Arc<RwLock<TerminalScreen>>,
    /// Buffer for batching screen operations
    pub pending_ops: Vec<ScreenOp>,
}

impl VtPerformer {
    /// Apply all pending operations with a single write lock.
    ///
    /// This significantly reduces lock contention when processing
    /// large amounts of terminal output (e.g., from Claude Code).
    pub fn flush(&mut self) {
        if self.pending_ops.is_empty() {
            return;
        }
        if let Ok(mut screen) = self.screen.write() {
            for op in self.pending_ops.drain(..) {
                match op {
                    ScreenOp::PutChar(ch) => screen.put_char(ch),
                    ScreenOp::Newline => screen.newline(),
                    ScreenOp::CarriageReturn => screen.carriage_return(),
                    ScreenOp::Backspace => screen.backspace(),
                    ScreenOp::Tab => screen.tab(),
                }
            }
            screen.dirty = true;
        }
    }

    fn write_response(&self, data: &[u8]) {
        if let Ok(mut writer) = self.writer.lock() {
            let _ = writer.write_all(data);
            let _ = writer.flush();
        }
    }
}

impl Perform for VtPerformer {
    fn print(&mut self, ch: char) {
        // Filter control characters that shouldn't be displayed
        // (except printable characters)
        if ch.is_control() && ch != '\t' && ch != '\n' && ch != '\r' {
            return;
        }

        // Batch the operation instead of acquiring lock immediately
        self.pending_ops.push(ScreenOp::PutChar(ch));
    }

    fn execute(&mut self, byte: u8) {
        match byte {
            b'\n' | b'\r' | b'\x08' | b'\t' => {
                // Check if we're in sync_output mode
                // If not, apply immediately to prevent race condition with render
                let sync_output = self.screen.read().map(|s| s.sync_output).unwrap_or(false);

                if sync_output {
                    // During sync output, batch operations for efficiency
                    match byte {
                        b'\n' => self.pending_ops.push(ScreenOp::Newline),
                        b'\r' => self.pending_ops.push(ScreenOp::CarriageReturn),
                        b'\x08' => self.pending_ops.push(ScreenOp::Backspace),
                        b'\t' => self.pending_ops.push(ScreenOp::Tab),
                        _ => {}
                    }
                } else {
                    // Outside sync output, apply immediately to keep cursor position accurate
                    // First flush any pending ops
                    self.flush();
                    // Then apply this operation
                    // NOTE: Don't set dirty=true here! CR/LF/BS/TAB are cursor movement,
                    // not content changes. Setting dirty here causes render to show
                    // intermediate states between sync blocks (duplicate prompts bug).
                    if let Ok(mut screen) = self.screen.write() {
                        match byte {
                            b'\n' => screen.newline(),
                            b'\r' => screen.carriage_return(),
                            b'\x08' => screen.backspace(),
                            b'\t' => screen.tab(),
                            _ => {}
                        }
                        // dirty is NOT set - cursor position change without content change
                    }
                }
            }
            b'\x07' => {
                // Bell character - forward to parent terminal, and note it
                // so the panel asks for attention until it is shown focused.
                print!("\x07");
                let _ = std::io::stdout().flush();
                if let Ok(mut screen) = self.screen.write() {
                    screen.bell = true;
                }
            }
            _ => {}
        }
    }

    fn csi_dispatch(&mut self, params: &Params, intermediates: &[u8], _ignore: bool, c: char) {
        // Single lock acquisition for both flush and CSI dispatch (critical optimization)
        // This eliminates double lock acquisition that occurred on every CSI sequence
        if let Ok(mut screen) = self.screen.write() {
            // Inline flush: apply pending operations with the same lock
            if !self.pending_ops.is_empty() {
                for op in self.pending_ops.drain(..) {
                    match op {
                        ScreenOp::PutChar(ch) => screen.put_char(ch),
                        ScreenOp::Newline => screen.newline(),
                        ScreenOp::CarriageReturn => screen.carriage_return(),
                        ScreenOp::Backspace => screen.backspace(),
                        ScreenOp::Tab => screen.tab(),
                    }
                }
                screen.dirty = true;
            }

            // Handle private sequences (start with '?')
            if !intermediates.is_empty() && intermediates[0] == b'?' {
                if c == 'u' {
                    let flags = match screen.keyboard_protocol {
                        KeyboardProtocolMode::Legacy => 0,
                        KeyboardProtocolMode::CsiUCompat => 1,
                        KeyboardProtocolMode::ModifyOtherKeys2 => 0,
                    };
                    drop(screen);
                    self.write_response(format!("\x1b[?{}u", flags).as_bytes());
                    return;
                }
                handle_private_sequence(&mut screen, params, c);
                return;
            }

            if !intermediates.is_empty() && intermediates[0] == b'>' {
                if c == 'u' {
                    let flag = params
                        .iter()
                        .next()
                        .and_then(|p| p.first())
                        .copied()
                        .unwrap_or(0);
                    screen.keyboard_protocol = if flag == 1 {
                        KeyboardProtocolMode::CsiUCompat
                    } else {
                        KeyboardProtocolMode::Legacy
                    };
                    screen.dirty = true;
                    return;
                }
                if c == 'm' {
                    let option = params
                        .iter()
                        .next()
                        .and_then(|p| p.first())
                        .copied()
                        .unwrap_or(0);
                    let value = params
                        .iter()
                        .nth(1)
                        .and_then(|p| p.first())
                        .copied()
                        .unwrap_or(u16::MAX);
                    if option == 4 {
                        screen.keyboard_protocol = match value {
                            2 => KeyboardProtocolMode::ModifyOtherKeys2,
                            u16::MAX => KeyboardProtocolMode::Legacy,
                            0 => KeyboardProtocolMode::Legacy,
                            _ => screen.keyboard_protocol,
                        };
                    }
                    screen.dirty = true;
                    return;
                }
            }

            if !intermediates.is_empty() && intermediates[0] == b'<' && c == 'u' {
                screen.keyboard_protocol = KeyboardProtocolMode::Legacy;
                screen.dirty = true;
                return;
            }

            // Ignore other intermediate bytes
            if !intermediates.is_empty() {
                return;
            }
            // Try cursor movement commands first
            if handle_cursor_movement(&mut screen, params, c) {
                screen.dirty = true;
                return;
            }

            match c {
                'c' => {
                    drop(screen);
                    self.write_response(b"\x1b[?62c");
                    return;
                }
                'J' => {
                    // ED - Erase in Display
                    let param = params
                        .iter()
                        .next()
                        .and_then(|p| p.first())
                        .copied()
                        .unwrap_or(0);
                    let (row, col) = screen.cursor;
                    let empty_cell = Cell::blank(screen.current_style);

                    match param {
                        0 => {
                            // Clear from cursor to end of screen
                            let style = screen.current_style;
                            screen.blank_cells(row, col, usize::MAX, style);
                            // Clear all lines below
                            let buffer = screen.active_buffer_mut();
                            for r in (row + 1)..buffer.len() {
                                buffer[r].fill(empty_cell);
                            }
                            // Force cache invalidation to show cleared content immediately
                            screen.force_cache_invalidation = true;
                        }
                        1 => {
                            // Clear from start of screen to cursor
                            let style = screen.current_style;
                            // Clear all lines above
                            let buffer = screen.active_buffer_mut();
                            for r in 0..row.min(buffer.len()) {
                                buffer[r].fill(empty_cell);
                            }
                            // Clear current line up to and including cursor
                            screen.blank_cells(row, 0, col + 1, style);
                            // Force cache invalidation to show cleared content immediately
                            screen.force_cache_invalidation = true;
                        }
                        2 => {
                            // Clear entire screen and move cursor to (0,0)
                            let buffer = screen.active_buffer_mut();
                            for row in buffer.iter_mut() {
                                row.fill(empty_cell);
                            }
                            // Move cursor to home position (compatibility with old behavior)
                            screen.cursor = (0, 0);
                            // Force cache invalidation to show cleared screen immediately
                            screen.force_cache_invalidation = true;
                        }
                        3 => {
                            // Clear entire screen and scrollback
                            let is_alt = screen.use_alt_screen;
                            let buffer = screen.active_buffer_mut();
                            for row in buffer.iter_mut() {
                                row.fill(empty_cell);
                            }
                            // Clear scrollback only for main screen
                            if !is_alt {
                                screen.scrollback.clear();
                                screen.scrollback_wrapped.clear();
                            }
                            screen.cursor = (0, 0);
                            // Force cache invalidation to show cleared screen immediately
                            screen.force_cache_invalidation = true;
                        }
                        _ => {}
                    }
                }
                'K' => {
                    // EL - Erase in Line
                    let param = params
                        .iter()
                        .next()
                        .and_then(|p| p.first())
                        .copied()
                        .unwrap_or(0);
                    let (row, col) = screen.cursor;
                    let style = screen.current_style;

                    if row < screen.active_buffer().len() {
                        match param {
                            // From cursor to end of line
                            0 => screen.blank_cells(row, col, usize::MAX, style),
                            // From start of line to cursor (inclusive)
                            1 => screen.blank_cells(row, 0, col + 1, style),
                            // Entire line
                            2 => screen.blank_cells(row, 0, usize::MAX, style),
                            _ => {}
                        }
                        // Force cache invalidation to show erased content immediately
                        screen.force_cache_invalidation = true;
                    }
                }
                'P' => {
                    // DCH - Delete Character
                    let n = params
                        .iter()
                        .next()
                        .and_then(|p| p.first())
                        .copied()
                        .unwrap_or(1) as usize;
                    let (row, col) = screen.cursor;
                    let cols = screen.cols;
                    let style = screen.current_style;

                    if row < screen.active_buffer().len() {
                        let n = n.min(cols.saturating_sub(col));
                        // Cutting through a wide character removes both halves.
                        screen.split_wide_at(row, col, style);
                        screen.split_wide_at(row, col + n, style);
                        let buffer = screen.active_buffer_mut();
                        // Shift characters left from deleted position using copy_within (3-5x faster)
                        if col + n < cols {
                            buffer[row].copy_within(col + n..cols, col);
                        }
                        // Fill freed space with blanks
                        buffer[row][cols - n..cols].fill(Cell::blank(style));
                    }
                    // Force cache invalidation after character deletion
                    screen.force_cache_invalidation = true;
                }
                'X' => {
                    // ECH - Erase Character
                    let n = params
                        .iter()
                        .next()
                        .and_then(|p| p.first())
                        .copied()
                        .unwrap_or(1) as usize;
                    let (row, col) = screen.cursor;
                    let style = screen.current_style;
                    screen.blank_cells(row, col, col.saturating_add(n), style);
                    // Force cache invalidation after character erasure
                    screen.force_cache_invalidation = true;
                }
                '@' => {
                    // ICH - Insert Character (shift characters right)
                    let n = params
                        .iter()
                        .next()
                        .and_then(|p| p.first())
                        .copied()
                        .unwrap_or(1) as usize;
                    let (row, col) = screen.cursor;
                    let cols = screen.cols;
                    let style = screen.current_style;

                    if row < screen.active_buffer().len() {
                        let n = n.min(cols.saturating_sub(col));
                        // Inserting inside a wide character erases it, and a wide
                        // character pushed past the right edge goes entirely.
                        screen.split_wide_at(row, col, style);
                        screen.split_wide_at(row, cols - n, style);
                        let buffer = screen.active_buffer_mut();
                        // Shift characters right using copy_within (3-5x faster)
                        if col + n < cols {
                            buffer[row].copy_within(col..cols - n, col + n);
                        }
                        // Insert blanks at freed positions
                        buffer[row][col..col + n].fill(Cell::blank(style));
                    }
                    // Force cache invalidation after character insertion
                    screen.force_cache_invalidation = true;
                }
                'L' => {
                    // IL - Insert Lines (insert blank lines within scroll region)
                    let n = params
                        .iter()
                        .next()
                        .and_then(|p| p.first())
                        .copied()
                        .unwrap_or(1) as usize;
                    let row = screen.cursor.0;
                    let cols = screen.cols;
                    let bottom = screen.scroll_bottom;
                    let empty_cell = Cell::blank(screen.current_style);

                    // Only operate if cursor is within scroll region
                    if row <= bottom {
                        let effective_n = n.min(bottom - row + 1);
                        let buffer = screen.active_buffer_mut();

                        // Delete n lines from scroll_bottom
                        for _ in 0..effective_n {
                            if bottom < buffer.len() {
                                buffer.remove(bottom);
                            }
                        }
                        // Insert n blank lines at cursor position
                        for _ in 0..effective_n {
                            if row == 0 {
                                buffer.push_front(vec![empty_cell; cols]);
                            } else {
                                buffer.insert(row, vec![empty_cell; cols]);
                            }
                        }

                        // Mirror on wrapped flags
                        let wrapped = screen.active_wrapped_mut();
                        for _ in 0..effective_n {
                            if bottom < wrapped.len() {
                                wrapped.remove(bottom);
                            }
                        }
                        for _ in 0..effective_n {
                            if row == 0 {
                                wrapped.push_front(false);
                            } else {
                                wrapped.insert(row, false);
                            }
                        }
                    }
                    // Ensure buffer size invariant after IL operation
                    screen.ensure_buffer_size();
                    // Force cache invalidation after line insertion
                    screen.force_cache_invalidation = true;
                }
                'M' => {
                    // DL - Delete Lines (delete lines within scroll region)
                    let n = params
                        .iter()
                        .next()
                        .and_then(|p| p.first())
                        .copied()
                        .unwrap_or(1) as usize;
                    let row = screen.cursor.0;
                    let cols = screen.cols;
                    let bottom = screen.scroll_bottom;
                    let empty_cell = Cell::blank(screen.current_style);

                    // Only operate if cursor is within scroll region
                    if row <= bottom {
                        let effective_n = n.min(bottom - row + 1);
                        let buffer = screen.active_buffer_mut();

                        // Delete n lines at cursor position
                        for _ in 0..effective_n {
                            if row < buffer.len() {
                                if row == 0 {
                                    buffer.pop_front();
                                } else {
                                    buffer.remove(row);
                                }
                            }
                        }
                        // Insert n blank lines at scroll_bottom
                        for _ in 0..effective_n {
                            let insert_pos = bottom.min(buffer.len());
                            buffer.insert(insert_pos, vec![empty_cell; cols]);
                        }

                        // Mirror on wrapped flags
                        let wrapped = screen.active_wrapped_mut();
                        for _ in 0..effective_n {
                            if row < wrapped.len() {
                                if row == 0 {
                                    wrapped.pop_front();
                                } else {
                                    wrapped.remove(row);
                                }
                            }
                        }
                        for _ in 0..effective_n {
                            let insert_pos = bottom.min(wrapped.len());
                            wrapped.insert(insert_pos, false);
                        }
                    }
                    // Ensure buffer size invariant after DL operation
                    screen.ensure_buffer_size();
                    // Force cache invalidation after line deletion
                    screen.force_cache_invalidation = true;
                }
                'S' => {
                    // SU - Scroll Up (scroll within region)
                    let n = params
                        .iter()
                        .next()
                        .and_then(|p| p.first())
                        .copied()
                        .unwrap_or(1) as usize;
                    let cols = screen.cols;
                    let top = screen.scroll_top;
                    let bottom = screen.scroll_bottom;
                    let empty_cell = Cell::blank(screen.current_style);

                    let region_size = bottom.saturating_sub(top) + 1;
                    let effective_n = n.min(region_size);

                    // Full-screen scroll (use efficient VecDeque ops)
                    if top == 0 && bottom == screen.rows.saturating_sub(1) {
                        let buffer = screen.active_buffer_mut();
                        for _ in 0..effective_n {
                            if !buffer.is_empty() {
                                buffer.pop_front();
                            }
                            buffer.push_back(vec![empty_cell; cols]);
                        }
                        let wrapped = screen.active_wrapped_mut();
                        for _ in 0..effective_n {
                            if !wrapped.is_empty() {
                                wrapped.pop_front();
                            }
                            wrapped.push_back(false);
                        }
                    } else {
                        // Region scroll
                        let buffer = screen.active_buffer_mut();
                        for _ in 0..effective_n {
                            if top < buffer.len() {
                                buffer.remove(top);
                            }
                            let insert_pos = bottom.min(buffer.len());
                            buffer.insert(insert_pos, vec![empty_cell; cols]);
                        }
                        let wrapped = screen.active_wrapped_mut();
                        for _ in 0..effective_n {
                            if top < wrapped.len() {
                                wrapped.remove(top);
                            }
                            let insert_pos = bottom.min(wrapped.len());
                            wrapped.insert(insert_pos, false);
                        }
                    }
                    // Ensure buffer size invariant after SU operation
                    screen.ensure_buffer_size();
                    // Force cache invalidation after scroll up
                    screen.force_cache_invalidation = true;
                }
                'T' => {
                    // SD - Scroll Down (scroll within region)
                    let n = params
                        .iter()
                        .next()
                        .and_then(|p| p.first())
                        .copied()
                        .unwrap_or(1) as usize;
                    let cols = screen.cols;
                    let rows = screen.rows;
                    let top = screen.scroll_top;
                    let bottom = screen.scroll_bottom;
                    let empty_cell = Cell::blank(screen.current_style);

                    let region_size = bottom.saturating_sub(top) + 1;
                    let effective_n = n.min(region_size);

                    // Full-screen scroll (use efficient VecDeque ops)
                    if top == 0 && bottom == rows.saturating_sub(1) {
                        let buffer = screen.active_buffer_mut();
                        for _ in 0..effective_n {
                            if buffer.len() >= rows {
                                buffer.pop_back();
                            }
                            buffer.push_front(vec![empty_cell; cols]);
                        }
                        let wrapped = screen.active_wrapped_mut();
                        for _ in 0..effective_n {
                            if wrapped.len() >= rows {
                                wrapped.pop_back();
                            }
                            wrapped.push_front(false);
                        }
                    } else {
                        // Region scroll
                        let buffer = screen.active_buffer_mut();
                        for _ in 0..effective_n {
                            if bottom < buffer.len() {
                                buffer.remove(bottom);
                            }
                            buffer.insert(top, vec![empty_cell; cols]);
                        }
                        let wrapped = screen.active_wrapped_mut();
                        for _ in 0..effective_n {
                            if bottom < wrapped.len() {
                                wrapped.remove(bottom);
                            }
                            wrapped.insert(top, false);
                        }
                    }
                    // Ensure buffer size invariant after SD operation
                    screen.ensure_buffer_size();
                    // Force cache invalidation after scroll down
                    screen.force_cache_invalidation = true;
                }
                'm' => {
                    // SGR - set style (colors, bold, etc.)
                    handle_sgr(&mut screen, params);
                }
                's' => {
                    // Save cursor position
                    screen.save_cursor();
                }
                'u' => {
                    // Restore cursor position
                    screen.restore_cursor();
                }
                'r' => {
                    // DECSTBM - Set Top and Bottom Margins
                    let mut iter = params.iter();
                    let top = iter.next().and_then(|p| p.first()).copied().unwrap_or(1) as usize;
                    let bottom = iter
                        .next()
                        .and_then(|p| p.first())
                        .copied()
                        .map(|b| b as usize)
                        .unwrap_or(screen.rows);
                    screen.set_scroll_region(top, bottom);
                }
                'n' => {
                    let param = params
                        .iter()
                        .next()
                        .and_then(|p| p.first())
                        .copied()
                        .unwrap_or(0);
                    let reply = match param {
                        5 => Some(b"\x1b[0n".to_vec()),
                        6 => Some(
                            format!("\x1b[{};{}R", screen.cursor.0 + 1, screen.cursor.1 + 1)
                                .into_bytes(),
                        ),
                        _ => None,
                    };
                    drop(screen);
                    if let Some(reply) = reply {
                        self.write_response(&reply);
                    }
                    return;
                }
                'l' | 'h' => {
                    // Set/Reset Mode (ignore but don't break)
                }
                _ => {}
            }
            screen.dirty = true;
        }
    }

    fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
        // Apply characters printed before the sequence with the link state
        // that was current when they were printed (same inline flush as
        // csi_dispatch), then switch state for what follows.
        if let Ok(mut screen) = self.screen.write() {
            if !self.pending_ops.is_empty() {
                for op in self.pending_ops.drain(..) {
                    match op {
                        ScreenOp::PutChar(ch) => screen.put_char(ch),
                        ScreenOp::Newline => screen.newline(),
                        ScreenOp::CarriageReturn => screen.carriage_return(),
                        ScreenOp::Backspace => screen.backspace(),
                        ScreenOp::Tab => screen.tab(),
                    }
                }
                screen.dirty = true;
            }

            // OSC 0 / OSC 2: the child names itself (icon+title / title).
            // An empty title clears. Stored on the screen; the host app
            // polls it (the PTY reader thread runs this — it cannot emit
            // PanelEvents itself).
            if params
                .first()
                .is_some_and(|p| p.len() == 1 && (p[0] == b'0' || p[0] == b'2'))
            {
                let title: Option<&[u8]> = params.get(1).copied().filter(|t| !t.is_empty());
                screen.title = title.map(|t| String::from_utf8_lossy(t).into_owned());
                screen.dirty = true;
            }

            // OSC 8 ; params ; URI — an empty URI closes the open link.
            // params[1] (the `id=…` hint) is accepted but ignored: cells
            // reference the interned URI directly.
            if params.first().is_some_and(|p| p.len() == 1 && p[0] == b'8') {
                let uri: Option<&[u8]> = params.get(2).copied().filter(|uri| !uri.is_empty());
                match uri {
                    Some(uri) => {
                        let text = String::from_utf8_lossy(uri);
                        let id = screen.hyperlink_intern(&text);
                        screen.current_hyperlink = Some(id);
                    }
                    None => screen.current_hyperlink = None,
                }
                screen.dirty = true;
            }

            // OSC 7 / OSC 9;9: the shell reports its working directory
            // in-band. PowerShell's `Set-Location` leaves the process
            // directory untouched, so on Windows this report is the only
            // thing that follows it.
            if matches!(params.first(), Some(&b"7") | Some(&b"9")) {
                let local_host = std::env::var("COMPUTERNAME")
                    .or_else(|_| std::env::var("HOSTNAME"))
                    .unwrap_or_default();
                if let Some(cwd) = super::osc_cwd::parse_osc_cwd(params, &local_host) {
                    screen.reported_cwd = Some(cwd);
                }
            }
        }
    }

    fn esc_dispatch(&mut self, _intermediates: &[u8], _ignore: bool, byte: u8) {
        self.flush();
        if let Ok(mut screen) = self.screen.write() {
            match byte {
                b'D' => {
                    // IND - Index: move down, scroll at bottom margin
                    if screen.cursor.0 >= screen.scroll_bottom {
                        screen.scroll_up();
                    } else {
                        screen.cursor.0 += 1;
                    }
                }
                b'M' => {
                    // RI - Reverse Index: move up, scroll at top margin
                    if screen.cursor.0 <= screen.scroll_top {
                        screen.scroll_down_region();
                    } else {
                        screen.cursor.0 -= 1;
                    }
                }
                _ => {}
            }
            screen.dirty = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Result as IoResult;
    use vte::Parser;

    struct SharedCapture(Arc<Mutex<Vec<u8>>>);

    impl Write for SharedCapture {
        fn write(&mut self, buf: &[u8]) -> IoResult<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> IoResult<()> {
            Ok(())
        }
    }

    type PerformerHarness = (
        VtPerformer,
        Arc<Mutex<Vec<u8>>>,
        Arc<RwLock<TerminalScreen>>,
    );

    fn performer() -> PerformerHarness {
        let capture = Arc::new(Mutex::new(Vec::new()));
        let screen = Arc::new(RwLock::new(TerminalScreen::new(24, 80)));
        let performer = VtPerformer {
            writer: Arc::new(Mutex::new(
                Box::new(SharedCapture(Arc::clone(&capture))) as Box<dyn Write + Send>
            )),
            screen: Arc::clone(&screen),
            pending_ops: Vec::new(),
        };
        (performer, capture, screen)
    }

    fn feed(performer: &mut VtPerformer, bytes: &[u8]) {
        let mut parser = Parser::new();
        for byte in bytes {
            parser.advance(performer, *byte);
        }
    }

    fn row_text(screen: &Arc<RwLock<TerminalScreen>>, row: usize) -> String {
        let s = screen.read().unwrap();
        let mut text = String::new();
        for cell in &s.active_buffer()[row] {
            cell.push_text(&mut text);
        }
        text.trim_end().to_string()
    }

    #[test]
    fn backslashes_and_brackets_are_printed_verbatim() {
        // `\[` / `\]` are bash PS1 markup that readline consumes; they never
        // reach the terminal, so program output containing them (regexes,
        // LaTeX, escaped markdown) must not be mangled.
        let (mut performer, _capture, screen) = performer();
        feed(&mut performer, b"s/\\[a\\]//g \\\r\nnext");
        performer.flush();
        assert_eq!(row_text(&screen, 0), "s/\\[a\\]//g \\");
        assert_eq!(row_text(&screen, 1), "next");
    }

    #[test]
    fn erase_in_line_removes_both_halves_of_a_wide_char() {
        let (mut performer, _capture, screen) = performer();
        feed(&mut performer, "中文x\x1b[2G\x1b[K".as_bytes());
        assert_eq!(row_text(&screen, 0), "");
        feed(&mut performer, "\x1b[1;1H中文x\x1b[4G\x1b[1X".as_bytes());
        assert_eq!(row_text(&screen, 0), "中  x");
    }

    #[test]
    fn a_bell_is_noted_but_an_osc_ended_by_bel_is_not() {
        let (mut performer, _capture, screen) = performer();
        feed(&mut performer, b"\x1b]0;title\x07$ ");
        assert!(!screen.read().unwrap().bell);
        feed(&mut performer, b"\x07");
        assert!(screen.read().unwrap().bell);
    }

    #[test]
    fn osc_cwd_reports_are_recorded_and_print_nothing() {
        let (mut performer, _capture, screen) = performer();
        feed(&mut performer, b"\x1b]9;9;\"D:\\work\"\x1b\\$ ");
        performer.flush();
        assert_eq!(
            screen.read().unwrap().reported_cwd,
            Some(std::path::PathBuf::from(r"D:\work"))
        );
        assert_eq!(row_text(&screen, 0), "$");

        feed(&mut performer, b"\x1b]7;file:///tmp/x\x07");
        assert_eq!(
            screen.read().unwrap().reported_cwd,
            Some(std::path::PathBuf::from("/tmp/x"))
        );
    }

    #[test]
    fn keyboard_query_reply_is_emitted() {
        let (mut performer, capture, _screen) = performer();
        feed(&mut performer, b"\x1b[?u");
        assert_eq!(&*capture.lock().unwrap(), b"\x1b[?0u");
    }

    #[test]
    fn keyboard_modes_toggle_via_escape_sequences() {
        let (mut performer, _capture, screen) = performer();
        feed(&mut performer, b"\x1b[>1u");
        assert_eq!(
            screen.read().unwrap().keyboard_protocol,
            KeyboardProtocolMode::CsiUCompat
        );
        feed(&mut performer, b"\x1b[>4;2m");
        assert_eq!(
            screen.read().unwrap().keyboard_protocol,
            KeyboardProtocolMode::ModifyOtherKeys2
        );
        feed(&mut performer, b"\x1b[>4m");
        assert_eq!(
            screen.read().unwrap().keyboard_protocol,
            KeyboardProtocolMode::Legacy
        );
    }

    #[test]
    fn da_and_dsr_replies_use_current_screen_state() {
        let (mut performer, capture, screen) = performer();
        screen.write().unwrap().cursor = (1, 2);

        feed(&mut performer, b"\x1b[c");
        feed(&mut performer, b"\x1b[6n");

        assert_eq!(&*capture.lock().unwrap(), b"\x1b[?62c\x1b[2;3R");
    }

    fn row_links(screen: &Arc<RwLock<TerminalScreen>>, row: usize) -> Vec<Option<u32>> {
        let s = screen.read().unwrap();
        s.active_buffer()[row]
            .iter()
            .map(|cell| cell.link)
            .collect()
    }

    #[test]
    fn osc8_open_stamps_cells_and_close_clears() {
        let (mut performer, _capture, screen) = performer();
        // BEL-terminated open, then a BEL-terminated close.
        feed(
            &mut performer,
            b"\x1b]8;id=abc;file:///tmp/a.rs\x07link\x1b]8;;\x07done",
        );
        performer.flush();

        let s = screen.read().unwrap();
        assert_eq!(s.hyperlink_uri(0), Some("file:///tmp/a.rs"));
        let links = row_links(&screen, 0);
        // 'l','i','n','k' linked; 'done' is not.
        assert_eq!(links[0], Some(0));
        assert_eq!(links[3], Some(0));
        assert_eq!(links[4], None);
        assert_eq!(links[7], None);
        assert_eq!(row_text(&screen, 0), "linkdone");
    }

    #[test]
    fn osc8_accepts_st_terminator() {
        let (mut performer, _capture, screen) = performer();
        feed(
            &mut performer,
            "\x1b]8;;file:///tmp/b.rs\x1b\\x\x1b]8;;\x1b\\y".as_bytes(),
        );
        performer.flush();

        let s = screen.read().unwrap();
        assert_eq!(s.hyperlink_uri(0), Some("file:///tmp/b.rs"));
        assert_eq!(row_links(&screen, 0)[0], Some(0));
        assert_eq!(row_links(&screen, 0)[1], None);
    }

    #[test]
    fn osc8_reopen_without_close_switches_uri() {
        let (mut performer, _capture, screen) = performer();
        feed(
            &mut performer,
            b"\x1b]8;;file:///a.rs\x07aa\x1b]8;;file:///b.rs\x07bb",
        );
        performer.flush();

        let s = screen.read().unwrap();
        assert_eq!(s.hyperlink_uri(0), Some("file:///a.rs"));
        assert_eq!(s.hyperlink_uri(1), Some("file:///b.rs"));
        let links = row_links(&screen, 0);
        assert_eq!(links[0], Some(0)); // 'a'
        assert_eq!(links[1], Some(0));
        assert_eq!(links[2], Some(1)); // 'b'
        assert_eq!(links[3], Some(1));
    }

    #[test]
    fn osc8_deduplicates_identical_uris() {
        let (mut performer, _capture, screen) = performer();
        feed(
            &mut performer,
            b"\x1b]8;;file:///same.rs\x07a\x1b]8;;\x07 \x1b]8;;file:///same.rs\x07b",
        );
        performer.flush();
        assert_eq!(screen.read().unwrap().hyperlinks.len(), 1);
    }

    #[test]
    fn osc8_region_survives_newlines_and_wrap() {
        let (mut performer, _capture, screen) = performer();
        // One open link spanning a hard newline and an auto-wrap (the row is
        // filled to width 80).
        let long = "z".repeat(80);
        feed(
            &mut performer,
            format!("\x1b]8;;file:///multi.rs\x07first{long}\r\nsecond\x1b]8;;\x07").as_bytes(),
        );
        performer.flush();

        let s = screen.read().unwrap();
        assert_eq!(s.hyperlink_uri(0), Some("file:///multi.rs"));
        assert_eq!(s.hyperlinks.len(), 1);
        // Row 0: fully linked (soft-wrapped at width 80).
        assert!(row_links(&screen, 0).iter().all(|l| *l == Some(0)));
        // Row 1: the wrapped tail of the link (5 z's, cols 0-4).
        assert_eq!(row_links(&screen, 1)[0], Some(0));
        assert_eq!(row_links(&screen, 1)[4], Some(0));
        assert_eq!(row_links(&screen, 1)[5], None);
        // The hard newline moves to row 2: 'second' is still inside the
        // same link there.
        assert_eq!(row_links(&screen, 2)[0], Some(0));
        assert_eq!(row_links(&screen, 2)[5], Some(0));
    }

    #[test]
    fn osc0_and_osc2_titles_are_stored() {
        let (mut performer, _capture, screen) = performer();
        // OSC 0 with BEL, OSC 2 with ST — both must land.
        feed(&mut performer, b"\x1b]0;bel title\x07");
        feed(&mut performer, "\x1b]2;st title\x1b\\".as_bytes());
        performer.flush();
        assert_eq!(screen.read().unwrap().title.as_deref(), Some("st title"));
    }

    #[test]
    fn osc_titles_overwrite_and_empty_clears() {
        let (mut performer, _capture, screen) = performer();
        feed(&mut performer, b"\x1b]2;first\x07");
        feed(&mut performer, b"\x1b]0;second\x07");
        performer.flush();
        assert_eq!(screen.read().unwrap().title.as_deref(), Some("second"));

        feed(&mut performer, b"\x1b]2;\x07");
        performer.flush();
        assert_eq!(screen.read().unwrap().title, None, "an empty title clears");
    }
}
