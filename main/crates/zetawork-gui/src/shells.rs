//! Which shells exist on this host, and where their executables live — the data
//! source behind the shell picker's `+` menu. The search is a pure filesystem
//! walk driven by a [`Probe`]: the `PATH` text, `%COMSPEC%`, `%SystemRoot%`,
//! `%ProgramFiles%`, `%LOCALAPPDATA%` and the one file test all come in from the
//! caller, so the whole thing runs against a temp directory in a test without
//! touching the real host. [`detect`] is the thin wrapper that fills a probe in
//! from this process's environment and [`std::path::Path::is_file`].
//!
//! Real here: the `PATH` scan, the `%COMSPEC%` and `%SystemRoot%\System32`
//! registrations, the known Git for Windows install roots, and the split that
//! makes a `bash` inside a `Git` directory Git Bash while one outside it is a
//! plain bash.
//!
//! Not here: nothing is spawned and no candidate is ever executed to ask it its
//! version, no registry key and no `where.exe`/`command -v` is consulted, and a
//! shell installed off `PATH` and outside the known Git roots is simply not
//! reported. Every answer is "this file is a file right now", so a shell that is
//! uninstalled between two probes is reported by the first and not the second.

use std::{
	ffi::OsStr,
	path::{Path, PathBuf},
};

/// The `PATH` names a bash is shipped under, the Windows spelling first.
const BASH_NAMES: [&str; 2] = ["bash.exe", "bash"];

/// The six shell families the picker knows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ShellKind {
	/// Windows PowerShell 5.1, the one that ships with Windows.
	PowerShell,
	/// PowerShell 7 and newer, installed side by side with 5.1.
	Pwsh,
	/// `cmd.exe`, the command prompt.
	Cmd,
	/// A `bash` from MSYS/Cygwin/… that is not part of a Git install.
	Bash,
	/// The `bash` Git for Windows brings.
	GitBash,
	/// The `wsl.exe` host that starts a WSL distribution.
	Wsl,
}

impl ShellKind {
	/// Every kind, in the order the picker lists them and [`detect_all`]
	/// returns them.
	pub const ALL: [Self; 6] =
		[Self::PowerShell, Self::Pwsh, Self::Cmd, Self::Bash, Self::GitBash, Self::Wsl];

	/// The picker's display name.
	pub fn label(self) -> &'static str {
		match self {
			Self::PowerShell => "PowerShell",
			Self::Pwsh => "pwsh",
			Self::Cmd => "cmd",
			Self::Bash => "bash",
			Self::GitBash => "Git Bash",
			Self::Wsl => "WSL",
		}
	}

	/// The bare executable this family runs as. The families that also exist on
	/// unix keep that spelling (`pwsh`, `bash`); the Windows-only ones keep the
	/// `.exe` they ship under.
	pub fn program(self) -> &'static str {
		match self {
			Self::PowerShell => "powershell.exe",
			Self::Pwsh => "pwsh",
			Self::Cmd => "cmd.exe",
			Self::Bash => "bash",
			Self::GitBash => "bash",
			Self::Wsl => "wsl.exe",
		}
	}

	/// One honest line about what this family is, for the picker's row.
	pub fn note(self) -> &'static str {
		match self {
			Self::PowerShell => "Windows PowerShell 5.1（系统自带）",
			Self::Pwsh => "PowerShell 7+",
			Self::Cmd => "命令提示符",
			Self::Bash => "MSYS/Cygwin/Git 附带的 bash",
			Self::GitBash => "Git for Windows 附带的 bash",
			Self::Wsl => "WSL 发行版宿主",
		}
	}

	/// The stable ascii key this family is remembered under.
	pub fn key(self) -> &'static str {
		match self {
			Self::PowerShell => "powershell",
			Self::Pwsh => "pwsh",
			Self::Cmd => "cmd",
			Self::Bash => "bash",
			Self::GitBash => "git-bash",
			Self::Wsl => "wsl",
		}
	}
}

