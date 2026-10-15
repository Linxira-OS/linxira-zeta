//! Read-only git introspection for the shell's status strip: which branch the
//! worktree is on, how far it drifted from its upstream, what is dirty and what
//! landed lately. Every answer is a real, read-only `git` invocation through
//! [`std::process::Command`] — never a shell, never a write — and every failure
//! degrades to an empty [`GitStatus`] whose `error` says what went wrong, so a
//! pane can paint a placeholder instead of panicking.
//!
//! Captured output is normalised by stripping `\r`, so the parsers below are
//! platform-independent; porcelain `-z` (NUL-separated, with an extra path
//! field for renames) is parsed by hand.

#[cfg(windows)]
use std::os::windows::process::CommandExt as _;
use std::{
	path::Path,
	process::{Command, Stdio},
	time::Instant,
};

/// `CREATE_NO_WINDOW`, so spawning `git` never flashes a console.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// One path in the worktree, as reported by `git status --porcelain=v1`.
#[derive(Clone, Debug, Default)]
pub struct GitFile {
	/// Repository-relative path; for a rename this is the destination, since
	/// porcelain's `-z` stream lists the new path first.
	pub path: String,
	/// Index status char (`X` of `XY`), or `?` for untracked entries.
	pub status: char,
	/// True for `??` entries, which live in [`GitStatus::untracked`].
	pub untracked: bool,
	/// Lines added by this path, `0` for binary files.
	pub insertions: u32,
	/// Lines removed by this path, `0` for binary files.
	pub deletions: u32,
}

/// One commit of the log tail.
#[derive(Clone, Debug, Default)]
pub struct GitCommit {
	/// Abbreviated hash (`%h`).
	pub hash: String,
	/// First line of the commit message (`%s`).
	pub subject: String,
	/// Decorations (`%D`) split on `, `, e.g. `HEAD -> main`, `tag: v1`.
	pub refs: Vec<String>,
	/// True when the commit has more than one parent (`%p`).
	pub merge: bool,
}

/// One snapshot of a worktree's git state, taken by [`read_status`].
#[derive(Clone, Debug, Default)]
pub struct GitStatus {
	/// Current branch, `""` when the path is not a repository.
	pub branch: String,
	/// Tracking branch, e.g. `origin/main`, `None` when there is none.
	pub upstream: Option<String>,
	/// Commits the branch has that upstream lacks.
	pub ahead: u32,
	/// Commits upstream has that the branch lacks.
	pub behind: u32,
	/// Tracked changes, in porcelain order.
	pub changed: Vec<GitFile>,
	/// `??` entries, in porcelain order.
	pub untracked: Vec<GitFile>,
	/// Total insertions across [`Self::changed`].
	pub insertions: u32,
	/// Total deletions across [`Self::changed`].
	pub deletions: u32,
	/// Newest first, at most `limit` entries.
	pub commits: Vec<GitCommit>,
	/// `Some(..)` means the snapshot failed: the fields above are empty and
	/// this carries the failing command and its message.
	pub error: Option<String>,
	/// Wall-clock cost of the whole snapshot, in milliseconds.
	pub elapsed_ms: f64,
}

/// Snapshot the repository containing `path`, reading at most `limit` commits.
///
/// `git rev-parse --abbrev-ref HEAD` decides whether `path` is usable at all;
/// when it fails the result is error-only, which is also what an empty
/// repository (no `HEAD` yet) or a path that does not exist produces.
pub fn read_status(path: &Path, limit: usize) -> GitStatus {
	let started = Instant::now();
	let mut status = GitStatus::default();

	let branch = match run_git(path, &["rev-parse", "--abbrev-ref", "HEAD"]) {
		Ok(branch) => branch,
		Err(err) => {
			status.error = Some(err);
			status.elapsed_ms = elapsed_ms(started);
			return status;
		},
	};
	status.branch = branch.trim().to_string();

	let upstream = ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"];
	if let Ok(out) = run_git(path, &upstream) {
		let name = out.trim();
		status.upstream = if name.is_empty() {
			None
		} else {
			Some(name.to_string())
		};
	}
	if status.upstream.is_some() {
		let counts = ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"];
		if let Ok(out) = run_git(path, &counts) {
			let mut nums = out.split_whitespace();
			status.ahead = nums.next().and_then(|n| n.parse().ok()).unwrap_or(0);
			status.behind = nums.next().and_then(|n| n.parse().ok()).unwrap_or(0);
		}
	}

	if let Ok(out) = run_git(path, &["status", "--porcelain=v1", "-z"]) {
		(status.changed, status.untracked) = parse_porcelain(&out);
	}
	if let Ok(out) = run_git(path, &["diff", "--numstat", "HEAD", "--"]) {
		apply_numstat(&out, &mut status.changed);
	}
	for file in &status.changed {
		status.insertions += file.insertions;
		status.deletions += file.deletions;
	}

	let n = limit.to_string();
	let log = ["log", "-n", n.as_str(), "--pretty=format:%h%x09%s%x09%D%x09%p"];
	if let Ok(out) = run_git(path, &log) {
		status.commits = parse_log(&out);
	}

	status.elapsed_ms = elapsed_ms(started);
	status
}

