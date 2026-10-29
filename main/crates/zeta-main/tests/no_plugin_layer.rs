// SPDX-License-Identifier: AGPL-3.0-only
//! The workbench TUI carries **no** plugin layer — and cannot start one by
//! accident.
//!
//! The 2026-10-20 ruling is explicit: a plugin is behaviour (tools, commands,
//! hooks), declarative panels and web pages. The desktop (`zetawork-gui`) hosts
//! Zeta's panel layer; `zeta-main` (the workbench TUI) hosts none of it, and no
//! plugin hook may be added to it. `zetaide` carries TermIDE's own upstream
//! plugin layer as of the 0.46 vendor bump, which is separate from Zeta's
//! plugin surface.
//!
//! So the guard is a source scan: the tokens below are the *names* a plugin
//! layer is reachable by. None may appear in the TUI tree. The scan is textual
//! on purpose — a `cfg`-gated import or a comment describing an intention is
//! the same regression, and a test that only exercised the built binary would
//! miss both.

use std::path::{Path, PathBuf};

/// Names a plugin layer is reachable by. Deliberately specific: the word
/// "plugin" alone would trip on unrelated prose and make the guard noise.
const FORBIDDEN: [&str; 6] = [
	"plugin_panels",
	"plugin.json",
	"zetacode plugins panel",
	"RightTab::Plugin",
	"plugins/panel",
	"ui.panels",
];

/// `main/crates/zeta-main` from this crate's manifest directory.
fn tui_root() -> PathBuf {
	PathBuf::from(env!("CARGO_MANIFEST_DIR"))
		.parent()
		.expect("main/crates")
		.join("zeta-main")
}

/// Every `.rs` file under `root`, skipping build output.
fn rust_files(root: &Path) -> Vec<PathBuf> {
	let mut files = Vec::new();
	let mut stack = vec![root.to_path_buf()];
	while let Some(dir) = stack.pop() {
		let Ok(entries) = std::fs::read_dir(&dir) else {
			continue;
		};
		for entry in entries.flatten() {
			let path = entry.path();
			if path.is_dir() {
				if path.file_name().is_some_and(|name| name == "target") {
					continue;
				}
				stack.push(path);
				continue;
			}
			// This file names every forbidden token; scanning it would make the
			// guard fail on itself.
			if path
				.file_name()
				.is_some_and(|name| name == "no_plugin_layer.rs")
			{
				continue;
			}
			if path.extension().is_some_and(|ext| ext == "rs") {
				files.push(path);
			}
		}
	}
	files.sort();
	files
}

fn assert_no_plugin_layer(root: &Path, host: &str) {
	let files = rust_files(root);
	assert!(files.len() > 5, "{host}: the scan found {} files, so the tree is there", files.len());
	for file in files {
		let Ok(source) = std::fs::read_to_string(&file) else {
			continue;
		};
		for token in FORBIDDEN {
			assert!(
				!source.contains(token),
				"{host} must carry no plugin layer, but {} mentions `{token}`",
				file.display()
			);
		}
	}
}

#[test]
fn the_tui_has_no_plugin_layer() {
	assert_no_plugin_layer(&tui_root(), "zeta-main (the workbench TUI)");
}
