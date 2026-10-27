// SPDX-License-Identifier: AGPL-3.0-only
//! The right column's 看板 page: the user's board, three columns of cards
//! stored as markdown under `<project>/.zeta/board/`.
//!
//! The file is the only truth, and the parser/writer is the same one the IDE
//! page and the TUI board use (`termide_panel_ide::board`). This module adds
//! what only the GUI needs: a directory read throttled to once a second while
//! the page is visible (so hand edits appear without a refresh), the selected
//! card, and the edit form. Saving the form writes the card's own file; it
//! never creates a second copy of the data.
//!
//! Moving a card between columns is a file write too, not a view-only change.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use egui::{Align, CornerRadius, Layout, RichText, Sense, Ui, vec2};
use termide_panel_ide::board::{self, Assignee, Card, Column, LoadedBoard, NewCard};

use crate::{
	Shell,
	icons::{Icon, icon_button},
	state::RightTab,
	t, theme,
	widgets::{empty_note, panel_head},
};

/// How often the page re-reads the board directory while it is visible.
pub const REFRESH: Duration = Duration::from_secs(1);

/// The 看板 page's state: the last directory read, the selection, and the
/// open edit form.
#[derive(Default)]
pub struct BoardCache {
	root: Option<PathBuf>,
	board: LoadedBoard,
	loaded_at: Option<Instant>,
	selected: Option<String>,
	draft: Option<Draft>,
}

/// The edit form. `id` is `None` for a card that does not exist yet.
pub struct Draft {
	pub id: Option<String>,
	pub column: Column,
	pub title: String,
	pub tags: String,
	pub assignee: Assignee,
	pub due: String,
	pub body: String,
	/// The 删除 button's second click confirms.
	pub confirm_delete: bool,
	pub error: Option<String>,
}

impl BoardCache {
	/// Point the page at the active workspace and re-read when the root
	/// changes, or at most once per [`REFRESH`] otherwise. An open edit form
	/// freezes the re-read so a draft is not replaced under the user.
	pub fn refresh(&mut self, root: &Path, now: Instant) {
		let changed = self.root.as_deref() != Some(root);
		if changed {
			self.root = Some(root.to_path_buf());
			self.reload(root);
			return;
		}
		if self.draft.is_none()
			&& self
				.loaded_at
				.is_none_or(|at| now.saturating_duration_since(at) >= REFRESH)
		{
			if let Some(root) = self.root.clone() {
				self.reload(&root);
			}
		}
	}

	/// Re-read the directory now (the head's refresh button).
	pub fn reload_now(&mut self) {
		if let Some(root) = self.root.clone() {
			self.reload(&root);
		}
	}

	fn reload(&mut self, root: &Path) {
		let selected = self.selected.clone();
		self.board = board::load(root);
		self.loaded_at = Some(Instant::now());
		if selected
			.as_deref()
			.is_some_and(|id| !self.board.cards.iter().any(|card| card.id == id))
		{
			self.selected = None;
		}
	}

	/// Every card, in board order.
	pub fn cards(&self) -> &[Card] {
		&self.board.cards
	}

	/// Files that are not cards (a README, a half-written file).
	pub fn warning_count(&self) -> usize {
		self.board.warnings.len()
	}

	/// The selected card's id.
	pub fn selected(&self) -> Option<&str> {
		self.selected.as_deref()
	}

	/// The open edit form.
	pub fn draft(&self) -> Option<&Draft> {
		self.draft.as_ref()
	}

	/// The open edit form, for the fields the page binds to.
	pub fn draft_mut(&mut self) -> Option<&mut Draft> {
		self.draft.as_mut()
	}

	/// Start a new card in `column`.
	pub fn begin_new(&mut self, column: Column) {
		self.draft = Some(Draft {
			id: None,
			column,
			title: t!("新卡片").to_owned(),
			tags: String::new(),
			assignee: Assignee::User,
			due: String::new(),
			body: String::new(),
			confirm_delete: false,
			error: None,
		});
	}

	/// Edit an existing card in place.
	pub fn begin_edit(&mut self, id: &str) {
		let Some(card) = self.board.cards.iter().find(|card| card.id == id) else {
			return;
		};
		self.selected = Some(card.id.clone());
		self.draft = Some(Draft {
			id: Some(card.id.clone()),
			column: card.column,
			title: card.title.clone(),
			tags: card.tags.join(", "),
			assignee: card.assignee,
			due: card.due.clone().unwrap_or_default(),
			body: card.body.clone(),
			confirm_delete: false,
			error: None,
		});
	}

	/// Close the form without writing.
	pub fn cancel(&mut self) {
		self.draft = None;
	}

