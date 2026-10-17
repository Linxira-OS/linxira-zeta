//! Listening ports, parsed from the platform's own tool.
//!
//! The panel exists to answer one question while coding: what is holding that
//! port. Parsing is split from running so both formats are testable without a
//! network or a specific OS.

use std::any::Any;

use crossterm::event::{KeyCode, MouseEvent, MouseEventKind};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use termide_core::event::PanelEvent;
use termide_core::key_chord::KeyChord;
use termide_core::panel::{Panel, RenderContext};

/// One listening socket.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PortEntry {
    pub proto: String,
    pub local: String,
    pub port: u16,
    pub pid: Option<u32>,
    pub process: Option<String>,
}

/// Ask the platform tool for the listening sockets.
pub fn listen() -> Result<Vec<PortEntry>, String> {
    #[cfg(windows)]
    let (program, args) = ("netstat", ["-ano"].as_slice());
    #[cfg(not(windows))]
    let (program, args) = ("ss", ["-ltnp"].as_slice());
    let output = std::process::Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("cannot run {program}: {error}"))?;
    if !output.status.success() {
        return Err(format!("{program} exited {}", output.status));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(parse(&text))
}

/// Parse whichever tool's output this looks like.
pub fn parse(text: &str) -> Vec<PortEntry> {
    // `ss` also prints a `Local Address:Port` header; only netstat has the state word.
    if text.contains("LISTENING") {
        parse_netstat(text)
    } else {
        parse_ss(text)
    }
}

/// `ss -ltnp`: `LISTEN 0 4096 127.0.0.1:631 0.0.0.0:* users:(("cupsd",pid=1,fd=12))`
pub fn parse_ss(text: &str) -> Vec<PortEntry> {
    let mut entries = Vec::new();
    for line in text.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 4 || fields[0] != "LISTEN" {
            continue;
        }
        let local = fields[3];
        let Some(port) = port_of(local) else {
            continue;
        };
        let rest = fields[4..].join(" ");
        let pid = rest
            .split("pid=")
            .nth(1)
            .and_then(|tail| tail.split(|c: char| !c.is_ascii_digit()).next())
            .and_then(|digits| digits.parse().ok());
        let process = rest
            .split("((\"")
            .nth(1)
            .and_then(|tail| tail.split('"').next())
            .map(str::to_owned);
        entries.push(PortEntry {
            proto: "tcp".to_owned(),
            local: local.to_owned(),
            port,
            pid,
            process,
        });
    }
    entries
}

/// `netstat -ano`: `TCP 0.0.0.0:135 0.0.0.0:0 LISTENING 1234`
pub fn parse_netstat(text: &str) -> Vec<PortEntry> {
    let mut entries = Vec::new();
    for line in text.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 5 {
            continue;
        }
        let proto = fields[0].to_ascii_lowercase();
        if proto != "tcp" && proto != "tcpv6" && proto != "tcp6" {
            continue;
        }
        if !fields.contains(&"LISTENING") {
            continue;
        }
        let local = fields[1];
        let Some(port) = port_of(local) else {
            continue;
        };
        let pid = fields.last().and_then(|value| value.parse().ok());
        entries.push(PortEntry {
            proto,
            local: local.to_owned(),
            port,
            pid,
            process: None,
        });
    }
    entries
}

/// The port of `addr:port` (also `[::]:port` and `*:port`).
fn port_of(local: &str) -> Option<u16> {
    local.rsplit(':').next()?.parse().ok()
}

/// The ports as a panel: the list, the selection, and a rescan.
pub struct PortsPanel {
    entries: Vec<PortEntry>,
    selected: usize,
    scroll: usize,
}

impl PortsPanel {
    pub fn new() -> Self {
        Self {
            entries: listen().unwrap_or_default(),
            selected: 0,
            scroll: 0,
        }
    }

    /// Build from already-parsed output (tests and `ss` fixtures).
    pub fn from_entries(entries: Vec<PortEntry>) -> Self {
        Self {
            entries,
            selected: 0,
            scroll: 0,
        }
    }

