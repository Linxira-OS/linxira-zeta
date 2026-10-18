// SPDX-License-Identifier: AGPL-3.0-only
//! Workbench settings: a handful of runtime preferences plus the rail slot
//! registry, persisted to `~/.zeta/workbench.toml`. No schema framework — a
//! `key = value` header, `[[slots]]` blocks, parsed by hand, written on every
//! change. The globals are plain RwLocks: pane spawns read the pinned shell,
//! mouse handling reads the toggles, the settings overlay and the slot manager
//! write through [`update`](update)/[`update_slots`](update_slots) (both of
//! which persist immediately).
//!
//! Writing is in-place: only the managed preference values and the `[[slots]]`
//! section are rewritten, everything else in the file keeps its line, its
//! order and its comments.

use std::{fmt, path::PathBuf, sync::RwLock};

use crate::slots::{self, Slot};

/// Which shell new panes spawn. `Auto` follows the detected chain
/// (PowerShell 7 → Windows PowerShell → Git Bash → cmd); the pins select
/// a specific flavor and fall back to `Auto` when it is not installed.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ShellChoice {
	Auto,
	PowerShell,
	Pwsh,
	GitBash,
}

impl ShellChoice {
	/// The cycle order of the settings row.
	pub const ALL: [ShellChoice; 4] =
		[ShellChoice::Auto, ShellChoice::PowerShell, ShellChoice::Pwsh, ShellChoice::GitBash];

	pub fn next(self) -> Self {
		let idx = Self::ALL.iter().position(|c| *c == self).unwrap_or(0);
		Self::ALL[(idx + 1) % Self::ALL.len()]
	}

	pub fn label(self) -> &'static str {
		match self {
			ShellChoice::Auto => "auto",
			ShellChoice::PowerShell => "powershell",
			ShellChoice::Pwsh => "pwsh 7",
			ShellChoice::GitBash => "git bash",
		}
	}

	fn key(self) -> &'static str {
		match self {
			ShellChoice::Auto => "auto",
			ShellChoice::PowerShell => "powershell",
			ShellChoice::Pwsh => "pwsh",
			ShellChoice::GitBash => "git-bash",
		}
	}

	fn from_key(key: &str) -> Self {
		match key.trim().to_ascii_lowercase().as_str() {
			"powershell" => ShellChoice::PowerShell,
			"pwsh" => ShellChoice::Pwsh,
			"git-bash" => ShellChoice::GitBash,
			_ => ShellChoice::Auto,
		}
	}
}

impl fmt::Display for ShellChoice {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(self.label())
	}
}

/// The persisted workbench preferences.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Settings {
	pub shell: ShellChoice,
	/// Border-drag resize, pane swap/move, tab reorder (the drag layer).
	pub drag: bool,
	/// Hovering a pane focuses it, no click needed.
	pub focus_follows_mouse: bool,
	/// Ask before closing a pane/tab that runs child processes (zetacode,
	/// vim, …). Off closes everything without asking.
	pub close_confirmation: bool,
}

impl Default for Settings {
	fn default() -> Self {
		Self {
			shell: ShellChoice::Auto,
			drag: true,
			focus_follows_mouse: false,
			close_confirmation: true,
		}
	}
}

static SETTINGS: RwLock<Settings> = RwLock::new(Settings {
	shell: ShellChoice::Auto,
	drag: true,
	focus_follows_mouse: false,
	close_confirmation: true,
});

/// The rail slot registry. `None` until [`init`] — readers fall back to the
/// builtin defaults, so a snapshot is complete even before the file is read
/// (and in tests that never touch the user's config dir).
static SLOTS: RwLock<Option<Vec<Slot>>> = RwLock::new(None);

/// Load the settings file into the globals. Called once at startup; a missing
/// or malformed file keeps the defaults (each preference key falls back
/// independently and the slot section falls back as a whole, so a half-written
/// file only loses what it lost).
pub fn init() {
	let (settings, slots) = read_file(&settings_path());
	if let Ok(mut global) = SETTINGS.write() {
		*global = settings;
	}
	if let Ok(mut global) = SLOTS.write() {
		*global = Some(slots);
	}
}

