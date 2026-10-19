// SPDX-License-Identifier: AGPL-3.0-only
mod app;
mod busy;
mod editor;
mod files;
mod git;
mod help;
mod layout;
mod rail;
mod resources;
mod settings;
mod shell;
mod slots;
mod suite;
mod tab;
mod tabs_ui;
mod widgets;

use std::process::ExitCode;

/// Which bin name this process was launched as. `zetawork` and `zeta` are
/// both bins of the same npm package (`@linxiraos/main`) and exec the same
/// native binary, so the launcher hands the entry over explicitly
/// ([`ENTRY_FLAG`]); a native install (distro package, `cargo run`) is told
/// apart by `argv[0]`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Entry {
	/// `zetawork` — the workbench: a bare invocation opens the workspace.
	Workbench,
	/// `zeta` — the suite index: a bare invocation prints the help that lists
	/// the three product commands (`zetawork` / `zetacode` / `zetaide`).
	Index,
}

/// Hidden argv the npm launchers prepend so one binary can serve both bins.
/// Stripped before any other parsing — it is a launcher↔binary protocol
/// token, never a user flag.
const ENTRY_FLAG: &str = "--zeta-entry=";

/// What the process is going to do, as a value: [`plan`] is pure so every
/// dispatch (including the bare-`zeta` help) is unit-testable without a
/// terminal, a workspace, or a real companion binary on PATH.
#[derive(Clone, PartialEq, Eq, Debug)]
enum Action {
	/// Print the workbench help (`help::CLI_HELP`).
	Help,
	Version,
	/// Print the suite install report (`suite::doctor`).
	Doctor,
	/// Open the workspace.
	Workbench,
	/// Hand off to a companion tool: exec it with `args` passed through.
	Suite {
		bins: &'static [&'static str],
		args: Vec<String>,
	},
	Unknown(String),
}

fn main() -> ExitCode {
	let mut argv = std::env::args();
	let argv0 = argv.next().unwrap_or_default();
	let mut args: Vec<String> = argv.collect();
	let entry = entry_of(&argv0, take_entry_flag(&mut args).as_deref());

	match plan(entry, &args) {
		Action::Help => {
			print!("{}", help::CLI_HELP);
			ExitCode::SUCCESS
		},
		Action::Version => {
			println!("zetawork {}", env!("CARGO_PKG_VERSION"));
			ExitCode::SUCCESS
		},
		Action::Doctor => {
			print!("{}", suite::doctor());
			ExitCode::SUCCESS
		},
		Action::Suite { bins, args } => run_suite_tool(suite::tool_by_bins(bins), &args),
		Action::Unknown(command) => {
			eprintln!("zetawork: unknown command `{command}` — try `zeta --help`");
			ExitCode::FAILURE
		},
		Action::Workbench => run_workbench(),
	}
}

/// Resolve the entry from the launcher's explicit flag first, then from the
/// invoked file name. Anything unrecognized (a `cargo run` hash path, a
/// distro rename, a stale launcher) falls back to the workbench: opening the
/// workspace is the historical default and never leaves a user stranded.
fn entry_of(argv0: &str, explicit: Option<&str>) -> Entry {
	match explicit {
		Some("workbench") => return Entry::Workbench,
		Some("zeta") => return Entry::Index,
		_ => {},
	}
	match bin_stem(argv0).as_str() {
		"zeta" => Entry::Index,
		_ => Entry::Workbench,
	}
}

/// The bare file stem of an argv[0]: directory and Windows `.exe` stripped,
/// lowercased (`C:\npm\zetawork.EXE` → `zetawork`).
fn bin_stem(argv0: &str) -> String {
	let leaf = argv0.rsplit(['/', '\\']).next().unwrap_or(argv0);
	let lowered = leaf.to_ascii_lowercase();
	lowered.strip_suffix(".exe").unwrap_or(&lowered).to_string()
}

/// Pull the launcher's entry token out of argv (and out of the process's
/// argument list, so it can never reach a passthrough child).
fn take_entry_flag(args: &mut Vec<String>) -> Option<String> {
	let index = args.iter().position(|a| a.starts_with(ENTRY_FLAG))?;
	let value = args[index][ENTRY_FLAG.len()..].to_string();
	args.remove(index);
	Some(value)
}

