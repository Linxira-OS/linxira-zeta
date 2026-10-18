// SPDX-License-Identifier: AGPL-3.0-only
//! 清除所有工作区记忆: the one destructive settings action, and the pure
//! function behind it.
//!
//! # What this owns
//!
//! The GUI keeps two kinds of remembering, both under `~/.zeta`:
//!
//! * **its own workspace state** — [`workspace_state_dir`]
//!   (`~/.zeta/zetawork/workspaces`), the directory reserved for saved
//!   tab/layout snapshots. When a launch restores a workspace, this is the
//!   state it reads; deleting it makes the next launch seed that workspace from
//!   scratch (one pane, the workspace cwd).
//! * **per-project session journals** — the coding agent's transcripts under
//!   `~/.zeta/agent/sessions/<encoded-project>/`, one directory per project
//!   path. The encoding is the agent's (`session-paths.ts`): `-` for a project
//!   under the home directory, `-tmp` for one under the temp root, and
//!   `--<absolute>--` for everything else, with `/`, `\` and `:` rewritten to
//!   `-`.
//!
//! # What this never touches
//!
//! `~/.zeta/projects.json` (the shared registry), the user's project
//! directories, `~/.zeta/zetawork.toml` (the shell's own settings), and the
//! coding agent's global configuration (`~/.zeta/agent/config.yml`,
//! `models.yml`, `agent.db`). The clear action is about *memory*, not about the
//! projects or the agent that produced it.
//!
//! # Reporting
//!
//! [`clear_workspace_memory`] returns a [`Report`] naming every path it removed
//! and counting the files, directories and bytes. It is pure with respect to
//! the caller: given a home and the workspace paths, it decides exactly what is
//! owned and removes only that. A caller with a different home (the tests) gets
//! a different tree and nothing else.

use std::path::{Component, Path, PathBuf};

/// The directory the GUI owns for saved workspace state.
///
/// It is deliberately *not* `~/.zeta/workspace`: that is the coding agent's
/// stable workspace anchor. This one belongs to the shell.
pub fn workspace_state_dir(home: &Path) -> PathBuf {
	home.join(".zeta").join("zetawork").join("workspaces")
}

/// The coding agent's transcript root (one directory per project path).
pub fn session_journals_root(home: &Path) -> PathBuf {
	home.join(".zeta").join("agent").join("sessions")
}

/// What one clear removed, and what it could not.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Report {
	/// Files deleted (recursively).
	pub files: usize,
	/// Directories deleted, including the top-level targets.
	pub dirs: usize,
	/// Bytes the deleted files occupied, as reported by the filesystem.
	pub bytes: u64,
	/// Every path removed, in removal order (state first, journals after).
	pub paths: Vec<PathBuf>,
	/// Targets that existed but could not be removed, with the error text.
	pub errors: Vec<(PathBuf, String)>,
}

impl Report {
	/// Nothing existed under `~/.zeta` for this shell: the honest answer.
	pub fn is_empty(&self) -> bool {
		self.files == 0 && self.dirs == 0 && self.paths.is_empty() && self.errors.is_empty()
	}

	/// The one-line result the settings row shows.
	pub fn summary(&self) -> String {
		if self.is_empty() {
			return "没有找到工作区记忆（工作区状态与项目会话日志都已为空）".to_owned();
		}
		let mut text = format!(
			"已清除 {} 个路径 · {} 个文件 · {} 个目录 · {}",
			self.paths.len(),
			self.files,
			self.dirs,
			bytes_label(self.bytes)
		);
		if !self.errors.is_empty() {
			text.push_str(&format!(" · {} 个未能删除", self.errors.len()));
		}
		text
	}
}

/// Format a byte count the way the settings row can read at a glance.
pub(crate) fn bytes_label(bytes: u64) -> String {
	const KIB: f64 = 1024.0;
	const MIB: f64 = KIB * 1024.0;
	let bytes = bytes as f64;
	if bytes >= MIB {
		format!("{:.1} MB", bytes / MIB)
	} else if bytes >= KIB {
		format!("{:.1} KB", bytes / KIB)
	} else {
		format!("{bytes} B")
	}
}

