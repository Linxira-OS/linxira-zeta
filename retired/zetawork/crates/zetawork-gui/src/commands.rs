// SPDX-License-Identifier: AGPL-3.0-only
//! The command registry: one table behind the keyboard, 设置 → 快捷键 and 命令面板.
//!
//! Every command carries a stable id — what a user's override in the settings
//! file names — plus the label and hint the settings page prints, the chord it
//! ships with, and whether it fires while a widget owns the keyboard. The three
//! readers cannot drift apart because they read this table: a command that is
//! in the palette is by construction a command the keyboard can reach, and the
//! settings page prints the chord the keyboard actually listens for.
//!
//! Remapping: a settings-file line `keys = "id=chord; id=chord"` overrides the
//! shipped chord per id; [`chord`] is the only reader of it, so an override that
//! does not parse is ignored everywhere at once rather than half-applied.

use std::collections::BTreeMap;

use egui::Key;

/// A key combination: modifiers plus the key itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Chord {
	/// The command modifier — Ctrl on this host, ⌘ on a Mac (egui's `command`).
	pub ctrl: bool,
	pub alt: bool,
	pub shift: bool,
	pub key: Key,
}

impl Chord {
	pub const fn ctrl(key: Key) -> Self {
		Self { ctrl: true, alt: false, shift: false, key }
	}

	pub const fn ctrl_shift(key: Key) -> Self {
		Self { ctrl: true, alt: false, shift: true, key }
	}

	/// The settings-file spelling, e.g. `ctrl+shift+n`.
	pub fn encode(self) -> String {
		let mut out = String::new();
		for (on, name) in [(self.ctrl, "ctrl"), (self.alt, "alt"), (self.shift, "shift")] {
			if on {
				out.push_str(name);
				out.push('+');
			}
		}
		// The symbol a key cap shows (`ctrl+,`, `ctrl+\`), lowercased: the
		// settings file is read and written by humans as much as by this code.
		out.push_str(&self.key.symbol_or_name().to_lowercase());
		out
	}

	/// Parse [`Chord::encode`]'s spelling. `cmd`/`command`/`super` read as
	/// `ctrl`, so a settings file written on another host still loads.
	pub fn decode(text: &str) -> Option<Self> {
		let text = text.trim();
		// `ctrl++` names Key::Plus; every other spelling splits on its last
		// `+`, and a spelling with no `+` at all is the bare key.
		let (modifiers, key) = match text.rsplit_once("++") {
			Some((head, "")) => (head, Key::Plus),
			_ => match text.rsplit_once('+') {
				Some((head, key)) => (head, key_by_name(key)?),
				None => ("", key_by_name(text)?),
			},
		};
		let mut chord = Chord { ctrl: false, alt: false, shift: false, key };
		for modifier in modifiers
			.split('+')
			.map(str::trim)
			.filter(|m| !m.is_empty())
		{
			match modifier.to_ascii_lowercase().as_str() {
				"ctrl" | "cmd" | "command" | "super" | "mod" => chord.ctrl = true,
				"alt" | "option" => chord.alt = true,
				"shift" => chord.shift = true,
				_ => return None,
			}
		}
		Some(chord)
	}

	/// The key cap text 设置 → 快捷键 prints, e.g. `Ctrl ⇧ N`.
	pub fn label(self) -> String {
		let mut out = String::new();
		if self.ctrl {
			out.push_str("Ctrl ");
		}
		if self.alt {
			out.push_str("⌥ ");
		}
		if self.shift {
			out.push_str("⇧ ");
		}
		out.push_str(self.key.symbol_or_name());
		out
	}
}

/// `Key::from_name` accepts `"Backslash"` and `"\\"` but not `"backslash"`;
/// a settings file should not care about the case of a key's name.
fn key_by_name(name: &str) -> Option<Key> {
	let name = name.trim();
	Key::from_name(name).or_else(|| {
		let mut chars = name.chars();
		let head = chars.next()?.to_ascii_uppercase();
		Key::from_name(&format!("{head}{}", chars.as_str()))
	})
}

/// One named command.
pub struct Command {
	/// Stable id; a settings override and a palette row both name this.
	pub id: &'static str,
	/// Chinese source text — `crate::i18n::tr`ned at render time.
	pub label: &'static str,
	/// One line under the label, and the palette row's detail.
	pub hint: &'static str,
	/// The chord a fresh settings file gets.
	pub default_chord: Chord,
	/// Fires even while a text field or a terminal owns the keyboard (⌘K must
	/// work from inside a PTY, which would otherwise swallow it).
	pub global: bool,
}

