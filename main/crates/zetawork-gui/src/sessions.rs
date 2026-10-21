// SPDX-License-Identifier: AGPL-3.0-only
//! The gateway's conversations: `GET /api/sessions` and the one `POST` that
//! creates an empty one.
//!
//! The left column's tree is project → workspace → conversation. Projects and
//! workspaces are the shell's own state; a **conversation** is a gateway
//! session, so its list is read from the serve instance `~/.zeta/serve.json`
//! published — never invented from the journals on disk. The body is the same
//! one `packages/coding-agent` answers:
//!
//! ```text
//! GET /api/sessions
//! {"sessions":[{"id":"01a…","cwd":"/work/alpha","name":"Fix the parser",
//!   "modified":"2026-10-21T08:12:44.000Z","messageCount":12,
//!   "firstMessage":"Fix the parser",…}],
//!  "runningSessionIds":["01a…"]}
//! ```
//!
//! [`decode`] keeps only the fields the tree draws (the gateway's `name`, or
//! its older `title`, or the first message) and sorts newest first. A
//! session with no `cwd` is kept (the gateway knows it) but no workspace can
//! claim it; [`crate::state::AppState::set_conversations`] is what decides
//! membership by the workspace root.
//!
//! [`SessionCache`] owns the refresh and the creation round trip: both run on a
//! worker thread and report through [`SessionCache::poll`], because a UI frame
//! must never wait on a socket. The transport is [`crate::usage::http_get`] /
//! [`crate::usage::http_post`] — the crate's one loopback HTTP client — so this
//! module adds no dependency and no second way to talk to serve.

use std::{
	collections::HashSet,
	path::{Path, PathBuf},
	sync::mpsc::{Receiver, TryRecvError, channel},
	thread,
	time::{Duration, Instant},
};

use serde_json::Value;

use crate::t;

/// How often the open left column re-reads the list.
pub const REFRESH: Duration = Duration::from_secs(5);

/// `GET /api/sessions`.
pub const SESSIONS_PATH: &str = "/api/sessions";

/// `GET /api/sessions/archived` — the archive tree, newest first.
pub const ARCHIVED_PATH: &str = "/api/sessions/archived";

/// `POST /api/agent/new`; `type: ensure_session` creates without prompting.
pub const NEW_SESSION_PATH: &str = "/api/agent/new";

/// One gateway session, as the tree needs it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Conversation {
	/// The gateway's session id — also the key an `Agent` tab attaches to.
	pub id: String,
	/// The directory the session runs in. Empty when the gateway did not
	/// record one; such a session belongs to no workspace.
	pub cwd: PathBuf,
	/// The session's own title, else its first user message; empty when the
	/// gateway has neither (a freshly created session).
	pub title: String,
	/// Last modification, milliseconds since the epoch; `0` when unparsed.
	pub modified_ms: i64,
	/// Persisted message count, as the gateway reports it.
	pub message_count: u64,
	/// True while the gateway reports the session in `runningSessionIds`.
	pub running: bool,
}

impl Conversation {
	/// The row's text: the title, or 新会话 for a session with nothing said yet.
	pub fn display_title(&self) -> &str {
		let title = self.title.trim();
		if title.is_empty() {
			t!("新会话")
		} else {
			title
		}
	}
}

