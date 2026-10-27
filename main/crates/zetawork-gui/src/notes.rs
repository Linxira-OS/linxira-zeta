// SPDX-License-Identifier: AGPL-3.0-only
//! 行注释: notes pinned to one line of a workspace's diff, kept per workspace.
//!
//! A note is the smallest useful thing to say about a diff — "this branch can
//! never be taken", "the borrow is unnecessary here" — and it is worth keeping
//! after the window closes, so it lives on disk next to the other workspace
//! state under `~/.zeta/workbench/diff-notes/<hash>.json`, one file per
//! workspace path. The hash is FNV-1a of the path, so two worktrees of the same
//! repository keep separate notes and neither depends on a database.
//!
//! Line numbers are the **new** side's (`+` side): that is the side a note is
//! usually about, and it is the side an agent can open.

use std::{
	fs, io,
	path::{Path, PathBuf},
};

use serde_json::{Value, json};

/// One note: a file, a line on the diff's new side, and the text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Note {
	/// Repository-relative path, without the `b/` diff prefix.
	pub file: String,
	/// 1-based line number on the new side.
	pub line: u32,
	pub text: String,
}

/// The notes of one workspace.
pub struct Notes {
	/// The file they came from (and go back to).
	pub path: PathBuf,
	pub items: Vec<Note>,
}

impl Notes {
	/// The file a workspace's notes live in: keyed by its absolute path, so a
	/// rename of the directory starts a fresh set rather than adopting another
	/// repository's notes.
	pub fn for_workspace(workspace: &Path) -> Self {
		let root = crate::settings::settings_path()
			.parent()
			.map(Path::to_path_buf)
			.unwrap_or_else(|| PathBuf::from("."));
		let key = fnv1a(workspace.to_string_lossy().as_bytes());
		Self::load(
			root
				.join("workbench")
				.join("diff-notes")
				.join(format!("{key:016x}.json")),
		)
	}

	pub fn load(path: PathBuf) -> Self {
		let items = fs::read_to_string(&path)
			.ok()
			.and_then(|text| serde_json::from_str::<Value>(&text).ok())
			.and_then(|value| value.as_array().cloned())
			.map(|rows| rows.iter().filter_map(note_of).collect())
			.unwrap_or_default();
		Self { path, items }
	}

	/// Write the file, creating its directory. Called on every change — a note
	/// that survives only until the next frame is not a note.
	pub fn save(&self) -> io::Result<()> {
		if let Some(dir) = self.path.parent() {
			fs::create_dir_all(dir)?;
		}
		let rows: Vec<Value> = self
			.items
			.iter()
			.map(|note| json!({ "file": note.file, "line": note.line, "text": note.text }))
			.collect();
		let text = serde_json::to_string_pretty(&Value::Array(rows)).map_err(io::Error::other)?;
		fs::write(&self.path, text)
	}

	/// Add or replace the note at `(file, line)`; an empty `text` removes it.
	pub fn set(&mut self, file: &str, line: u32, text: &str) {
		self
			.items
			.retain(|note| !(note.file == file && note.line == line));
		let text = text.trim();
		if !text.is_empty() {
			self
				.items
				.push(Note { file: file.to_owned(), line, text: text.to_owned() });
			self
				.items
				.sort_by(|left, right| left.file.cmp(&right.file).then(left.line.cmp(&right.line)));
		}
	}

	pub fn at(&self, file: &str, line: u32) -> Option<&Note> {
		self
			.items
			.iter()
			.find(|note| note.file == file && note.line == line)
	}
}

/// FNV-1a, 64 bit: tiny, stable across runs, and good enough to name a file.
fn fnv1a(bytes: &[u8]) -> u64 {
	let mut hash = 0xcbf2_9ce4_8422_2325_u64;
	for byte in bytes {
		hash ^= u64::from(*byte);
		hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
	}
	hash
}

fn note_of(value: &Value) -> Option<Note> {
	let file = value.get("file")?.as_str()?.to_owned();
	let line = value.get("line")?.as_u64()?;
	let text = value.get("text")?.as_str()?.to_owned();
	if file.is_empty() || text.is_empty() || line == 0 || line > u64::from(u32::MAX) {
		return None;
	}
	Some(Note { file, line: line as u32, text })
}

#[cfg(test)]
mod tests {
	use super::*;

	fn temp(name: &str) -> PathBuf {
		let dir =
			std::env::temp_dir().join(format!("zetawork-diff-notes-{}-{name}", std::process::id()));
		let _ = fs::remove_dir_all(&dir);
		fs::create_dir_all(&dir).expect("dir");
		dir.join("notes.json")
	}

	#[test]
	fn set_replaces_by_line_and_an_empty_text_removes() {
		let mut notes = Notes { path: temp("set"), items: Vec::new() };
		notes.set("src/lib.rs", 12, "this branch can never run");
		notes.set("src/lib.rs", 12, "the borrow is unnecessary");
		assert_eq!(notes.items.len(), 1);
		assert_eq!(
			notes.at("src/lib.rs", 12).map(|note| note.text.as_str()),
			Some("the borrow is unnecessary")
		);
		notes.set("src/lib.rs", 12, "   ");
		assert!(notes.items.is_empty());
	}

	#[test]
	fn notes_survive_a_write_and_a_read() {
		let path = temp("round-trip");
		let mut notes = Notes { path: path.clone(), items: Vec::new() };
		notes.set("src/b.rs", 7, "second");
		notes.set("src/a.rs", 3, "first");
		notes.save().expect("save");
		let loaded = Notes::load(path);
		assert_eq!(loaded.items, notes.items, "same notes, file order sorted");
		assert_eq!(loaded.items[0].file, "src/a.rs");
	}

	#[test]
	fn a_corrupt_file_reads_as_empty_instead_of_failing() {
		let path = temp("corrupt");
		fs::write(&path, "{ not json").expect("write");
		let notes = Notes::load(path);
		assert!(notes.items.is_empty());
	}

	#[test]
	fn rows_without_a_file_line_or_text_are_dropped() {
		let path = temp("partial");
		fs::write(
			&path,
			r#"[{"file":"a","line":1,"text":"ok"},{"file":"","line":2,"text":"x"},{"file":"b","line":0,"text":"y"},{"file":"c","line":3,"text":""}]"#,
		)
		.expect("write");
		let notes = Notes::load(path);
		assert_eq!(notes.items.len(), 1);
		assert_eq!(notes.items[0].file, "a");
	}

	#[test]
	fn two_workspaces_get_two_files_and_the_name_is_stable() {
		let one = Notes::for_workspace(Path::new("/repos/one"));
		let two = Notes::for_workspace(Path::new("/repos/two"));
		assert_ne!(one.path, two.path);
		assert_eq!(one.path, Notes::for_workspace(Path::new("/repos/one")).path);
	}
}
