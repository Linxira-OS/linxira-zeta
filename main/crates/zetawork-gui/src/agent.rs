// SPDX-License-Identifier: AGPL-3.0-only
//! Gateway agent sessions: the SSE frame vocabulary and the pure reducer an
//! agent pane runs.
//!
//! An agent pane is a **client** of `zetacode serve` (operator ruling
//! 2026-10-17). The gateway owns the session; this module decodes what it
//! streams and turns it into rows, a pending request and the two notifications
//! the shell can honestly raise:
//!
//! * **needs input** — an `extension_ui_request` is waiting for the user;
//! * **run finished** — the gateway's own `not-running` edge (it emits
//!   `running`/`not-running` when its busy state flips, which is more reliable
//!   than parsing durable entries for an `agent_end` marker).
//!
//! There is no I/O here: the transport (SSE reader) lives beside the socket
//! code the shell already owns, so every mapping is testable headlessly.

use serde_json::{Value, json};

/// One SSE frame the gateway sends (`agents.ts`).
#[derive(Clone, Debug, PartialEq)]
pub enum Frame {
	Connected,
	Resync,
	/// `{type:"session_entry", seq, entry}` — a durable session entry.
	SessionEntry(Value),
	/// `{type:"extension_ui_request", id, method, …}` — the agent waits for the
	/// user (select / confirm / input / editor / …).
	UiRequest(Value),
	/// `{type:"extension_ui_resolved", id}`.
	UiResolved(String),
	/// `{type:"queue_update", steering, followUp}`.
	Queue(Value),
	/// The gateway's busy state (`running` / `not-running`).
	Running(bool),
	Unknown(String),
}

/// Decode one `data:` payload. `None` for a frame we cannot even classify —
/// the caller ignores it rather than inventing a state.
pub fn parse_frame(data: &str) -> Option<Frame> {
	let value: Value = serde_json::from_str(data.trim()).ok()?;
	let kind = value.get("type")?.as_str()?;
	Some(match kind {
		"connected" => Frame::Connected,
		"resync" => Frame::Resync,
		"session_entry" => Frame::SessionEntry(value.get("entry").cloned().unwrap_or(Value::Null)),
		"extension_ui_request" => Frame::UiRequest(value),
		"extension_ui_resolved" => Frame::UiResolved(
			value
				.get("id")
				.and_then(Value::as_str)
				.unwrap_or_default()
				.to_owned(),
		),
		"queue_update" => Frame::Queue(value),
		"running" => Frame::Running(true),
		"not-running" => Frame::Running(false),
		other => Frame::Unknown(other.to_owned()),
	})
}

/// Who a transcript row came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RowKind {
	User,
	Assistant,
	Tool,
	Notice,
	Error,
}

/// One line of the pane's transcript.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
	pub kind: RowKind,
	pub text: String,
}

/// The pane's state, reduced from frames.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SessionView {
	pub connected: bool,
	pub running: bool,
	pub rows: Vec<Row>,
	pub pending: Option<Value>,
	pub queued: u32,
}

/// What the shell should do after a frame.
#[derive(Clone, Debug, PartialEq)]
pub enum Effect {
	Repaint,
	Notify { trigger: crate::notify::Trigger, body: String },
	Send(Value),
	Reconnect,
}

/// The transcript is a view, not a log: bound it so a long session cannot grow
/// the pane without limit.
const ROW_CAP: usize = 2000;

impl SessionView {
	/// Apply one frame. Effects are the only way the view asks for I/O, so the
	/// mapping above is the whole contract.
	pub fn apply(&mut self, frame: Frame) -> Vec<Effect> {
		match frame {
			Frame::Connected => {
				self.connected = true;
				vec![Effect::Repaint, Effect::Send(json!({ "type": "get_state" }))]
			},
			Frame::Resync => vec![Effect::Repaint],
			Frame::SessionEntry(entry) => {
				if let Some(row) = row_from_entry(&entry) {
					self.rows.push(row);
					if self.rows.len() > ROW_CAP {
						let excess = self.rows.len() - ROW_CAP;
						self.rows.drain(..excess);
					}
					vec![Effect::Repaint]
				} else {
					Vec::new()
				}
			},
			Frame::UiRequest(request) => {
				let body = request
					.get("title")
					.or_else(|| request.get("method"))
					.and_then(Value::as_str)
					.unwrap_or("等待你的输入")
					.to_owned();
				self.pending = Some(request);
				vec![
					Effect::Repaint,
					Effect::Notify { trigger: crate::notify::Trigger::NeedsInput, body },
				]
			},
			Frame::UiResolved(id) => {
				let mine = self
					.pending
					.as_ref()
					.and_then(|request| request.get("id"))
					.and_then(Value::as_str)
					.is_some_and(|pending| pending == id);
				if mine {
					self.pending = None;
				}
				if mine {
					vec![Effect::Repaint]
				} else {
					Vec::new()
				}
			},
			Frame::Queue(value) => {
				let count =
					|key: &str| value.get(key).and_then(Value::as_array).map_or(0, Vec::len) as u32;
				self.queued = count("steering") + count("followUp");
				vec![Effect::Repaint]
			},
			Frame::Running(running) => {
				let finished = self.running && !running;
				self.running = running;
				let mut effects = vec![Effect::Repaint];
				if finished {
					effects.push(Effect::Notify {
						trigger: crate::notify::Trigger::Idle,
						body: "这一轮跑完了".to_owned(),
					});
				}
				effects
			},
			Frame::Unknown(_) => Vec::new(),
		}
	}
}

