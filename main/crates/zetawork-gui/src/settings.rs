// SPDX-License-Identifier: AGPL-3.0-only
//! The shell's own settings: the sections of the spec's 设置 modal, the
//! values behind them, and the file they live in.
//!
//! # Scope
//!
//! These are **zetawork's** settings. zetacode's own settings are per-workspace
//! (global `~/.zeta/agent/config.yml` plus `<workspace>/.zeta/config.yml`) and
//! are edited by zetacode itself — the 关于 section carries one honest row
//! saying so and naming that command. Nothing here writes into zetacode's
//! config.
//!
//! # File
//!
//! `~/.zeta/zetawork.toml` — a sibling of the TUI's `~/.zeta/workbench.toml`,
//! deliberately a separate file so the two surfaces never rewrite each other.
//! The writer is the same line-preserving one `main/crates/zeta-main/src/
//! settings.rs` uses: a header-less preamble of `key = value` lines with their
//! inline comments, everything else in the file kept verbatim, missing keys
//! appended, and each key falling back to its default **independently** — so a
//! hand-edited or half-written file only loses what it lost.

use std::{
	fmt,
	path::{Path, PathBuf},
};

/// One of the 设置 modal's eight categories, in the order the modal lists them.
///
/// 常规 comes first and is the one section the design drafts do not have: the
/// drafts were drawn before the lifecycle rulings (关闭窗口时 / 开机自启 /
/// 通知), so the six they fix (外观 / 编辑器 / 终端 / 快捷键 / 管理 / 关于)
/// keep their order behind it rather than being renumbered. 项目 is the
/// registry page the 管理 card opens: the list of registered projects plus the
/// remove action.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Section {
	/// 生命周期：关闭窗口时 / 开机自启 / 通知.
	#[default]
	General,
	Appearance,
	Editor,
	Terminal,
	Keys,
	Projects,
	Manage,
	About,
}

impl Section {
	pub const ALL: [Self; 8] = [
		Self::General,
		Self::Appearance,
		Self::Editor,
		Self::Terminal,
		Self::Keys,
		Self::Projects,
		Self::Manage,
		Self::About,
	];

	/// The nav label.
	pub fn label(self) -> &'static str {
		match self {
			Self::General => "常规",
			Self::Appearance => "外观",
			Self::Editor => "编辑器",
			Self::Terminal => "终端",
			Self::Keys => "快捷键",
			Self::Projects => "项目",
			Self::Manage => "管理",
			Self::About => "关于",
		}
	}

	/// The `data-sec` key the spec uses.
	pub fn key(self) -> &'static str {
		match self {
			Self::General => "general",
			Self::Appearance => "appearance",
			Self::Editor => "editor",
			Self::Terminal => "terminal",
			Self::Keys => "keys",
			Self::Projects => "projects",
			Self::Manage => "manage",
			Self::About => "about",
		}
	}
}

/// 主题.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Theme {
	#[default]
	Dark,
	Light,
	System,
}

impl Theme {
	pub const ALL: [Self; 3] = [Self::Dark, Self::Light, Self::System];

	pub fn label(self) -> &'static str {
		match self {
			Self::Dark => "深色（默认）",
			Self::Light => "浅色",
			Self::System => "跟随系统",
		}
	}

	fn key(self) -> &'static str {
		match self {
			Self::Dark => "dark",
			Self::Light => "light",
			Self::System => "system",
		}
	}

	fn from_key(key: &str) -> Option<Self> {
		Self::ALL.into_iter().find(|value| value.key() == key)
	}
}

/// 信息密度.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Density {
	Compact,
	#[default]
	Standard,
	Spacious,
}

impl Density {
	pub const ALL: [Self; 3] = [Self::Compact, Self::Standard, Self::Spacious];

	pub fn label(self) -> &'static str {
		match self {
			Self::Compact => "紧凑",
			Self::Standard => "标准",
			Self::Spacious => "宽松",
		}
	}

	/// Row spacing and control padding this density asks for.
	pub fn spacing(self) -> (f32, f32) {
		match self {
			Self::Compact => (2.0, 3.0),
			Self::Standard => (4.0, 4.0),
			Self::Spacious => (8.0, 7.0),
		}
	}

	fn key(self) -> &'static str {
		match self {
			Self::Compact => "compact",
			Self::Standard => "standard",
			Self::Spacious => "spacious",
		}
	}

	fn from_key(key: &str) -> Option<Self> {
		Self::ALL.into_iter().find(|value| value.key() == key)
	}
}

