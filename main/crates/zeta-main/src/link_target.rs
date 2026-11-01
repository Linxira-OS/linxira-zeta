// SPDX-License-Identifier: AGPL-3.0-only
//! Where a clicked link leads, and which embedded panel opens it.
//!
//! A terminal prints file references in the shapes its programs write them:
//! a plain path, a `path:line:col` suffix, or one of the session's internal
//! URIs (`local://plan.md`, `artifact://build.log`). The GUI resolves those
//! with its own `link` module (`zetawork-gui/src/link.rs`); this is the
//! workbench's copy of the same text model — [`expand`], [`split_position`]
//! (the GUI's `suffix_after` + `number`) and the `~/.zeta` mapping for the URI
//! schemes that do name a file — so a click opens the file the text names
//! instead of a path spelled with a scheme in it.
//!
//! Not every scheme names a file: `agent://` is a subagent's saved output and
//! `out://` is the agent's mid-turn reply channel, neither of which is stored
//! as a file this workbench could open. Those resolve to `None`, and the
//! caller reports that instead of opening something unrelated.

use std::path::{Path, PathBuf};

/// A link's target: the file it named, plus the position written after it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenTarget {
	pub path: PathBuf,
	/// `:42` — the line the link named.
	pub line: Option<u32>,
	/// `:42:7` — the column after it.
	pub col: Option<u32>,
}

impl OpenTarget {
	/// The position from a panel's own event, which wins over the text's.
	pub fn with_position(mut self, line: Option<u32>, col: Option<u32>) -> Self {
		self.line = line.or(self.line);
		self.col = col.or(self.col);
		self
	}
}

/// The embedded panel a target opens in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Panel {
	/// A Markdown document: the rendered viewer, never the text editor.
	Markdown,
	/// A source file the IDE page hosts in an editor tab.
	Ide,
	/// Anything else text-shaped: the standalone embedded editor.
	Editor,
}

/// Extensions the IDE page hosts as source. A file outside this list (`.txt`,
/// `.log`, no extension) keeps the standalone editor, which is the pane a
/// reader of arbitrary text wants.
const SOURCE_EXTENSIONS: &[&str] = &[
	"rs", "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "pyi", "go", "java", "kt",
	"kts", "c", "h", "cc", "cpp", "cxx", "hpp", "hxx", "cs", "rb", "php", "swift", "m", "mm",
	"scala", "sh", "bash", "zsh", "fish", "ps1", "psm1", "lua", "r", "sql", "hs", "ex", "exs",
	"erl", "clj", "dart", "vue", "svelte", "zig", "nim", "pl", "vim", "el", "scm", "asm", "s", "ml",
	"fs",
];

/// Which panel a target opens in: a Markdown document gets the rendered
/// viewer, a source file the IDE page, everything else the text editor.
pub fn panel_for(path: &Path) -> Panel {
	let ext = path
		.extension()
		.and_then(|ext| ext.to_str())
		.unwrap_or_default();
	if ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("mdx") {
		return Panel::Markdown;
	}
	let ext = ext.to_ascii_lowercase();
	if SOURCE_EXTENSIONS.contains(&ext.as_str()) {
		Panel::Ide
	} else {
		Panel::Editor
	}
}

/// The file the text a link spelled names; `None` when it names no file at
/// all (`agent://`, `out://`, a web address).
///
/// `cwd` is what a relative path is taken from — the workspace the click
/// happened in.
pub fn resolve(text: &str, cwd: &Path) -> Option<OpenTarget> {
	let text = text.trim();
	if text.is_empty() {
		return None;
	}
	// A link may arrive still wrapped in the quotes a message put around it.
	let text = text.trim_matches(['"', '\'']).trim();
	if text.is_empty() {
		return None;
	}
	if let Some((scheme, rest)) = text.split_once("://") {
		return scheme_target(scheme, rest);
	}
	let (path_text, line, col) = split_position(text);
	if path_text.is_empty() {
		return None;
	}
	Some(OpenTarget { path: expand(path_text, cwd), line, col })
}