    pub fn entries(&self) -> &[PortEntry] {
        &self.entries
    }

    fn move_by(&mut self, step: isize) {
        if self.entries.is_empty() {
            return;
        }
        let last = self.entries.len() - 1;
        self.selected = (self.selected as isize + step).clamp(0, last as isize) as usize;
    }

    fn label(&self, entry: &PortEntry) -> String {
        let pid = entry
            .pid
            .map(|pid| pid.to_string())
            .unwrap_or_else(|| "-".to_owned());
        let process = entry.process.as_deref().unwrap_or("-");
        format!(
            "{:>5}  {:<28}  {}  {}",
            entry.port, entry.local, pid, process
        )
    }
}

impl Default for PortsPanel {
    fn default() -> Self {
        Self::new()
    }
}

impl Panel for PortsPanel {
    fn name(&self) -> &'static str {
        "ports"
    }

    fn title(&self) -> String {
        format!("Ports ({})", self.entries.len())
    }

    fn render(&mut self, area: Rect, buf: &mut Buffer, ctx: &RenderContext) {
        buf.set_style(area, Style::default().bg(ctx.theme.bg).fg(ctx.theme.fg));
        let visible = area.height as usize;
        if visible == 0 {
            return;
        }
        if self.selected < self.scroll {
            self.scroll = self.selected;
        } else if self.selected >= self.scroll + visible {
            self.scroll = self.selected + 1 - visible;
        }
        for row in 0..visible {
            let index = self.scroll + row;
            let Some(entry) = self.entries.get(index) else {
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
            let label = self.label(entry);
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
            KeyCode::Char('r') => {
                self.entries = listen().unwrap_or_default();
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
            let index = self.scroll + (event.row - panel_area.y) as usize;
            if index < self.entries.len() {
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

    #[test]
    fn ss_lines_yield_port_pid_and_process() {
        let text = "State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n\
		            LISTEN 0 4096 127.0.0.1:631 0.0.0.0:* users:((\"cupsd\",pid=1234,fd=12))\n\
		            LISTEN 0 128 [::]:22 [::]:* users:((\"sshd\",pid=99,fd=3))\n\
		            ESTAB 0 0 10.0.0.1:5555 10.0.0.2:443\n";
        let entries = parse_ss(text);
        assert_eq!(entries.len(), 2, "only LISTEN rows");
        assert_eq!(entries[0].port, 631);
        assert_eq!(entries[0].pid, Some(1234));
        assert_eq!(entries[0].process.as_deref(), Some("cupsd"));
        assert_eq!(entries[1].port, 22);
        assert_eq!(entries[1].local, "[::]:22");
    }

    #[test]
    fn netstat_lines_yield_the_listening_ports() {
        let text = "  Proto  Local Address          Foreign Address        State           PID\n\
		            \x20 TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234\n\
		            \x20 TCP    127.0.0.1:30141        0.0.0.0:0              LISTENING       4321\n\
		            \x20 UDP    0.0.0.0:500            0.0.0.0:0              1234\n";
        let entries = parse_netstat(text);
        assert_eq!(entries.len(), 2, "UDP is not a listening tcp socket");
        assert_eq!(entries[0].port, 135);
        assert_eq!(entries[0].pid, Some(1234));
        assert_eq!(entries[1].port, 30141);
    }

    #[test]
    fn the_parser_picks_the_format_from_the_header() {
        let ss = "State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\nLISTEN 0 4096 0.0.0.0:80 0.0.0.0:* users:((\"nginx\",pid=7,fd=6))\n";
        let netstat = "  Proto  Local Address          Foreign Address        State           PID\n  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING       7\n";
        assert_eq!(parse(ss).len(), 1);
        assert_eq!(parse(netstat).len(), 1);
        assert_eq!(parse(ss)[0].process.as_deref(), Some("nginx"));
    }
}
