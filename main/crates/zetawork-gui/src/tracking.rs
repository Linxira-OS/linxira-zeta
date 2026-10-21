// SPDX-License-Identifier: AGPL-3.0-only
//! The right column's 跟踪 page: `<workspace>/.zeta/tracking/` as the
//! `tracking_update` tool leaves it.
//!
//! The files are the source of truth and the gateway only reads them, so this
//! page reads the same files. Nothing here writes: 概览 is `INDEX.md`, 状态 is
//! `status.json`, 计划 is `plans/*.md`, 摘要 is `summaries/*.md` and 会话 is
//! `sessions/*.md` — each a newest-first listing, exactly the order the web
//! tracking panel shows.
//!
//! # Parsing
//!
//! [`parse_status`] accepts the tool's document but not arbitrary JSON: a
//! status that is not an object is `Err`, while a field of the wrong type is
//! dropped to its default so one hand-edited key cannot blank the page. The
//! markdown panes are not rendered as HTML — [`markdown_rows`] maps each line
//! to a heading, a bullet or body text, which is what a narrow column can
//! actually show.
//!
//! # Freshness
//!
//! [`TrackingCache::refresh`] re-reads at most once a second while the page is
//! visible. A missing tracking directory is a normal state (the tool is
//! opt-in), reported as an empty page rather than an error.

use std::{
	path::{Path, PathBuf},
	time::{Duration, Instant},
};

use serde_json::Value;

use crate::{
	Shell,
	state::RightTab,
	t, theme,
	widgets::{empty_note, panel_head, truncated_mono, truncated_text},
};

/// How often the page re-reads the directory while it is visible.
pub const REFRESH: Duration = Duration::from_secs(1);

/// The tracking directory under a workspace root.
pub fn tracking_dir(root: &Path) -> PathBuf {
	root.join(".zeta").join("tracking")
}

/// One markdown document of a tracking subdirectory.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Doc {
	pub name: String,
	pub content: String,
	/// File mtime in milliseconds since the epoch; `0` when unreadable.
	pub modified_ms: i64,
}

/// One todo phase of `status.json`'s v2 mirror.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Phase {
	pub name: String,
	pub status: String,
}

/// `status.json`, as the page reads it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Status {
	pub phase: String,
	pub progress: String,
	pub stage: Option<String>,
	pub blockers: Vec<String>,
	pub decisions: Vec<String>,
	pub phases: Vec<Phase>,
	pub last_updated: String,
	pub last_session_id: Option<String>,
}

/// Everything the page shows for one workspace.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Docs {
	pub index: Option<String>,
	pub status: Option<Status>,
	pub plans: Vec<Doc>,
	pub summaries: Vec<Doc>,
	pub sessions: Vec<Doc>,
}

impl Docs {
	/// True when the workspace has no tracking at all.
	pub fn is_empty(&self) -> bool {
		self.index.is_none()
			&& self.status.is_none()
			&& self.plans.is_empty()
			&& self.summaries.is_empty()
			&& self.sessions.is_empty()
	}
}

