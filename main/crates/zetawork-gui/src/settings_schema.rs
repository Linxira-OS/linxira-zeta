// SPDX-License-Identifier: AGPL-3.0-only
//! The complete settings surface: the gateway's schema, drawn natively.
//!
//! # Why this exists
//!
//! [`crate::settings`] owns the settings zetawork itself needs to start (window
//! lifecycle, theme, fonts, shells), and it can only ever know the keys it
//! wrote down. Everything zetacode exposes — ten tabs, hundreds of typed
//! settings — lives in `settings-schema.ts` and is already published by the
//! gateway as `GET /api/settings`: tabs, localized groups, typed entries with
//! their current value and options. This module reads that document and turns
//! it into the 全部设置 section, so a setting that exists in the schema cannot
//! be reachable only from `web-ui`.
//!
//! # Data flow
//!
//! ```text
//! GET  /api/settings?lang=zh|en   → parse_catalog → Catalog → tree(query)
//! PUT  /api/settings {path,value} → re-GET       → replaced Catalog
//! ```
//!
//! The values are read and written through the same handlers the web UI and
//! the CLI use, so the GUI cannot drift into a second file format or a second
//! definition of a default. A write is never optimistic: the response is
//! re-read and the controls are redrawn from the gateway's answer.
//!
//! # Secrets
//!
//! The gateway masks credential values (`"••••"` plus `secret: true`). A
//! [`Entry`] with [`ControlKind::Secret`] renders the mask and an *empty*
//! password field; the previous value is never read into the UI, and typing a
//! new one sends only the new value. [`Entry::display_value`] is the single
//! place a value becomes text, so no other call site can print a secret.
//!
//! # Language
//!
//! The gateway localizes labels, descriptions, group headings, tab names and
//! option text from the `lang` query parameter / `Accept-Language` header.
//! [`SchemaCache::ensure`] therefore re-fetches when [`crate::i18n::Lang`]
//! changes; the catalog stores the language it was fetched in, so a stale
//! answer cannot masquerade as the new one.

use std::{
	collections::{BTreeMap, HashMap},
	io::{Read, Write},
	sync::{Arc, mpsc},
	time::Duration,
};

use serde_json::{Value, json};

use crate::{i18n::Lang, t};

/// The value the gateway sends for a credential, and the only text this module
/// ever renders for one.
pub const MASK: &str = "••••";

/// How long a gateway request may take before the section reports it.
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

// ═══════════════════════════════════════════════════════════════════════════
// DTOs
// ═══════════════════════════════════════════════════════════════════════════

/// The control a setting's schema type maps to.
///
/// The gateway's `type` field already closes this set; the names here are the
/// ones the renderer switches on, so the mapping is total and testable.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ControlKind {
	/// `boolean` — the switch.
	Toggle,
	/// `enum` with a `values` list, or `enum`/`submenu` with options.
	Select,
	/// `number` without a choice list (the CLI hides these; kept so a future
	/// schema addition renders instead of silently disappearing).
	Number,
	/// `text` — a free-form string.
	Text,
	/// `text` + `secret` — masked; edits are write-only.
	Secret,
	/// `multiselect` — one checkbox per option, value is an array.
	MultiSelect,
	/// `providerLimits` — a JSON object of provider → number.
	ProviderLimits,
	/// `modelRoles` — a JSON object of role → model.
	ModelRoles,
}

/// One localized choice of a `Select`/`MultiSelect`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OptionInfo {
	pub value: String,
	pub label: String,
	pub description: Option<String>,
}

/// One schema setting with its current value.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
	pub path: String,
	pub kind: ControlKind,
	pub label: String,
	pub description: String,
	pub tab: String,
	pub group: Option<String>,
	pub value: Value,
	pub default: Value,
	pub options: Vec<OptionInfo>,
	/// Raw enum values for an `enum` without options.
	pub values: Vec<String>,
	/// Condition result from the gateway; a hidden row is not drawn.
	pub visible: bool,
}

impl Entry {
	/// The text a row shows for its current value.
	///
	/// This is the only function that turns a value into text, so a secret has
	/// exactly one rendering and it is the mask.
	pub fn display_value(&self) -> String {
		if self.kind == ControlKind::Secret {
			return MASK.to_owned();
		}
		match &self.value {
			Value::Null => String::new(),
			Value::String(text) => text.clone(),
			Value::Array(items) => items
				.iter()
				.map(|item| match item {
					Value::String(text) => text.clone(),
					other => other.to_string(),
				})
				.collect::<Vec<_>>()
				.join(", "),
			Value::Object(_) => self.value.to_string(),
			other => other.to_string(),
		}
	}

	/// The localized label of one option value, or the raw value when the
	/// gateway did not offer a label (a runtime submenu is empty).
	pub fn option_label(&self, value: &str) -> String {
		self
			.options
			.iter()
			.find(|option| option.value == value)
			.map(|option| option.label.clone())
			.unwrap_or_else(|| value.to_owned())
	}

