// SPDX-License-Identifier: AGPL-3.0-only
//! One conversation's usage, and which conversation the active pane is on.
//!
//! The right column's 用量 page is not the global stats dashboard: it is a
//! view of the conversation the user is looking at. [`resolve`] implements the
//! three-step contract:
//!
//! 1. the active session tab, when it is an `Agent` page with an attached
//!    gateway session (its transcript is read back from the session directory,
//!    and the live frames are the fallback);
//! 2. otherwise the newest top-level `.jsonl` under the active workspace's
//!    `~/.zeta/agent/sessions/<encoded-cwd>/` directory;
//! 3. otherwise nothing, and the page says so in one line.
//!
//! Every figure comes from the session journal itself — the `usage` block the
//! provider returned on an assistant entry (or a `model_usage` entry). Nothing
//! here prices a request, invents a context window, or estimates a percentage:
//! the percentage is drawn only when the journal (or the live session) reports
//! a `contextWindow`, and otherwise the page shows tokens alone.
//!
//! The directory name is the agent's own encoding, reused from
//! [`crate::workspace_memory::session_dir_name`], so a workspace whose path has
//! a drive letter, a space or a CJK segment resolves to the directory the
//! agent actually wrote.

use crate::t;
use std::{
	io::{BufRead, BufReader},
	path::{Path, PathBuf},
	sync::mpsc::{Receiver, TryRecvError, channel},
	time::{Duration, Instant},
};

use chrono::TimeZone as _;
use serde_json::{Map, Value};

use crate::{
	agent_sessions::AgentSessions,
	state::{AppState, SessionKind},
};

/// The page's whole empty state. One line, no number, no promise of one.
pub const NO_SESSION: &str = "这一页没有会话";

/// The source label for the `Agent` pane's own session.
pub const PANE_SOURCE: &str = "当前会话";

/// The source label for the newest journal in the workspace.
pub const LATEST_SOURCE: &str = "最新会话";

/// How often the cache re-reads the journal while the same source is active.
const REFRESH: Duration = Duration::from_secs(1);

/// How often a live window lookup may be retried after it failed.
const WINDOW_RETRY: Duration = Duration::from_secs(30);

/// Where one conversation came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origin {
	/// The active `Agent` tab's attached session.
	Pane,
	/// The newest transcript under the workspace's session directory.
	LatestLog,
}

impl Origin {
	/// The word the page shows next to the conversation.
	pub fn label(self) -> &'static str {
		match self {
			Self::Pane => crate::i18n::tr(PANE_SOURCE),
			Self::LatestLog => crate::i18n::tr(LATEST_SOURCE),
		}
	}
}

/// Everything the page and the status bar need from one conversation.
///
/// Token fields are sums over the journal's usage entries; `context` is the
/// newest recorded prompt size (the `contextSnapshot` the runtime writes), and
/// falls back to `total` when a transcript predates that field.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct UsageSummary {
	/// The session id, when the journal or the pane names one.
	pub id: Option<String>,
	/// The first user message, reduced to one line.
	pub title: Option<String>,
	pub input: u64,
	pub output: u64,
	/// Summed provider `totalTokens`.
	pub total: u64,
	/// The newest prompt size (context occupancy), or 0 when unknown.
	pub context: u64,
	/// Summed cost, when at least one usage block was priced.
	pub cost: Option<f64>,
	/// Usage blocks with no cost (an unpriced model), so the page can say so.
	pub unpriced: u64,
	/// The newest model id the journal recorded.
	pub model: Option<String>,
	/// The model's context window, when the journal records one.
	pub window: Option<u64>,
	/// The newest timestamp (ms since the epoch).
	pub last: Option<i64>,
	/// How many usage blocks were summed.
	pub usage_entries: usize,
}

