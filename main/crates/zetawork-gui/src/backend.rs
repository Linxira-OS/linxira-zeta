// SPDX-License-Identifier: AGPL-3.0-only
//! The desktop app owns its backend instead of hoping one is running.
//!
//! `zetacode serve` is the process that hosts sessions, terminals and the web
//! UI; the GUI is a client. On launch this module **ensures** that backend:
//!
//! 1. `zetacode daemon status --json` (the command surface described in
//!    `docs/daemon.md`) is asked whether a backend is already live;
//! 2. if one is, the shell connects to it — it never starts a second one;
//! 3. if none is, `zetacode daemon start` starts the daemon path the CLI
//!    already owns, and the address it publishes becomes the one every pane
//!    and every session read uses.
//!
//! The whole round trip runs on a worker thread. [`BackendHost::poll`] only
//! drains a channel with `try_recv`, so a slow `daemon start` (or an absent
//! binary) never blocks a frame: the state machine is updated from signals and
//! the banner/settings row paints whatever state it is in.
//!
//! # The state machine
//!
//! [`EnsureBackend`] is the testable part: pure transitions from
//! [`Signal`] to a [`Phase`]. Connect (a live backend was found), start (none
//! was, so the GUI started one), fail, retry and crash are all one
//! `apply` call each, with no process, no socket and no clock.
//!
//! # Ownership and quit
//!
//! Starting a backend makes this window its owner for the purpose of
//! [`EnsureBackend::quit_action`]: unless `backend.keep_on_quit` is set, a
//! backend this window started is stopped when the app quits. A backend that
//! was already live belongs to whoever started it (the daemon, another
//! install, a foreground `serve`) and is never stopped by this window.
//!
//! # Crash
//!
//! After the first `ready`, the worker keeps checking `daemon status` every
//! [`MONITOR_INTERVAL`]. A backend that disappears is reported as
//! [`Signal::Crashed`]; the state becomes [`Phase::Failed`] and the banner
//! says so, instead of a pane freezing on a socket that will never answer.

use crate::t;
use std::{
	io::Read,
	path::{Path, PathBuf},
	process::{Command, Stdio},
	sync::{
		Arc,
		atomic::{AtomicBool, Ordering},
		mpsc::{Receiver, Sender, TryRecvError, channel},
	},
	thread,
	time::{Duration, Instant},
};

/// How long the backend may take to publish its `serve.json` after
/// `daemon start` before the GUI reports a failure.
pub const READY_TIMEOUT: Duration = Duration::from_secs(20);

/// How often a ready backend is re-checked, and how long each check may take.
pub const MONITOR_INTERVAL: Duration = Duration::from_secs(5);

/// Per-command budget (`daemon status` must never wedge a worker forever).
const COMMAND_TIMEOUT: Duration = Duration::from_secs(8);

/// The backend's state, as the banner and the settings row name it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Phase {
	/// Nothing has been asked yet (a headless shell, or the first frame).
	#[default]
	Idle,
	/// Checking for a live backend, or starting/restarting one.
	Starting,
	/// A backend answered and its address is known.
	Ready,
	/// A stop was requested and is in flight.
	Stopping,
	/// No backend is running: `ready` was never reached, a start failed, or a
	/// live backend disappeared.
	Failed,
	/// The user stopped the backend from 设置.
	Stopped,
}

impl Phase {
	/// True while a worker is expected to produce the next signal.
	pub fn busy(self) -> bool {
		matches!(self, Self::Starting | Self::Stopping)
	}
}

/// What a live `zetacode daemon status --json` reported.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BackendInfo {
	/// The serving process, when the daemon record carried one.
	pub pid: Option<u32>,
	/// `webUrl` — what terminal panes attach to.
	pub web_url: Option<String>,
	/// `gatewayUrl` — what the session list and agent pages read.
	pub gateway_url: Option<String>,
	/// Where the record came from (`daemon`, `instance-lock`, …), for the
	/// settings row. Never parsed further.
	pub source: Option<String>,
}

/// One fact the worker learned, delivered to the UI thread.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Signal {
	/// Nothing is live; a `daemon start` is now running.
	Starting,
	/// A backend is live at `info`.
	Live(BackendInfo),
	/// The start/probe/stop failed with this sentence.
	Failed(String),
	/// A backend that had been ready is gone.
	Crashed(String),
	/// `daemon stop` finished.
	Stopped,
}

