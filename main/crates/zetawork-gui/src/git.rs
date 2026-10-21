// SPDX-License-Identifier: AGPL-3.0-only
//! Git introspection for the shell's status strip: which branch the worktree
//! is on, how far it drifted from its upstream, what is dirty, what landed
//! lately, and which branches exist. Reading is a real, read-only `git`
//! invocation through [`std::process::Command`] — never a shell — and every
//! failure degrades to an empty [`GitStatus`] whose `error` says what went
//! wrong, so a pane can paint a placeholder instead of panicking.
//!
//! The two branch actions ([`switch_branch`], [`create_branch`]) are the one
//! place this module writes: the user clicked a row or submitted a name, and
//! the argv is built by [`switch_args`]/[`create_args`] so the command a test
//! asserts is exactly the command the shell runs. Their failure text is git's.
//!
//! Captured output is normalised by stripping `\r`, so the parsers below are
//! platform-independent; porcelain `-z` (NUL-separated, with an extra path
//! field for renames) is parsed by hand.

use crate::t;

#[cfg(windows)]
use std::os::windows::process::CommandExt as _;
use std::{
	path::{Path, PathBuf},
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

/// One branch `git for-each-ref` reported.
///
/// `name` is the short ref the user sees: `main` for a local branch,
/// `origin/main` for a remote-tracking one. A remote branch's checkout target
/// is derived by [`switch_args`], never by the caller.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GitBranch {
	/// `%(refname:short)`, e.g. `main` or `origin/main`.
	pub name: String,
	/// True for `refs/remotes/…`.
	pub remote: bool,
	/// True for the branch `HEAD` points at (the local one only).
	pub current: bool,
	/// `%(upstream:short)` for a local branch, `None` when it has none.
	pub upstream: Option<String>,
}

/// The refs, and the field order, [`read_branches`] asks git for.
///
/// A symref (`refs/remotes/origin/HEAD`) is git's alias for another branch, not
/// a branch a user can check out, and `for-each-ref` marks it with a non-empty
/// `%(symref)`; [`parse_branches`] drops those rows.
const BRANCH_ARGS: [&str; 4] = [
	"for-each-ref",
	"--format=%(refname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(symref)",
	"refs/heads",
	"refs/remotes",
];

/// Parse `BRANCH_ARGS` output into branches, locals first.
///
/// Each line is five NUL-separated fields:
/// `full ref`, `short name`, `HEAD` (`*` on the current local branch),
/// `upstream:short`, `symref`. Symrefs and detached/empty names are dropped;
/// a local branch sorts before a remote one, then by name.
fn parse_branches(text: &str) -> Vec<GitBranch> {
	let mut branches = Vec::new();
	for line in text.lines() {
		let fields: Vec<&str> = line.split('\0').collect();
		if fields.len() < 5 {
			continue;
		}
		let full = fields[0].trim();
		let name = fields[1].trim();
		if name.is_empty() || !fields[4].trim().is_empty() {
			continue;
		}
		let remote = full.starts_with("refs/remotes/");
		if !remote && !full.starts_with("refs/heads/") {
			continue;
		}
		let upstream = fields[3].trim();
		branches.push(GitBranch {
			name: name.to_owned(),
			remote,
			current: !remote && fields[2].trim() == "*",
			upstream: (!upstream.is_empty()).then(|| upstream.to_owned()),
		});
	}
	branches.sort_by(|a, b| a.remote.cmp(&b.remote).then_with(|| a.name.cmp(&b.name)));
	branches
}

/// List the repository's local and remote-tracking branches.
pub fn read_branches(path: &Path) -> Result<Vec<GitBranch>, String> {
	run_git(path, &BRANCH_ARGS).map(|out| parse_branches(&out))
}

/// The `git switch` argv for one branch, without the `-C <path>` prefix.
///
/// A local branch is switched to directly. A remote-tracking branch has no
/// local ref to switch to, so a local branch of the same name (everything after
/// the remote's first `/`) is created and told to track it — the explicit form
/// of git's DWIM, and the one that still works when two remotes carry the same
/// branch name.
pub fn switch_args(branch: &GitBranch) -> Vec<String> {
	if !branch.remote {
		return vec!["switch".to_owned(), branch.name.clone()];
	}
	let local = branch
		.name
		.split_once('/')
		.map(|(_, rest)| rest)
		.filter(|rest| !rest.is_empty())
		.unwrap_or(branch.name.as_str());
	vec![
		"switch".to_owned(),
		"-c".to_owned(),
		local.to_owned(),
		"--track".to_owned(),
		branch.name.clone(),
	]
}