impl UsageSummary {
	/// Fold one journal entry (or one `session_entry` frame) into the summary.
	pub fn observe(&mut self, entry: &Value) {
		if entry.is_null() {
			return;
		}
		if let Some(ms) = timestamp_of(entry) {
			self.last = Some(ms);
		}
		if entry.get("type").and_then(Value::as_str) == Some("session") {
			if let Some(id) = entry
				.get("id")
				.and_then(Value::as_str)
				.filter(|id| !id.is_empty())
			{
				self.id = Some(id.to_owned());
			}
		}
		let message = entry.get("message");
		let role = entry
			.get("role")
			.or_else(|| message.and_then(|message| message.get("role")))
			.and_then(Value::as_str);
		if self.title.is_none() && role == Some("user") {
			if let Some(text) = text_of(entry) {
				let digest = digest(&text);
				if !digest.is_empty() {
					self.title = Some(digest);
				}
			}
		}
		if let Some(model) = message
			.and_then(|message| message.get("model"))
			.or_else(|| entry.get("model"))
			.and_then(Value::as_str)
			.filter(|model| !model.is_empty())
		{
			self.model = Some(model.to_owned());
		}
		if let Some(window) = window_of(entry) {
			self.window = Some(window);
		}
		let Some(usage) = usage_of(entry) else {
			return;
		};
		self.usage_entries += 1;
		self.input += uint(usage, "input");
		self.output += uint(usage, "output");
		let total = total_tokens(usage);
		self.total += total;
		if let Some(context) = context_of(entry) {
			self.context = context;
		}
		match usage.get("cost").and_then(Value::as_object) {
			Some(cost) => match number(cost, "total") {
				Some(value) => self.cost = Some(self.cost.unwrap_or(0.0) + value),
				None => self.unpriced += 1,
			},
			None => self.unpriced += 1,
		}
	}

	/// The tokens the context bar describes: the newest prompt size, or the
	/// summed tokens for a journal that never recorded one.
	pub fn context_tokens(&self) -> u64 {
		if self.context > 0 {
			self.context
		} else {
			self.total
		}
	}

	/// `context / window`, or `None` when the window is genuinely unknown.
	pub fn percent(&self) -> Option<f64> {
		let window = self.window.filter(|window| *window > 0)?;
		Some((self.context_tokens() as f64 / window as f64 * 100.0).clamp(0.0, 100.0))
	}

	/// The cost row's text, only when at least one block was priced.
	pub fn cost_text(&self) -> Option<String> {
		let cost = self.cost?;
		let mut text = if cost > 0.0 && cost < 0.01 {
			format!("${cost:.4}")
		} else {
			format!("${cost:.2}")
		};
		if self.unpriced > 0 {
			text.push_str(&t!(" · {} 条未定价", self.unpriced));
		}
		Some(text)
	}

	/// The last entry's local time, as the page spells it.
	pub fn last_text(&self) -> Option<String> {
		let ms = self.last?;
		chrono::Local
			.timestamp_millis_opt(ms)
			.single()
			.map(|time| time.format("%m-%d %H:%M:%S").to_string())
	}
}

/// One conversation and where it came from.
#[derive(Clone, Debug, PartialEq)]
pub struct Resolved {
	pub origin: Origin,
	pub summary: UsageSummary,
}

impl Resolved {
	/// The page's one source line.
	pub fn source_line(&self) -> &'static str {
		self.origin.label()
	}
}

/// Parse a JSONL session journal into its usage summary.
///
/// Lines that are not JSON are skipped: a journal can end mid-write, and one
/// truncated tail must not hide every earlier entry.
pub fn summarize_log(text: &str) -> UsageSummary {
	let mut summary = UsageSummary::default();
	for line in text.lines() {
		let line = line.trim();
		if line.is_empty() {
			continue;
		}
		if let Ok(entry) = serde_json::from_str::<Value>(line) {
			summary.observe(&entry);
		}
	}
	summary
}

/// Read one journal file. `None` means the file could not be opened or read.
pub fn summarize_file(path: &Path) -> Option<UsageSummary> {
	let file = std::fs::File::open(path).ok()?;
	let mut summary = UsageSummary::default();
	for line in BufReader::new(file).lines() {
		let Ok(line) = line else {
			return Some(summary);
		};
		let line = line.trim();
		if line.is_empty() {
			continue;
		}
		if let Ok(entry) = serde_json::from_str::<Value>(line) {
			summary.observe(&entry);
		}
	}
	Some(summary)
}

/// The agent's session root and the two roots its directory encoding uses.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionRoots {
	pub home: PathBuf,
	pub temp: PathBuf,
}

