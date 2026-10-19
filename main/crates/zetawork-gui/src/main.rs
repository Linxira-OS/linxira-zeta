// SPDX-License-Identifier: AGPL-3.0-only
//! `zetawork-gui` — the GUI shell of the Zeta workbench.

fn main() -> eframe::Result<()> {
	// `--version` answers before `run()` builds a viewport: the release smoke
	// checks and the updater's refusal rule read this one line, and a headless
	// CI runner must not need a window to get it.
	if std::env::args()
		.skip(1)
		.any(|arg| arg == "--version" || arg == "-V")
	{
		println!("zetawork {}", zetawork_gui::VERSION);
		return Ok(());
	}
	zetawork_gui::run()
}
