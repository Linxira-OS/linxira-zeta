// SPDX-License-Identifier: AGPL-3.0-only
//! The 看板 pane's model: the same `.zeta/board/` cards the GUI's 看板 page
//! and the web gateway read, plus the selection, the inline title editor and
//! the write-through moves.
//!
//! The parsing and the file format live in `termide_panel_ide::board` (the
//! IDE page's upgraded TODO panel), so this module only owns what a TUI page
//! adds: which card is selected, which card's title is being typed, and when
//! the directory was last re-read. Every mutation goes back through that
//! module, so a card moved here is the card the gateway returns next.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use termide_panel_ide::board::{self, Card, Column, LoadedBoard};

/// How often a visible 看板 pane re-reads the directory while idle, so a card
/// edited in another editor shows up without pressing `r`.
pub const RELOAD: Duration = Duration::from_secs(1);

/// The 看板 pane's state.
#[derive(Default)]
pub struct Board {
	root: Option<PathBuf>,
	board: LoadedBoard,
	selected: usize,
	/// The selected card's title being typed (`e`), with the card id.
	editing: Option<Edit>,
	status: Option<String>,
	last_load: Option<Instant>,
}

struct Edit {
	id: String,
	text: String,
}

impl Board {
	/// Point the pane at a workspace; a different root re-reads immediately.
	pub fn set_root(&mut self, root: PathBuf) {
		if self.root.as_ref() == Some(&root) {
			return;
		}
		self.root = Some(root);
		self.editing = None;
		self.reload();
	}

	/// Every card, in board order.
	pub fn cards(&self) -> &[Card] {
		&self.board.cards
	}

	/// The card the panel has selected, if any.
	pub fn selected_id(&self) -> Option<&str> {
		let index = *self.visible().get(self.selected)?;
		self.board.cards.get(index).map(|card| card.id.as_str())
	}

	/// The inline editor's buffer, when it is open.
	pub fn edit_buffer(&self) -> Option<&str> {
		self.editing.as_ref().map(|edit| edit.text.as_str())
	}

	/// The last write's outcome, drawn on the pane's bottom line.
	pub fn status(&self) -> Option<&str> {
		self.status.as_deref()
	}

	/// Re-read the directory, keeping the selection on the same card.
	pub fn reload(&mut self) {
		let Some(root) = self.root.clone() else {
			return;
		};
		let selected = self.selected_id().map(str::to_owned);
		self.board = board::load(&root);
		self.last_load = Some(Instant::now());
		if let Some(id) = selected {
			let visible = self.visible();
			if let Some(position) = visible
				.iter()
				.position(|index| self.board.cards[*index].id == id)
			{
				self.selected = position;
			}
		}
		self.clamp();
	}

	/// Re-read at most [`RELOAD`] apart while the pane is visible.
	pub fn poll(&mut self) {
		if self.last_load.is_none_or(|at| at.elapsed() >= RELOAD) {
			self.reload();
		}
	}

	/// Handle one key. Returns whether the pane consumed it.
	pub fn handle_key(&mut self, key: KeyEvent) -> bool {
		if key.modifiers.contains(KeyModifiers::CONTROL) || key.modifiers.contains(KeyModifiers::ALT)
		{
			return false;
		}
		if self.editing.is_some() {
			return self.handle_edit_key(key);
		}
		match key.code {
			KeyCode::Char('j') | KeyCode::Down => {
				self.move_by(1);
				true
			},
			KeyCode::Char('k') | KeyCode::Up => {
				self.move_by(-1);
				true
			},
			KeyCode::Char('h') | KeyCode::Left => {
				self.shift_column(false);
				true
			},
			KeyCode::Char('l') | KeyCode::Right | KeyCode::Char(' ') => {
				self.shift_column(true);
				true
			},
			KeyCode::Char('e') => {
				self.start_edit();
				true
			},
			KeyCode::Char('r') => {
				self.reload();
				self.status = Some("reloaded".to_owned());
				true
			},
			_ => false,
		}
	}

	/// Indices into `cards`, grouped by column in board order.
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

	fn selected_card(&self) -> Option<&Card> {
		let index = *self.visible().get(self.selected)?;
		self.board.cards.get(index)
	}

