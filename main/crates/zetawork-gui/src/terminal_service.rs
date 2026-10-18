// SPDX-License-Identifier: AGPL-3.0-only
//! A terminal pane backed by `zetacode serve`'s PTY, over the gateway's
//! WebSocket data plane.
//!
//! The local [`crate::live`] pane owns a PTY in this process. This module is
//! the other backend: the PTY lives in the gateway (so it survives the window,
//! and the TUI and GUI can attach to the same shell), and the pane reaches it
//! through the routes
//! `packages/coding-agent/src/server/web-gateway/terminal.ts`
//! already implements.
//!
//! One attach is three hand-rolled HTTP/1.1 steps, all on a background thread:
//!
//! 1. `POST /api/terminal/ensure` with the pane's `cwd` and a stable
//!    `instanceId` (the session tab id) returns `{id, ticket, …}`;
//! 2. `GET /api/terminal/<id>/ws` upgrades to a WebSocket ([`crate::ws`]),
//!    carrying the one-time `ticket` as a query parameter when serve issued
//!    one;
//! 3. `POST /api/terminal/<id>/resize` matches the pane's grid, and again on
//!    every geometry change.
//!
//! The data plane's first binary frame is `0x00` + JSON (`{replayedBytes}`);
//! every later binary frame is raw PTY bytes. [`decode_frame`] makes that
//! distinction, and [`Screen`] parses the VT stream into the same ratatui
//! `Buffer` the local pane blits. Inbound stdin goes out as text frames.
//!
//! Failure is explicit, never silent: the attach thread reports
//! [`Event::Failed`] with the transport's own reason and [`TerminalHost`]
//! switches that tab to [`Backend::Local`], which is what makes the pane fall
//! back to [`crate::live`]. The reason is kept and drawn in the pane's status
//! line, once, instead of leaving the user with a blank grid.

use std::{
	collections::BTreeMap,
	io::{Read, Write},
	path::{Path, PathBuf},
	sync::mpsc::{Receiver, Sender, channel},
	thread,
	time::Duration,
};

use ratatui::{buffer::Buffer, layout::Rect};
use serde_json::{Value, json};
use unicode_width::UnicodeWidthChar;

use crate::ws;

/// How long an `ensure`/`resize` answer may take.
const HTTP_TIMEOUT: Duration = Duration::from_secs(3);
/// The pane's own status line height (drawn by `center::term_body`).
pub const STATUS_HEIGHT: f32 = 18.0;

/// Which backend a terminal tab is on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
	/// The attach thread is dialling serve; nothing has answered yet.
	Connecting,
	/// The PTY lives in serve and the WebSocket is carrying its bytes.
	Service,
	/// The serve session ended (PTY exit or `session_ended`); the final grid
	/// stays on screen and is no longer writable.
	Ended,
	/// Serve could not be used; the tab's PTY is [`crate::live`]'s.
	Local,
}

/// What one attach's `POST /api/terminal/ensure` named.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Attach {
	pub id: String,
	pub ticket: Option<String>,
}

/// One inbound data-plane binary frame.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Inbound {
	/// `0x00` + JSON: replay metadata, exit or session-ended notices.
	Control(Value),
	/// Raw PTY bytes.
	Data(Vec<u8>),
}

/// Decode one outbound binary frame: the `0x00` prefix is the whole protocol.
pub(crate) fn decode_frame(frame: &[u8]) -> Inbound {
	match frame.split_first() {
		Some((&0, rest)) => Inbound::Control(
			serde_json::from_slice(rest).unwrap_or_else(|_| Value::Object(Default::default())),
		),
		_ => Inbound::Data(frame.to_vec()),
	}
}

/// Parse an `ensure` body. The gateway answers with `{id, ticket, …}` at the
/// top level; an `{ok:true, session:{…}}` wrapper is tolerated so an older
/// shape falls back to the same reader instead of failing silently.
pub(crate) fn parse_attach(body: &str) -> Option<Attach> {
	let value: Value = serde_json::from_str(body).ok()?;
	let source = value
		.get("session")
		.filter(|session| session.is_object())
		.unwrap_or(&value);
	let id = source.get("id").and_then(Value::as_str)?.trim();
	if id.is_empty() {
		return None;
	}
	let ticket = source
		.get("ticket")
		.or_else(|| value.get("ticket"))
		.and_then(Value::as_str)
		.map(str::to_owned);
	Some(Attach { id: id.to_owned(), ticket })
}

