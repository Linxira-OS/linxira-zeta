//! The 设置 modal: native egui, six sections, persisted immediately.
//!
//! Opened from the left column's foot (or `Ctrl+,`), it dims the window and
//! shows the spec's dialog: a category nav on the left, one row per setting on
//! the right (label, hint, control). Every control that *can* take effect here
//! does — theme, density, reduced motion, the editor's font/size/wrap/gutter,
//! the terminal's size and cursor shape — and the two that need a PTY host
//! (默认 Shell, 启动时自动连接) are drawn disabled with the reason, rather than
//! pretending.
//!
//! The 关于 section carries the one honest row about scope: zetacode's own
//! settings are per-workspace and are edited by zetacode, not here.

use egui::{Align, Color32, CornerRadius, FontId, Layout, Rect, Sense, Stroke, Ui, pos2, vec2};

use crate::Shell;
use crate::icons::{Icon, paint};
use crate::settings::{
	CursorStyle, Density, Language, MonoFont, Section, Settings, ShellChoice, Theme,
};
use crate::theme;

/// Which nav icon a section gets.
fn section_icon(section: Section) -> Icon {
	match section {
		Section::Appearance => Icon::Sun,
		Section::Editor => Icon::Code,
		Section::Terminal => Icon::Term,
		Section::Keys => Icon::Keyboard,
		Section::Manage => Icon::FolderPlus,
		Section::About => Icon::Info,
	}
}

/// Draw the modal, if it is open. Applied changes are persisted through
/// [`crate::Shell::apply_settings`].
pub fn modal(ctx: &egui::Context, shell: &mut Shell) {
	if !shell.state.modal_open() {
		return;
	}
	let screen = ctx.content_rect();
	let mut close = false;
	egui::Area::new(egui::Id::new("zetawork-settings-modal"))
		.order(egui::Order::Foreground)
		.fixed_pos(screen.min)
		.show(ctx, |ui| {
			// The dim backdrop, and a click on it closes the dialog.
			let (backdrop, backdrop_response) = ui.allocate_exact_size(screen.size(), Sense::click());
			ui.painter().rect_filled(
				backdrop,
				CornerRadius::ZERO,
				Color32::from_rgba_unmultiplied(3, 5, 8, 158),
			);
			if backdrop_response.clicked() {
				close = true;
			}
			let width = 880.0_f32.min(screen.width() - 48.0);
			let height = 660.0_f32.min(screen.height() - 48.0);
			let dialog = Rect::from_center_size(screen.center(), vec2(width, height));
			let mut dialog_ui = ui.new_child(egui::UiBuilder::new().max_rect(dialog));
			egui::Frame::new()
				.fill(theme::PANEL)
				.stroke(Stroke::new(1.0, theme::BORDER_2))
				.corner_radius(CornerRadius::same(theme::R_MODAL))
				.outer_margin(egui::Margin::ZERO)
				.show(&mut dialog_ui, |ui| {
					let rect = ui.max_rect();
					ui.painter()
						.rect_filled(rect, CornerRadius::same(theme::R_MODAL), theme::PANEL);
					let head = Rect::from_min_size(rect.min, vec2(rect.width(), 52.0));
					ui.painter().text(
						pos2(head.min.x + 14.0, head.center().y),
						egui::Align2::LEFT_CENTER,
						"设置",
						FontId::new(14.0, egui::FontFamily::Proportional),
						theme::TEXT,
					);
					ui.painter().line_segment(
						[pos2(head.min.x, head.max.y - 0.5), pos2(head.max.x, head.max.y - 0.5)],
						Stroke::new(1.0, theme::BORDER),
					);
					let mut close_ui = ui.new_child(egui::UiBuilder::new().max_rect(
						Rect::from_min_size(pos2(head.max.x - 42.0, head.min.y + 12.0), vec2(28.0, 28.0)),
					));
					if crate::icons::icon_button(&mut close_ui, Icon::X, 28.0, false, "关闭").clicked()
					{
						close = true;
					}
					let body = Rect::from_min_max(pos2(rect.min.x, head.max.y), rect.max);
					let nav = Rect::from_min_size(body.min, vec2(190.0, body.height()));
					ui.painter()
						.rect_filled(nav, CornerRadius::ZERO, theme::PANEL_2);
					ui.painter().line_segment(
						[pos2(nav.max.x - 0.5, nav.min.y), pos2(nav.max.x - 0.5, nav.max.y)],
						Stroke::new(1.0, theme::BORDER),
					);
					let mut nav_ui = ui.new_child(
						egui::UiBuilder::new()
							.max_rect(nav.shrink2(vec2(8.0, 8.0)))
							.layout(Layout::top_down(Align::Min)),
					);
					for section in Section::ALL {
						let active = shell.state.settings_section == section;
						let (row, response) = nav_ui
							.allocate_exact_size(vec2(nav_ui.available_width(), 32.0), Sense::click());
						if active {
							nav_ui.painter().rect_filled(
								row,
								CornerRadius::same(theme::R_CONTROL),
								theme::PANEL_4,
							);
						} else if response.hovered() {
							nav_ui.painter().rect_filled(
								row,
								CornerRadius::same(theme::R_CONTROL),
								theme::PANEL_3,
							);
						}
						paint(
							nav_ui.painter(),
							section_icon(section),
							Rect::from_center_size(
								pos2(row.min.x + 18.0, row.center().y),
								vec2(15.0, 15.0),
							),
							if active {
								theme::ACCENT_2
							} else {
								theme::TEXT_3
							},
							1.5,
						);
						nav_ui.painter().text(
							pos2(row.min.x + 34.0, row.center().y),
							egui::Align2::LEFT_CENTER,
							section.label(),
							FontId::new(12.5, egui::FontFamily::Proportional),
							if active { theme::TEXT } else { theme::TEXT_2 },
						);
						if response.clicked() {
							shell.state.settings_section = section;
						}
					}
					let main = Rect::from_min_max(pos2(nav.max.x, body.min.y), body.max);
					let mut main_ui = ui.new_child(egui::UiBuilder::new().max_rect(main));
					egui::ScrollArea::vertical()
						.auto_shrink([false, false])
						.show(&mut main_ui, |ui| {
							ui.spacing_mut().item_spacing.y = 0.0;
							section_body(ui, shell);
						});
				});
		});
	if close {
		shell.state.close_modal();
	}
}

