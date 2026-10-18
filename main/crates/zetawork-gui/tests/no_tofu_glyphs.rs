// SPDX-License-Identifier: AGPL-3.0-only
//! Guard: rendered strings must not use codepoints the bundled faces lack.
//!
//! The seven-state icons are **painted** (`widgets::status_dot`) and the tree
//! carets are ASCII, precisely because the hosts we tested render `◐ ▾ ▸ ✓ ✕ ✗`
//! as tofu boxes. A banned character appearing in a *string literal* therefore
//! means a later edit reintroduced the box — this test is the tripwire, not a
//! style rule (comments and module docs may name the glyphs to explain why they
//! are banned).

use std::{
	fs,
	path::{Path, PathBuf},
};

/// Faces we tested (the host CJK face + egui's stocks) have none of these.
///
/// `⋯` (U+22EF) is here because it shipped as a box: the 大标签页 and project
/// row drew the character for their 更多 affordance, and the window rendered
/// tofu. Both now paint three dots (`icons::paint_more`).
const BANNED: [char; 7] = ['◐', '▾', '▸', '✓', '✕', '✗', '⋯'];

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
	for entry in fs::read_dir(dir).expect("read the source directory") {
		let path = entry.expect("read one entry").path();
		if path.is_dir() {
			collect(&path, out);
		} else if path.extension().is_some_and(|ext| ext == "rs") {
			out.push(path);
		}
	}
}

/// Every `file:line` whose non-comment text contains a banned codepoint.
fn offenders(file: &Path) -> Vec<String> {
	let text = fs::read_to_string(file).expect("read a Rust source");
	let mut hits = Vec::new();
	for (index, line) in text.lines().enumerate() {
		let trimmed = line.trim_start();
		if trimmed.starts_with("//") {
			continue;
		}
		if let Some(bad) = BANNED.iter().find(|glyph| line.contains(**glyph)) {
			hits.push(format!("{}:{}: {bad}", file.display(), index + 1));
		}
	}
	hits
}

#[test]
fn rendered_strings_never_use_a_missing_glyph() {
	let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
	let mut sources = Vec::new();
	collect(&manifest.join("src"), &mut sources);
	collect(&manifest.join("../zeta-main/src"), &mut sources);
	assert!(sources.len() > 20, "the scan must actually see both crates");

	let hits: Vec<String> = sources.iter().flat_map(|file| offenders(file)).collect();
	assert!(
		hits.is_empty(),
		"these lines render a codepoint the bundled faces lack (paint it with widgets::status_dot, \
		 or use an ASCII caret):\n{}",
		hits.join("\n")
	);
}
