mod app;
mod help;
mod layout;
mod suite;
mod tab;
mod tabs_ui;
mod widgets;

use std::process::{Command, ExitCode};

fn main() -> ExitCode {
	let args: Vec<String> = std::env::args().skip(1).collect();
	match args.first().map(|s| s.as_str()) {
		// Every help/version spelling users reach for: `--help`, `-help`,
		// `-h`, `help`; the CLI's own help lives at `zetacode --help`.
		Some("--help" | "-help" | "-h" | "help") => {
			print!("{}", help::CLI_HELP);
			return ExitCode::SUCCESS;
		},
		Some("--version" | "-version" | "-v" | "version") => {
			println!("zeta {}", env!("CARGO_PKG_VERSION"));
			return ExitCode::SUCCESS;
		},
		// `zeta code` hands off to the coding CLI (the primary surface many
		// users live in); remaining arguments pass through untouched.
		// First-letter forms too: `zeta c/e/i/f` mirror the workbench's
		// per-tool hotkeys (Alt+C/E/I/F).
		Some("code" | "c") => return run_suite_tool(&["zeta-c", "zeta", "zetacode"], &args[1..]),
		Some("editor" | "e") => return run_suite_tool(&["zeta-e", "zeta-editor"], &args[1..]),
		Some("ide" | "i") => return run_suite_tool(&["zeta-i", "zeta-ide"], &args[1..]),
		Some("files" | "f") => return run_suite_tool(&["yazi"], &args[1..]),
		Some("doctor") => {
			print!("{}", suite::doctor());
			return ExitCode::SUCCESS;
		},
		// `zeta work` and bare `zeta` both open the workspace (`zetawork` /
		// `zeta-work` are npm bin aliases of the same binary).
		Some("work") => {},
		Some(other) if other.starts_with('-') => {},
		Some(unknown) => {
			eprintln!("zeta: unknown command `{unknown}` — try `zeta --help`");
			return ExitCode::FAILURE;
		},
		None => {},
	}
	match app::run() {
		Ok(()) => ExitCode::SUCCESS,
		Err(error) => {
			eprintln!("zeta: {error:#}");
			ExitCode::FAILURE
		},
	}
}

/// Exec a suite tool by its bin candidates, passing arguments through. When
/// the tool is missing, print the exact quick-install command instead of a
/// bare error — the workbench installs in-pane; the CLI tells you how.
fn run_suite_tool(bins: &[&str], passthrough: &[String]) -> ExitCode {
	let Some(path) = suite::resolve_bin(bins) else {
		let install = suite::install_for(bins);
		eprintln!("zeta: tool not found (looked for {}).", bins.join(", "));
		if let Some(cmd) = install {
			eprintln!();
			eprintln!("  install it with:");
			eprintln!("      {cmd}");
			eprintln!();
			eprintln!("  or launch the workbench (`zeta`) and split a pane — it");
			eprintln!("  installs suite tools for you.");
		}
		return ExitCode::FAILURE;
	};
	let mut cmd = Command::new(path);
	cmd.args(passthrough);
	match cmd.status() {
		Ok(status) => match status.code() {
			Some(code) => ExitCode::from(code as u8),
			None => ExitCode::FAILURE,
		},
		Err(error) => {
			eprintln!("zeta: failed to launch: {error}");
			ExitCode::FAILURE
		},
	}
}