/// 等宽字体. The names are the spec's; a family that is not installed falls
/// back to the CJK grid face (see [`crate::fonts`]).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MonoFont {
	#[default]
	CascadiaCode,
	JetBrainsMono,
	Consolas,
}

impl MonoFont {
	pub const ALL: [Self; 3] = [Self::CascadiaCode, Self::JetBrainsMono, Self::Consolas];

	pub fn label(self) -> &'static str {
		match self {
			Self::CascadiaCode => "Cascadia Code",
			Self::JetBrainsMono => "JetBrains Mono",
			Self::Consolas => "Consolas",
		}
	}

	fn key(self) -> &'static str {
		match self {
			Self::CascadiaCode => "cascadia-code",
			Self::JetBrainsMono => "jetbrains-mono",
			Self::Consolas => "consolas",
		}
	}

	fn from_key(key: &str) -> Option<Self> {
		Self::ALL.into_iter().find(|value| value.key() == key)
	}
}

/// 默认 Shell: which shell a new 终端 page runs.
///
/// `None` means 本机默认 — the first shell [`crate::shells::detect`] finds on
/// this host. The value is stored by [`crate::shells::ShellKind::key`], so the
/// file stays readable by hand and an unknown key falls back to the default
/// instead of failing the whole file.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ShellChoice(pub Option<crate::shells::ShellKind>);

impl ShellChoice {
	pub const ALL: Self = Self(None);

	/// The label the 设置 modal shows.
	pub fn label(self) -> String {
		match self.0 {
			None => "本机默认".to_owned(),
			Some(kind) => format!("{} · {}", kind.label(), kind.program()),
		}
	}

	pub fn kind(self) -> Option<crate::shells::ShellKind> {
		self.0
	}

	fn key(self) -> String {
		self
			.0
			.map(|kind| kind.key().to_owned())
			.unwrap_or_else(|| "default".to_owned())
	}

	fn from_key(key: &str) -> Self {
		if key == "default" {
			return Self(None);
		}
		Self(
			crate::shells::ShellKind::ALL
				.into_iter()
				.find(|kind| kind.key() == key),
		)
	}
}

/// `关闭窗口时` — what the title bar's close button does.
///
/// The default keeps the workbench alive: closing the window is the fastest way
/// to get it out of the way without losing the session state machine and the
/// agent children that go with it. `Ask` is the third choice so the modal only
/// appears when the user asked to be asked.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CloseAction {
	/// 最小化到后台 — hide the window, keep the process and its sessions alive.
	#[default]
	MinimizeToBackground,
	/// 退出应用 — end the process.
	Quit,
	/// 每次询问 — ask on every close, with a 记住我的选择 checkbox.
	Ask,
}

impl CloseAction {
	pub const ALL: [Self; 3] = [Self::MinimizeToBackground, Self::Quit, Self::Ask];

	pub fn label(self) -> &'static str {
		match self {
			Self::MinimizeToBackground => "最小化到后台",
			Self::Quit => "退出应用",
			Self::Ask => "每次询问",
		}
	}

	pub fn key(self) -> &'static str {
		match self {
			Self::MinimizeToBackground => "background",
			Self::Quit => "quit",
			Self::Ask => "ask",
		}
	}

	pub fn from_key(key: &str) -> Option<Self> {
		Self::ALL.into_iter().find(|value| value.key() == key)
	}
}

/// `通知` — when a background edge is allowed to reach the user.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NotifyPolicy {
	/// 关.
	Off,
	/// 仅后台 — only while the window is not in front of the user, which is the
	/// only time a notification says something the screen does not.
	#[default]
	BackgroundOnly,
	/// 总是.
	Always,
}

impl NotifyPolicy {
	pub const ALL: [Self; 3] = [Self::Off, Self::BackgroundOnly, Self::Always];

	pub fn label(self) -> &'static str {
		match self {
			Self::Off => "关",
			Self::BackgroundOnly => "仅后台",
			Self::Always => "总是",
		}
	}

	pub fn key(self) -> &'static str {
		match self {
			Self::Off => "off",
			Self::BackgroundOnly => "background",
			Self::Always => "always",
		}
	}

	pub fn from_key(key: &str) -> Option<Self> {
		Self::ALL.into_iter().find(|value| value.key() == key)
	}

	/// May a notification fire right now? `foreground` is true when the window
	/// is visible *and* focused — the case where the user is already looking at
	/// the thing the notification would announce.
	pub fn allows(self, foreground: bool) -> bool {
		match self {
			Self::Off => false,
			Self::BackgroundOnly => !foreground,
			Self::Always => true,
		}
	}
}