/// What the ensure machine decided happened.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Applied {
	/// The UI-visible state changed.
	pub changed: bool,
	/// The backend address changed, so attached tabs must re-attach.
	pub reconnect: bool,
}

/// The pure ensure state machine.
#[derive(Clone, Debug, Default)]
pub struct EnsureBackend {
	phase: Phase,
	info: Option<BackendInfo>,
	error: Option<String>,
	/// This window ran `daemon start` (or `restart`), so a quit that does not
	/// keep the backend should stop it.
	started_by_us: bool,
	/// A successful `ready` happened before; a later one is a reconnect.
	ever_ready: bool,
}

impl EnsureBackend {
	pub fn phase(&self) -> Phase {
		self.phase
	}

	pub fn info(&self) -> Option<&BackendInfo> {
		self.info.as_ref()
	}

	pub fn error(&self) -> Option<&str> {
		self.error.as_deref()
	}

	pub fn started_by_us(&self) -> bool {
		self.started_by_us
	}

	/// Begin the first probe (or a retry after a failure): checking a live
	/// backend is not yet a decision to start one, so ownership is cleared.
	pub fn begin(&mut self) -> Applied {
		let changed = self.phase != Phase::Starting || self.error.is_some();
		self.phase = Phase::Starting;
		self.error = None;
		self.started_by_us = false;
		Applied { changed, reconnect: false }
	}

	/// Begin a restart: the daemon is ours once we restart it.
	pub fn begin_restart(&mut self) -> Applied {
		let changed = self.phase != Phase::Starting;
		self.phase = Phase::Starting;
		self.error = None;
		self.started_by_us = true;
		Applied { changed, reconnect: false }
	}

	/// Begin a stop. The phase waits for the worker's answer.
	pub fn begin_stop(&mut self) -> Applied {
		let changed = self.phase != Phase::Stopping;
		self.phase = Phase::Stopping;
		self.error = None;
		Applied { changed, reconnect: false }
	}

	/// Apply one observation.
	pub fn apply(&mut self, signal: Signal) -> Applied {
		let before_phase = self.phase;
		let before_info = self.info.clone();
		let mut reconnect = false;
		match signal {
			Signal::Starting => {
				self.phase = Phase::Starting;
				self.error = None;
				self.started_by_us = true;
			},
			Signal::Live(info) => {
				self.phase = Phase::Ready;
				self.error = None;
				reconnect = self.ever_ready && before_info.as_ref() != Some(&info);
				self.ever_ready = true;
				self.info = Some(info);
			},
			Signal::Failed(reason) => {
				self.phase = Phase::Failed;
				self.error = Some(reason);
			},
			Signal::Crashed(reason) => {
				self.phase = Phase::Failed;
				self.error = Some(reason);
			},
			Signal::Stopped => {
				self.phase = Phase::Stopped;
				self.error = None;
				self.info = None;
			},
		}
		let changed = before_phase != self.phase || before_info != self.info;
		Applied { changed, reconnect }
	}

	/// What quitting should do with the backend.
	///
	/// `keep_on_quit` is `backend.keep_on_quit` from the settings file. A
	/// backend that answered before this window started anything is never
	/// stopped by it, whatever the setting says.
	pub fn quit_action(&self, keep_on_quit: bool) -> QuitAction {
		if keep_on_quit {
			QuitAction::LeaveRunning
		} else if self.started_by_us {
			QuitAction::Stop
		} else {
			QuitAction::LeaveForeign
		}
	}
}

/// What [`EnsureBackend::quit_action`] resolved to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuitAction {
	/// The setting asks for the daemon to outlive the window.
	LeaveRunning,
	/// This window started it: stop it.
	Stop,
	/// Someone else started it: never stop it.
	LeaveForeign,
}

/// The UI-side owner: the machine, the worker channel, and the monitor's
/// cancellation flag.
#[derive(Default)]
pub struct BackendHost {
	machine: EnsureBackend,
	signals: Option<Receiver<Signal>>,
	cancel: Option<Arc<AtomicBool>>,
	/// Increments on every fresh `ready`; the shell re-attaches tabs when it
	/// changes.
	epoch: u64,
}

