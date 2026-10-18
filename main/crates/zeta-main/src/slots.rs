// SPDX-License-Identifier: AGPL-3.0-only
//! Builtin rail slots: the left column's view buttons, their order and their
//! visibility.
//!
//! The rail switcher is fixed by design — its buttons are the workbench's own
//! builtin views (`where = "rail"`, `kind = "builtin"`), never a custom URL
//! (web pages belong to the right column). What the file owns is which of them
//! show and in what order; the `+` under the buttons opens the manager that
//! edits exactly that.
//!
//! [`parse`] is total: a missing, truncated or damaged `[[slots]]` section
//! falls back to the shipped defaults and never blocks startup, and fields
//! this build has never heard of are ignored — the same file also carries the
//! right column's `where = "right"` pages.

/// Section name in `~/.zeta/workbench.toml`.
pub const SECTION: &str = "slots";
/// Rail slots are the workbench's own views, not mountable pages.
pub const WHERE: &str = "rail";
/// Only builtin views may sit on the rail.
pub const KIND: &str = "builtin";

/// One builtin view the rail can host.
pub struct Builtin {
	/// Stable id — the key in the config file.
	pub id: &'static str,
	pub title: &'static str,
	pub icon: &'static str,
	/// Visible out of the box: the design fixes the default at the first four.
	pub default_visible: bool,
	/// Where this view's data comes from, and whether the slice that wires it
	/// up has landed. The P0 view frame renders this verbatim instead of
	/// inventing content it does not have.
	pub source: &'static str,
}

/// The builtin rail set, in default order. Five views; search · tasks ·
/// automation and **projects** show by default, `mobile` is kept in the list
/// but starts hidden (its design is not settled yet — one line re-shows it).
///
/// There is deliberately no usage/statistics view here: zetacode's own input
/// box already shows the current conversation's usage, and the global usage
/// lives behind `zetacode`'s `/stats`. The terminal form carries no usage
/// surface of its own.
pub const BUILTINS: [Builtin; 5] = [
	Builtin {
		id: "search",
		title: "search",
		icon: "🔍",
		default_visible: true,
		source: "a zeta web page (web-ui) — the terminal form is not scheduled yet",
	},
	Builtin {
		id: "tasks",
		title: "tasks",
		icon: "☰",
		default_visible: true,
		source: "a zeta web page (web-ui) — the terminal form is not scheduled yet",
	},
	Builtin {
		id: "automation",
		title: "automation",
		icon: "⏱",
		default_visible: true,
		source: "a zeta web page (web-ui) — the terminal form is not scheduled yet",
	},
	Builtin {
		id: "mobile",
		title: "mobile",
		icon: "📱",
		default_visible: false,
		source: "a zeta web page (web-ui) — the terminal form is not scheduled yet",
	},
	Builtin {
		id: "projects",
		title: "projects",
		icon: "📁",
		default_visible: true,
		source: "~/.zeta/projects.json — the same registry the GUI reads",
	},
];

/// One registry entry: which builtin, plus the presentation the file owns.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Slot {
	/// Index into [`BUILTINS`] — the identity that survives reordering.
	pub builtin: usize,
	/// Display title; the config may override the builtin default.
	pub title: String,
	pub icon: String,
	pub visible: bool,
	/// Master-list position; [`renumber`] keeps these dense after every edit.
	pub order: u32,
}

impl Slot {
	/// The config-file id of this slot.
	pub fn id(&self) -> &'static str {
		BUILTINS[self.builtin].id
	}

	/// Where this view's data comes from (rendered by the P0 frame).
	pub fn source(&self) -> &'static str {
		BUILTINS[self.builtin].source
	}
}

/// The builtin index for a config-file id, if the id is one of ours.
pub fn index_of(id: &str) -> Option<usize> {
	BUILTINS.iter().position(|b| b.id == id)
}

fn default_slot(builtin: usize) -> Slot {
	Slot {
		builtin,
		title: BUILTINS[builtin].title.to_string(),
		icon: BUILTINS[builtin].icon.to_string(),
		visible: BUILTINS[builtin].default_visible,
		order: builtin as u32,
	}
}

