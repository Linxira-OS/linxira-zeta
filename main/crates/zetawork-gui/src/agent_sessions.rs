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

use std::collections::BTreeMap;

use serde_json::Value;

use crate::agent::{Effect, Frame, SessionView};
use crate::agent_events::{AgentEvents, Event};
use crate::notify::{Message, Trigger};

/// What the empty pane says: how to attach to a gateway session.
pub const EMPTY_HINT: &str = "在 zetacode serve 打开的 agent 会话里找到会话 id，填到上面点「连接」。\
本页读取 GET /api/agent/<id>/events（SSE）；连接失败时这里会显示 serve 报告的原因。";

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
			Self::Detached => "未连接",
			Self::Connecting => "连接中",
			Self::Live => "已连接",
			Self::Ended => "流已结束",
			Self::Failed(_) => "连接失败",
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
			let reason = "会话 id 为空".to_owned();
			self.error = Some(reason.clone());
			self.link = Link::Failed(reason.clone());
			return Err(reason);
		}
		// A new attachment is a new stream: the old view would describe another
		// session.
		self.events = None;
		self.view = SessionView::default();
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
			"（未命名会话）"
		} else {
			self.session.as_str()
		};
		let title = match trigger {
			Trigger::NeedsInput => format!("Agent {session} 等待你的输入"),
			Trigger::Idle => format!("Agent {session} 已跑完"),
			Trigger::Failed => format!("Agent {session} 失败或结束"),
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
		self
			.panes
			.values()
			.any(|pane| pane.events.is_some() || pane.link.is_watching())
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
							"事件流已结束".to_owned()
						} else {
							"事件流已关闭（serve 未返回 200，或连接提前断开）".to_owned()
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

#[cfg(test)]
mod tests {
	use std::io::{Read, Write};
	use std::net::{Shutdown, TcpListener};
	use std::thread;
	use std::time::{Duration, Instant};

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
			"data: {\"type\":\"extension_ui_request\",\"id\":\"r1\",\"method\":\"confirm\",\"title\":\"允许执行？\"}\n\n",
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
			"data: {\"type\":\"connected\",\"sessionId\":\"s1\"}\n\n\
			 data: {\"type\":\"running\"}\n\n\
			 data: {\"type\":\"extension_ui_request\",\"id\":\"r1\",\"method\":\"confirm\",\"title\":\"允许执行？\"}\n\n\
			 data: {\"type\":\"not-running\"}\n\n",
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
}