/// Decode a `GET /api/sessions` body.
///
/// Malformed session entries are skipped, not fatal: one bad row must not hide
/// the rest of the list. A body that is not the gateway's object shape is an
/// error, because then nothing about the list can be trusted.
pub fn decode(body: &str) -> Result<Vec<Conversation>, String> {
	let value: Value =
		serde_json::from_str(body).map_err(|error| t!("会话列表不是 JSON：{}", error))?;
	let sessions = value
		.get("sessions")
		.and_then(Value::as_array)
		.ok_or_else(|| t!("会话列表缺少 sessions 数组").to_owned())?;
	let running: HashSet<&str> = value
		.get("runningSessionIds")
		.and_then(Value::as_array)
		.map(|ids| ids.iter().filter_map(Value::as_str).collect())
		.unwrap_or_default();
	let mut seen = HashSet::new();
	let mut rows = Vec::new();
	for session in sessions {
		let Some(id) = session
			.get("id")
			.and_then(Value::as_str)
			.map(str::trim)
			.filter(|id| !id.is_empty())
		else {
			continue;
		};
		if !seen.insert(id.to_owned()) {
			continue;
		}
		let cwd = session
			.get("cwd")
			.and_then(Value::as_str)
			.unwrap_or_default()
			.trim();
		let title = ["name", "title"]
			.iter()
			.find_map(|key| session.get(*key).and_then(Value::as_str))
			.map(str::trim)
			.filter(|title| !title.is_empty())
			.or_else(|| {
				session
					.get("firstMessage")
					.and_then(Value::as_str)
					.map(str::trim)
					.filter(|text| {
						!text.is_empty() && *text != "(no messages)" && *text != "(archived session)"
					})
			})
			.unwrap_or_default()
			.to_owned();
		let modified_ms = ["modified", "created"]
			.iter()
			.find_map(|key| session.get(*key).and_then(Value::as_str))
			.and_then(timestamp_ms)
			.unwrap_or(0);
		let message_count = session
			.get("messageCount")
			.and_then(Value::as_u64)
			.unwrap_or(0);
		rows.push(Conversation {
			id: id.to_owned(),
			cwd: if cwd.is_empty() {
				PathBuf::new()
			} else {
				PathBuf::from(cwd)
			},
			title,
			modified_ms,
			message_count,
			running: running.contains(id),
		});
	}
	rows.sort_by(|a, b| {
		b.modified_ms
			.cmp(&a.modified_ms)
			.then_with(|| a.id.cmp(&b.id))
	});
	Ok(rows)
}

/// Decode a `GET /api/sessions/archived` body.
///
/// The archive lists the same `SessionInfo` shape as the live list, so the
/// decoder is shared; the only difference the GUI cares about is that
/// `messageCount` is reported as 0 there (the archive does not re-read
/// transcripts) — which is the truth the row shows.
pub fn decode_archived(body: &str) -> Result<Vec<Conversation>, String> {
	decode(body)
}

/// `~/.zeta/zetawork-session-pins.json` — the conversations the user pinned.
///
/// Pins are a view preference of this GUI, so they live beside
/// `zetawork.toml` rather than in zetacode's own config. The file is one JSON
/// array of session ids; anything else is ignored, which keeps a hand-edited
/// file from breaking the list.
pub fn pins_path() -> PathBuf {
	let home = std::env::var_os("USERPROFILE")
		.or_else(|| std::env::var_os("HOME"))
		.map(PathBuf::from)
		.unwrap_or_else(|| PathBuf::from("."));
	home.join(".zeta").join("zetawork-session-pins.json")
}

/// Parse the pins file: a JSON array, or `{"pinned":[...]}`.
pub fn parse_pins(text: &str) -> Vec<String> {
	let Ok(value) = serde_json::from_str::<Value>(text) else {
		return Vec::new();
	};
	let rows = value
		.as_array()
		.or_else(|| value.get("pinned").and_then(Value::as_array));
	let Some(rows) = rows else {
		return Vec::new();
	};
	let mut seen = HashSet::new();
	rows
		.iter()
		.filter_map(Value::as_str)
		.map(str::trim)
		.filter(|id| !id.is_empty())
		.filter(|id| seen.insert((*id).to_owned()))
		.map(str::to_owned)
		.collect()
}

/// Read the pins file. A missing or malformed file is no pins, not an error.
pub fn load_pins_from(path: &Path) -> Vec<String> {
	std::fs::read_to_string(path)
		.map(|text| parse_pins(&text))
		.unwrap_or_default()
}

/// Write the pins file, creating `~/.zeta` when needed.
pub fn save_pins_to(path: &Path, ids: &[String]) -> Result<(), String> {
	if let Some(dir) = path.parent() {
		std::fs::create_dir_all(dir).map_err(|error| t!("创建配置目录失败：{}", error))?;
	}
	let body =
		serde_json::to_string_pretty(ids).map_err(|error| t!("序列化置顶列表失败：{}", error))?;
	std::fs::write(path, format!("{body}\n")).map_err(|error| t!("写入置顶列表失败：{}", error))
}

