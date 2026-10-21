// SPDX-License-Identifier: AGPL-3.0-only
//! 会话管理: search, pin, archive and restore every gateway conversation.
//!
//! The left column lists conversations by workspace; this modal is the flat,
//! cross-project view the web UI's sidebar actions provide. It is the same
//! data the 历史 page reads (`GET /api/sessions`) plus the archive tree
//! (`GET /api/sessions/archived`), with two mutations:
//!
//! ```text
//! POST /api/sessions/<id>/archive
//! POST /api/sessions/<id>/unarchive
//! ```
//!
//! Pinning is a GUI preference, not a gateway field: [`crate::sessions::pins_path`]
//! is written only by a real run (`probe`), and pinned rows sort first in this
//! list and are marked in 历史. Archive and restore are the gateway's own
//! filesystem moves — the modal never deletes a transcript.
//!
//! Both requests run on a worker and are drained by [`Admin::poll`]; the modal
//! never blocks a frame on a socket.

use std::{
	sync::mpsc::{Receiver, TryRecvError, channel},
	thread,
	time::{Duration, Instant},
};

use egui::{Align, Color32, CornerRadius, Layout, Order, Rect, Sense, Stroke, pos2, vec2};

use crate::{
	Shell,
	sessions::{self, Conversation},
	t, theme,
	widgets::{truncated_mono, truncated_text},
};

/// How often the archive list is re-read while its tab is open.
pub const REFRESH: Duration = Duration::from_secs(5);

/// The modal's two lists.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Tab {
	#[default]
	Active,
	Archived,
}

impl Tab {
	pub const ALL: [Self; 2] = [Self::Active, Self::Archived];

	pub fn label(self) -> &'static str {
		match self {
			Self::Active => t!("进行中"),
			Self::Archived => t!("已归档"),
		}
	}
}

/// What a finished request reports.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
	/// The archive list landed.
	Archived,
	/// One session was archived.
	DidArchive(String),
	/// One session was restored.
	DidUnarchive(String),
	Failed(String),
}

/// The modal's state.
#[derive(Default)]
pub struct Admin {
	pub query: String,
	pub tab: Tab,
	rows: Vec<Conversation>,
	error: Option<String>,
	loaded_at: Option<Instant>,
	load: Option<Receiver<Result<Vec<Conversation>, String>>>,
	op: Option<Receiver<(String, bool, Result<(), String>)>>,
	/// The session whose archive/restore is in flight.
	busy: Option<String>,
	/// The modal's first frame: give the search field the keyboard once.
	focus_once: bool,
	/// Whether the modal was open on the previous frame.
	was_open: bool,
	pub notice: Option<(bool, String)>,
}

