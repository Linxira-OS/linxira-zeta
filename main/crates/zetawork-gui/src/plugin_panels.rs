// SPDX-License-Identifier: AGPL-3.0-only
//! Declarative plugin panels: the native half of the plugin layer.
//!
//! A plugin's `plugin.json` may declare `ui.panels` — `list`, `form`, `chart`
//! (filled by one tool call) or `html` (a page the web-ui host already serves).
//! This module is the Rust side of that contract:
//!
//! * [`parse_manifest`] validates a declaration and names the entry that is
//!   wrong (the same rejections as `parsePluginUi` in
//!   `packages/coding-agent/src/extensibility/plugins/parser.ts` — two hosts,
//!   one accepted shape);
//! * [`discover_in`] finds the panels of every installed plugin;
//! * [`decode`] turns the tool's `details` into the rows/fields/points the
//!   panels draw;
//! * [`page_url`] is the one URL an `html` panel navigates to:
//!   `/plugins/view/<plugin>/<entry>` — the scheme web-ui already mounts, not a
//!   new one.
//!
//! # Why the data source is a tool call, not an HTTP route
//!
//! The producer already exists as a tool registration, and a panel has to draw
//! when `zetacode serve` is not running: a front end does not depend on the HTTP
//! adapter (`document/architecture-layers.md` §2). The browser still reaches the
//! same plugin through the gateway; that is a second client of the same
//! behaviour, not a prerequisite for the desktop's panels.
//!
//! # What is native and what is not
//!
//! `list`/`form`/`chart` are drawn by egui in the right column — no webview, no
//! extra process. `html` is the only kind that leaves the process: the column
//! hands its rectangle to the existing WebView2 child ([`crate::embed`]) and
//! points it at [`page_url`], which needs the web-ui origin from
//! `~/.zeta/serve.json`. Without it the panel says so instead of showing a
//! blank frame.

use std::{
	path::{Path, PathBuf},
	sync::mpsc::{self, Receiver, TryRecvError},
};

use serde_json::Value;

/// The catalogue file a plugin's panels are declared in.
pub const MANIFEST_FILE: &str = "plugin.json";
/// The package manifest's zeta / legacy omp / pi key families, read when
/// `plugin.json` has no `ui`.
pub const PACKAGE_MANIFEST_KEYS: [&str; 3] = ["zeta", "omp", "pi"];
/// Every panel kind a manifest may declare.
pub const PANEL_KINDS: [&str; 4] = ["list", "form", "chart", "html"];

/// Where a drop-in plugin lives, under the agent dir (`~/.zeta/agent/plugins`).
const AGENT_DIR: &str = ".zeta";
const AGENT_PLUGINS: [&str; 2] = ["agent", "plugins"];
/// Where npm installs put a plugin package (`~/.zeta/plugins/node_modules`).
const NPM_PLUGINS: [&str; 2] = ["plugins", "node_modules"];
/// Skip these while walking a `node_modules` tree.
const SKIP_DIRS: [&str; 3] = [".bin", ".cache", ".git"];

/// The kind of panel, as the manifest spells it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PanelKind {
	List,
	Form,
	Chart,
	Html,
}

impl PanelKind {
	/// The manifest spelling, or `None` for an unknown kind.
	pub fn parse(text: &str) -> Option<Self> {
		match text {
			"list" => Some(Self::List),
			"form" => Some(Self::Form),
			"chart" => Some(Self::Chart),
			"html" => Some(Self::Html),
			_ => None,
		}
	}

	/// The manifest spelling.
	pub fn as_str(self) -> &'static str {
		match self {
			Self::List => "list",
			Self::Form => "form",
			Self::Chart => "chart",
			Self::Html => "html",
		}
	}

	/// True for the kinds that call a tool for their data.
	pub fn is_declarative(self) -> bool {
		!matches!(self, Self::Html)
	}
}

/// One declared panel.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Panel {
	/// The plugin that declares it (`plugin.json` id, else the directory name).
	pub plugin: String,
	/// Stable id inside the plugin.
	pub id: String,
	/// Panel head text, as the manifest spells it.
	pub title: String,
	/// What the host draws.
	pub kind: PanelKind,
	/// The tool a declarative panel calls; `None` for `html`.
	pub tool: Option<String>,
	/// Row keys, in cell order (`list` only; empty = the row's own order).
	pub columns: Vec<String>,
	/// Package-relative page path (`html` only).
	pub entry: Option<String>,
}

impl Panel {
	/// The page the column navigates to, for an `html` panel.
	pub fn page(&self) -> Option<&str> {
		self.entry.as_deref()
	}
}

/// Every discovered panel, with the declarations that were skipped and why.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Registry {
	/// Panels in discovery order (plugin id, then declaration order).
	pub panels: Vec<Panel>,
	/// One line per plugin whose declaration was rejected or unreadable.
	pub warnings: Vec<String>,
}

impl Registry {
	/// Plugin ids that declare at least one panel, in discovery order.
	pub fn plugins(&self) -> Vec<&str> {
		let mut ids: Vec<&str> = Vec::new();
		for panel in &self.panels {
			if !ids.contains(&panel.plugin.as_str()) {
				ids.push(panel.plugin.as_str());
			}
		}
		ids
	}

	/// The panels one plugin declares, in declaration order.
	pub fn of(&self, plugin: &str) -> Vec<&Panel> {
		self
			.panels
			.iter()
			.filter(|panel| panel.plugin == plugin)
			.collect()
	}

	/// One panel by plugin id and panel id.
	pub fn get(&self, plugin: &str, panel: &str) -> Option<&Panel> {
		self
			.panels
			.iter()
			.find(|candidate| candidate.plugin == plugin && candidate.id == panel)
	}
}

fn string_field<'a>(object: &'a serde_json::Map<String, Value>, key: &str) -> Option<&'a str> {
	object.get(key)?.as_str()
}

fn non_empty(object: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
	let value = string_field(object, key)?.trim();
	(!value.is_empty()).then(|| value.to_owned())
}