/// Run `git -C <path> <args>…` and return its stdout, or the failure text.
///
/// stdin is closed and both pipes are captured; on Windows the child gets
/// [`CREATE_NO_WINDOW`]. Carriage returns are stripped from stdout so the
/// parsers above never have to care about the platform.
fn run_git(path: &Path, args: &[&str]) -> Result<String, String> {
	let mut cmd = Command::new("git");
	cmd.arg("-C").arg(path).args(args);
	cmd.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped());
	#[cfg(windows)]
	cmd.creation_flags(CREATE_NO_WINDOW);

	let output = cmd
		.output()
		.map_err(|err| format!("git {}: {}", args.join(" "), err))?;
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		let detail = stderr.trim();
		let detail = if detail.is_empty() {
			"command failed"
		} else {
			detail
		};
		return Err(format!("git {}: {}", args.join(" "), detail));
	}
	Ok(String::from_utf8_lossy(&output.stdout).replace('\r', ""))
}

/// Parse a `git status --porcelain=v1 -z` stream into (tracked, untracked).
///
/// Each NUL-separated entry is `XY<space>path`, and the status char is `X`
/// unless `X` is blank, so ` M` is a worktree edit and `M ` a staged one.
/// Rename and copy entries carry a second path field (the source) right after
/// the destination; it has to be consumed here, or the next record would be
/// read as if it were a path.
fn parse_porcelain(text: &str) -> (Vec<GitFile>, Vec<GitFile>) {
	let mut changed = Vec::new();
	let mut untracked = Vec::new();
	let mut entries = text.split('\0');

	while let Some(entry) = entries.next() {
		if entry.len() < 3 {
			continue;
		}
		let x = entry.as_bytes()[0] as char;
		let y = entry.as_bytes()[1] as char;
		let path = entry.get(3..).unwrap_or("");
		if path.is_empty() {
			continue;
		}
		if matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C') {
			entries.next();
		}

		let file = GitFile {
			path: path.to_string(),
			status: if x == ' ' { y } else { x },
			untracked: x == '?' && y == '?',
			insertions: 0,
			deletions: 0,
		};
		if file.untracked {
			untracked.push(file);
		} else {
			changed.push(file);
		}
	}

	(changed, untracked)
}

/// Copy `git diff --numstat HEAD --` counts onto the porcelain entries.
///
/// Binary paths report `-` for both counts and stay `0/0`, as do paths the
/// diff never mentions (untracked files, submodule bumps).
fn apply_numstat(text: &str, changed: &mut [GitFile]) {
	for line in text.lines() {
		let mut fields = line.splitn(3, '\t');
		let Some(ins) = fields.next() else { continue };
		let Some(del) = fields.next() else { continue };
		let Some(path) = fields.next() else { continue };
		if path.is_empty() {
			continue;
		}

		let insertions = ins.parse::<u32>().unwrap_or(0);
		let deletions = del.parse::<u32>().unwrap_or(0);
		let destination = rename_destination(path);
		for file in changed.iter_mut() {
			if file.path == path || file.path == destination {
				file.insertions = insertions;
				file.deletions = deletions;
				break;
			}
		}
	}
}

/// The destination path of a `--numstat` rename record — `old => new`,
/// `dir/{old => new}/file`, `old => ` — so the record can join with what
/// porcelain reported. Non-rename paths come back unchanged.
fn rename_destination(raw: &str) -> String {
	if let Some(open) = raw.find('{') {
		if let Some(offset) = raw[open..].find('}') {
			let close = open + offset;
			let inner = &raw[open + 1..close];
			let new = inner.rsplit("=> ").next().unwrap_or(inner).trim();
			return format!("{}{}{}", &raw[..open], new, &raw[close + 1..]);
		}
	}
	match raw.rsplit_once("=> ") {
		Some((_, new)) => new.trim().to_string(),
		None => raw.to_string(),
	}
}

