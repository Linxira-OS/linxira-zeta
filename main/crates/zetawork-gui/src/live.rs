//! Live terminal sessions: one PTY per terminal session tab.
//!
//! The GUI used to draw a seeded transcript — a faithful *replica* of a
//! workbench with nothing behind it. This module is the other half: a real
//! shell on a PTY (`termide_panel_terminal::Terminal`), rendered through the
//! same `Panel` implementation the TUI runs, so the grid in the GUI is the
//! grid a terminal would show.
//!
//! The signals the shell needs come from the terminal itself, never from a
//! guess:
//!
//! * **busy** — [`LiveSessions::pid`] feeds [`crate::lifecycle::pane_is_busy`],
//!   which asks whether the shell has live children (the same rule as
//!   `zeta-main`'s `busy.rs`);
//! * **output** — [`LiveSessions::poll`] reports `has_pending_output` so the
//!   frame only requests a repaint when the screen actually changed;
//! * **ended** — `is_alive` flips off when the child exits, which is the one
//!   honest "session ended" signal this side owns;
//! * **title** — the child's OSC 0/2 title, for pane naming.
//!
//! Input forwarding is not wired yet: the GUI has no focused-pane keyboard
//! path, and inventing one here would be a second input model. The PTY is
//! writable through [`LiveSessions::send_text`] the moment that path lands.

use std::collections::BTreeMap;
use std::path::PathBuf;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use termide_core::panel::{Panel, PanelConfig, RenderContext, ThemeColors};
use termide_panel_terminal::Terminal;

/// One spawned pane: the PTY and the geometry it was last sized to.
struct Live {
	term: Terminal,
	cols: u16,
	rows: u16,
	title: Option<String>,
	ended: bool,
}

/// Something a terminal did since the last poll.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
	/// The screen changed; a hidden window needs no repaint for this.
	Output { tab: String },
	/// The child exited and the pane is now a dead grid.
	Ended { tab: String },
	/// The child changed its OSC 0/2 title.
	Titled { tab: String, title: String },
}

/// Every live terminal, keyed by **session tab id** (a tab keeps its terminal
/// when the user switches away, which is what makes a background agent keep
/// running).
#[derive(Default)]
pub struct LiveSessions {
	tabs: BTreeMap<String, Live>,
	config: PanelConfig,
	theme: ThemeColors,
}

impl LiveSessions {
	pub fn contains(&self, tab: &str) -> bool {
		self.tabs.contains_key(tab)
	}

	/// The spawned shell's pid, when this tab has a live terminal.
	pub fn pid(&self, tab: &str) -> Option<u32> {
		self.tabs.get(tab)?.term.shell_pid()
	}

	/// Spawn the PTY for `tab` when it has none, and resize it when the grid
	/// changed. `false` means the spawn failed (no shell, no PTY) — the caller
	/// keeps its placeholder and says so.
	pub fn ensure(&mut self, tab: &str, cols: u16, rows: u16, cwd: Option<PathBuf>) -> bool {
		if let Some(live) = self.tabs.get_mut(tab) {
			if live.cols != cols || live.rows != rows {
				let _ = live.term.resize(rows, cols);
				live.cols = cols;
				live.rows = rows;
			}
			return true;
		}
		match Terminal::new_with_cwd(rows, cols, cwd) {
			Ok(term) => {
				self
					.tabs
					.insert(tab.to_owned(), Live { term, cols, rows, title: None, ended: false });
				true
			},
			Err(_) => false,
		}
	}

	/// Render the terminal into `buf` at `area` with the TUI's own panel code.
	pub fn render(&mut self, tab: &str, area: Rect, buf: &mut Buffer) -> bool {
		let Self { tabs, config, theme } = self;
		let Some(live) = tabs.get_mut(tab) else {
			return false;
		};
		let ctx = RenderContext {
			theme,
			config,
			is_focused: true,
			panel_index: 0,
			terminal_width: area.width,
			terminal_height: area.height,
			border_right_x: None,
			border_bottom_y: None,
		};
		live.term.render(area, buf, &ctx);
		true
	}

	/// Type into the pane (paste path; the keyboard path is not wired yet).
	pub fn send_text(&mut self, tab: &str, text: &str) {
		if let Some(live) = self.tabs.get_mut(tab) {
			let _ = live.term.paste_text(text);
		}
	}

	/// Forget a closed tab's terminal. Dropping the `Terminal` closes the PTY,
	/// which is what ends the child — the same lifetime the TUI has.
	pub fn close(&mut self, tab: &str) {
		self.tabs.remove(tab);
	}

	/// Poll every terminal once: output, death and title changes.
	pub fn poll(&mut self) -> Vec<Event> {
		let mut events = Vec::new();
		for (tab, live) in self.tabs.iter_mut() {
			if live.term.has_pending_output() {
				events.push(Event::Output { tab: tab.clone() });
			}
			// `is_alive` is the reader thread's EOF verdict, which ConPTY never
			// delivers on Windows; `try_wait` asks the child itself and is the
			// platform-independent answer.
			let exited = live.term.try_wait().is_some();
			if !live.ended && (exited || !live.term.is_alive()) {
				live.ended = true;
				events.push(Event::Ended { tab: tab.clone() });
			}
			let title = live.term.osc_title();
			if title != live.title {
				live.title = title.clone();
				if let Some(title) = title {
					events.push(Event::Titled { tab: tab.clone(), title });
				}
			}
		}
		events
	}
}