impl SessionRoots {
	/// The real user's roots. `None` when neither `USERPROFILE` nor `HOME`
	/// names a directory (the page then has no source and says so).
	pub fn real() -> Option<Self> {
		let home = std::env::var_os("USERPROFILE")
			.or_else(|| std::env::var_os("HOME"))
			.map(PathBuf::from)
			.filter(|path| !path.as_os_str().is_empty())?;
		Some(Self { home, temp: std::env::temp_dir() })
	}

	/// Explicit roots, for tests and the screenshot harness.
	pub fn at(home: PathBuf, temp: PathBuf) -> Self {
		Self { home, temp }
	}

	/// `~/.zeta/agent/sessions`.
	pub fn sessions_root(&self) -> PathBuf {
		crate::workspace_memory::session_journals_root(&self.home)
	}

	/// The directory the agent keys the workspace's journals by.
	pub fn project_dir(&self, workspace: &Path) -> PathBuf {
		self
			.sessions_root()
			.join(crate::workspace_memory::session_dir_name(workspace, &self.home, &self.temp))
	}
}

/// Which conversation the active pane/tab is on, if any.
pub fn resolve(state: &AppState, agents: &AgentSessions, roots: &SessionRoots) -> Option<Resolved> {
	let workspace = state.active_workspace()?;
	let workspace_path = PathBuf::from(&workspace.path);
	let directory = roots.project_dir(&workspace_path);
	let tab = state.active_session_tab();
	let attached = tab
		.filter(|tab| tab.kind == SessionKind::Agent)
		.and_then(|tab| agents.pane(&tab.id))
		.and_then(|pane| pane.session.clone());
	if let Some(session) = attached {
		// The journal is the complete transcript; the live frames are what the
		// pane has seen since it attached. Prefer the journal, fall back to the
		// live accumulator when the file is gone (or not written yet).
		if let Some(path) = log_for_session(&directory, &session) {
			if let Some(mut summary) = summarize_file(&path) {
				summary.id.get_or_insert(session);
				return Some(Resolved { origin: Origin::Pane, summary });
			}
		}
		if let Some(pane) = tab.and_then(|tab| agents.pane(&tab.id)) {
			if pane.usage.usage_entries > 0 || pane.usage.last.is_some() {
				let mut summary = pane.usage.clone();
				summary.id.get_or_insert(session);
				return Some(Resolved { origin: Origin::Pane, summary });
			}
		}
		return Some(Resolved {
			origin: Origin::Pane,
			summary: UsageSummary { id: Some(session), ..UsageSummary::default() },
		});
	}
	let path = newest_log(&directory)?;
	let summary = summarize_file(&path)?;
	Some(Resolved { origin: Origin::LatestLog, summary })
}

/// The status bar's 上文 column: `上文 37%` with a real share, `上文 —`
/// without.
pub fn status_label(percent: Option<f64>) -> String {
	match percent {
		Some(percent) => t!("上文 {}%", format!("{percent:.0}")),
		None => t!("上文 —").to_owned(),
	}
}

/// The newest top-level `.jsonl` in `directory`.
///
/// Directories are skipped on purpose: a subagent transcript lives one level
/// down, and it is not the conversation the workspace page is about.
pub fn newest_log(directory: &Path) -> Option<PathBuf> {
	let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
	for entry in std::fs::read_dir(directory).ok()?.flatten() {
		let path = entry.path();
		if !path.is_file() || !is_journal(&path) {
			continue;
		}
		let stamp = entry
			.metadata()
			.and_then(|meta| meta.modified())
			.unwrap_or(std::time::SystemTime::UNIX_EPOCH);
		if best.as_ref().is_none_or(|(seen, _)| stamp > *seen) {
			best = Some((stamp, path));
		}
	}
	best.map(|(_, path)| path)
}

/// The journal named for `session`, when the workspace directory has one.
fn log_for_session(directory: &Path, session: &str) -> Option<PathBuf> {
	let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
	for entry in std::fs::read_dir(directory).ok()?.flatten() {
		let path = entry.path();
		if !path.is_file() || !is_journal(&path) {
			continue;
		}
		let named = path
			.file_name()
			.map(|name| name.to_string_lossy().contains(session))
			.unwrap_or(false);
		if !named {
			continue;
		}
		let stamp = entry
			.metadata()
			.and_then(|meta| meta.modified())
			.unwrap_or(std::time::SystemTime::UNIX_EPOCH);
		if best.as_ref().is_none_or(|(seen, _)| stamp > *seen) {
			best = Some((stamp, path));
		}
	}
	best.map(|(_, path)| path)
}