/// Read a snapshot of the current settings.
pub fn snapshot() -> Settings {
	SETTINGS.read().map(|s| *s).unwrap_or_default()
}

/// Snapshot of the rail slot registry, in rail order (see [`slots`]).
pub fn slots() -> Vec<Slot> {
	SLOTS
		.read()
		.ok()
		.and_then(|slots| slots.clone())
		.unwrap_or_else(slots::default_registry)
}

/// Mutate the global preferences and persist immediately. The overlay writes
/// here, so a change survives a crash by construction.
pub fn update(mutate: impl FnOnce(&mut Settings)) {
	// Snapshot the registry before taking the other lock — the two are never
	// held at once.
	let slots = slots();
	let Ok(mut global) = SETTINGS.write() else {
		return;
	};
	mutate(&mut global);
	let _ = save_to(&settings_path(), *global, &slots);
}

/// Mutate the rail slot registry and persist immediately — the slot manager's
/// contract, the same as [`update`]'s.
pub fn update_slots(mutate: impl FnOnce(&mut Vec<Slot>)) {
	let preferences = snapshot();
	let Ok(mut global) = SLOTS.write() else {
		return;
	};
	let mut registry = global.clone().unwrap_or_else(slots::default_registry);
	mutate(&mut registry);
	slots::renumber(&mut registry);
	*global = Some(registry.clone());
	let _ = save_to(&settings_path(), preferences, &registry);
}

/// `~/.zeta/workbench.toml` — the workbench's own settings file inside the
/// Zeta config dir.
fn settings_path() -> PathBuf {
	let mut home = std::env::var_os("USERPROFILE")
		.or_else(|| std::env::var_os("HOME"))
		.map(PathBuf::from)
		.unwrap_or_else(|| PathBuf::from("."));
	home.push(".zeta");
	home.push("workbench.toml");
	home
}

/// Both halves of the file.
fn read_file(path: &std::path::Path) -> (Settings, Vec<Slot>) {
	let Ok(text) = std::fs::read_to_string(path) else {
		return (Settings::default(), slots::default_registry());
	};
	(read_preferences(&text), slots::parse(&text))
}

/// The four preferences. Keys after the first table header belong to that
/// table, so the scan stops there — only the header-less preamble is ours.
fn read_preferences(text: &str) -> Settings {
	let mut settings = Settings::default();
	for line in text.lines() {
		let line = line.trim();
		if line.is_empty() || line.starts_with('#') {
			continue;
		}
		if line.starts_with('[') {
			break;
		}
		let Some((key, value)) = line.split_once('=') else {
			continue;
		};
		// Inline comments are part of the written format; cut them before
		// reading the value (no setting value ever contains '#').
		let value = value
			.split('#')
			.next()
			.unwrap_or("")
			.trim()
			.trim_matches('"');
		match key.trim() {
			"shell" => settings.shell = ShellChoice::from_key(value),
			"drag" => settings.drag = value.eq_ignore_ascii_case("true"),
			"focus_follows_mouse" => settings.focus_follows_mouse = value.eq_ignore_ascii_case("true"),
			"close_confirmation" => settings.close_confirmation = value.eq_ignore_ascii_case("true"),
			_ => {},
		}
	}
	settings
}

fn save_to(path: &std::path::Path, settings: Settings, slots: &[Slot]) -> std::io::Result<()> {
	if let Some(dir) = path.parent() {
		std::fs::create_dir_all(dir)?;
	}
	let existing = std::fs::read_to_string(path).unwrap_or_default();
	std::fs::write(path, merge(&existing, settings, slots))
}

/// The four preference keys the workbench owns, with their canonical inline
/// comment.
const MANAGED: [(&str, &str); 4] = [
	("shell", "auto | powershell | pwsh | git-bash"),
	("drag", "border resize · pane swap · tab reorder"),
	("focus_follows_mouse", "hover focuses a pane"),
	("close_confirmation", "ask before closing panes that run programs"),
];

const HEADER: &str = "# zeta workbench settings — hand-edited values are overwritten by the \
                      Settings surface\n";