/// Parse `status.json`.
///
/// The top level must be a JSON object; a document that is one yields a
/// [`Status`] with missing or mistyped fields defaulted. The arrays keep only
/// strings, which is how a blocker list written as `[1, "disk"]` still shows
/// `disk` instead of failing.
pub fn parse_status(json: &str) -> Result<Status, String> {
	let value: Value =
		serde_json::from_str(json).map_err(|error| t!("status.json 不是 JSON：{}", error))?;
	let object = value
		.as_object()
		.ok_or_else(|| t!("status.json 的顶层不是对象").to_owned())?;
	let text = |key: &str| {
		object
			.get(key)
			.and_then(Value::as_str)
			.unwrap_or_default()
			.trim()
			.to_owned()
	};
	let list = |key: &str| {
		object
			.get(key)
			.and_then(Value::as_array)
			.map(|rows| {
				rows
					.iter()
					.filter_map(Value::as_str)
					.map(str::trim)
					.filter(|row| !row.is_empty())
					.map(str::to_owned)
					.collect()
			})
			.unwrap_or_default()
	};
	let stages = object
		.get("phases")
		.and_then(Value::as_array)
		.map(|rows| {
			rows
				.iter()
				.filter_map(|row| {
					let name = row.get("name")?.as_str()?.trim();
					let status = row.get("status")?.as_str()?.trim();
					(!name.is_empty())
						.then(|| Phase { name: name.to_owned(), status: status.to_owned() })
				})
				.collect()
		})
		.unwrap_or_default();
	Ok(Status {
		phase: text("phase"),
		progress: text("progress"),
		stage: object
			.get("stage")
			.and_then(Value::as_str)
			.map(str::trim)
			.filter(|stage| !stage.is_empty())
			.map(str::to_owned),
		blockers: list("blockers"),
		decisions: list("decisions"),
		phases: stages,
		last_updated: text("lastUpdated"),
		last_session_id: object
			.get("lastSessionId")
			.and_then(Value::as_str)
			.map(str::trim)
			.filter(|id| !id.is_empty())
			.map(str::to_owned),
	})
}

/// Read every tracking document of `root`.
///
/// A missing directory is [`Docs::default`]; a directory that exists but
/// cannot be listed carries the OS message in [`Docs::error`]. Individual
/// unreadable files are skipped, never fatal.
pub fn read(root: &Path) -> Docs {
	let dir = tracking_dir(root);
	if !dir.is_dir() {
		return Docs::default();
	}
	let mut docs = Docs::default();
	docs.index = std::fs::read_to_string(dir.join("INDEX.md")).ok();
	docs.status = std::fs::read_to_string(dir.join("status.json"))
		.ok()
		.and_then(|text| parse_status(&text).ok());
	docs.plans = read_markdown_dir(&dir.join("plans"));
	docs.summaries = read_markdown_dir(&dir.join("summaries"));
	docs.sessions = read_markdown_dir(&dir.join("sessions"));
	docs
}

/// Newest-first `.md` files of `dir`. A missing directory is empty.
pub fn read_markdown_dir(dir: &Path) -> Vec<Doc> {
	let mut rows: Vec<Doc> = std::fs::read_dir(dir)
		.map(|entries| {
			entries
				.flatten()
				.filter(|entry| {
					entry
						.file_type()
						.map(|kind| kind.is_file())
						.unwrap_or(false)
						&& entry
							.file_name()
							.to_string_lossy()
							.to_ascii_lowercase()
							.ends_with(".md")
				})
				.filter_map(|entry| {
					let path = entry.path();
					let modified_ms = entry
						.metadata()
						.ok()
						.and_then(|metadata| metadata.modified().ok())
						.and_then(|modified| {
							modified
								.duration_since(std::time::UNIX_EPOCH)
								.ok()
								.map(|age| age.as_millis() as i64)
						})
						.unwrap_or(0);
					Some(Doc {
						name: entry.file_name().to_string_lossy().into_owned(),
						content: std::fs::read_to_string(&path).ok()?,
						modified_ms,
					})
				})
				.collect()
		})
		.unwrap_or_default();
	rows.sort_by(|a, b| {
		b.modified_ms
			.cmp(&a.modified_ms)
			.then_with(|| a.name.cmp(&b.name))
	});
	rows
}

/// One rendered line of a tracking markdown document.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MdRow {
	/// `# …`, `## …`, …; the level is 1..=3 (deeper headings render as 3).
	Heading(u8, String),
	/// A `- `, `* ` or `1. ` list row; the bullet prefix is removed.
	Bullet(String),
	/// A ```` ``` ```` fence marker, kept so the reader can see code blocks.
	Fence(String),
	/// Anything else, trimmed of trailing whitespace.
	Text(String),
	/// A blank line (renders as spacing).
	Blank,
}