impl LiveSessions {
	/// Write raw bytes to a tab's PTY (see [`bytes_for_events`]). No-op when
	/// the tab has no terminal.
	pub fn send_bytes(&mut self, tab: &str, bytes: &[u8]) {
		if let Some(live) = self.tabs.get_mut(tab) {
			let _ = live.term.send_bytes(bytes);
		}
	}
}

/// The bytes a frame's egui events would type into a terminal.
///
/// Printable input arrives as `Event::Text`; keys the PTY cares about (Enter,
/// Backspace, arrows, Ctrl+letter, …) arrive as `Event::Key`. Plain letters are
/// **not** mapped from `Key`, so a keystroke is never sent twice.
pub fn bytes_for_events(events: &[egui::Event]) -> Vec<u8> {
	let mut out = Vec::new();
	for event in events {
		match event {
			egui::Event::Text(text) => out.extend_from_slice(text.as_bytes()),
			egui::Event::Key { key, pressed: true, modifiers, .. } => {
				if let Some(bytes) = key_bytes(*key, *modifiers) {
					out.extend_from_slice(&bytes);
				}
			},
			_ => {},
		}
	}
	out
}

fn key_bytes(key: egui::Key, modifiers: egui::Modifiers) -> Option<Vec<u8>> {
	let fixed: &[u8] = match key {
		egui::Key::Enter => b"\r",
		egui::Key::Backspace => b"\x7f",
		egui::Key::Tab => b"\t",
		egui::Key::Escape => b"\x1b",
		egui::Key::ArrowUp => b"\x1b[A",
		egui::Key::ArrowDown => b"\x1b[B",
		egui::Key::ArrowRight => b"\x1b[C",
		egui::Key::ArrowLeft => b"\x1b[D",
		egui::Key::Home => b"\x1b[H",
		egui::Key::End => b"\x1b[F",
		egui::Key::PageUp => b"\x1b[5~",
		egui::Key::PageDown => b"\x1b[6~",
		egui::Key::Delete => b"\x1b[3~",
		_ => {
			// Ctrl+letter is the only modifier chord the PTY protocol encodes
			// as a single byte (0x01..0x1a). Everything else is left to Text.
			if modifiers.ctrl && !modifiers.alt {
				let name = key.name().as_bytes();
				if name.len() == 1 && name[0].is_ascii_uppercase() {
					return Some(vec![name[0] & 0x1f]);
				}
			}
			return None;
		},
	};
	Some(fixed.to_vec())
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A shell one-liner that prints `$1` and exits.
	fn print_command(text: &str) -> String {
		if cfg!(windows) {
			format!("cmd /c echo {text}")
		} else {
			format!("sh -c 'printf %s {text}; sleep 0.05'")
		}
	}

	#[test]
	fn a_spawned_terminal_has_a_pid_renders_its_output_and_reports_exit() {
		let mut live = LiveSessions::default();
		// Spawn through the test seam: `new_with_cwd` would start an interactive
		// shell, which never exits.
		let term = Terminal::new_with_command(4, 40, &print_command("hi")).expect("spawn a command");
		live
			.tabs
			.insert("t".to_owned(), Live { term, cols: 40, rows: 4, title: None, ended: false });
		assert!(live.pid("t").is_some(), "a spawned PTY knows its shell pid");

		// Pump until the child wrote something (bounded: a slow CI box, not a hang).
		let mut saw_output = false;
		let mut ended = false;
		for _ in 0..400 {
			for event in live.poll() {
				match event {
					Event::Output { .. } => saw_output = true,
					Event::Ended { .. } => ended = true,
					Event::Titled { .. } => {},
				}
			}
			if saw_output && ended {
				break;
			}
			std::thread::sleep(std::time::Duration::from_millis(10));
		}
		assert!(saw_output, "the child's output reached the screen");
		assert!(ended, "the child's exit reached the poll");

		let area = Rect::new(0, 0, 40, 4);
		let mut buf = Buffer::empty(area);
		assert!(live.render("t", area, &mut buf), "a live terminal renders");
		let text: String = (0..4)
			.flat_map(|row| (0..40).map(move |col| (col, row)))
			.map(|(col, row)| buf[(col, row)].symbol().to_owned())
			.collect();
		assert!(text.contains("hi"), "the rendered grid carries the child's text: {text:?}");
	}

	#[test]
	fn keys_map_to_the_bytes_a_terminal_expects() {
		let key = |key: egui::Key, modifiers: egui::Modifiers| egui::Event::Key {
			key,
			physical_key: None,
			pressed: true,
			repeat: false,
			modifiers,
		};
		let text = egui::Event::Text("ls".to_owned());
		assert_eq!(bytes_for_events(&[text, key(egui::Key::Enter, egui::Modifiers::NONE)]), b"ls\r");
		assert_eq!(bytes_for_events(&[key(egui::Key::ArrowUp, egui::Modifiers::NONE)]), b"\x1b[A");
		let ctrl_c = egui::Modifiers { ctrl: true, command: true, ..Default::default() };
		assert_eq!(bytes_for_events(&[key(egui::Key::C, ctrl_c)]), vec![0x03]);
		// A plain letter key is not mapped: Text already carried it.
		assert!(bytes_for_events(&[key(egui::Key::A, egui::Modifiers::NONE)]).is_empty());
	}

	#[test]
	fn closing_a_tab_drops_its_terminal() {
		let mut live = LiveSessions::default();
		let term = Terminal::new_with_command(2, 20, &print_command("x")).expect("spawn");
		live
			.tabs
			.insert("t".to_owned(), Live { term, cols: 20, rows: 2, title: None, ended: false });
		assert!(live.contains("t"));
		live.close("t");
		assert!(!live.contains("t"));
		assert_eq!(live.pid("t"), None);
	}
}