/// A panel id is the URL-ish spelling the manifest requires.
fn valid_panel_id(id: &str) -> bool {
	let mut chars = id.chars();
	chars
		.next()
		.is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit())
		&& chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Normalize an `html` entry: POSIX separators, no `./`, and it must stay
/// inside the package and name an `.html` file.
fn normalized_entry(entry: &str) -> Result<String, String> {
	let normalized = entry.trim().replace('\\', "/");
	let normalized = normalized.trim_start_matches("./").to_owned();
	if normalized.starts_with('/') || normalized.chars().nth(1) == Some(':') {
		return Err(format!("must be relative to the plugin root, got {entry}"));
	}
	if normalized.split('/').any(|segment| segment == "..") {
		return Err(format!("must not leave the plugin package, got {entry}"));
	}
	let lower = normalized.to_ascii_lowercase();
	if !(lower.ends_with(".html") || lower.ends_with(".htm")) {
		return Err(format!("must name an .html file, got {entry}"));
	}
	Ok(normalized)
}

fn parse_panel(entry: &Value, at: &str, plugin: &str) -> Result<Panel, String> {
	let Some(object) = entry.as_object() else {
		return Err(format!("`{at}` must be an object, got {}", shape_of(entry)));
	};
	let kind_text = string_field(object, "kind").unwrap_or_default();
	let Some(kind) = PanelKind::parse(kind_text) else {
		return Err(format!(
			"`{at}.kind` must be one of: {} — got {}",
			PANEL_KINDS.join(", "),
			match string_field(object, "kind") {
				Some(text) => format!("\"{text}\""),
				None => shape_of(entry.get("kind").unwrap_or(&Value::Null)),
			}
		));
	};
	let Some(id) = non_empty(object, "id") else {
		return Err(format!("`{at}.id` must be a non-empty string"));
	};
	if !valid_panel_id(&id) {
		return Err(format!("`{at}.id` must match [a-z0-9][a-z0-9-]*, got \"{id}\""));
	}
	let Some(title) = non_empty(object, "title") else {
		return Err(format!("`{at}.title` must be a non-empty string"));
	};

	let mut columns: Vec<String> = Vec::new();
	if let Some(raw) = object.get("columns") {
		let Some(list) = raw.as_array() else {
			return Err(format!("`{at}.columns` must be an array of row keys, got {}", shape_of(raw)));
		};
		for (index, key) in list.iter().enumerate() {
			match key.as_str().map(str::trim) {
				Some(key) if !key.is_empty() => columns.push(key.to_owned()),
				_ => return Err(format!("`{at}.columns[{index}]` must be a non-empty row key")),
			}
		}
	}

	if kind.is_declarative() {
		let Some(source) = object.get("source").and_then(Value::as_object) else {
			return Err(format!(
				"`{at}.source` must be an object naming the `tool` that produces the panel's data, got {}",
				shape_of(object.get("source").unwrap_or(&Value::Null))
			));
		};
		let Some(tool) = non_empty(source, "tool") else {
			return Err(format!("`{at}.source.tool` must be a non-empty tool name"));
		};
		if !matches!(kind, PanelKind::List) && !columns.is_empty() {
			return Err(format!(
				"`{at}.columns` is only meaningful for a list panel, this one is a {}",
				kind.as_str()
			));
		}
		if let Some(args) = source.get("args") {
			if !args.is_object() {
				return Err(format!("`{at}.source.args` must be an object, got {}", shape_of(args)));
			}
		}
		return Ok(Panel {
			plugin: plugin.to_owned(),
			id,
			title,
			kind,
			tool: Some(tool),
			columns,
			entry: None,
		});
	}

	if object.contains_key("source") {
		return Err(format!(
			"`{at}.source` is only for list/form/chart panels; an html panel navigates to `entry`"
		));
	}
	let Some(entry) = string_field(object, "entry") else {
		return Err(format!(
			"`{at}.entry` must be a non-empty path to an .html file inside the plugin package"
		));
	};
	let entry = normalized_entry(entry).map_err(|reason| format!("`{at}.entry` {reason}"))?;
	Ok(Panel { plugin: plugin.to_owned(), id, title, kind, tool: None, columns, entry: Some(entry) })
}

fn shape_of(value: &Value) -> String {
	match value {
		Value::Null => "null".to_owned(),
		Value::Bool(_) => "boolean".to_owned(),
		Value::Number(_) => "number".to_owned(),
		Value::String(_) => "string".to_owned(),
		Value::Array(_) => "an array".to_owned(),
		Value::Object(_) => "an object".to_owned(),
	}
}

fn parse_panels(ui: &Value, plugin: &str) -> Result<Vec<Panel>, String> {
	let Some(object) = ui.as_object() else {
		return Err(format!("`ui` must be an object, got {}", shape_of(ui)));
	};
	let Some(raw) = object.get("panels") else {
		return Ok(Vec::new());
	};
	let Some(list) = raw.as_array() else {
		return Err(format!("`ui.panels` must be an array, got {}", shape_of(raw)));
	};
	let mut panels: Vec<Panel> = Vec::new();
	for (index, entry) in list.iter().enumerate() {
		let panel = parse_panel(entry, &format!("ui.panels[{index}]"), plugin)?;
		if panels.iter().any(|known| known.id == panel.id) {
			return Err(format!("`ui.panels[{index}].id` duplicates the panel id \"{}\"", panel.id));
		}
		panels.push(panel);
	}
	Ok(panels)
}

/// The plugin id a catalogue declares, else the directory name.
fn catalogue_id(object: &serde_json::Map<String, Value>, fallback: &str) -> String {
	non_empty(object, "id").unwrap_or_else(|| fallback.to_owned())
}