	/// Write the form back to the card's file (or create a new one).
	pub fn save(&mut self) {
		let Some(mut draft) = self.draft.take() else {
			return;
		};
		let Some(root) = self.root.clone() else {
			return;
		};
		let title = draft.title.split_whitespace().collect::<Vec<_>>().join(" ");
		if title.is_empty() {
			draft.error = Some(t!("标题不能为空").to_owned());
			self.draft = Some(draft);
			return;
		}
		let tags = draft
			.tags
			.split(',')
			.map(str::trim)
			.filter(|tag| !tag.is_empty())
			.map(str::to_owned)
			.collect::<Vec<_>>();
		let due = draft.due.trim();
		let due = if due.is_empty() {
			None
		} else if chrono::NaiveDate::parse_from_str(due, "%Y-%m-%d").is_err() {
			draft.error = Some(t!("截止日期须为 YYYY-MM-DD").to_owned());
			self.draft = Some(draft);
			return;
		} else {
			Some(due.to_owned())
		};
		let body = draft.body.trim_end().to_owned();

		let outcome = match draft.id.as_deref() {
			Some(id) => board::read_card(&root, id).and_then(|mut card| {
				card.title = title.clone();
				card.column = draft.column;
				card.tags = tags.clone();
				card.assignee = draft.assignee;
				card.due = due.clone();
				card.body = body.clone();
				board::save_card(&root, &card).map(|()| card)
			}),
			None => board::create_card(
				&root,
				NewCard { title, column: draft.column, tags, assignee: draft.assignee, due, body },
			),
		};
		match outcome {
			Ok(card) => {
				self.selected = Some(card.id);
				self.reload(&root);
			},
			Err(error) => {
				draft.error = Some(error.to_string());
				self.draft = Some(draft);
			},
		}
	}

	/// Move a card between columns (a file write).
	pub fn shift(&mut self, id: &str, column: Column) {
		let Some(root) = self.root.clone() else {
			return;
		};
		if let Err(error) = board::move_card(&root, id, column) {
			if let Some(draft) = self.draft.as_mut() {
				draft.error = Some(error.to_string());
			}
			return;
		}
		self.selected = Some(id.to_owned());
		self.reload(&root);
	}

	/// Delete a card file.
	pub fn delete(&mut self, id: &str) {
		let Some(root) = self.root.clone() else {
			return;
		};
		if board::delete_card(&root, id).is_ok() {
			self.draft = None;
			self.selected = None;
			self.reload(&root);
		}
	}
}

/// Draw the page.
pub fn panel(ui: &mut Ui, shell: &mut Shell) {
	panel_head(ui, RightTab::Board.title(), |ui| {
		if icon_button(ui, Icon::Refresh, 20.0, false, t!("重新读取看板")).clicked() {
			shell.board.reload_now();
		}
		if icon_button(ui, Icon::Plus, 20.0, false, t!("新建卡片")).clicked() {
			shell.board.begin_new(Column::Todo);
		}
	});
	let root = shell
		.state
		.active_workspace()
		.map(|workspace| workspace.path.clone())
		.unwrap_or_default();
	if root.is_empty() {
		empty_note(ui, t!("没有打开的工作区"));
		return;
	}
	shell.board.refresh(Path::new(&root), Instant::now());
	if shell.board.draft().is_some() {
		draft_form(ui, shell);
		return;
	}
	let warnings = shell.board.warning_count();
	if warnings > 0 {
		ui.label(
			RichText::new(t!("{} 个文件不是卡片，已跳过", warnings))
				.size(9.5)
				.color(theme::WARN),
		);
	}
	columns(ui, shell);
}

/// One row of three columns.
fn columns(ui: &mut Ui, shell: &mut Shell) {
	let gap = 4.0;
	let usable = (ui.available_width() - 2.0 * theme::INSET_PANEL).max(40.0);
	let width = ((usable - 2.0 * gap) / 3.0).max(40.0);
	egui::ScrollArea::vertical()
		.id_salt("zetawork-board")
		.auto_shrink([false, false])
		.show(ui, |ui| {
			ui.horizontal_top(|ui| {
				// Widths are computed for exactly two `gap`s; the default
				// 8 px item spacing would push the third column out of the
				// 324 pt rail, so the gaps are drawn explicitly.
				ui.spacing_mut().item_spacing.x = 0.0;
				ui.add_space(theme::INSET_PANEL);
				for (index, column) in Column::ALL.into_iter().enumerate() {
					if index > 0 {
						ui.add_space(gap);
					}
					ui.allocate_ui_with_layout(
						vec2(width, ui.available_height()),
						Layout::top_down(Align::Min),
						|ui| {
							ui.set_width(width);
							column_ui(ui, shell, column);
						},
					);
				}
				ui.add_space(theme::INSET_PANEL);
			});
		});
}

