// SPDX-License-Identifier: AGPL-3.0-only
//! The `git` rail page: branch, working-tree status and recent commits for the
//! active workspace.
//!
//! Everything here is read through the `git` CLI with
//! [`std::process::Command`] — no library and no repository parsing of our
//! own. The porcelain parser ([`parse_status`]) is pure so the page's whole
//! contract is testable from fixtures; [`GitView::load`] only adds the process
//! calls and degrades to a named state (`not a repository`, `git not found`,
//! or git's own first error line) instead of propagating an error.
//!
//! The status list is capped for display while the counters remain exact —
//! "3 files changed" is more useful than 300 lines of renames.

use std::path::Path;
use std::process::{Command, Stdio};

/// Recent commits shown on the page.
pub const COMMIT_LIMIT: usize = 8;
/// Changed paths listed individually; the counters still count every one.
pub const FILE_LIMIT: usize = 60;

/// What `HEAD` points at.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Head {
	/// The checked-out branch.
	Branch(String),
	/// Detached HEAD; the short hash when it can be resolved.
	Detached(Option<String>),
	/// A repository with no commits yet, on this branch.
	NoCommits(String),
}

/// One `git status --porcelain=v1` line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileStatus {
	/// The raw two-character `XY` code (`M `, ` M`, `MM`, `??`, …).
	pub code: String,
	pub path: String,
	/// Index (staged) changes.
	pub staged: bool,
	/// Working-tree (unstaged) changes.
	pub unstaged: bool,
	pub untracked: bool,
}

/// The parsed porcelain output.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Status {
	pub head: Head,
	/// Bounded by [`FILE_LIMIT`]; the counters below count every line.
	pub files: Vec<FileStatus>,
	pub staged: usize,
	pub unstaged: usize,
	pub untracked: usize,
	/// Number of changed paths in the working tree.
	pub total: usize,
	/// Whether [`Status::files`] was cut at [`FILE_LIMIT`].
	pub truncated: bool,
}

/// One `git log` line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Commit {
	pub hash: String,
	pub subject: String,
}

/// Why the page has (or lacks) data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum State {
	Ready(Status),
	NotRepository,
	GitMissing,
	Error(String),
}

/// The page state owned by the workspace.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GitView {
	/// `None` until the page is first opened.
	pub state: Option<State>,
	pub commits: Vec<Commit>,
}

impl GitView {
	/// Read `dir` through git. Never panics or returns an error: each failure
	/// maps to a state the renderer shows verbatim.
	pub fn load(dir: &Path) -> Self {
		let status =
			match run(dir, &["status", "--porcelain=v1", "--branch", "--untracked-files=normal"]) {
				Ok(output) => output,
				Err(error) => return missing_or(error),
			};
		if !status.status.success() {
			return Self { state: Some(failure(&status.stderr)), commits: Vec::new() };
		}
		let mut parsed = parse_status(&String::from_utf8_lossy(&status.stdout));
		if matches!(parsed.head, Head::Detached(None)) {
			if let Ok(output) = run(dir, &["rev-parse", "--short", "HEAD"]) {
				if output.status.success() {
					let hash = String::from_utf8_lossy(&output.stdout).trim().to_string();
					if !hash.is_empty() {
						parsed.head = Head::Detached(Some(hash));
					}
				}
			}
		}
		Self { state: Some(State::Ready(parsed)), commits: read_commits(dir) }
	}
}

/// Parse `git status --porcelain=v1 --branch` output.
///
/// The first `##` line is the branch header; every other non-empty line is an
/// `XY path` record. `R`/`C` renames keep git's `old -> new` text as the path —
/// that is what the user needs to see, and it needs no extra `-z` parsing.
pub fn parse_status(text: &str) -> Status {
	let mut head = Head::Branch(String::new());
	let mut files = Vec::new();
	let (mut staged, mut unstaged, mut untracked, mut total) = (0, 0, 0, 0);
	for line in text.lines() {
		if let Some(rest) = line.strip_prefix("## ") {
			head = parse_head(rest);
			continue;
		}
		if line.len() < 3 {
			continue;
		}
		let mut chars = line.chars();
		let x = chars.next().unwrap_or(' ');
		let y = chars.next().unwrap_or(' ');
		if x == '!' && y == '!' {
			continue;
		}
		let path = line.get(3..).unwrap_or("").to_string();
		let is_untracked = x == '?' && y == '?';
		let file_staged = !is_untracked && x != ' ';
		let file_unstaged = !is_untracked && y != ' ';
		if is_untracked {
			untracked += 1;
		} else {
			staged += usize::from(file_staged);
			unstaged += usize::from(file_unstaged);
		}
		total += 1;
		if files.len() < FILE_LIMIT {
			files.push(FileStatus {
				code: format!("{x}{y}"),
				path,
				staged: file_staged,
				unstaged: file_unstaged,
				untracked: is_untracked,
			});
		}
	}
	Status { head, files, staged, unstaged, untracked, total, truncated: total > FILE_LIMIT }
}