/// `POST /api/terminal/ensure` and read its `{id, ticket}` answer.
pub(crate) fn ensure(origin: &str, cwd: &Path, instance: &str) -> Result<Attach, String> {
	let body = json!({
		"cwd": cwd.to_string_lossy(),
		"instanceId": instance,
	})
	.to_string();
	let (status, body) = post_json(origin, "/api/terminal/ensure", &body)?;
	if status != 200 {
		return Err(format!("serve 拒绝终端 attach（{status}）：{}", error_text(&body)));
	}
	parse_attach(&body).ok_or_else(|| {
		format!(
			"serve 的终端 attach 应答没有 id：{}",
			body.trim().chars().take(160).collect::<String>()
		)
	})
}

/// `POST /api/terminal/<id>/resize`. A failure is not fatal to the attach; the
/// grid is only mis-sized until the next geometry change.
fn post_resize(origin: &str, id: &str, cols: u16, rows: u16) -> Result<(), String> {
	// The gateway rejects grids below 2×2; a one-row pane must not 400 here.
	let body = json!({ "cols": cols.max(2), "rows": rows.max(2) }).to_string();
	let path = format!("/api/terminal/{id}/resize");
	let (status, body) = post_json(origin, &path, &body)?;
	if status == 200 {
		Ok(())
	} else {
		Err(format!("serve 拒绝 resize（{status}）：{}", error_text(&body)))
	}
}

/// The WebSocket path, with the one-time ticket when serve issued one.
pub(crate) fn ws_path(id: &str, ticket: Option<&str>) -> String {
	match ticket.filter(|ticket| !ticket.is_empty()) {
		Some(ticket) => format!("/api/terminal/{id}/ws?ticket={ticket}"),
		None => format!("/api/terminal/{id}/ws"),
	}
}

/// One hand-rolled HTTP/1.1 POST; returns `(status, body)`.
fn post_json(origin: &str, path: &str, body: &str) -> Result<(u16, String), String> {
	let (host, port, authority) = ws::origin_endpoint(origin)?;
	let mut stream = ws::dial(&host, port, HTTP_TIMEOUT)?;
	stream
		.set_read_timeout(Some(HTTP_TIMEOUT))
		.map_err(|error| format!("设置读超时失败：{error}"))?;
	stream
		.set_write_timeout(Some(HTTP_TIMEOUT))
		.map_err(|error| format!("设置写超时失败：{error}"))?;
	let request = format!(
		"POST {path} HTTP/1.1\r\nHost: {authority}\r\nContent-Type: \
		 application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
		body.len()
	);
	stream
		.write_all(request.as_bytes())
		.map_err(|error| format!("发送 {path} 失败：{error}"))?;
	let mut response = String::new();
	stream
		.read_to_string(&mut response)
		.map_err(|error| format!("读取 {path} 应答失败：{error}"))?;
	let status = response
		.lines()
		.next()
		.and_then(|line| line.split_whitespace().nth(1))
		.and_then(|status| status.parse().ok())
		.ok_or_else(|| format!("{path} 的应答没有状态行"))?;
	let body = response
		.split_once("\r\n\r\n")
		.map(|(_, body)| body.to_owned())
		.unwrap_or_default();
	Ok((status, body))
}

/// The gateway's `error` string, when the answer is JSON, else its head.
fn error_text(body: &str) -> String {
	serde_json::from_str::<Value>(body)
		.ok()
		.and_then(|value| {
			value
				.get("error")
				.and_then(Value::as_str)
				.map(str::to_owned)
		})
		.unwrap_or_else(|| body.trim().chars().take(160).collect())
}

/// What the attach thread reports to the UI thread.
enum Raw {
	Opened,
	Output(Vec<u8>),
	Ended(String),
	Failed(String),
}

/// What [`ServiceTerminal::poll`] says happened.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
	/// The WebSocket is live; the pane can say so.
	Opened,
	/// New PTY bytes were parsed into the screen; repaint.
	Output,
	/// The serve-side PTY ended normally.
	Ended(String),
	/// The transport failed; the pane must fall back to the local PTY.
	Failed(String),
}

/// The pane-visible commands the attach thread executes.
enum Command {
	Input(Vec<u8>),
	Resize(u16, u16),
	Close,
}

/// One service-backed terminal tab.
pub struct ServiceTerminal {
	screen: Screen,
	events: Receiver<Raw>,
	commands: Sender<Command>,
	cols: u16,
	rows: u16,
	alive: bool,
}