/// Validate a `plugin.json` body: `id` (or the directory name) plus `ui.panels`.
pub fn parse_manifest(json: &str, fallback_id: &str) -> Result<Vec<Panel>, String> {
	let root: Value =
		serde_json::from_str(json).map_err(|err| format!("invalid plugin.json: {err}"))?;
	let Some(object) = root.as_object() else {
		return Err("plugin.json must be a JSON object".to_owned());
	};
	let plugin = catalogue_id(object, fallback_id);
	match object.get("ui") {
		Some(ui) => parse_panels(ui, &plugin),
		None => Ok(Vec::new()),
	}
}

/// Validate a package.json body's zeta / legacy omp / pi manifest `ui` block.
///
/// A plugin may declare its panels in either manifest; the native host reads
/// both so the TS side's [`PluginManifest.ui`] is not a second, unread spelling.
pub fn parse_package_manifest(json: &str, fallback_id: &str) -> Result<Vec<Panel>, String> {
	let root: Value =
		serde_json::from_str(json).map_err(|err| format!("invalid package.json: {err}"))?;
	let Some(object) = root.as_object() else {
		return Err("package.json must be a JSON object".to_owned());
	};
	let plugin = match string_field(object, "name") {
		Some(name) => name.rsplit('/').next().unwrap_or(fallback_id).to_owned(),
		None => fallback_id.to_owned(),
	};
	for key in PACKAGE_MANIFEST_KEYS {
		let Some(manifest) = object.get(key).and_then(Value::as_object) else {
			continue;
		};
		let Some(ui) = manifest.get("ui") else {
			continue;
		};
		return parse_panels(ui, &plugin);
	}
	Ok(Vec::new())
}

/// The panels declared by one plugin directory, or a named reason there are none.
pub fn panels_in_dir(dir: &Path) -> Result<Vec<Panel>, String> {
	let fallback = dir
		.file_name()
		.map(|name| name.to_string_lossy().into_owned())
		.unwrap_or_else(|| dir.display().to_string());
	let manifest = dir.join(MANIFEST_FILE);
	if manifest.is_file() {
		let text = std::fs::read_to_string(&manifest)
			.map_err(|err| format!("{}: {err}", manifest.display()))?;
		return parse_manifest(&text, &fallback);
	}
	let package = dir.join("package.json");
	if package.is_file() {
		let text = std::fs::read_to_string(&package)
			.map_err(|err| format!("{}: {err}", package.display()))?;
		return parse_package_manifest(&text, &fallback);
	}
	Ok(Vec::new())
}

fn sorted_children(dir: &Path) -> Vec<PathBuf> {
	let mut paths: Vec<PathBuf> = match std::fs::read_dir(dir) {
		Ok(entries) => entries
			.flatten()
			.map(|entry| entry.path())
			.filter(|path| path.is_dir())
			.collect(),
		Err(_) => Vec::new(),
	};
	paths.sort();
	paths
}

/// Plugin package directories under one install root.
///
/// Two layouts are real: a drop-in directory (`<root>/<plugin>/`) and an npm
/// install (`<root>/node_modules/<plugin>/`, or
/// `<root>/node_modules/@scope/<plugin>/`). The walk therefore looks *through*
/// `node_modules` and scope directories instead of treating them as plugins.
fn package_dirs(root: &Path) -> Vec<PathBuf> {
	let mut dirs = Vec::new();
	collect_package_dirs(root, &mut dirs);
	dirs
}

fn collect_package_dirs(dir: &Path, dirs: &mut Vec<PathBuf>) {
	for child in sorted_children(dir) {
		let name = child
			.file_name()
			.map(|name| name.to_string_lossy().into_owned())
			.unwrap_or_default();
		if SKIP_DIRS.iter().any(|skip| name == *skip) {
			continue;
		}
		if name == "node_modules" || name.starts_with('@') {
			collect_package_dirs(&child, dirs);
			continue;
		}
		if child.join(MANIFEST_FILE).is_file() || child.join("package.json").is_file() {
			dirs.push(child);
		}
	}
}

/// The user home this process reports (`USERPROFILE`, then `HOME`).
pub fn home() -> PathBuf {
	std::env::var_os("USERPROFILE")
		.or_else(|| std::env::var_os("HOME"))
		.map(PathBuf::from)
		.unwrap_or_else(|| PathBuf::from("."))
}

/// Every install root this machine has, in lookup order.
pub fn roots_in(home: &Path) -> Vec<PathBuf> {
	vec![
		home
			.join(AGENT_DIR)
			.join(AGENT_PLUGINS[0])
			.join(AGENT_PLUGINS[1]),
		home
			.join(AGENT_DIR)
			.join(NPM_PLUGINS[0])
			.join(NPM_PLUGINS[1]),
	]
}

/// Discover the panels of every plugin under `roots_in(home)`.
///
/// A malformed declaration never hides the rest: the plugin is recorded in
/// [`Registry::warnings`] and skipped, the same way a session keeps loading
/// plugins whose `ui` block is invalid.
pub fn discover_in(home: &Path) -> Registry {
	let mut registry = Registry::default();
	for root in roots_in(home) {
		for dir in package_dirs(&root) {
			match panels_in_dir(&dir) {
				Ok(panels) => registry.panels.extend(panels),
				Err(reason) => registry.warnings.push(reason),
			}
		}
	}
	registry
}

/// The page an `html` panel opens: the web-ui plugin host's own URL.
///
/// `origin` is the web-ui base (`~/.zeta/serve.json`'s `webUrl`); the path is
/// the one the page host mounts, so the desktop and the browser address a
/// plugin page identically.
pub fn page_url(origin: &str, plugin: &str, entry: &str) -> String {
	let base = origin.trim_end_matches('/');
	let entry = entry.trim_start_matches('/');
	format!("{base}/plugins/view/{}/{entry}", encode_segment(plugin))
}

/// Percent-encode the bytes a URL path segment cannot carry verbatim.
fn encode_segment(segment: &str) -> String {
	let mut out = String::with_capacity(segment.len());
	for byte in segment.bytes() {
		let plain = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~');
		if plain {
			out.push(byte as char);
		} else {
			out.push_str(&format!("%{byte:02X}"));
		}
	}
	out
}