fn column_ui(ui: &mut Ui, shell: &mut Shell, column: Column) {
	let ids: Vec<String> = shell
		.board
		.cards()
		.iter()
		.filter(|card| card.column == column)
		.map(|card| card.id.clone())
		.collect();
	ui.horizontal(|ui| {
		ui.label(
			RichText::new(format!("{} {}", column_label(column), ids.len()))
				.size(10.0)
				.color(theme::TEXT_3),
		);
		if ui
			.add(egui::Button::new(RichText::new("+").size(10.0)).frame(false))
			.on_hover_text(t!("在此列新建卡片"))
			.clicked()
		{
			shell.board.begin_new(column);
		}
	});
	ui.add_space(2.0);
	if ids.is_empty() {
		ui.label(RichText::new(t!("—")).size(10.0).color(theme::TEXT_3));
		return;
	}
	for id in ids {
		card_ui(ui, shell, &id, column);
		ui.add_space(4.0);
	}
}

fn card_ui(ui: &mut Ui, shell: &mut Shell, id: &str, column: Column) {
	let Some(card) = shell.board.cards().iter().find(|card| card.id == id) else {
		return;
	};
	let title = card.title.clone();
	let tags = card.tags.clone();
	let assignee = card.assignee;
	let due = card.due.clone();
	let selected = shell.board.selected() == Some(id);

	let fill = if selected {
		theme::PANEL_4
	} else {
		theme::PANEL_3
	};
	egui::Frame::new()
		.fill(fill)
		.stroke(egui::Stroke::new(
			1.0_f32,
			if selected {
				theme::ACCENT_DIM
			} else {
				theme::BORDER
			},
		))
		.corner_radius(CornerRadius::same(theme::R_CONTROL))
		.inner_margin(egui::Margin::same(5))
		.show(ui, |ui| {
			ui.set_width(ui.available_width());
			ui.spacing_mut().item_spacing.y = 2.0;
			let label = ui.add(
				egui::Label::new(RichText::new(title).size(10.5).color(theme::TEXT))
					.truncate()
					.sense(Sense::click()),
			);
			if label.clicked() {
				shell.board.begin_edit(id);
			}
			if !tags.is_empty() {
				let text = tags
					.iter()
					.map(|tag| format!("#{tag}"))
					.collect::<Vec<_>>()
					.join(" ");
				ui.label(RichText::new(text).size(9.0).color(theme::TAG));
			}
			let mut meta = format!("@{}", assignee.label());
			if let Some(due) = due {
				meta.push_str(&format!(" · {due}"));
			}
			ui.label(RichText::new(meta).size(9.0).color(theme::TEXT_3));
			ui.horizontal(|ui| {
				if let Some(previous) = column.previous() {
					if ui
						.add(egui::Button::new(RichText::new("←").size(10.0)).frame(false))
						.on_hover_text(t!("移到前一列"))
						.clicked()
					{
						shell.board.shift(id, previous);
					}
				}
				if let Some(next) = column.next() {
					if ui
						.add(egui::Button::new(RichText::new("→").size(10.0)).frame(false))
						.on_hover_text(t!("移到后一列"))
						.clicked()
					{
						shell.board.shift(id, next);
					}
				}
			});
		});
}

enum DraftAction {
	None,
	Save,
	Cancel,
	Delete(String),
}