/// Every builtin in default order — the fallback for a missing or damaged
/// section, and the starting point for a fresh install.
pub fn default_registry() -> Vec<Slot> {
	(0..BUILTINS.len()).map(default_slot).collect()
}

/// The visible subset in rail order — what the button strip draws.
pub fn visible(slots: &[Slot]) -> Vec<&Slot> {
	slots.iter().filter(|s| s.visible).collect()
}

/// Make [`Slot::order`] the position in `slots`, 0-based and dense. The vec is
/// the master list: reordering edits it, this keeps the persisted copy honest.
pub fn renumber(slots: &mut [Slot]) {
	for (index, slot) in slots.iter_mut().enumerate() {
		slot.order = index as u32;
	}
}

/// Move the entry at `row` one step earlier; `false` when it is already first
/// (or out of range). Order is the master-list order, visibility a separate
/// flag, so a hidden slot is still orderable.
pub fn move_up(slots: &mut [Slot], row: usize) -> bool {
	if row == 0 || row >= slots.len() {
		return false;
	}
	slots.swap(row - 1, row);
	renumber(slots);
	true
}

/// Move the entry at `row` one step later; `false` when it is already last.
pub fn move_down(slots: &mut [Slot], row: usize) -> bool {
	if row + 1 >= slots.len() {
		return false;
	}
	slots.swap(row, row + 1);
	renumber(slots);
	true
}

/// The effective registry: the builtin defaults with every `where = "rail"`,
/// `kind = "builtin"` record from [`SECTION`] applied.
///
/// Anything damaged falls back to [`default_registry`] as a whole — an
/// unknown id, a duplicate, an unreadable value, a record without an id —
/// because a half-applied rail is worse than the shipped one, and the boot
/// must never depend on this file. Records belonging to another column
/// (`where != "rail"`) are skipped, not failures; builtins the file does not
/// mention keep their defaults, so the manager can always re-show them.
pub fn parse(text: &str) -> Vec<Slot> {
	let records = read_records(text);
	if records.is_empty() {
		return default_registry();
	}
	let mut slots: Vec<Slot> = Vec::new();
	let mut mentioned: Vec<usize> = Vec::new();
	for record in &records {
		let field = |key: &str| {
			record
				.iter()
				.find(|(name, _)| name == key)
				.map(|(_, value)| value.as_str())
		};
		// Another column's page — this build has no business validating it.
		if field("where").is_some_and(|where_| where_ != WHERE) {
			continue;
		}
		if field("kind").is_some_and(|kind| kind != KIND) {
			return default_registry();
		}
		let Some(builtin) = field("id").and_then(index_of) else {
			return default_registry();
		};
		if mentioned.contains(&builtin) {
			return default_registry();
		}
		mentioned.push(builtin);
		let visible = match field("visible") {
			Some(raw) => match parse_bool(raw) {
				Some(value) => value,
				None => return default_registry(),
			},
			None => BUILTINS[builtin].default_visible,
		};
		let order = match field("order") {
			Some(raw) => match raw.trim().parse::<u32>() {
				Ok(value) => value,
				Err(_) => return default_registry(),
			},
			None => builtin as u32,
		};
		let text_or_default = |raw: Option<&str>, fallback: &str| match raw
			.map(clean_text)
			.filter(|value| !value.is_empty())
		{
			Some(value) => value,
			None => fallback.to_string(),
		};
		slots.push(Slot {
			builtin,
			title: text_or_default(field("title"), BUILTINS[builtin].title),
			icon: text_or_default(field("icon"), BUILTINS[builtin].icon),
			visible,
			order,
		});
	}
	if slots.is_empty() {
		return default_registry();
	}
	// Builtins the file never mentions keep their default position, so they
	// are appended before the sort and land wherever that order says.
	for builtin in 0..BUILTINS.len() {
		if !mentioned.contains(&builtin) {
			slots.push(default_slot(builtin));
		}
	}
	slots.sort_by_key(|slot| (slot.order, slot.builtin));
	renumber(&mut slots);
	slots
}

