mod app;
mod help;
mod layout;
mod tab;
mod tabs_ui;

use std::process::ExitCode;

fn main() -> ExitCode {
	let args: Vec<String> = std::env::args().skip(1).collect();
	for arg in &args {
		match arg.as_str() {
			"--help" | "-h" | "help" => {
				print!("{}", help::CLI_HELP);
				return ExitCode::SUCCESS;
			},
			"--version" | "-v" | "version" => {
				println!("zeta {}", env!("CARGO_PKG_VERSION"));
				return ExitCode::SUCCESS;
			},
			_ => {},
		}
	}
	match app::run() {
		Ok(()) => ExitCode::SUCCESS,
		Err(error) => {
			eprintln!("zeta: {error:#}");
			ExitCode::FAILURE
		},
	}
}