/// Toggle one id, newest pins last. Returns the new pinned state.
pub fn toggle_pin(ids: &mut Vec<String>, id: &str) -> bool {
	let id = id.trim();
	if id.is_empty() {
		return false;
	}
	if let Some(index) = ids.iter().position(|pinned| pinned == id) {
		ids.remove(index);
		false
	} else {
		ids.push(id.to_owned());
		true
	}
}

/// One ISO-8601 timestamp as milliseconds since the epoch.
fn timestamp_ms(text: &str) -> Option<i64> {
	chrono::DateTime::parse_from_rfc3339(text)
		.ok()
		.map(|time| time.timestamp_millis())
}

/// What a finished worker reports to the frame loop.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
	/// The list landed (also sent for an empty one).
	Updated,
	/// The list could not be read; the previous rows stay on screen.
	LoadFailed(String),
	/// A new session exists: open `session` under `workspace`.
	Created { workspace: String, session: String },
	/// The new-session request failed.
	CreateFailed(String),
}

/// The list, its refresh worker, and the one in-flight creation.
#[derive(Default)]
pub struct SessionCache {
	origin: Option<String>,
	rows: Vec<Conversation>,
	error: Option<String>,
	loaded_at: Option<Instant>,
	load: Option<Receiver<Result<Vec<Conversation>, String>>>,
	create: Option<Receiver<Result<String, String>>>,
	create_workspace: Option<String>,
}

impl SessionCache {
	/// Point the cache at the gateway origin. A different origin invalidates
	/// the rows, because they describe another server's sessions; losing the
	/// origin keeps the last snapshot so an offline window still shows what it
	/// knew.
	pub fn set_origin(&mut self, origin: Option<String>) {
		if self.origin == origin {
			return;
		}
		if origin.is_some() {
			self.rows.clear();
			self.loaded_at = None;
			self.error = None;
			// A read against the previous origin must not land in this one.
			self.load = None;
		}
		self.origin = origin;
	}

	pub fn origin(&self) -> Option<&str> {
		self.origin.as_deref()
	}

	/// The last list the gateway answered.
	pub fn rows(&self) -> &[Conversation] {
		&self.rows
	}

	/// Why the last read failed, when it did.
	pub fn error(&self) -> Option<&str> {
		self.error.as_deref()
	}

	/// Mark the snapshot stale so the next [`Self::tick`] re-reads it now.
	pub fn refresh_now(&mut self) {
		self.loaded_at = None;
	}

	/// Seed the cache (tests and the headless screenshots).
	pub fn seed(&mut self, rows: Vec<Conversation>) {
		self.rows = rows;
		self.error = None;
		self.loaded_at = Some(Instant::now());
	}

	/// Re-read the list when `active` (the left column is open) and the TTL
	/// has passed. Never blocks: the request runs on its own thread.
	pub fn tick(&mut self, now: Instant, active: bool) {
		if !active || self.load.is_some() {
			return;
		}
		let Some(origin) = self.origin.clone() else {
			self.error = Some(t!("未发现网关地址（~/.zeta/serve.json 的 webUrl）").to_owned());
			return;
		};
		if self
			.loaded_at
			.is_some_and(|at| now.saturating_duration_since(at) < REFRESH)
		{
			return;
		}
		let (sender, receiver) = channel();
		self.load = Some(receiver);
		thread::spawn(move || {
			let result = crate::usage::http_get(&origin, SESSIONS_PATH)
				.map_err(describe)
				.and_then(|body| decode(&body));
			let _ = sender.send(result);
		});
	}

