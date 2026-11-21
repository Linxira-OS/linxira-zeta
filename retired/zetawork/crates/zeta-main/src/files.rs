// SPDX-License-Identifier: AGPL-3.0-only
//! The `files` rail page: a lazy tree over the active workspace directory.
//!
//! The page reads one directory level at a time. Expanding a directory
//! appends its children right below it, collapsing removes exactly the
//! descendants that expansion added, and the selected row is a flat index into
//! [`FileTree::rows`] — navigation is therefore ordinary up/down movement over
//! a depth-first list, with `←`/`→` walking the tree shape.
//!
//! Nothing is cached across reloads and nothing is written: the tree is a
//! read-only view. A directory that cannot be read leaves the rest of the tree
//! usable and records [`FileTree::error`] for the renderer; a missing or empty
//! workspace renders an empty tree instead of failing.

use std::path::{Path, PathBuf};

/// Most children ingested from one directory. A node_modules-sized directory
/// is cut here; [`FileTree::truncated`] tells the renderer to say so.
pub const MAX_DIR_ENTRIES: usize = 200;
/// Most rows the tree holds in total, however deep the expansion.
pub const MAX_ROWS: usize = 2_000;

/// One visible tree row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
	pub path: PathBuf,
	pub name: String,
	pub depth: usize,
	pub is_dir: bool,
	pub expanded: bool,
}

/// What activating the selected row did.
#[derive(Debug, PartialEq, Eq)]
pub enum Activate {
	/// A file: hand its path to the workbench's editor open flow.
	Open(PathBuf),
	/// A directory expanded or collapsed; the redraw shows the new shape.
	Changed,
	/// Nothing selected — an empty or unreadable tree.
	None,
}

/// The page state. Owned by the workspace, rebuilt by [`FileTree::reload`].
pub struct FileTree {
	root: PathBuf,
	rows: Vec<Row>,
	selected: usize,
	error: Option<String>,
	truncated: bool,
	loaded: bool,
}

impl FileTree {
	/// A page for `root`; nothing is read until [`Self::reload`].
	pub fn new(root: PathBuf) -> Self {
		Self { root, rows: Vec::new(), selected: 0, error: None, truncated: false, loaded: false }
	}

	pub fn root(&self) -> &Path {
		&self.root
	}

	pub fn rows(&self) -> &[Row] {
		&self.rows
	}

	pub fn selected(&self) -> usize {
		self.selected
	}

	pub fn error(&self) -> Option<&str> {
		self.error.as_deref()
	}

	/// Whether at least one directory was cut at [`MAX_DIR_ENTRIES`] (or the
	/// row budget ran out).
	pub fn truncated(&self) -> bool {
		self.truncated
	}

	/// Re-read the root's immediate children. Collapsed state and selection
	/// are discarded — a reload is the `r` key's "show me the disk again".
	pub fn reload(&mut self) {
		self.rows.clear();
		self.selected = 0;
		self.error = None;
		self.truncated = false;
		self.loaded = true;
		match read_children(&self.root) {
			Ok((children, truncated)) => {
				self.truncated = truncated;
				self.push_children(0, children);
			},
			Err(error) => self.error = Some(format!("{}: {error}", self.root.display())),
		}
	}

	/// Ensure the page holds a tree for the current root.
	pub fn ensure_loaded(&mut self) {
		if !self.loaded {
			self.reload();
		}
	}

	/// Move the selection one row down.
	pub fn next(&mut self) {
		if !self.rows.is_empty() {
			self.selected = (self.selected + 1).min(self.rows.len() - 1);
		}
	}

	/// Move the selection one row up.
	pub fn previous(&mut self) {
		self.selected = self.selected.saturating_sub(1);
	}

	/// `→`: expand a collapsed directory, or step into an expanded one's
	/// first child. A file has no right-hand action (Enter opens it).
	pub fn right(&mut self) {
		let Some(row) = self.rows.get(self.selected) else {
			return;
		};
		if !row.is_dir {
			return;
		}
		if row.expanded {
			if self
				.rows
				.get(self.selected + 1)
				.is_some_and(|next| next.depth > row.depth)
			{
				self.selected += 1;
			}
		} else {
			self.toggle(self.selected);
		}
	}

	/// `←`: collapse an expanded directory, otherwise select the parent.
	pub fn left(&mut self) {
		let Some(row) = self.rows.get(self.selected) else {
			return;
		};
		if row.is_dir && row.expanded {
			self.toggle(self.selected);
			return;
		}
		if row.depth == 0 {
			return;
		}
		if let Some(parent) = (0..self.selected)
			.rev()
			.find(|&index| self.rows[index].depth + 1 == row.depth)
		{
			self.selected = parent;
		}
	}

	/// Enter: toggle a directory, or hand a file to the caller.
	pub fn activate(&mut self) -> Activate {
		let Some(row) = self.rows.get(self.selected).cloned() else {
			return Activate::None;
		};
		if row.is_dir {
			self.toggle(self.selected);
			Activate::Changed
		} else {
			Activate::Open(row.path)
		}
	}

	/// Flip one directory row and add/remove exactly its descendants.
	fn toggle(&mut self, index: usize) {
		let Some(row) = self.rows.get(index) else {
			return;
		};
		if !row.is_dir {
			return;
		}
		if row.expanded {
			let depth = row.depth;
			let mut end = index + 1;
			while end < self.rows.len() && self.rows[end].depth > depth {
				end += 1;
			}
			self.rows.drain(index + 1..end);
			self.rows[index].expanded = false;
			self.selected = self.selected.min(self.rows.len().saturating_sub(1));
			return;
		}
		let path = row.path.clone();
		match read_children(&path) {
			Ok((children, truncated)) => {
				self.truncated |= truncated;
				self.rows[index].expanded = true;
				self.push_children(index + 1, children);
			},
			Err(error) => {
				self.error = Some(format!("{}: {error}", path.display()));
			},
		}
	}