/// Split a markdown document into the rows a narrow column can draw.
///
/// This is deliberately not a markdown parser: emphasis and links keep their
/// markers, because showing `**` is honest and inventing formatting from a
/// half-understood document is not. Headings, list rows, fences and blank
/// lines are recognised, which is what makes a tracking document scannable.
pub fn markdown_rows(text: &str) -> Vec<MdRow> {
	let mut rows = Vec::new();
	for line in text.lines() {
		let trimmed = line.trim_end();
		if trimmed.trim().is_empty() {
			rows.push(MdRow::Blank);
			continue;
		}
		if trimmed.trim_start().starts_with("```") {
			rows.push(MdRow::Fence(trimmed.trim().to_owned()));
			continue;
		}
		let indented = trimmed.starts_with(' ') || trimmed.starts_with('\t');
		let body = trimmed.trim_start();
		if !indented {
			if let Some(heading) = body.strip_prefix('#') {
				let level = heading.chars().take_while(|ch| *ch == '#').count() as u8 + 1;
				let text = heading.trim_start_matches('#').trim();
				if !text.is_empty() {
					rows.push(MdRow::Heading(level.min(3), text.to_owned()));
					continue;
				}
			}
		}
		if let Some(rest) = body.strip_prefix("- ").or_else(|| body.strip_prefix("* ")) {
			rows.push(MdRow::Bullet(rest.trim().to_owned()));
			continue;
		}
		// `1. `, `12. ` … but not `1.5` (no space after the dot).
		let digits = body.chars().take_while(char::is_ascii_digit).count();
		if digits > 0 {
			if let Some(rest) = body[digits..].strip_prefix(". ") {
				rows.push(MdRow::Bullet(rest.trim().to_owned()));
				continue;
			}
		}
		rows.push(MdRow::Text(trimmed.to_owned()));
	}
	rows
}

/// The page's sub-tabs, in the order the head lists them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Tab {
	#[default]
	Overview,
	Status,
	Plans,
	Summaries,
	Sessions,
}

impl Tab {
	pub const ALL: [Self; 5] =
		[Self::Overview, Self::Status, Self::Plans, Self::Summaries, Self::Sessions];

	pub fn label(self) -> &'static str {
		match self {
			Self::Overview => t!("概览"),
			Self::Status => t!("状态"),
			Self::Plans => t!("计划"),
			Self::Summaries => t!("摘要"),
			Self::Sessions => t!("会话"),
		}
	}

	/// The documents this tab lists.
	pub fn docs<'a>(self, docs: &'a Docs) -> &'a [Doc] {
		match self {
			Self::Plans => &docs.plans,
			Self::Summaries => &docs.summaries,
			Self::Sessions => &docs.sessions,
			_ => &[],
		}
	}
}

/// The page's state: the last read and the open sub-tab.
#[derive(Default)]
pub struct TrackingCache {
	root: Option<PathBuf>,
	docs: Docs,
	loaded_at: Option<Instant>,
	pub tab: Tab,
}

impl TrackingCache {
	/// Point the page at `root` and re-read when the root changed or the TTL
	/// has passed.
	pub fn refresh(&mut self, root: &Path, now: Instant) {
		let changed = self.root.as_deref() != Some(root);
		if !changed
			&& self
				.loaded_at
				.is_some_and(|at| now.saturating_duration_since(at) < REFRESH)
		{
			return;
		}
		self.root = Some(root.to_path_buf());
		self.docs = read(root);
		self.loaded_at = Some(now);
	}

	pub fn docs(&self) -> &Docs {
		&self.docs
	}

	/// Force the next [`Self::refresh`] to re-read.
	pub fn reload(&mut self) {
		self.loaded_at = None;
	}

	/// Seed the page (the headless screenshots).
	pub fn seed(&mut self, docs: Docs) {
		self.docs = docs;
		self.loaded_at = Some(Instant::now());
	}
}