fn is_journal(path: &Path) -> bool {
	path
		.extension()
		.and_then(|extension| extension.to_str())
		.is_some_and(|extension| extension.eq_ignore_ascii_case("jsonl"))
}

/// The cache the shell keeps: one summary, re-read when the active source
/// changes (and at most once a second while it stays the same).
#[derive(Debug)]
pub struct ConversationCache {
	roots: Option<SessionRoots>,
	/// The web gateway that can report a live session's context window.
	origin: Option<String>,
	resolved: Option<Resolved>,
	key: Option<String>,
	last_read: Option<Instant>,
	/// A window learned from `/api/agent/<id>/context`, keyed by session.
	window_hint: Option<(String, u64)>,
	probe: Option<WindowProbe>,
	last_probe: Option<(String, Instant)>,
}

#[derive(Debug)]
struct WindowProbe {
	session: String,
	window: Receiver<Option<u64>>,
}

impl Default for ConversationCache {
	fn default() -> Self {
		Self {
			roots: SessionRoots::real(),
			origin: None,
			resolved: None,
			key: None,
			last_read: None,
			window_hint: None,
			probe: None,
			last_probe: None,
		}
	}
}

impl ConversationCache {
	/// Use explicit roots (the screenshot harness and tests).
	pub fn set_roots(&mut self, roots: Option<SessionRoots>) {
		self.roots = roots;
		self.invalidate();
	}

	/// The web gateway origin the live window probe may dial.
	pub fn set_origin(&mut self, origin: Option<String>) {
		self.origin = origin;
	}

	/// Forget the current result; the next `refresh` re-reads.
	pub fn invalidate(&mut self) {
		self.key = None;
		self.last_read = None;
		self.resolved = None;
	}

	pub fn resolved(&self) -> Option<&Resolved> {
		self.resolved.as_ref()
	}

	/// The share the status bar's 上文 column should show.
	pub fn percent(&self) -> Option<f64> {
		self.resolved.as_ref()?.summary.percent()
	}

	/// Re-resolve when the active pane/tab changed, or once per second.
	pub fn refresh(&mut self, state: &AppState, agents: &AgentSessions, now: Instant) {
		let Some(roots) = self.roots.clone() else {
			self.resolved = None;
			return;
		};
		let key = source_key(state, agents);
		let stale = self.key.as_deref() != Some(key.as_str());
		let due = self
			.last_read
			.is_none_or(|read| now.saturating_duration_since(read) >= REFRESH);
		if stale || due {
			self.resolved = resolve(state, agents, &roots);
			self.key = Some(key);
			self.last_read = Some(now);
			self.apply_window_hint();
		}
		self.poll_window();
		self.start_window_probe(state, agents, now);
	}

	/// A journal may not record the model window; the live gateway does. Fold
	/// a learned window into the same conversation, never into another one.
	fn apply_window_hint(&mut self) {
		let Some((session, window)) = self.window_hint.as_ref() else {
			return;
		};
		let Some(resolved) = self.resolved.as_mut() else {
			return;
		};
		if resolved.origin == Origin::Pane
			&& resolved.summary.id.as_deref() == Some(session.as_str())
			&& resolved.summary.window.is_none()
		{
			resolved.summary.window = Some(*window);
		}
	}

	fn poll_window(&mut self) {
		let outcome = self
			.probe
			.as_ref()
			.map(|probe| (probe.session.clone(), probe.window.try_recv()));
		let Some((session, result)) = outcome else {
			return;
		};
		match result {
			Ok(Some(window)) => {
				self.window_hint = Some((session, window));
				self.probe = None;
				self.apply_window_hint();
			},
			Ok(None) | Err(TryRecvError::Disconnected) => self.probe = None,
			Err(TryRecvError::Empty) => {},
		}
	}

