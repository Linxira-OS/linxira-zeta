// SPDX-License-Identifier: AGPL-3.0-only
//! The shell's agent-session panes: one SSE link per [`SessionKind::Agent`]
//! tab, polled from the frame loop.
//!
//! [`crate::agent`] is the pure reducer and [`crate::agent_events`] is the
//! transport; this module is the piece in between. It owns, per session-tab id:
//!
//! * the [`SessionView`] the pane draws,
//! * the [`AgentEvents`] reader (a background thread; [`poll`] never blocks),
//! * the link state, so the pane can tell "connecting" from "the stream ended"
//!   from "serve refused the connection",
//! * the last `extension_ui_request`, even after it was resolved, because the
//!   pane's summary is about the most recent request the gateway asked.
//!
//! Nothing here invents a session id: a pane starts empty and the user types
//! the id the gateway knows. A refused connection is a [`Link::Failed`] with
//! the transport's own message, never a panic and never a blocking connect on
//! the UI thread.
//!
//! [`SessionKind::Agent`]: crate::state::SessionKind::Agent
//! [`poll`]: AgentSessions::poll

use crate::t;
use std::collections::BTreeMap;

use serde_json::Value;

use crate::{
	agent::{Effect, Frame, SessionView},
	agent_events::{AgentEvents, Event},
	notify::{Message, Trigger},
};

/// The link between one pane and the gateway.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Link {
	/// No session id has been supplied yet.
	Detached,
	/// `AgentEvents::connect` was accepted; the background thread is dialling.
	Connecting,
	/// At least one frame has arrived.
	Live,
	/// The stream ended after it was live (the gateway closed it).
	Ended,
	/// The stream never became live, or the origin was refused. Carries the
	/// transport's reason.
	Failed(String),
}

impl Link {
	/// The short word the pane's header and the TUI box show.
	pub fn label(&self) -> &'static str {
		match self {
			Self::Detached => t!("未连接"),
			Self::Connecting => t!("连接中"),
			Self::Live => t!("已连接"),
			Self::Ended => t!("流已结束"),
			Self::Failed(_) => t!("连接失败"),
		}
	}

	/// True while a frame may still arrive, so the caller keeps a slow repaint
	/// scheduled.
	pub fn is_watching(&self) -> bool {
		matches!(self, Self::Connecting | Self::Live)
	}
}

/// One agent page's live state.
pub struct AgentPane {
	/// The gateway session the pane is attached to.
	pub session: Option<String>,
	/// The editable id; `connect` copies this into `session`.
	pub draft: String,
	/// The reducer's view of the stream.
	pub view: SessionView,
	/// The usage blocks the stream delivered since this pane attached. The
	/// transcript file is the complete record; this is the live fallback for
	/// the 用量 page while a session is running.
	pub usage: crate::conversation::UsageSummary,
	/// The transport state.
	pub link: Link,
	/// Why the link is not live, when there is a reason to show.
	pub error: Option<String>,
	/// The most recent `extension_ui_request`, resolved or not.
	last_request: Option<Value>,
	events: Option<AgentEvents>,
}

impl Default for AgentPane {
	fn default() -> Self {
		Self {
			session: None,
			draft: String::new(),
			view: SessionView::default(),
			usage: crate::conversation::UsageSummary::default(),
			link: Link::Detached,
			error: None,
			last_request: None,
			events: None,
		}
	}
}

impl AgentPane {
	/// Attach to `session` on `origin` (`http://127.0.0.1:PORT`).
	///
	/// The connection itself runs on the reader's thread, so this returns as
	/// soon as the thread is spawned. Only a malformed origin or an empty
	/// session id fails synchronously; a refused socket arrives later as
	/// [`Event::Failed`] and is recorded by [`AgentSessions::poll`].
	pub fn connect(&mut self, origin: &str, session: &str) -> Result<(), String> {
		let session = session.trim();
		if session.is_empty() {
			let reason = t!("会话 id 为空").to_owned();
			self.error = Some(reason.clone());
			self.link = Link::Failed(reason.clone());
			return Err(reason);
		}
		// A new attachment is a new stream: the old view would describe another
		// session.
		self.events = None;
		self.view = SessionView::default();
		self.usage = crate::conversation::UsageSummary::default();
		self.last_request = None;
		self.error = None;
		self.session = Some(session.to_owned());
		self.draft = session.to_owned();
		self.link = Link::Connecting;
		match AgentEvents::connect(origin, session) {
			Ok(events) => {
				self.events = Some(events);
				Ok(())
			},
			Err(reason) => {
				self.link = Link::Failed(reason.clone());
				self.error = Some(reason.clone());
				Err(reason)
			},
		}
	}

