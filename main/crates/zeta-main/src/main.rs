mod app;
mod help;
mod layout;
mod shell;
mod suite;
mod tab;
mod tabs_ui;
mod widgets;

use std::process::ExitCode;

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
		// First-letter forms too: `zeta c/e/i` mirror the workbench's
		// per-pane hotkeys (Alt+C/E/I). The bin candidates and install
		// hints come from the suite table — no local copies.
		Some("code" | "c") => return run_suite_tool(suite::tool_by_bins(&["zeta-c"]), &args[1..]),
		Some("editor" | "e") => {
			return run_suite_tool(suite::tool_by_bins(&["zeta-editor"]), &args[1..]);
		},
		Some("ide" | "i") => return run_suite_tool(suite::tool_by_bins(&["zeta-ide"]), &args[1..]),
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

/// Exec a suite tool by its suite-table entry, passing arguments through.
/// When the tool is missing, print the exact canonical install command
/// (`SuiteTool::install_command` — the same string `zeta doctor` prints)
/// instead of a bare error — the workbench installs in-pane; the CLI tells
/// you how.
fn run_suite_tool(tool: Option<&'static suite::SuiteTool>, passthrough: &[String]) -> ExitCode {
	let Some(tool) = tool else {
		eprintln!("zeta: unknown suite tool — try `zeta --help`");
		return ExitCode::FAILURE;
	};
	let Some(path) = suite::resolve_bin(tool.bins) else {
		eprintln!("zeta: {} not found (looked for {}).", tool.bins[0], tool.bins.join(", "));
		if let Some(cmd) = tool.install_command() {
			eprintln!();
			eprintln!("  install it with:");
			eprintln!("      {cmd}");
			eprintln!();
			eprintln!("  or launch the workbench (`zeta`) and split a pane — it");
			eprintln!("  installs suite tools for you.");
		}
		return ExitCode::FAILURE;
	};
	// npm's Windows installs are shims (.ps1/.cmd/sh), not executables —
	// hand them to their native runner instead of CreateProcess on the
	// shim itself (which fails: .cmd is not a valid Win32 application).
	let candidates = shell::resolve_bin_candidates(tool.bins);
	let Some(mut cmd) = shell::plan_exec(&candidates, passthrough) else {
		eprintln!(
			"zeta: found {} but no native runner for its shim on this machine — \
			 launch the workbench (`zeta`) and split a pane instead.",
			path.display()
		);
		return ExitCode::FAILURE;
	};
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