/// One shell that is actually present on this host.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Shell {
	/// Which family this executable belongs to.
	pub kind: ShellKind,
	/// The executable's path, exactly as the search spelled it.
	pub path: PathBuf,
}

impl Shell {
	/// The family's display name, [`ShellKind::label`] of [`Self::kind`].
	pub fn label(&self) -> &'static str {
		self.kind.label()
	}
}

/// Everything the search reads from the outside world.
///
/// The probe exists so the search can be driven from a test: environment values
/// and the file test are injected rather than read, and nothing below ever
/// spawns a process.
pub struct Probe<'a> {
	/// `PATH` as the platform spells it, split with [`std::env::split_paths`].
	pub path_var: Option<&'a OsStr>,
	/// `%COMSPEC%`, the command processor Windows registered.
	pub comspec: Option<PathBuf>,
	/// `%SystemRoot%` (`%windir%`), the directory holding `System32`.
	pub windows_dir: Option<PathBuf>,
	/// `%ProgramFiles%`, the machine-wide install root Git for Windows uses.
	pub program_files: Option<PathBuf>,
	/// `%LOCALAPPDATA%`, where a per-user Git install lives.
	pub local_app_data: Option<PathBuf>,
	/// The only file test the search uses; [`std::path::Path::is_file`] in
	/// production.
	pub is_file: &'a dyn Fn(&Path) -> bool,
}

/// `path` when the probe's file test accepts it, `None` otherwise.
fn existing(path: Option<&Path>, probe: &Probe<'_>) -> Option<PathBuf> {
	let path = path?;
	if (probe.is_file)(path) {
		Some(path.to_path_buf())
	} else {
		None
	}
}

/// The first `dir\name` on `PATH` that `keep` allows and the file test accepts.
///
/// Entries are tried in `PATH` order and, inside one entry, in `names` order.
/// An empty entry (an empty `PATH`, or a stray separator in it) is skipped: a
/// name joined onto it is a *relative* path, which would make the answer depend
/// on the process's working directory.
fn first_in_path(
	probe: &Probe<'_>,
	names: &[&str],
	keep: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
	let path_var = probe.path_var?;
	for dir in std::env::split_paths(path_var) {
		if dir.as_os_str().is_empty() {
			continue;
		}
		for name in names {
			let candidate = dir.join(name);
			if keep(&candidate) && (probe.is_file)(&candidate) {
				return Some(candidate);
			}
		}
	}
	None
}

/// True when `path` passes through a `Git` directory, which is what tells Git
/// Bash from a bash that some other MSYS install put on `PATH`.
fn is_git_path(path: &Path) -> bool {
	path.components().any(|part| {
		part
			.as_os_str()
			.to_string_lossy()
			.eq_ignore_ascii_case("Git")
	})
}

/// Path equality as the picker means it: on Windows the same file is the same
/// path whatever its casing, elsewhere a path is its bytes.
fn same_path(a: &Path, b: &Path) -> bool {
	#[cfg(windows)]
	{
		a.to_string_lossy()
			.eq_ignore_ascii_case(&b.to_string_lossy())
	}
	#[cfg(not(windows))]
	{
		a == b
	}
}