/// Every value the 设置 modal persists.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Settings {
	pub theme: Theme,
	pub density: Density,
	pub reduce_motion: bool,
	pub mono_font: MonoFont,
	/// Editor text size in points: 12, 13, 14 or 16.
	pub editor_size: u8,
	pub editor_wrap: bool,
	pub editor_line_numbers: bool,
	pub shell: ShellChoice,
	/// Terminal text size in points: 12, 13 or 14.
	pub terminal_size: u8,
	/// 关闭窗口时.
	pub close_action: CloseAction,
	/// 开机自启. Stored so the choice survives, and reported as not wired until
	/// a per-user autostart entry is installed.
	pub auto_start: bool,
	/// 通知.
	pub notify: NotifyPolicy,
}

impl Default for Settings {
	fn default() -> Self {
		Self {
			theme: Theme::Dark,
			density: Density::Standard,
			reduce_motion: false,
			mono_font: MonoFont::CascadiaCode,
			editor_size: 13,
			editor_wrap: true,
			editor_line_numbers: true,
			shell: ShellChoice::default(),
			terminal_size: 13,
			close_action: CloseAction::MinimizeToBackground,
			auto_start: false,
			notify: NotifyPolicy::BackgroundOnly,
		}
	}
}

impl Settings {
	/// The editor size choices the row offers, as the spec lists them.
	pub const EDITOR_SIZES: [u8; 4] = [12, 13, 14, 16];
	/// The terminal size choices the row offers.
	pub const TERMINAL_SIZES: [u8; 3] = [12, 13, 14];
}

/// The keys this file owns, with their canonical inline comment (the same
/// shape `zeta-main`'s writer uses).
const MANAGED: [(&str, &str); 12] = [
	("theme", "dark | light | system"),
	("density", "compact | standard | spacious"),
	("reduce_motion", "turn off panel and list transitions"),
	("editor_font", "cascadia-code | jetbrains-mono | consolas"),
	("editor_size", "12 | 13 | 14 | 16"),
	("editor_wrap", "wrap long lines in the editor pane"),
	("editor_line_numbers", "show the gutter in the editor pane"),
	("shell", "default | powershell | pwsh | cmd | bash | git-bash | wsl"),
	("terminal_size", "12 | 13 | 14"),
	("close_action", "background | quit | ask"),
	("auto_start", "start zetawork when the user logs in"),
	("notify", "off | background | always"),
];

const HEADER: &str =
	"# zetawork settings — rewritten by the 设置 surface; other lines are kept verbatim\n";

/// `~/.zeta/zetawork.toml`, next to the TUI's `workbench.toml`.
pub fn settings_path() -> PathBuf {
	let home = std::env::var_os("USERPROFILE")
		.or_else(|| std::env::var_os("HOME"))
		.map(PathBuf::from)
		.unwrap_or_else(|| PathBuf::from("."));
	home.join(".zeta").join("zetawork.toml")
}

/// Read the user's file, falling back to the defaults for anything missing or
/// unreadable.
pub fn load() -> Settings {
	load_from(&settings_path())
}

/// Write the user's file, preserving everything it already held.
pub fn save(settings: Settings) -> std::io::Result<()> {
	save_to(&settings_path(), settings)
}

/// Read a specific file. A file that cannot be read as UTF-8, or that does not
/// exist, yields the defaults; a value that does not parse falls back on its
/// own so the other keys survive.
pub fn load_from(path: &Path) -> Settings {
	let Ok(text) = std::fs::read_to_string(path) else {
		return Settings::default();
	};
	read(&text)
}

/// Write a specific file with the line-preserving merge.
pub fn save_to(path: &Path, settings: Settings) -> std::io::Result<()> {
	if let Some(dir) = path.parent() {
		std::fs::create_dir_all(dir)?;
	}
	let existing = std::fs::read_to_string(path).unwrap_or_default();
	std::fs::write(path, merge(&existing, settings))
}

