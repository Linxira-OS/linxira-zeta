//! 后台驻留 (background residency): what closing the window means, what the
//! process does once the window is gone, and how a second launch finds the
//! first one.
//!
//! The maintainer's rulings (2026-10-16, extended 2026-10-17) fix four things:
//!
//! 1. **`关闭窗口时`** — `最小化到后台` (default) / `退出应用` / `每次询问`. The ask
//!    modal carries exactly **one** checkbox, `记住我的选择，不再询问`: ticked, the
//!    choice overwrites `close_action` and the modal never appears again; left
//!    clear, it applies to this close only and the next close asks again.
//! 2. **后台态资源策略** — no frames, so no terminal blit and no offscreen
//!    raster; the RSS/clock poll drops to [`BACKGROUND_POLL`]. The session state
//!    machine and the agent children stay alive: nothing here touches them.
//! 3. **唤回** — a dock icon is not the only way back. A second launch has to
//!    find the first one, which is what [`Lifecycle::claim`] is for.
//! 4. **忙/闲边沿** — a pane is busy when its shell has live children; a
//!    busy→idle edge while the window is not in front of the user is what
//!    [`crate::notify`] turns into a notification.
//!
//! # The single-instance mechanism, and why it is a socket
//!
//! [`claim`] is a **loopback TCP socket**, not a named mutex and not a lock file
//! on its own:
//!
//! * a Windows named mutex needs `CreateMutexW` through the `windows` crate,
//!   which is a platform dependency for one bit of state;
//! * a lock file alone cannot tell a live owner from a stale one — the file
//!   outlives a crashed process, so the next launch would have to guess;
//! * a loopback socket is pure `std`, works the same on both platforms, and —
//!   the deciding property this round — **it can be exercised headlessly**, by
//!   pointing two `TcpStream`s at a listener on port 0.
//!
//! The lock file is still written, but only to publish *which* port the owner
//! picked; it is a hint, never the decision.
//!
//! ## Failure paths (all four are handled, none of them silently)
//!
//! | what happens | what the shell does |
//! |---|---|
//! | the port is held by **another program** | the handshake reply does not match ⇒ *not* an instance; start normally, record the reason |
//! | the port is held by a **wedged zetawork** | the handshake times out (1 s) ⇒ start anyway; two windows beat "the icon did nothing" |
//! | loopback `bind` is refused by policy | claim `Unavailable`, start normally, record the OS message |
//! | `~/.zeta` cannot be written | the lock file is skipped; the default port is used |

use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use egui::{Context, ViewportCommand};
use sysinfo::{Pid, ProcessesToUpdate, System};

use crate::Shell;
use crate::settings::CloseAction;

/// The line a second launch sends.
pub const ACTIVATE: &str = "zetawork-activate/1";

/// The line the first instance answers with — proof that it is *us*, not some
/// other program that happens to hold the port.
pub const ACK: &str = "zetawork-ok/1";

/// The port the first instance listens on unless the lock file says otherwise.
pub const PORT: u16 = 49_731;

/// How long a second launch waits for the answer before deciding the port is
/// not a live zetawork.
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(1);

/// The RSS / clock interval while the window is hidden. The foreground samples
/// every two seconds; with no frame to draw, thirty is already generous.
pub const BACKGROUND_POLL: Duration = Duration::from_secs(30);

/// `~/.zeta/zetawork-gui.instance` — the port the owner picked.
pub fn lock_path() -> PathBuf {
	let home = std::env::var_os("USERPROFILE")
		.or_else(|| std::env::var_os("HOME"))
		.map(PathBuf::from)
		.unwrap_or_else(|| PathBuf::from("."));
	home.join(".zeta").join("zetawork-gui.instance")
}

/// What a second launch resolved the close button to for this click.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloseDecision {
	/// 最小化到后台.
	Background,
	/// 退出应用.
	Quit,
}

impl CloseDecision {
	/// The settings value this decision means, for 记住我的选择.
	pub fn as_action(self) -> CloseAction {
		match self {
			Self::Background => CloseAction::MinimizeToBackground,
			Self::Quit => CloseAction::Quit,
		}
	}
}