	/// Start one non-blocking `GET /api/agent/<id>/context` for the attached
	/// session. Only the window is taken: the token figures stay the journal's.
	fn start_window_probe(&mut self, state: &AppState, agents: &AgentSessions, now: Instant) {
		if self.probe.is_some() {
			return;
		}
		let Some(origin) = self.origin.as_deref() else {
			return;
		};
		let Some(session) = attached_session(state, agents) else {
			return;
		};
		if self
			.window_hint
			.as_ref()
			.is_some_and(|(seen, _)| seen == &session)
		{
			return;
		}
		if self.last_probe.as_ref().is_some_and(|(seen, at)| {
			seen == &session && now.saturating_duration_since(*at) < WINDOW_RETRY
		}) {
			return;
		}
		let path = format!("/api/agent/{session}/context");
		let origin = origin.to_owned();
		let (sender, window) = channel();
		std::thread::spawn(move || {
			let window = crate::usage::http_get(&origin, &path)
				.ok()
				.and_then(|body| decode_context_window(&body));
			let _ = sender.send(window);
		});
		self.last_probe = Some((session.clone(), now));
		self.probe = Some(WindowProbe { session, window });
	}
}

/// The attached gateway session of the active Agent tab.
fn attached_session(state: &AppState, agents: &AgentSessions) -> Option<String> {
	state
		.active_session_tab()
		.filter(|tab| tab.kind == SessionKind::Agent)
		.and_then(|tab| agents.pane(&tab.id))
		.and_then(|pane| pane.session.clone())
}

/// `GET /api/agent/<id>/context` → its `context.contextWindow`, when live.
fn decode_context_window(body: &str) -> Option<u64> {
	let value: Value = serde_json::from_str(body).ok()?;
	value
		.get("context")
		.and_then(|context| context.get("contextWindow"))
		.and_then(Value::as_u64)
		.filter(|window| *window > 0)
}

/// The active pane + tab + attached session, as one comparable string.
fn source_key(state: &AppState, agents: &AgentSessions) -> String {
	let workspace = state
		.active_workspace()
		.map(|workspace| workspace.path.clone())
		.unwrap_or_default();
	let pane = state
		.active_pane()
		.map(|pane| pane.id.clone())
		.unwrap_or_default();
	let tab = state.active_session_tab();
	let tab_id = tab.map(|tab| tab.id.clone()).unwrap_or_default();
	let session = tab
		.filter(|tab| tab.kind == SessionKind::Agent)
		.and_then(|tab| agents.pane(&tab.id))
		.and_then(|pane| pane.session.clone())
		.unwrap_or_default();
	let live = tab
		.and_then(|tab| agents.pane(&tab.id))
		.map(|pane| format!("{}:{}", pane.usage.usage_entries, pane.usage.last.unwrap_or(0)))
		.unwrap_or_default();
	format!("{workspace}\u{1f}{pane}\u{1f}{tab_id}\u{1f}{session}\u{1f}{live}")
}

fn usage_of(entry: &Value) -> Option<&Map<String, Value>> {
	entry
		.get("usage")
		.or_else(|| {
			entry
				.get("message")
				.and_then(|message| message.get("usage"))
		})
		.and_then(Value::as_object)
}

fn context_of(entry: &Value) -> Option<u64> {
	let snapshot = entry.get("contextSnapshot").or_else(|| {
		entry
			.get("message")
			.and_then(|message| message.get("contextSnapshot"))
	})?;
	number(snapshot.as_object()?, "promptTokens").map(|tokens| tokens.max(0.0) as u64)
}

fn window_of(entry: &Value) -> Option<u64> {
	let message = entry.get("message");
	let usage = usage_of(entry);
	[
		entry.get("contextWindow"),
		message.and_then(|message| message.get("contextWindow")),
		usage.and_then(|usage| usage.get("contextWindow")),
	]
	.into_iter()
	.flatten()
	.find_map(|value| value.as_u64())
	.filter(|window| *window > 0)
}

fn total_tokens(usage: &Map<String, Value>) -> u64 {
	if let Some(total) = uint_opt(usage, "totalTokens") {
		return total;
	}
	uint(usage, "input")
		+ uint(usage, "output")
		+ uint(usage, "cacheRead")
		+ uint(usage, "cacheWrite")
}

fn uint(map: &Map<String, Value>, key: &str) -> u64 {
	uint_opt(map, key).unwrap_or(0)
}