impl ServiceTerminal {
	/// Start attaching on a background thread. The dial itself is never on the
	/// UI thread, so an unreachable serve cannot freeze the window; its refusal
	/// arrives as [`Event::Failed`].
	pub fn attach(origin: &str, cwd: Option<PathBuf>, instance: &str, cols: u16, rows: u16) -> Self {
		let (event_tx, events) = channel();
		let (commands, command_rx) = channel();
		let origin = origin.to_owned();
		let cwd =
			cwd.unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
		let instance = instance.to_owned();
		thread::spawn(move || attach_thread(origin, cwd, instance, cols, rows, event_tx, command_rx));
		Self {
			screen: Screen::new(cols as usize, rows as usize),
			events,
			commands,
			cols,
			rows,
			alive: true,
		}
	}

	/// Everything that arrived since the last tick, with output already parsed
	/// into the screen.
	pub fn poll(&mut self) -> Vec<Event> {
		let mut events = Vec::new();
		for event in self.events.try_iter() {
			match event {
				Raw::Opened => events.push(Event::Opened),
				Raw::Output(bytes) => {
					self.screen.feed(&bytes);
					events.push(Event::Output);
				},
				Raw::Ended(reason) => {
					self.alive = false;
					events.push(Event::Ended(reason));
				},
				Raw::Failed(reason) => {
					self.alive = false;
					events.push(Event::Failed(reason));
				},
			}
		}
		events
	}

	/// Queue stdin as a text frame.
	pub fn send_bytes(&self, bytes: &[u8]) {
		if self.alive && !bytes.is_empty() {
			let _ = self.commands.send(Command::Input(bytes.to_vec()));
		}
	}

	/// Match the remote PTY to a new grid; no-op when the geometry is unchanged.
	pub fn resize(&mut self, cols: u16, rows: u16) {
		if (cols, rows) == (self.cols, self.rows) {
			return;
		}
		self.cols = cols;
		self.rows = rows;
		self.screen.resize(cols as usize, rows as usize);
		let _ = self.commands.send(Command::Resize(cols, rows));
	}

	/// Draw the remote screen into the pane's ratatui buffer.
	pub fn render(&self, area: Rect, buf: &mut Buffer) {
		self.screen.render(area, buf);
	}
}

impl Drop for ServiceTerminal {
	fn drop(&mut self) {
		// The writer thread owns the socket; ask it to close so the reader's
		// blocking read returns and the closed tab leaves no thread behind.
		let _ = self.commands.send(Command::Close);
	}
}

/// The attach thread: ensure, upgrade, resize, then pump events forever.
fn attach_thread(
	origin: String,
	cwd: PathBuf,
	instance: String,
	cols: u16,
	rows: u16,
	events: Sender<Raw>,
	commands: Receiver<Command>,
) {
	let attach = match ensure(&origin, &cwd, &instance) {
		Ok(attach) => attach,
		Err(reason) => {
			let _ = events.send(Raw::Failed(reason));
			return;
		},
	};
	let path = ws_path(&attach.id, attach.ticket.as_deref());
	let (client, socket_events) = match ws::connect(&origin, &path) {
		Ok(pair) => pair,
		Err(reason) => {
			let _ = events.send(Raw::Failed(reason));
			return;
		},
	};
	// serve spawns the PTY at 80x24; the pane's real grid follows immediately.
	let _ = post_resize(&origin, &attach.id, cols, rows);
	if events.send(Raw::Opened).is_err() {
		return;
	}

	let writer_origin = origin;
	let writer_id = attach.id;
	thread::spawn(move || {
		for command in commands {
			match command {
				Command::Input(bytes) => {
					let text = String::from_utf8_lossy(&bytes);
					if client.send_text(&text).is_err() {
						return;
					}
				},
				Command::Resize(cols, rows) => {
					let _ = post_resize(&writer_origin, &writer_id, cols, rows);
				},
				Command::Close => {
					let _ = client.close();
					return;
				},
			}
		}
	});

	let mut ended = false;
	while let Ok(event) = socket_events.recv() {
		match event {
			ws::Event::Opened => {},
			ws::Event::Binary(payload) => match decode_frame(&payload) {
				Inbound::Control(value) => {
					let Some(kind) = value.get("event").and_then(Value::as_str) else {
						continue;
					};
					let reason = match kind {
						"exit" => match value.get("exitCode").and_then(Value::as_i64) {
							Some(code) => format!("serve 终端已退出（code {code}）"),
							None => "serve 终端已退出".to_owned(),
						},
						"session_ended" => {
							let why = value
								.get("reason")
								.and_then(Value::as_str)
								.unwrap_or("unknown");
							format!("serve 结束了终端会话（{why}）")
						},
						other => format!("serve 终端结束（{other}）"),
					};
					ended = true;
					if events.send(Raw::Ended(reason)).is_err() {
						return;
					}
				},
				Inbound::Data(bytes) => {
					if events.send(Raw::Output(bytes)).is_err() {
						return;
					}
				},
			},
			ws::Event::Closed => {
				if !ended {
					let _ = events.send(Raw::Failed("serve 的终端 WebSocket 已关闭".to_owned()));
				}
				return;
			},
			ws::Event::Failed(reason) => {
				let _ = events.send(Raw::Failed(reason));
				return;
			},
		}
	}
}