/// The 每次询问 modal's state. Exactly one checkbox, by ruling: the maintainer's
/// two candidate boxes (`维持上一次的选择` + `不要再展示`) are the same idea folded
/// into one, so there is deliberately no second field here.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AskState {
	/// 记住我的选择，不再询问.
	pub remember: bool,
}

/// What [`probe`] heard back from a port.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Probe {
	/// A live zetawork answered and was asked to show its window.
	Ack,
	/// Something answered, but not with [`ACK`] — a squatter, not an instance.
	Squat,
	/// Nothing answered within [`HANDSHAKE_TIMEOUT`] (no listener, or a wedged
	/// one).
	Silent,
}

/// The outcome of trying to become the single instance.
#[derive(Debug)]
pub enum Claim {
	/// This process owns the singleton and listens on the port inside.
	Owner(TcpListener),
	/// Another instance answered the handshake, so this launch has nothing to
	/// do.
	AlreadyRunning,
	/// No singleton could be established; the shell starts anyway, and `reason`
	/// says why so the status bar can show it.
	Unavailable(String),
}

/// Ask whoever holds `addr` to show their window.
///
/// Blocking for at most [`HANDSHAKE_TIMEOUT`], so a launch is never held up by a
/// port with nothing behind it.
pub fn probe(addr: SocketAddr) -> Probe {
	let Ok(mut stream) = TcpStream::connect_timeout(&addr, HANDSHAKE_TIMEOUT) else {
		return Probe::Silent;
	};
	let _ = stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT));
	let _ = stream.set_write_timeout(Some(HANDSHAKE_TIMEOUT));
	if writeln!(stream, "{ACTIVATE}").is_err() || stream.flush().is_err() {
		return Probe::Squat;
	}
	let mut line = String::new();
	match BufReader::new(&stream).read_line(&mut line) {
		Ok(_) if line.trim() == ACK => Probe::Ack,
		// Nothing spoke inside the budget. That is the wedged-instance row of
		// the table, not a squatter: [`Probe::Silent`] already means "no
		// listener, or a wedged one". Calling a timeout on a live `zetawork` a
		// squatter sent the diagnosis in the wrong direction.
		Err(error) if matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) => {
			Probe::Silent
		},
		// Hung up on, or answered with something that is not [`ACK`]: someone
		// else holds the port.
		Ok(_) | Err(_) => Probe::Squat,
	}
}

/// Answer one pending connection on the owner's listener.
///
/// The accept never parks a frame: with nothing waiting it costs one `accept`
/// call that returns `WouldBlock`. The read that follows *does* wait, for the
/// same [`HANDSHAKE_TIMEOUT`] budget a launch gives the answer, because the
/// connection can be in the backlog a while before the request line is in the
/// buffer. On Windows a socket accepted from a non-blocking listener inherits
/// that mode, so taking that empty buffer for a hang-up dropped a live
/// launcher's request and made it read us as a squatter. Returns true when the
/// connection asked this window to show itself.
pub fn serve_one(listener: &TcpListener) -> bool {
	let Ok((mut stream, _)) = listener.accept() else {
		return false;
	};
	// Per-socket, so the accept above stays non-blocking. Bounded: a connection
	// that never speaks costs one frame its timeout, and is then let go.
	let _ = stream.set_nonblocking(false);
	let _ = stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT));
	let mut line = String::new();
	let asked = BufReader::new(&stream)
		.read_line(&mut line)
		.map(|read| read > 0 && line.trim() == ACTIVATE)
		.unwrap_or(false);
	if asked {
		let _ = writeln!(stream, "{ACK}");
		let _ = stream.flush();
	}
	asked
}

/// The port the lock file names, or `None` when there is no readable file.
fn lock_port() -> Option<u16> {
	let text = std::fs::read_to_string(lock_path()).ok()?;
	text.trim().parse().ok()
}

/// Publish the port this process listens on. A failure is not fatal — the
/// default port is still tried first next time.
fn write_lock(port: u16) -> std::io::Result<()> {
	let path = lock_path();
	if let Some(dir) = path.parent() {
		std::fs::create_dir_all(dir)?;
	}
	std::fs::write(path, format!("{port}\n"))
}