	/// Stop reading. The pane keeps its transcript and the link is detached.
	pub fn disconnect(&mut self) {
		self.events = None;
		self.link = Link::Detached;
		self.view.connected = false;
		self.view.running = false;
		self.view.pending = None;
	}

	/// The summary the pane draws for the most recent `extension_ui_request`.
	pub fn request_summary(&self) -> Option<String> {
		self
			.last_request
			.as_ref()
			.map(summarize_request)
			.or_else(|| self.view.pending.as_ref().map(summarize_request))
	}

	/// Is this pane still reading (or about to)? The left column's agent row
	/// draws its dot from this, so a session nobody watches does not look
	/// live.
	pub fn is_live(&self) -> bool {
		self.events.is_some() || self.link.is_watching()
	}

	/// True while the gateway is waiting for the user.
	pub fn awaiting_input(&self) -> bool {
		self.view.pending.is_some()
	}

	/// `running` / `not-running` while live, else the link's own word.
	pub fn status_line(&self) -> String {
		match self.link {
			Link::Live => {
				if self.view.running {
					"running".to_owned()
				} else {
					"not-running".to_owned()
				}
			},
			_ => self.link.label().to_owned(),
		}
	}
}

/// One reducer effect, tagged with the session tab it belongs to.
#[derive(Clone, Debug, PartialEq)]
pub struct AgentUpdate {
	pub tab: String,
	pub session: String,
	pub effect: Effect,
}

impl AgentUpdate {
	/// The notification this effect asks for, if it asks for one.
	///
	/// The body comes from the reducer; the title names the session, so two
	/// agent panes waiting at once are told apart in the notification centre.
	pub fn notification(&self, target: Option<String>) -> Option<Message> {
		let Effect::Notify { trigger, body } = &self.effect else {
			return None;
		};
		let session = if self.session.is_empty() {
			t!("（未命名会话）")
		} else {
			self.session.as_str()
		};
		let title = match trigger {
			Trigger::NeedsInput => t!("Agent {} 等待你的输入", session),
			Trigger::Idle => t!("Agent {} 已跑完", session),
			Trigger::Failed => t!("Agent {} 失败或结束", session),
		};
		Some(Message { trigger: *trigger, title, body: body.clone(), target })
	}
}

/// Every agent pane the shell owns, keyed by session-tab id.
#[derive(Default)]
pub struct AgentSessions {
	panes: BTreeMap<String, AgentPane>,
}

impl AgentSessions {
	/// The pane for `tab`, creating an empty one on first use.
	pub fn ensure(&mut self, tab: &str) -> &mut AgentPane {
		self.panes.entry(tab.to_owned()).or_default()
	}

	pub fn pane(&self, tab: &str) -> Option<&AgentPane> {
		self.panes.get(tab)
	}

	pub fn pane_mut(&mut self, tab: &str) -> Option<&mut AgentPane> {
		self.panes.get_mut(tab)
	}

	/// Forget panes whose session tab is gone.
	pub fn retain(&mut self, open: &[String]) {
		self.panes.retain(|tab, _| open.iter().any(|id| id == tab));
	}

	/// Attach the pane for `tab` to a gateway session.
	pub fn connect(&mut self, tab: &str, origin: &str, session: &str) -> Result<(), String> {
		self.ensure(tab).connect(origin, session)
	}

	/// Is any pane still expecting frames? The frame loop then schedules a slow
	/// repaint even with no input.
	pub fn is_watching(&self) -> bool {
		self.panes.values().any(AgentPane::is_live)
	}