	/// Move the selected card one column left or right and write the file.
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
		let Some(root) = self.root.clone() else {
			return;
		};
		self.status = Some(match board::move_card(&root, &card.id, next) {
			Ok(_) => format!("{} → {}", card.title, next.label()),
			Err(error) => error.to_string(),
		});
		self.reload();
	}

	/// Open the title editor on the selected card.
	fn start_edit(&mut self) {
		let Some(card) = self.selected_card() else {
			return;
		};
		self.editing = Some(Edit { id: card.id.clone(), text: card.title.clone() });
	}

	/// Keys while the title editor is open: Enter writes, Esc cancels, text
	/// edits the buffer.
	fn handle_edit_key(&mut self, key: KeyEvent) -> bool {
		match key.code {
			KeyCode::Esc => {
				self.editing = None;
				self.status = None;
			},
			KeyCode::Enter => {
				if let Some(edit) = self.editing.take() {
					self.commit_edit(edit);
				}
			},
			KeyCode::Backspace => {
				if let Some(edit) = self.editing.as_mut() {
					edit.text.pop();
				}
			},
			KeyCode::Char(character) => {
				if let Some(edit) = self.editing.as_mut() {
					edit.text.push(character);
				}
			},
			_ => {},
		}
		true
	}

	fn commit_edit(&mut self, edit: Edit) {
		let Some(root) = self.root.clone() else {
			return;
		};
		let title = edit.text.split_whitespace().collect::<Vec<_>>().join(" ");
		if title.is_empty() {
			self.status = Some("a card needs a title".to_owned());
			return;
		}
		let result = board::read_card(&root, &edit.id).and_then(|mut card| {
			card.title = title;
			board::save_card(&root, &card).map(|()| card)
		});
		self.status = Some(match result {
			Ok(card) => format!("saved {}", card.id),
			Err(error) => error.to_string(),
		});
		self.reload();
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use termide_panel_ide::board::NewCard;

	fn workspace() -> tempfile::TempDir {
		let dir = tempfile::tempdir().expect("temp dir");
		board::create_card(dir.path(), NewCard::titled("First")).expect("first");
		board::create_card(dir.path(), NewCard::titled("Second")).expect("second");
		dir
	}

	fn key(code: KeyCode) -> KeyEvent {
		KeyEvent::new(code, KeyModifiers::NONE)
	}

	#[test]
	fn moving_a_card_writes_its_file() {
		let dir = workspace();
		let mut board_state = Board::default();
		board_state.set_root(dir.path().to_path_buf());
		assert_eq!(board_state.cards().len(), 2);
		assert!(board_state.handle_key(key(KeyCode::Char('l'))));
		let id = board_state.selected_id().expect("selected").to_owned();
		let card = board::read_card(dir.path(), &id).expect("card");
		assert_eq!(card.column, Column::Doing);
		assert!(board_state.status().is_some(), "the move is reported");
	}

	#[test]
	fn the_title_editor_writes_the_same_file() {
		let dir = workspace();
		let mut board_state = Board::default();
		board_state.set_root(dir.path().to_path_buf());
		let id = board_state.selected_id().expect("selected").to_owned();
		assert!(board_state.handle_key(key(KeyCode::Char('e'))));
		for character in " renamed".chars() {
			board_state.handle_key(key(KeyCode::Char(character)));
		}
		board_state.handle_key(key(KeyCode::Enter));
		let card = board::read_card(dir.path(), &id).expect("card");
		assert_eq!(card.title, "First renamed");
	}

	#[test]
	fn a_foreign_file_is_skipped_without_hiding_the_board() {
		let dir = workspace();
		std::fs::write(dir.path().join(".zeta/board/README.md"), "# notes\n").unwrap();
		let mut board_state = Board::default();
		board_state.set_root(dir.path().to_path_buf());
		assert_eq!(board_state.cards().len(), 2);
	}

	#[test]
	fn modified_keys_are_left_for_the_workbench() {
		let dir = workspace();
		let mut board_state = Board::default();
		board_state.set_root(dir.path().to_path_buf());
		assert!(!board_state.handle_key(KeyEvent::new(KeyCode::Char('l'), KeyModifiers::ALT)));
		let id = board_state.selected_id().expect("selected");
		assert_eq!(board::read_card(dir.path(), id).expect("card").column, Column::Todo);
	}
}