	/// Drain whatever finished since the last frame.
	pub fn poll(&mut self, now: Instant) -> Vec<Event> {
		let mut events = Vec::new();
		if let Some(receiver) = self.load.take() {
			match receiver.try_recv() {
				Ok(Ok(rows)) => {
					self.rows = rows;
					self.error = None;
					self.loaded_at = Some(now);
					events.push(Event::Updated);
				},
				Ok(Err(error)) => {
					self.error = Some(error.clone());
					self.loaded_at = Some(now);
					events.push(Event::LoadFailed(error));
				},
				Err(TryRecvError::Empty) => self.load = Some(receiver),
				Err(TryRecvError::Disconnected) => {
					let error = t!("会话列表的读取线程已结束").to_owned();
					self.error = Some(error.clone());
					self.loaded_at = Some(now);
					events.push(Event::LoadFailed(error));
				},
			}
		}
		if let Some(receiver) = self.create.take() {
			let workspace = self.create_workspace.take();
			match receiver.try_recv() {
				Ok(Ok(session)) => {
					// The new session is not in the snapshot yet; the next tick
					// re-reads immediately (`loaded_at` is cleared).
					self.loaded_at = None;
					if let Some(workspace) = workspace {
						events.push(Event::Created { workspace, session });
					}
				},
				Ok(Err(error)) => events.push(Event::CreateFailed(error)),
				Err(TryRecvError::Empty) => {
					self.create = Some(receiver);
					self.create_workspace = workspace;
				},
				Err(TryRecvError::Disconnected) => {
					events.push(Event::CreateFailed(t!("新建会话的请求线程已结束").to_owned()))
				},
			}
		}
		events
	}

	/// Ask the gateway for an empty session in `cwd`, owned by `workspace`.
	///
	/// The gateway's `ensure_session` creates the durable session without
	/// sending a prompt, which is exactly "a conversation exists, nothing has
	/// been said yet".
	pub fn request_create(&mut self, workspace: &str, cwd: &Path) -> Result<(), String> {
		let Some(origin) = self.origin.clone() else {
			return Err(t!("未发现网关地址（~/.zeta/serve.json 的 webUrl）").to_owned());
		};
		if self.create.is_some() {
			return Err(t!("正在新建会话，请稍候").to_owned());
		}
		let body = serde_json::json!({
			"cwd": cwd.to_string_lossy(),
			"type": "ensure_session",
		})
		.to_string();
		let (sender, receiver) = channel();
		self.create = Some(receiver);
		self.create_workspace = Some(workspace.to_owned());
		thread::spawn(move || {
			let result = crate::usage::http_post(&origin, NEW_SESSION_PATH, &body)
				.map_err(describe)
				.and_then(|body| {
					let value: Value = serde_json::from_str(&body)
						.map_err(|error| t!("新建会话的应答不是 JSON：{}", error))?;
					value
						.get("sessionId")
						.and_then(Value::as_str)
						.map(str::trim)
						.filter(|id| !id.is_empty())
						.map(str::to_owned)
						.ok_or_else(|| t!("新建会话的应答没有 sessionId").to_owned())
				});
			let _ = sender.send(result);
		});
		Ok(())
	}
}