fn uint_opt(map: &Map<String, Value>, key: &str) -> Option<u64> {
	number(map, key).map(|value| value.max(0.0) as u64)
}

fn number(map: &Map<String, Value>, key: &str) -> Option<f64> {
	map.get(key).and_then(Value::as_f64)
}

fn timestamp_of(entry: &Value) -> Option<i64> {
	let value = entry.get("timestamp").or_else(|| {
		entry
			.get("message")
			.and_then(|message| message.get("timestamp"))
	})?;
	if let Some(ms) = value.as_i64() {
		// The runtime writes milliseconds; a seconds value would be ten digits.
		return Some(if ms.abs() < 100_000_000_000 {
			ms.saturating_mul(1000)
		} else {
			ms
		});
	}
	let text = value.as_str()?;
	chrono::DateTime::parse_from_rfc3339(text)
		.ok()
		.map(|time| time.timestamp_millis())
}

/// The text parts of an entry (or its plain `text`), as `agent.rs` reads them.
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

/// One line, at most [`TITLE_CAP`] characters, from the first user message.
fn digest(text: &str) -> String {
	const TITLE_CAP: usize = 60;
	let line = text
		.lines()
		.map(str::trim)
		.find(|line| !line.is_empty())
		.unwrap_or_default();
	if line.chars().count() <= TITLE_CAP {
		return line.to_owned();
	}
	let mut short: String = line.chars().take(TITLE_CAP).collect();
	short.push('…');
	short
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::state::AppState;

	const FIXTURE: &str = include_str!("usage/fixtures/session-usage.jsonl");

	fn state_at(project: &Path, home: &Path) -> AppState {
		AppState::seeded_with_registry(
			project,
			workbench_projects::Registry::empty_at(home.join("projects.json")),
		)
	}

	fn write_log(directory: &Path, name: &str, title: &str, window: Option<u64>) -> PathBuf {
		std::fs::create_dir_all(directory).expect("session directory");
		let window = window
			.map(|window| format!(r#","contextWindow":{window}"#))
			.unwrap_or_default();
		let log = format!(
			r#"{{"type":"session","id":"{name}","timestamp":"2026-10-18T09:00:00.000Z","cwd":"C:\\work"}}
{{"type":"message","timestamp":"2026-10-18T09:01:00.000Z","message":{{"role":"user","content":[{{"type":"text","text":"{title}"}}]}}}}
{{"type":"message","timestamp":"2026-10-18T09:02:00.000Z"{window},"message":{{"role":"assistant","model":"fixture-model","content":[{{"type":"text","text":"ok"}}],"usage":{{"input":100,"output":20,"totalTokens":120,"cost":{{"total":0.02}}}}}}}}
"#
		);
		let path = directory.join(format!("2026-10-18T09-00-00-000Z_{name}.jsonl"));
		std::fs::write(&path, log).expect("write journal");
		path
	}

	#[test]
	fn the_fixture_log_yields_tokens_and_the_window_share() {
		let summary = summarize_log(FIXTURE);
		assert_eq!(summary.id.as_deref(), Some("fixture-conv"));
		assert_eq!(summary.title.as_deref(), Some("把这一页的用量讲清楚"));
		assert_eq!(summary.input, 1300);
		assert_eq!(summary.output, 300);
		assert_eq!(summary.total, 1600);
		assert_eq!(summary.cost_text().as_deref(), Some("$0.16"));
		assert_eq!(summary.model.as_deref(), Some("fixture-model"));
		assert_eq!(summary.window, Some(2000));
		assert_eq!(summary.context_tokens(), 1600);
		assert_eq!(summary.percent(), Some(80.0));
		assert_eq!(summary.usage_entries, 2);
		assert!(summary.last.is_some(), "the last entry has a time");
	}

	#[test]
	fn a_missing_window_never_produces_a_percentage() {
		let summary = summarize_log(
			r#"{"type":"message","timestamp":"2026-10-18T09:00:00.000Z","message":{"role":"assistant","usage":{"input":10,"output":5,"totalTokens":15}}}"#,
		);
		assert_eq!(summary.total, 15);
		assert_eq!(summary.window, None);
		assert_eq!(summary.percent(), None);
		assert_eq!(summary.context_tokens(), 15);
	}

	#[test]
	fn the_active_tab_switch_changes_the_resolved_conversation() {
		let home = tempfile::tempdir().expect("home");
		let project = home.path().join("project");
		std::fs::create_dir_all(&project).expect("project");
		let roots = SessionRoots::at(home.path().to_path_buf(), std::env::temp_dir());
		let directory = roots.project_dir(&project);
		write_log(&directory, "conv-a", "会话 A", Some(2000));
		write_log(&directory, "conv-b", "会话 B", Some(2000));

		let mut state = state_at(&project, home.path());
		let pane = state.active_workspace().expect("workspace").panes[0]
			.id
			.clone();
		state.tui_pane = Some(pane.clone());
		let first = state.active_workspace().unwrap().panes[0].tabs[0]
			.id
			.clone();
		assert!(
			state
				.add_tab_of(&pane, SessionKind::Agent, "Agent A".to_owned())
				.0
				.is_empty()
		);
		let tab_a = state.active_workspace().unwrap().panes[0].active.clone();
		assert!(
			state
				.add_tab_of(&pane, SessionKind::Agent, "Agent B".to_owned())
				.0
				.is_empty()
		);
		let tab_b = state.active_workspace().unwrap().panes[0].active.clone();
		assert_ne!(tab_a, tab_b);

		let mut agents = AgentSessions::default();
		agents.ensure(&tab_a).session = Some("conv-a".to_owned());
		agents.ensure(&tab_b).session = Some("conv-b".to_owned());

		state.select_tab(&pane, &tab_a);
		let a = resolve(&state, &agents, &roots).expect("tab A resolves");
		assert_eq!(a.origin, Origin::Pane);
		assert_eq!(a.summary.id.as_deref(), Some("conv-a"));
		assert_eq!(a.summary.title.as_deref(), Some("会话 A"));

		state.select_tab(&pane, &tab_b);
		let b = resolve(&state, &agents, &roots).expect("tab B resolves");
		assert_eq!(b.origin, Origin::Pane);
		assert_eq!(b.summary.id.as_deref(), Some("conv-b"));
		assert_eq!(b.summary.title.as_deref(), Some("会话 B"));

		// A non-agent tab falls through to the newest journal.
		state.select_tab(&pane, &first);
		let latest = resolve(&state, &agents, &roots).expect("a journal exists");
		assert_eq!(latest.origin, Origin::LatestLog);
	}

	#[test]
	fn the_empty_state_is_one_line_and_has_no_number() {
		let home = tempfile::tempdir().expect("home");
		let project = home.path().join("project");
		std::fs::create_dir_all(&project).expect("project");
		let roots = SessionRoots::at(home.path().to_path_buf(), std::env::temp_dir());
		let state = state_at(&project, home.path());
		assert!(resolve(&state, &AgentSessions::default(), &roots).is_none());
		assert_eq!(NO_SESSION, "这一页没有会话");
		assert!(!NO_SESSION.chars().any(|c| c.is_ascii_digit()));
		assert_eq!(status_label(None), "上文 —");
		assert_eq!(status_label(Some(37.4)), "上文 37%");
	}

	#[test]
	fn a_live_context_report_supplies_only_the_window() {
		assert_eq!(
			decode_context_window(r#"{"running":true,"context":{"contextWindow":200000}}"#),
			Some(200_000)
		);
		assert_eq!(decode_context_window(r#"{"running":false,"tools":[]}"#), None);
		assert_eq!(decode_context_window(r#"{"running":true,"context":{"contextWindow":0}}"#), None);
	}

	#[test]
	fn a_live_pane_accumulates_the_frames_it_saw() {
		let mut summary = UsageSummary::default();
		summary.observe(&serde_json::json!({
			"type": "message",
			"timestamp": "2026-10-18T09:00:00.000Z",
			"message": {"role": "user", "content": [{"type": "text", "text": "live"}]}
		}));
		summary.observe(&serde_json::json!({
			"type": "message",
			"timestamp": "2026-10-18T09:01:00.000Z",
			"message": {"role": "assistant", "model": "m", "usage": {"input": 4, "output": 6, "totalTokens": 10}}
		}));
		assert_eq!(summary.title.as_deref(), Some("live"));
		assert_eq!(summary.total, 10);
		assert_eq!(summary.model.as_deref(), Some("m"));
	}
}
