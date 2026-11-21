// SPDX-License-Identifier: AGPL-3.0-only
//! The crate's own source carries no placeholder walls.
//!
//! There is no runtime UI harness to read every rendered surface, so this test
//! scans the source: the strings the maintainer banned may not appear in any
//! non-test module. `#[cfg(test)]` modules are cut off first, because the tests
//! themselves have to spell the banned strings to assert their absence.

use std::path::PathBuf;

const BANNED: [&str; 4] = ["占位", "尚未接入", "未来数据源", "未接线"];

fn source_files() -> Vec<PathBuf> {
	let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
	let mut files: Vec<PathBuf> = std::fs::read_dir(&src)
		.expect("src directory")
		.flatten()
		.map(|entry| entry.path())
		.filter(|path| path.extension().is_some_and(|ext| ext == "rs"))
		.collect();
	files.sort();
	assert!(files.len() > 10, "the scan found the crate");
	files
}

/// The file's text up to its first `#[cfg(test)]`, so test spellings of the
/// banned strings do not count as product copy.
fn product_text(source: &str) -> &str {
	match source.find("\n#[cfg(test)]") {
		Some(at) => &source[..at],
		None => source,
	}
}

#[test]
fn the_crate_has_no_placeholder_copy() {
	for path in source_files() {
		let source = std::fs::read_to_string(&path).expect("read source");
		let text = product_text(&source);
		for banned in BANNED {
			assert!(!text.contains(banned), "{} still contains `{banned}`", path.display());
		}
	}
}

#[test]
fn the_seeded_workspace_is_one_terminal() {
	use zetawork_gui::state::SessionKind;
	let cwd = std::env::current_dir().expect("cwd");
	let project = zetawork_gui::seed::local_project(&cwd);
	let workspace = &project.workspaces[0];
	assert_eq!(workspace.panes.len(), 1, "one pane");
	assert_eq!(workspace.panes[0].tabs.len(), 1, "one tab");
	assert_eq!(workspace.panes[0].tabs[0].kind, SessionKind::Term);
	assert!(workspace.panes[0].tabs[0].doc.is_none());
	assert!(workspace.panes[0].tabs[0].command.is_none());
}