/// Which backend every terminal tab is on, and the reason it is not on serve.
#[derive(Default)]
pub struct TerminalHost {
	panes: BTreeMap<String, Pane>,
}

struct Pane {
	service: Option<ServiceTerminal>,
	backend: Backend,
	reason: Option<String>,
}

/// A terminal event tagged with its session tab.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HostEvent {
	Opened { tab: String },
	Output { tab: String },
	Ended { tab: String, reason: String },
	Failed { tab: String },
}

impl TerminalHost {
	/// Pick a backend for `tab` when it has none yet: serve when `origin` is
	/// known, otherwise the local PTY with the reason recorded. A tab stays on
	/// the backend it picked; a later serve failure moves it to `Local` once.
	pub fn ensure(
		&mut self,
		tab: &str,
		origin: Option<&str>,
		cwd: Option<PathBuf>,
		cols: u16,
		rows: u16,
	) {
		if let Some(pane) = self.panes.get_mut(tab) {
			if let Some(service) = pane.service.as_mut() {
				service.resize(cols, rows);
			}
			return;
		}
		let pane = match origin.filter(|origin| !origin.trim().is_empty()) {
			Some(origin) => Pane {
				service: Some(ServiceTerminal::attach(origin, cwd, &instance_id(tab), cols, rows)),
				backend: Backend::Connecting,
				reason: None,
			},
			None => Pane {
				service: None,
				backend: Backend::Local,
				reason: Some("未发现 ~/.zeta/serve.json 的 webUrl".to_owned()),
			},
		};
		self.panes.insert(tab.to_owned(), pane);
	}

	/// The pane's status line: which backend, in **one short sentence**.
	///
	/// A fallback always reads the same sentence. The transport's own text
	/// (`serve 拒绝终端 attach（400）：cwd does not exist`, a WebSocket close
	/// reason) is not a status line — it is not something the user can act on
	/// at a glance, and printing it made the line longer than the pane. The
	/// full reason stays on the host ([`Self::reason`]), which the pane shows
	/// in a tooltip.
	pub fn label(&self, tab: &str) -> Option<String> {
		let pane = self.panes.get(tab)?;
		Some(match pane.backend {
			Backend::Connecting => "后端：serve · 连接中…".to_owned(),
			Backend::Service => "后端：serve".to_owned(),
			Backend::Ended => "后端：serve · 会话已结束".to_owned(),
			Backend::Local => "serve 未应答，已回落本地 PTY".to_owned(),
		})
	}

	/// The full reason the pane is not on serve, for the status line's
	/// tooltip. `None` when the pane is on serve or never tried it.
	pub fn reason(&self, tab: &str) -> Option<&str> {
		self.panes.get(tab)?.reason.as_deref()
	}

	/// True when this tab must use [`crate::live`]'s in-process PTY.
	pub fn is_local(&self, tab: &str) -> bool {
		self
			.panes
			.get(tab)
			.is_some_and(|pane| pane.backend == Backend::Local)
	}

	/// Render a service-backed tab. `false` means this tab has no remote
	/// screen, so the caller should fall through to the local PTY.
	pub fn render(&self, tab: &str, area: Rect, buf: &mut Buffer) -> bool {
		match self.panes.get(tab).and_then(|pane| pane.service.as_ref()) {
			Some(service) => {
				service.render(area, buf);
				true
			},
			None => false,
		}
	}

	/// Send stdin through serve. `true` means the event was consumed, whether
	/// the socket is live or the pane is still connecting.
	pub fn send_bytes(&mut self, tab: &str, bytes: &[u8]) -> bool {
		let Some(pane) = self.panes.get_mut(tab) else {
			return false;
		};
		if pane.backend == Backend::Local {
			return false;
		}
		if let Some(service) = pane.service.as_ref() {
			service.send_bytes(bytes);
		}
		true
	}