	/// Does this row match a lowercase search needle?
	pub fn matches(&self, needle: &str) -> bool {
		self.label.to_lowercase().contains(needle)
			|| self.description.to_lowercase().contains(needle)
			|| self.path.to_lowercase().contains(needle)
			|| self
				.options
				.iter()
				.any(|option| option.label.to_lowercase().contains(needle))
	}
}

/// A tab as the gateway named it, in the gateway's order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TabInfo {
	pub id: String,
	pub label: String,
}

/// The whole `GET /api/settings` document.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Catalog {
	pub tabs: Vec<TabInfo>,
	/// Localized group headings per tab, in the gateway's display order.
	pub groups: BTreeMap<String, Vec<String>>,
	pub entries: Vec<Entry>,
}

impl Catalog {
	/// Rows of one tab that the gateway marked visible.
	pub fn entries_for<'a>(&'a self, tab: &'a str) -> impl Iterator<Item = &'a Entry> + 'a {
		self
			.entries
			.iter()
			.filter(move |entry| entry.tab == tab && entry.visible)
	}

	/// The tab → group → row tree for a search needle.
	///
	/// * with no query: every visible row, grouped in `groups[tab]` order,
	///   ungrouped rows first, unknown groups appended in first-seen order;
	/// * a tab whose label matches shows all its rows;
	/// * a group whose heading matches shows all that group's rows;
	/// * otherwise only matching rows, and empty groups/tabs disappear.
	///
	/// The result borrows the catalog; the renderer clones only the active
	/// tab's rows, so drawing a frame does not copy the whole schema.
	pub fn tree(&self, query: &str) -> Vec<TabNode<'_>> {
		let needle = query.trim().to_lowercase();
		let mut out = Vec::new();
		for tab in &self.tabs {
			let tab_matches = !needle.is_empty() && tab.label.to_lowercase().contains(&needle);
			let declared = self.groups.get(&tab.id).cloned().unwrap_or_default();
			let rows: Vec<&Entry> = self.entries_for(&tab.id).collect();

			// Ungrouped rows first, then the declared headings, then any group
			// the gateway emitted without listing it.
			let mut headings: Vec<Option<String>> = vec![None];
			headings.extend(declared.iter().cloned().map(Some));
			for entry in &rows {
				if let Some(group) = &entry.group {
					if !declared.contains(group) && !headings.contains(&Some(group.clone())) {
						headings.push(Some(group.clone()));
					}
				}
			}

			let mut groups = Vec::new();
			for heading in headings {
				let group_entries: Vec<&Entry> = rows
					.iter()
					.copied()
					.filter(|entry| entry.group.as_deref() == heading.as_deref())
					.collect();
				if group_entries.is_empty() {
					continue;
				}
				let heading_matches = heading.as_ref().is_some_and(|heading| {
					!needle.is_empty() && heading.to_lowercase().contains(&needle)
				});
				let keep_all = needle.is_empty() || tab_matches || heading_matches;
				let kept: Vec<&Entry> = if keep_all {
					group_entries
				} else {
					group_entries
						.into_iter()
						.filter(|entry| entry.matches(&needle))
						.collect()
				};
				if !kept.is_empty() {
					groups.push(GroupNode { label: heading, entries: kept });
				}
			}
			if !groups.is_empty() {
				out.push(TabNode { id: &tab.id, label: &tab.label, groups });
			}
		}
		out
	}
}

/// One group of rows in a tab.
#[derive(Debug)]
pub struct GroupNode<'a> {
	/// `None` for rows the schema leaves ungrouped.
	pub label: Option<String>,
	pub entries: Vec<&'a Entry>,
}

/// One tab of the tree.
#[derive(Debug)]
pub struct TabNode<'a> {
	pub id: &'a str,
	pub label: &'a str,
	pub groups: Vec<GroupNode<'a>>,
}