/// The file text for a settings + registry pair.
///
/// Everything already in `existing` is kept: lines the workbench does not own
/// (unknown keys, comments, sections another build wrote) stay exactly where
/// they are, and the managed preference keys keep their line order — only
/// their values are rewritten. The `[[slots]]` section is replaced in place,
/// or appended when the file has none.
fn merge(existing: &str, settings: Settings, slots: &[Slot]) -> String {
	let eol = if existing.contains("\r\n") {
		"\r\n"
	} else {
		"\n"
	};
	if existing.trim().is_empty() {
		let mut text = String::from(HEADER);
		for (key, _) in MANAGED {
			text.push_str(&managed_line(key, settings, None, eol));
		}
		text.push('\n');
		text.push_str(&slots::render(slots).replace('\n', eol));
		return text;
	}
	let section = format!("[[{}]]", slots::SECTION);
	let lines: Vec<&str> = existing.split_inclusive('\n').collect();
	let mut out = String::new();
	let mut written: Vec<&str> = Vec::new();
	let mut slots_written = false;
	// Only the header-less preamble holds the workbench's own keys; after the
	// first table header, `shell = …` belongs to that table.
	let mut preamble = true;
	let mut index = 0;
	while index < lines.len() {
		let line = lines[index];
		let compact: String = line.chars().filter(|c| !c.is_whitespace()).collect();
		if compact == section {
			// Replace the whole section: every `[[slots]]` block up to the
			// next table header (or the end of the file). A preference key the
			// file was missing is written first — after the header it would
			// belong to the slots table and stop counting as a preference.
			insert_missing(settings, &mut out, &mut written, eol);
			out.push_str(&slots::render(slots).replace('\n', eol));
			slots_written = true;
			preamble = false;
			index += 1;
			while index < lines.len() {
				let next: String = lines[index]
					.chars()
					.filter(|c| !c.is_whitespace())
					.collect();
				// Every `[[slots]]` block belongs to the section being
				// rewritten; any other table header ends it.
				if next == section {
					index += 1;
					continue;
				}
				if next.starts_with('[') {
					break;
				}
				index += 1;
			}
			continue;
		}
		if compact.starts_with('[') {
			// A table this build does not know: keep it verbatim, and write
			// any preference key the file was missing before it — after the
			// header they would belong to that table, not to the workbench.
			insert_missing(settings, &mut out, &mut written, eol);
			preamble = false;
		} else if preamble {
			if let Some((key, _)) = MANAGED.iter().find(|(key, _)| is_key_line(line, key)) {
				out.push_str(&managed_line(key, settings, inline_comment(line), eol));
				written.push(key);
				index += 1;
				continue;
			}
		}
		out.push_str(line);
		if !line.ends_with('\n') {
			out.push_str(eol);
		}
		index += 1;
	}
	insert_missing(settings, &mut out, &mut written, eol);
	if !slots_written {
		out.push('\n');
		out.push_str(&slots::render(slots).replace('\n', eol));
	}
	out
}

/// Append the preference keys the file did not have (a hand-written file may
/// name only some of them).
fn insert_missing(settings: Settings, out: &mut String, written: &mut Vec<&str>, eol: &str) {
	for (key, _) in MANAGED {
		if !written.contains(&key) {
			out.push_str(&managed_line(key, settings, None, eol));
			written.push(key);
		}
	}
}

/// Does `line` assign this key at the top level (`key = …`)?
fn is_key_line(line: &str, key: &str) -> bool {
	line
		.split_once('=')
		.is_some_and(|(name, _)| name.trim() == key)
}

/// The `#` comment a hand-written line carries, so rewriting its value does
/// not throw the note away.
fn inline_comment(line: &str) -> Option<&str> {
	let mut quoted = false;
	for (index, ch) in line.char_indices() {
		match ch {
			'"' => quoted = !quoted,
			'#' if !quoted => {
				let comment = line[index + 1..].trim();
				return (!comment.is_empty()).then_some(comment);
			},
			_ => {},
		}
	}
	None
}

fn managed_line(key: &str, settings: Settings, comment: Option<&str>, eol: &str) -> String {
	let fallback = MANAGED
		.iter()
		.find(|(managed, _)| *managed == key)
		.map(|(_, comment)| *comment)
		.unwrap_or("");
	let value = match key {
		"shell" => format!("\"{}\"", settings.shell.key()),
		"drag" => settings.drag.to_string(),
		"focus_follows_mouse" => settings.focus_follows_mouse.to_string(),
		"close_confirmation" => settings.close_confirmation.to_string(),
		_ => String::new(),
	};
	let comment = comment.unwrap_or(fallback);
	format!("{key} = {value}          # {comment}{eol}")
}