/// The transport's own reason, without the stats-specific wording.
fn describe(error: crate::usage::FetchError) -> String {
	use crate::usage::FetchError;
	match error {
		FetchError::Address(why) | FetchError::Connect(why) | FetchError::Io(why) => why,
		FetchError::Status(code, body) if body.is_empty() => {
			t!("网关返回 HTTP {}", code)
		},
		FetchError::Status(code, body) => t!("网关返回 HTTP {}：{}", code, body),
		FetchError::Decode(why) => t!("网关应答无法解析：{}", why),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	const BODY: &str = r#"{
		"sessions": [
			{"id":"older","cwd":"/work/alpha","title":"Older","modified":"2026-10-20T08:00:00.000Z","messageCount":3},
			{"id":"newer","cwd":"/work/beta","firstMessage":"Fix the parser","modified":"2026-10-21T08:00:00.000Z","messageCount":9},
			{"id":"empty","cwd":"","modified":"2026-10-21T09:00:00.000Z","messageCount":0}
		],
		"runningSessionIds": ["newer"]
	}"#;

	#[test]
	fn decodes_the_gateway_shape_newest_first() {
		let rows = decode(BODY).expect("the gateway shape decodes");
		assert_eq!(rows.len(), 3);
		assert_eq!(rows[0].id, "empty", "newest first");
		assert_eq!(rows[1].id, "newer");
		assert_eq!(rows[1].title, "Fix the parser", "the first message is the title");
		assert!(rows[1].running, "the running marker is kept");
		assert_eq!(rows[2].id, "older");
		assert_eq!(rows[2].title, "Older");
		assert!(!rows[2].running);
		assert_eq!(rows[1].modified_ms, 1_792_569_600_000);
		assert_eq!(rows[2].cwd, PathBuf::from("/work/alpha"));
		assert_eq!(rows[0].display_title(), "新会话", "an empty session reads as a new one");
		assert!(!rows[0].running);
	}

	#[test]
	fn a_bad_row_does_not_hide_the_rest() {
		let body = r#"{"sessions":[{"cwd":"/x"},{"id":"ok","cwd":"/y"}],"runningSessionIds":[]}"#;
		let rows = decode(body).expect("decodes");
		assert_eq!(rows.len(), 1, "the row without an id is skipped");
		assert_eq!(rows[0].id, "ok");
	}

	#[test]
	fn a_body_that_is_not_the_gateway_shape_is_an_error() {
		assert!(decode("not json").is_err());
		assert!(decode(r#"{"sessions":{}}"#).is_err());
	}

	#[test]
	fn display_title_falls_back_to_the_new_session_word() {
		let conversation = Conversation {
			id: "s".to_owned(),
			cwd: PathBuf::new(),
			title: "   ".to_owned(),
			modified_ms: 0,
			message_count: 0,
			running: false,
		};
		assert_eq!(conversation.display_title(), "新会话");
	}

	#[test]
	fn an_offline_cache_keeps_the_last_snapshot() {
		let mut cache = SessionCache::default();
		cache.set_origin(Some("http://127.0.0.1:3847".to_owned()));
		cache.seed(decode(BODY).expect("decodes"));
		let before = cache.rows().len();
		cache.set_origin(None);
		assert_eq!(cache.rows().len(), before, "losing the origin keeps what was known");
		assert!(cache.error().is_none());
		// A different origin is another server: its rows must not survive.
		cache.set_origin(Some("http://127.0.0.1:3848".to_owned()));
		assert!(cache.rows().is_empty());
	}

	#[test]
	fn create_requires_a_gateway_origin() {
		let mut cache = SessionCache::default();
		assert!(cache.request_create("ws-default", Path::new(".")).is_err());
	}

	#[test]
	fn the_gateway_name_wins_over_the_first_message() {
		let body = r#"{"sessions":[
			{"id":"named","cwd":"/w","name":"Release notes","firstMessage":"hello"},
			{"id":"titled","cwd":"/w","title":"Old title"},
			{"id":"archived","cwd":"/w","firstMessage":"(archived session)"}
		]}"#;
		let rows = decode(body).expect("decodes");
		let by_id = |id: &str| rows.iter().find(|row| row.id == id).expect("the row");
		assert_eq!(by_id("named").title, "Release notes");
		assert_eq!(by_id("titled").title, "Old title", "the older field is still read");
		assert_eq!(by_id("archived").title, "", "the archive placeholder is not a title");
		assert_eq!(by_id("archived").display_title(), t!("新会话"));
	}

	#[test]
	fn archived_rows_decode_through_the_same_shape() {
		let body = r#"{"sessions":[{"id":"a1","cwd":"/work/alpha","name":"Old work","modified":"2026-10-19T08:00:00.000Z","messageCount":0}]}"#;
		let rows = decode_archived(body).expect("decodes");
		assert_eq!(rows.len(), 1);
		assert_eq!(rows[0].title, "Old work");
		assert_eq!(rows[0].message_count, 0);
	}

	#[test]
	fn pins_toggle_and_round_trip_through_a_file() {
		let dir = std::env::temp_dir().join(format!("zetawork-gui-pins-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		let path = dir.join("pins.json");
		assert!(load_pins_from(&path).is_empty(), "a missing file is no pins");

		let mut ids = Vec::new();
		assert!(toggle_pin(&mut ids, "a"));
		assert!(toggle_pin(&mut ids, "b"));
		assert!(!toggle_pin(&mut ids, "a"), "the second click unpins");
		assert_eq!(ids, ["b"]);
		toggle_pin(&mut ids, "a");
		save_pins_to(&path, &ids).expect("the file is written");
		assert_eq!(load_pins_from(&path), ["b", "a"], "order is preserved");

		assert_eq!(parse_pins(r#"{"pinned":["x","x"," "]}"#), ["x"]);
		assert!(parse_pins("not json").is_empty());
		assert!(!toggle_pin(&mut ids, "  "));
		let _ = std::fs::remove_dir_all(&dir);
	}
}