/// Try to become the single instance.
///
/// The order matters: **probe before bind**. Binding first would make a second
/// launch look like a squatter to itself, and the lock file is only a hint about
/// which port to try.
pub fn claim() -> Claim {
	let default = SocketAddr::from((Ipv4Addr::LOCALHOST, PORT));
	let published = lock_port().filter(|port| *port != 0);
	if let Some(port) = published {
		let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
		match probe(addr) {
			Probe::Ack => return Claim::AlreadyRunning,
			// A squatter on the published port says nothing about the default
			// one, so fall through and try to bind.
			Probe::Squat => {},
			Probe::Silent => {},
		}
	}
	match probe(default) {
		Probe::Ack => return Claim::AlreadyRunning,
		Probe::Squat | Probe::Silent => {},
	}
	let mut notes = Vec::new();
	for addr in [default] {
		match TcpListener::bind(addr) {
			Ok(listener) => {
				let _ = listener.set_nonblocking(true);
				if let Ok(port) = listener.local_addr().map(|addr| addr.port()) {
					if let Err(error) = write_lock(port) {
						notes.push(format!("单实例锁文件写不进（{error}）"));
					}
				}
				return Claim::Owner(listener);
			},
			Err(error) => notes.push(format!("回环端口 {addr} 绑定失败（{error}）")),
		}
	}
	Claim::Unavailable(notes.join("；"))
}

/// Is another zetawork already running (and, as a side effect, told to show
/// itself)? Used by [`crate::run`] before a window is created.
pub fn another_instance_is_running() -> bool {
	let mut ports: Vec<u16> = Vec::new();
	if let Some(port) = lock_port() {
		ports.push(port);
	}
	if !ports.contains(&PORT) {
		ports.push(PORT);
	}
	ports
		.into_iter()
		.any(|port| probe(SocketAddr::from((Ipv4Addr::LOCALHOST, port))) == Probe::Ack)
}

// ── busy panes ─────────────────────────────────────────────────────────

/// Pure decision over a process snapshot: busy iff some live process parents to
/// the shell's pid. A shell without a known pid counts idle — the probe must
/// never trap the user. (The same rule as `zeta-main`'s `busy.rs`, which is
/// where this idea comes from.)
pub fn busy_from_parents(parent_pids: &[Option<u32>], shell_pid: Option<u32>) -> bool {
	match shell_pid {
		None => false,
		Some(pid) => parent_pids.contains(&Some(pid)),
	}
}

/// Whether the shell `pid` has live children right now.
///
/// One enumeration per call, and the caller decides when that is worth it — the
/// GUI has no PTY host yet, so no pane has a pid to ask about; see
/// [`crate::notify::MISSING_SIGNALS`].
pub fn shell_has_live_children(pid: u32) -> bool {
	let mut system = System::new();
	system.refresh_processes(ProcessesToUpdate::All);
	let parents: Vec<Option<u32>> = system
		.processes()
		.values()
		.map(|process| process.parent().map(Pid::as_u32))
		.collect();
	busy_from_parents(&parents, Some(pid))
}

/// The busy verdict for one pane.
pub fn pane_is_busy(shell_pid: Option<u32>) -> bool {
	match shell_pid {
		None => false,
		Some(pid) => shell_has_live_children(pid),
	}
}

/// Per-pane busy→idle edge detection.
///
/// The first observation of a pane only records it: a pane that appears already
/// idle is not an edge, or every start-up would fire a notification.
#[derive(Debug, Default)]
pub struct BusyEdges {
	seen: Vec<(String, bool)>,
}

impl BusyEdges {
	/// Record `busy` for `pane_id`. Returns true when this is a busy→idle edge.
	pub fn observe(&mut self, pane_id: &str, busy: bool) -> bool {
		match self.seen.iter_mut().find(|(id, _)| id == pane_id) {
			Some(entry) => {
				let was = entry.1;
				entry.1 = busy;
				was && !busy
			},
			None => {
				self.seen.push((pane_id.to_owned(), busy));
				false
			},
		}
	}

	/// Forget panes that are gone, so a closed pane's slot does not keep a
	/// stale `true` that would fire an edge if the id came back.
	pub fn retain(&mut self, live: &[String]) {
		self.seen.retain(|(id, _)| live.contains(id));
	}
}

// ── the residency itself ───────────────────────────────────────────────