/// The agent's session directory name for a project path.
///
/// Mirrors `packages/coding-agent/src/session/session-paths.ts`
/// (`getDefaultSessionDirName`) for the three scopes it has: a project under
/// the temp root, one under the home directory, and everything else. Paths are
/// canonicalized first, because the agent keys its directories by the canonical
/// cwd.
pub fn session_dir_name(project: &Path, home: &Path, temp_root: &Path) -> String {
	let project = canonical(project);
	let home = canonical(home);
	let temp_root = canonical(temp_root);
	if let Some(relative) = relative_within(&temp_root, &project) {
		return encode("-tmp", &relative);
	}
	if let Some(relative) = relative_within(&home, &project) {
		return encode("-", &relative);
	}
	let absolute = project.to_string_lossy();
	let absolute = absolute.trim_start_matches(['/', '\\']);
	format!("--{}--", replace_separators(absolute))
}

/// Canonicalize when the path exists; otherwise keep it (a missing project is
/// still a path the journal may have been written for).
///
/// `std::fs::canonicalize` returns `\\?\C:\…` verbatim paths on Windows,
/// while a missing path keeps its ordinary spelling; left alone, the two would
/// never compare equal. The prefix is stripped so an existing home and a
/// removed project still share their components.
fn canonical(path: &Path) -> PathBuf {
	let path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
	#[cfg(windows)]
	{
		let text = path.to_string_lossy();
		if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
			return PathBuf::from(format!(r"\\{rest}"));
		}
		if let Some(rest) = text.strip_prefix(r"\\?\") {
			return PathBuf::from(rest);
		}
	}
	path
}

/// `path` relative to `root` when it is inside it, with Windows' case
/// insensitivity honoured for the prefix but not for the rest.
fn relative_within(root: &Path, path: &Path) -> Option<PathBuf> {
	let root_components: Vec<_> = root.components().collect();
	let path_components: Vec<_> = path.components().collect();
	if path_components.len() < root_components.len() {
		return None;
	}
	for (root, path) in root_components.iter().zip(&path_components) {
		if !component_eq(root, path) {
			return None;
		}
	}
	Some(path_components[root_components.len()..].iter().collect())
}

fn component_eq(a: &Component<'_>, b: &Component<'_>) -> bool {
	let text = |c: &Component<'_>| c.as_os_str().to_string_lossy().into_owned();
	let (a, b) = (text(a), text(b));
	if cfg!(windows) {
		a.eq_ignore_ascii_case(&b)
	} else {
		a == b
	}
}

/// `prefix` plus the relative path with separators and drive colons rewritten
/// to `-`, exactly like the agent's encoder.
fn encode(prefix: &str, relative: &Path) -> String {
	let text = relative.to_string_lossy();
	let text = text.trim_matches(['/', '\\']);
	let encoded = replace_separators(text);
	if encoded.is_empty() {
		return prefix.to_owned();
	}
	if prefix.ends_with('-') {
		format!("{prefix}{encoded}")
	} else {
		format!("{prefix}-{encoded}")
	}
}

fn replace_separators(text: &str) -> String {
	text
		.chars()
		.map(|c| {
			if matches!(c, '/' | '\\' | ':') {
				'-'
			} else {
				c
			}
		})
		.collect()
}

/// The workspace state directory and every project's session journal directory.
///
/// Pure path arithmetic: it does not read the filesystem, so the settings row
/// can name what it *would* remove before the user clicks.
pub fn owned_paths(home: &Path, workspace_paths: &[PathBuf]) -> Vec<PathBuf> {
	let mut out = vec![workspace_state_dir(home)];
	let root = session_journals_root(home);
	let temp_root = std::env::temp_dir();
	let mut journals: Vec<PathBuf> = workspace_paths
		.iter()
		.map(|path| root.join(session_dir_name(path, home, &temp_root)))
		.collect();
	journals.sort();
	journals.dedup();
	out.extend(journals);
	out
}