impl BackendHost {
	/// Start the launch probe. Called once from `Shell::new`; a headless shell
	/// never calls it, so a test cannot start a real daemon.
	pub fn ensure(&mut self) {
		if self.machine.phase().busy() || self.signals.is_some() {
			return;
		}
		self.machine.begin();
		self.spawn_worker(Worker::Ensure);
	}

	/// 重试 / 启动: probe again and start when nothing is live.
	pub fn retry(&mut self) {
		self.cancel_worker();
		self.machine.begin();
		self.spawn_worker(Worker::Ensure);
	}

	/// 重启 from the settings row.
	pub fn restart(&mut self) {
		self.cancel_worker();
		self.machine.begin_restart();
		self.spawn_worker(Worker::Restart);
	}

	/// 停止 from the settings row.
	pub fn stop(&mut self) {
		self.cancel_worker();
		self.machine.begin_stop();
		self.spawn_worker(Worker::Stop);
	}

	/// Apply one observation directly (the worker's channel is the normal
	/// source; tests and the screenshot harness use this one).
	pub fn observe(&mut self, signal: Signal) {
		let applied = self.machine.apply(signal);
		if applied.changed {
			self.epoch = self.epoch.wrapping_add(1);
		}
	}

	/// Drain the worker without ever blocking. Reconnecting is the caller's
	/// decision (it owns the panes): see [`Self::take_epoch`].
	pub fn poll(&mut self) -> bool {
		let mut changed = false;
		let mut disconnect = false;
		if let Some(receiver) = self.signals.as_ref() {
			loop {
				match receiver.try_recv() {
					Ok(signal) => {
						let applied = self.machine.apply(signal);
						if applied.changed {
							changed = true;
							self.epoch = self.epoch.wrapping_add(1);
						}
					},
					Err(TryRecvError::Empty) => break,
					Err(TryRecvError::Disconnected) => {
						disconnect = true;
						break;
					},
				}
			}
		}
		if disconnect {
			self.signals = None;
			self.cancel = None;
		}
		changed
	}

	pub fn phase(&self) -> Phase {
		self.machine.phase()
	}

	pub fn info(&self) -> Option<&BackendInfo> {
		self.machine.info()
	}

	pub fn error(&self) -> Option<&str> {
		self.machine.error()
	}

	/// The terminal attach origin: the backend's web UI (`webUrl`), which is
	/// where `/api/terminal/*` lives.
	pub fn web_origin(&self) -> Option<&str> {
		self
			.machine
			.info()
			.as_ref()
			.and_then(|info| info.web_url.as_deref())
			.filter(|url| !url.trim().is_empty())
	}

	/// The session-list origin: the gateway (`gatewayUrl`).
	pub fn gateway_origin(&self) -> Option<&str> {
		self
			.machine
			.info()
			.as_ref()
			.and_then(|info| info.gateway_url.as_deref())
			.filter(|url| !url.trim().is_empty())
	}

	/// The one-line state the settings row shows.
	pub fn status_line(&self) -> String {
		match self.machine.phase() {
			Phase::Idle => t!("后台服务：未检查").to_owned(),
			Phase::Starting => t!("后台服务：启动中…").to_owned(),
			Phase::Ready => {
				let mut line = t!("后台服务：运行中").to_owned();
				if let Some(pid) = self.info().and_then(|info| info.pid) {
					line.push_str(&format!(" · pid {pid}"));
				}
				if let Some(url) = self.web_origin() {
					line.push_str(&format!(" · {url}"));
				}
				line
			},
			Phase::Stopping => t!("后台服务：停止中…").to_owned(),
			Phase::Stopped => t!("后台服务：已停止").to_owned(),
			Phase::Failed => match self.error() {
				Some(reason) => t!("后台服务：失败 · {}", reason),
				None => t!("后台服务：失败").to_owned(),
			},
		}
	}

	/// The banner is drawn while the backend is not simply ready. A failure
	/// keeps it until a retry succeeds, so a crash is never a one-frame flash.
	pub fn banner(&self) -> Option<String> {
		match self.machine.phase() {
			Phase::Idle | Phase::Ready => None,
			Phase::Starting => {
				Some(t!("正在启动后台服务（zetacode daemon），会话与终端会在就绪后接通…").to_owned())
			},
			Phase::Stopping => Some(t!("正在停止后台服务…").to_owned()),
			Phase::Stopped => Some(t!("后台服务已停止。启动它才能新建会话或附着终端。").to_owned()),
			Phase::Failed => Some(match self.error() {
				Some(reason) => t!("后台服务未运行：{}", reason),
				None => t!("后台服务未运行。").to_owned(),
			}),
		}
	}

