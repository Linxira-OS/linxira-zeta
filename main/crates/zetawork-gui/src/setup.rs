// SPDX-License-Identifier: AGPL-3.0-only
//! `.zeta/setup`: the script a repository may want run once per new workspace.
//!
//! # Why it is opt-in twice
//!
//! A checkout that arrives with a script is code someone else wrote, and
//! running it on open would make "look at this repository" equivalent to "run
//! its code". So a repository's script runs only when the user ticked the box
//! in the new-workspace form, and the tick is what grants **trust**: a list of
//! absolute paths in `~/.zeta/workbench/trusted-repos.json`. The next workspace
//! of a trusted repository gets the box pre-ticked; a repository with no script
//! never shows the box at all.
//!
//! # How it runs
//!
//! On a worker thread, one at a time, with the workspace as the working
//! directory. `sh` on Unix, `bash` then `sh` on Windows, and — this is a GUI
//! parent process — the child is spawned **hidden** ([`CREATE_NO_WINDOW`]) so a
//! setup script never flashes a console window.
//!
//! [`CREATE_NO_WINDOW`]: https://learn.microsoft.com/windows/win32/procthread/process-creation-flags

use std::{
	fs, io,
	path::{Path, PathBuf},
	process::Command,
	sync::mpsc::{Receiver, channel},
};

use serde_json::{Value, json};

/// The script a workspace may carry.
pub fn script_path(workspace: &Path) -> PathBuf {
	workspace.join(".zeta").join("setup")
}

/// Does this checkout bring a setup script?
pub fn has_script(workspace: &Path) -> bool {
	script_path(workspace).is_file()
}

/// The repositories the user has trusted to run their setup script.
pub struct Trust {
	path: PathBuf,
	repos: Vec<String>,
}

impl Trust {
	pub fn load() -> Self {
		let path = state_root().join("workbench").join("trusted-repos.json");
		let repos = fs::read_to_string(&path)
			.ok()
			.and_then(|text| serde_json::from_str::<Value>(&text).ok())
			.and_then(|value| value.as_array().cloned())
			.map(|rows| {
				rows
					.iter()
					.filter_map(|row| row.as_str().map(str::to_owned))
					.collect()
			})
			.unwrap_or_default();
		Self { path, repos }
	}

	/// Is this repository (by absolute path) in the list?
	pub fn is_trusted(&self, workspace: &Path) -> bool {
		let key = key_of(workspace);
		self.repos.iter().any(|repo| repo == &key)
	}

	/// Add it, sorted, and persist. Trust is per checkout path, not per
	/// repository name: a clone in a different directory is a new decision.
	pub fn trust(&mut self, workspace: &Path) -> io::Result<()> {
		let key = key_of(workspace);
		if self.repos.iter().any(|repo| repo == &key) {
			return Ok(());
		}
		self.repos.push(key);
		self.repos.sort();
		if let Some(dir) = self.path.parent() {
			fs::create_dir_all(dir)?;
		}
		let rows: Vec<Value> = self.repos.iter().map(|repo| json!(repo)).collect();
		let text = serde_json::to_string_pretty(&Value::Array(rows)).map_err(io::Error::other)?;
		fs::write(&self.path, text)
	}
}

/// `~/.zeta`, the same root the settings file uses.
fn state_root() -> PathBuf {
	crate::settings::settings_path()
		.parent()
		.map(Path::to_path_buf)
		.unwrap_or_else(|| PathBuf::from("."))
}

/// The absolute path a trust decision is recorded under. `canonicalize` when
/// the directory exists (symlinked checkouts resolve to one entry), the plain
/// path otherwise.
fn key_of(workspace: &Path) -> String {
	fs::canonicalize(workspace)
		.unwrap_or_else(|_| workspace.to_path_buf())
		.to_string_lossy()
		.into_owned()
}

/// One setup run at a time, on a worker thread.
#[derive(Default)]
pub struct SetupRunner {
	pending: Option<Receiver<Result<String, String>>>,
}

impl SetupRunner {
	pub fn busy(&self) -> bool {
		self.pending.is_some()
	}

	/// Start `workspace`'s script. `false` when one is already running.
	pub fn run(&mut self, workspace: PathBuf) -> bool {
		if self.pending.is_some() {
			return false;
		}
		let (sender, receiver) = channel();
		std::thread::spawn(move || {
			let _ = sender.send(run_blocking(&workspace));
		});
		self.pending = Some(receiver);
		true
	}

	/// The finished run's outcome, once: the script's last output when it
	/// succeeded, its exit status and output when it did not.
	pub fn poll(&mut self) -> Option<Result<String, String>> {
		let result = self.pending.as_ref()?.try_recv().ok()?;
		self.pending = None;
		Some(result)
	}
}