/// Every command this build has. Order is the settings page's order.
pub const COMMANDS: &[Command] = &[
	Command {
		id: "palette.open",
		label: "命令面板",
		hint: "打开命令面板：跳转项目、工作区、会话、文件，或运行桌面动作",
		default_chord: Chord::ctrl(Key::K),
		global: true,
	},
	// 工作区 and 大标签页 are the same level, so this reads as the draft's
	// 创建大标签页 while binding the key this build binds.
	Command {
		id: "workspace.new",
		label: "创建大标签页",
		hint: "在当前项目下新建一个工作区（= 一个新大标签页）",
		default_chord: Chord::ctrl(Key::N),
		global: false,
	},
	Command {
		id: "pane.split",
		label: "拆分面板",
		hint: "把当前面板左右分屏",
		default_chord: Chord::ctrl(Key::Backslash),
		global: false,
	},
	Command {
		id: "terminal.new",
		label: "新建终端",
		hint: "在当前面板新建一个终端",
		default_chord: Chord::ctrl_shift(Key::T),
		global: false,
	},
	Command {
		id: "terminal.focus",
		label: "聚焦模式",
		hint: "让当前面板铺满窗口，再按一次还原",
		default_chord: Chord::ctrl(Key::T),
		global: false,
	},
	Command {
		id: "settings.open",
		label: "打开设置",
		hint: "打开本设置面板",
		default_chord: Chord::ctrl(Key::Comma),
		global: false,
	},
	Command {
		id: "sidebar.toggle",
		label: "切换侧栏",
		hint: "显示或隐藏左右侧栏",
		default_chord: Chord::ctrl(Key::B),
		global: false,
	},
	Command {
		id: "editor.save",
		label: "保存",
		hint: "保存当前工作区里所有改动过的编辑器文件",
		default_chord: Chord::ctrl(Key::S),
		global: false,
	},
];

/// The command with this id, when the build has it.
pub fn find(id: &str) -> Option<&'static Command> {
	COMMANDS.iter().find(|command| command.id == id)
}

/// The chord in effect: the user's override when it parses, else the default.
pub fn chord(overrides: &BTreeMap<String, String>, command: &Command) -> Chord {
	overrides
		.get(command.id)
		.and_then(|text| Chord::decode(text))
		.unwrap_or(command.default_chord)
}

/// The other command already bound to `chord`, if any: one chord must not run
/// two commands, so 设置 → 快捷键 refuses the assignment instead.
pub fn conflict(
	overrides: &BTreeMap<String, String>,
	id: &str,
	chord: Chord,
) -> Option<&'static Command> {
	COMMANDS
		.iter()
		.find(|command| command.id != id && self::chord(overrides, command) == chord)
}

/// Whether `chord` was pressed in this frame. Modifiers must match exactly, so
/// `Ctrl N` does not also fire on `Ctrl Shift N`.
pub fn pressed(ctx: &egui::Context, chord: Chord) -> bool {
	ctx.input(|input| {
		input.key_pressed(chord.key)
			&& input.modifiers.command == chord.ctrl
			&& input.modifiers.alt == chord.alt
			&& input.modifiers.shift == chord.shift
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn every_default_chord_round_trips_through_the_settings_file() {
		for command in COMMANDS {
			let encoded = command.default_chord.encode();
			assert_eq!(
				Chord::decode(&encoded),
				Some(command.default_chord),
				"{} encoded as {encoded}",
				command.id
			);
		}
	}

	#[test]
	fn ids_are_unique_and_every_row_prints_something() {
		let mut seen = std::collections::HashSet::new();
		for command in COMMANDS {
			assert!(seen.insert(command.id), "duplicate id {}", command.id);
			assert!(!command.id.is_empty());
			assert!(!command.label.is_empty(), "{}", command.id);
			assert!(!command.hint.is_empty(), "{}", command.id);
		}
	}

	#[test]
	fn a_broken_override_falls_back_and_a_good_one_wins() {
		let command = find("workspace.new").expect("the command exists");
		let mut overrides = BTreeMap::new();
		assert_eq!(chord(&overrides, command), command.default_chord);
		overrides.insert(command.id.to_owned(), "ctrl+nonsense".to_owned());
		assert_eq!(chord(&overrides, command), command.default_chord);
		overrides.insert(command.id.to_owned(), "alt+shift+w".to_owned());
		assert_eq!(
			chord(&overrides, command),
			Chord { ctrl: false, alt: true, shift: true, key: Key::W }
		);
	}

	#[test]
	fn decode_accepts_the_spellings_a_settings_file_gets() {
		assert_eq!(Chord::decode(" ctrl + shift + t "), Some(Chord::ctrl_shift(Key::T)));
		assert_eq!(Chord::decode("cmd+k"), Some(Chord::ctrl(Key::K)));
		assert_eq!(Chord::decode("Ctrl+,"), Some(Chord::ctrl(Key::Comma)));
		assert_eq!(Chord::decode("ctrl+\\"), Some(Chord::ctrl(Key::Backslash)));
		assert_eq!(Chord::decode("ctrl++"), Some(Chord::ctrl(Key::Plus)));
		assert_eq!(Chord::decode("ctrl+n+x"), None);
		assert_eq!(Chord::decode("hyper+n"), None);
		assert_eq!(Chord::decode(""), None);
	}

	#[test]
	fn a_chord_already_taken_is_reported() {
		let mut overrides = BTreeMap::new();
		// Ctrl+T is 聚焦模式's shipped chord.
		assert_eq!(
			conflict(&overrides, "workspace.new", Chord::ctrl(Key::T)).map(|c| c.id),
			Some("terminal.focus")
		);
		assert!(conflict(&overrides, "workspace.new", Chord::ctrl(Key::N)).is_none());
		// Moving the other command away frees the chord.
		overrides.insert("terminal.focus".to_owned(), "alt+t".to_owned());
		assert!(conflict(&overrides, "workspace.new", Chord::ctrl(Key::T)).is_none());
	}

	#[test]
	fn the_key_cap_reads_like_the_settings_page() {
		assert_eq!(Chord::ctrl(Key::N).label(), "Ctrl N");
		assert_eq!(Chord::ctrl_shift(Key::T).label(), "Ctrl ⇧ T");
		assert_eq!(Chord::ctrl(Key::Comma).label(), "Ctrl ,");
	}
}
