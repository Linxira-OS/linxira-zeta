// SPDX-License-Identifier: AGPL-3.0-only
//! ＋新建大标签页's composer: a name, an optional branch (which creates a
//! `git worktree`), and the repository's `.zeta/setup` consent.
//!
//! Every surface that used to create a workspace in one click — the project
//! row's ＋, the pane's ＋, ⌘N — opens this instead, so a worktree and a script
//! are choices rather than surprises. The form lives in
//! [`crate::state::AppState::new_workspace`]; this module only draws it and
//! asks the shell to submit.

use egui::{Align, Color32, CornerRadius, FontId, Layout, Rect, Sense, Stroke, Ui, pos2, vec2};

use crate::{Shell, t, theme};

/// Draw the composer when it is open.
pub fn modal(ctx: &egui::Context, shell: &mut Shell) {
	if shell.state.new_workspace.is_none() {
		return;
	}
	let screen = ctx.content_rect();
	let mut close = false;
	let mut submit = false;
	let project_path = shell
		.state
		.new_workspace
		.as_ref()
		.and_then(|form| shell.state.project(&form.project))
		.map(|project| std::path::PathBuf::from(&project.path));
	let has_script = project_path
		.as_deref()
		.is_some_and(crate::setup::has_script);
	let trusted = project_path
		.as_deref()
		.is_some_and(|path| crate::setup::Trust::load().is_trusted(path));

	egui::Area::new(egui::Id::new("zetawork-new-workspace"))
		.order(egui::Order::Foreground)
		.fixed_pos(screen.min)
		.show(ctx, |ui| {
			let (backdrop, backdrop_response) = ui.allocate_exact_size(screen.size(), Sense::click());
			ui.painter().rect_filled(
				backdrop,
				CornerRadius::ZERO,
				Color32::from_rgba_unmultiplied(3, 5, 8, 158),
			);
			if backdrop_response.clicked() {
				close = true;
			}
			let width = 460.0_f32.min(screen.width() - 48.0);
			let height = if has_script { 286.0 } else { 244.0 };
			let dialog = Rect::from_center_size(screen.center(), vec2(width, height));
			let mut dialog_ui = ui.new_child(egui::UiBuilder::new().max_rect(dialog));
			egui::Frame::new()
				.fill(theme::PANEL)
				.stroke(Stroke::new(1.0_f32, theme::BORDER_2))
				.corner_radius(CornerRadius::same(theme::R_MODAL))
				.show(&mut dialog_ui, |ui| {
					let rect = ui.max_rect();
					ui.painter()
						.rect_filled(rect, CornerRadius::same(theme::R_MODAL), theme::PANEL);
					let head = Rect::from_min_size(rect.min, vec2(rect.width(), 46.0));
					ui.painter().text(
						pos2(head.min.x + 16.0, head.center().y),
						egui::Align2::LEFT_CENTER,
						t!("新建工作区"),
						FontId::new(14.0, egui::FontFamily::Proportional),
						theme::TEXT,
					);
					ui.painter().line_segment(
						[pos2(head.min.x, head.max.y - 0.5), pos2(head.max.x, head.max.y - 0.5)],
						Stroke::new(1.0_f32, theme::BORDER),
					);

					let body = rect.shrink(16.0);
					let field_rect = Rect::from_min_max(
						pos2(body.min.x, head.max.y + 10.0),
						pos2(body.max.x, body.max.y - 34.0),
					);
					let mut body_ui = ui.new_child(egui::UiBuilder::new().max_rect(field_rect));
					body_ui.spacing_mut().item_spacing.y = 8.0;
					let form = shell
						.state
						.new_workspace
						.as_mut()
						.expect("the composer is open");

					caption(&mut body_ui, t!("名称"));
					let name = body_ui.add_sized(
						vec2(body_ui.available_width(), 26.0),
						egui::TextEdit::singleline(&mut form.name),
					);
					caption(&mut body_ui, t!("分支：留空用项目目录，填名字建 git worktree"));
					let branch = body_ui.add_sized(
						vec2(body_ui.available_width(), 26.0),
						egui::TextEdit::singleline(&mut form.branch)
							.hint_text(t!("例如 feature/agent-rows")),
					);
					if has_script {
						let label = if trusted {
							t!("运行 .zeta/setup")
						} else {
							t!("信任并运行 .zeta/setup")
						};
						body_ui.checkbox(&mut form.run_setup, label);
					}
					if let Some(error) = &form.error {
						body_ui.colored_label(theme::WARN, error);
					}

					// 创建 / 取消 sit in the dialog's bottom-right corner.
					let buttons = Rect::from_min_max(
						pos2(rect.max.x - 200.0, rect.max.y - 42.0),
						pos2(rect.max.x - 16.0, rect.max.y - 12.0),
					);
					let mut row = ui.new_child(
						egui::UiBuilder::new()
							.max_rect(buttons)
							.layout(Layout::right_to_left(Align::Center)),
					);
					if primary(&mut row, t!("创建")).clicked() {
						submit = true;
					}
					if secondary(&mut row, t!("取消")).clicked() {
						close = true;
					}

					let enter =
						name.lost_focus() && body_ui.input(|input| input.key_pressed(egui::Key::Enter));
					let branch_enter =
						branch.lost_focus() && body_ui.input(|input| input.key_pressed(egui::Key::Enter));
					if enter || branch_enter {
						submit = true;
					}
				});
		});

	if ctx.input(|input| input.key_pressed(egui::Key::Escape)) {
		close = true;
	}
	if submit {
		shell.submit_new_workspace();
	} else if close {
		shell.state.close_new_workspace();
	}
}

fn caption(ui: &mut Ui, text: &str) {
	ui.label(egui::RichText::new(text).size(11.5).color(theme::TEXT_3));
}

fn primary(ui: &mut Ui, text: &str) -> egui::Response {
	ui.add(
		egui::Button::new(egui::RichText::new(text).size(12.0))
			.fill(theme::ACCENT_DIM)
			.min_size(vec2(76.0, 28.0)),
	)
}

fn secondary(ui: &mut Ui, text: &str) -> egui::Response {
	ui.add(
		egui::Button::new(egui::RichText::new(text).size(12.0))
			.frame(false)
			.min_size(vec2(60.0, 28.0)),
	)
}
