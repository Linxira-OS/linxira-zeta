// SPDX-License-Identifier: AGPL-3.0-only
//! Opt-in spawn probe: one line per child process the GUI starts.
//!
//! The GUI starts very little — `git` and `zetacode` from worker threads, the
//! host file manager, and the local PTY's shell. A console window flashing
//! next to the app is therefore one of these spawns, and this probe names it.
//!
//! Set `ZETACODE_SPAWN_LOG=<path>` before launching the GUI: every spawn
//! appends one line to that file,
//!
//! ```text
//! pid=6128 ppid=4242 argv=["git","-C","C:\\work","status"]
//! ```
//!
//! The probe changes nothing about the child (no flags, no pipes, no window of
//! its own): an unset or empty variable is a no-op, and a write failure is
//! swallowed — a diagnostic must never break the spawn it observes.

use std::io::Write;

/// The environment variable naming the file to append records to.
pub const ENV: &str = "ZETACODE_SPAWN_LOG";

/// True when [`ENV`] names a file, so a caller can skip building an argv it
/// would only hand to [`record`].
pub fn enabled() -> bool {
	std::env::var_os(ENV).is_some_and(|path| !path.is_empty())
}

/// The one line a spawn appends: the child's pid, this process's pid, and the
/// argv the GUI asked for as a JSON array — so a path with a space or a quote
/// stays readable and the line never breaks in two.
pub fn format_record(pid: u32, parent: u32, argv: &[String]) -> String {
	let argv = serde_json::to_string(argv).unwrap_or_else(|_| "[]".to_owned());
	format!("pid={pid} ppid={parent} argv={argv}")
}

/// Append one record to `$ZETACODE_SPAWN_LOG`, when it names a file.
///
/// `argv` is exactly what the GUI handed the child. For the local PTY that is
/// the one command line the terminal widget was given, because termide owns
/// the split into a program and its arguments.
pub fn record(pid: u32, argv: &[&str]) {
	if !enabled() {
		return;
	}
	let Ok(path) = std::env::var(ENV) else {
		return;
	};
	let argv: Vec<String> = argv.iter().map(|arg| (*arg).to_owned()).collect();
	let mut line = format_record(pid, std::process::id(), &argv);
	line.push('\n');
	if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
		let _ = file.write_all(line.as_bytes());
	}
}

/// Append the record for a spawned [`std::process::Command`]: its program and
/// arguments are read back from the command itself, so a caller cannot log an
/// argv different from the one it ran.
pub fn record_command(pid: u32, command: &std::process::Command) {
	if !enabled() {
		return;
	}
	let mut argv = vec![command.get_program().to_string_lossy().into_owned()];
	argv.extend(command.get_args().map(|arg| arg.to_string_lossy().into_owned()));
	let argv: Vec<&str> = argv.iter().map(String::as_str).collect();
	record(pid, &argv);
}

#[cfg(test)]
mod tests {
	use super::format_record;

	#[test]
	fn a_record_is_one_line_with_the_child_the_parent_and_the_argv() {
		let argv = ["git".to_owned(), "-C".to_owned(), r"C:\work dir".to_owned()];
		assert_eq!(
			format_record(6128, 4242, &argv),
			r#"pid=6128 ppid=4242 argv=["git","-C","C:\\work dir"]"#
		);
	}

	#[test]
	fn a_quote_in_an_argument_stays_inside_the_json_array() {
		let argv = [r#"C:\a"b\z.exe"#.to_owned()];
		assert_eq!(
			format_record(1, 2, &argv),
			r#"pid=1 ppid=2 argv=["C:\\a\"b\\z.exe"]"#
		);
	}

	#[test]
	fn an_empty_argv_is_still_a_record() {
		assert_eq!(format_record(7, 8, &[]), "pid=7 ppid=8 argv=[]");
	}
}
