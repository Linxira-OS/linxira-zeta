// SPDX-License-Identifier: AGPL-3.0-only
//! Lazy, read-only directory listing for the shell's file-tree pane.
//!
//! The tree opens one level at a time: [`FileTree::load`] reads the root
//! directory only, and [`FileTree::toggle`] reads the children of the node
//! being expanded the first time that node is expanded. Nothing here writes,
//! recurses on its own or descends a symlinked directory, so pointing the pane
//! at a large tree costs exactly one `read_dir` per open.
//!
//! A directory that exists but cannot be read is still listed — its children
//! stay empty and `loaded` is set, so the click is not retried forever — while
//! a root that is missing or is not a directory comes back as `root: None`
//! plus an `error` carrying the OS message.

use std::path::{Path, PathBuf};

/// The one entry name the tree hides: the repository's own bookkeeping.
const GIT_DIR_NAME: &str = ".git";

/// Most entries a single directory may contribute to the tree.
const MAX_ENTRIES: usize = 512;

/// One directory or file in the tree.
///
/// Directories are placeholders until they are expanded: `children` is empty
/// and `loaded` is `false` before the first [`FileTree::toggle`] reaches them.
#[derive(Clone, Debug, Default)]
pub struct DirNode {
	/// Last path component, as shown in the pane.
	pub name: String,
	/// Absolute or caller-relative path of the entry.
	pub path: PathBuf,
	/// True for directories, the only expandable nodes.
	pub is_dir: bool,
	/// True once the node is open in the pane.
	pub expanded: bool,
	/// True once `children` has been read from disk; files start `true`.
	pub loaded: bool,
	/// True when the directory held more entries than [`MAX_ENTRIES`].
	pub truncated: bool,
	/// Children, sorted directories-first then case-insensitively by name.
	pub children: Vec<DirNode>,
}

/// A lazily-read directory tree rooted at one path.
///
/// [`FileTree::load`] reads the root's own children; every deeper level is read
/// on demand, once, by [`FileTree::toggle`].
#[derive(Clone, Debug, Default)]
pub struct FileTree {
	/// The root node, `None` when `path` could not be listed.
	pub root: Option<DirNode>,
	/// Why `path` could not be listed, if it could not be.
	pub error: Option<String>,
	/// The path this tree was loaded from.
	pub path: PathBuf,
}

impl FileTree {
	/// List `path` itself, reading exactly one directory level.
	///
	/// The root comes back expanded and loaded; its children are entries, not
	/// subtrees, so a child directory still has empty `children` until it is
	/// toggled. A missing path, a file, or a directory that cannot be read
	/// yields `root: None` with `error` set, never a panic.
	pub fn load(path: &Path) -> Self {
		let mut tree = FileTree { root: None, error: None, path: path.to_path_buf() };

		match std::fs::metadata(path) {
			Ok(meta) if meta.is_dir() => {},
			Ok(_) => {
				tree.error = Some(format!("{}: not a directory", path.display()));
				return tree;
			},
			Err(err) => {
				tree.error = Some(format!("{}: {}", path.display(), err));
				return tree;
			},
		}
		let (children, truncated) = match read_children(path) {
			Ok(read) => read,
			Err(err) => {
				tree.error = Some(format!("{}: {}", path.display(), err));
				return tree;
			},
		};
		tree.root = Some(DirNode {
			name: dir_name(path),
			path: path.to_path_buf(),
			is_dir: true,
			expanded: true,
			loaded: true,
			truncated,
			children,
		});
		tree
	}

	/// Expand or collapse the node at an index path, reading its children the
	/// first time a directory is expanded.
	///
	/// `rel` is a path of child indices from the root, so `&[]` is the root and
	/// `&[2, 0]` the first child of the third child. An index that does not
	/// resolve, a file, or an empty tree is ignored: this never panics.
	pub fn toggle(&mut self, rel: &[usize]) {
		let Some(root) = self.root.as_mut() else {
			return;
		};
		let Some(node) = walk_mut(root, rel) else {
			return;
		};
		if !node.is_dir {
			return;
		}

		if !node.loaded {
			if let Ok((children, truncated)) = read_children(&node.path) {
				node.children = children;
				node.truncated = truncated;
			}
			// Set even when the read failed, so a directory the OS refuses to
			// list is not retried on every click.
			node.loaded = true;
		}
		node.expanded = !node.expanded;
	}

	/// The node at an index path from the root, `None` when it does not resolve.
	pub fn node(&self, rel: &[usize]) -> Option<&DirNode> {
		walk(self.root.as_ref()?, rel)
	}

	/// The root node, `None` when the path could not be listed.
	pub fn root(&self) -> Option<&DirNode> {
		self.root.as_ref()
	}
}

/// Resolve an index path against a node, `Some(node)` when it lands.
fn walk<'a>(node: &'a DirNode, rel: &[usize]) -> Option<&'a DirNode> {
	match rel.split_first() {
		None => Some(node),
		Some((&index, rest)) => walk(node.children.get(index)?, rest),
	}
}