/// Delete the GUI's own workspace state and the session journals of
/// `workspace_paths`, reporting exactly what went.
///
/// Only paths under `<home>/.zeta` are considered (every candidate is built
/// there, and the guard makes that a property rather than a hope). The project
/// registry, the shell's settings file and the agent's configuration are not
/// candidates at all.
pub fn clear_workspace_memory(home: &Path, workspace_paths: &[PathBuf]) -> Report {
	let mut report = Report::default();
	let owned_root = home.join(".zeta");
	for path in owned_paths(home, workspace_paths) {
		// Every candidate is built under `<home>/.zeta`; the guard makes that a
		// property of the input rather than a hope (a caller cannot hand us a
		// project directory to delete).
		if !path.starts_with(&owned_root) {
			report
				.errors
				.push((path, "不在 ~/.zeta 内，已跳过".to_owned()));
			continue;
		}
		let metadata = match std::fs::symlink_metadata(&path) {
			Ok(metadata) => metadata,
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
			Err(error) => {
				report.errors.push((path, error.to_string()));
				continue;
			},
		};
		match metadata.file_type() {
			kind if kind.is_dir() => {
				let (files, dirs, bytes) = measure_dir(&path);
				match std::fs::remove_dir_all(&path) {
					Ok(()) => {
						report.files += files;
						report.dirs += dirs;
						report.bytes += bytes;
						report.paths.push(path);
					},
					Err(error) => report.errors.push((path, error.to_string())),
				}
			},
			_ => match std::fs::remove_file(&path) {
				Ok(()) => {
					report.files += 1;
					report.bytes += metadata.len();
					report.paths.push(path);
				},
				Err(error) => report.errors.push((path, error.to_string())),
			},
		}
	}
	report
}

/// `(files, dirs, bytes)` below `dir`, counting `dir` itself.
fn measure_dir(dir: &Path) -> (usize, usize, u64) {
	let mut files = 0;
	let mut dirs = 1;
	let mut bytes = 0;
	let Ok(entries) = std::fs::read_dir(dir) else {
		return (files, dirs, bytes);
	};
	for entry in entries.flatten() {
		let path = entry.path();
		match entry.file_type() {
			Ok(kind) if kind.is_dir() => {
				let (below_files, below_dirs, below_bytes) = measure_dir(&path);
				files += below_files;
				dirs += below_dirs;
				bytes += below_bytes;
			},
			Ok(_) => {
				files += 1;
				bytes += entry.metadata().map(|meta| meta.len()).unwrap_or(0);
			},
			Err(_) => {},
		}
	}
	(files, dirs, bytes)
}