/// The `[[slots]]` text for a registry — every builtin, visible or not, in
/// master-list order.
pub fn render(slots: &[Slot]) -> String {
	let mut text = String::new();
	for slot in slots {
		text.push_str(&format!("[[{SECTION}]]\n"));
		text.push_str(&format!("id = \"{}\"\n", slot.id()));
		text.push_str(&format!("where = \"{WHERE}\"\n"));
		text.push_str(&format!("kind = \"{KIND}\"\n"));
		text.push_str(&format!("title = \"{}\"\n", slot.title));
		text.push_str(&format!("icon = \"{}\"\n", slot.icon));
		text.push_str(&format!("visible = {}\n", slot.visible));
		text.push_str(&format!("order = {}\n", slot.order));
	}
	text
}

/// The `[[slots]]` blocks of `text`, as `(key, value)` pairs in file order.
fn read_records(text: &str) -> Vec<Vec<(String, String)>> {
	let mut records: Vec<Vec<(String, String)>> = Vec::new();
	let mut in_section = false;
	for line in text.lines() {
		let line = line.trim();
		if line.is_empty() || line.starts_with('#') {
			continue;
		}
		let compact: String = line.chars().filter(|c| !c.is_whitespace()).collect();
		if compact.starts_with('[') {
			// Any table header ends the section; `[[slots]]` starts a record.
			in_section = compact == format!("[[{SECTION}]]");
			if in_section {
				records.push(Vec::new());
			}
			continue;
		}
		if !in_section {
			continue;
		}
		let Some((key, value)) = line.split_once('=') else {
			// A line without `=` carries nothing we can use — ignored, like an
			// unparsable comment.
			continue;
		};
		if let Some(record) = records.last_mut() {
			record.push((key.trim().to_string(), clean_value(value)));
		}
	}
	records.retain(|record| !record.is_empty());
	records
}

/// A value with quotes and any trailing `#` comment removed.
fn clean_value(raw: &str) -> String {
	const QUOTE: char = '"';
	let mut value = String::new();
	let mut quoted = false;
	for ch in raw.trim().chars() {
		match ch {
			QUOTE => quoted = !quoted,
			'#' if !quoted => break,
			// Newlines cannot appear (the input is split per line).
			ch => value.push(ch),
		}
	}
	clean_text(&value)
}

/// A text field: the surrounding spaces and the (already unquoted) buffer.
fn clean_text(raw: &str) -> String {
	raw.trim().trim_matches('"').trim().to_string()
}