/// The managed keys from the header-less preamble. Keys after the first table
/// header belong to that table, so the scan stops there.
fn read(text: &str) -> Settings {
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
		// reading the value (no value contains '#').
		let value = value
			.split('#')
			.next()
			.unwrap_or("")
			.trim()
			.trim_matches('"');
		match key.trim() {
			"theme" => settings.theme = Theme::from_key(value).unwrap_or_default(),
			"density" => settings.density = Density::from_key(value).unwrap_or_default(),
			"reduce_motion" => settings.reduce_motion = truthy(value).unwrap_or_default(),
			"editor_font" => settings.mono_font = MonoFont::from_key(value).unwrap_or_default(),
			"editor_size" => settings.editor_size = size(value, &Settings::EDITOR_SIZES).unwrap_or(13),
			"editor_wrap" => settings.editor_wrap = truthy(value).unwrap_or(true),
			"editor_line_numbers" => settings.editor_line_numbers = truthy(value).unwrap_or(true),
			"shell" => settings.shell = ShellChoice::from_key(value),
			"terminal_size" => {
				settings.terminal_size = size(value, &Settings::TERMINAL_SIZES).unwrap_or(13)
			},
			"close_action" => settings.close_action = CloseAction::from_key(value).unwrap_or_default(),
			"auto_start" => settings.auto_start = truthy(value).unwrap_or(false),
			"notify" => settings.notify = NotifyPolicy::from_key(value).unwrap_or_default(),
			_ => {},
		}
	}
	settings
}

/// `None` for anything that is not a boolean, so the caller's own default wins.
fn truthy(value: &str) -> Option<bool> {
	match value.to_ascii_lowercase().as_str() {
		"true" | "yes" | "on" | "1" => Some(true),
		"false" | "no" | "off" | "0" => Some(false),
		_ => None,
	}
}

/// `None` unless the value is one of the offered sizes.
fn size(value: &str, allowed: &[u8]) -> Option<u8> {
	let digits = value.trim_end_matches("px").trim();
	let parsed: u8 = digits.parse().ok()?;
	allowed.contains(&parsed).then_some(parsed)
}

/// The file text for a settings value.
///
/// Everything already in `existing` is kept: lines the shell does not own stay
/// exactly where they are, and a managed key keeps its line, its position and
/// its inline comment — only its value is rewritten. Keys the file was missing
/// are appended to the preamble.
fn merge(existing: &str, settings: Settings) -> String {
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
		return text;
	}
	let mut out = String::new();
	let mut written: Vec<&str> = Vec::new();
	let mut preamble = true;
	for line in existing.split_inclusive('\n') {
		let compact: String = line.chars().filter(|c| !c.is_whitespace()).collect();
		if compact.starts_with('[') {
			// A table this build does not know: keep it verbatim, and write
			// any missing key before it — after the header they would belong
			// to that table.
			insert_missing(settings, &mut out, &mut written, eol);
			preamble = false;
		} else if preamble {
			if let Some((key, _)) = MANAGED.iter().find(|(key, _)| is_key_line(line, key)) {
				out.push_str(&managed_line(key, settings, inline_comment(line), eol));
				written.push(key);
				continue;
			}
		}
		out.push_str(line);
		if !line.ends_with('\n') {
			out.push_str(eol);
		}
	}
	insert_missing(settings, &mut out, &mut written, eol);
	out
}

/// Append the managed keys the file did not have.
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

/// The `#` comment a hand-written line carries, so rewriting its value does not
/// throw the note away.
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
		"theme" => settings.theme.key().to_owned(),
		"density" => settings.density.key().to_owned(),
		"reduce_motion" => settings.reduce_motion.to_string(),
		"editor_font" => settings.mono_font.key().to_owned(),
		"editor_size" => settings.editor_size.to_string(),
		"editor_wrap" => settings.editor_wrap.to_string(),
		"editor_line_numbers" => settings.editor_line_numbers.to_string(),
		"shell" => settings.shell.key().to_owned(),
		"terminal_size" => settings.terminal_size.to_string(),
		"close_action" => settings.close_action.key().to_owned(),
		"auto_start" => settings.auto_start.to_string(),
		"notify" => settings.notify.key().to_owned(),
		_ => String::new(),
	};
	let comment = comment.unwrap_or(fallback);
	format!("{key} = {value}          # {comment}{eol}")
}