/// The page.
pub fn panel(ui: &mut egui::Ui, shell: &mut Shell) {
	panel_head(ui, RightTab::Tracking.title(), |ui| {
		if crate::icons::icon_button(
			ui,
			crate::icons::Icon::Refresh,
			20.0,
			false,
			t!("重新读取跟踪文档"),
		)
		.clicked()
		{
			shell.tracking.reload();
		}
	});
	let Some(root) = shell
		.state
		.active_workspace()
		.map(|workspace| PathBuf::from(&workspace.path))
	else {
		empty_note(ui, t!("没有打开的工作区"));
		return;
	};
	let docs = shell.tracking.docs().clone();
	if docs.is_empty() {
		empty_note(ui, &t!("这个工作区还没有跟踪文档：{}", tracking_dir(&root).display()));
		return;
	}

	// The sub-tab strip: the head's five documents.
	let mut chosen = None;
	ui.add_space(4.0);
	ui.horizontal_wrapped(|ui| {
		ui.spacing_mut().item_spacing.x = 4.0;
		for tab in Tab::ALL {
			let active = shell.tracking.tab == tab;
			let response = crate::widgets::chip(
				ui,
				tab.label(),
				if active {
					crate::widgets::Chip::Active
				} else {
					crate::widgets::Chip::Plain
				},
			);
			if response.clicked() {
				chosen = Some(tab);
			}
		}
	});
	if let Some(tab) = chosen {
		shell.tracking.tab = tab;
	}
	ui.add_space(6.0);

	egui::ScrollArea::vertical()
		.id_salt(("zetawork-tracking", shell.tracking.tab))
		.auto_shrink([false, false])
		.show(ui, |ui| match shell.tracking.tab {
			Tab::Overview => match &docs.index {
				Some(text) => markdown(ui, text),
				None => empty_note(ui, t!("还没有 INDEX.md")),
			},
			Tab::Status => match &docs.status {
				Some(status) => status_view(ui, status),
				None => empty_note(ui, t!("还没有 status.json")),
			},
			tab => doc_list(ui, tab.docs(&docs), tab),
		});
}

/// The 状态 tab: the fields the tracking tool maintains.
fn status_view(ui: &mut egui::Ui, status: &Status) {
	ui.add_space(2.0);
	field(ui, t!("阶段"), non_empty(&status.phase));
	field(ui, t!("进度"), non_empty(&status.progress));
	if let Some(stage) = &status.stage {
		field(ui, t!("当前待办"), stage);
	}
	field(ui, t!("更新于"), non_empty(&status.last_updated));
	if let Some(session) = &status.last_session_id {
		field(ui, t!("最后会话"), session);
	}
	field(ui, t!("阻塞"), &list_text(&status.blockers));
	field(ui, t!("决定"), &list_text(&status.decisions));
	if !status.phases.is_empty() {
		heading(ui, t!("待办阶段"));
		for phase in &status.phases {
			let (rect, _) =
				ui.allocate_exact_size(egui::vec2(ui.available_width(), 20.0), egui::Sense::hover());
			truncated_text(
				ui,
				egui::pos2(rect.min.x + 10.0, rect.center().y),
				&phase.name,
				11.5,
				theme::TEXT,
				rect.width() - 90.0,
			);
			truncated_mono(
				ui,
				egui::pos2(rect.min.x + rect.width() - 10.0, rect.center().y),
				&phase.status,
				10.0,
				theme::TEXT_3,
				70.0,
			);
		}
	}
	ui.add_space(8.0);
}

/// One label/value pair of the status tab.
fn field(ui: &mut egui::Ui, label: &str, value: &str) {
	let (rect, _) =
		ui.allocate_exact_size(egui::vec2(ui.available_width(), 30.0), egui::Sense::hover());
	truncated_text(
		ui,
		egui::pos2(rect.min.x + 10.0, rect.min.y + 8.0),
		label,
		10.5,
		theme::TEXT_3,
		rect.width() - 20.0,
	);
	truncated_text(
		ui,
		egui::pos2(rect.min.x + 10.0, rect.max.y - 8.0),
		value,
		11.5,
		theme::TEXT,
		rect.width() - 20.0,
	);
}