	/// Drain every attach thread once. A transport failure drops the remote
	/// screen and moves the tab to `Local`; the reason is kept for the status
	/// line and never retried in a loop.
	pub fn poll(&mut self) -> Vec<HostEvent> {
		let mut out = Vec::new();
		for (tab, pane) in &mut self.panes {
			let Some(service) = pane.service.as_mut() else {
				continue;
			};
			for event in service.poll() {
				match event {
					Event::Opened => {
						if pane.backend == Backend::Connecting {
							pane.backend = Backend::Service;
						}
						out.push(HostEvent::Opened { tab: tab.clone() });
					},
					Event::Output => out.push(HostEvent::Output { tab: tab.clone() }),
					Event::Ended(reason) => {
						pane.backend = Backend::Ended;
						pane.reason = Some(reason.clone());
						out.push(HostEvent::Ended { tab: tab.clone(), reason });
					},
					Event::Failed(reason) => {
						pane.service = None;
						pane.backend = Backend::Local;
						pane.reason = Some(reason);
						out.push(HostEvent::Failed { tab: tab.clone() });
					},
				}
			}
		}
		out
	}

	/// Forget tabs that no longer exist (dropping their WebSocket).
	pub fn retain(&mut self, open: &[String]) {
		self.panes.retain(|tab, _| open.iter().any(|id| id == tab));
	}
}

/// The gateway requires `[A-Za-z0-9._-]{1,64}`; a session tab id already is.
fn instance_id(tab: &str) -> String {
	let cleaned: String = tab
		.chars()
		.filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
		.take(64)
		.collect();
	if cleaned.is_empty() {
		"default".to_owned()
	} else {
		cleaned
	}
}

/// A minimal VT screen: enough of ECMA-48 for a shell and full-screen TUIs.
///
/// This is deliberately not a second terminal emulator: colours, mouse modes
/// and the alternate screen's contents are not modelled, only what the pane
/// has to draw — the grid, the cursor and scrolling. Bytes arrive in whatever
/// chunk boundaries the WebSocket picked, so the parser keeps its partial
/// escape and UTF-8 state across calls.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Parser {
	Ground,
	Escape,
	Csi,
	Osc,
	OscEscape,
}

struct Screen {
	cols: usize,
	rows: usize,
	cells: Vec<Vec<char>>,
	cursor_x: usize,
	cursor_y: usize,
	wrapped: bool,
	saved: (usize, usize),
	parser: Parser,
	csi: Vec<u8>,
	utf8: Vec<u8>,
}

impl Screen {
	fn new(cols: usize, rows: usize) -> Self {
		let cols = cols.max(1);
		let rows = rows.max(1);
		Self {
			cols,
			rows,
			cells: vec![vec![' '; cols]; rows],
			cursor_x: 0,
			cursor_y: 0,
			wrapped: false,
			saved: (0, 0),
			parser: Parser::Ground,
			csi: Vec::new(),
			utf8: Vec::new(),
		}
	}

	/// Keep the top-left of the old grid when the pane resizes.
	fn resize(&mut self, cols: usize, rows: usize) {
		let cols = cols.max(1);
		let rows = rows.max(1);
		if (cols, rows) == (self.cols, self.rows) {
			return;
		}
		let mut cells = vec![vec![' '; cols]; rows];
		for (row, cells_row) in cells.iter_mut().enumerate().take(rows) {
			if let Some(old) = self.cells.get(row) {
				for (col, cell) in cells_row.iter_mut().enumerate().take(cols) {
					if let Some(&old_cell) = old.get(col) {
						*cell = old_cell;
					}
				}
			}
		}
		self.cells = cells;
		self.cols = cols;
		self.rows = rows;
		self.cursor_x = self.cursor_x.min(cols - 1);
		self.cursor_y = self.cursor_y.min(rows - 1);
		self.wrapped = false;
	}

	fn feed(&mut self, bytes: &[u8]) {
		for &byte in bytes {
			self.byte(byte);
		}
	}

	fn byte(&mut self, byte: u8) {
		match self.parser {
			Parser::Ground => self.ground(byte),
			Parser::Escape => match byte {
				b'[' => {
					self.csi.clear();
					self.parser = Parser::Csi;
				},
				b']' => self.parser = Parser::Osc,
				_ => self.parser = Parser::Ground,
			},
			Parser::Csi => {
				if (0x40..=0x7e).contains(&byte) {
					let params = std::mem::take(&mut self.csi);
					self.parser = Parser::Ground;
					self.csi_dispatch(byte, &params);
				} else if self.csi.len() < 64 {
					self.csi.push(byte);
				} else {
					self.parser = Parser::Ground;
				}
			},
			Parser::Osc => {
				if byte == 0x07 {
					self.parser = Parser::Ground;
				} else if byte == 0x1b {
					self.parser = Parser::OscEscape;
				}
			},
			Parser::OscEscape => {
				self.parser = if byte == b'\\' {
					Parser::Ground
				} else {
					Parser::Osc
				};
			},
		}
	}