	/// The epoch is bumped on every change; a shell that keeps the last value
	/// sees a reconnect by comparing them.
	pub fn epoch(&self) -> u64 {
		self.epoch
	}

	/// Whether the pane status line should say "attached to the workspace
	/// session" rather than the generic terminal wording. True when a backend
	/// is known.
	pub fn attachable(&self) -> bool {
		self.machine.phase() == Phase::Ready && self.web_origin().is_some()
	}

	/// Stop the process-level worker and, when the policy says so, ask the
	/// daemon to stop **detached**: the app is exiting, so no frame may wait on
	/// it, and the child outlives this process long enough to finish the stop.
	pub fn shutdown(&mut self, keep_on_quit: bool) {
		self.cancel_worker();
		if self.machine.quit_action(keep_on_quit) != QuitAction::Stop {
			return;
		}
		if let Some(bin) = binary() {
			let _ = command(&bin, &["daemon", "stop"]).spawn();
		}
	}

	fn cancel_worker(&mut self) {
		if let Some(cancel) = self.cancel.take() {
			cancel.store(true, Ordering::Relaxed);
		}
		self.signals = None;
	}

	fn spawn_worker(&mut self, worker: Worker) {
		let (sender, receiver) = channel();
		let cancel = Arc::new(AtomicBool::new(false));
		let flag = Arc::clone(&cancel);
		self.signals = Some(receiver);
		self.cancel = Some(cancel);
		thread::spawn(move || match worker {
			Worker::Ensure => run_ensure(sender, flag),
			Worker::Restart => run_restart(sender, flag),
			Worker::Stop => run_stop(sender, flag),
		});
	}
}

impl Drop for BackendHost {
	fn drop(&mut self) {
		self.cancel_worker();
	}
}

#[derive(Clone, Copy)]
enum Worker {
	Ensure,
	Restart,
	Stop,
}

/// The shipped `zetacode`, or `None` with the resolution sentence lost: the
/// caller sends its own failure when the file cannot be found.
fn binary() -> Option<PathBuf> {
	match crate::zetacode::launch(crate::zetacode::Companion::Zetacode) {
		crate::zetacode::Launch::Binary(path) => Some(path),
		crate::zetacode::Launch::Missing(_) => None,
	}
}

/// The failure sentence for a missing binary, with the searched paths.
fn missing_binary() -> String {
	match crate::zetacode::launch(crate::zetacode::Companion::Zetacode) {
		crate::zetacode::Launch::Missing(sentence) => sentence,
		crate::zetacode::Launch::Binary(path) => {
			t!("随包的 zetacode 无法启动：{}", path.display())
		},
	}
}

/// Build a `zetacode` invocation that never opens a console on Windows and
/// never inherits the GUI's stdin.
fn command(bin: &Path, args: &[&str]) -> Command {
	let mut command = Command::new(bin);
	command
		.args(args)
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped());
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt as _;
		command.creation_flags(crate::zetacode::CREATE_NO_WINDOW);
	}
	command
}

/// Run one daemon command to completion. `Err` is the command's own stderr
/// (or the OS message), never a sentence invented here.
fn run_daemon(bin: &Path, args: &[&str]) -> Result<String, String> {
	let mut child = command(bin, args)
		.spawn()
		.map_err(|error| t!("无法运行 zetacode daemon：{}", error))?;
	let deadline = Instant::now() + COMMAND_TIMEOUT;
	let mut stdout = String::new();
	let mut stderr = String::new();
	loop {
		match child.try_wait() {
			Ok(Some(status)) => {
				if let Some(mut pipe) = child.stdout.take() {
					let _ = pipe.read_to_string(&mut stdout);
				}
				if let Some(mut pipe) = child.stderr.take() {
					let _ = pipe.read_to_string(&mut stderr);
				}
				if status.success() {
					return Ok(stdout);
				}
				let reason = stderr.trim();
				return Err(if reason.is_empty() {
					t!("zetacode daemon {} 退出码 {}", args.join(" "), status.code().unwrap_or(-1))
				} else {
					reason.to_owned()
				});
			},
			Ok(None) => {
				if Instant::now() >= deadline {
					let _ = child.kill();
					return Err(t!("zetacode daemon {} 超时", args.join(" ")));
				}
				thread::sleep(Duration::from_millis(40));
			},
			Err(error) => return Err(t!("等待 zetacode daemon 失败：{}", error)),
		}
	}
}

