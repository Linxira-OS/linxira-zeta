//! The shell's acceptance tests, against the public surface only.
//!
//! Four things the brief calls out are checked here end to end:
//!
//! * the settings file round-trips, and a corrupt one falls back per key;
//! * the caps hold — a seventh 大标签页 is refused, a pane keeps a session tab,
//!   a workspace keeps a pane;
//! * the CJK width rule (`中a文b` → the `a` lands two columns later);
//! * the GUI and the TUI read the same state.

use zetawork_gui::blit;
use zetawork_gui::settings::{self, Density, MonoFont, Settings, Theme};
use zetawork_gui::state::{AppState, MAX_WORKSPACES_PER_PROJECT, ViewMode};
use zetawork_gui::{Shell, tui_view};

fn shell() -> Shell {
	let cwd = std::env::current_dir().expect("cwd");
	Shell::with_state(AppState::seeded(&cwd), Settings::default())
}

/// Every piece of state a view is expected to show, as comparable strings.
fn fingerprint(state: &AppState) -> Vec<String> {
	let mut out = Vec::new();
	out.push(format!("project:{}", state.active_project.clone().unwrap_or_default()));
	out.push(format!("workspace:{}", state.active_workspace.clone().unwrap_or_default()));
	out.push(format!("branch:{}", state.branch_label()));
	out.push(format!("cols:{}", state.active_cols()));
	for pane in state.visible_panes() {
		out.push(format!("pane:{}", pane.id));
		for tab in &pane.tabs {
			out.push(format!(
				"tab:{}:{:?}:{}{}",
				tab.id,
				tab.kind,
				tab.title,
				if tab.id == pane.active { ":active" } else { "" }
			));
		}
	}
	out.push(format!("right:{:?}", state.right_tab));
	// The centre's page and the open workspace's run state are shared state
	// too: the GUI's strip, the TUI's page switch and the left column all read
	// them, so a view that disagreed about either would be a bug this catches.
	out.push(format!("center:{:?}", state.center_page));
	out.push(format!("status:{:?}", state.active_workspace().and_then(|w| w.run_state)));
	out.push(format!("collapsed:{}/{}", state.left_collapsed, state.right_collapsed));
	out
}