impl<'a> TabNode<'a> {
	/// How many rows the tab kept after the query filter.
	pub fn row_count(&self) -> usize {
		self.groups.iter().map(|group| group.entries.len()).sum()
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Parsing
// ═══════════════════════════════════════════════════════════════════════════

/// Parse a `GET /api/settings` body.
pub fn parse_catalog(body: &str) -> Result<Catalog, String> {
	let value: Value =
		serde_json::from_str(body).map_err(|error| t!("设置 schema 不是 JSON：{}", error))?;
	let object = value
		.as_object()
		.ok_or_else(|| t!("设置 schema 不是对象").to_owned())?;

	let tabs = array(object.get("tabs"), "tabs")?
		.iter()
		.enumerate()
		.map(|(index, tab)| {
			let tab = tab
				.as_object()
				.ok_or_else(|| t!("tabs[{}] 不是对象", index))?;
			Ok(TabInfo {
				id: field(tab, "id", &format!("tabs[{index}]"))?,
				label: field(tab, "label", &format!("tabs[{index}]"))?,
			})
		})
		.collect::<Result<Vec<_>, String>>()?;

	let mut groups = BTreeMap::new();
	if let Some(raw) = object.get("groups") {
		let raw = raw
			.as_object()
			.ok_or_else(|| t!("groups 不是对象").to_owned())?;
		for (tab, headings) in raw {
			let headings = headings
				.as_array()
				.ok_or_else(|| t!("groups.{} 不是数组", tab))?;
			let headings = headings
				.iter()
				.enumerate()
				.map(|(index, heading)| {
					heading
						.as_str()
						.map(str::to_owned)
						.ok_or_else(|| t!("groups.{}[{}] 不是字符串", tab, index))
				})
				.collect::<Result<Vec<_>, String>>()?;
			groups.insert(tab.clone(), headings);
		}
	}

	let entries = array(object.get("settings"), "settings")?
		.iter()
		.enumerate()
		.map(|(index, entry)| parse_entry(entry, index))
		.collect::<Result<Vec<_>, String>>()?;

	Ok(Catalog { tabs, groups, entries })
}

fn array<'a>(value: Option<&'a Value>, name: &str) -> Result<&'a Vec<Value>, String> {
	value
		.and_then(Value::as_array)
		.ok_or_else(|| t!("设置 schema 缺少 {} 数组", name))
}

fn field(object: &serde_json::Map<String, Value>, key: &str, at: &str) -> Result<String, String> {
	object
		.get(key)
		.and_then(Value::as_str)
		.map(str::to_owned)
		.ok_or_else(|| t!("{} 缺少 {}", at, key))
}

fn parse_entry(value: &Value, index: usize) -> Result<Entry, String> {
	let at = format!("settings[{}]", index);
	let object = value.as_object().ok_or_else(|| t!("{} 不是对象", at))?;
	let path = field(object, "path", &at)?;
	let label = object
		.get("label")
		.and_then(Value::as_str)
		.unwrap_or(&path)
		.to_owned();
	let description = object
		.get("description")
		.and_then(Value::as_str)
		.unwrap_or_default()
		.to_owned();
	let tab = field(object, "tab", &at)?;
	let group = object
		.get("group")
		.and_then(Value::as_str)
		.map(str::to_owned);
	let secret = object
		.get("secret")
		.and_then(Value::as_bool)
		.unwrap_or(false);
	let kind = match object.get("type").and_then(Value::as_str) {
		Some("boolean") => ControlKind::Toggle,
		Some("enum") | Some("submenu") => ControlKind::Select,
		Some("number") => ControlKind::Number,
		Some("multiselect") => ControlKind::MultiSelect,
		Some("providerLimits") => ControlKind::ProviderLimits,
		Some("modelRoles") => ControlKind::ModelRoles,
		Some("text") if secret => ControlKind::Secret,
		// `text` and any future type fall back to a plain field, the same
		// fallback the web handler applies to records without a control.
		_ => ControlKind::Text,
	};
	let options = object
		.get("options")
		.and_then(Value::as_array)
		.map(|options| {
			options
				.iter()
				.filter_map(|option| {
					let option = option.as_object()?;
					let value = option.get("value")?.as_str()?.to_owned();
					let label = option
						.get("label")
						.and_then(Value::as_str)
						.map(str::to_owned)
						.unwrap_or_else(|| value.clone());
					Some(OptionInfo {
						value,
						label,
						description: option
							.get("description")
							.and_then(Value::as_str)
							.map(str::to_owned),
					})
				})
				.collect()
		})
		.unwrap_or_default();
	let values = object
		.get("values")
		.and_then(Value::as_array)
		.map(|values| {
			values
				.iter()
				.filter_map(|value| value.as_str().map(str::to_owned))
				.collect()
		})
		.unwrap_or_default();
	Ok(Entry {
		path,
		kind,
		label,
		description,
		tab,
		group,
		value: object.get("value").cloned().unwrap_or(Value::Null),
		default: object.get("default").cloned().unwrap_or(Value::Null),
		options,
		values,
		visible: object
			.get("visible")
			.and_then(Value::as_bool)
			.unwrap_or(true),
	})
}

// ═══════════════════════════════════════════════════════════════════════════
// Gateway
// ═══════════════════════════════════════════════════════════════════════════

/// The two requests this section makes. Tests implement this against a stub;
/// the shell uses [`HttpGateway`].
pub trait Gateway: Send + Sync {
	/// Fetch the catalog for `lang`. The returned body is parsed by the cache.
	fn get(&self, lang: Lang) -> Result<String, String>;
	/// Persist one value; success means the gateway answered 2xx.
	fn put(&self, path: &str, value: &Value) -> Result<(), String>;
}