impl Admin {
	/// Re-read the archive list while its tab is visible.
	pub fn tick(&mut self, origin: Option<&str>, open: bool, now: Instant) {
		if !open || self.tab != Tab::Archived || self.load.is_some() {
			return;
		}
		if self
			.loaded_at
			.is_some_and(|at| now.saturating_duration_since(at) < REFRESH)
		{
			return;
		}
		let Some(origin) = origin.map(str::to_owned) else {
			self.error = Some(t!("未发现网关地址（~/.zeta/serve.json 的 webUrl）").to_owned());
			return;
		};
		let (sender, receiver) = channel();
		self.load = Some(receiver);
		thread::spawn(move || {
			let result = crate::usage::http_get(&origin, sessions::ARCHIVED_PATH)
				.map_err(describe)
				.and_then(|body| sessions::decode_archived(&body));
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
					events.push(Event::Archived);
				},
				Ok(Err(error)) => {
					self.error = Some(error.clone());
					self.loaded_at = Some(now);
					events.push(Event::Failed(error));
				},
				Err(TryRecvError::Empty) => self.load = Some(receiver),
				Err(TryRecvError::Disconnected) => {
					let error = t!("归档列表的读取线程已结束").to_owned();
					self.error = Some(error.clone());
					self.loaded_at = Some(now);
					events.push(Event::Failed(error));
				},
			}
		}
		if let Some(receiver) = self.op.take() {
			match receiver.try_recv() {
				Ok((id, archived, result)) => match result {
					Ok(()) => {
						self.busy = None;
						self.loaded_at = None;
						events.push(if archived {
							Event::DidArchive(id)
						} else {
							Event::DidUnarchive(id)
						});
					},
					Err(error) => {
						self.busy = None;
						events.push(Event::Failed(error));
					},
				},
				Err(TryRecvError::Empty) => self.op = Some(receiver),
				Err(TryRecvError::Disconnected) => {
					self.busy = None;
					events.push(Event::Failed(t!("归档请求的线程已结束").to_owned()));
				},
			}
		}
		events
	}

	/// The archived rows last read.
	pub fn rows(&self) -> &[Conversation] {
		&self.rows
	}

	pub fn error(&self) -> Option<&str> {
		self.error.as_deref()
	}

	pub fn is_busy(&self, id: &str) -> bool {
		self.busy.as_deref() == Some(id)
	}

	/// Seed the archived list (tests and screenshots).
	pub fn seed(&mut self, rows: Vec<Conversation>) {
		self.rows = rows;
		self.error = None;
		self.loaded_at = Some(Instant::now());
	}

	/// Archive one live session.
	pub fn request_archive(&mut self, origin: Option<&str>, id: &str) -> Result<(), String> {
		self.request(origin, id, true)
	}

	/// Restore one archived session.
	pub fn request_unarchive(&mut self, origin: Option<&str>, id: &str) -> Result<(), String> {
		self.request(origin, id, false)
	}

	fn request(&mut self, origin: Option<&str>, id: &str, archived: bool) -> Result<(), String> {
		let Some(origin) = origin.map(str::to_owned) else {
			return Err(t!("未发现网关地址（~/.zeta/serve.json 的 webUrl）").to_owned());
		};
		if self.op.is_some() {
			return Err(t!("上一个归档操作仍在进行").to_owned());
		}
		if id.trim().is_empty() {
			return Err(t!("会话 id 为空").to_owned());
		}
		let path = archive_path(id, archived);
		let id = id.to_owned();
		let (sender, receiver) = channel();
		self.op = Some(receiver);
		self.busy = Some(id.clone());
		let result_id = id.clone();
		thread::spawn(move || {
			let result = crate::usage::http_post(&origin, &path, "{}")
				.map(|_| ())
				.map_err(describe);
			let _ = sender.send((result_id, archived, result));
		});
		Ok(())
	}
}

/// The endpoint one session's archive/restore lives at.
///
/// The id is one path segment, so characters that would change the path are
/// percent-encoded. Gateway ids are hex-ish, but the modal must not depend on
/// that.
pub fn archive_path(id: &str, archived: bool) -> String {
	let verb = if archived { "archive" } else { "unarchive" };
	format!("/api/sessions/{}/{verb}", encode_segment(id))
}

/// Percent-encode everything outside RFC 3986's unreserved set.
fn encode_segment(text: &str) -> String {
	let mut out = String::with_capacity(text.len());
	for byte in text.bytes() {
		if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
			out.push(byte as char);
		} else {
			out.push_str(&format!("%{byte:02X}"));
		}
	}
	out
}

/// The rows a list shows: pinned first, then newest first.
///
/// Pinning is the only reorder; within each group the gateway's newest-first
/// order is preserved. A query uses the same matching rules as 历史.
pub fn visible<'a>(
	rows: &'a [Conversation],
	query: &str,
	pins: &[String],
) -> Vec<&'a Conversation> {
	let mut rows: Vec<&Conversation> = rows
		.iter()
		.filter(|row| crate::history::matches(row, query))
		.collect();
	rows.sort_by(|a, b| {
		let a_pinned = pins.iter().any(|id| id == &a.id);
		let b_pinned = pins.iter().any(|id| id == &b.id);
		b_pinned
			.cmp(&a_pinned)
			.then_with(|| b.modified_ms.cmp(&a.modified_ms))
			.then_with(|| a.id.cmp(&b.id))
	});
	rows
}