/// The data a panel body draws, decoded from the tool's `details`.
#[derive(Clone, Debug, PartialEq)]
pub enum PanelData {
	/// Rows of cells, already in `columns` order.
	List(Vec<Vec<String>>),
	/// Label/value pairs, labels as the plugin localized them.
	Form(Vec<(String, String)>),
	/// Bars: label and value, in the order the tool returned them.
	Chart(Vec<(String, f64)>),
}

/// Decode one panel's `details`.
///
/// The accepted shapes are the contract
/// (`document/plugin-system.md` §"数据契约"): `{ rows }`, `{ fields }`,
/// `{ points }`. Anything else is an error the panel shows verbatim, never an
/// invented empty table.
pub fn decode(panel: &Panel, details: &Value) -> Result<PanelData, String> {
	let Some(object) = details.as_object() else {
		return Err(format!("panel data must be an object, got {}", shape_of(details)));
	};
	match panel.kind {
		PanelKind::List => {
			let rows = object
				.get("rows")
				.and_then(Value::as_array)
				.ok_or_else(|| "panel data has no `rows` array".to_owned())?;
			let mut cells = Vec::with_capacity(rows.len());
			for (index, row) in rows.iter().enumerate() {
				let Some(row) = row.as_object() else {
					return Err(format!("`rows[{index}]` must be an object, got {}", shape_of(row)));
				};
				let mut line = Vec::with_capacity(panel.columns.len());
				for column in &panel.columns {
					line.push(match row.get(column) {
						Some(Value::String(text)) => text.clone(),
						Some(Value::Null) | None => "—".to_owned(),
						Some(other) => other.to_string(),
					});
				}
				if panel.columns.is_empty() {
					line.extend(row.values().map(|value| match value {
						Value::String(text) => text.clone(),
						other => other.to_string(),
					}));
				}
				cells.push(line);
			}
			Ok(PanelData::List(cells))
		},
		PanelKind::Form => {
			let fields = object
				.get("fields")
				.and_then(Value::as_array)
				.ok_or_else(|| "panel data has no `fields` array".to_owned())?;
			let mut pairs = Vec::with_capacity(fields.len());
			for (index, field) in fields.iter().enumerate() {
				let Some(field) = field.as_object() else {
					return Err(format!("`fields[{index}]` must be an object, got {}", shape_of(field)));
				};
				let label = string_field(field, "label")
					.or_else(|| string_field(field, "key"))
					.unwrap_or("—")
					.to_owned();
				let value = match field.get("value") {
					Some(Value::String(text)) => text.clone(),
					Some(Value::Null) | None => "—".to_owned(),
					Some(other) => other.to_string(),
				};
				pairs.push((label, value));
			}
			Ok(PanelData::Form(pairs))
		},
		PanelKind::Chart => {
			let points = object
				.get("points")
				.and_then(Value::as_array)
				.ok_or_else(|| "panel data has no `points` array".to_owned())?;
			let mut bars = Vec::with_capacity(points.len());
			for (index, point) in points.iter().enumerate() {
				let Some(point) = point.as_object() else {
					return Err(format!("`points[{index}]` must be an object, got {}", shape_of(point)));
				};
				let label = string_field(point, "label").unwrap_or("—").to_owned();
				let value = point
					.get("value")
					.and_then(Value::as_f64)
					.ok_or_else(|| format!("`points[{index}].value` must be a number"))?;
				bars.push((label, value));
			}
			Ok(PanelData::Chart(bars))
		},
		PanelKind::Html => Err("an html panel has no data to decode".to_owned()),
	}
}

/// Decode the CLI's whole answer (`{ plugin, panel, kind, data }`).
pub fn decode_answer(panel: &Panel, stdout: &str) -> Result<PanelData, String> {
	let root: Value =
		serde_json::from_str(stdout).map_err(|err| format!("panel answer is not JSON: {err}"))?;
	let data = root
		.get("data")
		.ok_or_else(|| "panel answer has no `data` field".to_owned())?;
	decode(panel, data)
}

/// The argv that runs one panel's data tool (`zetacode plugins panel …`).
pub fn panel_argv(plugin: &str, panel: &str) -> Vec<String> {
	vec![
		"plugins".to_owned(),
		"panel".to_owned(),
		plugin.to_owned(),
		panel.to_owned(),
		"--json".to_owned(),
	]
}

/// One panel's fetch: the tool call runs on a worker thread so a slow CLI never
/// blocks a frame.
#[derive(Default)]
pub struct PanelCache {
	inflight: Option<(String, Receiver<Result<PanelData, String>>)>,
	loaded: Option<(String, Result<PanelData, String>)>,
}

impl PanelCache {
	/// The fetched data for this selection, if any.
	pub fn current(&self, key: &str) -> Option<&Result<PanelData, String>> {
		self
			.loaded
			.as_ref()
			.filter(|(loaded, _)| loaded == key)
			.map(|(_, result)| result)
	}

	/// True while a fetch for `key` is running.
	pub fn loading(&self, key: &str) -> bool {
		self
			.inflight
			.as_ref()
			.is_some_and(|(running, _)| running == key)
	}

	/// Start a fetch unless the same key is loading or already loaded.
	pub fn ensure(
		&mut self,
		key: &str,
		panel: &Panel,
		spawn: impl FnOnce() -> Result<PanelData, String> + Send + 'static,
	) {
		if self.current(key).is_some() || self.loading(key) {
			return;
		}
		if !panel.kind.is_declarative() {
			return;
		}
		let (sender, receiver) = mpsc::channel();
		std::thread::spawn(move || {
			let _ = sender.send(spawn());
		});
		self.inflight = Some((key.to_owned(), receiver));
	}

	/// Seed an answer without running anything: the screenshot harness and the
	/// headless tests have no `zetacode` to spawn, and a fixture panel must draw
	/// from data the test can see.
	pub fn seed(&mut self, key: &str, result: Result<PanelData, String>) {
		self.loaded = Some((key.to_owned(), result));
		self.inflight = None;
	}