/// Parse the `%h\t%s\t%D\t%p` log tail into commits, newest first.
///
/// The subject is the only field that may itself contain a tab, so a record is
/// split from both ends: hash first, parents and decorations last.
fn parse_log(text: &str) -> Vec<GitCommit> {
	let mut commits = Vec::new();
	for line in text.lines() {
		if line.trim().is_empty() {
			continue;
		}
		let fields: Vec<&str> = line.split('\t').collect();
		if fields.len() < 4 {
			continue;
		}
		let parents = fields[fields.len() - 1];
		let decorations = fields[fields.len() - 2];
		commits.push(GitCommit {
			hash: fields[0].to_string(),
			subject: fields[1..fields.len() - 2].join("\t"),
			refs: decorations
				.split(", ")
				.map(|r| r.trim().to_string())
				.filter(|r| !r.is_empty())
				.collect(),
			merge: parents.split_whitespace().count() > 1,
		});
	}
	commits
}

/// What one row of a unified diff is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiffKind {
	/// A `diff --git`/`---`/`+++`/`index` header line, or the file header the
	/// parser synthesises from them.
	Header,
	/// A hunk header (`@@ -a,b +c,d @@`).
	Hunk,
	/// An added line.
	Add,
	/// A removed line.
	Del,
	/// An unchanged line inside a hunk.
	Context,
}

/// One row of a parsed unified diff.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffLine {
	pub kind: DiffKind,
	pub text: String,
}

/// The unified diff of the worktree against `HEAD`, read-only.
///
/// `file` narrows it to one repository-relative path. The command is
/// `git diff --no-color HEAD -- [file]`, so staged *and* unstaged edits are in
/// the result — which is also why a file that is only untracked does not show
/// up: `git diff` has nothing to compare it against.
pub fn read_diff(path: &Path, file: Option<&str>) -> Result<String, String> {
	let mut args = vec!["diff", "--no-color", "HEAD", "--"];
	if let Some(file) = file {
		args.push(file);
	}
	run_git(path, &args)
}

/// Classify one unified-diff line, or `None` for git's own bookkeeping
/// (`diff --git`, `index`, `---`, mode/rename headers), which the views drop.
///
/// This is the one place the diff's shape is decided; both [`parse_diff`] and
/// the 差异比较器 page's renderer go through it, so a row can be classified
/// without building the row list (the page walks the text straight from the
/// cache, once per frame, allocation-free).
pub fn classify_line(line: &str) -> Option<DiffKind> {
	if line.starts_with("+++ ") {
		return Some(DiffKind::Header);
	}
	if line.starts_with("diff --git")
		|| line.starts_with("index ")
		|| line.starts_with("--- ")
		|| line.starts_with("new file mode")
		|| line.starts_with("deleted file mode")
		|| line.starts_with("old mode")
		|| line.starts_with("new mode")
		|| line.starts_with("similarity index")
		|| line.starts_with("rename from")
		|| line.starts_with("rename to")
	{
		return None;
	}
	Some(if line.starts_with("@@") {
		DiffKind::Hunk
	} else if line.starts_with('+') {
		DiffKind::Add
	} else if line.starts_with('-') {
		DiffKind::Del
	} else {
		DiffKind::Context
	})
}

/// Split a unified diff into rows.
///
/// `diff --git`, `index`, `---` and `+++` lines are replaced by one header row
/// naming the destination path (`+++ b/<path>`), so a multi-file diff stays
/// readable without repeating git's bookkeeping. `\ No newline at end of file`
/// is kept as context — it is information about the change.
pub fn parse_diff(text: &str) -> Vec<DiffLine> {
	let mut rows = Vec::new();
	for line in text.lines() {
		let Some(kind) = classify_line(line) else {
			continue;
		};
		let text = if kind == DiffKind::Header {
			line.strip_prefix("+++ ").unwrap_or(line).trim().to_owned()
		} else {
			line.to_owned()
		};
		rows.push(DiffLine { kind, text });
	}
	rows
}

/// Wall-clock milliseconds since `started`.
fn elapsed_ms(started: Instant) -> f64 {
	(started.elapsed().as_secs_f64() * 1000.0).round()
}

#[cfg(test)]
mod tests {
	use super::*;

	fn file(path: &str, status: char) -> GitFile {
		GitFile { path: path.to_string(), status, ..Default::default() }
	}

	#[test]
	fn porcelain_parses_modified_rename_and_untracked() {
		let (changed, untracked) = parse_porcelain(" M src/main.rs\0R  old\0new\0?? notes.txt\0");
		assert_eq!(changed.len(), 2, "a rename's second path must not become an entry");
		assert_eq!(changed[0].path, "src/main.rs");
		assert_eq!(changed[0].status, 'M');
		assert!(!changed[0].untracked);
		assert_eq!(changed[1].path, "old");
		assert_eq!(changed[1].status, 'R');
		assert!(!changed[1].untracked);
		assert_eq!(untracked.len(), 1);
		assert_eq!(untracked[0].path, "notes.txt");
		assert_eq!(untracked[0].status, '?');
		assert!(untracked[0].untracked);
	}

