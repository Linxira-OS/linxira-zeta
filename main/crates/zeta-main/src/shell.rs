//! Shell chain and binary probing for pane spawning.
//!
//! The chain order is a product ruling: on Windows prefer Windows
//! PowerShell, then PowerShell 7 (`pwsh`), then Git Bash (derived from
//! git.exe), with cmd.exe strictly last-resort — and install panes never
//! use cmd.exe. Unix keeps the plain `$SHELL` → `/bin/bash` → `/bin/sh`
//! chain.
//!
//! Binary probing is PATHEXT-aware. npm's global installs on Windows are
//! shims — `name` (sh), `name.ps1`, `name.cmd` — and there is no
//! `name.exe`, so the old `.exe`-only probe reported installed tools as
//! missing (the "Split zeta-c opens an install pane" bug). Probing reads
//! the process PATH — the same value termide hands the pty child via
//! `set_env` — and augments it with the npm/native global-bin directories
//! a GUI-spawned process may be missing, then falls back to `where.exe`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

/// The behavior family of a shell: how it parses command lines and quotes
/// paths.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ShellFlavor {
	/// Windows PowerShell / PowerShell 7 — `&` call operator, `'…'`
	/// quoting, accepts drive-letter forward slashes.
	PowerShell,
	/// POSIX shells: Git Bash on Windows, login shells on Unix.
	Posix,
	/// cmd.exe — last-resort shell only, never for install panes.
	Cmd,
}

/// A spawnable shell: its full path plus the behavior family.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Shell {
	pub path: PathBuf,
	pub flavor: ShellFlavor,
}

impl Shell {
	/// A command line that executes `target` from this shell's interactive
	/// prompt, quoted correctly for paths with spaces.
	pub fn quote_exec(&self, target: &Path) -> String {
		match self.flavor {
			// PowerShell refuses to execute a quoted path bare: the `&`
			// call operator is required.
			ShellFlavor::PowerShell => format!("& '{}'", self.path_text(target)),
			ShellFlavor::Posix => format!("'{}'", self.path_text(target)),
			ShellFlavor::Cmd => format!("\"{}\"", target.display()),
		}
	}

	/// Path text in the spelling the shell parses best.
	fn path_text(&self, target: &Path) -> String {
		let text = target.to_string_lossy().into_owned();
		match self.flavor {
			// Inside '…' only the quote itself needs doubling.
			ShellFlavor::PowerShell => text.replace('\'', "''"),
			// Bash treats backslashes as escape characters: force forward
			// slashes (Git Bash accepts drive-letter forward slashes).
			ShellFlavor::Posix => text.replace('\\', "/").replace('\'', "'\\''"),
			ShellFlavor::Cmd => text,
		}
	}
}

/// Which behavior family a shell path belongs to, judged by file name.
fn flavor_for(path: &Path) -> Option<ShellFlavor> {
	let name = path.file_name()?.to_str()?;
	let name = name.rsplit('.').next()?.to_ascii_lowercase();
	let stem = if name == "exe" {
		path.file_stem()?.to_str()?.to_ascii_lowercase()
	} else {
		name
	};
	match stem.as_str() {
		"powershell" | "pwsh" => Some(ShellFlavor::PowerShell),
		"bash" | "sh" | "zsh" | "fish" | "dash" | "ksh" => Some(ShellFlavor::Posix),
		"cmd" => Some(ShellFlavor::Cmd),
		_ => None,
	}
}

fn as_shell(path: PathBuf) -> Option<Shell> {
	Some(Shell { flavor: flavor_for(&path)?, path })
}

/// Platform probes, injectable so tests can fake the machine.
pub struct Probes<'a> {
	pub env: &'a dyn Fn(&str) -> Option<String>,
	pub where_: &'a dyn Fn(&str) -> Option<String>,
	pub exists: &'a dyn Fn(&Path) -> bool,
}