fn draft_form(ui: &mut Ui, shell: &mut Shell) {
	let mut action = DraftAction::None;
	if let Some(draft) = shell.board.draft_mut() {
		let heading = if draft.id.is_some() {
			t!("编辑卡片")
		} else {
			t!("新建卡片")
		};
		ui.label(RichText::new(heading).size(11.0).color(theme::TEXT_2));
		ui.add_space(4.0);
		ui.label(RichText::new(t!("标题")).size(9.5).color(theme::TEXT_3));
		ui.add(
			egui::TextEdit::singleline(&mut draft.title)
				.desired_width(f32::INFINITY)
				.font(egui::FontId::new(11.0, egui::FontFamily::Proportional)),
		);
		ui.label(RichText::new(t!("列")).size(9.5).color(theme::TEXT_3));
		ui.horizontal(|ui| {
			for column in Column::ALL {
				ui.selectable_value(&mut draft.column, column, column_label(column));
			}
		});
		ui.label(RichText::new(t!("负责人")).size(9.5).color(theme::TEXT_3));
		ui.horizontal(|ui| {
			ui.selectable_value(&mut draft.assignee, Assignee::User, t!("用户"));
			ui.selectable_value(&mut draft.assignee, Assignee::Agent, t!("agent"));
		});
		ui.label(
			RichText::new(t!("标签（逗号分隔）"))
				.size(9.5)
				.color(theme::TEXT_3),
		);
		ui.add(
			egui::TextEdit::singleline(&mut draft.tags)
				.desired_width(f32::INFINITY)
				.font(egui::FontId::new(11.0, egui::FontFamily::Proportional)),
		);
		ui.label(
			RichText::new(t!("截止（YYYY-MM-DD）"))
				.size(9.5)
				.color(theme::TEXT_3),
		);
		ui.add(
			egui::TextEdit::singleline(&mut draft.due)
				.desired_width(f32::INFINITY)
				.font(egui::FontId::new(11.0, egui::FontFamily::Proportional)),
		);
		ui.label(
			RichText::new(t!("正文（交给 agent 的 brief）"))
				.size(9.5)
				.color(theme::TEXT_3),
		);
		ui.add(
			egui::TextEdit::multiline(&mut draft.body)
				.desired_rows(4)
				.desired_width(f32::INFINITY)
				.font(egui::FontId::new(11.0, egui::FontFamily::Proportional)),
		);
		if let Some(error) = draft.error.as_deref() {
			ui.label(RichText::new(error).size(9.5).color(theme::DEL));
		}
		ui.horizontal(|ui| {
			if ui.button(t!("保存")).clicked() {
				action = DraftAction::Save;
			}
			if ui.button(t!("取消")).clicked() {
				action = DraftAction::Cancel;
			}
			if let Some(id) = draft.id.clone() {
				let label = if draft.confirm_delete {
					t!("确认删除")
				} else {
					t!("删除")
				};
				if ui.button(label).clicked() {
					if draft.confirm_delete {
						action = DraftAction::Delete(id);
					} else {
						draft.confirm_delete = true;
					}
				}
			}
		});
	}
	match action {
		DraftAction::None => {},
		DraftAction::Save => shell.board.save(),
		DraftAction::Cancel => shell.board.cancel(),
		DraftAction::Delete(id) => shell.board.delete(&id),
	}
}

fn column_label(column: Column) -> &'static str {
	match column {
		Column::Todo => t!("待办"),
		Column::Doing => t!("进行中"),
		Column::Done => t!("完成"),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_cache_reads_and_writes_the_same_card_file() {
		let dir = tempfile::tempdir().expect("temp dir");
		let card = board::create_card(dir.path(), NewCard::titled("Fix it")).expect("card");
		let mut cache = BoardCache::default();
		cache.refresh(dir.path(), Instant::now());
		assert_eq!(cache.cards().len(), 1);
		assert_eq!(cache.cards()[0].title, "Fix it");

		cache.begin_edit(&card.id);
		cache.draft_mut().expect("draft").title = "Fixed".to_owned();
		cache.save();
		assert_eq!(
			board::read_card(dir.path(), &card.id).expect("card").title,
			"Fixed",
			"the edit went to the card's own file"
		);

		cache.shift(&card.id, Column::Done);
		assert_eq!(
			board::read_card(dir.path(), &card.id).expect("card").column,
			Column::Done,
			"a move is a file write"
		);
	}

	#[test]
	fn a_hand_edit_shows_up_on_the_next_refresh() {
		let dir = tempfile::tempdir().expect("temp dir");
		let card = board::create_card(dir.path(), NewCard::titled("First")).expect("card");
		let mut cache = BoardCache::default();
		cache.refresh(dir.path(), Instant::now());

		let path = dir
			.path()
			.join(".zeta")
			.join("board")
			.join(format!("{}.md", card.id));
		std::fs::write(
			&path,
			"---\ntitle: Edited by hand\ncolumn: doing\nassignee: agent\n---\n\nChanged on disk.\n",
		)
		.expect("hand edit");
		cache.reload_now();
		assert_eq!(cache.cards()[0].title, "Edited by hand");
		assert_eq!(cache.cards()[0].column, Column::Doing);
	}

	#[test]
	fn a_new_card_is_created_with_the_form_s_values() {
		let dir = tempfile::tempdir().expect("temp dir");
		let mut cache = BoardCache::default();
		cache.refresh(dir.path(), Instant::now());
		cache.begin_new(Column::Doing);
		{
			let draft = cache.draft_mut().expect("draft");
			draft.title = "New thing".to_owned();
			draft.tags = "rust, ui".to_owned();
			draft.due = "2026-12-24".to_owned();
			draft.body = "Do it.".to_owned();
		}
		cache.save();
		let card = &cache.cards()[0];
		assert_eq!(card.title, "New thing");
		assert_eq!(card.column, Column::Doing);
		assert_eq!(card.tags, vec!["rust".to_owned(), "ui".to_owned()]);
		assert_eq!(card.due.as_deref(), Some("2026-12-24"));
		assert_eq!(card.body, "Do it.");
	}
}