/// One section: its rows.
fn section_body(ui: &mut Ui, shell: &mut Shell) {
	let section = shell.state.settings_section;
	ui.add_space(20.0);
	match section {
		Section::Appearance => {
			head(ui, "外观");
			row(
				ui,
				"主题",
				"界面整体配色方案",
				|ui, shell| {
					let before = shell.settings.theme;
					let mut value = before;
					select(ui, "theme", &mut value, &Theme::ALL, |theme| theme.label());
					if value != before {
						shell.settings.theme = value;
					}
				},
				shell,
			);
			row(
				ui,
				"信息密度",
				"控制面板与列表的行距",
				|ui, shell| {
					let before = shell.settings.density;
					let mut value = before;
					select(ui, "density", &mut value, &Density::ALL, |density| density.label());
					if value != before {
						shell.settings.density = value;
					}
				},
				shell,
			);
			language_row(ui, shell);
			row(
				ui,
				"减少动态效果",
				"关闭面板与列表的过渡动画",
				|ui, shell| {
					let mut value = shell.settings.reduce_motion;
					if switch(ui, &mut value) {
						shell.settings.reduce_motion = value;
					}
				},
				shell,
			);
		},
		Section::Editor => {
			head(ui, "编辑器");
			row(
				ui,
				"等宽字体",
				"编辑器与终端使用的字体",
				|ui, shell| {
					let before = shell.settings.mono_font;
					let mut value = before;
					select(ui, "mono-font", &mut value, &MonoFont::ALL, |font| font.label());
					if value != before {
						shell.settings.mono_font = value;
					}
				},
				shell,
			);
			row(
				ui,
				"字号",
				"编辑器文本大小",
				|ui, shell| {
					let before = shell.settings.editor_size;
					let mut value = before;
					select(ui, "editor-size", &mut value, &Settings::EDITOR_SIZES, |size| {
						format!("{size}px")
					});
					if value != before {
						shell.settings.editor_size = value;
					}
				},
				shell,
			);
			row(
				ui,
				"自动换行",
				"长行在视口内折行显示",
				|ui, shell| {
					let mut value = shell.settings.editor_wrap;
					if switch(ui, &mut value) {
						shell.settings.editor_wrap = value;
					}
				},
				shell,
			);
			row(
				ui,
				"显示行号",
				"在左侧显示行号栏",
				|ui, shell| {
					let mut value = shell.settings.editor_line_numbers;
					if switch(ui, &mut value) {
						shell.settings.editor_line_numbers = value;
					}
				},
				shell,
			);
		},
		Section::Terminal => {
			head(ui, "终端");
			hint(
				ui,
				"PTY 宿主尚未接入：默认 Shell 与自动连接保存在设置文件里，等终端宿主接入后生效。",
			);
			row(
				ui,
				"默认 Shell",
				"新建终端时启动的程序",
				|ui, shell| {
					let mut value = shell.settings.shell;
					disabled_select(ui, "shell", &value, &ShellChoice::ALL, |shell| shell.label());
					let _ = &mut value;
				},
				shell,
			);
			row(
				ui,
				"终端字号",
				"终端输出文本大小",
				|ui, shell| {
					let before = shell.settings.terminal_size;
					let mut value = before;
					select(ui, "terminal-size", &mut value, &Settings::TERMINAL_SIZES, |size| {
						format!("{size}px")
					});
					if value != before {
						shell.settings.terminal_size = value;
					}
				},
				shell,
			);
			row(
				ui,
				"光标样式",
				"终端光标的形状",
				|ui, shell| {
					let before = shell.settings.cursor;
					let mut value = before;
					select(ui, "cursor", &mut value, &CursorStyle::ALL, |cursor| cursor.label());
					if value != before {
						shell.settings.cursor = value;
					}
				},
				shell,
			);
			row(
				ui,
				"启动时自动连接",
				"打开工作区时连接本地 agent",
				|ui, shell| {
					let mut value = shell.settings.terminal_autoconnect;
					disabled_switch(ui, value);
					let _ = &mut value;
				},
				shell,
			);
		},
		Section::Keys => {
			head(ui, "快捷键");
			hint(ui, "本机把规格里的 ⌘ 映射为 Ctrl；TUI 视图用 Tab 切换面板、q 退出。");
			for (label, hint_text, keys) in crate::BINDINGS {
				row(
					ui,
					label,
					hint_text,
					|ui, _shell| {
						kbd(ui, keys);
					},
					shell,
				);
			}
		},
		Section::Manage => {
			head(ui, "管理");
			for (title, hint_text, icon, action) in crate::MANAGE_CARDS {
				manage_card(ui, shell, title, hint_text, icon, action);
			}
		},
		Section::About => {
			head(ui, "关于");
			plain_row(ui, "zetawork", "纯 Rust 桌面工作台 · 界面规格 v2（GUI / TUI）", crate::VERSION);
			plain_row(ui, "界面规格", "本实现按 temp/zetawork-ui-mock 的 v2 规格绘制", "GUI / TUI");
			plain_row(ui, shell.fonts.cjk_line().as_str(), "界面与终端的中文字形来源", "只读");
			plain_row(ui, shell.fonts.mono_line().as_str(), "编辑器等宽字体", "只读");
			zetacode_row(ui);
		},
	}
	ui.add_space(24.0);
}

