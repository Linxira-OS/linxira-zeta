// SPDX-License-Identifier: AGPL-3.0-only
//! The right column's 历史 page: the gateway's whole conversation list, newest
//! first and searchable.
//!
//! The data is the list the shell already keeps for the left column
//! ([`crate::sessions::SessionCache`], `GET /api/sessions`) — the same
//! catalogue the gateway exports a transcript from. The page adds no second
//! fetch: it filters and groups what the shell has, so opening 历史 never
//! starts a request of its own and the two surfaces can never disagree about
//! which sessions exist.
//!
//! # Filtering
//!
//! [`matches`] is case-insensitive and whitespace-splits the query: every
//! token must appear in the title, the session id or the cwd. That makes
//! `zeta parser` find a "Fix the parser" session under `/work/zeta`, and a
//! pasted session id find its row even when the title is empty.
//!
//! # Ordering
//!
//! [`filter`] preserves the list's newest-first order and does **not** lift
//! pinned rows: a history page that reorders itself is a history page whose
//! dates lie. Pins are marked on the row instead.

use chrono::{Local, TimeZone};

use crate::{
	Shell,
	state::{ConversationEntry, RightTab},
	t, theme,
	widgets::{empty_note, panel_head, truncated_mono, truncated_text},
};

/// How many rows a page offers before it stops counting; the list is scrollable
/// and the gateway's list is bounded by disk anyway.
pub const MAX_ROWS: usize = 500;

/// The page's own state: the search box's text.
#[derive(Default)]
pub struct HistoryView {
	pub query: String,
}

/// Is `conversation` a match for `query`?
///
/// An empty query matches everything. Each whitespace-separated token has to
/// appear in at least one of title, id or cwd (case-insensitive), so several
/// words narrow rather than widen.
pub fn matches(conversation: &crate::sessions::Conversation, query: &str) -> bool {
	let query = query.trim();
	if query.is_empty() {
		return true;
	}
	let title = conversation.title.to_lowercase();
	let id = conversation.id.to_lowercase();
	let cwd = conversation.cwd.to_string_lossy().to_lowercase();
	query
		.split_whitespace()
		.all(|token| {
			let token = token.to_lowercase();
			title.contains(&token) || id.contains(&token) || cwd.contains(&token)
		})
}

/// The rows the page shows, in the order it shows them.
pub fn filter<'a>(
	entries: &'a [ConversationEntry],
	query: &str,
) -> Vec<&'a ConversationEntry> {
	entries
		.iter()
		.filter(|entry| matches(&entry.conversation, query))
		.take(MAX_ROWS)
		.collect()
}

/// The date heading a row belongs under: 今天, 昨天, or a `YYYY-MM-DD` date.
///
/// Both instants are milliseconds since the epoch; a `modified_ms` of 0 (the
/// gateway gave no parseable timestamp) has no day and returns an empty label,
/// which the page renders as one unlabelled group instead of inventing a date.
pub fn day_label(modified_ms: i64, now_ms: i64) -> String {
	if modified_ms <= 0 {
		return String::new();
	}
	let Some(instant) = Local.timestamp_millis_opt(modified_ms).single() else {
		return String::new();
	};
	let Some(now) = Local.timestamp_millis_opt(now_ms).single() else {
		return String::new();
	};
	let days = (now.date_naive() - instant.date_naive()).num_days();
	match days {
		0 => t!("今天").to_owned(),
		1 => t!("昨天").to_owned(),
		_ => instant.format("%Y-%m-%d").to_string(),
	}
}

/// The row's right-hand time: `HH:MM` for today, `MM-DD` otherwise.
pub fn short_time(modified_ms: i64, now_ms: i64) -> String {
	if modified_ms <= 0 {
		return String::new();
	}
	let Some(instant) = Local.timestamp_millis_opt(modified_ms).single() else {
		return String::new();
	};
	let Some(now) = Local.timestamp_millis_opt(now_ms).single() else {
		return String::new();
	};
	if now.date_naive() == instant.date_naive() {
		instant.format("%H:%M").to_string()
	} else {
		instant.format("%m-%d").to_string()
	}
}

/// The project a row belongs to, as the page labels it.
///
/// The owning workspace's name when one owns it, else the cwd's last path
/// component, else the whole cwd — never an invented project name.
pub fn project_label(shell: &Shell, entry: &ConversationEntry) -> String {
	if let Some(workspace_id) = entry.workspace_id.as_deref() {
		if let Some(workspace) = shell.state.workspace(workspace_id) {
			return workspace.name.clone();
		}
	}
	let cwd = &entry.conversation.cwd;
	if cwd.as_os_str().is_empty() {
		return t!("（没有目录）").to_owned();
	}
	cwd.file_name()
		.map(|name| name.to_string_lossy().into_owned())
		.unwrap_or_else(|| cwd.display().to_string())
}