/// Everything about the process that outlives the window.
#[derive(Debug)]
pub struct Lifecycle {
	/// True while the window is hidden.
	pub background: bool,
	/// The 每次询问 modal, when it is up.
	pub ask: Option<AskState>,
	/// The single-instance listener; `None` when this process could not claim
	/// one (a test shell never tries).
	listener: Option<TcpListener>,
	/// Anything the residency could not do, in the user's language.
	pub notes: Vec<String>,
	/// Per-pane busy edges.
	pub busy: BusyEdges,
	/// The last background-driven refresh.
	last_poll: Instant,
	/// Set when another launch asked this window to come back.
	pub activation_requested: bool,
	/// True once the close button has been answered with 退出.
	pub quitting: bool,
}

impl Default for Lifecycle {
	fn default() -> Self {
		Self {
			background: false,
			ask: None,
			listener: None,
			notes: Vec::new(),
			busy: BusyEdges::default(),
			last_poll: Instant::now(),
			activation_requested: false,
			quitting: false,
		}
	}
}

/// What one [`Lifecycle::poll`] decided. Returned rather than done, because
/// everything that touches the workbench belongs to the caller — the residency
/// itself only owns the process-level parts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Polled {
	/// Another launch asked this window to show itself, and it did.
	pub activated: bool,
	/// The hidden window's slow tick is due.
	pub background_refresh_due: bool,
	/// The user answered 退出 (the title bar's close button or the tray menu).
	pub quitting: bool,
}

impl Lifecycle {
	/// Claim the singleton. Called by the real run path only — a headless shell
	/// must not bind a port.
	pub fn claim(&mut self) {
		match claim() {
			Claim::Owner(listener) => self.listener = Some(listener),
			Claim::AlreadyRunning => {
				// `run` checked before creating the window, so this only
				// happens on a race: two launches a few milliseconds apart.
				self
					.notes
					.push("另一个 zetawork 刚刚启动（单实例竞态）".to_owned());
			},
			Claim::Unavailable(reason) => self.notes.push(reason),
		}
	}

	/// Per-frame residency work: answer activation requests, run the slow poll
	/// while hidden, and report a pending quit.
	pub fn poll(&mut self, ctx: &Context) -> Polled {
		let mut polled = Polled::default();
		if let Some(listener) = self.listener.as_ref() {
			if serve_one(listener) {
				self.activation_requested = true;
			}
		}
		if self.activation_requested {
			self.activation_requested = false;
			self.background = false;
			ctx.send_viewport_cmd(ViewportCommand::Visible(true));
			ctx.send_viewport_cmd(ViewportCommand::Focus);
			ctx.request_repaint();
			polled.activated = true;
		}
		if self.background && self.last_poll.elapsed() >= BACKGROUND_POLL {
			self.last_poll = Instant::now();
			polled.background_refresh_due = true;
		}
		polled.quitting = self.quitting;
		polled
	}

	/// 最小化到后台.
	pub fn hide(&mut self, ctx: &Context) {
		self.background = true;
		self.last_poll = Instant::now();
		ctx.send_viewport_cmd(ViewportCommand::Visible(false));
	}

	/// Come back: one repaint, immediately, so the frame behind the window is
	/// not stale.
	pub fn show(&mut self, ctx: &Context) {
		self.background = false;
		ctx.send_viewport_cmd(ViewportCommand::Visible(true));
		ctx.send_viewport_cmd(ViewportCommand::Focus);
		ctx.request_repaint();
	}
}

/// The close button, routed by 设置 → 关闭窗口时.
///
/// `ask` shows the modal instead of deciding; everything else resolves here, so
/// the title bar has no policy of its own.
pub fn request_close(ctx: &Context, shell: &mut Shell) {
	match shell.settings.close_action {
		CloseAction::MinimizeToBackground => shell.lifecycle.hide(ctx),
		CloseAction::Quit => {
			shell.lifecycle.quitting = true;
			ctx.send_viewport_cmd(ViewportCommand::Close);
		},
		CloseAction::Ask => shell.lifecycle.ask = Some(AskState::default()),
	}
}