/// The honest row the brief asks for: zetacode's settings are per-workspace and
/// are not edited here.
fn zetacode_row(ui: &mut Ui) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 74.0), Sense::hover());
	let painter = ui.painter();
	painter.rect_filled(rect, CornerRadius::same(theme::R_PANEL), theme::PANEL_2);
	painter.rect_stroke(
		rect,
		CornerRadius::same(theme::R_PANEL),
		Stroke::new(1.0, theme::BORDER),
		egui::StrokeKind::Inside,
	);
	painter.text(
		pos2(rect.min.x + 12.0, rect.min.y + 12.0),
		egui::Align2::LEFT_TOP,
		"zetacode 的设置按工作区生效，不在此处编辑",
		FontId::new(13.0, egui::FontFamily::Proportional),
		theme::TEXT,
	);
	painter.text(
		pos2(rect.min.x + 12.0, rect.min.y + 32.0),
		egui::Align2::LEFT_TOP,
		"在那个工作区里运行 zetacode，用 /settings 面板，或 zetacode config（项目层：<工作区>/.zeta/config.yml）",
		FontId::new(11.5, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
}

/// The 界面语言 row: the spec offers three, only one is wired, and the row says
/// so instead of offering a control that changes nothing.
fn language_row(ui: &mut Ui, shell: &mut Shell) {
	row(
		ui,
		"界面语言",
		"菜单与提示的显示语言",
		|ui, shell| {
			if !shell.settings.language.wired() {
				shell.settings.language = Language::SimplifiedChinese;
			}
			disabled_select(
				ui,
				"language",
				&Language::SimplifiedChinese,
				&Language::ALL,
				|language| language.label(),
			);
			hint(ui, "其他语言尚未接入：界面文案目前只有简体中文。");
		},
		shell,
	);
}

fn head(ui: &mut Ui, title: &str) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::hover());
	ui.painter().text(
		pos2(rect.min.x, rect.center().y),
		egui::Align2::LEFT_CENTER,
		title,
		FontId::new(12.0, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
}

/// One `.set-row`: label + hint on the left, the control on the right.
fn row(
	ui: &mut Ui,
	label: &str,
	hint_text: &str,
	control: impl FnOnce(&mut Ui, &mut Shell),
	shell: &mut Shell,
) {
	let height = 56.0;
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), height), Sense::hover());
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.max.y - 0.5), pos2(rect.max.x, rect.max.y - 0.5)],
		Stroke::new(1.0, theme::BORDER),
	);
	ui.painter().text(
		pos2(rect.min.x, rect.min.y + 14.0),
		egui::Align2::LEFT_TOP,
		label,
		FontId::new(13.0, egui::FontFamily::Proportional),
		theme::TEXT,
	);
	ui.painter().text(
		pos2(rect.min.x, rect.min.y + 32.0),
		egui::Align2::LEFT_TOP,
		hint_text,
		FontId::new(11.5, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	let control_rect =
		Rect::from_min_size(pos2(rect.max.x - 240.0, rect.min.y + 12.0), vec2(240.0, 32.0));
	let mut child = ui.new_child(
		egui::UiBuilder::new()
			.max_rect(control_rect)
			.layout(Layout::right_to_left(Align::Center)),
	);
	control(&mut child, shell);
}

/// A row with static text on the right (关于 and 快捷键).
fn plain_row(ui: &mut Ui, label: &str, hint_text: &str, value: &str) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 52.0), Sense::hover());
	ui.painter().line_segment(
		[pos2(rect.min.x, rect.max.y - 0.5), pos2(rect.max.x, rect.max.y - 0.5)],
		Stroke::new(1.0, theme::BORDER),
	);
	ui.painter().text(
		pos2(rect.min.x, rect.min.y + 12.0),
		egui::Align2::LEFT_TOP,
		label,
		FontId::new(13.0, egui::FontFamily::Proportional),
		theme::TEXT,
	);
	ui.painter().text(
		pos2(rect.min.x, rect.min.y + 30.0),
		egui::Align2::LEFT_TOP,
		hint_text,
		FontId::new(11.5, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	ui.painter().text(
		pos2(rect.max.x, rect.center().y),
		egui::Align2::RIGHT_CENTER,
		value,
		FontId::new(11.5, egui::FontFamily::Monospace),
		theme::TEXT_2,
	);
}

fn hint(ui: &mut Ui, text: &str) {
	let (rect, _) = ui.allocate_exact_size(vec2(ui.available_width(), 26.0), Sense::hover());
	ui.painter().text(
		pos2(rect.min.x, rect.center().y),
		egui::Align2::LEFT_CENTER,
		text,
		FontId::new(11.5, egui::FontFamily::Proportional),
		theme::WARN,
	);
}

/// A `.sel`: an egui combo box styled to the spec's control height.
fn select<T: PartialEq + Copy, S: Into<String>>(
	ui: &mut Ui,
	id: &str,
	value: &mut T,
	options: &[T],
	label: impl Fn(T) -> S,
) {
	let selected: String = label(*value).into();
	egui::ComboBox::from_id_salt(id)
		.selected_text(selected)
		.width(180.0)
		.show_ui(ui, |ui| {
			for option in options {
				let text: String = label(*option).into();
				ui.selectable_value(value, *option, text);
			}
		});
}

/// A combo box that cannot be changed, with its current value shown.
fn disabled_select<T: Copy + PartialEq, S: Into<String>>(
	ui: &mut Ui,
	id: &str,
	value: &T,
	options: &[T],
	label: impl Fn(T) -> S,
) {
	ui.add_enabled_ui(false, |ui| {
		let mut value: T = *value;
		let selected: String = label(value).into();
		egui::ComboBox::from_id_salt(id)
			.selected_text(selected)
			.width(180.0)
			.show_ui(ui, |ui| {
				for option in options {
					let text: String = label(*option).into();
					ui.selectable_value(&mut value, *option, text);
				}
			});
	});
}

/// A `.switch`: 38×22, the knob sliding 16pt.
fn switch(ui: &mut Ui, value: &mut bool) -> bool {
	let (rect, response) = ui.allocate_exact_size(vec2(38.0, 22.0), Sense::click());
	if response.clicked() {
		*value = !*value;
	}
	let (track, knob) = if *value {
		(theme::ACCENT_DIM, theme::ACCENT_2)
	} else {
		(theme::PANEL_4, theme::TEXT_3)
	};
	ui.painter()
		.rect_filled(rect, CornerRadius::same(11), track);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(11),
		Stroke::new(1.0, theme::BORDER_2),
		egui::StrokeKind::Inside,
	);
	let knob_x = if *value {
		rect.max.x - 13.0
	} else {
		rect.min.x + 13.0
	};
	ui.painter()
		.circle_filled(pos2(knob_x, rect.center().y), 8.0, knob);
	response.clicked()
}