/// Best-effort row for a durable entry.
///
/// The session manager's entry shapes are the runtime's, not the gateway's, so
/// this reads the two that carry text (a message's `role` + text parts) and
/// falls back to the entry's own `type` — an unrecognised entry becomes a
/// notice, never a silent drop.
fn row_from_entry(entry: &Value) -> Option<Row> {
	if entry.is_null() {
		return None;
	}
	let kind_name = entry.get("type").and_then(Value::as_str).unwrap_or("entry");
	let role = entry
		.get("role")
		.or_else(|| entry.get("message").and_then(|message| message.get("role")))
		.and_then(Value::as_str);
	let text = text_of(entry);
	if let Some(text) = text.filter(|text| !text.trim().is_empty()) {
		let kind = match role {
			Some("user") => RowKind::User,
			Some("assistant") => RowKind::Assistant,
			Some("tool") => RowKind::Tool,
			Some("error") => RowKind::Error,
			_ => RowKind::Tool,
		};
		return Some(Row { kind, text });
	}
	Some(Row { kind: RowKind::Notice, text: kind_name.to_owned() })
}

/// Concatenate the text parts of an entry's content (or its plain `text`).
fn text_of(entry: &Value) -> Option<String> {
	if let Some(text) = entry.get("text").and_then(Value::as_str) {
		return Some(text.to_owned());
	}
	let content = entry.get("content").or_else(|| {
		entry
			.get("message")
			.and_then(|message| message.get("content"))
	})?;
	if let Some(text) = content.as_str() {
		return Some(text.to_owned());
	}
	let parts: Vec<&str> = content
		.as_array()?
		.iter()
		.filter_map(|part| part.get("text").and_then(Value::as_str))
		.collect();
	if parts.is_empty() {
		None
	} else {
		Some(parts.join("\n"))
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_connected_frame_asks_for_the_state_and_marks_live() {
		let mut view = SessionView::default();
		let effects =
			view.apply(parse_frame(r#"{"type":"connected","sessionId":"s"}"#).expect("frame"));
		assert!(view.connected);
		assert_eq!(effects[1], Effect::Send(json!({ "type": "get_state" })));
	}

	#[test]
	fn a_ui_request_is_needs_input_and_a_resolve_clears_it() {
		let mut view = SessionView::default();
		let effects = view.apply(
			parse_frame(
				r#"{"type":"extension_ui_request","id":"r1","method":"confirm","title":"允许执行？"}"#,
			)
			.expect("frame"),
		);
		assert!(view.pending.is_some(), "the request is pending");
		assert!(matches!(
			effects[1],
			Effect::Notify { trigger: crate::notify::Trigger::NeedsInput, .. }
		));
		view.apply(parse_frame(r#"{"type":"extension_ui_resolved","id":"r1"}"#).expect("frame"));
		assert!(view.pending.is_none(), "its resolution clears the request");
	}

	#[test]
	fn the_running_edge_notifies_once_when_a_run_finishes() {
		let mut view = SessionView::default();
		assert!(
			view
				.apply(parse_frame(r#"{"type":"running"}"#).expect("frame"))
				.len() == 1
		);
		assert!(view.running);
		let effects = view.apply(parse_frame(r#"{"type":"not-running"}"#).expect("frame"));
		assert!(matches!(
			effects.last(),
			Some(Effect::Notify { trigger: crate::notify::Trigger::Idle, .. })
		));
		// A second not-running is not a new edge.
		let again = view.apply(parse_frame(r#"{"type":"not-running"}"#).expect("frame"));
		assert_eq!(again.len(), 1);
	}

	#[test]
	fn durable_entries_become_rows_and_unknown_entries_are_not_dropped_silently() {
		let mut view = SessionView::default();
		view.apply(
			parse_frame(
				r#"{"type":"session_entry","seq":1,"entry":{"type":"message","role":"assistant","content":[{"type":"text","text":"hello"}]}}"#,
			)
			.expect("frame"),
		);
		assert_eq!(view.rows[0], Row { kind: RowKind::Assistant, text: "hello".to_owned() });
		view.apply(
			parse_frame(r#"{"type":"session_entry","seq":2,"entry":{"type":"compaction"}}"#)
				.expect("frame"),
		);
		assert_eq!(view.rows[1], Row { kind: RowKind::Notice, text: "compaction".to_owned() });
	}

	#[test]
	fn an_unparseable_payload_is_ignored_and_an_unknown_type_is_not_a_state() {
		assert!(parse_frame("not json").is_none());
		let mut view = SessionView::default();
		assert!(
			view
				.apply(parse_frame(r#"{"type":"telemetry"}"#).expect("frame"))
				.is_empty()
		);
		assert_eq!(view, SessionView::default());
	}

	#[test]
	fn the_queue_counts_steering_and_follow_up() {
		let mut view = SessionView::default();
		view.apply(
			parse_frame(r#"{"type":"queue_update","steering":["a"],"followUp":["b","c"]}"#)
				.expect("frame"),
		);
		assert_eq!(view.queued, 3);
	}
}