fn parse_bool(raw: &str) -> Option<bool> {
	if raw.eq_ignore_ascii_case("true") {
		Some(true)
	} else if raw.eq_ignore_ascii_case("false") {
		Some(false)
	} else {
		None
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn ids(slots: &[Slot]) -> Vec<&'static str> {
		slots.iter().map(Slot::id).collect()
	}

	fn visible_ids(slots: &[Slot]) -> Vec<&'static str> {
		visible(slots).iter().map(|slot| slot.id()).collect()
	}

	#[test]
	fn defaults_show_the_four_builtin_views_in_order() {
		let slots = default_registry();
		assert_eq!(ids(&slots), ["search", "tasks", "automation", "mobile", "projects"]);
		assert_eq!(visible_ids(&slots), ["search", "tasks", "automation", "projects"]);
		assert_eq!(slots[0].order, 0);
		assert_eq!(slots[4].order, 4, "orders are dense and 0-based");
		assert!(!slots[3].visible, "mobile is listed but hidden out of the box");
		assert!(slots[4].visible, "projects shows out of the box");
	}

	#[test]
	fn parse_of_an_empty_or_foreign_section_keeps_the_defaults() {
		assert_eq!(ids(&parse("")), ids(&default_registry()));
		assert_eq!(ids(&parse("shell = \"auto\"\n")), ids(&default_registry()), "no section at all");
		assert_eq!(
			visible_ids(&parse("[[right]]\nid = \"files\"\nurl = \"http://x\"\n")),
			["search", "tasks", "automation", "projects"],
			"a right-column page is not ours to validate"
		);
	}

	#[test]
	fn parse_applies_visibility_and_order() {
		let text = "\
[[slots]]
id = \"mobile\"
visible = true
order = 0

[[slots]]
id = \"search\"
visible = false
order = 3
";
		let slots = parse(text);
		assert_eq!(ids(&slots)[0], "mobile", "order 0 wins");
		assert_eq!(visible_ids(&slots), ["mobile", "tasks", "automation", "projects"]);
		assert_eq!(
			slots.iter().map(|s| s.order).collect::<Vec<_>>(),
			[0, 1, 2, 3, 4],
			"the registry stays densely numbered"
		);
	}

	#[test]
	fn parse_reads_plain_and_quoted_values_and_ignores_unknown_fields() {
		let text = "\
[[slots]]
id = tasks
where = rail
kind = builtin
title = \" 任务 \"
icon = \"#\"    # \
		            a quoted value, then a comment
visible = TRUE
order = 1
url = \"http://127.0.0.1:30141/embed/tasks?chrome=none\"\
		            
future_field = 42
";
		let slots = parse(text);
		let tasks = slots
			.iter()
			.find(|s| s.id() == "tasks")
			.expect("tasks is listed");
		assert_eq!(tasks.title, "任务");
		assert_eq!(tasks.icon, "#", "the comment after the value is not part of it");
		assert!(tasks.visible);
		assert_eq!(tasks.order, 1);
	}

	#[test]
	fn damaged_sections_fall_back_to_the_shipped_defaults() {
		let cases = [
			"[[slots]]\nid = \"nonsense\"\nvisible = true\n",
			"[[slots]]\nid = \"stats\"\nvisible = true\n",
			"[[slots]]\nid = \"context\"\nvisible = true\n",
			"[[slots]]\nvisible = true\n",
			"[[slots]]\nid = \"tasks\"\nvisible = maybe\n",
			"[[slots]]\nid = \"tasks\"\norder = first\n",
			"[[slots]]\nid = \"tasks\"\nvisible = true\n[[slots]]\nid = \"tasks\"\n",
			"[[slots]]\nid = \"tasks\"\nkind = \"web\"\n",
			"[[slots]]\nid = \"tasks\"\nvisible = ",
		];
		for case in cases {
			let slots = parse(case);
			assert_eq!(
				visible_ids(&slots),
				["search", "tasks", "automation", "projects"],
				"input {case:?} must fall back to the shipped defaults"
			);
			assert_eq!(slots.len(), BUILTINS.len());
		}
	}

	#[test]
	fn render_roundtrips_through_parse() {
		let mut slots = default_registry();
		slots[0].visible = false;
		slots[3].visible = true;
		assert!(move_up(&mut slots, 3));
		let text = render(&slots);
		let again = parse(&text);
		assert_eq!(again, slots, "what the manager writes reads back identically");
		assert!(text.starts_with("[[slots]]\nid = \"search\"\n"), "blocks in master-list order");
	}

	#[test]
	fn moving_an_entry_rewrites_the_order_keys() {
		let mut slots = default_registry();
		assert!(move_up(&mut slots, 3));
		assert_eq!(ids(&slots), ["search", "tasks", "mobile", "automation", "projects"]);
		assert_eq!(slots.iter().map(|s| s.order).collect::<Vec<_>>(), [0, 1, 2, 3, 4]);
		assert!(!move_up(&mut slots, 0), "the first row cannot move up");
		assert!(move_down(&mut slots, 0));
		assert_eq!(ids(&slots)[0], "tasks");
		let last = slots.len() - 1;
		assert!(!move_down(&mut slots, last), "the last row cannot move down");
		assert_eq!(ids(&parse(&render(&slots))), ids(&slots));
	}
}