/// One heading row.
fn heading(ui: &mut egui::Ui, text: &str) {
	let (rect, _) =
		ui.allocate_exact_size(egui::vec2(ui.available_width(), 24.0), egui::Sense::hover());
	truncated_text(
		ui,
		egui::pos2(rect.min.x + 10.0, rect.center().y),
		text,
		11.0,
		theme::TEXT_2,
		rect.width() - 20.0,
	);
}

/// The plans / summaries / sessions listings: one collapsible document each.
fn doc_list(ui: &mut egui::Ui, docs: &[Doc], tab: Tab) {
	if docs.is_empty() {
		let line = match tab {
			Tab::Plans => t!("还没有计划文档"),
			Tab::Summaries => t!("还没有摘要文档"),
			Tab::Sessions => t!("还没有会话文档"),
			_ => t!("还没有文档"),
		};
		empty_note(ui, line);
		return;
	}
	for doc in docs {
		egui::CollapsingHeader::new(&doc.name)
			.id_salt(("zetawork-tracking-doc", tab, &doc.name))
			.show(ui, |ui| markdown(ui, &doc.content));
	}
}

/// Render tracking markdown at the column's width.
pub fn markdown(ui: &mut egui::Ui, text: &str) {
	ui.add_space(2.0);
	for row in markdown_rows(text) {
		match row {
			MdRow::Blank => ui.add_space(5.0),
			MdRow::Heading(level, text) => {
				ui.add_space(if level == 1 { 6.0 } else { 3.0 });
				ui.add(
					egui::Label::new(
						egui::RichText::new(text)
							.size(12.0 + (3 - level) as f32)
							.color(if level == 1 {
								theme::TEXT
							} else {
								theme::TEXT_2
							})
							.strong(),
					)
					.wrap(),
				);
			},
			MdRow::Bullet(text) => {
				ui.horizontal_top(|ui| {
					ui.add_space(6.0);
					ui.label(egui::RichText::new("•").size(11.5).color(theme::TEXT_3));
					ui.add(
						egui::Label::new(egui::RichText::new(text).size(11.5).color(theme::TEXT)).wrap(),
					);
				});
			},
			MdRow::Fence(language) => {
				if !language.trim_matches('`').is_empty() {
					truncated_mono(
						ui,
						egui::pos2(ui.cursor().min.x + 8.0, ui.cursor().min.y + 6.0),
						&language,
						10.0,
						theme::TEXT_3,
						ui.available_width() - 16.0,
					);
					ui.add_space(12.0);
				}
			},
			MdRow::Text(text) => {
				ui.horizontal_top(|ui| {
					ui.add_space(6.0);
					ui.add(
						egui::Label::new(egui::RichText::new(text).size(11.5).color(theme::TEXT_2))
							.wrap(),
					);
				});
			},
		}
	}
	ui.add_space(8.0);
}

/// A status value, or the em dash when the tool recorded none.
fn non_empty(text: &str) -> &str {
	if text.trim().is_empty() {
		"—"
	} else {
		text.trim()
	}
}