/// A `scheme://rest` target: the file it aliases under `~/.zeta`, or `None`
/// for the schemes that alias no file.
fn scheme_target(scheme: &str, rest: &str) -> Option<OpenTarget> {
	// `local://x.md` and `local:///x.md` are the same file.
	let rest = rest.trim_start_matches(['/', '\\']);
	let (rest, line, col) = split_position(rest);
	if rest.is_empty() {
		return None;
	}
	let base = zeta_dir();
	let path = match scheme.to_ascii_lowercase().as_str() {
		// The session's local files (`local://plan.md`) live in the Zeta
		// config dir; that is where the tools that print them write.
		"local" => first_file(&[base.join(rest)]),
		// Artifacts are stored in a session's artifact directory; the
		// config dir is the root those directories hang off, so both the
		// flat and the `artifacts/` spelling are tried.
		"artifact" => first_file(&[base.join(rest), base.join("artifacts").join(rest)]),
		// `agent://` names a subagent's output, `out://` a mid-turn reply:
		// neither is a file, and guessing a path for one would open
		// something the text never named.
		_ => return None,
	};
	Some(OpenTarget { path, line, col })
}

/// The first candidate that exists as a file, else the first candidate as
/// spelled — so a target that is not there yet still names the path the panel
/// will try (and report) instead of an empty pane.
fn first_file(candidates: &[PathBuf]) -> PathBuf {
	for candidate in candidates {
		if candidate.is_file() {
			return candidate.clone();
		}
	}
	candidates.first().cloned().unwrap_or_default()
}

/// `~/.zeta` — the config dir every surface reads (`projects.json`,
/// `workbench.toml`, the session roots `local://` is taken from).
pub fn zeta_dir() -> PathBuf {
	let mut home = std::env::var_os("USERPROFILE")
		.or_else(|| std::env::var_os("HOME"))
		.map(PathBuf::from)
		.unwrap_or_else(|| PathBuf::from("."));
	home.push(".zeta");
	home
}

/// `path:42` or `path:42:7` written as one token: the path, then the line
/// and column it named.
///
/// The GUI splits this suffix off a link's own char range (`suffix_after`);
/// a whole token has no range, so the trailing `:digits` groups are peeled
/// here instead — `42x` is text, not a number, and a lone drive letter keeps
/// its colon.
fn split_position(text: &str) -> (&str, Option<u32>, Option<u32>) {
	if let Some((head, last)) = text.rsplit_once(':') {
		if let Some(last) = number(last) {
			if let Some((path, line)) = head
				.rsplit_once(':')
				.and_then(|(path, line)| number(line).map(|line| (path, line)))
			{
				if !path.is_empty() {
					return (path, Some(line), Some(last));
				}
			}
			if !head.is_empty() && !is_drive(head) {
				return (head, Some(last), None);
			}
		}
	}
	(text, None, None)
}

/// A run of ASCII digits, and nothing else: `42x` belongs to the text.
fn number(part: &str) -> Option<u32> {
	if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
		return None;
	}
	part.parse().ok()
}

/// A bare drive designator (`C` from `C:\x`): the colon after it belongs to
/// the path, never to a line suffix.
fn is_drive(head: &str) -> bool {
	let bytes = head.as_bytes();
	bytes.len() == 1 && bytes[0].is_ascii_alphabetic()
}