/// The branch header after `## `.
fn parse_head(rest: &str) -> Head {
	let rest = rest.trim();
	if let Some(branch) = rest.strip_prefix("No commits yet on ") {
		return Head::NoCommits(branch.trim().to_string());
	}
	if let Some(branch) = rest.strip_prefix("Initial commit on ") {
		return Head::NoCommits(branch.trim().to_string());
	}
	if rest.starts_with("HEAD (no branch)") || rest == "HEAD" {
		return Head::Detached(None);
	}
	let name = rest.split("...").next().unwrap_or(rest);
	let name = name.split(" [").next().unwrap_or(name).trim();
	Head::Branch(if name.is_empty() {
		"(unknown)".to_string()
	} else {
		name.to_string()
	})
}

fn read_commits(dir: &Path) -> Vec<Commit> {
	let limit = COMMIT_LIMIT.to_string();
	let Ok(output) = run(dir, &["log", "-n", &limit, "--pretty=format:%h%x09%s"]) else {
		return Vec::new();
	};
	if !output.status.success() {
		// A repository with no commits has no log; that is not an error.
		return Vec::new();
	}
	String::from_utf8_lossy(&output.stdout)
		.lines()
		.filter_map(|line| line.split_once('\t'))
		.map(|(hash, subject)| Commit { hash: hash.to_string(), subject: subject.to_string() })
		.collect()
}

fn missing_or(error: std::io::Error) -> GitView {
	let state = if error.kind() == std::io::ErrorKind::NotFound {
		State::GitMissing
	} else {
		State::Error(error.to_string())
	};
	GitView { state: Some(state), commits: Vec::new() }
}

fn failure(stderr: &[u8]) -> State {
	let text = String::from_utf8_lossy(stderr);
	let line = text
		.lines()
		.map(str::trim)
		.find(|line| !line.is_empty())
		.unwrap_or("");
	if line.to_lowercase().contains("not a git repository") {
		State::NotRepository
	} else if line.is_empty() {
		State::Error("git exited with an error".to_string())
	} else {
		State::Error(line.to_string())
	}
}

/// `git -C <dir> <args>` with piped output and no console window on Windows.
fn run(dir: &Path, args: &[&str]) -> std::io::Result<std::process::Output> {
	let mut command = Command::new("git");
	command
		.arg("-C")
		.arg(dir)
		.args(args)
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped());
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt as _;
		command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
	}
	command.output()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_clean_tree_has_a_branch_and_no_files() {
		let status = parse_status("## main...origin/main\n");
		assert_eq!(status.head, Head::Branch("main".into()));
		assert_eq!((status.staged, status.unstaged, status.untracked), (0, 0, 0));
		assert!(status.files.is_empty());
		assert!(!status.truncated);
	}

	#[test]
	fn staged_and_unstaged_changes_are_counted_per_file() {
		let status = parse_status("## main\nM  staged.rs\n M unstaged.rs\nMM both.rs\n");
		assert_eq!(status.total, 3);
		assert_eq!(status.staged, 2, "M_ and MM are staged");
		assert_eq!(status.unstaged, 2, "_M and MM are unstaged");
		assert_eq!(status.untracked, 0);
		assert_eq!(status.files[0].code, "M ");
		assert!(status.files[0].staged && !status.files[0].unstaged);
		assert_eq!(status.files[1].path, "unstaged.rs");
		assert!(status.files[2].staged && status.files[2].unstaged);
	}

	#[test]
	fn untracked_files_are_their_own_bucket() {
		let status = parse_status("## main\n?? new.txt\n?? dir/other.txt\n");
		assert_eq!(status.untracked, 2);
		assert_eq!(status.staged, 0);
		assert_eq!(status.unstaged, 0);
		assert!(status.files.iter().all(|file| file.untracked));
	}

	#[test]
	fn a_detached_head_is_recognised() {
		let status = parse_status("## HEAD (no branch)\nM  changed.rs\n");
		assert_eq!(status.head, Head::Detached(None));
		assert_eq!(status.staged, 1);
		assert_eq!(status.files[0].path, "changed.rs");
	}

	#[test]
	fn a_repository_without_commits_names_its_branch() {
		let status = parse_status("## No commits yet on main\n?? first.txt\n");
		assert_eq!(status.head, Head::NoCommits("main".into()));
		assert_eq!(status.untracked, 1);
	}

	#[test]
	fn rename_and_upstream_headers_parse_without_extra_state() {
		let status =
			parse_status("## feature/x...origin/feature/x [ahead 2, behind 1]\nR  old.rs -> new.rs\n");
		assert_eq!(status.head, Head::Branch("feature/x".into()));
		assert_eq!(status.files[0].path, "old.rs -> new.rs");
		assert!(status.files[0].staged);
	}

	#[test]
	fn the_file_list_is_capped_while_the_counters_stay_exact() {
		let mut text = String::from("## main\n");
		for index in 0..FILE_LIMIT + 5 {
			text.push_str(&format!("?? f{index}.txt\n"));
		}
		let status = parse_status(&text);
		assert_eq!(status.files.len(), FILE_LIMIT);
		assert_eq!(status.untracked, FILE_LIMIT + 5);
		assert!(status.truncated);
	}
}