/// The `git switch` argv that creates `name` and checks it out.
pub fn create_args(name: &str) -> Vec<String> {
	vec!["switch".to_owned(), "-c".to_owned(), name.trim().to_owned()]
}

/// Is `name` something `git switch -c` will accept?
///
/// This is `git check-ref-format --branch`'s rule for the cases a user can
/// type, checked without spawning a process so the button can be disabled
/// before a round trip: non-empty, no leading `-`, no whitespace/control
/// characters, no `..`, `@{`, `//`, and no leading/trailing `/` or `.`.
pub fn valid_branch_name(name: &str) -> bool {
	let name = name.trim();
	if name.is_empty() || name == "@" || name.starts_with('-') {
		return false;
	}
	if name.starts_with('/') || name.ends_with('/') || name.ends_with('.') {
		return false;
	}
	if name.ends_with(".lock") || name.contains("..") || name.contains("//") || name.contains("@{") {
		return false;
	}
	!name
		.chars()
		.any(|ch| ch.is_whitespace() || ch.is_control() || "~^:?*[\\".contains(ch))
}

/// Switch the worktree at `path` to `branch`, printing git's own failure text.
pub fn switch_branch(path: &Path, branch: &GitBranch) -> Result<String, String> {
	let args = switch_args(branch);
	let refs: Vec<&str> = args.iter().map(String::as_str).collect();
	run_git(path, &refs)
}

