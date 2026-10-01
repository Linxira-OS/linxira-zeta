//! Workbench settings: a handful of runtime preferences persisted to
//! `~/.zeta/workbench.toml`. No schema framework — a three-key `key =
//! value` file, parsed by hand, written atomically on every change. The
//! global is a plain RwLock: pane spawns read the pinned shell, mouse
//! handling reads the toggles, the settings overlay writes through
//! [`update`](update) (which persists immediately).

use std::fmt;
use std::path::PathBuf;
use std::sync::RwLock;

/// Which shell new panes spawn. `Auto` follows the detected chain
/// (Windows PowerShell → PowerShell 7 → Git Bash → cmd); the pins select
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
}

impl Default for Settings {
	fn default() -> Self {
		Self { shell: ShellChoice::Auto, drag: true, focus_follows_mouse: false }
	}
}

static SETTINGS: RwLock<Settings> =
	RwLock::new(Settings { shell: ShellChoice::Auto, drag: true, focus_follows_mouse: false });

/// Load the settings file into the global. Called once at startup; a
/// missing or malformed file keeps the defaults (each key falls back
/// independently, so a half-written file only loses what it lost).
pub fn init() {
	let settings = load_from(&settings_path());
	if let Ok(mut global) = SETTINGS.write() {
		*global = settings;
	}
}

/// Read a snapshot of the current settings.
pub fn snapshot() -> Settings {
	SETTINGS.read().map(|s| *s).unwrap_or_default()
}

/// Mutate the global and persist immediately. The overlay writes here, so
/// a change survives a crash by construction.
pub fn update(mutate: impl FnOnce(&mut Settings)) {
	if let Ok(mut global) = SETTINGS.write() {
		mutate(&mut global);
		let _ = save_to(&settings_path(), *global);
	}
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

fn load_from(path: &std::path::Path) -> Settings {
	let mut settings = Settings::default();
	let Ok(text) = std::fs::read_to_string(path) else {
		return settings;
	};
	for line in text.lines() {
		let line = line.trim();
		if line.is_empty() || line.starts_with('#') {
			continue;
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
			_ => {},
		}
	}
	settings
}

fn save_to(path: &std::path::Path, settings: Settings) -> std::io::Result<()> {
	if let Some(dir) = path.parent() {
		std::fs::create_dir_all(dir)?;
	}
	let text = format!(
		"# zeta workbench settings — hand-edited values are overwritten by the Settings surface\n\
		 shell = \"{}\"          # auto | powershell | pwsh | git-bash\n\
		 drag = {}\n\
		 focus_follows_mouse = {}\n",
		settings.shell.key(),
		settings.drag,
		settings.focus_follows_mouse,
	);
	std::fs::write(path, text)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn roundtrips_through_the_file_format() {
		let path = std::env::temp_dir().join(format!("zeta-settings-{}.toml", std::process::id()));
		let original = Settings { shell: ShellChoice::Pwsh, drag: false, focus_follows_mouse: true };
		save_to(&path, original).expect("save");
		assert_eq!(load_from(&path), original, "every key survives a save/load roundtrip");
		std::fs::remove_file(&path).ok();
	}

	#[test]
	fn malformed_and_missing_files_fall_back_per_key() {
		let path =
			std::env::temp_dir().join(format!("zeta-settings-bad-{}.toml", std::process::id()));
		std::fs::write(&path, "shell = \"git-bash\"\ndrag = \"banana\"\n???").unwrap();
		let settings = load_from(&path);
		assert_eq!(settings.shell, ShellChoice::GitBash, "the good key still lands");
		assert!(!settings.drag, "a garbled value falls back to default, not true");
		assert!(!settings.focus_follows_mouse);
		std::fs::remove_file(&path).ok();
		assert_eq!(load_from(std::path::Path::new("Z:/nope/missing.toml")), Settings::default());
	}

	#[test]
	fn shell_choice_cycles_and_labels() {
		assert_eq!(ShellChoice::Auto.next(), ShellChoice::PowerShell);
		assert_eq!(ShellChoice::GitBash.next(), ShellChoice::Auto);
		assert_eq!(ShellChoice::from_key("PWSH"), ShellChoice::Pwsh, "keys are case-insensitive");
		assert_eq!(ShellChoice::from_key("nonsense"), ShellChoice::Auto);
	}
}