/// `daemon status --json` → `Some(info)` when a backend is live, `None` when
/// the record says nothing is running.
fn status(bin: &Path) -> Result<Option<BackendInfo>, String> {
	let body = run_daemon(bin, &["daemon", "status", "--json"])?;
	let value: serde_json::Value = serde_json::from_str(&body)
		.map_err(|error| t!("daemon status 的 JSON 无法解析：{}", error))?;
	let running = value
		.get("running")
		.and_then(serde_json::Value::as_bool)
		.unwrap_or(false);
	if !running {
		return Ok(None);
	}
	Ok(Some(BackendInfo {
		pid: value
			.get("pid")
			.and_then(serde_json::Value::as_u64)
			.and_then(|pid| u32::try_from(pid).ok()),
		web_url: string_field(&value, "webUrl"),
		gateway_url: string_field(&value, "gatewayUrl"),
		source: string_field(&value, "source"),
	}))
}

fn string_field(value: &serde_json::Value, key: &str) -> Option<String> {
	value
		.get(key)
		.and_then(serde_json::Value::as_str)
		.map(str::trim)
		.filter(|text| !text.is_empty())
		.map(str::to_owned)
}

/// The launch/retry worker: connect if live, otherwise start and wait.
fn run_ensure(sender: Sender<Signal>, cancel: Arc<AtomicBool>) {
	let Some(bin) = binary() else {
		let _ = sender.send(Signal::Failed(missing_binary()));
		return;
	};
	match status(&bin) {
		Ok(Some(info)) => {
			if sender.send(Signal::Live(info)).is_err() {
				return;
			}
		},
		Ok(None) => {
			if sender.send(Signal::Starting).is_err() {
				return;
			}
			if let Err(reason) = run_daemon(&bin, &["daemon", "start"]) {
				let _ = sender.send(Signal::Failed(reason));
				return;
			}
		},
		Err(reason) => {
			let _ = sender.send(Signal::Failed(reason));
			return;
		},
	}
	if !await_ready(&bin, &sender, &cancel) {
		return;
	}
	monitor(bin, sender, cancel);
}

/// The settings restart worker.
fn run_restart(sender: Sender<Signal>, cancel: Arc<AtomicBool>) {
	let Some(bin) = binary() else {
		let _ = sender.send(Signal::Failed(missing_binary()));
		return;
	};
	if let Err(reason) = run_daemon(&bin, &["daemon", "restart"]) {
		let _ = sender.send(Signal::Failed(reason));
		return;
	}
	if !await_ready(&bin, &sender, &cancel) {
		return;
	}
	monitor(bin, sender, cancel);
}

/// The settings stop worker.
fn run_stop(sender: Sender<Signal>, cancel: Arc<AtomicBool>) {
	let Some(bin) = binary() else {
		let _ = sender.send(Signal::Failed(missing_binary()));
		return;
	};
	match run_daemon(&bin, &["daemon", "stop"]) {
		Ok(_) => {
			let _ = sender.send(Signal::Stopped);
		},
		Err(reason) => {
			let _ = sender.send(Signal::Failed(reason));
		},
	}
	let _ = cancel;
}

/// Poll `daemon status` until it is live, the deadline passes, or the worker
/// was cancelled. Sends `Live`/`Failed` itself; `true` means a backend is live.
fn await_ready(bin: &Path, sender: &Sender<Signal>, cancel: &AtomicBool) -> bool {
	let deadline = Instant::now() + READY_TIMEOUT;
	loop {
		if cancel.load(Ordering::Relaxed) {
			return false;
		}
		match status(bin) {
			Ok(Some(info)) => {
				let _ = sender.send(Signal::Live(info));
				return true;
			},
			Ok(None) => {},
			Err(reason) => {
				let _ = sender.send(Signal::Failed(reason));
				return false;
			},
		}
		if Instant::now() >= deadline {
			let _ =
				sender.send(Signal::Failed(t!("后台服务在 {} 秒内没有就绪", READY_TIMEOUT.as_secs())));
			return false;
		}
		thread::sleep(Duration::from_millis(250));
	}
}