	/// Drop the cached answer for `key` (the 刷新 button).
	pub fn invalidate(&mut self, key: &str) {
		if self
			.loaded
			.as_ref()
			.is_some_and(|(loaded, _)| loaded == key)
		{
			self.loaded = None;
		}
	}

	/// Take the worker's answer when it has one.
	pub fn poll(&mut self) -> bool {
		let Some((key, receiver)) = self.inflight.as_ref() else {
			return false;
		};
		match receiver.try_recv() {
			Ok(result) => {
				let key = key.clone();
				self.loaded = Some((key, result));
				self.inflight = None;
				true
			},
			Err(TryRecvError::Empty) => false,
			Err(TryRecvError::Disconnected) => {
				let key = key.clone();
				self.loaded = Some((key, Err("the panel worker stopped".to_owned())));
				self.inflight = None;
				true
			},
		}
	}
}

// ── the right column's 插件 page ───────────────────────────────────────────

use egui::{Align2, CornerRadius, FontId, Rect, Sense, Stroke, Ui, pos2, vec2};

use crate::{
	Shell,
	icons::{Icon, icon_button},
	state::RightTab,
	t, theme,
	widgets::{empty_note, panel_head, truncated_mono_right, truncated_text},
};

/// What the column is showing: a plugin and one of its panels.
///
/// Kept as ids rather than indices so a reloaded registry (the 刷新 button, a
/// plugin installed while the app runs) keeps the user on the same panel, and
/// falls back to the first one only when that panel is gone.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Selection {
	pub plugin: Option<String>,
	pub panel: Option<String>,
}

impl Selection {
	/// The selected panel, repairing the selection against `registry`.
	pub fn resolve(&mut self, registry: &Registry) -> Option<Panel> {
		let plugins = registry.plugins();
		let plugin = self
			.plugin
			.clone()
			.filter(|id| plugins.iter().any(|known| known == id))
			.or_else(|| plugins.first().map(|id| (*id).to_owned()))?;
		let panels = registry.of(&plugin);
		let panel = self
			.panel
			.clone()
			.filter(|id| panels.iter().any(|known| known.id == *id))
			.or_else(|| panels.first().map(|known| known.id.clone()))?;
		self.plugin = Some(plugin.clone());
		self.panel = Some(panel.clone());
		registry.get(&plugin, &panel).cloned()
	}

	/// The cache key of the selection (`<plugin>/<panel>`).
	pub fn key(&self) -> Option<String> {
		Some(format!("{}/{}", self.plugin.as_ref()?, self.panel.as_ref()?))
	}
}

/// Draw the 插件 page.
pub fn panel(ui: &mut Ui, shell: &mut Shell) {
	panel_head(ui, RightTab::Plugin.title(), |ui| {
		if icon_button(ui, Icon::Refresh, 20.0, false, t!("重新发现插件面板")).clicked() {
			shell.reload_plugins();
			shell.plugin_page.hide();
		}
	});
	if shell.plugins.panels.is_empty() {
		empty_note(ui, t!("没有插件声明面板（~/.zeta/agent/plugins/*/plugin.json）"));
		for warning in &shell.plugins.warnings {
			empty_note(ui, warning);
		}
		return;
	}

	let Some(panel) = shell.plugin_selection.resolve(&shell.plugins) else {
		empty_note(ui, t!("所选插件没有面板"));
		return;
	};
	plugin_row(ui, shell, &panel);
	panel_row(ui, shell, &panel);
	ui.add_space(2.0);
	body(ui, shell, &panel);
}

/// The plugin chips: one per plugin that declares a panel.
fn plugin_row(ui: &mut Ui, shell: &mut Shell, selected: &Panel) {
	let mut ids: Vec<String> = Vec::new();
	for panel in &shell.plugins.panels {
		if !ids.contains(&panel.plugin) {
			ids.push(panel.plugin.clone());
		}
	}
	egui::ScrollArea::horizontal()
		.id_salt("zetawork-plugin-plugins")
		.auto_shrink([false, true])
		.max_height(24.0)
		.show(ui, |ui| {
			ui.horizontal(|ui| {
				ui.spacing_mut().item_spacing.x = 4.0;
				for id in ids {
					let active = id == selected.plugin;
					if pick(ui, &id, active) {
						shell.plugin_selection.plugin = Some(id);
						shell.plugin_selection.panel = None;
					}
				}
			});
		});
}

/// The panel chips: one per panel the selected plugin declares.
fn panel_row(ui: &mut Ui, shell: &mut Shell, selected: &Panel) {
	let titles: Vec<(String, String)> = shell
		.plugins
		.of(&selected.plugin)
		.iter()
		.map(|panel| (panel.id.clone(), panel.title.clone()))
		.collect();
	egui::ScrollArea::horizontal()
		.id_salt("zetawork-plugin-panels")
		.auto_shrink([false, true])
		.max_height(24.0)
		.show(ui, |ui| {
			ui.horizontal(|ui| {
				ui.spacing_mut().item_spacing.x = 4.0;
				for (id, title) in titles {
					let active = id == selected.id;
					if pick(ui, &title, active) {
						shell.plugin_selection.panel = Some(id);
					}
				}
			});
		});
}

/// One chip-sized control: `.chip` shape, clickable, `active` fills it.
fn pick(ui: &mut Ui, label: &str, active: bool) -> bool {
	let font = FontId::new(11.0, egui::FontFamily::Monospace);
	let galley = ui
		.painter()
		.layout_no_wrap(label.to_owned(), font.clone(), theme::TEXT_3);
	let (rect, response) =
		ui.allocate_exact_size(vec2(galley.size().x + 12.0, 18.0), Sense::click());
	let (ink, fill, border) = if active {
		(theme::TEXT, theme::PANEL_4, theme::BORDER_2)
	} else if response.hovered() {
		(theme::TEXT_2, theme::PANEL_3, theme::BORDER_2)
	} else {
		(theme::TEXT_3, theme::PANEL_3, theme::BORDER)
	};
	ui.painter().rect_filled(rect, CornerRadius::same(4), fill);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(4),
		Stroke::new(1.0_f32, border),
		egui::StrokeKind::Inside,
	);
	ui.painter()
		.text(rect.center(), Align2::CENTER_CENTER, label, font, ink);
	response.clicked()
}