/// The live gateway at the origin `~/.zeta/serve.json` publishes.
#[derive(Clone, Debug)]
pub struct HttpGateway {
	origin: String,
}

impl HttpGateway {
	pub fn new(origin: impl Into<String>) -> Self {
		Self { origin: origin.into() }
	}
}

impl Gateway for HttpGateway {
	fn get(&self, lang: Lang) -> Result<String, String> {
		let path = format!("/api/settings?lang={}", lang.key());
		let accept = match lang {
			Lang::Zh => "zh-CN",
			Lang::En => "en-US",
		};
		let (status, body) = request(&self.origin, "GET", &path, None, accept)?;
		if (200..300).contains(&status) {
			Ok(body)
		} else {
			Err(t!("读取设置失败（{}）：{}", status, error_text(&body)))
		}
	}

	fn put(&self, path: &str, value: &Value) -> Result<(), String> {
		let body = json!({ "path": path, "value": value }).to_string();
		let (status, body) = request(&self.origin, "PUT", "/api/settings", Some(&body), "en-US")?;
		if (200..300).contains(&status) {
			Ok(())
		} else {
			Err(t!("写入设置失败（{}）：{}", status, error_text(&body)))
		}
	}
}

/// One hand-rolled HTTP/1.1 request; returns `(status, body)`.
fn request(
	origin: &str,
	method: &str,
	path: &str,
	body: Option<&str>,
	accept_language: &str,
) -> Result<(u16, String), String> {
	let (host, port, authority) = crate::ws::origin_endpoint(origin)?;
	let mut stream = crate::ws::dial(&host, port, HTTP_TIMEOUT)?;
	stream
		.set_read_timeout(Some(HTTP_TIMEOUT))
		.map_err(|error| t!("设置读超时失败：{}", error))?;
	stream
		.set_write_timeout(Some(HTTP_TIMEOUT))
		.map_err(|error| t!("设置写超时失败：{}", error))?;
	let payload = body.unwrap_or_default();
	let request = format!(
		"{method} {path} HTTP/1.1\r\nHost: {authority}\r\nAccept: application/json\r\n\
		 Accept-Language: {accept_language}\r\nContent-Type: application/json\r\n\
		 Content-Length: {}\r\nConnection: close\r\n\r\n{payload}",
		payload.len()
	);
	stream
		.write_all(request.as_bytes())
		.map_err(|error| t!("发送 {} 失败：{}", path, error))?;
	let mut response = String::new();
	stream
		.read_to_string(&mut response)
		.map_err(|error| t!("读取 {} 应答失败：{}", path, error))?;
	let status = response
		.lines()
		.next()
		.and_then(|line| line.split_whitespace().nth(1))
		.and_then(|status| status.parse().ok())
		.ok_or_else(|| t!("{} 的应答没有状态行", path))?;
	let body = response
		.split_once("\r\n\r\n")
		.map(|(_, body)| body.to_owned())
		.unwrap_or_default();
	Ok((status, body))
}