	/// Drain every reader once and reduce the frames.
	///
	/// This is non-blocking: [`AgentEvents::drain`] is `try_iter`. The returned
	/// effects are the shell's work list — a repaint, or one notification per
	/// `needs input` / `not-running` edge.
	pub fn poll(&mut self) -> Vec<AgentUpdate> {
		let mut updates = Vec::new();
		for (tab, pane) in &mut self.panes {
			let events: Vec<Event> = pane
				.events
				.as_ref()
				.map(AgentEvents::drain)
				.unwrap_or_default();
			let mut closed = false;
			for event in events {
				match event {
					Event::Frame(frame) => {
						if let Frame::UiRequest(request) = &frame {
							pane.last_request = Some(request.clone());
						}
						if let Frame::SessionEntry(entry) = &frame {
							pane.usage.observe(entry);
						}
						pane.link = Link::Live;
						pane.error = None;
						for effect in pane.view.apply(frame) {
							updates.push(AgentUpdate {
								tab: tab.clone(),
								session: pane.session.clone().unwrap_or_default(),
								effect,
							});
						}
					},
					Event::Closed => {
						let was_live = pane.link == Link::Live;
						let reason = if was_live {
							t!("事件流已结束").to_owned()
						} else {
							t!("事件流已关闭（serve 未返回 200，或连接提前断开）").to_owned()
						};
						pane.link = if was_live {
							Link::Ended
						} else {
							Link::Failed(reason.clone())
						};
						pane.error = Some(reason);
						closed = true;
						updates.push(AgentUpdate {
							tab: tab.clone(),
							session: pane.session.clone().unwrap_or_default(),
							effect: Effect::Repaint,
						});
					},
					Event::Failed(reason) => {
						pane.link = Link::Failed(reason.clone());
						pane.error = Some(reason);
						closed = true;
						updates.push(AgentUpdate {
							tab: tab.clone(),
							session: pane.session.clone().unwrap_or_default(),
							effect: Effect::Repaint,
						});
					},
				}
			}
			if closed {
				pane.events = None;
			}
		}
		updates
	}
}

/// One line describing an `extension_ui_request`: its method, its title (or
/// prompt) and its id, in the order a reader needs them.
fn summarize_request(request: &Value) -> String {
	let method = request
		.get("method")
		.and_then(Value::as_str)
		.unwrap_or("extension_ui_request");
	let title = request
		.get("title")
		.or_else(|| request.get("prompt"))
		.or_else(|| request.get("message"))
		.and_then(Value::as_str);
	let id = request.get("id").and_then(Value::as_str);
	let mut summary = method.to_owned();
	if let Some(title) = title.filter(|title| !title.trim().is_empty()) {
		summary.push_str(" · ");
		summary.push_str(title);
	}
	if let Some(id) = id.filter(|id| !id.is_empty()) {
		summary.push_str(&format!(" · id {id}"));
	}
	summary
}

/// Send one prompt to `session` on `origin` (`http://127.0.0.1:PORT`).
///
/// `POST /api/agent/{session}` with the web UI's own command body —
/// `{"type":"prompt","message":…}` — so the agent receives exactly what the web
/// composer would have sent, built-in slash-command handling included. Blocking
/// by design: the caller runs it on a worker, never on the frame loop.
pub fn send_prompt(origin: &str, session: &str, message: &str) -> Result<(), String> {
	let address = origin
		.strip_prefix("http://")
		.ok_or_else(|| format!("not a loopback origin: {origin}"))?
		.trim_end_matches('/')
		.to_owned();
	let session = session.trim();
	if session.is_empty() {
		return Err(t!("会话 id 为空").to_owned());
	}
	let message = message.trim();
	if message.is_empty() {
		return Err(t!("内容是空的").to_owned());
	}
	let body = serde_json::json!({ "type": "prompt", "message": message }).to_string();
	let answer = post(&address, &format!("/api/agent/{}", encode_path(session)), &body)?;
	let reply: Value =
		serde_json::from_str(&answer).map_err(|error| t!("后端回答不是 JSON：{}", error))?;
	if reply.get("success").and_then(Value::as_bool) == Some(true) && reply.get("error").is_none() {
		return Ok(());
	}
	Err(
		reply
			.get("error")
			.and_then(Value::as_str)
			.unwrap_or("the backend refused the prompt")
			.to_owned(),
	)
}

/// One prompt at a time, sent from a worker thread.
///
/// A second Enter while a send is in flight is refused instead of queued: the
/// line keeps its text, so nothing typed is lost.
#[derive(Default)]
pub struct PromptSender {
	pending: Option<std::sync::mpsc::Receiver<Result<(), String>>>,
}