/// The panel body: native rows/fields/bars, or the page host's rectangle.
fn body(ui: &mut Ui, shell: &mut Shell, panel: &Panel) {
	match panel.kind {
		PanelKind::Html => page_body(ui, shell, panel),
		_ => data_body(ui, shell, panel),
	}
}

fn page_body(ui: &mut Ui, shell: &mut Shell, panel: &Panel) {
	let Some(entry) = panel.page() else {
		empty_note(ui, t!("html 面板没有 entry"));
		return;
	};
	let Some(origin) = shell.web_origin() else {
		empty_note(ui, t!("web-ui 未启动：html 面板需要 zetacode serve 发布的 webUrl"));
		return;
	};
	let url = page_url(&origin, &panel.plugin, entry);
	if let Some(reason) = shell.plugin_page.failure() {
		empty_note(ui, &format!("{url} · {}", t!("嵌入不可用：{}", reason)));
		return;
	}
	// The WebView2 child is placed over the body; the page itself paints inside
	// the child window, so only the frame is drawn here.
	let rect = ui.available_rect_before_wrap();
	ui.allocate_exact_size(rect.size(), Sense::hover());
	shell
		.plugin_page
		.show(crate::embed::PixelRect::from_points(rect, ui.ctx().pixels_per_point()));
	truncated_text(
		ui,
		pos2(rect.min.x + 4.0, rect.max.y - 10.0),
		&url,
		10.0,
		theme::TEXT_3,
		rect.width() - 8.0,
	);
}

fn data_body(ui: &mut Ui, shell: &mut Shell, panel: &Panel) {
	let Some(key) = shell.plugin_selection.key() else {
		return;
	};
	if shell.plugin_data.poll() {
		ui.ctx().request_repaint();
	}
	if shell.probe {
		let plugin_id = panel.plugin.clone();
		let panel_id = panel.id.clone();
		let worker_panel = panel.clone();
		shell.plugin_data.ensure(&key, panel, move || {
			let (stdout, _) = crate::zetacode::run_zetacode(&panel_argv(&plugin_id, &panel_id))?;
			decode_answer(&worker_panel, &stdout)
		});
	}
	if shell.plugin_data.loading(&key) {
		empty_note(ui, t!("正在读取面板数据…"));
		return;
	}
	let Some(result) = shell.plugin_data.current(&key) else {
		empty_note(ui, t!("面板数据未读取（无 zetacode 进程）"));
		return;
	};
	match result {
		Err(reason) => empty_note(ui, reason),
		Ok(data) => {
			egui::ScrollArea::vertical()
				.id_salt("zetawork-plugin-body")
				.auto_shrink([false, false])
				.show(ui, |ui| {
					ui.spacing_mut().item_spacing.y = 2.0;
					draw_data(ui, panel, data);
				});
		},
	}
}

fn draw_data(ui: &mut Ui, panel: &Panel, data: &PanelData) {
	match data {
		PanelData::List(rows) => {
			if rows.is_empty() {
				empty_note(ui, t!("没有数据行"));
				return;
			}
			let columns = if panel.columns.is_empty() {
				rows.first().map_or(0, Vec::len)
			} else {
				panel.columns.len()
			};
			for row in rows {
				row_line(ui, row, columns);
			}
		},
		PanelData::Form(fields) => {
			if fields.is_empty() {
				empty_note(ui, t!("没有字段"));
				return;
			}
			for (label, value) in fields {
				field_line(ui, label, value);
			}
		},
		PanelData::Chart(points) => {
			if points.is_empty() {
				empty_note(ui, t!("没有数据点"));
				return;
			}
			let max = points
				.iter()
				.map(|(_, value)| value.abs())
				.fold(0.0_f64, f64::max);
			for (label, value) in points {
				bar_row(ui, label, *value, max);
			}
		},
	}
}

/// One list row: the first cell is the row's identity, the rest are quiet.
fn row_line(ui: &mut Ui, cells: &[String], columns: usize) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 18.0), Sense::hover());
	let width = (rect.width() - 8.0).max(8.0) / columns.max(1) as f32;
	for (index, cell) in cells.iter().enumerate() {
		let x = rect.min.x + 4.0 + width * index as f32;
		truncated_text(
			ui,
			pos2(x, rect.center().y),
			cell,
			11.0,
			if index == 0 {
				theme::TEXT_2
			} else {
				theme::TEXT_3
			},
			width - 6.0,
		);
	}
}

/// One form row: label on the left, value right-aligned in mono.
fn field_line(ui: &mut Ui, label: &str, value: &str) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 18.0), Sense::hover());
	truncated_text(
		ui,
		pos2(rect.min.x + 4.0, rect.center().y),
		label,
		11.0,
		theme::TEXT_3,
		rect.width() * 0.45,
	);
	truncated_mono_right(
		ui,
		rect.max.x - 4.0,
		rect.center().y,
		value,
		11.0,
		theme::TEXT,
		rect.width() * 0.5,
	);
}