	fn ground(&mut self, byte: u8) {
		match byte {
			0x1b => {
				self.flush_utf8();
				self.parser = Parser::Escape;
			},
			0x07 => {},
			0x08 => {
				self.flush_utf8();
				self.wrapped = false;
				self.cursor_x = self.cursor_x.saturating_sub(1);
			},
			0x09 => {
				self.flush_utf8();
				self.wrapped = false;
				self.cursor_x = ((self.cursor_x / 8) + 1) * 8;
				if self.cursor_x >= self.cols {
					self.cursor_x = self.cols - 1;
				}
			},
			0x0a..=0x0c => {
				self.flush_utf8();
				self.linefeed();
			},
			0x0d => {
				self.flush_utf8();
				self.wrapped = false;
				self.cursor_x = 0;
			},
			byte if byte < 0x20 => {},
			byte if byte < 0x80 => {
				self.flush_utf8();
				self.put(byte as char);
			},
			byte => {
				self.utf8.push(byte);
				self.decode_utf8();
			},
		}
	}

	fn decode_utf8(&mut self) {
		match std::str::from_utf8(&self.utf8) {
			Ok(text) => {
				let text = text.to_owned();
				self.utf8.clear();
				for ch in text.chars() {
					self.put(ch);
				}
			},
			Err(error) if error.error_len().is_none() && self.utf8.len() < 4 => {},
			Err(_) => {
				self.utf8.clear();
				self.put('\u{fffd}');
			},
		}
	}

	fn flush_utf8(&mut self) {
		if self.utf8.is_empty() {
			return;
		}
		let text = String::from_utf8_lossy(&self.utf8).into_owned();
		self.utf8.clear();
		for ch in text.chars() {
			self.put(ch);
		}
	}

	fn put(&mut self, ch: char) {
		let width = UnicodeWidthChar::width(ch).unwrap_or(0);
		if width == 0 {
			return;
		}
		if self.wrapped {
			self.wrapped = false;
			self.cursor_x = 0;
			self.linefeed();
		}
		if self.cursor_x + width > self.cols {
			self.cursor_x = 0;
			self.linefeed();
		}
		if self.cursor_y < self.rows && self.cursor_x < self.cols {
			self.cells[self.cursor_y][self.cursor_x] = ch;
			for offset in 1..width {
				if self.cursor_x + offset < self.cols {
					self.cells[self.cursor_y][self.cursor_x + offset] = ' ';
				}
			}
		}
		self.cursor_x += width;
		if self.cursor_x >= self.cols {
			self.cursor_x = self.cols - 1;
			self.wrapped = true;
		}
	}

	fn linefeed(&mut self) {
		self.wrapped = false;
		if self.cursor_y + 1 >= self.rows {
			self.scroll_up(1);
		} else {
			self.cursor_y += 1;
		}
	}

	fn scroll_up(&mut self, lines: usize) {
		for _ in 0..lines.min(self.rows) {
			self.cells.remove(0);
			self.cells.push(vec![' '; self.cols]);
		}
	}

	fn scroll_down(&mut self, lines: usize) {
		for _ in 0..lines.min(self.rows) {
			self.cells.pop();
			self.cells.insert(0, vec![' '; self.cols]);
		}
	}