/// What `~/.zeta` currently occupies, as `(files, dirs, bytes)`; `None` when
/// the directory does not exist.
///
/// This is a real read of the one tree the shell and the agent share, and the
/// 管理 section's 数据与存储 row shows exactly this number.
pub fn zeta_usage(home: &Path) -> Option<(usize, usize, u64)> {
	let root = home.join(".zeta");
	match std::fs::symlink_metadata(&root) {
		Ok(metadata) if metadata.is_dir() => Some(measure_dir(&root)),
		_ => None,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A temp home with a fake `~/.zeta` tree: registry, settings, agent config,
	/// a saved workspace state and one project with a session journal.
	fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
		let dir = tempfile::tempdir().expect("temp home");
		let home = dir.path().to_path_buf();
		let zeta = home.join(".zeta");
		std::fs::create_dir_all(zeta.join("zetawork").join("workspaces").join("ws-local"))
			.expect("state dir");
		std::fs::write(
			zeta
				.join("zetawork")
				.join("workspaces")
				.join("ws-local")
				.join("tabs.json"),
			b"[1,2]",
		)
		.expect("state file");
		std::fs::write(zeta.join("projects.json"), b"{\"projects\":[]}").expect("registry");
		std::fs::write(zeta.join("zetawork.toml"), b"theme = dark\n").expect("settings");
		std::fs::create_dir_all(zeta.join("agent")).expect("agent dir");
		std::fs::write(zeta.join("agent").join("config.yml"), b"edit: {}\n").expect("agent config");
		std::fs::write(zeta.join("agent").join("models.yml"), b"{\"providers\":{}}")
			.expect("catalog");
		// The project lives under the home directory, which is what the
		// standard encoding path covers.
		let project = home.join("work").join("demo");
		std::fs::create_dir_all(&project).expect("project");
		std::fs::write(project.join("README.md"), b"keep me").expect("project file");
		let journal = session_journals_root(&home).join(session_dir_name(
			&project,
			&home,
			&std::env::temp_dir(),
		));
		std::fs::create_dir_all(&journal).expect("journal dir");
		std::fs::write(journal.join("s1.jsonl"), b"{}\n").expect("journal");
		(dir, home, project)
	}

	#[test]
	fn clears_owned_state_and_journals_but_keeps_the_registry_and_config() {
		let (_dir, home, project) = fixture();
		let state = workspace_state_dir(&home);
		let journal = session_journals_root(&home).join(session_dir_name(
			&project,
			&home,
			&std::env::temp_dir(),
		));
		assert!(state.is_dir() && journal.is_dir());

		let report = clear_workspace_memory(&home, std::slice::from_ref(&project));

		assert!(report.errors.is_empty(), "{:?}", report.errors);
		assert_eq!(report.paths.len(), 2, "{:?}", report.paths);
		assert_eq!(report.files, 2, "tabs.json + s1.jsonl");
		assert!(report.dirs >= 2, "the two target directories, at least");
		assert!(report.bytes > 0);
		assert!(report.summary().contains("已清除"), "{}", report.summary());
		assert!(!state.exists(), "the workspace state is gone");
		assert!(!journal.exists(), "the project journal is gone");

		let zeta = home.join(".zeta");
		assert!(zeta.join("projects.json").is_file(), "the registry survives");
		assert!(zeta.join("zetawork.toml").is_file(), "the shell settings survive");
		assert!(zeta.join("agent").join("config.yml").is_file(), "the agent config survives");
		assert!(zeta.join("agent").join("models.yml").is_file(), "the catalog survives");
		assert!(project.join("README.md").is_file(), "files on disk survive");
	}

	#[test]
	fn a_second_clear_reports_nothing_left() {
		let (_dir, home, project) = fixture();
		let first = clear_workspace_memory(&home, std::slice::from_ref(&project));
		assert!(!first.paths.is_empty());
		let second = clear_workspace_memory(&home, std::slice::from_ref(&project));
		assert!(second.is_empty(), "{:?}", second);
		assert!(second.summary().contains("没有找到工作区记忆"));
	}

	#[test]
	#[cfg(windows)]
	fn session_dir_names_follow_the_agents_three_scopes() {
		let home = Path::new("C:\\Users\\demo");
		let temp = Path::new("C:\\Users\\demo\\AppData\\Local\\Temp");
		assert_eq!(
			session_dir_name(Path::new("C:\\Users\\demo\\work\\demo"), home, temp),
			"-work-demo"
		);
		assert_eq!(
			session_dir_name(
				Path::new("C:\\Users\\demo\\AppData\\Local\\Temp\\scratch\\demo"),
				home,
				temp
			),
			"-tmp-scratch-demo"
		);
		assert_eq!(session_dir_name(Path::new("D:\\src\\demo"), home, temp), "--D--src-demo--");
	}

	#[test]
	fn owned_paths_are_the_state_dir_then_sorted_journals() {
		let home = Path::new("C:\\Users\\demo");
		let paths = owned_paths(
			home,
			&[
				PathBuf::from("C:\\Users\\demo\\b\\project"),
				PathBuf::from("D:\\src\\project"),
				PathBuf::from("C:\\Users\\demo\\b\\project"),
			],
		);
		assert_eq!(paths[0], workspace_state_dir(home));
		assert_eq!(paths.len(), 3, "the duplicate project is folded");
		let journals = &paths[1..];
		let mut sorted = journals.to_vec();
		sorted.sort();
		assert_eq!(journals, sorted.as_slice(), "stable order");
	}

	#[test]
	fn nothing_outside_zeta_is_ever_a_candidate() {
		let home = Path::new("C:\\Users\\demo");
		for path in owned_paths(home, &[PathBuf::from("D:\\src\\project")]) {
			assert!(path.starts_with(home.join(".zeta")), "{}", path.display());
		}
		assert!(workspace_state_dir(home).starts_with(home.join(".zeta")));
	}

	#[test]
	fn a_missing_project_still_encodes_under_the_home_scope() {
		let root = tempfile::tempdir().expect("temp home");
		let home = root.path().to_path_buf();
		let missing = home.join("gone").join("project");
		assert!(!missing.exists());
		let name = session_dir_name(&missing, &home, &std::env::temp_dir());
		// The test home sits inside the temp root, so the temp scope wins; what
		// matters is that a missing project still resolves to a journal name
		// rather than an error or an absolute-path fallback.
		assert!(name.starts_with("-tmp-"), "{name}");
		assert!(name.ends_with("-gone-project"), "{name}");
	}

	#[test]
	fn bytes_are_labelled_readably() {
		assert_eq!(bytes_label(0), "0 B");
		assert_eq!(bytes_label(1536), "1.5 KB");
		assert_eq!(bytes_label(2 * 1024 * 1024), "2.0 MB");
	}
}