/// One chart bar: label, value, and a track whose fill is `value / max`.
fn bar_row(ui: &mut Ui, label: &str, value: f64, max: f64) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 26.0), Sense::hover());
	truncated_text(
		ui,
		pos2(rect.min.x + 4.0, rect.min.y + 8.0),
		label,
		11.0,
		theme::TEXT_3,
		rect.width() - 60.0,
	);
	truncated_mono_right(
		ui,
		rect.max.x - 4.0,
		rect.min.y + 8.0,
		&format!("{value:.0}"),
		11.0,
		theme::TEXT,
		54.0,
	);
	let track = Rect::from_min_size(
		pos2(rect.min.x + 4.0, rect.min.y + 18.0),
		vec2((rect.width() - 8.0).max(1.0), 5.0),
	);
	ui.painter()
		.rect_filled(track, CornerRadius::same(3), theme::PANEL_4);
	let share = if max > 0.0 {
		(value.abs() / max).clamp(0.0, 1.0) as f32
	} else {
		0.0
	};
	if share > 0.0 {
		ui.painter().rect_filled(
			Rect::from_min_size(track.min, vec2(track.width() * share, track.height())),
			CornerRadius::same(3),
			theme::ACCENT,
		);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The shipped example plugin's declaration, verbatim. The parser contract
	/// and the example are one thing: if either drifts, this fails.
	const FIXTURE: &str = include_str!("../../../../plugins/official/example-panel/plugin.json");

	fn fixture_panels() -> Vec<Panel> {
		parse_manifest(FIXTURE, "example-panel").expect("the shipped example parses")
	}

	#[test]
	fn the_example_plugin_declares_all_four_kinds() {
		let panels = fixture_panels();
		assert_eq!(
			panels
				.iter()
				.map(|panel| panel.kind.as_str())
				.collect::<Vec<_>>(),
			["list", "form", "chart", "html"]
		);
		let list = &panels[0];
		assert_eq!(list.plugin, "example-panel");
		assert_eq!(list.tool.as_deref(), Some("example_panel_data"));
		assert_eq!(list.columns, ["id", "title", "owner", "state"]);
		let page = &panels[3];
		assert_eq!(page.page(), Some("pages/index.html"));
		assert!(page.tool.is_none());
	}

	#[test]
	fn an_unknown_kind_is_rejected_by_name() {
		let error =
			parse_manifest(r#"{"ui":{"panels":[{"id":"a","title":"A","kind":"table"}]}}"#, "p")
				.expect_err("unknown kind");
		assert!(error.contains("`ui.panels[0].kind`"), "{error}");
		assert!(error.contains("list, form, chart, html"), "{error}");
	}

	#[test]
	fn a_declarative_panel_without_a_source_is_rejected() {
		let error =
			parse_manifest(r#"{"ui":{"panels":[{"id":"a","title":"A","kind":"list"}]}}"#, "p")
				.expect_err("missing source");
		assert!(error.contains("`ui.panels[0].source`"), "{error}");
		let error = parse_manifest(
			r#"{"ui":{"panels":[{"id":"a","title":"A","kind":"chart","source":{"args":{}}}]}}"#,
			"p",
		)
		.expect_err("missing tool");
		assert!(error.contains("`ui.panels[0].source.tool`"), "{error}");
	}

	#[test]
	fn an_html_panel_needs_an_entry_and_must_not_declare_a_source() {
		let error =
			parse_manifest(r#"{"ui":{"panels":[{"id":"g","title":"G","kind":"html"}]}}"#, "p")
				.expect_err("missing entry");
		assert!(error.contains("`ui.panels[0].entry`"), "{error}");

		let error = parse_manifest(
			r#"{"ui":{"panels":[{"id":"g","title":"G","kind":"html","entry":"a.html","source":{"tool":"t"}}]}}"#,
			"p",
		)
		.expect_err("source on html");
		assert!(error.contains("`ui.panels[0].source`"), "{error}");

		let error = parse_manifest(
			r#"{"ui":{"panels":[{"id":"g","title":"G","kind":"html","entry":"../a.html"}]}}"#,
			"p",
		)
		.expect_err("escape");
		assert!(error.contains("must not leave the plugin package"), "{error}");

		let error = parse_manifest(
			r#"{"ui":{"panels":[{"id":"g","title":"G","kind":"html","entry":"a.md"}]}}"#,
			"p",
		)
		.expect_err("not html");
		assert!(error.contains("must name an .html file"), "{error}");
	}

	#[test]
	fn duplicate_ids_bad_ids_and_columns_on_a_form_are_rejected() {
		let duplicate = r#"{"ui":{"panels":[
			{"id":"a","title":"A","kind":"list","source":{"tool":"t"}},
			{"id":"a","title":"B","kind":"form","source":{"tool":"t"}}]}}"#;
		assert!(
			parse_manifest(duplicate, "p")
				.expect_err("duplicate")
				.contains("duplicates the panel id")
		);

		let bad_id =
			r#"{"ui":{"panels":[{"id":"Tasks","title":"A","kind":"list","source":{"tool":"t"}}]}}"#;
		assert!(
			parse_manifest(bad_id, "p")
				.expect_err("bad id")
				.contains("[a-z0-9]")
		);

		let columns = r#"{"ui":{"panels":[{"id":"s","title":"S","kind":"form","source":{"tool":"t"},"columns":["a"]}]}}"#;
		assert!(
			parse_manifest(columns, "p")
				.expect_err("columns on form")
				.contains("only meaningful for a list panel")
		);
	}

	#[test]
	fn a_plugin_without_ui_has_no_panels() {
		assert!(
			parse_manifest(r#"{"id":"plain","name":"Plain"}"#, "plain")
				.expect("valid manifest")
				.is_empty()
		);
		assert!(
			parse_package_manifest(
				r#"{"name":"@scope/plain","zeta":{"extensions":["./i.ts"]}}"#,
				"plain"
			)
			.expect("valid package")
			.is_empty()
		);
	}

	#[test]
	fn a_package_manifest_may_declare_the_panels_too() {
		let json = r#"{"name":"@scope/one","zeta":{"ui":{"panels":[
			{"id":"t","title":"T","kind":"list","source":{"tool":"data"},"columns":["x"]}]}}}"#;
		let panels = parse_package_manifest(json, "dir").expect("package ui");
		assert_eq!(panels.len(), 1);
		assert_eq!(panels[0].plugin, "one", "the package basename, not the scope");
	}

	#[test]
	fn the_html_page_url_is_the_web_ui_route() {
		assert_eq!(
			page_url("http://127.0.0.1:3000/", "example-panel", "pages/index.html"),
			"http://127.0.0.1:3000/plugins/view/example-panel/pages/index.html"
		);
		assert_eq!(
			page_url("http://127.0.0.1:3000", "my plugin", "/pages/a.html"),
			"http://127.0.0.1:3000/plugins/view/my%20plugin/pages/a.html"
		);
	}

	#[test]
	fn data_decodes_into_the_shapes_the_panels_draw() {
		let panels = fixture_panels();
		let list = decode(
			&panels[0],
			&serde_json::json!({"rows":[{"id":"T-1","title":"One","owner":"east","state":"done"}]}),
		)
		.expect("list data");
		assert_eq!(
			list,
			PanelData::List(vec![vec![
				"T-1".to_owned(),
				"One".to_owned(),
				"east".to_owned(),
				"done".to_owned()
			]])
		);

		let chart = decode(
			&panels[2],
			&serde_json::json!({"points":[{"label":"todo","value":2},{"label":"done","value":1}]}),
		)
		.expect("chart data");
		assert_eq!(chart, PanelData::Chart(vec![("todo".to_owned(), 2.0), ("done".to_owned(), 1.0)]));

		let form = decode(
			&panels[1],
			&serde_json::json!({"fields":[{"key":"tasks","label":"Tasks","value":6}]}),
		)
		.expect("form data");
		assert_eq!(form, PanelData::Form(vec![("Tasks".to_owned(), "6".to_owned())]));

		// A wrong shape is an error, never an invented empty table.
		assert!(
			decode(&panels[0], &serde_json::json!({"items":[]}))
				.expect_err("missing rows")
				.contains("no `rows` array")
		);
	}

	#[test]
	fn the_cli_answer_decodes_through_its_data_field() {
		let panels = fixture_panels();
		let stdout = r#"{"plugin":"example-panel","panel":"tasks","kind":"list","data":{"rows":[{"id":"T-2","title":"Two","owner":"north","state":"doing"}]}}"#;
		let data = decode_answer(&panels[0], stdout).expect("answer decodes");
		assert_eq!(
			data,
			PanelData::List(vec![vec![
				"T-2".to_owned(),
				"Two".to_owned(),
				"north".to_owned(),
				"doing".to_owned()
			]])
		);
	}

	#[test]
	fn discovery_reads_both_layouts_and_keeps_bad_declarations_as_warnings() {
		let home = tempfile::tempdir().expect("home");
		let drop_in = home
			.path()
			.join(".zeta")
			.join("agent")
			.join("plugins")
			.join("example-panel");
		std::fs::create_dir_all(&drop_in).expect("drop-in dir");
		std::fs::write(drop_in.join("plugin.json"), FIXTURE).expect("manifest");

		let broken = home
			.path()
			.join(".zeta")
			.join("plugins")
			.join("node_modules")
			.join("@scope")
			.join("broken");
		std::fs::create_dir_all(&broken).expect("npm dir");
		std::fs::write(
			broken.join("package.json"),
			r#"{"name":"@scope/broken","zeta":{"ui":{"panels":[{"id":"x","title":"X","kind":"table"}]}}}"#,
		)
		.expect("package");

		let registry = discover_in(home.path());
		assert_eq!(registry.plugins(), ["example-panel"]);
		assert_eq!(registry.panels.len(), 4);
		assert_eq!(registry.warnings.len(), 1);
		assert!(registry.warnings[0].contains("`ui.panels[0].kind`"), "{:?}", registry.warnings);
	}

	#[test]
	fn the_selection_stays_on_its_panel_and_repairs_when_it_disappears() {
		let mut registry = Registry::default();
		registry.panels = fixture_panels();
		let mut selection =
			Selection { plugin: Some("gone".to_owned()), panel: Some("throughput".to_owned()) };
		let panel = selection
			.resolve(&registry)
			.expect("falls back to the first plugin");
		assert_eq!(selection.plugin.as_deref(), Some("example-panel"));
		assert_eq!(
			panel.id, "throughput",
			"the panel id survives even though the plugin had to be repaired"
		);

		selection.panel = Some("removed".to_owned());
		let panel = selection
			.resolve(&registry)
			.expect("falls back to the first panel");
		assert_eq!(panel.id, "tasks");
		assert_eq!(selection.key().as_deref(), Some("example-panel/tasks"));
	}

	#[test]
	fn a_fixture_panel_renders_natively() {
		use egui::Rect;

		let context = egui::Context::default();
		let mut shell = crate::Shell::with_state(
			crate::state::AppState::seeded_with_registry(
				std::env::current_dir().expect("cwd").as_path(),
				workbench_projects::Registry::empty_at(
					std::env::temp_dir().join("zetawork-plugin-panels-test.json"),
				),
			),
			crate::settings::Settings::default(),
		);
		shell.plugins.panels = fixture_panels();
		shell.state.set_right_tab(crate::state::RightTab::Plugin);
		shell.plugin_data.seed(
			"example-panel/tasks",
			Ok(PanelData::List(vec![
				vec![
					"T-1".to_owned(),
					"Write the manifest".to_owned(),
					"east".to_owned(),
					"done".to_owned(),
				],
				vec![
					"T-5".to_owned(),
					"Open the web page".to_owned(),
					"south".to_owned(),
					"todo".to_owned(),
				],
			])),
		);

		let mut shapes = 0;
		let output = context.run(
			egui::RawInput {
				screen_rect: Some(Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(1440.0, 900.0))),
				..Default::default()
			},
			|ctx| {
				egui::CentralPanel::default().show(ctx, |ui| {
					panel(ui, &mut shell);
				});
			},
		);
		shapes += output.shapes.len();
		assert!(shapes > 0, "the panel drew nothing");
		assert_eq!(shell.plugin_selection.panel.as_deref(), Some("tasks"));
	}
}