/// One group heading of the list.
fn section_head(ui: &mut egui::Ui, label: &str) {
	let (head, _) = ui.allocate_exact_size(vec2(ui.available_width(), 20.0), Sense::hover());
	ui.painter().text(
		pos2(head.min.x + 12.0, head.center().y),
		egui::Align2::LEFT_CENTER,
		label,
		egui::FontId::new(10.0, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
}

/// The 会话管理 modal.
pub fn modal(ctx: &egui::Context, shell: &mut Shell) {
	if !shell.state.sessions_open {
		shell.session_admin.was_open = false;
		return;
	}
	if !shell.session_admin.was_open {
		shell.session_admin.was_open = true;
		shell.session_admin.focus_once = true;
	}
	let screen = ctx.content_rect();
	let rect = Rect::from_center_size(screen.center(), vec2(680.0, 540.0));
	let mut close = false;
	let mut archive: Option<String> = None;
	let mut restore: Option<String> = None;
	let mut pin: Option<String> = None;
	let mut open: Option<String> = None;

	egui::Area::new(egui::Id::new("zetawork-sessions-admin"))
		.order(Order::Foreground)
		.fixed_pos(rect.min)
		.show(ctx, |ui| {
			let (backdrop, backdrop_response) = ui.allocate_exact_size(screen.size(), Sense::click());
			if backdrop_response.clicked() {
				close = true;
			}
			ui.painter().rect_filled(
				backdrop,
				CornerRadius::ZERO,
				Color32::from_rgba_unmultiplied(3, 5, 8, 70),
			);
			let mut panel = ui.new_child(
				egui::UiBuilder::new()
					.max_rect(rect)
					.layout(Layout::top_down(Align::Min)),
			);
			let painter = panel.painter().clone();
			painter.rect_filled(rect, CornerRadius::same(theme::R_MODAL), theme::PANEL);
			painter.rect_stroke(
				rect,
				CornerRadius::same(theme::R_MODAL),
				Stroke::new(1.0_f32, theme::BORDER_2),
				egui::StrokeKind::Inside,
			);
			painter.text(
				pos2(rect.min.x + 18.0, rect.min.y + 24.0),
				egui::Align2::LEFT_CENTER,
				t!("会话管理"),
				egui::FontId::new(14.0, egui::FontFamily::Proportional),
				theme::TEXT,
			);
			painter.text(
				pos2(rect.max.x - 18.0, rect.min.y + 24.0),
				egui::Align2::RIGHT_CENTER,
				t!("跨项目搜索、置顶、归档与恢复"),
				egui::FontId::new(10.0, egui::FontFamily::Proportional),
				theme::TEXT_3,
			);

			// Search.
			let field = Rect::from_min_size(
				pos2(rect.min.x + 18.0, rect.min.y + 44.0),
				vec2(rect.width() - 36.0, 30.0),
			);
			let mut field_ui = panel.new_child(
				egui::UiBuilder::new()
					.max_rect(field)
					.layout(Layout::left_to_right(Align::Center)),
			);
			let search = field_ui.add(
				egui::TextEdit::singleline(&mut shell.session_admin.query)
					.hint_text(t!("搜索标题、id 或目录"))
					.desired_width(field.width()),
			);
			if shell.session_admin.focus_once {
				search.request_focus();
				shell.session_admin.focus_once = false;
			}

			// Tabs.
			let tabs = Rect::from_min_size(
				pos2(rect.min.x + 18.0, rect.min.y + 82.0),
				vec2(rect.width() - 36.0, 24.0),
			);
			let mut tabs_ui = panel.new_child(
				egui::UiBuilder::new()
					.max_rect(tabs)
					.layout(Layout::left_to_right(Align::Center)),
			);
			let mut chosen_tab = None;
			for tab in Tab::ALL {
				let active = shell.session_admin.tab == tab;
				if crate::widgets::chip(
					&mut tabs_ui,
					tab.label(),
					if active {
						crate::widgets::Chip::Active
					} else {
						crate::widgets::Chip::Plain
					},
				)
				.clicked()
				{
					chosen_tab = Some(tab);
				}
				tabs_ui.add_space(6.0);
			}
			if let Some(tab) = chosen_tab {
				shell.session_admin.tab = tab;
			}

			let rows: Vec<Conversation> = match shell.session_admin.tab {
				Tab::Active => shell.sessions.rows().to_vec(),
				Tab::Archived => shell.session_admin.rows().to_vec(),
			};
			let filtered = visible(&rows, &shell.session_admin.query, &shell.state.pinned_sessions);
			let list = Rect::from_min_size(
				pos2(rect.min.x + 10.0, rect.min.y + 114.0),
				vec2(rect.width() - 20.0, rect.height() - 150.0),
			);
			let mut list_ui = panel.new_child(
				egui::UiBuilder::new()
					.max_rect(list)
					.layout(Layout::top_down(Align::Min)),
			);
			let mut section = "";
			egui::ScrollArea::vertical()
				.id_salt(("zetawork-sessions-admin-rows", shell.session_admin.tab))
				.auto_shrink([false, false])
				.show(&mut list_ui, |ui| {
					if filtered.is_empty() {
						let line = match shell.session_admin.tab {
							Tab::Active => t!("没有匹配的会话"),
							Tab::Archived => t!("归档里没有会话"),
						};
						truncated_text(
							ui,
							pos2(ui.cursor().min.x + 18.0, ui.cursor().min.y + 20.0),
							line,
							12.0,
							theme::TEXT_3,
							ui.available_width() - 36.0,
						);
						return;
					}
					for row in &filtered {
						let pinned = shell.state.is_pinned(&row.id);
						let group = if pinned {
							t!("已置顶")
						} else {
							t!("全部会话")
						};
						if group != section {
							section = group;
							section_head(ui, group);
						}
						let (row_rect, response) =
							ui.allocate_exact_size(vec2(ui.available_width(), 42.0), Sense::click());
						if response.hovered() {
							ui.painter().rect_filled(
								row_rect.shrink2(vec2(8.0, 1.0)),
								CornerRadius::same(theme::R_CONTROL),
								theme::PANEL_3,
							);
						}
						truncated_text(
							ui,
							pos2(row_rect.min.x + 16.0, row_rect.center().y - 8.0),
							row.display_title(),
							12.0,
							theme::TEXT,
							row_rect.width() - 200.0,
						);
						truncated_mono(
							ui,
							pos2(row_rect.min.x + 16.0, row_rect.center().y + 8.0),
							&t!("{} · {} 条消息 · {}", row.cwd.display(), row.message_count, row.id),
							9.5,
							theme::TEXT_3,
							row_rect.width() - 200.0,
						);
						// Actions, painted as three small buttons at the right.
						let button = |ui: &mut egui::Ui, label: &str, active: bool| -> bool {
							ui.add(
								egui::Button::new(egui::RichText::new(label).size(10.5).color(if active {
									theme::ACCENT_2
								} else {
									theme::TEXT_2
								}))
								.frame(true)
								.min_size(vec2(54.0, 20.0)),
							)
							.clicked()
						};
						let mut actions = ui.new_child(
							egui::UiBuilder::new()
								.max_rect(Rect::from_min_size(
									pos2(row_rect.max.x - 176.0, row_rect.center().y - 10.0),
									vec2(168.0, 20.0),
								))
								.layout(Layout::right_to_left(Align::Center)),
						);
						let busy = shell.session_admin.is_busy(&row.id);
						let mut acted = false;
						match shell.session_admin.tab {
							Tab::Active => {
								if button(
									&mut actions,
									if pinned {
										t!("取消置顶")
									} else {
										t!("置顶")
									},
									pinned,
								) {
									pin = Some(row.id.clone());
									acted = true;
								}
								actions.add_space(4.0);
								if !busy && button(&mut actions, t!("归档"), false) {
									archive = Some(row.id.clone());
									acted = true;
								}
							},
							Tab::Archived => {
								if !busy && button(&mut actions, t!("恢复"), false) {
									restore = Some(row.id.clone());
									acted = true;
								}
							},
						}
						if response.clicked() && !acted && shell.session_admin.tab == Tab::Active {
							open = Some(row.id.clone());
						}
					}
				});

			if let Some((ok, line)) = shell.session_admin.notice.clone() {
				painter.text(
					pos2(rect.min.x + 18.0, rect.max.y - 20.0),
					egui::Align2::LEFT_CENTER,
					line,
					egui::FontId::new(10.0, egui::FontFamily::Proportional),
					if ok { theme::ADD } else { theme::WARN },
				);
			}
			painter.text(
				pos2(rect.max.x - 18.0, rect.max.y - 20.0),
				egui::Align2::RIGHT_CENTER,
				t!("Esc 关闭"),
				egui::FontId::new(10.0, egui::FontFamily::Proportional),
				theme::TEXT_3,
			);
		});

	if let Some(id) = open {
		let notice = shell.state.open_conversation(&id);
		shell.state.show(notice);
		shell.state.sessions_open = false;
	}
	if let Some(id) = pin {
		toggle_pin(shell, &id);
	}
	if let Some(id) = archive {
		let origin = shell.sessions.origin().map(str::to_owned);
		match shell.session_admin.request_archive(origin.as_deref(), &id) {
			Ok(()) => shell.session_admin.notice = Some((true, t!("正在归档…").to_owned())),
			Err(error) => shell.session_admin.notice = Some((false, error)),
		}
	}
	if let Some(id) = restore {
		let origin = shell.sessions.origin().map(str::to_owned);
		match shell
			.session_admin
			.request_unarchive(origin.as_deref(), &id)
		{
			Ok(()) => shell.session_admin.notice = Some((true, t!("正在恢复…").to_owned())),
			Err(error) => shell.session_admin.notice = Some((false, error)),
		}
	}
	if close {
		shell.state.sessions_open = false;
	}
}

/// Pin or unpin, and persist the change when this is a real run.
pub fn toggle_pin(shell: &mut Shell, id: &str) {
	let now = shell.state.toggle_session_pin(id);
	let line = if now {
		t!("已置顶")
	} else {
		t!("已取消置顶")
	};
	shell.session_admin.notice = Some((true, line.to_owned()));
	if shell.probe {
		if let Err(error) =
			sessions::save_pins_to(&sessions::pins_path(), &shell.state.pinned_sessions)
		{
			shell.session_admin.notice = Some((false, error));
		}
	}
}

/// The transport's reason, without the stats-specific wording.
fn describe(error: crate::usage::FetchError) -> String {
	use crate::usage::FetchError;
	match error {
		FetchError::Address(why) | FetchError::Connect(why) | FetchError::Io(why) => why,
		FetchError::Status(code, body) if body.is_empty() => t!("网关返回 HTTP {}", code),
		FetchError::Status(code, body) => t!("网关返回 HTTP {}：{}", code, body),
		FetchError::Decode(why) => t!("网关应答无法解析：{}", why),
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::path::PathBuf;

	fn row(id: &str, modified_ms: i64) -> Conversation {
		Conversation {
			id: id.to_owned(),
			cwd: PathBuf::from("/work/alpha"),
			title: format!("Session {id}"),
			modified_ms,
			message_count: 2,
			running: false,
		}
	}

	#[test]
	fn visible_rows_are_searched_pinned_first_then_newest() {
		let rows = vec![row("newest", 3_000), row("pinned-old", 1_000), row("middle", 2_000)];
		let pins = vec!["pinned-old".to_owned()];
		let ids: Vec<&str> = visible(&rows, "", &pins)
			.iter()
			.map(|row| row.id.as_str())
			.collect();
		assert_eq!(ids, ["pinned-old", "newest", "middle"]);
		let none: Vec<&str> = visible(&rows, "", &[])
			.iter()
			.map(|row| row.id.as_str())
			.collect();
		assert_eq!(none, ["newest", "middle", "pinned-old"]);
		assert_eq!(visible(&rows, "session middle", &pins).len(), 1);
		assert!(visible(&rows, "zzz", &pins).is_empty());
	}

	#[test]
	fn archive_paths_are_built_and_escaped() {
		assert_eq!(archive_path("01abc", true), "/api/sessions/01abc/archive");
		assert_eq!(archive_path("01abc", false), "/api/sessions/01abc/unarchive");
		assert_eq!(archive_path("a/b", true), "/api/sessions/a%2Fb/archive");
		assert_eq!(archive_path("a b", false), "/api/sessions/a%20b/unarchive");
	}

	#[test]
	fn a_request_needs_an_origin_and_an_id() {
		let mut admin = Admin::default();
		assert!(admin.request_archive(None, "x").is_err());
		assert!(
			admin
				.request_archive(Some("http://127.0.0.1:9"), "  ")
				.is_err()
		);
		// A loopback that is not listening still spawns a worker; the failure
		// is reported through poll rather than here.
		assert!(
			admin
				.request_archive(Some("http://127.0.0.1:9"), "x")
				.is_ok()
		);
		assert!(
			admin
				.request_archive(Some("http://127.0.0.1:9"), "y")
				.is_err()
		);
		assert!(admin.is_busy("x"));
	}

	#[test]
	fn archive_rows_decode_and_seed() {
		let mut admin = Admin::default();
		assert!(admin.rows().is_empty());
		admin.seed(vec![row("archived", 5)]);
		admin.tab = Tab::Archived;
		assert_eq!(admin.rows().len(), 1);
	}
}