/// The page.
pub fn panel(ui: &mut egui::Ui, shell: &mut Shell) {
	panel_head(ui, RightTab::History.title(), |ui| {
		if crate::icons::icon_button(ui, crate::icons::Icon::Refresh, 20.0, false, t!("重新读取会话列表"))
			.clicked()
		{
			shell.sessions.refresh_now();
		}
	});

	let width = ui.available_width();
	ui.add_space(4.0);
	ui.horizontal(|ui| {
		ui.add_space(6.0);
		let edit = egui::TextEdit::singleline(&mut shell.history.query)
			.hint_text(t!("搜索标题、id 或目录"))
			.desired_width(width - 44.0)
			.font(egui::TextStyle::Small);
		ui.add(edit);
		if !shell.history.query.is_empty()
			&& crate::icons::icon_button(ui, crate::icons::Icon::X, 20.0, false, t!("清除搜索"))
				.clicked()
		{
			shell.history.query.clear();
		}
	});
	ui.add_space(4.0);

	let entries = &shell.state.conversations;
	if entries.is_empty() {
		if let Some(error) = shell.sessions.error() {
			empty_note(ui, &t!("无法读取会话列表：{}", error));
		} else {
			empty_note(ui, t!("还没有对话记录"));
		}
		return;
	}

	let filtered = filter(entries, &shell.history.query);
	let query = shell.history.query.as_str();
	let pinned = &shell.state.pinned_sessions;
	let now_ms = Local::now().timestamp_millis();
	if filtered.is_empty() {
		empty_note(ui, &t!("没有匹配「{}」的会话", query.trim()));
		return;
	}

	let mut open: Option<String> = None;
	egui::ScrollArea::vertical()
		.id_salt(("zetawork-history", query))
		.auto_shrink([false, false])
		.show(ui, |ui| {
			ui.spacing_mut().item_spacing.y = 2.0;
			let mut day = String::new();
			for entry in &filtered {
				let label = day_label(entry.conversation.modified_ms, now_ms);
				if label != day {
					day = label;
					if !day.is_empty() {
						let (rect, _) = ui
							.allocate_exact_size(egui::vec2(ui.available_width(), 22.0), egui::Sense::hover());
						ui.painter().text(
							egui::pos2(rect.min.x + 10.0, rect.center().y),
							egui::Align2::LEFT_CENTER,
							&day,
							egui::FontId::new(10.5, egui::FontFamily::Proportional),
							theme::TEXT_3,
						);
					}
				}
				if let Some(id) = row(ui, shell, entry, &pinned, now_ms) {
					open = Some(id);
				}
			}
			ui.add_space(6.0);
		});
	if let Some(id) = open {
		let notice = shell.state.open_conversation(&id);
		shell.state.show(notice);
	}
}