	fn csi_dispatch(&mut self, final_byte: u8, raw: &[u8]) {
		let private = raw.first() == Some(&b'?');
		let params: Vec<usize> = String::from_utf8_lossy(raw)
			.trim_start_matches('?')
			.split(';')
			.map(|part| part.split(':').next().unwrap_or("").parse().unwrap_or(0))
			.collect();
		let first = params.first().copied().unwrap_or(0);
		let count = first.max(1);
		match final_byte {
			b'A' => self.cursor_y = self.cursor_y.saturating_sub(count),
			b'B' => self.cursor_y = (self.cursor_y + count).min(self.rows - 1),
			b'C' => self.cursor_x = (self.cursor_x + count).min(self.cols - 1),
			b'D' => self.cursor_x = self.cursor_x.saturating_sub(count),
			b'E' => {
				self.cursor_x = 0;
				self.cursor_y = (self.cursor_y + count).min(self.rows - 1);
			},
			b'F' => {
				self.cursor_x = 0;
				self.cursor_y = self.cursor_y.saturating_sub(count);
			},
			b'G' => self.cursor_x = count.saturating_sub(1).min(self.cols - 1),
			b'd' => self.cursor_y = count.saturating_sub(1).min(self.rows - 1),
			b'H' | b'f' => {
				let row = params.first().copied().unwrap_or(1).max(1);
				let col = params.get(1).copied().unwrap_or(1).max(1);
				self.cursor_y = (row - 1).min(self.rows - 1);
				self.cursor_x = (col - 1).min(self.cols - 1);
			},
			b'J' => self.erase_display(first),
			b'K' => self.erase_line(first),
			b'L' => self.insert_lines(count),
			b'M' => self.delete_lines(count),
			b'P' => self.delete_chars(count),
			b'@' => self.insert_chars(count),
			b'S' => self.scroll_up(count),
			b'T' => self.scroll_down(count),
			b's' => self.saved = (self.cursor_x, self.cursor_y),
			b'u' => {
				let (x, y) = self.saved;
				self.cursor_x = x.min(self.cols - 1);
				self.cursor_y = y.min(self.rows - 1);
			},
			// Private modes: the alternate screen is cleared on entry/exit, but
			// its save/restore is not modelled and SGR colours are not drawn.
			b'h' | b'l' if private => {
				if raw.windows(4).any(|window| window == b"1049".as_slice()) {
					self.clear();
				}
			},
			b'm' | b'h' | b'l' | b'r' | b'n' | b'c' => {},
			_ => {},
		}
	}

	fn erase_display(&mut self, mode: usize) {
		match mode {
			0 => {
				self.erase_line(0);
				for row in self.cursor_y + 1..self.rows {
					self.cells[row].fill(' ');
				}
			},
			1 => {
				self.erase_line(1);
				for row in 0..self.cursor_y {
					self.cells[row].fill(' ');
				}
			},
			_ => {
				for row in &mut self.cells {
					row.fill(' ');
				}
			},
		}
	}

	fn erase_line(&mut self, mode: usize) {
		let (from, to) = match mode {
			0 => (self.cursor_x, self.cols),
			1 => (0, self.cursor_x + 1),
			_ => (0, self.cols),
		};
		self.cells[self.cursor_y][from.min(self.cols)..to.min(self.cols)].fill(' ');
	}

	fn insert_lines(&mut self, count: usize) {
		for _ in 0..count.min(self.rows) {
			self.cells.insert(self.cursor_y, vec![' '; self.cols]);
			self.cells.truncate(self.rows);
		}
	}

	fn delete_lines(&mut self, count: usize) {
		for _ in 0..count.min(self.rows) {
			if self.cursor_y < self.cells.len() {
				self.cells.remove(self.cursor_y);
				self.cells.push(vec![' '; self.cols]);
			}
		}
	}

	fn insert_chars(&mut self, count: usize) {
		let row = &mut self.cells[self.cursor_y];
		for _ in 0..count.min(self.cols) {
			row.insert(self.cursor_x, ' ');
			row.truncate(self.cols);
		}
	}

	fn delete_chars(&mut self, count: usize) {
		let row = &mut self.cells[self.cursor_y];
		for _ in 0..count.min(self.cols) {
			row.remove(self.cursor_x);
			row.push(' ');
		}
	}

	fn clear(&mut self) {
		for row in &mut self.cells {
			row.fill(' ');
		}
	}

	fn render(&self, area: Rect, buf: &mut Buffer) {
		for y in 0..area.height as usize {
			for x in 0..area.width as usize {
				let ch = self
					.cells
					.get(y)
					.and_then(|row| row.get(x))
					.copied()
					.unwrap_or(' ');
				let mut encoded = [0u8; 4];
				let symbol = ch.encode_utf8(&mut encoded);
				buf[(area.x + x as u16, area.y + y as u16)].set_symbol(symbol);
			}
		}
	}

