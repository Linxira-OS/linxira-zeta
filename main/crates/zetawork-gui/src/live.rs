// SPDX-License-Identifier: AGPL-3.0-only
//! Live terminal sessions: one PTY per terminal session tab.
//!
//! This is the pane's **fallback** backend: [`crate::terminal_service`] first
//! tries to attach to the PTY `zetacode serve` owns, and only when the gateway
//! is unreachable (or refuses the attach) does the shell spawn the shell
//! locally through this module. Both backends render into the same ratatui
//! `Buffer`, so the pane looks the same either way and its status line names
//! which one it is on.
//!
//! The GUI used to draw a seeded transcript — a faithful *replica* of a
//! workbench with nothing behind it. This module is the other half: a real
//! shell on a PTY (`termide_panel_terminal::Terminal`), rendered through the
//! same `Panel` implementation the TUI runs, so the grid in the GUI is the
//! grid a terminal would show.
//!
//! The signals the shell needs come from the terminal itself, never from a
//! guess:
//!
//! * **busy** — [`LiveSessions::pid`] feeds [`crate::lifecycle::pane_is_busy`],
//!   which asks whether the shell has live children (the same rule as
//!   `zeta-main`'s `busy.rs`);
//! * **output** — [`LiveSessions::poll`] reports `has_pending_output` so the
//!   frame only requests a repaint when the screen actually changed;
//! * **ended** — `is_alive` flips off when the child exits, which is the one
//!   honest "session ended" signal this side owns;
//! * **title** — the child's OSC 0/2 title, for pane naming.
//!
//! Input forwarding is not wired yet: the GUI has no focused-pane keyboard
//! path, and inventing one here would be a second input model. The PTY is
//! writable through [`LiveSessions::send_text`] the moment that path lands.

use std::collections::BTreeMap;
use std::path::PathBuf;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use termide_core::panel::{Panel, PanelConfig, RenderContext, ThemeColors};
use termide_core::{Config, Theme};
use termide_panel_terminal::Terminal;

/// One spawned pane: the PTY and the geometry it was last sized to.
struct Live {
	term: Terminal,
	cols: u16,
	rows: u16,
	title: Option<String>,
	ended: bool,
}

/// How the local fallback starts its shell.
///
/// `Auto` keeps termide's own detection (`$SHELL`, Git Bash, `cmd.exe`, …).
/// The other two are the GUI's own answer for the PowerShell families: both
/// hosts get an explicit black/gray init line, so a fresh pane's console
/// defaults are the workbench's ink rather than whatever the host inherited.
#[cfg(windows)]
#[derive(Clone, Debug, PartialEq, Eq)]
enum LocalShell {
	Auto,
	Path(PathBuf),
	PowerShell { program: PathBuf, args: Vec<String> },
}

/// True for both PowerShell families (the `$SHELL` can name either).
#[cfg(windows)]
fn is_powershell(stem: &str) -> bool {
	stem.eq_ignore_ascii_case("pwsh") || stem.eq_ignore_ascii_case("powershell")
}

/// The GUI's local-shell plan, in the same order termide's Windows chain
/// uses: a `$SHELL` that is an absolute path this host has, then `pwsh`, then
/// Windows PowerShell 5.1.
#[cfg(windows)]
fn local_shell_plan(
	shell_env: Option<&std::path::Path>,
	pwsh: Option<&std::path::Path>,
	powershell: Option<&std::path::Path>,
	cwd: Option<&std::path::Path>,
) -> LocalShell {
	let powershell_plan = |program: &std::path::Path| LocalShell::PowerShell {
		program: program.to_path_buf(),
		args: powershell_args(cwd),
	};
	if let Some(shell) = shell_env {
		let stem = shell
			.file_stem()
			.and_then(|stem| stem.to_str())
			.unwrap_or("");
		return if is_powershell(stem) {
			powershell_plan(shell)
		} else {
			LocalShell::Path(shell.to_path_buf())
		};
	}
	if let Some(pwsh) = pwsh {
		return powershell_plan(pwsh);
	}
	if let Some(powershell) = powershell {
		return powershell_plan(powershell);
	}
	LocalShell::Auto
}