	/// Insert children at `at` (directly after their parent) at its depth + 1.
	fn push_children(&mut self, at: usize, children: Vec<Child>) {
		let depth = at
			.checked_sub(1)
			.and_then(|parent| self.rows.get(parent))
			.map(|row| row.depth + 1)
			.unwrap_or(0);
		let mut inserted = Vec::new();
		for (path, name, is_dir) in children {
			if self.rows.len() + inserted.len() >= MAX_ROWS {
				self.truncated = true;
				break;
			}
			inserted.push(Row { path, name, depth, is_dir, expanded: false });
		}
		self.rows.splice(at..at, inserted);
	}
}

/// One directory entry as the tree stores it: path, display name, is-dir.
type Child = (PathBuf, String, bool);

/// One directory's entries: `(path, name, is_dir)`, directories first then
/// names case-insensitively. The flag reports entries cut by the cap.
fn read_children(dir: &Path) -> std::io::Result<(Vec<Child>, bool)> {
	let reader = std::fs::read_dir(dir)?;
	let mut entries: Vec<(PathBuf, String, bool)> = Vec::new();
	let mut truncated = false;
	for entry in reader {
		let entry = match entry {
			Ok(entry) => entry,
			// An entry that vanished mid-read is the filesystem's business;
			// the rest of the listing is still good.
			Err(_) => continue,
		};
		if entries.len() >= MAX_DIR_ENTRIES {
			truncated = true;
			break;
		}
		let path = entry.path();
		let name = entry.file_name().to_string_lossy().into_owned();
		// `file_type` does not follow symlinks, so a linked directory shows as
		// a file rather than letting expansion walk in circles.
		let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
		entries.push((path, name, is_dir));
	}
	entries.sort_by(|a, b| {
		b.2.cmp(&a.2)
			.then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase()))
	});
	Ok((entries, truncated))
}

#[cfg(test)]
mod tests {
	use super::*;

	fn tree(dir: &Path) -> FileTree {
		let mut tree = FileTree::new(dir.to_path_buf());
		tree.reload();
		tree
	}

	fn names(tree: &FileTree) -> Vec<String> {
		tree.rows().iter().map(|row| row.name.clone()).collect()
	}

	#[test]
	fn directories_come_first_and_expand_lazily() {
		let dir = tempfile::tempdir().expect("temp dir");
		std::fs::create_dir(dir.path().join("sub")).expect("mkdir");
		std::fs::write(dir.path().join("sub").join("inner.txt"), "x").expect("write");
		std::fs::write(dir.path().join("a.txt"), "a").expect("write");
		std::fs::write(dir.path().join("B.txt"), "b").expect("write");

		let mut tree = tree(dir.path());
		assert_eq!(names(&tree), ["sub", "a.txt", "B.txt"], "dirs first, then case-insensitive");
		assert_eq!(tree.rows()[0].depth, 0);
		assert!(!tree.rows()[0].expanded, "a directory starts collapsed — children are lazy");

		// Expand with `right` / Enter.
		tree.right();
		assert!(tree.rows()[0].expanded);
		assert_eq!(names(&tree), ["sub", "inner.txt", "a.txt", "B.txt"]);
		assert_eq!(tree.rows()[1].depth, 1);

		// `right` again steps into the child.
		tree.right();
		assert_eq!(tree.selected(), 1);
		// `left` from a child selects the parent; `left` again collapses it.
		tree.left();
		assert_eq!(tree.selected(), 0);
		tree.left();
		assert!(!tree.rows()[0].expanded);
		assert_eq!(names(&tree), ["sub", "a.txt", "B.txt"]);

		// Down/up movement is clamped to the list.
		tree.next();
		tree.next();
		tree.next();
		assert_eq!(tree.selected(), 2);
		tree.previous();
		assert_eq!(tree.selected(), 1);

		tree.previous();
		assert_eq!(tree.selected(), 0);
		assert_eq!(tree.activate(), Activate::Changed, "Enter on a directory toggles");
		assert!(tree.rows()[0].expanded);
	}

	#[test]
	fn enter_on_a_file_returns_its_path() {
		let dir = tempfile::tempdir().expect("temp dir");
		std::fs::write(dir.path().join("one.txt"), "1").expect("write");
		let mut tree = tree(dir.path());
		assert_eq!(tree.activate(), Activate::Open(dir.path().join("one.txt")));
	}

	#[test]
	fn an_empty_or_missing_workspace_is_not_an_error() {
		let dir = tempfile::tempdir().expect("temp dir");
		let empty = tree(dir.path());
		assert!(empty.rows().is_empty());
		assert!(empty.error().is_none(), "an empty directory is a valid workspace");

		let missing = tree(&dir.path().join("does-not-exist"));
		assert!(missing.rows().is_empty());
		assert!(missing.error().is_some(), "an unreadable root says why it is empty");
	}

	#[test]
	fn a_huge_directory_is_capped_and_reported() {
		let dir = tempfile::tempdir().expect("temp dir");
		for index in 0..=MAX_DIR_ENTRIES {
			std::fs::write(dir.path().join(format!("f{index:03}.txt")), "x").expect("write");
		}
		let tree = tree(dir.path());
		assert_eq!(tree.rows().len(), MAX_DIR_ENTRIES);
		assert!(tree.truncated(), "the view can say entries were cut");
	}
}
