// SPDX-License-Identifier: AGPL-3.0-only
//! The 设置 modal: native egui, eight sections, persisted immediately.
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

use crate::ManageTarget;
use crate::Shell;
use crate::icons::{Icon, paint};
use crate::settings::{
	CloseAction, CursorStyle, Density, Language, MonoFont, NotifyPolicy, Section, Settings,
	ShellChoice, Theme,
};
use crate::theme;
use crate::zetacode;

/// Which nav icon a section gets.
fn section_icon(section: Section) -> Icon {
	match section {
		Section::General => Icon::Info,
		Section::Appearance => Icon::Sun,
		Section::Editor => Icon::Code,
		Section::Terminal => Icon::Term,
		Section::Keys => Icon::Keyboard,
		Section::Projects => Icon::Folder,
		Section::Manage => Icon::FolderPlus,
		Section::About => Icon::Info,
	}
}

/// Draw the modal, if it is open. Applied changes are persisted through
/// [`crate::Shell::apply_settings`].
pub fn modal(ctx: &egui::Context, shell: &mut Shell) {
	// `modal_open` also covers the 用量 container and the `+` picker; this dialog
	// is only drawn for its own flag, or it would appear under them.
	if !shell.state.settings_open() {
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
				.stroke(Stroke::new(1.0_f32, theme::BORDER_2))
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
						Stroke::new(1.0_f32, theme::BORDER),
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
						Stroke::new(1.0_f32, theme::BORDER),
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
						.id_salt("zetawork-settings-main")
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
		Section::General => {
			head(ui, "常规");
			row(
				ui,
				"关闭窗口时",
				"标题栏关闭键的行为；最小化到后台时会话与后台任务继续运行",
				|ui, shell| {
					let before = shell.settings.close_action;
					let mut value = before;
					select(ui, "close-action", &mut value, &CloseAction::ALL, |action| action.label());
					if value != before {
						shell.settings.close_action = value;
					}
				},
				shell,
			);
			row(
				ui,
				"开机自启",
				"登录时启动 zetawork（需要安装自启项，本构建只记录这个选择）",
				|ui, shell| {
					let mut value = shell.settings.auto_start;
					if switch(ui, &mut value) {
						shell.settings.auto_start = value;
					}
				},
				shell,
			);
			row(
				ui,
				"通知",
				"后台任务空闲、需要输入或失败时的提示；仅后台 = 只在窗口不在前台时提示",
				|ui, shell| {
					let before = shell.settings.notify;
					let mut value = before;
					select(ui, "notify", &mut value, &NotifyPolicy::ALL, |policy| policy.label());
					if value != before {
						shell.settings.notify = value;
					}
				},
				shell,
			);
			// 后台驻留的实况: the single-instance mechanism, the tray, and the
			// triggers with no signal source yet. None of this is a control —
			// it is what the process is actually doing, so a degraded run is
			// visible instead of silent.
			let residency = if shell.lifecycle.background {
				"正在后台运行"
			} else {
				"窗口在前台"
			};
			// Two separate facts: whether an icon exists, and how the window
			// comes back. The tray can be missing with the feature compiled in
			// (no StatusNotifier host), so ask the tray, not the build.
			let wake = if shell.tray.available() {
				"托盘图标 + 第二次运行"
			} else if crate::tray::compiled_in() {
				"第二次运行 zetawork（托盘图标没建起来，见下面的驻留提示）"
			} else {
				"第二次运行 zetawork（本构建没有编译托盘）"
			};
			plain_row(ui, "驻留状态", residency, wake);
			for (_, why) in crate::notify::MISSING_SIGNALS {
				plain_row(ui, "通知缺信号", why, "未接入");
			}
			// The IM fallback's own state: the gateway route is real
			// (`POST /api/channels/send`), the destination is what is missing.
			match &shell.im_target {
				Some(target) => plain_row(
					ui,
					"IM 回落",
					&format!("{}/api/channels/send · {}", target.origin, target.channel_id),
					"已接线",
				),
				None => plain_row(ui, "IM 回落", crate::notify::MISSING_TARGET, "未接线"),
			}
			for note in shell.lifecycle.notes.iter().chain(shell.tray.note.iter()) {
				plain_row(ui, "驻留提示", note, "降级");
			}
		},
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
			zetacode_options(ui, shell);
		},
		Section::Terminal => {
			head(ui, "终端");
			hint(ui, "PTY 宿主尚未接入：默认 Shell 会记在新建的终端页上，等终端宿主接入后生效。");
			row(
				ui,
				"默认 Shell",
				"新建终端时启动的程序（本机探测）",
				|ui, shell| {
					let detected = crate::shells::detect();
					let before = shell.settings.shell;
					let mut value = before;
					let options = shell_choices(&detected);
					select(ui, "shell", &mut value, &options, |choice| choice.label());
					if value != before {
						shell.settings.shell = value;
					}
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
		Section::Projects => {
			head(ui, "项目注册表 · ~/.zeta/projects.json");
			hint(ui, "GUI 与 TUI 读同一份注册表。移除只删除注册，不删除目录，也不删除会话历史。");
			if shell.state.registry.is_empty() {
				hint(ui, "尚未注册项目。左侧 项目 一节的 ＋ 可以选择一个目录。");
			} else {
				let rows: Vec<(String, String, String, usize)> = shell
					.state
					.registry
					.list()
					.iter()
					.map(|row| {
						let workspaces = shell
							.state
							.project(&row.id)
							.map(|project| project.workspaces.len())
							.unwrap_or(0);
						(row.id.clone(), row.name.clone(), row.path.display().to_string(), workspaces)
					})
					.collect();
				for (id, name, path, workspaces) in rows {
					project_registry_row(ui, shell, &id, &name, &path, workspaces);
				}
			}
		},
		Section::Manage => {
			head(ui, "管理");
			providers_section(ui, shell);
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
			scope_rows(ui);
		},
	}
	ui.add_space(24.0);
}

/// The 关于 section's scope rows: which of the three targets this modal can
/// really change, and where each one lives on disk.
fn scope_rows(ui: &mut Ui) {
	plain_row(
		ui,
		"zetawork 自己",
		"外观 / 编辑器 / 终端 / 快捷键 四节写 ~/.zeta/zetawork.toml",
		"读写",
	);
	plain_row(
		ui,
		"zetacode 的选项",
		"编辑器 一节里的 5 项，经 zetacode config set 写 ~/.zeta/agent/config.yml",
		"读写",
	);
	plain_row(
		ui,
		"桌面应用的服务商配置",
		"管理 一节里的 providers，写 ~/.zeta/agent/models.yml",
		"读写",
	);
	plain_row(
		ui,
		"用量",
		"左栏底部的 用量 打开 stats 页面容器（地址来自 ~/.zeta/serve.json）",
		"容器",
	);
}

/// How one zetacode row is controlled.
enum ZetacodeControl {
	/// A `true`/`false` option → the spec's switch.
	Boolean,
	/// A closed set of values → a select.
	Choices(&'static [&'static str]),
}

/// The control a zetacode key takes, from the values its description names.
fn zetacode_control(key: &str) -> ZetacodeControl {
	match key {
		"edit.mode" => ZetacodeControl::Choices(&["replace", "patch", "hashline", "apply_patch"]),
		_ => ZetacodeControl::Boolean,
	}
}

/// The zetacode rows of the 编辑器 section (设置 target ②).
///
/// The values come from `zetacode config list --json` and a change goes back
/// through `zetacode config set`, on a worker thread — zetacode's own CLI writes
/// its own file. A key that is absent from the list is drawn disabled with the
/// reason, never as a switch that does nothing.
fn zetacode_options(ui: &mut Ui, shell: &mut Shell) {
	head(ui, "zetacode 选项 · ~/.zeta/agent/config.yml");
	if shell.probe && shell.remote.options().is_empty() && !shell.remote.loading() {
		shell.remote.start_load();
	}
	if let Some(status) = shell.remote.status().map(str::to_owned) {
		hint(ui, &status);
	}
	if let Some(error) = shell.remote.error().map(str::to_owned) {
		hint(ui, &format!("读取失败：{error}"));
	}
	if shell.remote.options().is_empty() && !shell.remote.loading() {
		plain_row(
			ui,
			"zetacode 选项未读取",
			"经 zetacode config list --json 读取（Node CLI，约 1.5 秒）",
			"",
		);
		let (rect, response) =
			ui.allocate_exact_size(vec2(ui.available_width(), 30.0), Sense::click());
		ui.painter()
			.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
		ui.painter().rect_stroke(
			rect,
			CornerRadius::same(theme::R_CONTROL),
			Stroke::new(1.0_f32, theme::BORDER_2),
			egui::StrokeKind::Inside,
		);
		ui.painter().text(
			rect.center(),
			egui::Align2::CENTER_CENTER,
			"读取 zetacode 选项",
			FontId::new(12.5, egui::FontFamily::Proportional),
			if response.hovered() {
				theme::TEXT
			} else {
				theme::TEXT_2
			},
		);
		if response.clicked() {
			shell.remote.start_load();
		}
		return;
	}
	for (key, label, hint_text) in ZetacodeCache::ROWS {
		let control = zetacode_control(key);
		row(
			ui,
			label,
			hint_text,
			move |ui, shell| {
				let Some(current) = shell.remote.value(key).map(str::to_owned) else {
					disabled_switch(ui, false);
					hint(ui, &format!("{key} 没有值（未设置）"));
					return;
				};
				match control {
					ZetacodeControl::Boolean => {
						let mut on = current == "true";
						if switch(ui, &mut on) {
							let value = if on { "true" } else { "false" };
							shell.remote.start_set(key, value);
						}
					},
					ZetacodeControl::Choices(choices) => {
						let mut value = current.clone();
						let before = value.clone();
						select_string(ui, key, &mut value, choices);
						if value != before {
							shell.remote.start_set(key, &value);
						}
					},
				}
			},
			shell,
		);
	}
}

/// 默认 Shell 的 choices: 本机默认, then every shell this host really has.
fn shell_choices(detected: &[crate::shells::Shell]) -> Vec<ShellChoice> {
	let mut choices = vec![ShellChoice::default()];
	for shell in detected {
		let choice = ShellChoice(Some(shell.kind));
		if !choices.contains(&choice) {
			choices.push(choice);
		}
	}
	choices
}

/// 服务商配置 (设置 target ③): the desktop app's provider catalog, read from and
/// written to `~/.zeta/agent/models.yml`.
///
/// Each provider exposes its `baseUrl` as an editable line, saved back into the
/// same file with every other byte preserved ([`zetacode::write_provider_field`]).
/// Providers with no `baseUrl`, and the whole catalog when it cannot be read,
/// are reported rather than shown as empty rows.
fn providers_section(ui: &mut Ui, shell: &mut Shell) {
	let home = home_dir();
	shell.providers.ensure(home.as_deref());
	head(ui, "服务商配置 · ~/.zeta/agent/models.yml");
	if let Some(error) = shell.providers.error().map(str::to_owned) {
		hint(ui, &format!("读取失败：{error}"));
		return;
	}
	let count = shell.providers.providers().len();
	if count == 0 {
		hint(ui, "models.yml 里没有 providers 条目");
		return;
	}
	for index in 0..count {
		let (id, base_url, api, models) = {
			let provider = &shell.providers.providers()[index];
			(
				provider.id.clone(),
				provider.base_url.clone().unwrap_or_default(),
				provider.api.clone().unwrap_or_else(|| "—".to_owned()),
				provider.models_label(),
			)
		};
		let seed = base_url.clone();
		let row_label = format!("{id} · {api}");
		let row_hint = format!("{models} · baseUrl 写回 models.yml");
		let save_id = id.clone();
		row(
			ui,
			&row_label,
			&row_hint,
			move |ui, shell| {
				let mut save = None;
				{
					let draft = shell.draft(&save_id, &seed);
					let font = FontId::new(11.5, egui::FontFamily::Monospace);
					ui.add(
						egui::TextEdit::singleline(draft)
							.desired_width(160.0)
							.font(font)
							.hint_text("baseUrl"),
					);
					if small_button(ui, "保存").clicked() {
						save = Some(draft.clone());
					}
				}
				if let Some(value) = save {
					let notice = match home_dir() {
						Some(home) => {
							match zetacode::write_provider_field(&home, &save_id, "baseUrl", &value) {
								Ok(()) => format!("已写入 models.yml：{save_id}.baseUrl"),
								Err(error) => format!("写入失败：{error}"),
							}
						},
						None => "找不到用户目录（USERPROFILE / HOME 都为空）".to_owned(),
					};
					shell.providers.reload(home_dir().as_deref());
					shell.clear_drafts();
					shell.state.show(crate::state::Notice(notice));
				}
			},
			shell,
		);
	}
	if base_urls_missing(shell) > 0 {
		hint(ui, "个别 provider 没有 baseUrl：models.yml 里的 apiKey 指向环境变量，缺项不补默认值。");
	}
}

/// How many providers in the catalog have no `baseUrl`.
fn base_urls_missing(shell: &Shell) -> usize {
	shell
		.providers
		.providers()
		.iter()
		.filter(|provider| provider.base_url.is_none())
		.count()
}

/// A small outlined button, for a row's action.
fn small_button(ui: &mut Ui, label: &str) -> egui::Response {
	let font = FontId::new(11.5, egui::FontFamily::Proportional);
	let galley = ui
		.painter()
		.layout_no_wrap(label.to_owned(), font.clone(), theme::TEXT_2);
	let (rect, response) =
		ui.allocate_exact_size(vec2(galley.size().x + 20.0, 26.0), Sense::click());
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_CONTROL), theme::PANEL_3);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(theme::R_CONTROL),
		Stroke::new(1.0_f32, theme::BORDER_2),
		egui::StrokeKind::Inside,
	);
	ui.painter().text(
		rect.center(),
		egui::Align2::CENTER_CENTER,
		label,
		font,
		if response.hovered() {
			theme::TEXT
		} else {
			theme::TEXT_2
		},
	);
	response
}