impl PromptSender {
	pub fn busy(&self) -> bool {
		self.pending.is_some()
	}

	/// Start a send. `false` when one is already in flight.
	pub fn send(&mut self, origin: String, session: String, message: String) -> bool {
		if self.pending.is_some() {
			return false;
		}
		let (sender, receiver) = std::sync::mpsc::channel();
		std::thread::spawn(move || {
			let _ = sender.send(send_prompt(&origin, &session, &message));
		});
		self.pending = Some(receiver);
		true
	}

	/// The finished send's outcome, once.
	pub fn poll(&mut self) -> Option<Result<(), String>> {
		let result = self.pending.as_ref()?.try_recv().ok()?;
		self.pending = None;
		Some(result)
	}
}

/// One blocking request/response over the gateway's own loopback socket.
fn post(address: &str, path: &str, body: &str) -> Result<String, String> {
	use std::{
		io::{Read, Write},
		net::TcpStream,
	};

	let mut stream =
		TcpStream::connect(address).map_err(|error| t!("连接 {} 失败：{}", address, error))?;
	let request = format!(
		"POST {path} HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
		body.len()
	);
	stream
		.write_all(request.as_bytes())
		.map_err(|error| t!("写入请求失败：{}", error))?;
	let mut raw = Vec::new();
	stream
		.read_to_end(&mut raw)
		.map_err(|error| t!("读取回答失败：{}", error))?;
	let text = String::from_utf8_lossy(&raw);
	let (head, body) = text
		.split_once("\r\n\r\n")
		.ok_or_else(|| t!("后端没有给出完整的回答").to_owned())?;
	let status = head.lines().next().unwrap_or_default();
	if !(status.contains(" 200") || status.contains(" 201")) {
		return Err(status.to_owned());
	}
	if head
		.to_ascii_lowercase()
		.contains("transfer-encoding: chunked")
	{
		Ok(decode_chunked(body))
	} else {
		Ok(body.to_owned())
	}
}

/// Undo `Transfer-Encoding: chunked` (Bun answers with it, see `agent_events`).
fn decode_chunked(body: &str) -> String {
	let mut rest = body.as_bytes();
	let mut out: Vec<u8> = Vec::new();
	loop {
		let Some(end) = rest.windows(2).position(|window| window == b"\r\n") else {
			break;
		};
		let Ok(size) =
			usize::from_str_radix(std::str::from_utf8(&rest[..end]).unwrap_or("").trim(), 16)
		else {
			break;
		};
		rest = &rest[end + 2..];
		if size == 0 || rest.len() < size {
			break;
		}
		out.extend_from_slice(&rest[..size]);
		rest = &rest[size..];
		if rest.starts_with(b"\r\n") {
			rest = &rest[2..];
		}
	}
	String::from_utf8_lossy(&out).into_owned()
}

/// Percent-encode one path segment: session ids are slugs today, but the URL is
/// the backend's contract, not this module's.
fn encode_path(segment: &str) -> String {
	let mut out = String::with_capacity(segment.len());
	for byte in segment.bytes() {
		match byte {
			b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
				out.push(byte as char)
			},
			_ => out.push_str(&format!("%{byte:02X}")),
		}
	}
	out
}

#[cfg(test)]
mod tests {
	use std::{
		io::{Read, Write},
		net::{Shutdown, TcpListener},
		thread,
		time::{Duration, Instant},
	};

	use super::*;

	/// One fake SSE endpoint: answers with a plain (non-chunked) body carrying
	/// `frames`, then half-closes so the reader sees the stream end.
	fn fake_serve(frames: &'static str) -> String {
		let listener = TcpListener::bind("127.0.0.1:0").expect("bind a loopback port");
		let address = listener.local_addr().expect("addr").to_string();
		thread::spawn(move || {
			let (mut socket, _) = listener.accept().expect("accept");
			let mut request = [0u8; 1024];
			let _ = socket.read(&mut request);
			let head =
				"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
			socket.write_all(head.as_bytes()).expect("head");
			socket.write_all(frames.as_bytes()).expect("frames");
			let _ = socket.shutdown(Shutdown::Write);
			thread::sleep(Duration::from_millis(200));
		});
		format!("http://{address}")
	}