#[cfg(test)]
mod tests {
	use super::*;

	fn temp_path(tag: &str) -> PathBuf {
		std::env::temp_dir().join(format!("zeta-settings-{tag}-{}.toml", std::process::id()))
	}

	fn visible_ids(slots: &[Slot]) -> Vec<&'static str> {
		slots
			.iter()
			.filter(|slot| slot.visible)
			.map(Slot::id)
			.collect()
	}

	#[test]
	fn roundtrips_through_the_file_format() {
		let path = temp_path("roundtrip");
		let original = Settings {
			shell: ShellChoice::Pwsh,
			drag: false,
			focus_follows_mouse: true,
			close_confirmation: false,
		};
		save_to(&path, original, &slots::default_registry()).expect("save");
		let (settings, slots) = read_file(&path);
		assert_eq!(settings, original, "every preference survives a save/load roundtrip");
		assert_eq!(slots, slots::default_registry(), "and so does the slot registry");
		std::fs::remove_file(&path).ok();
	}

	#[test]
	fn malformed_and_missing_files_fall_back_per_key() {
		let path = temp_path("bad");
		std::fs::write(&path, "shell = \"git-bash\"\ndrag = \"banana\"\n???").unwrap();
		let settings = read_preferences(&std::fs::read_to_string(&path).unwrap());
		assert_eq!(settings.shell, ShellChoice::GitBash, "the good key still lands");
		assert!(!settings.drag, "a garbled value falls back to default, not true");
		assert!(!settings.focus_follows_mouse);
		std::fs::remove_file(&path).ok();
		assert_eq!(read_file(std::path::Path::new("Z:/nope/missing.toml")).0, Settings::default());
		assert_eq!(
			read_file(std::path::Path::new("Z:/nope/missing.toml")).1,
			slots::default_registry(),
			"a missing file still yields the default rail"
		);
	}

	#[test]
	fn shell_choice_cycles_and_labels() {
		assert_eq!(ShellChoice::Auto.next(), ShellChoice::PowerShell);
		assert_eq!(ShellChoice::GitBash.next(), ShellChoice::Auto);
		assert_eq!(ShellChoice::from_key("PWSH"), ShellChoice::Pwsh, "keys are case-insensitive");
		assert_eq!(ShellChoice::from_key("nonsense"), ShellChoice::Auto);
	}

	/// The slot manager's roundtrip: write the defaults, hide two slots, save,
	/// read the file back — the edit is what the next boot sees.
	#[test]
	fn hiding_two_slots_roundtrips_through_the_file() {
		let path = temp_path("slots");
		let mut registry = slots::default_registry();
		let _ = save_to(&path, Settings::default(), &registry);

		for id in ["automation", "search"] {
			let index = registry
				.iter()
				.position(|slot| slot.id() == id)
				.expect("builtin");
			registry[index].visible = false;
		}
		save_to(&path, Settings::default(), &registry).expect("save");

		let (settings, reread) = read_file(&path);
		assert_eq!(reread, registry, "the hidden state survives the file");
		assert_eq!(visible_ids(&reread), ["tasks", "projects"], "exactly the two left visible");
		assert_eq!(settings, Settings::default(), "the preferences ride along untouched");

		// And the rewrite is idempotent: a second save of the same state is a
		// fixed point (the manager writes after every keystroke).
		let text = std::fs::read_to_string(&path).unwrap();
		let again = merge(&text, Settings::default(), &reread);
		assert_eq!(again, text, "saving an unchanged registry does not churn the file");
		std::fs::remove_file(&path).ok();
	}

	#[test]
	fn damaged_files_fall_back_to_the_default_slots() {
		let cases: [(&str, &str); 3] = [
			("missing", ""),
			(
				"truncated",
				"shell = \"pwsh\"\n\n[[slots]]\nid = \"search\"\nvisible = false\n\n[[slots]]\nid = \
				 \"tasks\"\nvisible = ",
			),
			("unknown-id", "[[slots]]\nid = \"not-a-builtin\"\nvisible = true\n"),
		];
		for (tag, text) in cases {
			let path = temp_path(tag);
			std::fs::remove_file(&path).ok();
			if !text.is_empty() {
				std::fs::write(&path, text).unwrap();
			}
			let (_, slots) = read_file(&path);
			assert_eq!(
				visible_ids(&slots),
				["search", "tasks", "automation", "projects"],
				"{tag} must boot on the shipped defaults"
			);
			assert_eq!(slots, slots::default_registry(), "{tag} yields the shipped registry");
			if tag == "truncated" {
				let (settings, _) = read_file(&path);
				assert_eq!(
					settings.shell,
					ShellChoice::Pwsh,
					"and the readable preferences still land"
				);
			}
			std::fs::remove_file(&path).ok();
		}
	}

	#[test]
	fn writing_keeps_foreign_keys_comments_and_line_order() {
		let path = temp_path("foreign");
		std::fs::write(
			&path,
			"# my notes\ndrag = true        # keep me\nfuture_knob = 7\nshell = \"auto\"\n\n[[right]]\nid \
			 = \"files\"\nurl = \"http://127.0.0.1:30141/embed/files\"\n",
		)
		.unwrap();
		let settings = Settings { drag: false, ..Settings::default() };
		save_to(&path, settings, &slots::default_registry()).unwrap();
		let text = std::fs::read_to_string(&path).unwrap();

		assert!(text.starts_with("# my notes\n"), "the comment line stays first");
		let order: Vec<&str> = text
			.lines()
			.filter(|line| line.contains("drag =") || line.contains("future_knob"))
			.collect();
		assert_eq!(
			order,
			["drag = false          # keep me", "future_knob = 7"],
			"the managed value is rewritten where it was, its note kept, the foreign key unmoved"
		);
		assert!(
			text.contains("[[right]]\nid = \"files\"\nurl = \"http://127.0.0.1:30141/embed/files\""),
			"a section this build does not know is copied verbatim"
		);
		assert!(text.contains("[[slots]]\nid = \"search\"\n"), "and the slot section is appended");
		assert!(
			text.ends_with(&format!("order = {}\n", slots::default_registry().len() - 1)),
			"the file stays newline-terminated"
		);
		let (_, slots) = read_file(&path);
		assert_eq!(slots, slots::default_registry());
		std::fs::remove_file(&path).ok();
	}

	#[test]
	fn the_managed_keys_are_restored_when_the_file_is_theirs_alone() {
		let path = temp_path("bare");
		std::fs::write(&path, "focus_follows_mouse = true\n").unwrap();
		save_to(&path, Settings::default(), &slots::default_registry()).unwrap();
		let text = std::fs::read_to_string(&path).unwrap();
		let (settings, _) = read_file(&path);
		assert_eq!(settings, Settings::default());
		for (key, _) in MANAGED {
			assert!(text.contains(key), "{key} is written even when the file omits it");
		}
		std::fs::remove_file(&path).ok();
	}

	/// A hand-edited file may put a preference key after the slot section —
	/// where TOML makes it a slot field, so it stops counting as a preference.
	/// The rewrite has to lift it back into the preamble, exactly once.
	#[test]
	fn a_preference_key_after_the_slot_section_moves_back_to_the_preamble() {
		let path = temp_path("late-keys");
		std::fs::write(&path, "[[slots]]\nid = \"tasks\"\nvisible = false\n\nshell = \"pwsh\"\n")
			.unwrap();
		let settings = Settings { shell: ShellChoice::Pwsh, ..Settings::default() };
		save_to(&path, settings, &slots::default_registry()).unwrap();
		let text = std::fs::read_to_string(&path).unwrap();

		assert_eq!(text.matches("shell = ").count(), 1, "written once, not duplicated");
		assert!(
			text.find("shell = ").expect("written") < text.find("[[slots]]").expect("written"),
			"and it lands in the preamble, where it counts as a preference"
		);
		let (reread, registry) = read_file(&path);
		assert_eq!(reread, settings, "the value survives the rewrite");
		assert_eq!(registry, slots::default_registry(), "the registry the file now holds");
		std::fs::remove_file(&path).ok();
	}
}