/// The argv a PowerShell host needs: stay interactive, set the console ink
/// the workbench expects, clear the inherited blue buffer, and land in `cwd`.
///
/// Every argument is whitespace-free on purpose: [`Terminal::new_with_command`]
/// splits its string on whitespace, and PowerShell joins the tokens after
/// `-Command` back with single spaces. The working directory therefore travels
/// percent-encoded through `[uri]::UnescapeDataString`.
#[cfg(windows)]
fn powershell_args(cwd: Option<&std::path::Path>) -> Vec<String> {
	let mut args = vec!["-NoLogo".to_owned(), "-NoExit".to_owned(), "-Command".to_owned()];
	if let Some(cwd) = cwd {
		args.push("Set-Location".to_owned());
		args.push(format!("([uri]::UnescapeDataString('{}'));", percent_encode(cwd)));
	}
	args.push(
		"$Host.UI.RawUI.BackgroundColor='Black';$Host.UI.RawUI.ForegroundColor='Gray';Clear-Host"
			.to_owned(),
	);
	args
}

/// Percent-encode a path for `.NET`'s `UnescapeDataString`, leaving the
/// separators and drive colon so the decoded value is the original path.
#[cfg(windows)]
fn percent_encode(path: &std::path::Path) -> String {
	let mut out = String::new();
	for byte in path.to_string_lossy().bytes() {
		if byte.is_ascii_alphanumeric()
			|| matches!(byte, b'\\' | b'/' | b':' | b'.' | b'-' | b'_' | b'~')
		{
			out.push(char::from(byte));
		} else {
			out.push_str(&format!("%{byte:02X}"));
		}
	}
	out
}

/// The ink a terminal pane renders with.
///
/// The values are the workbench's own `.term` tokens (`TERM_BG`, `TERM_TEXT`,
/// the accent and semantic inks); only the fields termide reads for a terminal
/// grid are meaningful. Keeping this local to the pane means the app never
/// depends on a termide theme file.
fn pane_theme() -> Theme {
	Theme {
		name: "zetawork-terminal",
		bg: ratatui::style::Color::Rgb(0x08, 0x0a, 0x0d),
		fg: ratatui::style::Color::Rgb(0xc8, 0xd0, 0xdb),
		accented_bg: ratatui::style::Color::Rgb(0x0c, 0x0f, 0x13),
		accented_fg: ratatui::style::Color::Rgb(0x7e, 0xa9, 0xf5),
		selected_bg: ratatui::style::Color::Rgb(0x22, 0x31, 0x4d),
		selected_fg: ratatui::style::Color::Rgb(0xe7, 0xea, 0xf0),
		disabled: ratatui::style::Color::Rgb(0x8b, 0x93, 0xa1),
		success: ratatui::style::Color::Rgb(0x3f, 0xb9, 0x50),
		warning: ratatui::style::Color::Rgb(0xd2, 0x99, 0x22),
		error: ratatui::style::Color::Rgb(0xf8, 0x51, 0x49),
		is_light: Some(false),
	}
}

/// One `Config` for every pane: `prepare_render` only reads it to build the
/// terminal's hotkey table, and the table never changes.
static PANE_CONFIG: std::sync::LazyLock<std::sync::Arc<Config>> =
	std::sync::LazyLock::new(|| std::sync::Arc::new(Config::default()));

/// Start the local fallback: the planned PowerShell argv, or termide's own
/// detection for everything else. `None` means the spawn failed.
fn spawn_local(rows: u16, cols: u16, cwd: Option<PathBuf>) -> Option<Terminal> {
	#[cfg(windows)]
	{
		let installed = crate::shells::detect();
		let find = |kind: crate::shells::ShellKind| {
			installed
				.iter()
				.find(|shell| shell.kind == kind)
				.map(|shell| shell.path.as_path())
		};
		// termide trusts `$SHELL` only when it is an absolute Windows path
		// (`MSYS` exports `/usr/bin/bash`, which a native binary cannot run).
		let shell_env = std::env::var_os("SHELL")
			.map(PathBuf::from)
			.filter(|path| path.to_string_lossy().contains(':') && path.exists());
		let plan = local_shell_plan(
			shell_env.as_deref(),
			find(crate::shells::ShellKind::Pwsh),
			find(crate::shells::ShellKind::PowerShell),
			cwd.as_deref(),
		);
		match plan {
			LocalShell::Auto => Terminal::new_with_cwd(rows, cols, cwd),
			LocalShell::Path(path) => {
				let program = path.to_string_lossy();
				Terminal::new_with_shell(rows, cols, &program, cwd)
			},
			LocalShell::PowerShell { program, args } => {
				// `new_with_command` splits on whitespace, and a pwsh install
				// often lives under `C:\Program Files`; its bare name is what
				// the PTY's PATH search (and CreateProcess's System32 search)
				// resolves, so the argv carries that instead of the full path.
				let executable = program
					.file_name()
					.map(|name| name.to_string_lossy().into_owned())
					.unwrap_or_else(|| program.to_string_lossy().into_owned());
				let command = std::iter::once(executable)
					.chain(args)
					.collect::<Vec<_>>()
					.join(" ");
				Terminal::new_with_command(rows, cols, &command)
			},
		}
		.ok()
	}
	#[cfg(not(windows))]
	{
		Terminal::new_with_cwd(rows, cols, cwd).ok()
	}
}