	fn poll_until(
		sessions: &mut AgentSessions,
		deadline: Instant,
		mut done: impl FnMut(&[AgentUpdate]) -> bool,
	) -> Vec<AgentUpdate> {
		let mut updates = Vec::new();
		while Instant::now() < deadline {
			updates.extend(sessions.poll());
			if done(&updates) {
				break;
			}
			thread::sleep(Duration::from_millis(10));
		}
		updates
	}

	fn count(updates: &[AgentUpdate], trigger: Trigger) -> usize {
		updates
			.iter()
			.filter(
				|update| matches!(&update.effect, Effect::Notify { trigger: seen, .. } if *seen == trigger),
			)
			.count()
	}

	#[test]
	fn a_frame_from_a_fake_serve_reaches_the_reducer_and_its_effect() {
		let origin = fake_serve(
			"data: {\"type\":\"extension_ui_request\",\"id\":\"r1\",\"method\":\"confirm\",\"title\":\
			 \"允许执行？\"}\n\n",
		);
		let mut sessions = AgentSessions::default();
		sessions.connect("t1", &origin, "s1").expect("thread start");
		let updates = poll_until(&mut sessions, Instant::now() + Duration::from_secs(3), |updates| {
			updates.iter().any(|update| match &update.effect {
				Effect::Notify { trigger, .. } => *trigger == Trigger::NeedsInput,
				_ => false,
			})
		});
		let pane = sessions.pane("t1").expect("pane");
		assert!(pane.view.pending.is_some(), "the reducer holds the request");
		assert!(pane.awaiting_input());
		assert!(
			pane
				.request_summary()
				.is_some_and(|summary| summary.contains("允许执行？")),
			"the most recent request is summarized"
		);
		// The fake serve half-closes after the frame, so the pane may already
		// have reduced the EOF too; both are a live-then-closed transport.
		assert!(matches!(pane.link, Link::Live | Link::Ended), "{:?}", pane.link);
		assert!(
			updates
				.iter()
				.any(|update| update.effect == Effect::Repaint),
			"{updates:?}"
		);
		assert_eq!(count(&updates, Trigger::NeedsInput), 1, "{updates:?}");
		assert!(
			updates
				.iter()
				.filter_map(|update| update.notification(None))
				.any(|message| message.title.contains("等待你的输入")),
			"the update maps to a notification"
		);
	}

	#[test]
	fn needs_input_and_the_finished_edge_each_notify_exactly_once() {
		let origin = fake_serve(
			"data: {\"type\":\"connected\",\"sessionId\":\"s1\"}\n\ndata: \
			 {\"type\":\"running\"}\n\ndata: \
			 {\"type\":\"extension_ui_request\",\"id\":\"r1\",\"method\":\"confirm\",\"title\":\"\
			 允许执行？\"}\n\ndata: {\"type\":\"not-running\"}\n\n",
		);
		let mut sessions = AgentSessions::default();
		sessions.connect("t1", &origin, "s1").expect("thread start");
		let updates = poll_until(&mut sessions, Instant::now() + Duration::from_secs(3), |updates| {
			count(updates, Trigger::NeedsInput) == 1 && count(updates, Trigger::Idle) == 1
		});
		assert_eq!(count(&updates, Trigger::NeedsInput), 1, "{updates:?}");
		assert_eq!(count(&updates, Trigger::Idle), 1, "{updates:?}");
		let notices: Vec<Message> = updates
			.iter()
			.filter_map(|update| update.notification(None))
			.collect();
		assert_eq!(notices.len(), 2, "{notices:?}");
		assert_eq!(notices[0].trigger, Trigger::NeedsInput);
		assert_eq!(notices[1].trigger, Trigger::Idle);
	}

	#[test]
	fn a_refused_connection_is_reported_without_panicking() {
		// Bind a port and drop the listener: a connect to that address is
		// refused on loopback, with no network involved.
		let address = {
			let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
			listener.local_addr().expect("addr").to_string()
		};
		let mut sessions = AgentSessions::default();
		sessions
			.connect("t1", &format!("http://{address}"), "s1")
			.expect("the connect runs on the reader thread");
		let deadline = Instant::now() + Duration::from_secs(3);
		let mut updates = Vec::new();
		while Instant::now() < deadline {
			updates.extend(sessions.poll());
			if matches!(sessions.pane("t1").expect("pane").link, Link::Failed(_)) {
				break;
			}
			thread::sleep(Duration::from_millis(10));
		}
		assert!(!updates.is_empty(), "a refused socket must report itself");
		let pane = sessions.pane("t1").expect("pane");
		let Link::Failed(error) = &pane.link else {
			panic!("the link never failed: {:?}", pane.link);
		};
		assert!(!error.trim().is_empty(), "the reason is shown");
		assert_eq!(pane.error.as_deref(), Some(error.as_str()));
	}