/// The Windows chain in the product-ruled order: `$SHELL` (absolute
/// Windows path only) → Windows PowerShell → PowerShell 7 → Git Bash →
/// cmd.exe. The chain always ends in cmd.exe, so it is never empty.
fn chain_windows(p: &Probes) -> Vec<Shell> {
	let mut shells: Vec<Shell> = Vec::new();
	let push = |shells: &mut Vec<Shell>, path: PathBuf, p: &Probes| {
		if !(p.exists)(&path) || shells.iter().any(|s| s.path == path) {
			return;
		}
		if let Some(shell) = as_shell(path) {
			shells.push(shell);
		}
	};

	// $SHELL wins first, but only as an absolute Windows path — MSYS/Git
	// Bash export "/usr/bin/bash", which a native binary cannot spawn.
	if let Some(shell) = (p.env)("SHELL") {
		if shell.contains(':') {
			push(&mut shells, PathBuf::from(shell), p);
		}
	}

	// Windows PowerShell ships with the OS under System32 — locate it
	// without touching PATH so a stale GUI PATH still finds it.
	let win_dir = (p.env)("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
	push(
		&mut shells,
		PathBuf::from(format!(r"{win_dir}\System32\WindowsPowerShell\v1.0\powershell.exe")),
		p,
	);
	if let Some(hit) = (p.where_)("powershell.exe") {
		push(&mut shells, PathBuf::from(hit), p);
	}

	// PowerShell 7 (pwsh): PATH first, then the standard install roots.
	if let Some(hit) = (p.where_)("pwsh.exe") {
		push(&mut shells, PathBuf::from(hit), p);
	}
	let program_files = (p.env)("ProgramFiles").unwrap_or_else(|| r"C:\Program Files".into());
	for version in ["7", "6"] {
		push(
			&mut shells,
			PathBuf::from(format!(r"{program_files}\PowerShell\{version}\pwsh.exe")),
			p,
		);
	}

	// Git Bash: standard install locations plus a derivation from git.exe
	// (Git may live on any drive). Never probe `where bash.exe` — that
	// resolves to the WSL launcher on stock Windows.
	let mut git_bash = vec![
		r"C:\Program Files\Git\bin\bash.exe".to_string(),
		r"C:\Program Files (x86)\Git\bin\bash.exe".to_string(),
	];
	if let Some(git) = (p.where_)("git.exe") {
		if let Some(root) = git.strip_suffix(r"\cmd\git.exe") {
			git_bash.push(format!(r"{root}\bin\bash.exe"));
		}
	}
	for path in git_bash {
		push(&mut shells, PathBuf::from(path), p);
	}

	// cmd.exe strictly last.
	let comspec = (p.env)("COMSPEC").unwrap_or_else(|| "cmd.exe".into());
	push(&mut shells, PathBuf::from(comspec), p);

	shells
}

/// The Unix chain: `$SHELL` → `/bin/bash` → `/bin/sh`.
fn chain_unix(p: &Probes) -> Vec<Shell> {
	let mut shells: Vec<Shell> = Vec::new();
	if let Some(shell) = (p.env)("SHELL") {
		if (p.exists)(Path::new(&shell)) {
			if let Some(shell) = as_shell(PathBuf::from(shell)) {
				shells.push(shell);
			}
		}
	}
	for path in ["/bin/bash", "/bin/sh"] {
		if (p.exists)(Path::new(path)) && !shells.iter().any(|s| s.path == Path::new(path)) {
			if let Some(shell) = as_shell(PathBuf::from(path)) {
				shells.push(shell);
			}
		}
	}
	shells
}

fn real_probes() -> Probes<'static> {
	Probes {
		env: &|name: &str| std::env::var(name).ok(),
		where_: &|bin: &str| {
			let output = Command::new("where.exe").arg(bin).output().ok()?;
			if !output.status.success() {
				return None;
			}
			String::from_utf8_lossy(&output.stdout)
				.lines()
				.next()
				.map(str::trim)
				.filter(|line| !line.is_empty())
				.map(str::to_string)
		},
		exists: &|path: &Path| path.exists(),
	}
}