/// The 界面语言 row: the spec offers three, only one is wired, and the row says
/// so instead of offering a control that changes nothing.
fn language_row(ui: &mut Ui, shell: &mut Shell) {
	row(
		ui,
		"界面语言",
		"菜单与提示的显示语言（其他语言尚未接入：界面文案目前只有简体中文）",
		|ui, shell| {
			// Only 简体中文 is wired: a stored `en`/`ja` is normalised here, so
			// the disabled control never shows a choice the file does not have.
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
		Stroke::new(1.0_f32, theme::BORDER),
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
		Stroke::new(1.0_f32, theme::BORDER),
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
		Stroke::new(1.0_f32, theme::BORDER_2),
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
		Stroke::new(1.0_f32, theme::BORDER_2),
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
		Stroke::new(1.0_f32, theme::BORDER),
		egui::StrokeKind::Inside,
	);
	ui.painter()
		.text(rect.center(), egui::Align2::CENTER_CENTER, keys, font.clone(), theme::TEXT_2);
}

// ── the two remote targets ────────────────────────────────────────────────

/// The user's home directory: `USERPROFILE` on Windows, `HOME` elsewhere.
///
/// `None` when neither is set — the provider rows then show that they cannot
/// find the catalog rather than guessing a path.
pub fn home_dir() -> Option<std::path::PathBuf> {
	std::env::var_os("USERPROFILE")
		.or_else(|| std::env::var_os("HOME"))
		.map(std::path::PathBuf::from)
		.filter(|path| !path.as_os_str().is_empty())
}

/// One worker's result: the option list it read back, and the line to toast.
type JobOutcome = (Result<Vec<zetacode::ZetacodeOption>, String>, String);

/// zetacode's own options (target ② of the 设置 modal).
///
/// The list comes from `zetacode config list --json` and a change goes back
/// through `zetacode config set <key> <value>` — zetacode's own CLI, so the
/// file it owns (`~/.zeta/agent/config.yml`) is written by the program that
/// reads it, not by a second parser here.
///
/// Both calls run on a worker thread: the CLI is a Node process and takes about
/// a second and a half, which must not freeze the window. [`Self::poll`] takes
/// the finished job's result once per frame.
#[derive(Default)]
pub struct ZetacodeCache {
	job: Option<std::sync::mpsc::Receiver<JobOutcome>>,
	options: Vec<zetacode::ZetacodeOption>,
	error: Option<String>,
	status: Option<String>,
}

impl ZetacodeCache {
	/// The rows this modal exposes: `(key, label, hint)`.
	///
	/// Every key exists in the real `zetacode config list` output and takes a
	/// plain scalar, so the control always maps to a value the CLI accepts.
	pub const ROWS: [(&'static str, &'static str, &'static str); 5] = [
		("edit.mode", "编辑工具形态", "replace · patch · hashline · apply_patch"),
		("autoResume", "自动续接会话", "在当前目录自动恢复最近的会话"),
		("readLineNumbers", "read 输出带行号", "读取工具默认加上行号前缀"),
		("display.showTokenUsage", "显示每轮 token 用量", "助手消息上显示本轮 token"),
		("colorBlindMode", "色盲模式", "新增行用蓝色而不是绿色"),
	];

	/// A cache that already holds a list — for the headless checks and for a
	/// shell that must not spawn a process.
	pub fn loaded(options: Vec<zetacode::ZetacodeOption>) -> Self {
		Self { job: None, options, error: None, status: None }
	}

	/// Read the options on a worker thread.
	pub fn start_load(&mut self) {
		if self.job.is_some() {
			return;
		}
		self.error = None;
		self.status = Some("正在读取 zetacode 选项…".to_owned());
		self.job = Some(spawn(move || {
			let result = zetacode::config_list();
			let notice = match &result {
				Ok(options) => format!("已读取 {} 项 zetacode 选项", options.len()),
				Err(error) => format!("读取 zetacode 选项失败：{error}"),
			};
			(result, notice)
		}));
	}

	/// Write one option on a worker thread, then read the list back.
	pub fn start_set(&mut self, key: &str, value: &str) {
		if self.job.is_some() {
			return;
		}
		let (key, value) = (key.to_owned(), value.to_owned());
		self.status = Some(format!("正在写入 {key} = {value}…"));
		self.job = Some(spawn(move || {
			let written = zetacode::set(&key, &value);
			let notice = match &written {
				Ok(_) => format!("已写入 zetacode 配置：{key} = {value}"),
				Err(error) => format!("写入 zetacode 配置失败：{error}"),
			};
			let listed = if written.is_ok() {
				zetacode::config_list()
			} else {
				Err(String::new())
			};
			match listed {
				Ok(options) => (Ok(options), notice),
				Err(_) => (
					Err(match written {
						Ok(output) => output,
						Err(error) => error,
					}),
					notice,
				),
			}
		}));
	}

	/// Take a finished job: the status line to toast, if one landed.
	pub fn poll(&mut self) -> Option<String> {
		let receiver = self.job.as_ref()?;
		let Ok((result, notice)) = receiver.try_recv() else {
			return None;
		};
		self.job = None;
		self.status = None;
		match result {
			Ok(options) => {
				self.options = options;
				self.error = None;
			},
			Err(error) if !error.is_empty() => self.error = Some(error),
			Err(_) => {},
		}
		Some(notice)
	}

	pub fn options(&self) -> &[zetacode::ZetacodeOption] {
		&self.options
	}

	/// The stored value of one key, or `None` when the key or its value is
	/// absent (the modal then draws the row disabled instead of inventing one).
	pub fn value(&self, key: &str) -> Option<&str> {
		zetacode::option(&self.options, key)?.value.as_deref()
	}

	pub fn error(&self) -> Option<&str> {
		self.error.as_deref()
	}

	pub fn status(&self) -> Option<&str> {
		self.status.as_deref()
	}

	pub fn loading(&self) -> bool {
		self.job.is_some()
	}
}

/// One worker thread per job; the result comes back over the channel.
fn spawn(
	job: impl FnOnce() -> JobOutcome + Send + 'static,
) -> std::sync::mpsc::Receiver<JobOutcome> {
	let (sender, receiver) = std::sync::mpsc::channel();
	std::thread::spawn(move || {
		let _ = sender.send(job());
	});
	receiver
}

/// The desktop app's provider catalog (target ③ of the 设置 modal).
///
/// The file is `~/.zeta/agent/models.yml`; it is small, so the read is
/// synchronous and happens the first time the 管理 section is drawn.
#[derive(Default)]
pub struct ProviderCache {
	loaded: Option<Result<Vec<zetacode::Provider>, String>>,
}

impl ProviderCache {
	/// Read the catalog once.
	pub fn ensure(&mut self, home: Option<&std::path::Path>) {
		if self.loaded.is_some() {
			return;
		}
		self.loaded = Some(match home {
			Some(home) => zetacode::read_providers(home),
			None => Err("找不到用户目录（USERPROFILE / HOME 都为空）".to_owned()),
		});
	}

	pub fn reload(&mut self, home: Option<&std::path::Path>) {
		self.loaded = None;
		self.ensure(home);
	}

	pub fn providers(&self) -> &[zetacode::Provider] {
		match &self.loaded {
			Some(Ok(providers)) => providers,
			_ => &[],
		}
	}

	pub fn error(&self) -> Option<&str> {
		match &self.loaded {
			Some(Err(error)) => Some(error),
			_ => None,
		}
	}

	pub fn loaded_any(&self) -> bool {
		self.loaded.is_some()
	}
}

/// A combo box over owned strings (the zetacode rows), where the current value
/// may also be a value the modal does not offer.
fn select_string(ui: &mut Ui, id: &str, value: &mut String, options: &[&str]) {
	egui::ComboBox::from_id_salt(id)
		.selected_text(value.clone())
		.width(180.0)
		.show_ui(ui, |ui| {
			for option in options {
				ui.selectable_value(value, (*option).to_owned(), *option);
			}
		});
}

/// One row of the 项目 registry page: name, path, the shell's workspace count
/// and the remove action. Removal writes the shared file immediately.
fn project_registry_row(
	ui: &mut Ui,
	shell: &mut Shell,
	id: &str,
	name: &str,
	path: &str,
	workspaces: usize,
) {
	let (rect, response) = ui.allocate_exact_size(vec2(ui.available_width(), 58.0), Sense::click());
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_PANEL), theme::PANEL_2);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(theme::R_PANEL),
		Stroke::new(
			1.0_f32,
			if response.hovered() {
				theme::BORDER_2
			} else {
				theme::BORDER
			},
		),
		egui::StrokeKind::Inside,
	);
	ui.painter().text(
		pos2(rect.min.x + 14.0, rect.center().y - 9.0),
		egui::Align2::LEFT_CENTER,
		name,
		FontId::new(13.0, egui::FontFamily::Proportional),
		theme::TEXT,
	);
	ui.painter().text(
		pos2(rect.min.x + 14.0, rect.center().y + 10.0),
		egui::Align2::LEFT_CENTER,
		path,
		FontId::new(11.0, egui::FontFamily::Monospace),
		theme::TEXT_3,
	);
	ui.painter().text(
		pos2(rect.max.x - 78.0, rect.center().y),
		egui::Align2::RIGHT_CENTER,
		format!("{workspaces} 个工作区"),
		FontId::new(11.5, egui::FontFamily::Proportional),
		theme::TEXT_3,
	);
	let button = Rect::from_center_size(pos2(rect.max.x - 40.0, rect.center().y), vec2(56.0, 26.0));
	if ui.put(button, egui::Button::new("移除")).clicked() {
		let id = id.to_owned();
		shell.state.act(|state| state.remove_project(&id));
	}
	ui.add_space(8.0);
}

/// A `.manage-card`: an icon, a title, a hint, and a chevron.
fn manage_card(
	ui: &mut Ui,
	shell: &mut Shell,
	title: &str,
	hint_text: &str,
	icon: Icon,
	action: ManageTarget,
) {
	let (rect, response) = ui.allocate_exact_size(vec2(ui.available_width(), 64.0), Sense::click());
	ui.painter()
		.rect_filled(rect, CornerRadius::same(theme::R_PANEL), theme::PANEL_2);
	ui.painter().rect_stroke(
		rect,
		CornerRadius::same(theme::R_PANEL),
		Stroke::new(
			1.0_f32,
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
		match action {
			ManageTarget::Projects => {
				shell.state.settings_section = Section::Projects;
			},
			ManageTarget::Notice(message) => {
				shell.state.show(crate::state::Notice(message.to_owned()));
			},
		}
	}
}