/// Keep watching a live backend: a `daemon status` that stops reporting one is
/// a crash, and it must surface as a banner rather than a frozen pane.
fn monitor(bin: PathBuf, sender: Sender<Signal>, cancel: Arc<AtomicBool>) {
	loop {
		let mut waited = Duration::ZERO;
		while waited < MONITOR_INTERVAL {
			if cancel.load(Ordering::Relaxed) {
				return;
			}
			thread::sleep(Duration::from_millis(250));
			waited += Duration::from_millis(250);
		}
		match status(&bin) {
			Ok(Some(info)) => {
				// The address may have changed (a restart from elsewhere);
				// forwarding it lets the shell notice the new epoch.
				if sender.send(Signal::Live(info)).is_err() {
					return;
				}
			},
			Ok(None) => {
				let _ = sender.send(Signal::Crashed(t!("后台进程已退出").to_owned()));
				return;
			},
			Err(reason) => {
				let _ = sender.send(Signal::Crashed(reason));
				return;
			},
		}
	}
}

/// The banner: one line at the top of the window while the backend is not
/// ready, with the retry that resolves a failure.
pub fn banner(ctx: &egui::Context, shell: &mut crate::Shell) {
	let Some(text) = shell.backend.banner() else {
		return;
	};
	let phase = shell.backend.phase();
	let ink = if phase == Phase::Failed {
		crate::theme::DEL
	} else {
		crate::theme::WARN
	};
	egui::TopBottomPanel::top("zetawork-backend-banner")
		.exact_height(30.0)
		.show_separator_line(false)
		.frame(egui::Frame::new().fill(crate::theme::PANEL_2))
		.show(ctx, |ui| {
			ui.painter().line_segment(
				[
					egui::pos2(ui.max_rect().min.x, ui.max_rect().max.y - 0.5),
					egui::pos2(ui.max_rect().max.x, ui.max_rect().max.y - 0.5),
				],
				egui::Stroke::new(1.0_f32, crate::theme::BORDER),
			);
			ui.horizontal_centered(|ui| {
				if phase.busy() {
					ui.add(egui::Spinner::new().size(12.0));
				}
				ui.label(egui::RichText::new(text).size(12.0).color(ink));
				if matches!(phase, Phase::Failed | Phase::Stopped) && ui.button(t!("重试")).clicked()
				{
					shell.backend.retry();
				}
			});
		});
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::mpsc::channel;

	fn info(url: &str) -> BackendInfo {
		BackendInfo {
			pid: Some(4812),
			web_url: Some(url.to_owned()),
			gateway_url: Some("http://127.0.0.1:30142".to_owned()),
			source: Some("daemon".to_owned()),
		}
	}

	#[test]
	fn a_live_backend_is_connected_not_started() {
		let mut machine = EnsureBackend::default();
		assert_eq!(machine.begin(), Applied { changed: true, reconnect: false });
		assert_eq!(machine.phase(), Phase::Starting);
		let applied = machine.apply(Signal::Live(info("http://127.0.0.1:30141")));
		assert!(applied.changed);
		assert_eq!(machine.phase(), Phase::Ready);
		assert!(!machine.started_by_us(), "connecting to a live backend is not starting one");
		assert_eq!(machine.quit_action(false), QuitAction::LeaveForeign);
	}

	#[test]
	fn nothing_live_starts_the_daemon_and_owns_it() {
		let mut machine = EnsureBackend::default();
		machine.begin();
		machine.apply(Signal::Starting);
		assert_eq!(machine.phase(), Phase::Starting);
		assert!(machine.started_by_us());
		machine.apply(Signal::Live(info("http://127.0.0.1:30141")));
		assert_eq!(machine.phase(), Phase::Ready);
		assert_eq!(machine.quit_action(false), QuitAction::Stop);
	}

	#[test]
	fn a_failed_start_can_be_retried() {
		let mut machine = EnsureBackend::default();
		machine.begin();
		machine.apply(Signal::Starting);
		let applied = machine.apply(Signal::Failed("zenity: no such file".to_owned()));
		assert!(applied.changed);
		assert_eq!(machine.phase(), Phase::Failed);
		assert_eq!(machine.error(), Some("zenity: no such file"));

		let applied = machine.begin();
		assert!(applied.changed);
		assert_eq!(machine.phase(), Phase::Starting);
		assert_eq!(machine.error(), None);
		machine.apply(Signal::Live(info("http://127.0.0.1:30141")));
		assert_eq!(machine.phase(), Phase::Ready);
	}

	#[test]
	fn a_crash_after_ready_is_a_failure_not_a_frozen_ready() {
		let mut machine = EnsureBackend::default();
		machine.begin();
		machine.apply(Signal::Live(info("http://127.0.0.1:30141")));
		let applied = machine.apply(Signal::Crashed("后台进程已退出".to_owned()));
		assert!(applied.changed);
		assert_eq!(machine.phase(), Phase::Failed);
		assert_eq!(machine.error(), Some("后台进程已退出"));
	}

	#[test]
	fn a_restart_is_ours_even_when_the_backend_was_not() {
		let mut machine = EnsureBackend::default();
		machine.begin();
		machine.apply(Signal::Live(info("http://127.0.0.1:30141")));
		assert_eq!(machine.quit_action(false), QuitAction::LeaveForeign);
		machine.begin_restart();
		assert_eq!(machine.phase(), Phase::Starting);
		assert_eq!(machine.quit_action(false), QuitAction::Stop);
	}

	#[test]
	fn keeping_the_daemon_on_quit_wins_over_ownership() {
		let mut machine = EnsureBackend::default();
		machine.begin();
		machine.apply(Signal::Starting);
		machine.apply(Signal::Live(info("http://127.0.0.1:30141")));
		assert_eq!(machine.quit_action(true), QuitAction::LeaveRunning);
	}

	#[test]
	fn an_address_change_asks_for_a_reconnect() {
		let mut machine = EnsureBackend::default();
		machine.begin();
		machine.apply(Signal::Live(info("http://127.0.0.1:30141")));
		let applied = machine.apply(Signal::Live(info("http://127.0.0.1:30241")));
		assert!(applied.changed, "ready → ready with a new address is still a change");
		assert!(applied.reconnect);

		let again = machine.apply(Signal::Live(info("http://127.0.0.1:30241")));
		assert!(!again.changed, "the same address is not a new transition");
		assert!(!again.reconnect);
	}

	#[test]
	fn poll_never_waits_on_the_worker() {
		// A worker that is still blocked must not hold up a frame: `poll`
		// drains with `try_recv` and returns.
		let (sender, receiver) = channel();
		let mut host = BackendHost::default();
		host.signals = Some(receiver);
		let worker = thread::spawn(move || {
			thread::sleep(Duration::from_millis(600));
			let _ = sender.send(Signal::Live(info("http://127.0.0.1:30141")));
		});
		let started = Instant::now();
		let changed = host.poll();
		assert!(!changed);
		assert_eq!(host.phase(), Phase::Idle);
		assert!(
			started.elapsed() < Duration::from_millis(200),
			"poll took {:?} — it waited on the worker",
			started.elapsed()
		);
		worker.join().unwrap();
		// The signal is delivered on a later frame.
		assert!(host.poll());
		assert_eq!(host.phase(), Phase::Ready);
	}

	#[test]
	fn an_absent_binary_fails_with_the_resolution_sentence() {
		let mut machine = EnsureBackend::default();
		machine.begin();
		machine.apply(Signal::Failed(missing_binary()));
		assert_eq!(machine.phase(), Phase::Failed);
		assert!(!machine.started_by_us());
	}

	#[test]
	fn the_banner_names_the_state_and_hides_when_ready() {
		let mut host = BackendHost::default();
		assert!(host.banner().is_none(), "idle draws nothing");
		host.observe(Signal::Starting);
		assert!(host.banner().unwrap().contains("启动"));
		host.observe(Signal::Live(info("http://127.0.0.1:30141")));
		assert!(host.banner().is_none(), "ready needs no banner");
		host.observe(Signal::Crashed("后台进程已退出".to_owned()));
		let banner = host.banner().expect("a crash stays on screen");
		assert!(banner.contains("后台进程已退出"), "{banner}");
	}
}