/// A path as written, relative to `cwd`; `~` is the user's home.
fn expand(text: &str, cwd: &Path) -> PathBuf {
	if let Some(rest) = text.strip_prefix("~/") {
		if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
			return PathBuf::from(home).join(rest);
		}
	}
	let path = Path::new(text);
	if path.is_absolute() {
		path.to_path_buf()
	} else {
		cwd.join(path)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_markdown_target_selects_the_markdown_panel() {
		for name in ["README.md", "docs/plan.md", "NOTES.MD", "page.mdx", "Page.Mdx"] {
			assert_eq!(panel_for(Path::new(name)), Panel::Markdown, "{name}");
		}
	}

	#[test]
	fn a_source_target_selects_the_ide_panel() {
		for name in ["src/main.rs", "app.ts", "main.py", "lib.go", "C:/repo/a.rs"] {
			assert_eq!(panel_for(Path::new(name)), Panel::Ide, "{name}");
		}
	}

	#[test]
	fn other_text_keeps_the_editor_panel() {
		for name in ["notes.txt", "build.log", "Makefile", "manual.pdf.txt"] {
			assert_eq!(panel_for(Path::new(name)), Panel::Editor, "{name}");
		}
	}

	#[test]
	fn a_local_uri_resolves_under_the_zeta_dir() {
		let cwd = Path::new("C:/repo");
		let expect = zeta_dir().join("link-target-test.md");
		for text in ["local://link-target-test.md", "local:///link-target-test.md"] {
			let target = resolve(text, cwd).expect("local:// names a file");
			assert_eq!(target.path, expect, "{text}");
			assert_eq!(target.line, None);
			assert_eq!(target.col, None);
			assert_eq!(panel_for(&target.path), Panel::Markdown);
		}
		// Nested names keep their shape, and a position suffix survives.
		let target =
			resolve("local://link-target-plans/v2.md:12:3", cwd).expect("local:// names a file");
		assert_eq!(target.path, zeta_dir().join("link-target-plans").join("v2.md"));
		assert_eq!((target.line, target.col), (Some(12), Some(3)));
	}

	#[test]
	fn an_artifact_uri_resolves_under_the_zeta_dir() {
		let target =
			resolve("artifact://link-target-test.log", Path::new("C:/repo")).expect("artifact");
		assert_eq!(target.path, zeta_dir().join("link-target-test.log"));
		assert_eq!((target.line, target.col), (None, None));
	}

	#[test]
	fn a_plain_path_carries_its_line_and_column() {
		// What the platform calls absolute differs, so the fixture is built from
		// a real absolute directory instead of a Windows-shaped literal.
		let cwd = std::env::current_dir().expect("a current directory");
		let file = cwd.join("a.rs");

		let target =
			resolve(&format!("{}:42:7", file.display()), &cwd).expect("an absolute path resolves");
		assert_eq!(target.path, file);
		assert_eq!((target.line, target.col), (Some(42), Some(7)));
		assert_eq!(panel_for(&target.path), Panel::Ide);

		let target = resolve(&format!("{}:42", file.display()), &cwd).expect("a line alone");
		assert_eq!(target.path, file);
		assert_eq!((target.line, target.col), (Some(42), None));

		// A relative path is taken from the workspace the click was in.
		let target = resolve("src/a.rs:3", &cwd).expect("a relative path");
		assert_eq!(target.path, cwd.join("src/a.rs"));
		assert_eq!((target.line, target.col), (Some(3), None));

		// No suffix: the path is left exactly as spelled, colon groups that
		// are not numbers included.
		let target = resolve(&file.display().to_string(), &cwd).expect("a bare path");
		assert_eq!(target.path, file);
		assert_eq!((target.line, target.col), (None, None));
	}

	#[test]
	fn an_agent_uri_names_no_file() {
		let cwd = Path::new("C:/repo");
		assert_eq!(resolve("agent://reviewer_0", cwd), None);
		// The other in-app schemes are not files either.
		assert_eq!(resolve("out://", cwd), None);
		assert_eq!(resolve("https://example.com/a.md", cwd), None);
	}

	#[test]
	fn a_panels_position_wins_over_the_texts() {
		let target = resolve("a.rs:42:7", Path::new("C:/repo")).expect("a path");
		let target = target.with_position(Some(9), None);
		assert_eq!((target.line, target.col), (Some(9), Some(7)));
	}
}
