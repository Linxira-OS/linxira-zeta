// SPDX-License-Identifier: AGPL-3.0-only
//! `zetawork-gui` — the GUI shell of the Zeta workbench.
//!
//! Windows builds link as a **GUI** subsystem binary: launching the app from
//! Explorer, the Start Menu or a shortcut must not open a console. That also
//! means stdout/stderr have no console by default, so `--version` (read by the
//! release smoke test and the updater) attaches to the calling terminal's
//! console when there is one.
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() -> eframe::Result<()> {
	// `--version` answers before `run()` builds a viewport: the release smoke
	// checks and the updater's refusal rule read this one line, and a headless
	// CI runner must not need a window to get it.
	if std::env::args()
		.skip(1)
		.any(|arg| arg == "--version" || arg == "-V")
	{
		zetawork_gui::console::emit_line(&format!("zetawork {}", zetawork_gui::VERSION));
		return Ok(());
	}
	zetawork_gui::run()
}