/// The gateway's `error` string when the body is JSON, else its head.
fn error_text(body: &str) -> String {
	let message = serde_json::from_str::<Value>(body)
		.ok()
		.and_then(|value| {
			value
				.get("error")
				.and_then(Value::as_str)
				.map(str::to_owned)
		})
		.unwrap_or_else(|| body.trim().chars().take(160).collect());
	if message.is_empty() {
		t!("（无错误说明）").to_owned()
	} else {
		message
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Cache
// ═══════════════════════════════════════════════════════════════════════════

/// The result of one background job.
enum Job {
	Loaded { lang: Lang, result: Result<Catalog, String> },
	Written { lang: Lang, path: String, result: Result<Catalog, String> },
}

/// The 全部设置 section's state: the catalog, the language and query it was
/// read for, one in-flight request, and the text drafts.
#[derive(Default)]
pub struct SchemaCache {
	catalog: Option<Catalog>,
	error: Option<String>,
	loaded_lang: Option<Lang>,
	wanted_lang: Option<Lang>,
	failed_lang: Option<Lang>,
	job: Option<mpsc::Receiver<Job>>,
	/// The search box's text, owned here so the section can draw it.
	pub query: String,
	/// The selected tab id; `None` until the first tree chooses one.
	pub tab: Option<String>,
	drafts: HashMap<String, String>,
}

impl SchemaCache {
	/// A cache already holding a catalog — the headless path for the
	/// screenshots and the shell tests that must not open a socket.
	pub fn fixture(body: &str, lang: Lang) -> Result<Self, String> {
		Ok(Self {
			catalog: Some(parse_catalog(body)?),
			loaded_lang: Some(lang),
			wanted_lang: Some(lang),
			..Self::default()
		})
	}

	pub fn catalog(&self) -> Option<&Catalog> {
		self.catalog.as_ref()
	}

	pub fn error(&self) -> Option<&str> {
		self.error.as_deref()
	}

	pub fn loading(&self) -> bool {
		self.job.is_some()
	}

	/// The language the current catalog was fetched in.
	pub fn loaded_lang(&self) -> Option<Lang> {
		self.loaded_lang
	}

	/// Start a load when the catalog is missing or belongs to another
	/// language. A previous failure is not retried by the draw loop — the
	/// section offers 重试 — so an unreachable gateway cannot spin.
	pub fn ensure(&mut self, gateway: Arc<dyn Gateway>, lang: Lang) {
		self.wanted_lang = Some(lang);
		if self.job.is_some() {
			return;
		}
		if self.catalog.is_some() && self.loaded_lang == Some(lang) {
			return;
		}
		if self.failed_lang == Some(lang) {
			return;
		}
		self.start_load(gateway, lang);
	}

	/// Fetch again, clearing a remembered failure (the 重试 control and a
	/// language switch use it).
	pub fn reload(&mut self, gateway: Arc<dyn Gateway>, lang: Lang) {
		self.failed_lang = None;
		self.start_load(gateway, lang);
	}

	fn start_load(&mut self, gateway: Arc<dyn Gateway>, lang: Lang) {
		if self.job.is_some() {
			return;
		}
		self.wanted_lang = Some(lang);
		self.failed_lang = None;
		let (sender, receiver) = mpsc::channel();
		std::thread::spawn(move || {
			let result = gateway.get(lang).and_then(|body| parse_catalog(&body));
			let _ = sender.send(Job::Loaded { lang, result });
		});
		self.job = Some(receiver);
	}

	/// Persist one value, then re-read the catalog in `lang`.
	///
	/// A write is refused while another request is in flight; the caller keeps
	/// the control's value until the re-read lands.
	pub fn start_write(&mut self, gateway: Arc<dyn Gateway>, lang: Lang, path: &str, value: Value) {
		if self.job.is_some() {
			return;
		}
		let path = path.to_owned();
		let (sender, receiver) = mpsc::channel();
		let write_path = path.clone();
		std::thread::spawn(move || {
			let result = gateway
				.put(&write_path, &value)
				.and_then(|()| gateway.get(lang))
				.and_then(|body| parse_catalog(&body));
			let _ = sender.send(Job::Written { lang, path: write_path, result });
		});
		self.job = Some(receiver);
	}

	/// Take a finished job. Returns `true` when the catalog or the error
	/// changed, so the shell can repaint.
	pub fn poll(&mut self) -> bool {
		let Some(receiver) = self.job.as_ref() else {
			return false;
		};
		let Ok(job) = receiver.try_recv() else {
			return false;
		};
		self.job = None;
		match job {
			Job::Loaded { lang, result } => match result {
				Ok(catalog) => {
					self.catalog = Some(catalog);
					self.loaded_lang = Some(lang);
					if self.wanted_lang == Some(lang) {
						self.error = None;
					}
				},
				Err(error) => {
					self.error = Some(error);
					self.failed_lang = Some(lang);
				},
			},
			Job::Written { lang, path, result } => match result {
				Ok(catalog) => {
					self.catalog = Some(catalog);
					self.loaded_lang = Some(lang);
					self.error = None;
					self.drafts.remove(&path);
				},
				Err(error) => self.error = Some(error),
			},
		}
		true
	}

	/// Synchronous load — the tests' entry point, and the shape `ensure`
	/// drives on a worker thread.
	pub fn load_now(&mut self, gateway: &dyn Gateway, lang: Lang) -> Result<(), String> {
		let body = gateway.get(lang)?;
		let catalog = parse_catalog(&body)?;
		self.catalog = Some(catalog);
		self.loaded_lang = Some(lang);
		self.wanted_lang = Some(lang);
		self.failed_lang = None;
		self.error = None;
		Ok(())
	}

	/// Synchronous write + re-read — the round trip a control performs.
	pub fn write_now(
		&mut self,
		gateway: &dyn Gateway,
		lang: Lang,
		path: &str,
		value: Value,
	) -> Result<(), String> {
		gateway.put(path, &value)?;
		let body = gateway.get(lang)?;
		let catalog = parse_catalog(&body)?;
		self.catalog = Some(catalog);
		self.loaded_lang = Some(lang);
		self.wanted_lang = Some(lang);
		self.failed_lang = None;
		self.error = None;
		self.drafts.remove(path);
		Ok(())
	}

	/// The draft string of an editable text row, seeded from the value the
	/// gateway reported. A secret seed is always empty.
	pub fn draft(&mut self, entry: &Entry) -> &mut String {
		let seed = if entry.kind == ControlKind::Secret {
			String::new()
		} else {
			entry.display_value()
		};
		self.drafts.entry(entry.path.clone()).or_insert(seed)
	}

	/// Record a local failure (no gateway address, for instance) without
	/// opening a request; the next successful load clears it.
	pub fn set_error(&mut self, text: String) {
		self.error = Some(text);
	}

	/// Replace a draft (a rejected write puts the typed text back).
	pub fn set_draft(&mut self, path: &str, text: impl Into<String>) {
		self.drafts.insert(path.to_owned(), text.into());
	}

	/// The row currently held by `path`, if the catalog has one.
	pub fn entry(&self, path: &str) -> Option<&Entry> {
		self
			.catalog
			.as_ref()?
			.entries
			.iter()
			.find(|entry| entry.path == path)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::Mutex;

	/// The fixture every test drives: ten tabs (the point of the section), a
	/// group tree, every control kind, an invisible row and a credential.
	const FIXTURE: &str = r#"{
		"tabs": [
			{"id": "appearance", "label": "Appearance"},
			{"id": "model", "label": "Model"}
		],
		"groups": {
			"appearance": ["General", "Display"],
			"model": ["Thinking"]
		},
		"settings": [
			{"path": "language", "type": "submenu", "label": "Language", "description": "UI language",
			 "tab": "appearance", "group": "General", "value": "en", "default": "en",
			 "options": [{"value": "en", "label": "English"}, {"value": "zh", "label": "中文"}], "visible": true},
			{"path": "theme.dark", "type": "submenu", "label": "Dark Theme", "description": "",
			 "tab": "appearance", "group": "Display", "value": "titanium", "default": "titanium",
			 "options": [], "visible": true},
			{"path": "interface.reducedMotion", "type": "boolean", "label": "Reduce motion", "description": "Animations",
			 "tab": "appearance", "group": "General", "value": false, "default": false, "visible": true},
			{"path": "interface.density", "type": "enum", "label": "Density", "description": "",
			 "tab": "appearance", "group": "Display", "value": "comfortable", "default": "comfortable",
			 "values": ["compact", "comfortable", "spacious"], "visible": true},
			{"path": "appearance.fontSize", "type": "number", "label": "Font size", "description": "",
			 "tab": "appearance", "group": "Display", "value": 13, "default": 13, "visible": true},
			{"path": "appearance.notes", "type": "text", "label": "Notes", "description": "Free text",
			 "tab": "appearance", "group": "General", "value": "", "default": "", "visible": true},
			{"path": "hindsight.apiToken", "type": "text", "secret": true, "label": "API token",
			 "description": "Stored credential", "tab": "model", "group": "Thinking",
			 "value": "sk-should-not-render", "default": null, "visible": true},
			{"path": "tools.enabled", "type": "multiselect", "label": "Tools", "description": "",
			 "tab": "model", "group": "Thinking", "value": ["grep"], "default": [],
			 "options": [{"value": "grep", "label": "Grep"}, {"value": "browser", "label": "Browser"}], "visible": true},
			{"path": "providers.maxInFlightRequests", "type": "providerLimits", "label": "In-flight limits",
			 "description": "", "tab": "model", "group": "Thinking", "value": {"acme": 4}, "default": {}, "visible": true},
			{"path": "modelRoles", "type": "modelRoles", "label": "Model roles", "description": "",
			 "tab": "model", "group": "Thinking", "value": {"default": "acme/big"}, "default": {}, "visible": true},
			{"path": "hidden.setting", "type": "boolean", "label": "Hidden", "description": "Not shown",
			 "tab": "appearance", "group": "General", "value": true, "default": true, "visible": false}
		]
	}"#;

	fn catalog() -> Catalog {
		parse_catalog(FIXTURE).expect("fixture parses")
	}

	#[test]
	fn the_tree_keeps_tab_then_group_then_gateway_order() {
		let catalog = catalog();
		let tree = catalog.tree("");
		assert_eq!(tree.len(), 2);
		assert_eq!(tree[0].id, "appearance");
		assert_eq!(tree[0].row_count(), 6, "the invisible row is not drawn");
		// Ungrouped first (none here), then TAB_GROUPS order, not entry order.
		assert_eq!(
			tree[0]
				.groups
				.iter()
				.map(|g| g.label.as_deref())
				.collect::<Vec<_>>(),
			[Some("General"), Some("Display")]
		);
		assert_eq!(
			tree[0].groups[0]
				.entries
				.iter()
				.map(|entry| entry.path.as_str())
				.collect::<Vec<_>>(),
			["language", "interface.reducedMotion", "appearance.notes"]
		);
		assert_eq!(tree[1].id, "model");
		assert_eq!(tree[1].groups[0].label.as_deref(), Some("Thinking"));
	}

	#[test]
	fn an_ungrouped_row_sorts_before_the_declared_groups() {
		let body = FIXTURE.replace(
			"\"tab\": \"appearance\", \"group\": \"General\", \"value\": false",
			"\"tab\": \"appearance\", \"value\": false",
		);
		let catalog = parse_catalog(&body).expect("parses");
		let tree = catalog.tree("");
		assert_eq!(tree[0].groups[0].label, None);
		assert_eq!(tree[0].groups[0].entries[0].path, "interface.reducedMotion");
	}

	#[test]
	fn every_control_kind_maps_from_its_schema_type() {
		let catalog = catalog();
		let kind = |path: &str| {
			catalog
				.entries
				.iter()
				.find(|entry| entry.path == path)
				.unwrap_or_else(|| panic!("{path} missing"))
				.kind
		};
		assert_eq!(kind("language"), ControlKind::Select, "submenu");
		assert_eq!(kind("interface.density"), ControlKind::Select, "enum");
		assert_eq!(kind("interface.reducedMotion"), ControlKind::Toggle);
		assert_eq!(kind("appearance.fontSize"), ControlKind::Number);
		assert_eq!(kind("appearance.notes"), ControlKind::Text);
		assert_eq!(kind("hindsight.apiToken"), ControlKind::Secret);
		assert_eq!(kind("tools.enabled"), ControlKind::MultiSelect);
		assert_eq!(kind("providers.maxInFlightRequests"), ControlKind::ProviderLimits);
		assert_eq!(kind("modelRoles"), ControlKind::ModelRoles);
	}

	#[test]
	fn a_secret_never_renders_its_value() {
		let catalog = catalog();
		let secret = catalog
			.entries
			.iter()
			.find(|entry| entry.path == "hindsight.apiToken")
			.expect("the fixture carries a credential");
		assert_eq!(secret.display_value(), MASK);
		assert!(!secret.display_value().contains("sk-"));
		let mut cache = SchemaCache::fixture(FIXTURE, Lang::En).expect("fixture");
		assert_eq!(cache.draft(secret), "");
		assert_eq!(
			cache.entry("hindsight.apiToken").map(Entry::display_value),
			Some(MASK.to_owned())
		);
	}

	#[test]
	fn search_filters_rows_groups_and_tabs() {
		let catalog = catalog();
		// A row match keeps only that row and its group.
		let tree = catalog.tree("token");
		assert_eq!(tree.len(), 1);
		assert_eq!(tree[0].id, "model");
		assert_eq!(tree[0].groups[0].entries.len(), 1);
		assert_eq!(tree[0].groups[0].entries[0].path, "hindsight.apiToken");

		// A group heading match keeps the whole group.
		let tree = catalog.tree("display");
		assert_eq!(tree[0].groups.len(), 1);
		assert_eq!(tree[0].groups[0].label.as_deref(), Some("Display"));
		assert_eq!(tree[0].groups[0].entries.len(), 3);

		// A tab name match keeps every visible row of that tab (no invisible).
		let tree = catalog.tree("model");
		assert_eq!(tree.len(), 1);
		assert_eq!(tree[0].row_count(), 4);

		// Paths are searchable too.
		assert_eq!(catalog.tree("interface.reduced").len(), 1);

		// No match: nothing, not a full list.
		assert!(catalog.tree("no-such-setting").is_empty());
	}

	/// A gateway that records requests and returns a language-dependent body.
	struct Stub {
		en: String,
		zh: String,
		gets: Mutex<Vec<Lang>>,
		puts: Mutex<Vec<(String, Value)>>,
		value_after_put: Mutex<Option<(String, Value)>>,
		fail_put: bool,
	}

	impl Stub {
		fn new() -> Self {
			let zh = FIXTURE
				.replace("\"Appearance\"", "\"外观\"")
				.replace("\"Model\"", "\"模型\"")
				.replace("\"General\"", "\"通用\"")
				.replace("\"Display\"", "\"显示\"")
				.replace("\"Language\"", "\"语言\"")
				.replace("\"Dark Theme\"", "\"深色主题\"");
			Self {
				en: FIXTURE.to_owned(),
				zh,
				gets: Mutex::new(Vec::new()),
				puts: Mutex::new(Vec::new()),
				value_after_put: Mutex::new(None),
				fail_put: false,
			}
		}

		/// The body, with the last successfully written value applied — the
		/// same round trip the gateway performs.
		fn body(&self, lang: Lang) -> String {
			let base = match lang {
				Lang::En => &self.en,
				Lang::Zh => &self.zh,
			};
			let mut value: Value = serde_json::from_str(base).expect("fixture");
			if let Some((path, written)) = self.value_after_put.lock().unwrap().clone() {
				if let Some(entries) = value.get_mut("settings").and_then(Value::as_array_mut) {
					for entry in entries {
						if entry.get("path").and_then(Value::as_str) == Some(path.as_str()) {
							entry["value"] = written.clone();
						}
					}
				}
			}
			value.to_string()
		}
	}

	impl Gateway for Stub {
		fn get(&self, lang: Lang) -> Result<String, String> {
			self.gets.lock().unwrap().push(lang);
			Ok(self.body(lang))
		}

		fn put(&self, path: &str, value: &Value) -> Result<(), String> {
			if self.fail_put {
				return Err("stub refused".to_owned());
			}
			self
				.puts
				.lock()
				.unwrap()
				.push((path.to_owned(), value.clone()));
			*self.value_after_put.lock().unwrap() = Some((path.to_owned(), value.clone()));
			Ok(())
		}
	}

	#[test]
	fn a_write_round_trips_through_put_and_re_reads_the_catalog() {
		let gateway = Stub::new();
		let mut cache = SchemaCache::default();
		cache.load_now(&gateway, Lang::En).expect("first read");
		assert_eq!(
			cache.entry("interface.density").map(|e| e.display_value()),
			Some("comfortable".to_owned())
		);

		cache
			.write_now(&gateway, Lang::En, "interface.density", json!("compact"))
			.expect("the write round trip");

		assert_eq!(
			gateway.puts.lock().unwrap().as_slice(),
			[("interface.density".to_owned(), json!("compact"))]
		);
		assert_eq!(
			gateway.gets.lock().unwrap().as_slice(),
			[Lang::En, Lang::En],
			"a write is followed by a fresh read"
		);
		assert_eq!(
			cache.entry("interface.density").map(|e| e.display_value()),
			Some("compact".to_owned())
		);
	}

	#[test]
	fn a_failed_write_keeps_the_catalog_and_reports_the_error() {
		let mut gateway = Stub::new();
		gateway.fail_put = true;
		let mut cache = SchemaCache::default();
		cache.load_now(&gateway, Lang::En).expect("read");
		let error = cache
			.write_now(&gateway, Lang::En, "interface.density", json!("compact"))
			.expect_err("the stub refuses");
		assert!(error.contains("refused"), "{error}");
		assert_eq!(
			cache.entry("interface.density").map(|e| e.display_value()),
			Some("comfortable".to_owned())
		);
	}

	/// Wait for the cache's worker to land, so an async test is deterministic.
	fn settle(cache: &mut SchemaCache) {
		let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
		while cache.loading() {
			cache.poll();
			assert!(std::time::Instant::now() < deadline, "the worker never answered");
			std::thread::sleep(std::time::Duration::from_millis(5));
		}
	}

	#[test]
	fn switching_the_language_re_fetches_localized_labels() {
		let gateway = Arc::new(Stub::new());
		let mut cache = SchemaCache::default();
		cache.load_now(gateway.as_ref(), Lang::En).expect("en");
		assert_eq!(cache.catalog().unwrap().tabs[0].label, "Appearance");
		assert_eq!(cache.catalog().unwrap().groups["appearance"][0], "General");
		assert_eq!(cache.entry("language").unwrap().label, "Language");

		// The shell calls `ensure` when settings.lang changes; a catalog in the
		// other language must be fetched again, not relabelled in place.
		let transport: Arc<dyn Gateway> = gateway.clone();
		cache.ensure(transport, Lang::Zh);
		assert!(cache.loading(), "the language switch starts a request");
		settle(&mut cache);
		assert_eq!(cache.catalog().unwrap().tabs[0].label, "外观");
		assert_eq!(cache.catalog().unwrap().groups["appearance"][0], "通用");
		assert_eq!(cache.entry("language").unwrap().label, "语言");
		assert_eq!(gateway.gets.lock().unwrap().as_slice(), [Lang::En, Lang::Zh]);
		assert_eq!(cache.loaded_lang(), Some(Lang::Zh));

		// The same language again is a no-op.
		cache.ensure(gateway.clone(), Lang::Zh);
		assert!(!cache.loading());
	}

	#[test]
	fn ensure_does_not_refetch_the_same_language() {
		let gateway = Stub::new();
		let mut cache = SchemaCache::default();
		cache.load_now(&gateway, Lang::En).expect("en");
		cache.ensure(Arc::new(Stub::new()), Lang::En);
		assert!(!cache.loading(), "a loaded catalog in the same language needs no request");
	}

	#[test]
	fn an_unreachable_gateway_is_remembered_instead_of_retried_every_frame() {
		struct Down;
		impl Gateway for Down {
			fn get(&self, _lang: Lang) -> Result<String, String> {
				Err("connection refused".to_owned())
			}
			fn put(&self, _path: &str, _value: &Value) -> Result<(), String> {
				Err("connection refused".to_owned())
			}
		}
		let mut cache = SchemaCache::default();
		assert!(cache.load_now(&Down, Lang::En).is_err());
		cache.failed_lang = Some(Lang::En);
		cache.ensure(Arc::new(Down), Lang::En);
		assert!(!cache.loading(), "a failed language is not retried by the draw path");
	}
}