/// Locate one shell kind, or `None` when it is not installed.
///
/// First hit wins, in this order:
///
/// - `PowerShell`: `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`,
///   then `powershell.exe`/`powershell` on `PATH`.
/// - `Pwsh`: `pwsh.exe`/`pwsh` on `PATH`.
/// - `Cmd`: `%COMSPEC%`, then `%SystemRoot%\System32\cmd.exe`, then `cmd.exe`.
/// - `Bash`: the first `bash.exe`/`bash` on `PATH` outside a Git install.
/// - `GitBash`: the first `bash.exe`/`bash` on `PATH` inside a Git install,
///   then `%ProgramFiles%\Git\bin`, `%ProgramFiles%\Git\usr\bin` and
///   `%LOCALAPPDATA%\Programs\Git\bin`.
/// - `Wsl`: `%SystemRoot%\System32\wsl.exe`, then `wsl.exe` on `PATH`.
///
/// On a host without `%SystemRoot%`/`%COMSPEC%` those steps are not taken and
/// the `PATH` hits carry the detection.
pub fn locate(kind: ShellKind, probe: &Probe<'_>) -> Option<Shell> {
	let path = match kind {
		ShellKind::PowerShell => {
			let system32 = probe.windows_dir.as_ref().map(|dir| {
				dir.join("System32")
					.join("WindowsPowerShell")
					.join("v1.0")
					.join("powershell.exe")
			});
			existing(system32.as_deref(), probe)
				.or_else(|| first_in_path(probe, &["powershell.exe", "powershell"], |_| true))
		},
		ShellKind::Pwsh => first_in_path(probe, &["pwsh.exe", "pwsh"], |_| true),
		ShellKind::Cmd => {
			let system32 = probe
				.windows_dir
				.as_ref()
				.map(|dir| dir.join("System32").join("cmd.exe"));
			existing(probe.comspec.as_deref(), probe)
				.or_else(|| existing(system32.as_deref(), probe))
				.or_else(|| first_in_path(probe, &["cmd.exe"], |_| true))
		},
		ShellKind::Bash => first_in_path(probe, &BASH_NAMES, |path| !is_git_path(path)),
		ShellKind::GitBash => {
			// `PATH` first: a Git for Windows that put itself on `PATH` names the
			// same file the install roots below would.
			first_in_path(probe, &BASH_NAMES, is_git_path).or_else(|| {
				let roots = [
					probe
						.program_files
						.as_ref()
						.map(|dir| dir.join("Git").join("bin").join("bash.exe")),
					probe
						.program_files
						.as_ref()
						.map(|dir| dir.join("Git").join("usr").join("bin").join("bash.exe")),
					probe.local_app_data.as_ref().map(|dir| {
						dir.join("Programs")
							.join("Git")
							.join("bin")
							.join("bash.exe")
					}),
				];
				roots
					.into_iter()
					.flatten()
					.find(|path| (probe.is_file)(path))
			})
		},
		ShellKind::Wsl => {
			let system32 = probe
				.windows_dir
				.as_ref()
				.map(|dir| dir.join("System32").join("wsl.exe"));
			existing(system32.as_deref(), probe)
				.or_else(|| first_in_path(probe, &["wsl.exe"], |_| true))
		},
	};
	path.map(|path| Shell { kind, path })
}

/// Locate every installed shell; order is [`ShellKind::ALL`], no duplicates (by
/// path, case-insensitively on Windows).
pub fn detect_all(probe: &Probe<'_>) -> Vec<Shell> {
	collect(&[probe])
}

/// The shared search: for each kind the first probe that finds it wins, and a
/// path already reported is not reported again.
///
/// The family split above already keeps one `bash` from being reported as both
/// `Bash` and `GitBash`, so the guard only catches a host that aliases two
/// families onto one file.
fn collect(probes: &[&Probe<'_>]) -> Vec<Shell> {
	let mut found: Vec<Shell> = Vec::new();
	for kind in ShellKind::ALL {
		let Some(shell) = probes.iter().find_map(|probe| locate(kind, probe)) else {
			continue;
		};
		if found
			.iter()
			.any(|other| same_path(&other.path, &shell.path))
		{
			continue;
		}
		found.push(shell);
	}
	found
}

/// This process's real environment as a [`Probe`].
///
/// `program_files_var` is the variable `program_files` is read from, so
/// [`detect`] can make a second pass with the 32-bit install root.
fn real_probe<'a>(
	path_var: Option<&'a OsStr>,
	program_files_var: &str,
	is_file: &'a dyn Fn(&Path) -> bool,
) -> Probe<'a> {
	Probe {
		path_var,
		comspec: std::env::var_os("COMSPEC").map(PathBuf::from),
		windows_dir: std::env::var_os("SystemRoot")
			.or_else(|| std::env::var_os("windir"))
			.map(PathBuf::from),
		program_files: std::env::var_os(program_files_var).map(PathBuf::from),
		local_app_data: std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
		is_file,
	}
}