	#[test]
	fn an_empty_session_id_is_refused_in_the_ui_thread() {
		let mut sessions = AgentSessions::default();
		let error = sessions
			.connect("t1", "http://127.0.0.1:1", "   ")
			.expect_err("empty");
		assert!(error.contains("为空"));
		let pane = sessions.pane("t1").expect("pane");
		assert!(matches!(pane.link, Link::Failed(_)));
		assert_eq!(pane.request_summary(), None);
	}
	/// A one-shot HTTP server: answers `answer` as one chunk and hands back the
	/// request it saw.
	fn stub(answer: &'static str) -> (String, std::thread::JoinHandle<String>) {
		use std::{
			io::{Read, Write},
			net::TcpListener,
			time::Duration,
		};
		let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
		let address = listener.local_addr().expect("addr").to_string();
		let handle = std::thread::spawn(move || {
			let (mut socket, _) = listener.accept().expect("accept");
			socket.set_read_timeout(Some(Duration::from_secs(10))).ok();
			let mut request = Vec::new();
			let mut buffer = [0u8; 512];
			loop {
				let Ok(read) = socket.read(&mut buffer) else {
					break;
				};
				if read == 0 {
					break;
				}
				request.extend_from_slice(&buffer[..read]);
				let text = String::from_utf8_lossy(&request).into_owned();
				if let Some((head, body)) = text.split_once("\r\n\r\n") {
					let length = head
						.lines()
						.find_map(|line| {
							line
								.strip_prefix("Content-Length:")
								.and_then(|value| value.trim().parse::<usize>().ok())
						})
						.unwrap_or(0);
					if body.len() >= length {
						break;
					}
				}
			}
			let chunk = format!("{:x}\r\n{answer}\r\n0\r\n\r\n", answer.len());
			let response = format!("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{chunk}");
			let _ = socket.write_all(response.as_bytes());
			String::from_utf8_lossy(&request).into_owned()
		});
		(address, handle)
	}

	#[test]
	fn a_prompt_goes_to_the_agent_route_with_the_web_uis_body() {
		let (address, handle) = stub("{\"success\":true}");
		send_prompt(&format!("http://{address}"), "sess-1", "fix the build")
			.expect("the prompt is accepted");
		let request = handle.join().expect("stub");
		assert!(request.starts_with("POST /api/agent/sess-1 HTTP/1.1"), "{request}");
		let body = request.split_once("\r\n\r\n").expect("body").1;
		let parsed: Value = serde_json::from_str(body).expect("json");
		assert_eq!(parsed["type"], "prompt");
		assert_eq!(parsed["message"], "fix the build");
	}

	#[test]
	fn a_refused_prompt_carries_the_backends_own_reason() {
		let (address, handle) = stub("{\"success\":false,\"error\":\"no such session\"}");
		let error = send_prompt(&format!("http://{address}"), "sess-1", "hi").expect_err("refused");
		assert_eq!(error, "no such session");
		handle.join().expect("stub");
	}

	#[test]
	fn an_empty_prompt_or_session_never_opens_a_socket() {
		assert!(send_prompt("http://127.0.0.1:1", "sess-1", "   ").is_err());
		assert!(send_prompt("http://127.0.0.1:1", "  ", "hi").is_err());
		assert!(send_prompt("https://127.0.0.1:1", "sess-1", "hi").is_err());
	}

	#[test]
	fn chunked_answers_are_decoded_across_chunk_boundaries() {
		assert_eq!(decode_chunked("4\r\n{\"a\"\r\n3\r\n:1}\r\n0\r\n\r\n"), "{\"a\":1}");
		assert_eq!(
			decode_chunked("19\r\n{\"success\":true,\"data\":1}\r\n0\r\n\r\n"),
			"{\"success\":true,\"data\":1}"
		);
	}
}