/// Something a terminal did since the last poll.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
	/// The screen changed; a hidden window needs no repaint for this.
	Output { tab: String },
	/// The child exited and the pane is now a dead grid.
	Ended { tab: String },
	/// The child changed its OSC 0/2 title.
	Titled { tab: String, title: String },
}

/// Every live terminal, keyed by **session tab id** (a tab keeps its terminal
/// when the user switches away, which is what makes a background agent keep
/// running).
#[derive(Default)]
pub struct LiveSessions {
	tabs: BTreeMap<String, Live>,
	config: PanelConfig,
	theme: ThemeColors,
}

impl LiveSessions {
	pub fn contains(&self, tab: &str) -> bool {
		self.tabs.contains_key(tab)
	}

	/// The spawned shell's pid, when this tab has a live terminal.
	pub fn pid(&self, tab: &str) -> Option<u32> {
		self.tabs.get(tab)?.term.shell_pid()
	}

	/// Spawn the PTY for `tab` when it has none, and resize it when the grid
	/// changed. `false` means the spawn failed (no shell, no PTY) — the caller
	/// keeps its placeholder and says so.
	pub fn ensure(&mut self, tab: &str, cols: u16, rows: u16, cwd: Option<PathBuf>) -> bool {
		if let Some(live) = self.tabs.get_mut(tab) {
			if live.cols != cols || live.rows != rows {
				let _ = live.term.resize(rows, cols);
				live.cols = cols;
				live.rows = rows;
			}
			return true;
		}
		match spawn_local(rows, cols, cwd) {
			Some(term) => {
				self
					.tabs
					.insert(tab.to_owned(), Live { term, cols, rows, title: None, ended: false });
				true
			},
			None => false,
		}
	}

	/// Render the terminal into `buf` at `area` with the TUI's own panel code.
	pub fn render(&mut self, tab: &str, area: Rect, buf: &mut Buffer) -> bool {
		let Self { tabs, config, theme } = self;
		let Some(live) = tabs.get_mut(tab) else {
			return false;
		};
		// termide fills the grid from the theme it was last prepared with, and
		// its built-in default is the royal-blue Windows XP palette. Preparing
		// with the workbench's own ink on every frame is what makes a fresh
		// pane black, independent of the shell's ConPTY defaults.
		live.term.prepare_render(&pane_theme(), &PANE_CONFIG);
		let ctx = RenderContext {
			theme,
			config,
			is_focused: true,
			panel_index: 0,
			terminal_width: area.width,
			terminal_height: area.height,
			border_right_x: None,
			border_bottom_y: None,
		};
		live.term.render(area, buf, &ctx);
		true
	}

	/// Type into the pane (paste path; the keyboard path is not wired yet).
	pub fn send_text(&mut self, tab: &str, text: &str) {
		if let Some(live) = self.tabs.get_mut(tab) {
			let _ = live.term.paste_text(text);
		}
	}

	/// Forget a closed tab's terminal. Dropping the `Terminal` closes the PTY,
	/// which is what ends the child — the same lifetime the TUI has.
	pub fn close(&mut self, tab: &str) {
		self.tabs.remove(tab);
	}

	/// Poll every terminal once: output, death and title changes.
	pub fn poll(&mut self) -> Vec<Event> {
		let mut events = Vec::new();
		for (tab, live) in self.tabs.iter_mut() {
			if live.term.has_pending_output() {
				events.push(Event::Output { tab: tab.clone() });
			}
			// `is_alive` is the reader thread's EOF verdict, which ConPTY never
			// delivers on Windows; `try_wait` asks the child itself and is the
			// platform-independent answer.
			let exited = live.term.try_wait().is_some();
			if !live.ended && (exited || !live.term.is_alive()) {
				live.ended = true;
				events.push(Event::Ended { tab: tab.clone() });
			}
			let title = live.term.osc_title();
			if title != live.title {
				live.title = title.clone();
				if let Some(title) = title {
					events.push(Event::Titled { tab: tab.clone(), title });
				}
			}
		}
		events
	}
}