	#[cfg(test)]
	fn line(&self, row: usize) -> String {
		self
			.cells
			.get(row)
			.map(|cells| cells.iter().collect::<String>().trim_end().to_owned())
			.unwrap_or_default()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_zero_prefixed_frame_is_control_and_everything_else_is_pty_bytes() {
		let control = [
			0u8, b'{', b'"', b'r', b'e', b'p', b'l', b'a', b'y', b'e', b'd', b'B', b'y', b't', b'e',
			b's', b'"', b':', b'7', b'}',
		];
		assert_eq!(decode_frame(&control), Inbound::Control(json!({ "replayedBytes": 7 })));
		let raw = b"\x1b[31mhello\r\n";
		assert_eq!(decode_frame(raw), Inbound::Data(raw.to_vec()));
		// A 0x00 inside a PTY stream only means control when it is the first
		// byte; a later one stays data.
		let embedded = b"a\x00b";
		assert_eq!(decode_frame(embedded), Inbound::Data(embedded.to_vec()));
		// Malformed control JSON is an empty control frame, never a panic.
		assert_eq!(decode_frame(&[0u8, b'{']), Inbound::Control(Value::Object(Default::default())));
	}

	#[test]
	fn the_attach_answer_names_the_session_and_its_ticket() {
		let attach =
			parse_attach(r#"{"id":"term-12345678","ticket":"tok","reused":true}"#).expect("attach");
		assert_eq!(attach.id, "term-12345678");
		assert_eq!(attach.ticket.as_deref(), Some("tok"));
		// A loopback attach may need no ticket.
		let loopback = parse_attach(r#"{"id":"term-12345678"}"#).expect("attach");
		assert_eq!(loopback.ticket, None);
		// An error answer names no session.
		assert!(parse_attach(r#"{"error":"terminal limit reached"}"#).is_none());
		assert!(parse_attach("not json").is_none());
		// The older wrapper shape is read the same way.
		let nested =
			parse_attach(r#"{"ok":true,"session":{"id":"s1"},"ticket":"t"}"#).expect("nested");
		assert_eq!(nested.id, "s1");
		assert_eq!(nested.ticket.as_deref(), Some("t"));
	}

	#[test]
	fn the_websocket_path_carries_a_ticket_only_when_serve_issued_one() {
		assert_eq!(ws_path("term-1", None), "/api/terminal/term-1/ws");
		assert_eq!(ws_path("term-1", Some("")), "/api/terminal/term-1/ws");
		assert_eq!(ws_path("term-1", Some("abc")), "/api/terminal/term-1/ws?ticket=abc");
	}

	#[test]
	fn raw_bytes_feed_the_screen_and_csi_moves_the_cursor() {
		let mut screen = Screen::new(20, 3);
		screen.feed(b"one\r\ntwo\x1b[2;3HX");
		assert_eq!(screen.line(0), "one");
		assert_eq!(screen.line(1), "twX");
		// Erase-display and cursor-home are the two sequences a shell uses on
		// every prompt redraw.
		screen.feed(b"\x1b[2J\x1b[HZ");
		assert_eq!(screen.line(0), "Z");
		assert_eq!(screen.line(1), "");
	}

	#[test]
	fn a_full_screen_scrolls_instead_of_running_off_the_grid() {
		let mut screen = Screen::new(8, 2);
		screen.feed(b"a\r\nb\r\nc");
		assert_eq!(screen.line(0), "b");
		assert_eq!(screen.line(1), "c");
	}

	#[test]
	fn without_an_origin_the_tab_falls_back_to_the_local_pty_once() {
		let mut host = TerminalHost::default();
		host.ensure("tab1", None, None, 80, 24);
		assert!(host.is_local("tab1"), "no serve origin means the local PTY");
		assert_eq!(
			host.label("tab1").expect("label"),
			"serve 未应答，已回落本地 PTY",
			"the status line is one short sentence"
		);
		let reason = host.reason("tab1").expect("the reason is kept");
		assert!(reason.contains("serve.json"), "the tooltip names the cause: {reason}");
		let area = Rect::new(0, 0, 80, 24);
		assert!(!host.render("tab1", area, &mut Buffer::empty(area)));
		assert!(!host.send_bytes("tab1", b"x"), "local stdin is not serve's");
	}

	#[test]
	fn a_transport_failure_collapses_to_the_same_sentence_and_keeps_the_raw_reason() {
		let mut host = TerminalHost::default();
		// A service-backed pane whose socket dies: the test pushes the
		// failure through the same state `poll` takes.
		host.ensure("tab1", Some("ws://127.0.0.1:9/term"), None, 80, 24);
		assert_eq!(host.label("tab1").as_deref(), Some("后端：serve · 连接中…"));
		let raw = "serve 拒绝终端 attach（400）：cwd does not exist";
		let pane = host.panes.get_mut("tab1").expect("pane");
		pane.backend = Backend::Local;
		pane.reason = Some(raw.to_owned());
		assert_eq!(host.label("tab1").as_deref(), Some("serve 未应答，已回落本地 PTY"));
		assert_eq!(host.reason("tab1"), Some(raw), "the tooltip keeps the raw reason");
	}
}