/// One conversation row. Returns its id when clicked.
fn row(
	ui: &mut egui::Ui,
	shell: &Shell,
	entry: &ConversationEntry,
	pinned: &[String],
	now_ms: i64,
) -> Option<String> {
	let conversation = &entry.conversation;
	let (rect, response) = ui.allocate_exact_size(
		egui::vec2(ui.available_width(), 38.0),
		egui::Sense::click(),
	);
	if response.hovered() {
		ui.painter().rect_filled(
			rect.shrink2(egui::vec2(4.0, 0.0)),
			egui::CornerRadius::same(theme::R_CONTROL),
			theme::PANEL_3,
		);
	}
	let project = project_label(shell, entry);
	let is_pinned = pinned.iter().any(|id| id == &conversation.id);
	truncated_text(
		ui,
		egui::pos2(rect.min.x + 12.0, rect.center().y - 7.0),
		conversation.display_title(),
		12.0,
		theme::TEXT,
		rect.width() - 70.0,
	);
	let mut meta = project;
	if conversation.message_count > 0 {
		meta.push_str(&t!(" · {} 条消息", conversation.message_count));
	}
	if is_pinned {
		meta.push_str(&t!(" · 已置顶"));
	}
	truncated_mono(
		ui,
		egui::pos2(rect.min.x + 12.0, rect.center().y + 8.0),
		&meta,
		10.0,
		theme::TEXT_3,
		rect.width() - 70.0,
	);
	if conversation.running {
		ui.painter().circle_filled(
			egui::pos2(rect.max.x - 14.0, rect.center().y),
			3.0,
			theme::ADD,
		);
	} else {
		let time = short_time(conversation.modified_ms, now_ms);
		crate::widgets::truncated_mono_right(
			ui,
			rect.max.x - 12.0,
			rect.center().y,
			&time,
			10.0,
			theme::TEXT_3,
			36.0,
		);
	}
	let clicked = response.clicked();
	response.on_hover_text(&t!(
		"{}\n{}\n{}",
		conversation.display_title(),
		conversation.cwd.display(),
		conversation.id
	));
	clicked.then(|| conversation.id.clone())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::sessions::Conversation;
	use std::path::PathBuf;

	fn conversation(id: &str, title: &str, cwd: &str, modified_ms: i64) -> Conversation {
		Conversation {
			id: id.to_owned(),
			cwd: PathBuf::from(cwd),
			title: title.to_owned(),
			modified_ms,
			message_count: 3,
			running: false,
		}
	}

	fn entry(conversation: Conversation) -> ConversationEntry {
		ConversationEntry { conversation, workspace_id: None, pinned: false }
	}

	#[test]
	fn search_is_case_insensitive_and_every_token_must_match() {
		let row = conversation("01abc", "Fix the Parser", "/work/zeta", 1_792_569_600_000);
		assert!(matches(&row, ""));
		assert!(matches(&row, "  "));
		assert!(matches(&row, "parser"));
		assert!(matches(&row, "FIX parser"));
		assert!(matches(&row, "zeta parser"), "a cwd token and a title token combine");
		assert!(matches(&row, "01ABC"), "the id is searchable");
		assert!(!matches(&row, "parser missing"), "all tokens are required");
		assert!(!matches(&row, "release"));
	}

	#[test]
	fn filter_keeps_the_newest_first_order_it_was_given() {
		let entries = vec![
			entry(conversation("c", "Newest", "/w/a", 3_000)),
			entry(conversation("b", "Parser fix", "/w/b", 2_000)),
			entry(conversation("a", "Old parser", "/w/b", 1_000)),
		];
		let rows = filter(&entries, "parser");
		let ids: Vec<&str> = rows.iter().map(|entry| entry.conversation.id.as_str()).collect();
		assert_eq!(ids, ["b", "a"], "filtering never reorders");
		assert_eq!(filter(&entries, "").len(), 3);
	}

	#[test]
	fn days_are_named_relative_to_the_window_clock() {
		// 2026-10-21 12:00 local, built from the local calendar so the test does
		// not assume a timezone.
		let now = Local
			.with_ymd_and_hms(2026, 10, 21, 12, 0, 0)
			.single()
			.expect("a valid local instant")
			.timestamp_millis();
		let day = 86_400_000;
		assert_eq!(day_label(now - 3_600_000, now), t!("今天"));
		assert_eq!(day_label(now - day - 3_600_000, now), t!("昨天"));
		assert_eq!(day_label(now - 5 * day, now), "2026-10-16");
		assert_eq!(day_label(0, now), "", "no timestamp, no invented day");
		assert_eq!(short_time(now - 3_600_000, now), "11:00");
		assert_eq!(short_time(now - day, now), "10-20");
		assert_eq!(short_time(0, now), "");
	}

	#[test]
	fn the_page_renders_the_seeded_rows_headlessly() {
		let dir =
			std::env::temp_dir().join(format!("zetawork-gui-history-draw-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		let mut state = crate::state::AppState::seeded_with_registry(
			&dir,
			workbench_projects::Registry::empty_at(dir.join("projects.json")),
		);
		let root = state.projects[0].path.clone();
		state.set_conversations(vec![conversation(
			"sess-1",
			"Seeded session",
			&root.display().to_string(),
			1_792_569_600_000,
		)]);
		let mut shell = crate::Shell::with_state(state, crate::settings::Settings::default());
		shell.state.set_right_tab(RightTab::History);
		let ctx = egui::Context::default();
		let output = ctx.run(
			egui::RawInput {
				screen_rect: Some(egui::Rect::from_min_size(
					egui::pos2(0.0, 0.0),
					egui::vec2(1280.0, 800.0),
				)),
				..Default::default()
			},
			|ctx| {
				egui::CentralPanel::default().show(ctx, |ui| {
					panel(ui, &mut shell);
				});
			},
		);
		let drawn = output.shapes.iter().any(|clipped| match &clipped.shape {
			egui::Shape::Text(text) => text.galley.text().contains("Seeded session"),
			_ => false,
		});
		assert!(drawn, "the seeded row's title reaches the painter");
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn a_row_without_a_workspace_is_labelled_by_its_directory() {
		let dir = std::env::temp_dir().join(format!("zetawork-gui-history-{}", std::process::id()));
		let state = crate::state::AppState::seeded_with_registry(
			&dir,
			workbench_projects::Registry::empty_at(dir.join("projects.json")),
		);
		let shell = crate::Shell::with_state(state, crate::settings::Settings::default());
		let row = entry(conversation("x", "T", "/work/alpha", 1));
		assert_eq!(project_label(&shell, &row), "alpha");
		let empty = entry(conversation("y", "T", "", 1));
		assert_eq!(project_label(&shell, &empty), t!("（没有目录）"));
	}
}