impl LiveSessions {
	/// Write raw bytes to a tab's PTY (see [`bytes_for_events`]). No-op when
	/// the tab has no terminal.
	pub fn send_bytes(&mut self, tab: &str, bytes: &[u8]) {
		if let Some(live) = self.tabs.get_mut(tab) {
			let _ = live.term.send_bytes(bytes);
		}
	}
}

/// The bytes a frame's egui events would type into a terminal.
///
/// Printable input arrives as `Event::Text`; keys the PTY cares about (Enter,
/// Backspace, arrows, Ctrl+letter, …) arrive as `Event::Key`. Plain letters are
/// **not** mapped from `Key`, so a keystroke is never sent twice.
pub fn bytes_for_events(events: &[egui::Event]) -> Vec<u8> {
	let mut out = Vec::new();
	for event in events {
		match event {
			egui::Event::Text(text) => out.extend_from_slice(text.as_bytes()),
			egui::Event::Key { key, pressed: true, modifiers, .. } => {
				if let Some(bytes) = key_bytes(*key, *modifiers) {
					out.extend_from_slice(&bytes);
				}
			},
			_ => {},
		}
	}
	out
}

fn key_bytes(key: egui::Key, modifiers: egui::Modifiers) -> Option<Vec<u8>> {
	let fixed: &[u8] = match key {
		egui::Key::Enter => b"\r",
		egui::Key::Backspace => b"\x7f",
		egui::Key::Tab => b"\t",
		egui::Key::Escape => b"\x1b",
		egui::Key::ArrowUp => b"\x1b[A",
		egui::Key::ArrowDown => b"\x1b[B",
		egui::Key::ArrowRight => b"\x1b[C",
		egui::Key::ArrowLeft => b"\x1b[D",
		egui::Key::Home => b"\x1b[H",
		egui::Key::End => b"\x1b[F",
		egui::Key::PageUp => b"\x1b[5~",
		egui::Key::PageDown => b"\x1b[6~",
		egui::Key::Delete => b"\x1b[3~",
		_ => {
			// Ctrl+letter is the only modifier chord the PTY protocol encodes
			// as a single byte (0x01..0x1a). Everything else is left to Text.
			if modifiers.ctrl && !modifiers.alt {
				let name = key.name().as_bytes();
				if name.len() == 1 && name[0].is_ascii_uppercase() {
					return Some(vec![name[0] & 0x1f]);
				}
			}
			return None;
		},
	};
	Some(fixed.to_vec())
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A shell one-liner that prints `$1` and exits.
	fn print_command(text: &str) -> String {
		if cfg!(windows) {
			format!("cmd /c echo {text}")
		} else {
			// `new_with_command` splits on whitespace and never runs a shell, so
			// the script token cannot carry quotes: call `printf` directly.
			format!("printf {text}")
		}
	}

	#[test]
	fn a_spawned_terminal_has_a_pid_renders_its_output_and_reports_exit() {
		let mut live = LiveSessions::default();
		// Spawn through the test seam: `new_with_cwd` would start an interactive
		// shell, which never exits.
		let term = Terminal::new_with_command(4, 40, &print_command("hi")).expect("spawn a command");
		live
			.tabs
			.insert("t".to_owned(), Live { term, cols: 40, rows: 4, title: None, ended: false });
		assert!(live.pid("t").is_some(), "a spawned PTY knows its shell pid");

		// Pump until the child wrote something (bounded: a slow CI box, not a hang).
		let mut saw_output = false;
		let mut ended = false;
		for _ in 0..400 {
			for event in live.poll() {
				match event {
					Event::Output { .. } => saw_output = true,
					Event::Ended { .. } => ended = true,
					Event::Titled { .. } => {},
				}
			}
			if saw_output && ended {
				break;
			}
			std::thread::sleep(std::time::Duration::from_millis(10));
		}
		assert!(saw_output, "the child's output reached the screen");
		assert!(ended, "the child's exit reached the poll");

		let area = Rect::new(0, 0, 40, 4);
		let mut buf = Buffer::empty(area);
		assert!(live.render("t", area, &mut buf), "a live terminal renders");
		let text: String = (0..4)
			.flat_map(|row| (0..40).map(move |col| (col, row)))
			.map(|(col, row)| buf[(col, row)].symbol().to_owned())
			.collect();
		assert!(text.contains("hi"), "the rendered grid carries the child's text: {text:?}");
	}

	#[test]
	fn keys_map_to_the_bytes_a_terminal_expects() {
		let key = |key: egui::Key, modifiers: egui::Modifiers| egui::Event::Key {
			key,
			physical_key: None,
			pressed: true,
			repeat: false,
			modifiers,
		};
		let text = egui::Event::Text("ls".to_owned());
		assert_eq!(bytes_for_events(&[text, key(egui::Key::Enter, egui::Modifiers::NONE)]), b"ls\r");
		assert_eq!(bytes_for_events(&[key(egui::Key::ArrowUp, egui::Modifiers::NONE)]), b"\x1b[A");
		let ctrl_c = egui::Modifiers { ctrl: true, command: true, ..Default::default() };
		assert_eq!(bytes_for_events(&[key(egui::Key::C, ctrl_c)]), vec![0x03]);
		// A plain letter key is not mapped: Text already carried it.
		assert!(bytes_for_events(&[key(egui::Key::A, egui::Modifiers::NONE)]).is_empty());
	}

	#[test]
	fn closing_a_tab_drops_its_terminal() {
		let mut live = LiveSessions::default();
		let term = Terminal::new_with_command(2, 20, &print_command("x")).expect("spawn");
		live
			.tabs
			.insert("t".to_owned(), Live { term, cols: 20, rows: 2, title: None, ended: false });
		assert!(live.contains("t"));
		live.close("t");
		assert!(!live.contains("t"));
		assert_eq!(live.pid("t"), None);
	}

	#[cfg(windows)]
	#[test]
	fn windows_powershell_51_starts_black_without_a_real_spawn() {
		let cwd = std::path::Path::new(r"C:\work space\zeta");
		let program =
			std::path::Path::new(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
		let plan = local_shell_plan(None, None, Some(program), Some(cwd));
		let LocalShell::PowerShell { program: chosen, args } = plan else {
			panic!("5.1 must take the init line");
		};
		assert_eq!(chosen.as_path(), program);
		assert_eq!(args[0], "-NoLogo");
		assert_eq!(args[1], "-NoExit");
		assert_eq!(args[2], "-Command");
		assert!(
			args.iter().all(|arg| !arg.chars().any(char::is_whitespace)),
			"each token must survive new_with_command's split: {args:?}"
		);
		let script = args.last().expect("the init script");
		assert!(script.contains("$Host.UI.RawUI.BackgroundColor='Black'"), "{script}");
		assert!(script.contains("$Host.UI.RawUI.ForegroundColor='Gray'"), "{script}");
		assert!(script.contains("Clear-Host"), "{script}");
		assert!(
			args.iter().any(|arg| arg.contains(r"C:\work%20space\zeta")),
			"the workspace path is carried, encoded: {args:?}"
		);
	}

	#[cfg(windows)]
	#[test]
	fn pwsh_is_preferred_and_both_hosts_take_the_init_line() {
		let pwsh = std::path::Path::new(r"C:\Program Files\PowerShell\7\pwsh.exe");
		let ps = std::path::Path::new(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
		let plan = local_shell_plan(None, Some(pwsh), Some(ps), None);
		let LocalShell::PowerShell { program, args } = plan else {
			panic!("pwsh is a PowerShell host too");
		};
		assert_eq!(program.as_path(), pwsh, "pwsh wins when installed");
		assert!(
			args
				.iter()
				.any(|arg| arg.contains("BackgroundColor='Black'")),
			"{args:?}"
		);
		assert!(matches!(
			local_shell_plan(None, None, Some(ps), None),
			LocalShell::PowerShell { .. }
		));
		assert_eq!(
			local_shell_plan(None, None, None, None),
			LocalShell::Auto,
			"no PowerShell family leaves termide's chain alone"
		);
		// A `$SHELL` that names a PowerShell host is still that host: termide
		// would have run it, so the init line is applied there too.
		assert!(matches!(
			local_shell_plan(Some(ps), Some(pwsh), Some(ps), None),
			LocalShell::PowerShell { .. }
		));
	}
}