/// Create `name` from `HEAD` and switch to it.
pub fn create_branch(path: &Path, name: &str) -> Result<String, String> {
	if !valid_branch_name(name) {
		return Err(t!("分支名无效：{}", name.trim()));
	}
	let args = create_args(name);
	let refs: Vec<&str> = args.iter().map(String::as_str).collect();
	run_git(path, &refs)
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
	/// Local branches first, then remote-tracking branches, each group in
	/// name order. Empty when the listing failed; the panel then offers only
	/// the current branch, as it did before.
	pub branches: Vec<GitBranch>,
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
	if let Ok(out) = run_git(path, &BRANCH_ARGS) {
		status.branches = parse_branches(&out);
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

	let child = cmd
		.spawn()
		.map_err(|err| format!("git {}: {}", args.join(" "), err))?;
	crate::spawn_probe::record_command(child.id(), &cmd);
	let output = child
		.wait_with_output()
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

// ── worktrees ─────────────────────────────────────────────────────────────

/// One entry of `git worktree list --porcelain`.
///
/// The first entry is the main checkout; every later one is a linked
/// worktree. `branch` is the short name (`feat/x`), `None` when `HEAD` is
/// detached or the worktree is bare — the difference matters, because a
/// detached worktree cannot be "switched to" by name.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Worktree {
	/// The checkout's directory, as git reports it (absolute).
	pub path: PathBuf,
	/// The commit `HEAD` resolves to.
	pub head: String,
	/// `refs/heads/<name>` without the prefix.
	pub branch: Option<String>,
	pub bare: bool,
	pub detached: bool,
	pub locked: bool,
	/// git considers the checkout gone: its gitdir no longer exists.
	pub prunable: bool,
}

impl Worktree {
	/// The row's label: the branch, else `(分离 HEAD)` for a detached head,
	/// else the directory's own name.
	pub fn label(&self) -> String {
		if let Some(branch) = &self.branch {
			return branch.clone();
		}
		if self.detached {
			return t!("（分离 HEAD）").to_owned();
		}
		self.path
			.file_name()
			.map(|name| name.to_string_lossy().into_owned())
			.unwrap_or_else(|| self.path.display().to_string())
	}
}

/// `git worktree list --porcelain`.
pub const WORKTREE_LIST_ARGS: [&str; 3] = ["worktree", "list", "--porcelain"];

/// Parse `git worktree list --porcelain`.
///
/// Records are blank-line separated; each is a list of `key` or `key value`
/// lines (`worktree`, `HEAD`, `branch`, `bare`, `detached`, `locked`,
/// `prunable`). A record with no `worktree` line is dropped, so a truncated
/// tail cannot invent an empty checkout.
pub fn parse_worktrees(text: &str) -> Vec<Worktree> {
	let mut rows = Vec::new();
	let mut current: Option<Worktree> = None;
	let flush = |current: &mut Option<Worktree>, rows: &mut Vec<Worktree>| {
		if let Some(worktree) = current.take() {
			if !worktree.path.as_os_str().is_empty() {
				rows.push(worktree);
			}
		}
	};
	for line in text.lines() {
		if line.trim().is_empty() {
			flush(&mut current, &mut rows);
			continue;
		}
		if let Some(path) = line.strip_prefix("worktree ") {
			flush(&mut current, &mut rows);
			current = Some(Worktree { path: PathBuf::from(path.trim()), ..Default::default() });
			continue;
		}
		let Some(worktree) = current.as_mut() else {
			continue;
		};
		if let Some(head) = line.strip_prefix("HEAD ") {
			worktree.head = head.trim().to_owned();
		} else if let Some(branch) = line.strip_prefix("branch ") {
			let short = branch
				.trim()
				.strip_prefix("refs/heads/")
				.unwrap_or(branch.trim());
			worktree.branch = (!short.is_empty()).then(|| short.to_owned());
		} else if line == "bare" {
			worktree.bare = true;
		} else if line == "detached" {
			worktree.detached = true;
		} else if line == "locked" || line.starts_with("locked ") {
			worktree.locked = true;
		} else if line == "prunable" || line.starts_with("prunable ") {
			worktree.prunable = true;
		}
	}
	flush(&mut current, &mut rows);
	rows
}

/// Every worktree of the repository containing `path`, main checkout first.
pub fn list_worktrees(path: &Path) -> Result<Vec<Worktree>, String> {
	run_git(path, &WORKTREE_LIST_ARGS).map(|out| parse_worktrees(&out))
}

/// The main checkout's root for the repository containing `path`.
///
/// `--git-common-dir` is shared by every linked worktree, so its parent is the
/// repository the worktrees belong to — the same rule the web gateway's
/// `resolveProject` uses. A path outside a repository is an `Err`.
pub fn repo_root(path: &Path) -> Result<PathBuf, String> {
	let common = run_git(path, &["rev-parse", "--path-format=absolute", "--git-common-dir"])?;
	let common = PathBuf::from(common.trim());
	common
		.parent()
		.map(Path::to_path_buf)
		.filter(|parent| !parent.as_os_str().is_empty())
		.ok_or_else(|| t!("无法定位仓库根目录：{}", path.display()))
}

/// The directory name a branch gets under `<repo>-worktrees/`.
///
/// The branch slash is a path separator on disk, so it becomes `-`; the same
/// character set Windows rejects is folded too. Empty is an invalid branch.
pub fn worktree_dir_name(branch: &str) -> String {
	branch
		.chars()
		.map(|ch| match ch {
			'/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
			ch if ch.is_whitespace() || ch.is_control() => '-',
			ch => ch,
		})
		.collect::<String>()
		.trim_matches('-')
		.to_owned()
}

/// The `git worktree add` argv for `branch` at `path`.
///
/// `create` distinguishes a new branch (`-b`) from an existing one; the `--`
/// keeps a path that looks like a flag a path.
pub fn worktree_add_args(branch: &str, path: &Path, create: bool) -> Vec<String> {
	let mut args = vec!["worktree".to_owned(), "add".to_owned()];
	if create {
		args.push("-b".to_owned());
		args.push(branch.trim().to_owned());
	}
	args.push("--".to_owned());
	args.push(path.display().to_string());
	args
}

/// The `git worktree remove` argv.
pub fn worktree_remove_args(path: &Path, force: bool) -> Vec<String> {
	let mut args = vec!["worktree".to_owned(), "remove".to_owned()];
	if force {
		args.push("--force".to_owned());
	}
	args.push("--".to_owned());
	args.push(path.display().to_string());
	args
}

/// Does `repo` already have a branch named `name`?
fn branch_exists(repo: &Path, name: &str) -> bool {
	run_git(repo, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{name}")]).is_ok()
}

/// Create a worktree for `branch` under `<repo>-worktrees/<dir>` and return
/// the new checkout's path.
///
/// An existing branch is checked out; a new one is created from `HEAD`. This
/// mirrors the web gateway's `addWorktree`, so a worktree created from either
/// surface has the same location and the same branch rules.
pub fn add_worktree(repo: &Path, branch: &str) -> Result<PathBuf, String> {
	let branch = branch.trim();
	if !valid_branch_name(branch) {
		return Err(t!("分支名无效：{}", branch));
	}
	let dir = worktree_dir_name(branch);
	if dir.is_empty() {
		return Err(t!("分支名无效：{}", branch));
	}
	let root = repo_root(repo)?;
	let parent = PathBuf::from(format!("{}-worktrees", root.display()));
	let path = parent.join(&dir);
	if path.exists() {
		return Err(t!("工作树目录已存在：{}", path.display()));
	}
	std::fs::create_dir_all(&parent)
		.map_err(|error| t!("创建工作树根目录失败：{}", error))?;
	let create = !branch_exists(&root, branch);
	let args = worktree_add_args(branch, &path, create);
	let refs: Vec<&str> = args.iter().map(String::as_str).collect();
	run_git(&root, &refs)?;
	Ok(path)
}

/// Remove the worktree at `path`. git refuses a dirty checkout without
/// `force`, and that refusal is returned verbatim so the panel can offer the
/// confirmation.
pub fn remove_worktree(repo: &Path, path: &Path, force: bool) -> Result<(), String> {
	let args = worktree_remove_args(path, force);
	let refs: Vec<&str> = args.iter().map(String::as_str).collect();
	run_git(repo, &refs).map(|_| ())
}

/// Repository-relative paths a palette can jump to: tracked and untracked,
/// honoured `.gitignore`, at most `limit` entries.
///
/// `git ls-files` is the one call that sees the whole checkout without walking
/// ignored trees. Paths come back in git's order (sorted); a non-repository
/// path is an `Err` and the palette shows no file section.
pub fn list_files(path: &Path, limit: usize) -> Result<Vec<String>, String> {
	let out = run_git(path, &["ls-files", "-z", "--cached", "--others", "--exclude-standard"])?;
	Ok(out
		.split('\0')
		.filter(|entry| !entry.is_empty())
		.take(limit)
		.map(str::to_owned)
		.collect())
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
	fn branches_parse_locals_remotes_and_symrefs() {
		let text = "refs/heads/main\0main\0*\0origin/main\0\n\
		            refs/heads/feat/x\0feat/x\0 \0\0\n\
		            refs/remotes/origin/HEAD\0origin/HEAD\0\0\0refs/remotes/origin/main\n\
		            refs/remotes/origin/dev\0origin/dev\0\0\0\n";
		let branches = parse_branches(text);
		let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
		assert_eq!(names, ["feat/x", "main", "origin/dev"], "locals first, then remotes");
		assert!(branches[1].current, "HEAD marks the current local branch");
		assert!(!branches[0].current);
		assert_eq!(branches[1].upstream.as_deref(), Some("origin/main"));
		assert!(branches[2].remote);
		assert!(
			branches.iter().all(|branch| branch.name != "origin/HEAD"),
			"a symref is not a checkable branch"
		);
		assert!(parse_branches("garbage\n\n").is_empty());
	}

	#[test]
	fn branch_commands_name_the_target_explicitly() {
		let local =
			GitBranch { name: "feat/x".into(), remote: false, current: false, upstream: None };
		assert_eq!(switch_args(&local), ["switch", "feat/x"]);

		let remote =
			GitBranch { name: "origin/dev".into(), remote: true, current: false, upstream: None };
		assert_eq!(
			switch_args(&remote),
			["switch", "-c", "dev", "--track", "origin/dev"],
			"a remote branch gets a local branch that tracks it"
		);

		assert_eq!(create_args(" release/1.2 "), ["switch", "-c", "release/1.2"]);
		assert!(valid_branch_name("feat/x-1"));
		for bad in ["", " ", "-x", "a b", "a..b", "a//b", "x.lock", "a~b", "a^b", "@{u}", "/x"] {
			assert!(!valid_branch_name(bad), "{bad:?} must be refused");
		}
	}

	#[test]
	fn branch_actions_work_on_a_real_repository() {
		let repo = scratch_repo("branches");
		let before = read_branches(&repo).expect("a repository has branches");
		assert_eq!(before.len(), 1, "one local branch after the seed commit");
		assert!(before[0].current);

		create_branch(&repo, "feat/from-test").expect("branch creation must succeed");
		let after = read_branches(&repo).expect("branches re-read");
		let created = after
			.iter()
			.find(|branch| branch.name == "feat/from-test")
			.expect("the new branch is listed");
		assert!(created.current, "the new branch is checked out");
		let previous = after
			.iter()
			.find(|branch| branch.name == before[0].name)
			.expect("the seed branch is still there");
		assert!(!previous.current, "the previous branch is no longer current");

		switch_branch(&repo, previous).expect("switching back must succeed");
		assert!(
			read_branches(&repo)
				.expect("branches re-read")
				.iter()
				.any(|branch| branch.current && branch.name == before[0].name)
		);
		let _ = std::fs::remove_dir_all(&repo);
	}

	#[test]
	fn parse_diff_names_files_and_classifies_rows() {
		let text = "diff --git a/notes.txt b/notes.txt\nindex 111..222 100644\n--- a/notes.txt\n+++ \
		            b/notes.txt\n@@ -1 +1,2 @@\n-one\n+one changed\n+two\n\\ No newline at end of \
		            file\n";
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

	#[test]
	fn worktree_porcelain_parses_the_main_and_a_linked_checkout() {
		let text = "worktree /work/zeta\nHEAD 1111111111111111111111111111111111111111\n\
		            branch refs/heads/main\n\n\
		            worktree /work/zeta-worktrees/feat-x\nHEAD \
		            2222222222222222222222222222222222222222\nbranch refs/heads/feat/x\n\n\
		            worktree /work/zeta-worktrees/detached\nHEAD \
		            3333333333333333333333333333333333333333\ndetached\nlocked\n";
		let rows = parse_worktrees(text);
		assert_eq!(rows.len(), 3, "a truncated record is not an entry");
		assert_eq!(rows[0].path, PathBuf::from("/work/zeta"));
		assert_eq!(rows[0].branch.as_deref(), Some("main"));
		assert!(!rows[0].detached);
		assert_eq!(rows[1].label(), "feat/x", "the branch is the label");
		assert_eq!(rows[2].branch, None);
		assert!(rows[2].detached);
		assert!(rows[2].locked);
		assert_eq!(rows[2].label(), t!("（分离 HEAD）"));
		assert!(parse_worktrees("").is_empty());
		assert!(parse_worktrees("HEAD 111\nbranch refs/heads/x\n").is_empty());
	}

	#[test]
	fn worktree_commands_are_built_once() {
		let path = Path::new("/work/zeta-worktrees/feat-x");
		assert_eq!(
			worktree_add_args("feat/x", path, true),
			["worktree", "add", "-b", "feat/x", "--", "/work/zeta-worktrees/feat-x"],
			"a new branch is created before the checkout"
		);
		assert_eq!(
			worktree_add_args("feat/x", path, false),
			["worktree", "add", "--", "/work/zeta-worktrees/feat-x"],
			"an existing branch is checked out as-is"
		);
		assert_eq!(
			worktree_remove_args(path, false),
			["worktree", "remove", "--", "/work/zeta-worktrees/feat-x"]
		);
		assert_eq!(
			worktree_remove_args(path, true),
			["worktree", "remove", "--force", "--", "/work/zeta-worktrees/feat-x"]
		);
		assert_eq!(worktree_dir_name("feat/x"), "feat-x");
		assert_eq!(worktree_dir_name("a b:c"), "a-b-c");
		assert!(worktree_dir_name("///").is_empty());
	}

	#[test]
	fn a_worktree_is_added_listed_and_removed_on_a_real_repository() {
		let repo = scratch_repo("worktree");
		let base = PathBuf::from(format!("{}-worktrees", repo.display()));
		let added = add_worktree(&repo, "feat/real").expect("adding a worktree succeeds");
		assert_eq!(added, base.join("feat-real"), "the location follows the web rule");
		assert_eq!(repo_root(&added).expect("a linked checkout knows its repo"), repo);

		let listed = list_worktrees(&repo).expect("worktrees list");
		assert_eq!(listed.len(), 2, "main + the linked checkout");
		assert_eq!(listed[1].branch.as_deref(), Some("feat/real"));
		assert_eq!(listed[1].path, added);

		// The branch exists now, so a second add of another branch reuses it.
		let second = add_worktree(&repo, "feat/second").expect("a second worktree");
		assert_eq!(list_worktrees(&repo).expect("listed").len(), 3);
		assert!(add_worktree(&repo, "feat/real").is_err(), "an occupied path is refused");
		assert!(add_worktree(&repo, "bad name").is_err(), "git's branch rules apply");

		remove_worktree(&repo, &added, false).expect("a clean worktree is removable");
		assert_eq!(list_worktrees(&repo).expect("listed").len(), 2);
		remove_worktree(&repo, &second, true).expect("force removes");
		let _ = std::fs::remove_dir_all(&base);
		let _ = std::fs::remove_dir_all(&repo);
	}

	#[test]
	fn the_file_index_lists_tracked_and_untracked_but_not_ignored() {
		let repo = scratch_repo("files");
		std::fs::write(repo.join(".gitignore"), "ignored.txt\n").unwrap();
		std::fs::write(repo.join("ignored.txt"), "x\n").unwrap();
		std::fs::write(repo.join("new.txt"), "y\n").unwrap();
		let mut files = list_files(&repo, 100).expect("a repository lists files");
		files.sort();
		assert_eq!(files, [".gitignore", "new.txt", "notes.txt", "other.txt"]);
		assert_eq!(list_files(&repo, 2).expect("bounded").len(), 2);
		let missing = std::env::temp_dir().join("zetawork-gui-not-a-repo-files");
		let _ = std::fs::remove_dir_all(&missing);
		assert!(list_files(&missing, 10).is_err());
		let _ = std::fs::remove_dir_all(&repo);
	}
}