/// The shell chain (cached): every pane spawns through one of these.
fn cached_chain() -> &'static [Shell] {
	static CHAIN: OnceLock<Vec<Shell>> = OnceLock::new();
	CHAIN.get_or_init(|| {
		let probes = real_probes();
		if cfg!(windows) {
			chain_windows(&probes)
		} else {
			chain_unix(&probes)
		}
	})
}

/// The shell a pane spawns — first of the chain. On Windows the chain
/// always ends in cmd.exe, so this never fails in practice.
pub fn detect_shell() -> Shell {
	cached_chain()
		.first()
		.cloned()
		.unwrap_or(Shell { path: PathBuf::from("cmd.exe"), flavor: ShellFlavor::Cmd })
}

/// The shell install panes run in: the chain without cmd.exe — installs
/// must never open a cmd window. `None` only when no modern shell exists.
pub fn detect_install_shell() -> Option<Shell> {
	cached_chain()
		.iter()
		.find(|shell| shell.flavor != ShellFlavor::Cmd)
		.cloned()
}

// --- binary probing ------------------------------------------------------

/// File-name extensions probed per bin name, in preference order. On
/// Windows the extensionless file is npm's sh shim and `.ps1`/`.cmd` are
/// its PowerShell/cmd shims; a real binary is `.exe`. Elsewhere bins have
/// no extension.
pub fn candidate_extensions() -> &'static [&'static str] {
	if cfg!(windows) {
		&["", ".exe", ".ps1", ".cmd", ".bat"]
	} else {
		&[""]
	}
}

/// All existing candidates for `names` under `dirs`, directory-major
/// (PATH order wins), extension order within a directory.
pub fn scan_dirs<F>(dirs: &[PathBuf], names: &[&str], exts: &[&str], mut is_file: F) -> Vec<PathBuf>
where
	F: FnMut(&Path) -> bool,
{
	let mut found = Vec::new();
	for dir in dirs {
		for name in names {
			for ext in exts {
				let candidate = dir.join(format!("{name}{ext}"));
				if is_file(&candidate) {
					found.push(candidate);
				}
			}
		}
	}
	found
}

/// npm/native global-bin directories that a stale GUI PATH may be missing:
/// npm's default per-user prefix, pnpm's and bun's install dirs.
pub fn augmented_windows_dirs(
	appdata: Option<&str>,
	localappdata: Option<&str>,
	userprofile: Option<&str>,
) -> Vec<PathBuf> {
	let mut dirs = Vec::new();
	if let Some(appdata) = appdata {
		dirs.push(PathBuf::from(appdata).join("npm"));
	}
	if let Some(localappdata) = localappdata {
		dirs.push(PathBuf::from(localappdata).join("pnpm"));
	}
	if let Some(userprofile) = userprofile {
		dirs.push(PathBuf::from(userprofile).join(".bun").join("bin"));
	}
	dirs
}

/// `where.exe <bin>` — the shell's own PATHEXT resolution, as full paths.
/// Cached per name: each probe spawns a process, and resolution results do
/// not change within a running workbench.
fn where_all_cached(bin: &str) -> Vec<PathBuf> {
	static CACHE: OnceLock<Mutex<HashMap<String, Vec<PathBuf>>>> = OnceLock::new();
	let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
	cache
		.lock()
		.unwrap_or_else(|error| error.into_inner())
		.entry(bin.to_string())
		.or_insert_with(|| where_all(bin))
		.clone()
}

fn where_all(bin: &str) -> Vec<PathBuf> {
	let Ok(output) = Command::new("where.exe").arg(bin).output() else {
		return Vec::new();
	};
	if !output.status.success() {
		return Vec::new();
	}
	String::from_utf8_lossy(&output.stdout)
		.lines()
		.map(str::trim)
		.filter(|line| !line.is_empty())
		.map(PathBuf::from)
		.filter(|path| path.is_file())
		.collect()
}