#[test]
fn settings_round_trip_and_corruption_fallback() {
	let dir = std::env::temp_dir().join(format!("zetawork-gui-acceptance-{}", std::process::id()));
	let _ = std::fs::remove_dir_all(&dir);
	std::fs::create_dir_all(&dir).unwrap();
	let path = dir.join("zetawork.toml");

	let wanted = Settings {
		theme: Theme::Light,
		density: Density::Compact,
		mono_font: MonoFont::Consolas,
		editor_size: 16,
		editor_wrap: false,
		terminal_size: 12,
		..Settings::default()
	};
	settings::save_to(&path, wanted).unwrap();
	assert_eq!(settings::load_from(&path), wanted, "round trip");

	// A corrupt file: invalid UTF-8, then a nonsense value next to a good one.
	std::fs::write(&path, [0x00, 0xff, 0xfe, 0x80]).unwrap();
	assert_eq!(settings::load_from(&path), Settings::default(), "binary file → defaults");
	std::fs::write(&path, "theme = ???\neditor_size = 99\ndensity = spacious\n").unwrap();
	let recovered = settings::load_from(&path);
	assert_eq!(recovered.theme, Theme::Dark, "bad value falls back");
	assert_eq!(recovered.editor_size, 13, "out-of-range value falls back");
	assert_eq!(recovered.density, Density::Spacious, "good value survives");
	let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn seventh_big_tab_is_refused() {
	let mut state = AppState::seeded(&std::env::current_dir().unwrap());
	let project = state.projects[0].id.clone();
	while state.projects[0].workspaces.len() < MAX_WORKSPACES_PER_PROJECT {
		let notice = state.new_workspace(&project);
		assert!(notice.0.is_empty(), "refused early: {}", notice.0);
	}
	let before = fingerprint(&state);
	let notice = state.new_workspace(&project);
	assert_eq!(state.projects[0].workspaces.len(), MAX_WORKSPACES_PER_PROJECT);
	assert!(notice.0.contains("最多"), "the refusal is visible: {notice:?}");
	assert_eq!(fingerprint(&state), before, "a refused tab leaves no residue");
}

#[test]
fn a_pane_and_a_workspace_keep_their_last_child() {
	let mut state = AppState::seeded(&std::env::current_dir().unwrap());
	let ws_id = state.active_workspace().unwrap().id.clone();
	let pane_id = state.workspace(&ws_id).unwrap().panes[0].id.clone();

	// All session tabs but one can go; the last is refused.
	loop {
		let pane = state.workspace(&ws_id).unwrap().panes[0].clone();
		if pane.tabs.len() == 1 {
			break;
		}
		let last = pane.tabs.last().unwrap().id.clone();
		assert!(state.close_tab(&pane_id, &last).0.is_empty());
	}
	let last = state.workspace(&ws_id).unwrap().panes[0].tabs[0].id.clone();
	let notice = state.close_tab(&pane_id, &last);
	assert_eq!(state.workspace(&ws_id).unwrap().panes[0].tabs.len(), 1);
	assert!(notice.0.contains("至少"), "{notice:?}");

	// Panes: down to one, then refused.
	let ids: Vec<String> = state
		.workspace(&ws_id)
		.unwrap()
		.panes
		.iter()
		.map(|p| p.id.clone())
		.collect();
	for id in ids.iter().skip(1) {
		assert!(state.close_pane(id).0.is_empty());
	}
	let notice = state.close_pane(&ids[0]);
	assert_eq!(state.workspace(&ws_id).unwrap().panes.len(), 1);
	assert!(notice.0.contains("至少"), "{notice:?}");

	// And a project keeps its last workspace.
	let project = state.project_of(&ws_id).unwrap().id.clone();
	let only = state.project(&project).unwrap().workspaces[0].id.clone();
	if state.project(&project).unwrap().workspaces.len() == 1 {
		let notice = state.close_workspace(&only);
		assert!(notice.0.contains("至少"), "{notice:?}");
	}
}

#[test]
fn three_columns_is_the_ceiling() {
	let mut state = AppState::seeded(&std::env::current_dir().unwrap());
	let ws_id = state.active_workspace().unwrap().id.clone();
	assert!(state.set_cols(3).0.is_empty());
	assert_eq!(state.visible_panes().len(), 3);
	assert!(state.new_pane().0.contains("最多"), "a fourth pane is refused");
	assert_eq!(state.workspace(&ws_id).unwrap().panes.len(), 3);
}

#[test]
fn a_wide_glyph_claims_two_cells_and_the_next_ascii_lands_on_column_two() {
	let (buffer, _, _) = blit::render(12, 2, |frame| {
		let area = frame.area();
		frame.render_widget(ratatui::widgets::Paragraph::new("中a文b"), area);
	});
	let row = blit::painted_cells(&buffer, 0, 12);
	let cells: Vec<(u16, &str, u16)> = row.iter().copied().take(4).collect();
	assert_eq!(cells, vec![(0, "中", 2), (2, "a", 1), (3, "文", 2), (5, "b", 1)]);
	// Which is also what ratatui's own diff does: the covered column is skipped
	// rather than painted as a blank.
	assert_eq!(blit::painted_cells(&buffer, 0, 1), vec![(0, "中", 2)]);
}

#[test]
fn the_gui_and_the_tui_read_the_same_state() {
	let mut shell = shell();
	let gui = fingerprint(&shell.state);
	shell.state.set_view(ViewMode::Tui);
	assert_eq!(fingerprint(&shell.state), gui, "switching views changes no data");

	let workspace = shell.state.workspace_label().to_owned();
	let branch = shell.state.branch_label().to_owned();
	// The TUI opens on the same page the GUI does (总面板), so the pane
	// assertions below are made about the workspace page explicitly.
	assert_eq!(shell.state.center_page, zetawork_gui::state::CenterPage::Total);
	let text = tui_view::snapshot(&shell, 150, 40);
	assert!(text.contains("总面板"), "the TUI opens on the total panel:\n{text}");
	assert!(text.contains("所有项目一张表"), "with the contract's foot line:\n{text}");
	shell
		.state
		.set_center_page(zetawork_gui::state::CenterPage::Workspace);
	let text = tui_view::snapshot(&shell, 150, 40);
	assert!(text.contains(&workspace), "the TUI shows the open workspace:\n{text}");
	assert!(text.contains(&branch), "the TUI shows the branch:\n{text}");
	assert!(text.contains("F1 文件"), "the sidebar tabs are drawn:\n{text}");
	assert!(text.contains("设置"), "the status line starts with 设置:\n{text}");
	for pane in shell.state.visible_panes() {
		for tab in &pane.tabs {
			if tab.id == pane.active {
				assert!(text.contains(&tab.title), "the focused tab is drawn:\n{text}");
			}
		}
	}
	// The page switch is on the bottom row and both pages are reachable.
	assert!(text.contains("终端 宿主"), "the page switch is drawn:\n{text}");
	shell.state.show_total();

	// …and the GUI draws that same state without a window.
	let ctx = egui::Context::default();
	shell.state.set_view(ViewMode::Gui);
	render_frame(&ctx, &mut shell);
	assert_eq!(fingerprint(&shell.state), gui, "the GUI drew the same state");
}

/// The TUI's centre box has the same two pages the GUI's strip has, and the
/// page switch on its bottom row is the only way between them in a terminal.
#[test]
fn the_tui_centre_box_switches_between_both_pages() {
	let mut shell = shell();
	shell.state.set_view(ViewMode::Tui);
	let total = tui_view::snapshot(&shell, 150, 40);
	let switch = total
		.lines()
		.find(|line| line.contains("总面板") && line.contains("终端 宿主"))
		.unwrap_or_else(|| panic!("no page switch row:\n{total}"));
	assert!(
		switch.contains("所有项目一张表"),
		"the 总面板 foot line the contract pins is on that row:\n{switch}"
	);
	// The real project's row is `—` in 状态: nothing observes it, and the sample
	// projects' rows show words from the contract's table.
	assert!(total.contains("permission"), "a sample state is drawn:\n{total}");

	shell
		.state
		.set_center_page(zetawork_gui::state::CenterPage::Workspace);
	let workspace = tui_view::snapshot(&shell, 150, 40);
	assert!(!workspace.contains("所有项目一张表"), "the table is gone:\n{workspace}");
	assert!(
		workspace
			.lines()
			.any(|line| line.contains("总面板") && line.contains("终端 宿主")),
		"the switch stays on both pages:\n{workspace}"
	);
}

#[test]
fn the_welcome_panel_appears_with_no_workspace_open() {
	let mut shell = shell();
	shell.state.go_home();
	assert!(shell.state.visible_panes().is_empty());
	let text = tui_view::snapshot(&shell, 150, 40);
	assert!(text.contains("选择左侧的项目或工作区"), "the TUI says so too:\n{text}");
	let ctx = egui::Context::default();
	render_frame(&ctx, &mut shell);
}

/// Draw one whole frame (title bar, both columns, centre, status bar) into a
/// headless egui context, the way `update` does — the tests have no window.
fn render_frame(ctx: &egui::Context, shell: &mut Shell) {
	for _ in 0..2 {
		// Twice: `set_fonts` and a couple of layout decisions only settle on
		// the second frame, and a panic there is what this test is for.
		shell.tick(ctx);
		let output = ctx.run(egui::RawInput::default(), |ctx| shell.draw(ctx));
		assert!(
			!output.shapes.is_empty(),
			"a frame must paint something ({} shapes)",
			output.shapes.len()
		);
	}
}

#[test]
fn the_whole_frame_draws_in_every_arrangement() {
	let ctx = egui::Context::default();
	let mut shell = shell();
	// Open, with both columns, in each view.
	render_frame(&ctx, &mut shell);
	shell.state.set_view(ViewMode::Tui);
	render_frame(&ctx, &mut shell);
	shell.state.set_view(ViewMode::Gui);
	// Collapsed columns (the rails) and the focus mode.
	shell.state.toggle_left();
	shell.state.toggle_right();
	render_frame(&ctx, &mut shell);
	// Every right-column panel, including the git one (real `git` output).
	for tab in zetawork_gui::state::RightTab::ALL {
		shell.state.set_right_tab(tab);
		render_frame(&ctx, &mut shell);
	}
	// Every 设置 section, with the modal open over the frame.
	for section in zetawork_gui::settings::Section::ALL {
		shell.state.settings_section = section;
		shell.state.open_settings();
		render_frame(&ctx, &mut shell);
	}
	shell.state.close_modal();
	// Every page the ＋ picker offers, each in its own pane.
	for kind in zetawork_gui::state::SessionKind::PAGES {
		let pane = shell.state.visible_panes()[0].id.clone();
		let notice = shell.state.open_page(&pane, kind);
		assert!(notice.0.is_empty(), "opening {kind:?}: {}", notice.0);
		render_frame(&ctx, &mut shell);
	}
	// The picker itself, over the frame, for both of its targets.
	for target in [
		zetawork_gui::state::PickerTarget::BigTab,
		zetawork_gui::state::PickerTarget::Pane(shell.state.visible_panes()[0].id.clone()),
	] {
		shell.state.open_picker(target);
		render_frame(&ctx, &mut shell);
	}
	shell.state.close_picker();
	// The 用量 container, and the status bar's collapsed strip.
	shell.state.open_usage();
	render_frame(&ctx, &mut shell);
	shell.state.close_usage();
	shell.state.act(|state| state.toggle_statusbar());
	render_frame(&ctx, &mut shell);
	shell.state.act(|state| state.toggle_statusbar());
	// 列数 1 · 2 · 3, and the welcome panel.
	for cols in [1u8, 2, 3] {
		shell.state.act(|state| state.set_cols(cols));
		render_frame(&ctx, &mut shell);
	}
	shell.state.go_home();
	render_frame(&ctx, &mut shell);
	// A toast, which draws over everything.
	shell.state.toast("测试提示");
	render_frame(&ctx, &mut shell);
}

#[test]
fn the_picker_lists_the_hosts_shells_and_every_page() {
	let entries = zetawork_gui::state::PickerEntry::all();
	let shells: Vec<&zetawork_gui::state::PickerEntry> = entries
		.iter()
		.filter(|entry| matches!(entry, zetawork_gui::state::PickerEntry::Shell(_)))
		.collect();
	let pages: Vec<&zetawork_gui::state::PickerEntry> = entries
		.iter()
		.filter(|entry| matches!(entry, zetawork_gui::state::PickerEntry::Page(_)))
		.collect();
	// The pages are exactly the five the GUI draws itself, in the spec's order.
	assert_eq!(
		pages.iter().map(|entry| entry.title()).collect::<Vec<_>>(),
		vec!["编辑器", "差异比较器", "Git", "zetaide", "Agent 会话"]
	);
	// Whatever this host has, every shell row points at a file that exists and
	// is classified as a shell (never a page).
	for entry in &shells {
		if let zetawork_gui::state::PickerEntry::Shell(shell) = entry {
			assert!(shell.path.is_file(), "{} is not a file", shell.path.display());
			assert_eq!(entry.session_kind(), zetawork_gui::state::SessionKind::Term);
			assert!(!entry.detail().is_empty(), "a shell row names its path");
		}
	}
	// 本机 has at least one of the six families on Windows; on any other host the
	// list may legitimately be empty, so only the ordering rule is asserted.
	let kinds: Vec<&str> = shells.iter().map(|entry| entry.group()).collect();
	assert!(kinds.iter().all(|group| *group == "本机 Shell"), "shells come first");
	assert!(entries.iter().any(|entry| entry.group() == "页面"));
}

#[test]
fn a_new_big_tab_opens_a_terminal_and_a_pick_opens_what_was_picked() {
	let mut state = AppState::seeded(&std::env::current_dir().unwrap());
	let project = state.active_project.clone().unwrap();

	// The default: one pane, one 终端 page, one column.
	let notice = state.new_workspace(&project);
	assert!(notice.0.is_empty(), "{}", notice.0);
	let workspace = state.active_workspace().unwrap().clone();
	assert_eq!(workspace.panes.len(), 1);
	assert_eq!(workspace.cols, 1);
	assert_eq!(workspace.panes[0].tabs[0].kind, zetawork_gui::state::SessionKind::Term);

	// A picker pick on the strip's ＋ puts the picked page in the new 大标签页.
	state.open_picker(zetawork_gui::state::PickerTarget::BigTab);
	let page = zetawork_gui::state::PickerEntry::Page(zetawork_gui::state::SessionKind::Diff);
	let notice = state.pick(&page);
	assert!(notice.0.is_empty(), "{}", notice.0);
	let workspace = state.active_workspace().unwrap();
	assert_eq!(workspace.panes[0].tabs[0].kind, zetawork_gui::state::SessionKind::Diff);
	assert!(state.picker().is_none(), "the pick closes the picker");

	// A pick on a pane's ＋ adds a tab there instead.
	let pane_id = state.visible_panes()[0].id.clone();
	let before = state.visible_panes()[0].tabs.len();
	state.open_picker(zetawork_gui::state::PickerTarget::Pane(pane_id.clone()));
	let notice =
		state.pick(&zetawork_gui::state::PickerEntry::Page(zetawork_gui::state::SessionKind::Git));
	assert!(notice.0.is_empty(), "{}", notice.0);
	assert_eq!(state.visible_panes()[0].tabs.len(), before + 1);
	assert_eq!(
		state.visible_panes()[0].active_tab().map(|tab| tab.kind),
		Some(zetawork_gui::state::SessionKind::Git),
		"the new page is the active tab"
	);
}

#[test]
fn a_shell_pick_records_that_shell_on_the_terminal_page() {
	let mut state = AppState::seeded(&std::env::current_dir().unwrap());
	let Some(shell) = zetawork_gui::shells::detect().into_iter().next() else {
		// A host with no shell at all cannot exercise this; the picker test
		// above still covers the listing rule.
		return;
	};
	let pane_id = state.visible_panes()[0].id.clone();
	let kind = shell.kind;
	let notice = state.open_shell(&pane_id, shell);
	assert!(notice.0.is_empty(), "{}", notice.0);
	let tab = state.visible_panes()[0].active_tab().cloned().unwrap();
	assert_eq!(tab.kind, zetawork_gui::state::SessionKind::Term);
	assert_eq!(tab.shell, Some(kind), "the page records which shell it is for");
	assert!(tab.title.contains(kind.label()), "title: {}", tab.title);
}

#[test]
fn the_editor_page_opens_and_saves_a_real_file() {
	let dir = std::env::temp_dir().join(format!("zetawork-gui-editor-{}", std::process::id()));
	let _ = std::fs::remove_dir_all(&dir);
	std::fs::create_dir_all(&dir).unwrap();
	let path = dir.join("notes.md");
	std::fs::write(&path, "# hello\nsecond line\n").unwrap();

	let mut shell = shell();
	let pane_id = shell.state.visible_panes()[0].id.clone();
	let notice = shell.state.open_file(&pane_id, &path);
	assert!(notice.0.is_empty(), "{}", notice.0);
	let tab = shell.state.visible_panes()[0]
		.active_tab()
		.cloned()
		.unwrap();
	assert_eq!(tab.kind, zetawork_gui::state::SessionKind::Editor);
	let doc = tab
		.doc
		.as_ref()
		.expect("an editor tab carries its document");
	assert_eq!(doc.path, path);
	assert_eq!(doc.text, "# hello\nsecond line\n", "the buffer is the file");
	assert_eq!(doc.lines(), 2);
	assert!(!doc.dirty);

	// Editing the buffer and Ctrl+S writes those exact bytes to disk.
	let tab_id = tab.id.clone();
	{
		let doc = shell
			.state
			.doc_mut(&pane_id, &tab_id)
			.expect("the document is still open");
		doc.text.push_str("third line\n");
		doc.touch();
	}
	assert!(shell.state.save_dirty_editors().0.contains("已保存"));
	assert_eq!(
		std::fs::read_to_string(&path).unwrap(),
		"# hello\nsecond line\nthird line\n",
		"the save wrote the buffer back"
	);
	assert!(!shell.state.doc_mut(&pane_id, &tab_id).unwrap().dirty);

	// Re-opening the same file activates the open tab instead of reloading it.
	let notice = shell.state.open_file(&pane_id, &path);
	assert!(notice.0.is_empty(), "{}", notice.0);
	let tabs = shell.state.visible_panes()[0]
		.tabs
		.iter()
		.filter(|tab| tab.kind == zetawork_gui::state::SessionKind::Editor)
		.count();
	assert_eq!(tabs, 2, "the seeded editor tab plus this file's");

	// A directory is refused, not opened as an empty document.
	let notice = shell.state.open_file(&pane_id, &dir);
	assert!(notice.0.contains("目录"), "{}", notice.0);
	let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_right_column_has_four_tabs_and_seven_settings_sections() {
	assert_eq!(zetawork_gui::state::RightTab::ALL.len(), 4);
	assert_eq!(
		zetawork_gui::state::RightTab::ALL.map(|tab| tab.title()),
		["文件树", "历史 · Agent 对话", "Git 状态", "上下文用量"]
	);
	// 常规 comes first: the lifecycle rulings (关闭窗口时 / 开机自启 / 通知) are the
	// one section the design drafts do not have, and the six they fix keep
	// their own order behind it.
	assert_eq!(zetawork_gui::settings::Section::ALL.len(), 7);
	assert_eq!(
		zetawork_gui::settings::Section::ALL.map(|section| section.label()),
		["常规", "外观", "编辑器", "终端", "快捷键", "管理", "关于"]
	);
	assert_eq!(zetawork_gui::settings::Section::ALL[0], zetawork_gui::settings::Section::General);
	assert_eq!(zetawork_gui::settings::Section::General.key(), "general");
	// The left column keeps 手机版's slot but does not draw it (R20).
	assert_eq!(zetawork_gui::state::NavItem::ALL.len(), 4);
	assert_eq!(zetawork_gui::state::NavItem::visible().count(), 3);
	assert!(zetawork_gui::state::NavItem::Mobile.hidden());
}

#[test]
fn the_total_panel_is_the_first_big_tab_and_what_opens() {
	use zetawork_gui::state::{CenterPage, MAX_SUBS_PER_PANE};

	assert_eq!(CenterPage::Total.label(), "总面板");
	assert_eq!(CenterPage::Workspace.label(), "", "a workspace tab carries its own name");
	assert_eq!(MAX_SUBS_PER_PANE, 8, "子页上限 8, from the contract");

	let mut state = AppState::seeded(&std::env::current_dir().unwrap());
	assert_eq!(state.center_page, CenterPage::Total, "the strip's first tab is what opens");

	// 总面板 is a page, not a workspace: switching to it leaves the open
	// workspace alone, and clicking a workspace row (or its left-column row)
	// goes back to the pane grid.
	let ws = state
		.active_workspace()
		.map(|w| w.id.clone())
		.expect("a seeded workspace");
	state.show_total();
	assert_eq!(state.center_page, CenterPage::Total);
	assert_eq!(state.active_workspace.as_deref(), Some(ws.as_str()));
	let notice = state.select_workspace(&ws);
	assert!(notice.0.is_empty(), "{}", notice.0);
	assert_eq!(state.center_page, CenterPage::Workspace);

	// The sample projects carry one of the contract's seven states each — they
	// are demo data, and their section head says `示例项目` — and they do not
	// all read the same word. The **real** project (本机, the user's own
	// directory) must carry none: nothing in this build observes a workspace, so
	// a state there would be invented.
	let states: Vec<_> = state
		.projects
		.iter()
		.flat_map(|p| p.workspaces.iter())
		.filter_map(|w| w.run_state)
		.collect();
	assert!(!states.is_empty(), "the sample projects show the vocabulary");
	assert!(
		states
			.iter()
			.all(|state| zetawork_gui::status::RunState::ALL.contains(state))
	);
	assert!(states.iter().any(|state| *state != states[0]), "the 状态 column is not degenerate");
	let local = state
		.projects
		.iter()
		.find(|p| p.id == "p-local")
		.expect("the real project is seeded");
	assert!(
		local.workspaces.iter().all(|w| w.run_state.is_none()),
		"the real project's state is not observed, so it is not claimed"
	);

	// A workspace created from the ＋ is in the same position: `—`, not a guess.
	let project = state.active_project.clone().expect("a project");
	state.new_workspace(&project);
	assert_eq!(
		state.active_workspace().and_then(|w| w.run_state),
		None,
		"a brand new workspace has no observed state"
	);
}

#[test]
fn the_settings_modal_reaches_all_three_targets() {
	// ① zetawork's own file: the shell's settings type round-trips (see the
	//    acceptance test above) and every section is drawn by the frame test.

	// ② zetacode's options: five rows, each one a real key of
	//    `zetacode config list`, written through `zetacode config set`.
	let fixture = r#"{
		"edit.mode": {"value": "hashline", "type": "enum", "description": "…"},
		"autoResume": {"value": true, "type": "boolean", "description": "…"},
		"readLineNumbers": {"value": true, "type": "boolean", "description": "…"},
		"display.showTokenUsage": {"value": true, "type": "boolean", "description": "…"},
		"colorBlindMode": {"value": false, "type": "boolean", "description": "…"}
	}"#;
	let options = zetawork_gui::zetacode::parse_config_list(fixture).expect("fixture parses");
	let cache = zetawork_gui::settings_ui::ZetacodeCache::loaded(options);
	for (key, _, _) in zetawork_gui::settings_ui::ZetacodeCache::ROWS {
		assert!(cache.value(key).is_some(), "the row {key} has a value");
	}
	assert_eq!(
		zetawork_gui::zetacode::set_argv("edit.mode", "patch"),
		["config".to_owned(), "set".to_owned(), "edit.mode".to_owned(), "patch".to_owned(),]
	);
	// The key set is the one the real CLI reports: probe it when it is there.
	if let Ok(real) = zetawork_gui::zetacode::config_list() {
		for (key, _, _) in zetawork_gui::settings_ui::ZetacodeCache::ROWS {
			assert!(
				zetawork_gui::zetacode::option(&real, key).is_some(),
				"{key} is not in `zetacode config list`"
			);
		}
	}

	// ③ the provider catalog: read from a real `models.yml`, and the row's write
	//    target is the file's own `baseUrl` literal.
	let dir = std::env::temp_dir().join(format!("zetawork-gui-providers-{}", std::process::id()));
	let _ = std::fs::remove_dir_all(&dir);
	std::fs::create_dir_all(dir.join(".zeta").join("agent")).unwrap();
	let catalog = dir.join(".zeta").join("agent").join("models.yml");
	std::fs::write(
		&catalog,
		"{\n  \"providers\": {\n    \"zai\": {\n      \"baseUrl\": \"https://api.z.ai/v1\",\n      \"api\": \"openai-completions\",\n      \"apiKey\": \"ZAI_API_KEY\",\n      \"models\": []\n    }\n  }\n}\n",
	)
	.unwrap();
	let mut providers = zetawork_gui::settings_ui::ProviderCache::default();
	providers.ensure(Some(&dir));
	assert_eq!(providers.providers().len(), 1);
	assert_eq!(providers.providers()[0].id, "zai");
	assert_eq!(providers.providers()[0].base_url.as_deref(), Some("https://api.z.ai/v1"));
	assert!(providers.error().is_none());
	zetawork_gui::zetacode::write_provider_field(&dir, "zai", "baseUrl", "https://example.test")
		.unwrap();
	providers.reload(Some(&dir));
	assert_eq!(providers.providers()[0].base_url.as_deref(), Some("https://example.test"));
	assert!(
		std::fs::read_to_string(&catalog)
			.unwrap()
			.contains("\"apiKey\": \"ZAI_API_KEY\""),
		"the rest of the file is preserved"
	);
	let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_usage_entry_opens_the_embedded_stats_container() {
	let mut shell = shell();
	assert!(!shell.state.usage_view_open());
	zetawork_gui::left::open_usage(&mut shell);
	assert!(shell.state.usage_view_open(), "用量 opens the container");
	assert!(shell.state.modal_open(), "the container counts as an overlay");
	// The container loads a loopback stats page, and says where the address
	// came from. (A default endpoint is not an error: it means `zetacode serve`
	// has not published a `~/.zeta/serve.json` on this machine.)
	let url = zetawork_gui::usage::url(&shell).to_owned();
	assert!(url.starts_with("http"), "{url}");
	assert!(
		zetawork_gui::stats::StatsEndpoint {
			url: url.clone(),
			source: zetawork_gui::stats::EndpointSource::Default,
			info: None
		}
		.is_loopback()
	);
	assert!(zetawork_gui::usage::endpoint_line(&shell).contains(&url));
	assert!(!zetawork_gui::stats::CONTAINER_OBSTACLE.is_empty());
	// The right column's 上下文用量 tab opens the same container.
	shell.state.close_usage();
	shell
		.state
		.set_right_tab(zetawork_gui::state::RightTab::Context);
	assert_eq!(shell.state.right_tab, zetawork_gui::state::RightTab::Context);
	// Escape closes the container before anything else.
	shell.state.open_usage();
	assert!(shell.state.escape());
	assert!(!shell.state.usage_view_open());
}

#[test]
fn the_status_bar_collapses_and_comes_back() {
	let mut state = AppState::seeded(&std::env::current_dir().unwrap());
	assert!(state.statusbar_visible());
	assert!(state.toggle_statusbar().0.contains("收起"));
	assert!(!state.statusbar_visible());
	assert!(state.toggle_statusbar().0.contains("展开"));
	assert!(state.statusbar_visible());
	assert_eq!(state.context_label(), "上文 —", "no live session, no percentage");
}

#[test]
fn the_modal_and_the_view_switch_keep_their_order_under_escape() {
	let mut shell = shell();
	shell.state.set_view(ViewMode::Tui);
	shell.state.open_settings();
	assert!(shell.state.modal_open());
	assert!(shell.state.escape(), "escape closes the modal first");
	assert!(!shell.state.modal_open());
	assert_eq!(shell.state.view, ViewMode::Tui);
	assert!(shell.state.escape(), "then it leaves the TUI view");
	assert_eq!(shell.state.view, ViewMode::Gui);
}

/// One fake SSE endpoint for the shell-level agent test: a plain body with
/// `frames`, half-closed after the write so the reader sees the stream end.
fn fake_agent_serve(frames: &'static str) -> String {
	use std::io::{Read, Write};
	use std::net::{Shutdown, TcpListener};

	let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
	let address = listener.local_addr().expect("addr").to_string();
	std::thread::spawn(move || {
		let (mut socket, _) = listener.accept().expect("accept");
		let mut request = [0u8; 1024];
		let _ = socket.read(&mut request);
		let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
		socket.write_all(head.as_bytes()).expect("head");
		socket.write_all(frames.as_bytes()).expect("frames");
		let _ = socket.shutdown(Shutdown::Write);
		std::thread::sleep(std::time::Duration::from_millis(200));
	});
	format!("http://{address}")
}

#[test]
fn an_agent_ui_request_raises_a_notification_through_the_shell() {
	use std::time::{Duration, Instant};

	use zetawork_gui::notify::Trigger;
	use zetawork_gui::settings::NotifyPolicy;
	use zetawork_gui::state::SessionKind;

	let origin = fake_agent_serve(
		"data: {\"type\":\"extension_ui_request\",\"id\":\"r1\",\"method\":\"confirm\",\"title\":\"允许执行？\"}\n\n",
	);
	let mut shell = shell();
	shell.settings.notify = NotifyPolicy::Always;
	let ctx = egui::Context::default();
	let pane_id = shell.state.visible_panes()[0].id.clone();
	let notice = shell.state.open_page(&pane_id, SessionKind::Agent);
	assert!(notice.0.is_empty(), "{}", notice.0);
	let tab = shell.state.visible_panes()[0]
		.active_tab()
		.expect("the agent tab is active")
		.id
		.clone();
	shell
		.agents
		.connect(&tab, &origin, "s1")
		.expect("reader thread");
	let deadline = Instant::now() + Duration::from_secs(3);
	let mut seen = None;
	while Instant::now() < deadline {
		shell.poll_agents(&ctx);
		if let Some(trace) = shell.last_trace.take() {
			seen = Some(trace.message.trigger);
			break;
		}
		std::thread::sleep(Duration::from_millis(10));
	}
	assert_eq!(seen, Some(Trigger::NeedsInput));
	assert!(shell.state.needs_redraw, "the poll asks for a repaint");
	assert!(shell.agents.pane(&tab).expect("pane").awaiting_input());
}