/// [`walk`], but handing out a mutable node for [`FileTree::toggle`].
fn walk_mut<'a>(node: &'a mut DirNode, rel: &[usize]) -> Option<&'a mut DirNode> {
	match rel.split_first() {
		None => Some(node),
		Some((&index, rest)) => walk_mut(node.children.get_mut(index)?, rest),
	}
}

/// Read one directory level: `Ok((children, truncated))`, or the OS error text.
///
/// Entry kinds come from `lstat`-style metadata, so a symlink is listed as a
/// file and never descended into. The result is capped at [`MAX_ENTRIES`], with
/// `truncated` telling the pane that there was more.
fn read_children(dir: &Path) -> Result<(Vec<DirNode>, bool), String> {
	let entries = std::fs::read_dir(dir).map_err(|err| err.to_string())?;
	let mut children = Vec::new();
	let mut truncated = false;

	for entry in entries {
		let entry = match entry {
			Ok(entry) => entry,
			Err(_) => continue,
		};
		let name = entry.file_name().to_string_lossy().into_owned();
		if name == GIT_DIR_NAME {
			continue;
		}
		let is_dir = match entry.file_type() {
			Ok(kind) => kind.is_dir(),
			Err(_) => false,
		};
		children.push(DirNode {
			name,
			path: entry.path(),
			is_dir,
			expanded: false,
			loaded: !is_dir,
			truncated: false,
			children: Vec::new(),
		});
		if children.len() >= MAX_ENTRIES {
			truncated = true;
			break;
		}
	}

	children.sort_by(|a, b| {
		b.is_dir
			.cmp(&a.is_dir)
			.then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
	});
	Ok((children, truncated))
}

/// The display name of a directory path: its last component, or the whole path
/// when it has none (a drive root, `..`, for instance).
fn dir_name(path: &Path) -> String {
	match path.file_name() {
		Some(name) => name.to_string_lossy().into_owned(),
		None => path.to_string_lossy().into_owned(),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn scratch(tag: &str) -> PathBuf {
		std::env::temp_dir().join(format!("zetawork-gui-{tag}-{}", std::process::id()))
	}

	#[test]
	fn load_reads_one_level_and_toggles_lazily() {
		let base = scratch("tree");
		let _ = std::fs::remove_dir_all(&base);
		std::fs::create_dir_all(base.join("sub")).unwrap();
		std::fs::create_dir_all(base.join(".git")).unwrap();
		std::fs::write(base.join("a.txt"), b"a").unwrap();
		std::fs::write(base.join("sub").join("b.txt"), b"b").unwrap();
		std::fs::write(base.join(".git").join("HEAD"), b"ref: refs/heads/main").unwrap();

		let mut tree = FileTree::load(&base);
		assert!(tree.error.is_none(), "readable temp dir must load: {:?}", tree.error);
		let root = tree.root().expect("root node");
		assert!(root.loaded && root.expanded);

		// One level only, `.git` hidden, directories first.
		assert!(root.children.iter().all(|child| child.name != ".git"));
		assert_eq!(root.children.len(), 2);
		assert!(root.children[0].is_dir);
		assert_eq!(root.children[0].name, "sub");
		assert_eq!(root.children[1].name, "a.txt");
		assert!(root.children[0].children.is_empty() && !root.children[0].loaded);
		assert!(!root.children[0].truncated);
		assert!(root.children[1].loaded && !root.children[1].is_dir);

		// Toggling a file, a child of a file or an out-of-range index is a
		// no-op, not a panic.
		tree.toggle(&[1]);
		tree.toggle(&[1, 0]);
		tree.toggle(&[99]);
		let root = tree.root().expect("root node");
		assert!(!root.children[1].expanded && root.children[1].children.is_empty());

		// The first expand reads the subtree, the second only flips `expanded`.
		tree.toggle(&[0]);
		let sub = tree.node(&[0]).expect("sub node");
		assert!(sub.expanded && sub.loaded);
		assert_eq!(sub.children.len(), 1);
		assert_eq!(sub.children[0].name, "b.txt");
		assert!(!sub.children[0].is_dir);
		tree.toggle(&[0]);
		let sub = tree.node(&[0]).expect("sub node");
		assert!(!sub.expanded);
		assert_eq!(sub.children.len(), 1);
		assert_eq!(tree.node(&[1]).expect("file node").name, "a.txt");
		assert!(tree.node(&[]).is_some());
		assert!(tree.node(&[0, 0, 0]).is_none());

		std::fs::remove_dir_all(&base).unwrap();
	}

	#[test]
	fn missing_path_reports_error() {
		let base = scratch("missing");
		let _ = std::fs::remove_dir_all(&base);
		let mut tree = FileTree::load(&base);
		assert!(tree.root.is_none() && tree.error.is_some());
		assert_eq!(tree.path, base);

		// An empty tree tolerates toggles.
		tree.toggle(&[]);
		tree.toggle(&[0]);
		assert!(tree.node(&[0]).is_none());

		let file = scratch("file");
		let _ = std::fs::remove_dir_all(&file);
		std::fs::write(&file, b"not a dir").unwrap();
		let tree = FileTree::load(&file);
		assert!(tree.root.is_none() && tree.error.is_some());
		std::fs::remove_file(&file).unwrap();
	}
}