fn disabled_switch(ui: &mut Ui, value: bool) {
	let (rect, _) = ui.allocate_exact_size(vec2(38.0, 22.0), Sense::hover());
	let (track, knob) = if value {
		(theme::ACCENT_DIM.gamma_multiply(0.5), theme::ACCENT_2.gamma_multiply(0.5))
	} else {
		(theme::PANEL_4, theme::TEXT_3.gamma_multiply(0.5))
	};
	ui.painter()
		.rect_filled(rect, CornerRadius::same(11), track);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(11),
		Stroke::new(1.0, theme::BORDER_2),
		egui::StrokeKind::Inside,
	);
	let knob_x = if value {
		rect.max.x - 13.0
	} else {
		rect.min.x + 13.0
	};
	ui.painter()
		.circle_filled(pos2(knob_x, rect.center().y), 8.0, knob);
}

fn kbd(ui: &mut Ui, keys: &str) {
	let font = FontId::new(11.0, egui::FontFamily::Monospace);
	let galley = ui
		.painter()
		.layout_no_wrap(keys.to_owned(), font.clone(), theme::TEXT_2);
	let rect = Rect::from_center_size(
		pos2(ui.max_rect().max.x - galley.size().x / 2.0 - 6.0, ui.max_rect().center().y),
		vec2(galley.size().x + 12.0, 20.0),
	);
	ui.painter()
		.rect_filled(rect, CornerRadius::same(5), theme::PANEL_3);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(5),
		Stroke::new(1.0, theme::BORDER),
		egui::StrokeKind::Inside,
	);
	ui.painter()
		.text(rect.center(), egui::Align2::CENTER_CENTER, keys, font.clone(), theme::TEXT_2);
}