/// Every existing candidate for `names`: the process PATH first — the same
/// value termide hands the pty child, so probes and spawned shells see one
/// PATH — then the npm/native global-bin dirs when PATH probes come up
/// empty, then `where.exe` as the final word.
pub fn resolve_bin_candidates(names: &[&str]) -> Vec<PathBuf> {
	let exts = candidate_extensions();
	let dirs = path_dirs();
	let mut found = scan_dirs(&dirs, names, exts, |path| path.is_file());
	if found.is_empty() && cfg!(windows) {
		let mut all = dirs;
		all.extend(augmented_windows_dirs(
			std::env::var("APPDATA").ok().as_deref(),
			std::env::var("LOCALAPPDATA").ok().as_deref(),
			std::env::var("USERPROFILE").ok().as_deref(),
		));
		found = scan_dirs(&all, names, exts, |path| path.is_file());
	}
	if found.is_empty() && cfg!(windows) {
		for name in names {
			found.extend(where_all_cached(name));
		}
	}
	found.dedup();
	found
}

/// PATH directories of this process.
fn path_dirs() -> Vec<PathBuf> {
	std::env::var_os("PATH")
		.map(|path| std::env::split_paths(&path).collect())
		.unwrap_or_default()
}

// --- command construction ------------------------------------------------

/// Candidate extension preference for executing a tool from a shell.
fn exec_preference(flavor: ShellFlavor) -> &'static [&'static str] {
	match flavor {
		// PowerShell runs .exe directly; .ps1/.cmd via its own shim rules.
		ShellFlavor::PowerShell => &[".exe", ".ps1", ".cmd", ".bat", ""],
		// bash runs native .exe files and npm's extensionless sh shim.
		ShellFlavor::Posix => &[".exe", ""],
		ShellFlavor::Cmd => &[".exe", ".cmd", ".bat"],
	}
}

/// A command line that runs the best candidate for `shell` from its
/// interactive prompt. Falls back to the first candidate when no
/// extension matches the flavor's preference.
pub fn exec_line(shell: &Shell, candidates: &[PathBuf]) -> Option<String> {
	exec_line_in(shell, candidates, &path_dirs())
}

/// `exec_line` with the PATH injected — the seam that keeps the bare-name
/// decision deterministic under test.
fn exec_line_in(shell: &Shell, candidates: &[PathBuf], path: &[PathBuf]) -> Option<String> {
	let first = candidates.first()?;
	let ext = |path: &Path| match path.extension().and_then(|e| e.to_str()) {
		Some(ext) => format!(".{}", ext.to_ascii_lowercase()),
		None => String::new(),
	};
	let target = exec_preference(shell.flavor)
		.iter()
		.find_map(|want| candidates.iter().find(|c| ext(c) == *want))
		.unwrap_or(first);
	// A tool already on the process PATH is typed as its bare command name:
	// the pane shell resolves the same name through the same PATH, so the
	// pane reads exactly like a hand-typed invocation instead of some
	// generated shim incantation. Only tools found off-PATH (augmented
	// global-bin dirs, where.exe) fall back to a full quoted path.
	if let Some(stem) = target.file_stem().and_then(|stem| stem.to_str()) {
		let bare_ok = match ext(target).as_str() {
			// Extensionless npm sh shims resolve by name in bash only.
			"" => shell.flavor == ShellFlavor::Posix,
			extension => exec_preference(shell.flavor).contains(&extension),
		};
		let on_path = target
			.parent()
			.and_then(|parent| parent.to_str())
			.is_some_and(|parent| {
				path.iter().any(|dir| {
					dir.to_str()
						.is_some_and(|dir| parent.eq_ignore_ascii_case(dir))
				})
			});
		if bare_ok && on_path {
			return Some(stem.to_string());
		}
	}
	Some(shell.quote_exec(target))
}