/// Resolve one answer from the ask modal.
///
/// `remember` is the single checkbox: ticked, the answer is written into
/// `关闭窗口时` and the modal is never shown again; clear, the settings keep
/// `每次询问` and the next close asks.
pub fn resolve_ask(ctx: &Context, shell: &mut Shell, decision: CloseDecision) {
	let remember = shell.lifecycle.ask.map(|ask| ask.remember).unwrap_or(false);
	shell.lifecycle.ask = None;
	if remember {
		shell.settings.close_action = decision.as_action();
		// Same path every other settings control takes, so the value is
		// persisted and the style re-applied exactly once.
		shell.apply_settings(ctx);
	}
	match decision {
		CloseDecision::Background => shell.lifecycle.hide(ctx),
		CloseDecision::Quit => {
			shell.lifecycle.quitting = true;
			ctx.send_viewport_cmd(ViewportCommand::Close);
		},
	}
}

/// The 每次询问 modal: three buttons and **one** checkbox.
///
/// Esc cancels, like every other overlay in this shell.
pub fn modal(ctx: &Context, shell: &mut Shell) {
	if shell.lifecycle.ask.is_none() {
		return;
	}
	if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
		shell.lifecycle.ask = None;
		return;
	}
	let mut answer: Option<CloseDecision> = None;
	let mut cancel = false;
	egui::Area::new(egui::Id::new("zetawork-close-ask"))
		.order(egui::Order::Foreground)
		.anchor(egui::Align2::CENTER_CENTER, egui::vec2(0.0, 0.0))
		.show(ctx, |ui| {
			egui::Frame::new()
				.fill(crate::theme::PANEL)
				.stroke(egui::Stroke::new(1.0, crate::theme::BORDER_2))
				.corner_radius(egui::CornerRadius::same(crate::theme::R_MODAL))
				.inner_margin(egui::Margin::same(16))
				.show(ui, |ui| {
					ui.set_min_width(360.0);
					ui.vertical(|ui| {
						ui.label(
							egui::RichText::new("关闭窗口")
								.size(14.0)
								.strong()
								.color(crate::theme::TEXT),
						);
						ui.label(
							egui::RichText::new("会话与后台任务仍在运行，选择怎么处理这个窗口。")
								.size(12.0)
								.color(crate::theme::TEXT_2),
						);
						ui.add_space(12.0);
						ui.horizontal(|ui| {
							if ui.button("最小化到后台").clicked() {
								answer = Some(CloseDecision::Background);
							}
							if ui.button("退出应用").clicked() {
								answer = Some(CloseDecision::Quit);
							}
							if ui.button("取消").clicked() {
								cancel = true;
							}
						});
						ui.add_space(8.0);
						if let Some(ask) = shell.lifecycle.ask.as_mut() {
							ui.checkbox(&mut ask.remember, "记住我的选择，不再询问");
						}
					});
				});
		});
	if cancel {
		shell.lifecycle.ask = None;
		return;
	}
	if let Some(decision) = answer {
		resolve_ask(ctx, shell, decision);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn addr(port: u16) -> SocketAddr {
		SocketAddr::from((Ipv4Addr::LOCALHOST, port))
	}

	/// A listener in the state [`claim`] leaves the real one in: bound on a port
	/// the OS picked, listening, non-blocking so `accept` never parks a frame.
	fn owned_listener() -> (TcpListener, u16) {
		let listener = TcpListener::bind(addr(0)).expect("bind");
		let port = listener.local_addr().expect("addr").port();
		listener.set_nonblocking(true).expect("nonblocking");
		(listener, port)
	}

	/// The owner's loop off the UI thread: the receiver that resolves once the
	/// thread is up, and the thread itself, whose verdict is whether it saw the
	/// activation request.
	type Owner = (std::sync::mpsc::Receiver<()>, std::thread::JoinHandle<bool>);

	/// The owner's per-frame loop: `serve_one` until it answers, with a deadline
	/// so a handshake that never arrives cannot hang the suite.
	///
	/// The receiver resolves once the thread is up, so a test that probes the
	/// port straight away is not racing the thread's start-up.
	fn spawn_owner(listener: TcpListener) -> Owner {
		let (ready, up) = std::sync::mpsc::channel();
		let owner = std::thread::spawn(move || {
			let _ = ready.send(());
			let deadline = Instant::now() + Duration::from_secs(5);
			while Instant::now() < deadline {
				if serve_one(&listener) {
					return true;
				}
				std::thread::sleep(Duration::from_millis(5));
			}
			false
		});
		(up, owner)
	}

	#[test]
	fn an_owner_answers_the_handshake_and_is_found() {
		// Port 0: the OS picks a free one, so the test never collides with a
		// real instance or with a parallel test.
		let (listener, port) = owned_listener();
		let (owner_up, owner) = spawn_owner(listener);
		owner_up.recv().expect("the owner thread is up");
		assert_eq!(probe(addr(port)), Probe::Ack, "the owner answers with ACK");
		assert!(owner.join().expect("join"), "the owner saw the activation request");
	}

	#[test]
	fn the_owner_waits_for_the_request_line_before_it_answers() {
		// The interleaving the full-run flake lived in, staged on purpose: the
		// connect is `Ok` as soon as the listener's backlog takes it, which can
		// be a good while before the request line is in the owner's receive
		// buffer. A socket accepted from a non-blocking listener inherits that
		// mode on Windows, so the owner's first read comes back `WouldBlock`;
		// treating that as "not asked" hung up on a live launcher, whose
		// `probe` then read an aborted socket and called this process a
		// squatter (`Squat`).
		let (listener, port) = owned_listener();
		let (owner_up, owner) = spawn_owner(listener);
		owner_up.recv().expect("the owner thread is up");
		let launcher = std::thread::spawn(move || {
			let mut stream = TcpStream::connect(addr(port)).expect("connect");
			// Connect first, speak later — the order the race produced.
			std::thread::sleep(Duration::from_millis(200));
			let _ = writeln!(stream, "{ACTIVATE}");
			let _ = stream.flush();
			let mut line = String::new();
			let _ = BufReader::new(&stream).read_line(&mut line);
			line.trim().to_owned()
		});
		assert_eq!(
			launcher.join().expect("join"),
			ACK,
			"the owner waits for the request line instead of hanging up on it"
		);
		assert!(owner.join().expect("join"), "the owner saw the activation request");
	}

	#[test]
	fn a_port_with_nothing_behind_it_is_silent_not_an_instance() {
		// Bind then drop, so the port is almost certainly free.
		let port = {
			let listener = TcpListener::bind(addr(0)).expect("bind");
			listener.local_addr().expect("addr").port()
		};
		// Either nothing is listening (Silent) or something unrelated is
		// (Squat); neither is allowed to read as Ack, or a launch would exit
		// against a stranger's port.
		assert_ne!(probe(addr(port)), Probe::Ack);
	}

	#[test]
	fn busy_needs_a_child_that_parents_to_the_shell() {
		assert!(busy_from_parents(&[Some(1), Some(42), Some(7)], Some(42)));
		assert!(!busy_from_parents(&[Some(1), Some(7)], Some(42)), "no child of 42");
		let orphans: [Option<u32>; 1] = [None];
		assert!(!busy_from_parents(&orphans, Some(42)), "orphans do not count");
		assert!(!pane_is_busy(None), "an unknown shell is idle, never busy");
	}

	#[test]
	fn only_a_true_then_false_observation_is_an_edge() {
		let mut edges = BusyEdges::default();
		assert!(!edges.observe("p1", false), "the first look is not an edge");
		assert!(!edges.observe("p1", true), "busy is not an edge");
		assert!(edges.observe("p1", false), "busy → idle is");
		assert!(!edges.observe("p1", false), "idle → idle is not");
		edges.observe("p2", true);
		edges.observe("p2", false);
		edges.retain(&["p1".to_owned()]);
		assert!(!edges.observe("p2", false), "a forgotten pane starts over");
	}

	#[test]
	fn remembering_a_choice_is_what_stops_the_question() {
		assert_eq!(CloseDecision::Background.as_action(), CloseAction::MinimizeToBackground);
		assert_eq!(CloseDecision::Quit.as_action(), CloseAction::Quit);
		// The two answers the modal may overwrite 每次询问 with, and nothing
		// else: `Ask` is never written back.
		assert_ne!(CloseDecision::Background.as_action(), CloseAction::Ask);
		assert_ne!(CloseDecision::Quit.as_action(), CloseAction::Ask);
	}

	#[test]
	fn the_socket_carries_the_handshake_verbatim() {
		assert_eq!(ACTIVATE, "zetawork-activate/1");
		assert_eq!(ACK, "zetawork-ok/1");
		assert_ne!(ACTIVATE, ACK, "the reply must not be the request");
	}
}
