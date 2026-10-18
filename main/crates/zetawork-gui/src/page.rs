// SPDX-License-Identifier: AGPL-3.0-only
//! The IDE page hosted in a desktop pane.
//!
//! The page itself lives in `termide-panel-ide` — the same `Panel` the TUI
//! mounts. This holder only owns what a pane needs and a terminal does not:
//! a `Buffer` per frame and the theme/config handles. The pattern is the one
//! `live.rs` already proves for the terminal pane: render into a ratatui
//! `Buffer`, hand the grid to the blitter.

use std::path::PathBuf;

use ratatui::{buffer::Buffer, layout::Rect};
use termide_core::{
	KeyChord,
	panel::{Panel, PanelConfig, RenderContext, ThemeColors},
};
use termide_panel_ide::IdePage;

/// Per-tab IDE pages, keyed by session tab id.
#[derive(Default)]
pub struct Pages {
	pages: std::collections::HashMap<String, IdePage>,
	config: PanelConfig,
	theme: ThemeColors,
}

impl Pages {
	/// Create the page for `tab` on first show.
	pub fn ensure(&mut self, tab: &str) -> &mut IdePage {
		self.pages.entry(tab.to_owned()).or_default()
	}

	/// Whether `tab` has a page.
	pub fn has(&self, tab: &str) -> bool {
		self.pages.contains_key(tab)
	}

	/// Open `path` in `tab`'s page, creating the page if needed.
	pub fn open(&mut self, tab: &str, path: PathBuf) {
		self.ensure(tab).open(path);
	}

	/// Render `tab`'s page into `buf`. Returns false when the tab has no page.
	pub fn render(&mut self, tab: &str, area: Rect, buf: &mut Buffer) -> bool {
		let Self { pages, config, theme } = self;
		let Some(page) = pages.get_mut(tab) else {
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
		page.render(area, buf, &ctx);
		true
	}

	/// Forward a key to `tab`'s page. The page's own events are returned so the
	/// pane can route them (open-file, redraw) through the app's event channel.
	pub fn key(&mut self, tab: &str, chord: KeyChord) -> Vec<termide_core::event::PanelEvent> {
		match self.pages.get_mut(tab) {
			Some(page) => page.handle_key(chord),
			None => Vec::new(),
		}
	}
}

/// Translate egui key events into the chords `termide_panel_ide` expects.
///
/// Only `Event::Key` (presses) produce chords: `Event::Text` carries the same
/// character again and would double every keystroke in the page.
pub fn chords_for_events(events: &[egui::Event]) -> Vec<KeyChord> {
	let mut chords = Vec::new();
	for event in events {
		let egui::Event::Key { key, pressed: true, modifiers, .. } = event else {
			continue;
		};
		let Some(code) = key_code(*key) else {
			continue;
		};
		let mut mods = crossterm::event::KeyModifiers::NONE;
		if modifiers.ctrl || modifiers.command {
			mods |= crossterm::event::KeyModifiers::CONTROL;
		}
		if modifiers.alt {
			mods |= crossterm::event::KeyModifiers::ALT;
		}
		if modifiers.shift {
			mods |= crossterm::event::KeyModifiers::SHIFT;
		}
		let event = crossterm::event::KeyEvent::new(code, mods);
		chords.push(KeyChord { raw: event, canonical: event });
	}
	chords
}

/// The key codes a page needs; anything else is left to the shell's hotkeys.
fn key_code(key: egui::Key) -> Option<crossterm::event::KeyCode> {
	use crossterm::event::KeyCode;
	use egui::Key;
	Some(match key {
		Key::Enter => KeyCode::Enter,
		Key::Tab => KeyCode::Tab,
		Key::Backspace => KeyCode::Backspace,
		Key::Escape => KeyCode::Esc,
		Key::Delete => KeyCode::Delete,
		Key::Insert => KeyCode::Insert,
		Key::ArrowUp => KeyCode::Up,
		Key::ArrowDown => KeyCode::Down,
		Key::ArrowLeft => KeyCode::Left,
		Key::ArrowRight => KeyCode::Right,
		Key::Home => KeyCode::Home,
		Key::End => KeyCode::End,
		Key::PageUp => KeyCode::PageUp,
		Key::PageDown => KeyCode::PageDown,
		Key::Space => KeyCode::Char(' '),
		Key::A => KeyCode::Char('a'),
		Key::B => KeyCode::Char('b'),
		Key::C => KeyCode::Char('c'),
		Key::D => KeyCode::Char('d'),
		Key::E => KeyCode::Char('e'),
		Key::F => KeyCode::Char('f'),
		Key::G => KeyCode::Char('g'),
		Key::H => KeyCode::Char('h'),
		Key::I => KeyCode::Char('i'),
		Key::J => KeyCode::Char('j'),
		Key::K => KeyCode::Char('k'),
		Key::L => KeyCode::Char('l'),
		Key::M => KeyCode::Char('m'),
		Key::N => KeyCode::Char('n'),
		Key::O => KeyCode::Char('o'),
		Key::P => KeyCode::Char('p'),
		Key::Q => KeyCode::Char('q'),
		Key::R => KeyCode::Char('r'),
		Key::S => KeyCode::Char('s'),
		Key::T => KeyCode::Char('t'),
		Key::U => KeyCode::Char('u'),
		Key::V => KeyCode::Char('v'),
		Key::W => KeyCode::Char('w'),
		Key::X => KeyCode::Char('x'),
		Key::Y => KeyCode::Char('y'),
		Key::Z => KeyCode::Char('z'),
		_ => return None,
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn ctrl_w_arrives_as_one_chord_and_text_does_not_double_typing() {
		let mut modifiers = egui::Modifiers::NONE;
		modifiers.ctrl = true;
		let events = vec![
			egui::Event::Key {
				key: egui::Key::W,
				physical_key: None,
				pressed: true,
				repeat: false,
				modifiers,
			},
			egui::Event::Text("w".to_owned()),
			egui::Event::Key {
				key: egui::Key::W,
				physical_key: None,
				pressed: false,
				repeat: false,
				modifiers,
			},
		];
		let chords = chords_for_events(&events);
		assert_eq!(chords.len(), 1, "a press is one chord; text and releases are skipped");
		assert_eq!(chords[0].raw.code, crossterm::event::KeyCode::Char('w'));
		assert!(
			chords[0]
				.raw
				.modifiers
				.contains(crossterm::event::KeyModifiers::CONTROL)
		);
	}

	#[test]
	fn a_page_renders_its_chrome_through_the_same_panel() {
		let mut pages = Pages::default();
		pages.open("tab-1", PathBuf::from("a.rs"));
		assert!(pages.has("tab-1"));
		assert!(!pages.has("tab-2"));

		let area = Rect::new(0, 0, 60, 20);
		let mut buf = Buffer::empty(area);
		assert!(pages.render("tab-1", area, &mut buf), "the page is hosted");
		let strip: String = (0..20).map(|x| buf[(x, 0)].symbol().to_string()).collect();
		assert!(strip.contains("a.rs"), "the tab strip is drawn: {strip:?}");

		let mut empty = Buffer::empty(area);
		assert!(!pages.render("tab-2", area, &mut empty), "an unknown tab draws nothing");
	}
}