fn run_blocking(workspace: &Path) -> Result<String, String> {
	let script = script_path(workspace);
	if !script.is_file() {
		return Err(format!("no setup script at {}", script.display()));
	}
	let mut last: Option<io::Error> = None;
	for shell in shells() {
		let mut command = Command::new(shell);
		command.arg(&script).current_dir(workspace);
		// A GUI parent must never flash a console window for its child.
		#[cfg(windows)]
		{
			use std::os::windows::process::CommandExt;
			const CREATE_NO_WINDOW: u32 = 0x0800_0000;
			command.creation_flags(CREATE_NO_WINDOW);
		}
		match command.output() {
			Ok(output) => {
				let tail = tail_of(&output);
				if output.status.success() {
					return Ok(tail);
				}
				let code = output
					.status
					.code()
					.map(|code| code.to_string())
					.unwrap_or_else(|| "signal".to_owned());
				return Err(format!("{code}\n{tail}"));
			},
			// `sh` missing is the only reason to try the next name.
			Err(error) => last = Some(error),
		}
	}
	Err(
		last
			.map(|error| error.to_string())
			.unwrap_or_else(|| "no shell found".to_owned()),
	)
}

/// The shells to try, in order. Windows first tries `bash` (Git for Windows)
/// and falls back to `sh`; Unix uses `sh` alone.
fn shells() -> &'static [&'static str] {
	if cfg!(windows) {
		&["bash", "sh"]
	} else {
		&["sh"]
	}
}

/// The last few lines of the child's output, stdout and stderr together: a
/// setup script's useful line is the one at the bottom, and a notice strip has
/// one line's worth of room.
fn tail_of(output: &std::process::Output) -> String {
	let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
	text.push_str(&String::from_utf8_lossy(&output.stderr));
	let lines: Vec<&str> = text
		.lines()
		.filter(|line| !line.trim().is_empty())
		.collect();
	lines[lines.len().saturating_sub(3)..].join(" · ")
}

#[cfg(test)]
mod tests {
	use super::*;

	fn temp(name: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("zetawork-setup-{}-{name}", std::process::id()));
		let _ = fs::remove_dir_all(&dir);
		fs::create_dir_all(&dir).expect("dir");
		dir
	}

	#[test]
	fn a_script_is_recognised_only_where_it_exists() {
		let dir = temp("script");
		assert!(!has_script(&dir));
		fs::create_dir_all(dir.join(".zeta")).expect("dir");
		fs::write(script_path(&dir), "#!/bin/sh\n").expect("write");
		assert!(has_script(&dir));
	}

	#[test]
	fn trust_is_per_path_and_survives_a_reload() {
		let dir = temp("trust");
		let mut trust = Trust { path: dir.join("trusted-repos.json"), repos: Vec::new() };
		assert!(!trust.is_trusted(&dir));
		trust.trust(&dir).expect("trust");
		assert!(trust.is_trusted(&dir));
		let reloaded = Trust {
			path: dir.join("trusted-repos.json"),
			repos: fs::read_to_string(dir.join("trusted-repos.json"))
				.ok()
				.and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
				.unwrap_or_default(),
		};
		assert!(reloaded.is_trusted(&dir), "the file is the record");
		assert!(!reloaded.is_trusted(&temp("trust-other")));
	}

	#[cfg(unix)]
	#[test]
	fn a_successful_script_reports_its_output_and_a_failing_one_its_status() {
		let dir = temp("run");
		fs::create_dir_all(dir.join(".zeta")).expect("dir");
		fs::write(script_path(&dir), "#!/bin/sh\necho prepared > marker.txt\necho done\n")
			.expect("write");
		let mut runner = SetupRunner::default();
		assert!(runner.run(dir.clone()));
		let result = loop {
			if let Some(result) = runner.poll() {
				break result;
			}
			std::thread::sleep(std::time::Duration::from_millis(20));
		};
		assert_eq!(result.as_deref(), Ok("done"));
		assert!(dir.join("marker.txt").is_file(), "the script ran in the workspace");

		fs::write(script_path(&dir), "#!/bin/sh\necho boom >&2\nexit 3\n").expect("write");
		let mut runner = SetupRunner::default();
		assert!(runner.run(dir.clone()));
		let result = loop {
			if let Some(result) = runner.poll() {
				break result;
			}
			std::thread::sleep(std::time::Duration::from_millis(20));
		};
		let error = result.expect_err("a non-zero exit is a failure");
		assert!(error.starts_with('3'), "{error}");
		assert!(error.contains("boom"), "{error}");
	}
}