/// The whole argv contract in one pure function.
fn plan(entry: Entry, args: &[String]) -> Action {
	let Some(first) = args.first() else {
		return match entry {
			Entry::Index => Action::Help,
			Entry::Workbench => Action::Workbench,
		};
	};
	match first.as_str() {
		// Every help/version spelling users reach for; the CLI's own help
		// lives at `zetacode --help`.
		"--help" | "-help" | "-h" | "help" => Action::Help,
		"--version" | "-version" | "-v" | "version" => Action::Version,
		"doctor" => Action::Doctor,
		// The `code`/`ide` subcommands hand off to the companion tools
		// (first-letter forms mirror the workbench's per-pane hotkeys
		// Alt+C / Alt+I). The bin candidates and install hints come from the
		// suite table — no local copies.
		"code" | "c" => Action::Suite { bins: suite::CODING_BINS, args: args[1..].to_vec() },
		"ide" | "i" => Action::Suite { bins: suite::IDE_BINS, args: args[1..].to_vec() },
		// The only local server the workbench knows about is the Zeta serve
		// machine: full Web UI on loopback for the browser. `served` as
		// `zetacode serve`, with the user's remaining flags passed through.
		"web" | "server" => web_action(&args[1..]),
		// `work` and a bare invocation open the workspace.
		"work" => Action::Workbench,
		// Flags (and anything else starting with `-`) are the workbench's own.
		other if other.starts_with('-') => Action::Workbench,
		other => Action::Unknown(other.to_string()),
	}
}

/// `zetawork web [flags…]` → `zetacode serve [flags…]`.
fn web_action(rest: &[String]) -> Action {
	let mut args = Vec::with_capacity(rest.len() + 1);
	args.push("serve".to_string());
	args.extend_from_slice(rest);
	Action::Suite { bins: suite::CODING_BINS, args }
}