/// [`detect_all`] over this process's real environment and
/// [`std::path::Path::is_file`].
pub fn detect() -> Vec<Shell> {
	let is_file = |path: &Path| path.is_file();
	let path_var = std::env::var_os("PATH");
	let path_var = path_var.as_deref();
	let primary = real_probe(path_var, "ProgramFiles", &is_file);
	// A 32-bit Git for Windows installs under `%ProgramFiles(x86)%`, a root the
	// probe has no field for: a second pass over the same environment covers it,
	// and the pass above still wins wherever both could answer.
	if std::env::var_os("ProgramFiles(x86)").is_none() {
		return detect_all(&primary);
	}
	let secondary = real_probe(path_var, "ProgramFiles(x86)", &is_file);
	collect(&[&primary, &secondary])
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::{ffi::OsString, fs};

	/// A fresh, empty directory under the system temp dir; the caller removes it.
	fn temp_dir(tag: &str) -> PathBuf {
		let dir =
			std::env::temp_dir().join(format!("zetawork-gui-shells-{tag}-{}", std::process::id()));
		let _ = fs::remove_dir_all(&dir);
		fs::create_dir_all(&dir).unwrap();
		dir
	}

	/// A real, empty file at `path`, parents included. The search only asks
	/// whether a path is a file, so an empty one is a faithful stand-in.
	fn touch(path: &Path) {
		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent).unwrap();
		}
		fs::write(path, b"").unwrap();
	}

	/// A probe with `PATH` and the file test set and every registered location
	/// clear; each test fills in the ones its case needs.
	fn bare_probe<'a>(path_var: Option<&'a OsStr>, is_file: &'a dyn Fn(&Path) -> bool) -> Probe<'a> {
		Probe {
			path_var,
			comspec: None,
			windows_dir: None,
			program_files: None,
			local_app_data: None,
			is_file,
		}
	}

	/// `PATH` text for `dirs`, spelled the way [`detect`] splits it.
	fn path_text(dirs: &[&Path]) -> OsString {
		std::env::join_paths(dirs.iter()).unwrap()
	}

	/// A fake host under one temp root: Windows-ish directories with a real
	/// empty file wherever an executable is claimed, and the paths the search
	/// should come back with.
	struct Host {
		root: PathBuf,
		/// `PATH`, holding the pwsh and the MSYS bash directories.
		path: OsString,
		/// `%SystemRoot%`.
		windows: PathBuf,
		powershell: PathBuf,
		wsl: PathBuf,
		pwsh: PathBuf,
		bash: PathBuf,
		cmd: PathBuf,
		git_bash: PathBuf,
	}

	impl Host {
		/// A host with all six families installed.
		fn full(tag: &str) -> Self {
			let root = temp_dir(tag);
			let windows = root.join("Windows");
			let system32 = windows.join("System32");
			let powershell = system32
				.join("WindowsPowerShell")
				.join("v1.0")
				.join("powershell.exe");
			let wsl = system32.join("wsl.exe");
			let pwsh = root.join("pwsh").join("pwsh.exe");
			let bash = root.join("msys").join("bin").join("bash.exe");
			let cmd = root.join("Command Prompt").join("cmd.exe");
			let git_bash = root.join("Git").join("bin").join("bash.exe");
			for path in [&powershell, &wsl, &pwsh, &bash, &cmd, &git_bash] {
				touch(path);
			}
			let path = path_text(&[pwsh.parent().unwrap(), bash.parent().unwrap()]);
			Self { root, path, windows, powershell, wsl, pwsh, bash, cmd, git_bash }
		}

		/// The probe for this host: `%SystemRoot%` is `<root>\Windows`,
		/// `%ProgramFiles%` is `<root>` (so Git is `<root>\Git`), `%COMSPEC%` is
		/// the cmd above, and `%LOCALAPPDATA%` is unset.
		fn probe<'a>(&'a self, is_file: &'a dyn Fn(&Path) -> bool) -> Probe<'a> {
			Probe {
				path_var: Some(self.path.as_os_str()),
				comspec: Some(self.cmd.clone()),
				windows_dir: Some(self.windows.clone()),
				program_files: Some(self.root.clone()),
				local_app_data: None,
				is_file,
			}
		}
	}

	#[test]
	fn every_kind_has_distinct_metadata() {
		let all = ShellKind::ALL;
		assert_eq!(all.len(), 6, "the picker knows six families");
		for (i, kind) in all.into_iter().enumerate() {
			assert!(!kind.label().is_empty(), "{kind:?} needs a label");
			assert!(!kind.program().is_empty(), "{kind:?} needs a program name");
			assert!(!kind.note().is_empty(), "{kind:?} needs a note");
			let key = kind.key();
			assert!(
				key.chars().all(|c| c.is_ascii_lowercase() || c == '-'),
				"{key:?} is not a stable ascii key"
			);
			for other in &all[i + 1..] {
				assert_ne!(key, other.key(), "two kinds share the key {key:?}");
				assert_ne!(kind.label(), other.label(), "two kinds share a label");
			}
		}
	}

	#[test]
	fn detect_all_finds_every_kind_in_picker_order() {
		let host = Host::full("all");
		let is_file = |path: &Path| path.is_file();
		let probe = host.probe(&is_file);

		let found = detect_all(&probe);
		let kinds: Vec<ShellKind> = found.iter().map(|shell| shell.kind).collect();
		assert_eq!(kinds, ShellKind::ALL.to_vec(), "the picker lists them in this order");
		assert_eq!(found[0].path, host.powershell, "%SystemRoot%\\System32\\…\\v1.0");
		assert_eq!(found[1].path, host.pwsh, "PATH");
		assert_eq!(found[2].path, host.cmd, "%COMSPEC% beats PATH");
		assert_eq!(found[3].path, host.bash, "the MSYS bash is not a Git bash");
		assert_eq!(found[4].path, host.git_bash, "%ProgramFiles%\\Git\\bin");
		assert_eq!(found[5].path, host.wsl, "%SystemRoot%\\System32");
		assert_eq!(found[3].label(), "bash");

		for (i, shell) in found.iter().enumerate() {
			assert!(shell.path.is_file(), "{:?} is not on disk", shell.path);
			for other in &found[i + 1..] {
				assert!(
					!same_path(&shell.path, &other.path),
					"{} is listed twice",
					shell.path.display()
				);
			}
		}
		let _ = fs::remove_dir_all(&host.root);
	}

	#[test]
	fn a_bash_in_a_git_directory_is_git_bash_and_one_outside_is_bash() {
		let root = temp_dir("bash-split");
		let git_bash = root.join("Git").join("bin").join("bash.exe");
		let plain_bash = root.join("plain").join("bash");
		touch(&git_bash);
		touch(&plain_bash);
		let path = path_text(&[git_bash.parent().unwrap(), plain_bash.parent().unwrap()]);
		let is_file = |path: &Path| path.is_file();
		let probe = bare_probe(Some(path.as_os_str()), &is_file);

		let bash = locate(ShellKind::Bash, &probe).expect("the plain bash is installed");
		assert_eq!(bash.path, plain_bash, "a bash under \\Git\\ is not the plain one");
		assert_eq!(bash.kind, ShellKind::Bash);

		let git = locate(ShellKind::GitBash, &probe).expect("the Git bash is installed");
		assert_eq!(git.path, git_bash, "a bash under \\Git\\ is Git Bash");
		assert_eq!(git.label(), "Git Bash");

		let kinds: Vec<ShellKind> = detect_all(&probe).iter().map(|shell| shell.kind).collect();
		assert_eq!(kinds, [ShellKind::Bash, ShellKind::GitBash], "one path, one family");
		let _ = fs::remove_dir_all(&root);
	}

	#[test]
	fn git_bash_is_found_in_the_known_git_install_roots() {
		let root = temp_dir("git-roots");
		let usr_bin = root
			.join("PF")
			.join("Git")
			.join("usr")
			.join("bin")
			.join("bash.exe");
		let user_bin = root
			.join("LAD")
			.join("Programs")
			.join("Git")
			.join("bin")
			.join("bash.exe");
		touch(&usr_bin);
		touch(&user_bin);
		let is_file = |path: &Path| path.is_file();
		let mut probe = bare_probe(None, &is_file);

		probe.program_files = Some(root.join("PF"));
		assert_eq!(locate(ShellKind::GitBash, &probe).map(|shell| shell.path), Some(usr_bin));

		probe.program_files = Some(root.join("PF").join("absent"));
		probe.local_app_data = Some(root.join("LAD"));
		assert_eq!(
			locate(ShellKind::GitBash, &probe).map(|shell| shell.path),
			Some(user_bin.clone()),
			"%LOCALAPPDATA%\\Programs\\Git over an install root that is not there"
		);

		probe.program_files = None;
		assert_eq!(locate(ShellKind::GitBash, &probe).map(|shell| shell.path), Some(user_bin));
		let _ = fs::remove_dir_all(&root);
	}

	#[test]
	fn a_missing_shell_is_none_and_an_empty_path_finds_nothing() {
		let root = temp_dir("missing");
		let empty = root.join("empty");
		fs::create_dir_all(&empty).unwrap();
		let path = path_text(&[&empty]);
		let is_file = |path: &Path| path.is_file();
		let mut probe = bare_probe(Some(path.as_os_str()), &is_file);
		// `%COMSPEC%` pointing at a file that is not there must not be reported:
		// the file test is the only thing the search believes.
		probe.comspec = Some(root.join("nope").join("cmd.exe"));

		for kind in ShellKind::ALL {
			assert!(locate(kind, &probe).is_none(), "{kind:?} is not installed here");
		}
		assert!(detect_all(&probe).is_empty());

		let no_path = bare_probe(None, &is_file);
		assert!(detect_all(&no_path).is_empty(), "no PATH is no shells");

		let empty_path = bare_probe(Some(OsStr::new("")), &is_file);
		assert!(detect_all(&empty_path).is_empty(), "an empty PATH is no shells");
		let _ = fs::remove_dir_all(&root);
	}

	#[test]
	fn a_path_entry_that_does_not_exist_is_skipped() {
		let root = temp_dir("skip");
		let real = root.join("real");
		let pwsh = real.join("pwsh.exe");
		touch(&pwsh);
		// A *directory* called `pwsh.exe` is not an executable.
		let decoy = root.join("decoy");
		fs::create_dir_all(decoy.join("pwsh.exe")).unwrap();
		let ghost = root.join("ghost");
		let path = path_text(&[&ghost, &decoy, &real]);
		let is_file = |path: &Path| path.is_file();
		let probe = bare_probe(Some(path.as_os_str()), &is_file);

		assert_eq!(locate(ShellKind::Pwsh, &probe).map(|shell| shell.path), Some(pwsh));
		let _ = fs::remove_dir_all(&root);
	}

	#[test]
	fn detect_reports_only_paths_that_exist_and_never_repeats_one() {
		let found = detect();
		for shell in &found {
			assert!(
				shell.path.is_file(),
				"{:?} reports a missing {}",
				shell.kind,
				shell.path.display()
			);
		}
		for (i, shell) in found.iter().enumerate() {
			for other in &found[i + 1..] {
				assert!(
					!same_path(&shell.path, &other.path),
					"{} is listed twice",
					shell.path.display()
				);
			}
		}
	}
}