impl fmt::Display for Settings {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(
			f,
			"{} · {} · {} · 编辑器 {}px · 终端 {}px",
			self.theme.label(),
			self.density.label(),
			self.mono_font.label(),
			self.editor_size,
			self.terminal_size
		)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn temp_dir(tag: &str) -> PathBuf {
		let dir =
			std::env::temp_dir().join(format!("zetawork-gui-settings-{tag}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		dir
	}

	#[test]
	fn round_trips_every_managed_value() {
		let dir = temp_dir("round-trip");
		let path = dir.join("zetawork.toml");
		let written = Settings {
			theme: Theme::Light,
			density: Density::Spacious,
			reduce_motion: true,
			mono_font: MonoFont::Consolas,
			editor_size: 16,
			editor_wrap: false,
			editor_line_numbers: false,
			shell: ShellChoice(Some(crate::shells::ShellKind::Pwsh)),
			terminal_size: 12,
			// The lifecycle keys must round-trip too, and with values that are
			// *not* their defaults, or a write that dropped them would still
			// pass.
			close_action: CloseAction::Ask,
			auto_start: true,
			notify: NotifyPolicy::Always,
		};
		save_to(&path, written).unwrap();
		assert_eq!(load_from(&path), written, "{}", std::fs::read_to_string(&path).unwrap());
		// A second write must not accumulate duplicate keys.
		save_to(&path, written).unwrap();
		let text = std::fs::read_to_string(&path).unwrap();
		assert_eq!(text.matches("theme =").count(), 1, "{text}");
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn a_missing_file_reads_as_the_defaults() {
		let dir = temp_dir("missing");
		let settings = load_from(&dir.join("nope.toml"));
		assert_eq!(settings, Settings::default());
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn a_file_that_is_not_utf8_reads_as_the_defaults() {
		let dir = temp_dir("binary");
		let path = dir.join("zetawork.toml");
		std::fs::write(&path, [0xff, 0xfe, 0x00, 0x9c, 0x80, 0x01]).unwrap();
		assert_eq!(load_from(&path), Settings::default());
		// …and writing over it recovers the file.
		save_to(&path, Settings::default()).unwrap();
		assert_eq!(load_from(&path), Settings::default());
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn each_key_falls_back_on_its_own() {
		let dir = temp_dir("partial");
		let path = dir.join("zetawork.toml");
		// A hand-edited file: two keys are nonsense, one is out of range, one
		// line is not an assignment at all, and the rest is fine.
		std::fs::write(
			&path,
			"# hand written\ntheme = 不是主题\neditor_size = 99\ndensity = compact\n = = \
			 =\neditor_font = consolas\nterminal_size = 14px\n",
		)
		.unwrap();
		let settings = load_from(&path);
		assert_eq!(settings.theme, Theme::Dark, "a bad value falls back");
		assert_eq!(settings.editor_size, 13, "an out-of-range size falls back");
		assert_eq!(settings.density, Density::Compact, "a good value survives");
		assert_eq!(settings.mono_font, MonoFont::Consolas, "a good value survives");
		assert_eq!(settings.terminal_size, 14, "a bare px suffix is accepted");
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn foreign_lines_comments_and_crlf_survive_a_rewrite() {
		let dir = temp_dir("preserve");
		let path = dir.join("zetawork.toml");
		let original = "# mine\r\ntheme = light          # keep this note\r\nunknown_key = \
		                42\r\n\r\n[other]\r\ninner = true\r\n";
		std::fs::write(&path, original).unwrap();
		let mut settings = load_from(&path);
		assert_eq!(settings.theme, Theme::Light, "a # comment does not swallow the value");
		settings.editor_size = 12;
		save_to(&path, settings).unwrap();
		let text = std::fs::read_to_string(&path).unwrap();
		assert!(text.contains("# keep this note"), "{text}");
		assert!(text.contains("unknown_key = 42"), "{text}");
		assert!(text.contains("[other]\r\ninner = true"), "{text}");
		assert!(text.contains("editor_size = 12"), "{text}");
		assert!(text.contains("\r\n"), "CRLF files stay CRLF");
		assert_eq!(load_from(&path), settings);
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn keys_missing_from_a_hand_written_file_are_appended_before_any_table() {
		let dir = temp_dir("append");
		let path = dir.join("zetawork.toml");
		std::fs::write(&path, "theme = light\n\n[other]\ninner = true\n").unwrap();
		let settings = Settings { theme: Theme::Light, ..Settings::default() };
		save_to(&path, settings).unwrap();
		let text = std::fs::read_to_string(&path).unwrap();
		let table = text.find("[other]").unwrap();
		let appended = text.find("editor_size =").unwrap();
		assert!(appended < table, "appended keys must stay in the preamble:\n{text}");
		assert_eq!(load_from(&path), settings);
		let _ = std::fs::remove_dir_all(&dir);
	}
}