/// Open the workspace, behind the unified nesting guard: a bare `zetawork`
/// typed into a terminal pane would spawn a workbench inside a workbench —
/// two terminal simulators fighting over one output stream.
fn run_workbench() -> ExitCode {
	if is_nested_workbench(std::env::var("ZETA_WORKBENCH").ok().as_deref()) {
		eprintln!("zetawork: cannot run inside another zetawork (nesting is not supported)");
		return ExitCode::from(2);
	}
	match app::run() {
		Ok(()) => ExitCode::SUCCESS,
		Err(error) => {
			eprintln!("zetawork: {error:#}");
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
		eprintln!("zetawork: unknown suite tool — try `zeta --help`");
		return ExitCode::FAILURE;
	};
	let Some(path) = suite::resolve_bin(tool.bins) else {
		eprintln!("zetawork: {} not found (looked for {}).", tool.bins[0], tool.bins.join(", "));
		if let Some(cmd) = tool.install_command() {
			eprintln!();
			eprintln!("  install it with:");
			eprintln!("      {cmd}");
			eprintln!();
			eprintln!("  or launch the workbench (`zetawork`) and split a pane — it");
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
			"zetawork: found {} but no native runner for its shim on this machine — launch the \
			 workbench (`zetawork`) and split a pane instead.",
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
			eprintln!("zetawork: failed to launch: {error}");
			ExitCode::FAILURE
		},
	}
}

/// Whether this process would nest a workbench inside another one. Every
/// workbench pane PTY carries `ZETA_WORKBENCH=1` (the same probe the agent
/// TUI reads to light up hyperlinks), so a bare `zetawork` typed into a
/// terminal pane would spawn a workbench inside a workbench — two terminal
/// simulators fighting over one output stream. Pure so both states stay
/// testable.
fn is_nested_workbench(zeta_workbench: Option<&str>) -> bool {
	zeta_workbench == Some("1")
}

#[cfg(test)]
mod tests {
	use super::*;

	fn argv(list: &[&str]) -> Vec<String> {
		list.iter().map(|s| s.to_string()).collect()
	}

	#[test]
	fn nesting_guard_rejects_only_the_probe_value() {
		assert!(is_nested_workbench(Some("1")), "the injected probe value nests");
		assert!(!is_nested_workbench(Some("0")), "an unset-looking value does not");
		assert!(!is_nested_workbench(Some("")));
		assert!(!is_nested_workbench(None), "outside any workbench starts fine");
	}

	#[test]
	fn bare_zeta_prints_help_and_bare_zetawork_opens_the_workspace() {
		assert_eq!(plan(Entry::Index, &[]), Action::Help);
		assert_eq!(plan(Entry::Workbench, &[]), Action::Workbench);
	}

	#[test]
	fn help_lists_exactly_the_three_product_commands() {
		// The index command is the discovery surface for the whole suite: a
		// rename that forgets this text leaves users with a help that names
		// commands which no longer exist.
		for bin in ["zetawork", "zetacode", "zetaide"] {
			assert!(help::CLI_HELP.contains(bin), "help must list `{bin}`");
		}
		assert!(
			help::CLI_HELP.contains("zetawork web"),
			"help must document the `zetawork web` subcommand"
		);
	}

	#[test]
	fn help_and_version_work_from_both_bins() {
		for entry in [Entry::Index, Entry::Workbench] {
			assert_eq!(plan(entry, &argv(&["--help"])), Action::Help);
			assert_eq!(plan(entry, &argv(&["help"])), Action::Help);
			assert_eq!(plan(entry, &argv(&["-h"])), Action::Help);
			assert_eq!(plan(entry, &argv(&["--version"])), Action::Version);
			assert_eq!(plan(entry, &argv(&["version"])), Action::Version);
		}
	}

	#[test]
	fn workbench_flags_still_open_the_workspace() {
		for flag in ["--config", "--resume", "--approval-mode=yolo", "-x"] {
			assert_eq!(
				plan(Entry::Workbench, &argv(&[flag])),
				Action::Workbench,
				"`{flag}` is a workbench flag"
			);
		}
		assert_eq!(plan(Entry::Workbench, &argv(&["work"])), Action::Workbench);
	}

	#[test]
	fn suite_subcommands_hand_off_to_the_canonical_bins() {
		assert_eq!(
			plan(Entry::Workbench, &argv(&["code", "--resume"])),
			Action::Suite { bins: suite::CODING_BINS, args: argv(&["--resume"]) }
		);
		assert_eq!(
			plan(Entry::Workbench, &argv(&["c"])),
			Action::Suite { bins: suite::CODING_BINS, args: vec![] }
		);
		assert_eq!(
			plan(Entry::Workbench, &argv(&["ide", "src/main.rs"])),
			Action::Suite { bins: suite::IDE_BINS, args: argv(&["src/main.rs"]) }
		);
		assert_eq!(
			plan(Entry::Workbench, &argv(&["i"])),
			Action::Suite { bins: suite::IDE_BINS, args: vec![] }
		);
	}

	#[test]
	fn web_subcommand_runs_the_serve_machine() {
		// The workbench owns no server of its own: `zetawork web` is the
		// coding CLI's `serve` (full Web UI + gateway on loopback).
		assert_eq!(
			plan(Entry::Workbench, &argv(&["web"])),
			Action::Suite { bins: suite::CODING_BINS, args: argv(&["serve"]) }
		);
		assert_eq!(
			plan(Entry::Workbench, &argv(&["web", "--web-port", "30241"])),
			Action::Suite { bins: suite::CODING_BINS, args: argv(&["serve", "--web-port", "30241"]) }
		);
		// `server` is the accepted second spelling of the same subcommand.
		assert_eq!(
			plan(Entry::Workbench, &argv(&["server"])),
			Action::Suite { bins: suite::CODING_BINS, args: argv(&["serve"]) }
		);
	}

	#[test]
	fn doctor_reports_the_suite() {
		assert_eq!(plan(Entry::Workbench, &argv(&["doctor"])), Action::Doctor);
	}

	#[test]
	fn unknown_commands_fail_instead_of_opening_the_workspace() {
		assert_eq!(
			plan(Entry::Workbench, &argv(&["frobnicate"])),
			Action::Unknown("frobnicate".to_string())
		);
		// The editor is no longer a product command (the workbench's editor
		// pane is built in), so the old hand-off word must not resolve.
		assert_eq!(plan(Entry::Workbench, &argv(&["editor"])), Action::Unknown("editor".to_string()));
		assert_eq!(plan(Entry::Workbench, &argv(&["e"])), Action::Unknown("e".to_string()));
	}

	#[test]
	fn entry_flag_beats_argv0_and_is_stripped_from_argv() {
		let mut args = argv(&["--zeta-entry=zeta", "web"]);
		let explicit = take_entry_flag(&mut args);
		assert_eq!(explicit.as_deref(), Some("zeta"));
		assert_eq!(args, argv(&["web"]), "the protocol token never reaches a child");
		// The vendored platform leaf is named `zeta.exe`; only the launcher's
		// token tells the two bins apart.
		assert_eq!(entry_of("/usr/local/bin/zeta.exe", None), Entry::Index);
		assert_eq!(entry_of("/usr/local/bin/zetawork.exe", None), Entry::Workbench);
		assert_eq!(entry_of("/usr/local/bin/zeta.exe", explicit.as_deref()), Entry::Index);
		assert_eq!(entry_of("/usr/local/bin/zeta.exe", Some("workbench")), Entry::Workbench);

		let mut none = argv(&["doctor"]);
		assert_eq!(take_entry_flag(&mut none), None);
		assert_eq!(none, argv(&["doctor"]));
	}

	#[test]
	fn native_bin_names_pick_their_entry() {
		assert_eq!(entry_of("/usr/local/bin/zetawork", None), Entry::Workbench);
		assert_eq!(entry_of(r"C:\Program Files\Zeta\zetawork.exe", None), Entry::Workbench);
		assert_eq!(entry_of(r"C:\Program Files\Zeta\ZETA.EXE", None), Entry::Index);
		// Anything unrecognized (a `cargo run` temp path, a distro rename)
		// keeps the historical default: open the workspace.
		assert_eq!(entry_of(r"C:\repo\main\target\debug\deps\zeta-1234abcd", None), Entry::Workbench);
		assert_eq!(entry_of("", None), Entry::Workbench);
	}

	#[test]
	fn bin_stem_normalizes_directory_and_exe_suffix() {
		assert_eq!(bin_stem("zeta"), "zeta");
		assert_eq!(bin_stem("Zeta.exe"), "zeta");
		assert_eq!(bin_stem("/usr/bin/zeta"), "zeta");
		assert_eq!(bin_stem(r"C:\Users\a b\AppData\Roaming\npm\zetawork.cmd"), "zetawork.cmd");
	}
}