	#[test]
	fn numstat_and_log_parse_odd_input() {
		let mut files = vec![file("img.png", 'M'), file("new.rs", 'R'), file("kept.rs", 'M')];
		apply_numstat("-\t-\timg.png\n12\t3\told.rs => new.rs\nno-tabs\n", &mut files);
		assert_eq!((files[0].insertions, files[0].deletions), (0, 0), "binary stays 0/0");
		assert_eq!((files[1].insertions, files[1].deletions), (12, 3), "renames join by path");
		assert_eq!((files[2].insertions, files[2].deletions), (0, 0));

		let commits = parse_log("abc\tfix: thing\tHEAD -> main, tag: v1\t\ndef\twip\t\tp1 p2\n\n");
		assert_eq!(commits.len(), 2);
		assert_eq!(commits[0].hash, "abc");
		assert_eq!(commits[0].subject, "fix: thing");
		assert_eq!(commits[0].refs, ["HEAD -> main".to_string(), "tag: v1".to_string()]);
		assert!(!commits[0].merge);
		assert_eq!(commits[1].subject, "wip");
		assert!(commits[1].refs.is_empty());
		assert!(commits[1].merge);
	}

	#[test]
	fn missing_path_reports_error() {
		let path =
			std::env::temp_dir().join(format!("zetawork-gui-not-a-repo-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&path);

		let status = read_status(&path, 5);
		assert!(status.error.is_some(), "a missing path must report an error");
		assert!(status.branch.is_empty());
		assert!(status.changed.is_empty() && status.untracked.is_empty());
		assert!(status.commits.is_empty());
		assert_eq!((status.insertions, status.deletions, status.ahead, status.behind), (0, 0, 0, 0));
	}

	/// A scratch repository: `<temp>/zetawork-gui-diff-<pid>`, committed once.
	fn scratch_repo(tag: &str) -> std::path::PathBuf {
		let path =
			std::env::temp_dir().join(format!("zetawork-gui-diff-{tag}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&path);
		std::fs::create_dir_all(&path).unwrap();
		let git = |args: &[&str]| {
			let mut cmd = Command::new("git");
			cmd.arg("-C").arg(&path).args(args);
			cmd.stdin(Stdio::null())
				.stdout(Stdio::piped())
				.stderr(Stdio::piped());
			#[cfg(windows)]
			cmd.creation_flags(CREATE_NO_WINDOW);
			let out = cmd.output().expect("git must be on PATH for this test");
			assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
		};
		git(&["init", "--quiet"]);
		std::fs::write(path.join("notes.txt"), "one\n").unwrap();
		std::fs::write(path.join("other.txt"), "hello\n").unwrap();
		git(&["add", "notes.txt", "other.txt"]);
		git(&[
			"-c",
			"user.email=zetawork@test",
			"-c",
			"user.name=zetawork",
			"commit",
			"--quiet",
			"-m",
			"seed",
		]);
		path
	}

	#[test]
	fn parse_diff_names_files_and_classifies_rows() {
		let text = "diff --git a/notes.txt b/notes.txt\nindex 111..222 100644\n--- a/notes.txt\n+++ b/notes.txt\n@@ -1 +1,2 @@\n-one\n+one changed\n+two\n\\ No newline at end of file\n";
		let rows = parse_diff(text);
		let kinds: Vec<DiffKind> = rows.iter().map(|row| row.kind).collect();
		assert_eq!(
			kinds,
			vec![
				DiffKind::Header,
				DiffKind::Hunk,
				DiffKind::Del,
				DiffKind::Add,
				DiffKind::Add,
				DiffKind::Context,
			],
			"bookkeeping lines collapse into one header row"
		);
		assert_eq!(rows[0].text, "b/notes.txt");
		assert_eq!(rows[1].text, "@@ -1 +1,2 @@");
		assert!(parse_diff("").is_empty());
	}

	#[test]
	fn read_diff_reads_a_real_worktree_change() {
		let repo = scratch_repo("read");
		std::fs::write(repo.join("notes.txt"), "one changed\ntwo\n").unwrap();
		let text = read_diff(&repo, None).expect("a tracked edit must produce a diff");
		let rows = parse_diff(&text);
		assert!(
			rows
				.iter()
				.any(|row| row.kind == DiffKind::Add && row.text == "+two")
		);
		assert!(
			rows
				.iter()
				.any(|row| row.kind == DiffKind::Header && row.text == "b/notes.txt")
		);

		// Narrowing to one path keeps the other file out.
		std::fs::write(repo.join("other.txt"), "hello changed\n").unwrap();
		let narrowed = read_diff(&repo, Some("other.txt")).expect("diff of one path");
		assert!(narrowed.contains("other.txt"), "{narrowed}");
		assert!(!narrowed.contains("notes.txt"), "{narrowed}");
		let _ = std::fs::remove_dir_all(&repo);
	}
}