/// A `.manage-card`: an icon, a title, a hint, and a chevron.
fn manage_card(
	ui: &mut Ui,
	shell: &mut Shell,
	title: &str,
	hint_text: &str,
	icon: Icon,
	action: &str,
) {
	let (rect, response) = ui.allocate_exact_size(vec2(ui.available_width(), 64.0), Sense::click());
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_PANEL), theme::PANEL_2);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(theme::R_PANEL),
		Stroke::new(
			1.0,
			if response.hovered() {
				theme::BORDER_2
			} else {
				theme::BORDER
			},
		),
		egui::StrokeKind::Inside,
	);
	paint(
		ui.painter(),
		icon,
		Rect::from_center_size(pos2(rect.min.x + 24.0, rect.center().y), vec2(18.0, 18.0)),
		theme::ACCENT_2,
		1.6,
	);
	ui.painter().text(
		pos2(rect.min.x + 46.0, rect.center().y - 9.0),
		egui::Align2::LEFT_CENTER,
		title,
		FontId::new(13.0, egui::FontFamily::Proportional),
		theme::TEXT,
	);
	ui.painter().text(
		pos2(rect.min.x + 46.0, rect.center().y + 9.0),
		egui::Align2::LEFT_CENTER,
		hint_text,
		FontId::new(11.5, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	paint(
		ui.painter(),
		Icon::ChevronRight,
		Rect::from_center_size(pos2(rect.max.x - 18.0, rect.center().y), vec2(14.0, 14.0)),
		theme::TEXT_3,
		1.5,
	);
	ui.add_space(8.0);
	if response.clicked() {
		shell.state.show(crate::state::Notice(action.to_owned()));
	}
}