/// Build a std Command that executes the tool outside any pane — the
/// `zeta code|editor|ide|files` hand-off. Prefers a real `.exe`; npm shims
/// go through their native runner: `.ps1` via PowerShell, `.cmd`/`.bat`
/// via cmd, extensionless sh shims via Git Bash.
pub fn plan_exec(candidates: &[PathBuf], args: &[String]) -> Option<Command> {
	let first = candidates.first()?;
	if !cfg!(windows) {
		let mut command = Command::new(first);
		command.args(args);
		return Some(command);
	}
	let ext = |path: &Path| match path.extension().and_then(|e| e.to_str()) {
		Some(ext) => format!(".{}", ext.to_ascii_lowercase()),
		None => String::new(),
	};
	if let Some(exe) = candidates.iter().find(|c| ext(c) == ".exe") {
		let mut command = Command::new(exe);
		command.args(args);
		return Some(command);
	}
	if let Some(ps1) = candidates.iter().find(|c| ext(c) == ".ps1") {
		let mut command = Command::new(powershell_path());
		command
			.args(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
			.arg(ps1)
			.args(args);
		return Some(command);
	}
	if let Some(shim) = candidates
		.iter()
		.find(|c| matches!(ext(c).as_str(), ".cmd" | ".bat"))
	{
		let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
		let mut command = Command::new(comspec);
		command.arg("/c").arg(shim).args(args);
		return Some(command);
	}
	// Extensionless sh shim: Git Bash executes script files by argument.
	let sh = candidates.iter().find(|c| ext(c).is_empty())?;
	let bash = cached_chain()
		.iter()
		.find(|shell| shell.flavor == ShellFlavor::Posix)?;
	let mut command = Command::new(&bash.path);
	command.arg(sh).args(args);
	Some(command)
}

/// A PowerShell executable: the chain's PowerShell flavor first, then the
/// OS-guaranteed System32 location.
fn powershell_path() -> PathBuf {
	if let Some(shell) = cached_chain()
		.iter()
		.find(|shell| shell.flavor == ShellFlavor::PowerShell)
	{
		return shell.path.clone();
	}
	let win_dir = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
	PathBuf::from(format!(r"{win_dir}\System32\WindowsPowerShell\v1.0\powershell.exe"))
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::collections::HashSet;

	struct Fake {
		env: HashMap<&'static str, String>,
		where_: HashMap<&'static str, String>,
		paths: HashSet<&'static str>,
	}

	impl Fake {
		fn new() -> Self {
			Self { env: HashMap::new(), where_: HashMap::new(), paths: HashSet::new() }
		}
		fn with_env(mut self, key: &'static str, value: &str) -> Self {
			self.env.insert(key, value.to_string());
			self
		}
		fn with_where(mut self, bin: &'static str, hit: &str) -> Self {
			self.where_.insert(bin, hit.to_string());
			self
		}
		fn with_paths(mut self, paths: &[&'static str]) -> Self {
			self.paths.extend(paths.iter().copied());
			self
		}
		/// The Windows chain as this fake machine resolves it.
		fn chain(&self) -> Vec<Shell> {
			let env = |name: &str| self.env.get(name).cloned();
			let where_ = |bin: &str| self.where_.get(bin).cloned();
			let exists = |path: &Path| self.paths.contains(path.to_str().unwrap_or(""));
			let probes = Probes { env: &env, where_: &where_, exists: &exists };
			chain_windows(&probes)
		}
	}

	#[test]
	fn flavor_recognition() {
		assert_eq!(flavor_for(Path::new(r"C:\x\powershell.exe")), Some(ShellFlavor::PowerShell));
		assert_eq!(flavor_for(Path::new(r"C:\x\pwsh.exe")), Some(ShellFlavor::PowerShell));
		assert_eq!(flavor_for(Path::new(r"C:\x\pwsh")), Some(ShellFlavor::PowerShell));
		assert_eq!(flavor_for(Path::new(r"C:\x\bash.exe")), Some(ShellFlavor::Posix));
		assert_eq!(flavor_for(Path::new("/bin/bash")), Some(ShellFlavor::Posix));
		assert_eq!(flavor_for(Path::new(r"C:\x\cmd.exe")), Some(ShellFlavor::Cmd));
		assert_eq!(flavor_for(Path::new(r"C:\x\notepad.exe")), None);
	}

	#[test]
	fn quote_exec_powershell_call_operator_and_quote_doubling() {
		let shell = Shell { path: PathBuf::from("powershell.exe"), flavor: ShellFlavor::PowerShell };
		assert_eq!(
			shell.quote_exec(Path::new(r"C:\Program Files\App\zeta-c.ps1")),
			r"& 'C:\Program Files\App\zeta-c.ps1'"
		);
		assert_eq!(shell.quote_exec(Path::new(r"C:\od d's\x.exe")), r"& 'C:\od d''s\x.exe'");
	}

	#[test]
	fn quote_exec_posix_forward_slashes_and_escape() {
		let shell = Shell { path: PathBuf::from("bash.exe"), flavor: ShellFlavor::Posix };
		assert_eq!(
			shell.quote_exec(Path::new(r"C:\Users\a b\AppData\Roaming\npm\zeta-c")),
			"'C:/Users/a b/AppData/Roaming/npm/zeta-c'"
		);
		assert_eq!(shell.quote_exec(Path::new(r"C:\it's\x")), r"'C:/it'\''s/x'");
	}

	#[test]
	fn quote_exec_cmd_double_quotes() {
		let shell = Shell { path: PathBuf::from("cmd.exe"), flavor: ShellFlavor::Cmd };
		assert_eq!(
			shell.quote_exec(Path::new(r"C:\Program Files\App\tool.cmd")),
			r#""C:\Program Files\App\tool.cmd""#
		);
	}

	#[cfg(windows)]
	#[test]
	fn windows_chain_order_powershell_pwsh_gitbash_cmd() {
		let fake = Fake::new()
			.with_where("pwsh.exe", r"C:\Program Files\PowerShell\7\pwsh.exe")
			.with_where("powershell.exe", r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe")
			.with_where("git.exe", r"E:\Tools\Git\cmd\git.exe")
			.with_paths(&[
				r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
				r"C:\Program Files\PowerShell\7\pwsh.exe",
				r"E:\Tools\Git\bin\bash.exe",
				r"C:\Windows\System32\cmd.exe",
			])
			.with_env("COMSPEC", r"C:\Windows\System32\cmd.exe");
		let flavors: Vec<ShellFlavor> = fake.chain().iter().map(|s| s.flavor).collect();
		assert_eq!(
			flavors,
			vec![
				ShellFlavor::PowerShell,
				ShellFlavor::PowerShell,
				ShellFlavor::Posix,
				ShellFlavor::Cmd
			],
			"ruled order: Windows PowerShell, pwsh, Git Bash, cmd — never otherwise"
		);
	}

	#[cfg(windows)]
	#[test]
	fn windows_chain_powershell_before_pwsh_even_when_only_pwsh_on_where() {
		// Windows PowerShell comes from System32 without any PATH/where
		// hit; pwsh found via where must land AFTER it.
		let fake = Fake::new()
			.with_where("pwsh.exe", r"D:\pwsh\pwsh.exe")
			.with_paths(&[
				r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
				r"D:\pwsh\pwsh.exe",
				r"C:\Windows\System32\cmd.exe",
			])
			.with_env("COMSPEC", r"C:\Windows\System32\cmd.exe");
		let paths: Vec<String> = fake
			.chain()
			.iter()
			.map(|s| s.path.to_string_lossy().into_owned())
			.collect();
		assert_eq!(paths.len(), 3);
		assert!(paths[0].ends_with(r"WindowsPowerShell\v1.0\powershell.exe"));
		assert_eq!(paths[1], r"D:\pwsh\pwsh.exe");
	}

	#[cfg(windows)]
	#[test]
	fn windows_chain_rejects_msys_shell_env() {
		// $SHELL=/usr/bin/bash (MSYS spelling) must be ignored: no drive
		// letter, a native binary cannot spawn it.
		let fake = Fake::new()
			.with_env("SHELL", "/usr/bin/bash")
			.with_paths(&[r"C:\Windows\System32\cmd.exe"])
			.with_env("COMSPEC", r"C:\Windows\System32\cmd.exe");
		let shells = fake.chain();
		assert_eq!(shells.len(), 1, "only the cmd fallback remains");
		assert_eq!(shells[0].flavor, ShellFlavor::Cmd);
	}

	#[cfg(windows)]
	#[test]
	fn windows_chain_honors_absolute_windows_shell_env() {
		let fake = Fake::new()
			.with_env("SHELL", r"D:\shells\bash.exe")
			.with_paths(&[r"D:\shells\bash.exe", r"C:\Windows\System32\cmd.exe"])
			.with_env("COMSPEC", r"C:\Windows\System32\cmd.exe");
		let shells = fake.chain();
		assert_eq!(shells[0].path, PathBuf::from(r"D:\shells\bash.exe"));
		assert_eq!(shells[0].flavor, ShellFlavor::Posix);
	}

	#[cfg(windows)]
	#[test]
	fn install_chain_never_contains_cmd() {
		// Only cmd exists: the full chain falls back to cmd, but the
		// install chain refuses — installs must never open a cmd window.
		let fake = Fake::new()
			.with_paths(&[r"C:\Windows\System32\cmd.exe"])
			.with_env("COMSPEC", r"C:\Windows\System32\cmd.exe");
		let full = fake.chain();
		assert_eq!(full.last().map(|s| s.flavor), Some(ShellFlavor::Cmd));
		assert!(full.iter().find(|s| s.flavor != ShellFlavor::Cmd).is_none());
	}

	#[cfg(windows)]
	#[test]
	fn install_chain_skips_cmd_keeps_modern_shells() {
		let fake = Fake::new()
			.with_paths(&[
				r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
				r"C:\Windows\System32\cmd.exe",
			])
			.with_env("COMSPEC", r"C:\Windows\System32\cmd.exe");
		let install: Vec<ShellFlavor> = fake
			.chain()
			.iter()
			.filter(|s| s.flavor != ShellFlavor::Cmd)
			.map(|s| s.flavor)
			.collect();
		assert_eq!(install, vec![ShellFlavor::PowerShell]);
	}

	#[test]
	fn scan_dirs_prefers_directory_order_then_extension_order() {
		let temp = std::env::temp_dir().join(format!("zeta-shell-scan-{}", std::process::id()));
		let first = temp.join("first");
		let second = temp.join("second");
		std::fs::create_dir_all(&first).unwrap();
		std::fs::create_dir_all(&second).unwrap();
		// Same bin in both dirs, all shim forms: directory-major order must
		// win over extension preference.
		for name in ["tool", "tool.exe", "tool.ps1", "tool.cmd"] {
			std::fs::write(first.join(name), b"").unwrap();
		}
		std::fs::write(second.join("tool.exe"), b"").unwrap();
		let found = scan_dirs(
			&[first.clone(), second.clone()],
			&["tool"],
			&["", ".exe", ".ps1", ".cmd", ".bat"],
			|path| path.is_file(),
		);
		assert_eq!(
			found,
			vec![
				first.join("tool"),
				first.join("tool.exe"),
				first.join("tool.ps1"),
				first.join("tool.cmd"),
				second.join("tool.exe"),
			]
		);
		std::fs::remove_dir_all(&temp).ok();
	}

	#[test]
	fn augmented_windows_dirs_covers_npm_pnpm_bun() {
		let dirs = augmented_windows_dirs(
			Some(r"C:\Users\u\AppData\Roaming"),
			Some(r"C:\Users\u\AppData\Local"),
			Some(r"C:\Users\u"),
		);
		assert_eq!(
			dirs,
			vec![
				PathBuf::from(r"C:\Users\u\AppData\Roaming\npm"),
				PathBuf::from(r"C:\Users\u\AppData\Local\pnpm"),
				PathBuf::from(r"C:\Users\u\.bun\bin"),
			]
		);
		assert!(augmented_windows_dirs(None, None, None).is_empty());
	}

	#[test]
	fn exec_line_prefers_exe_then_flavor_shim() {
		let ps = Shell { path: PathBuf::from("powershell.exe"), flavor: ShellFlavor::PowerShell };
		let candidates = vec![
			PathBuf::from(r"C:\npm\zeta-c"),
			PathBuf::from(r"C:\npm\zeta-c.ps1"),
			PathBuf::from(r"C:\npm\zeta-c.cmd"),
		];
		assert_eq!(
			exec_line_in(&ps, &candidates, &[]),
			Some(r"& 'C:\npm\zeta-c.ps1'".to_string()),
			"PowerShell prefers its own shim form"
		);
		let with_exe = vec![PathBuf::from(r"C:\scoop\shims\tool.exe")];
		assert_eq!(
			exec_line_in(&ps, &with_exe, &[]),
			Some(r"& 'C:\scoop\shims\tool.exe'".to_string())
		);

		let bash = Shell { path: PathBuf::from("bash.exe"), flavor: ShellFlavor::Posix };
		assert_eq!(
			exec_line_in(&bash, &candidates, &[]),
			Some("'C:/npm/zeta-c'".to_string()),
			"bash prefers the extensionless sh shim"
		);

		let cmd = Shell { path: PathBuf::from("cmd.exe"), flavor: ShellFlavor::Cmd };
		assert_eq!(
			exec_line_in(&cmd, &candidates, &[]),
			Some(r#""C:\npm\zeta-c.cmd""#.to_string()),
			"cmd prefers the .cmd shim"
		);
	}

	#[test]
	fn exec_line_types_the_bare_name_when_the_tool_is_on_path() {
		let ps = Shell { path: PathBuf::from("powershell.exe"), flavor: ShellFlavor::PowerShell };
		let npm = PathBuf::from(r"C:\Users\u\AppData\Roaming\npm");
		let shims = vec![npm.join("zetacode.ps1"), npm.join("zetacode.cmd"), npm.join("zetacode")];
		assert_eq!(
			exec_line_in(&ps, &shims, &[npm.clone()]),
			Some("zetacode".to_string()),
			"on-PATH tools are invoked like a hand-typed command, not a shim incantation"
		);
		// Same tool off PATH keeps the full quoted path.
		assert_eq!(
			exec_line_in(&ps, &shims, &[]),
			Some(format!("& '{}'", npm.join("zetacode.ps1").display()))
		);

		let bash = Shell { path: PathBuf::from("bash"), flavor: ShellFlavor::Posix };
		let exe = vec![npm.join("zetaeditor.exe")];
		assert_eq!(
			exec_line_in(&bash, &exe, &[npm.clone()]),
			Some("zetaeditor".to_string()),
			"bash also types bare names for on-PATH .exe files"
		);

		// An extensionless sh shim under PowerShell never resolves by name.
		let sh_only = vec![npm.join("zetacode")];
		assert_eq!(
			exec_line_in(&ps, &sh_only, &[npm.clone()]),
			Some(format!("& '{}'", npm.join("zetacode").display()))
		);
	}

	#[cfg(windows)]
	#[test]
	fn plan_exec_prefers_exe_then_ps1_shim() {
		let temp = std::env::temp_dir().join(format!("zeta-shell-plan-{}", std::process::id()));
		std::fs::create_dir_all(&temp).unwrap();
		let ps1 = temp.join("tool.ps1");
		let cmd_shim = temp.join("tool.cmd");
		std::fs::write(&ps1, b"").unwrap();
		std::fs::write(&cmd_shim, b"").unwrap();
		let args = vec!["--resume".to_string()];

		let command = plan_exec(&[cmd_shim.clone(), ps1.clone()], &args).unwrap();
		let program = command.get_program().to_string_lossy().into_owned();
		assert!(
			program.to_ascii_lowercase().contains("powershell"),
			".ps1 candidates must run through PowerShell, got {program}"
		);
		assert!(command.get_args().any(|a| a == ps1.as_os_str()));

		let command = plan_exec(&[ps1], &args).unwrap();
		assert!(
			command
				.get_args()
				.any(|a| a.to_string_lossy().contains("--resume"))
		);
		std::fs::remove_dir_all(&temp).ok();
	}
}