/// Join a blocker/decision list with the separator the rows use.
fn list_text(rows: &[String]) -> String {
	if rows.is_empty() {
		"—".to_owned()
	} else {
		rows.join(" · ")
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	const STATUS: &str = r#"{
		"phase": "impl",
		"progress": "3/5",
		"stage": "wire the page",
		"blockers": ["waiting on review", 7],
		"decisions": ["read files, not the gateway"],
		"lastUpdated": "2026-10-21T08:00:00.000Z",
		"lastSessionId": "01abc",
		"phases": [{"name":"plan","status":"done"},{"name":"impl","status":"active"},{"nope":1}]
	}"#;

	#[test]
	fn status_parses_fields_phases_and_skips_mistyped_rows() {
		let status = parse_status(STATUS).expect("the tool's shape parses");
		assert_eq!(status.phase, "impl");
		assert_eq!(status.progress, "3/5");
		assert_eq!(status.stage.as_deref(), Some("wire the page"));
		assert_eq!(status.blockers, ["waiting on review"], "a non-string row is dropped");
		assert_eq!(status.decisions, ["read files, not the gateway"]);
		assert_eq!(status.phases.len(), 2);
		assert_eq!(status.phases[1].name, "impl");
		assert_eq!(status.last_session_id.as_deref(), Some("01abc"));
		assert!(parse_status("[]").is_err(), "an array is not a status object");
		assert!(parse_status("{oops").is_err());
		let empty = parse_status("{}").expect("an empty object is a status");
		assert_eq!(empty.phase, "");
		assert!(empty.phases.is_empty());
	}

	#[test]
	fn markdown_rows_classify_headings_bullets_and_fences() {
		let text = "# Goal\n\n- one\n  - nested\n1. first\n12. twelfth\n```rust\nlet x = 1;\n```\nplain **bold**\n";
		let rows = markdown_rows(text);
		assert_eq!(rows[0], MdRow::Heading(1, "Goal".into()));
		assert_eq!(rows[1], MdRow::Blank);
		assert_eq!(rows[2], MdRow::Bullet("one".into()));
		assert_eq!(rows[3], MdRow::Bullet("nested".into()), "a nested dash is still a row");
		assert_eq!(rows[4], MdRow::Bullet("first".into()));
		assert_eq!(rows[5], MdRow::Bullet("twelfth".into()));
		assert_eq!(rows[6], MdRow::Fence("```rust".into()));
		assert_eq!(rows[7], MdRow::Text("let x = 1;".into()));
		assert_eq!(rows[8], MdRow::Fence("```".into()));
		assert_eq!(rows[9], MdRow::Text("plain **bold**".into()), "markers are kept");
	}

	#[test]
	fn reads_a_real_tracking_directory_newest_first() {
		let root = std::env::temp_dir().join(format!("zetawork-gui-tracking-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&root);
		assert!(read(&root).is_empty(), "a missing directory is an empty page");

		let dir = tracking_dir(&root);
		std::fs::create_dir_all(dir.join("plans")).unwrap();
		std::fs::create_dir_all(dir.join("summaries")).unwrap();
		std::fs::write(dir.join("INDEX.md"), "# Goal\nship it\n").unwrap();
		std::fs::write(dir.join("status.json"), STATUS).unwrap();
		std::fs::write(dir.join("plans/old-plan.md"), "# Old\n").unwrap();
		std::thread::sleep(std::time::Duration::from_millis(15));
		std::fs::write(dir.join("plans/new-plan.md"), "# New\n").unwrap();
		std::fs::write(dir.join("summaries/compaction-1.md"), "# Summary\n").unwrap();

		let docs = read(&root);
		assert!(!docs.is_empty());
		assert_eq!(docs.index.as_deref(), Some("# Goal\nship it\n"));
		assert_eq!(docs.status.as_ref().map(|status| status.phase.as_str()), Some("impl"));
		assert_eq!(docs.plans.len(), 2);
		assert_eq!(docs.plans[0].name, "new-plan.md", "newest first");
		assert_eq!(docs.summaries[0].name, "compaction-1.md");
		assert!(docs.sessions.is_empty(), "a missing subdirectory lists nothing");

		// A cache re-reads only when stale or re-rooted.
		let mut cache = TrackingCache::default();
		cache.refresh(&root, Instant::now());
		assert_eq!(cache.docs().plans.len(), 2);
		std::fs::write(dir.join("plans/third.md"), "# Third\n").unwrap();
		cache.refresh(&root, Instant::now());
		assert_eq!(cache.docs().plans.len(), 2, "the TTL guards the read");
		cache.reload();
		cache.refresh(&root, Instant::now());
		assert_eq!(cache.docs().plans.len(), 3, "an explicit reload re-reads");
		let _ = std::fs::remove_dir_all(&root);
	}
}
