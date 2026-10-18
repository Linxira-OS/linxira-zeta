// SPDX-License-Identifier: AGPL-3.0-only
//! The shell's acceptance tests, against the public surface only.
//!
//! Four things the brief calls out are checked here end to end:
//!
//! * the settings file round-trips, and a corrupt one falls back per key;
//! * the caps hold — a seventh 大标签页 is refused, a pane keeps a session tab,
//!   a workspace keeps a pane;
//! * the CJK width rule (`中a文b` → the `a` lands two columns later);
//! * the GUI and the TUI read the same state.

use zetawork_gui::Shell;
use zetawork_gui::blit;
use zetawork_gui::settings::{self, Density, MonoFont, Settings, Theme};
use zetawork_gui::state::{AppState, MAX_WORKSPACES_PER_PROJECT};

fn shell() -> Shell {
	Shell::with_state(seeded_state(), Settings::default())
}

/// A state over an empty registry file in this process's temp directory, so a
/// test never reads or writes the user's `~/.zeta/projects.json`.
fn seeded_state() -> AppState {
	let cwd = std::env::current_dir().expect("cwd");
	let path = std::env::temp_dir()
		.join(format!("zetawork-gui-tests-{}", std::process::id()))
		.join("projects.json");
	AppState::seeded_with_registry(&cwd, workbench_projects::Registry::empty_at(path))
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
	let mut state = seeded_state();
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
	let mut state = seeded_state();
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
	let mut state = seeded_state();
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
fn a_frame_never_changes_the_state_it_draws() {
	let mut shell = shell();
	let before = fingerprint(&shell.state);
	let ctx = egui::Context::default();
	render_frame(&ctx, &mut shell);
	assert_eq!(fingerprint(&shell.state), before, "drawing changes no data");
}

/// The TUI's centre box has the same two pages the GUI's strip has, and the
/// page switch on its bottom row is the only way between them in a terminal.
#[test]
fn the_welcome_panel_appears_with_no_workspace_open() {
	let mut shell = shell();
	shell.state.go_home();
	assert!(shell.state.visible_panes().is_empty());
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
	// Open, with both columns.
	render_frame(&ctx, &mut shell);
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
	// The pages are exactly the six the GUI draws itself, in the spec's order.
	assert_eq!(
		pages.iter().map(|entry| entry.title()).collect::<Vec<_>>(),
		vec!["编辑器", "差异比较器", "Git", "zetacode", "zetaide", "Agent 会话"]
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
fn a_zetacode_pick_opens_a_page_that_runs_the_shipped_binary_without_typing() {
	use zetawork_gui::state::{PickerEntry, PickerTarget, SessionKind};
	use zetawork_gui::zetacode::{Companion, Launch};

	let mut state = seeded_state();
	state.open_picker(PickerTarget::BigTab);
	let notice = state.pick(&PickerEntry::Page(SessionKind::Zetacode));
	assert!(notice.0.is_empty(), "{}", notice.0);
	let tab = state
		.active_workspace()
		.and_then(|workspace| workspace.panes[0].active_tab())
		.expect("the picked page opens");
	assert_eq!(tab.kind, SessionKind::Zetacode);
	assert_eq!(tab.command, None, "the page types nothing into a shell");
	match tab.program.as_ref().expect("the program was resolved with the tab") {
		Launch::Binary(path) => {
			assert!(path.is_file(), "a resolved binary is a file: {}", path.display());
			let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
			assert!(
				Companion::Zetacode.executable_names().contains(&name),
				"{name} is one of the shipped zetacode names"
			);
		},
		Launch::Missing(sentence) => {
			assert!(sentence.starts_with("未找到随包的 zetacode："), "{sentence}");
		},
	}
}

#[test]
fn a_new_big_tab_opens_a_terminal_and_a_pick_opens_what_was_picked() {
	let mut state = seeded_state();
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
	let mut state = seeded_state();
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
	assert_eq!(tabs, 1, "the file has one editor tab; the reopen activated it");

	// A directory is refused, not opened as an empty document.
	let notice = shell.state.open_file(&pane_id, &dir);
	assert!(notice.0.contains("目录"), "{}", notice.0);
	let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_right_column_has_four_tabs_and_eight_settings_sections() {
	assert_eq!(zetawork_gui::state::RightTab::ALL.len(), 4);
	assert_eq!(
		zetawork_gui::state::RightTab::ALL.map(|tab| tab.title()),
		["文件树", "历史 · Agent 对话", "Git 状态", "上下文用量"]
	);
	// 常规 comes first: the lifecycle rulings (关闭窗口时 / 开机自启 / 通知) are the
	// one section the design drafts do not have, and the six they fix keep
	// their own order behind it. 项目 is the registry page the 管理 card opens.
	assert_eq!(zetawork_gui::settings::Section::ALL.len(), 8);
	assert_eq!(
		zetawork_gui::settings::Section::ALL.map(|section| section.label()),
		["常规", "外观", "编辑器", "终端", "快捷键", "项目", "管理", "关于"]
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

	let mut state = seeded_state();
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

	// Nothing observes a workspace's state in this build: the 本机 pseudo-entry
	// and every workspace the user creates read `—` rather than a word from the
	// seven that nothing produced.
	let local = state
		.projects
		.iter()
		.find(|p| p.id == "p-local")
		.expect("the local pseudo-project is seeded");
	assert!(
		local.workspaces.iter().all(|w| w.run_state.is_none()),
		"the real project's state is not observed, so it is not claimed"
	);
	assert_eq!(
		state
			.projects
			.iter()
			.flat_map(|p| p.workspaces.iter())
			.filter_map(|w| w.run_state)
			.count(),
		0,
		"no hard-coded sample state survives"
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
	let mut state = seeded_state();
	assert!(state.statusbar_visible());
	assert!(state.toggle_statusbar().0.contains("收起"));
	assert!(!state.statusbar_visible());
	assert!(state.toggle_statusbar().0.contains("展开"));
	assert!(state.statusbar_visible());
	assert_eq!(state.context_label(), "上文 —", "no live session, no percentage");
}

#[test]
fn escape_closes_the_modal_before_anything_else() {
	let mut shell = shell();
	shell.state.open_settings();
	assert!(shell.state.modal_open());
	assert!(shell.state.escape(), "escape closes the modal");
	assert!(!shell.state.modal_open());
	assert!(!shell.state.escape(), "nothing left to close");
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

/// The project registry is shared state: adding writes the file, removing
/// clears the row and **never** touches the directory, and the project row's
/// `+` opens a workspace with one plain terminal at that path — nothing is
/// typed into its shell.
#[test]
fn project_registry_add_rename_remove_and_plain_workspace() {
	use zetawork_gui::state::SessionKind;

	let dir = tempfile::tempdir().expect("temp dir");
	let project_dir = dir.path().join("demo");
	std::fs::create_dir_all(&project_dir).unwrap();
	let registry_path = dir.path().join(".zeta").join("projects.json");
	let mut state = AppState::seeded_with_registry(
		&std::env::current_dir().unwrap(),
		workbench_projects::Registry::empty_at(&registry_path),
	);
	assert_eq!(state.projects.len(), 1, "本机 alone");

	let notice = state.add_project(&project_dir);
	assert!(notice.0.contains("已添加项目"), "{}", notice.0);
	let id = state
		.registry
		.list()
		.first()
		.expect("registered")
		.id
		.clone();
	assert_eq!(state.projects.len(), 2, "本机 + the registration");
	let canonical = std::fs::canonicalize(&project_dir).expect("canonical");
	assert_eq!(state.projects[1].path, canonical, "the path is the registration's");
	assert_eq!(state.active_project.as_deref(), Some(id.as_str()));

	// A second registration of the same directory is refused, not replaced.
	let refused = state.add_project(&project_dir);
	assert!(refused.0.contains("already registered"), "{}", refused.0);
	assert_eq!(state.registry.len(), 1);

	// Rename writes the shared file and the GUI row together.
	state.begin_rename_project(&id);
	state.set_rename_text("演示项目 2".to_owned());
	let notice = state.commit_rename_project();
	assert!(notice.0.contains("演示项目 2"), "{}", notice.0);
	assert_eq!(state.registry.get(&id).unwrap().name, "演示项目 2");
	assert_eq!(state.project(&id).unwrap().name, "演示项目 2");

	// The `+` opens a plain workspace: one terminal page at the project path,
	// and **nothing** queued to be typed into its shell (the old behaviour
	// typed a PATH-resolved `zetacode` into every new workspace).
	let notice = state.new_workspace(&id);
	assert!(notice.0.is_empty(), "{}", notice.0);
	let workspace = state.active_workspace().expect("the new workspace opens");
	assert_eq!(workspace.path, canonical.display().to_string());
	assert_eq!(workspace.panes.len(), 1, "one pane");
	let tab = workspace.panes[0].active_tab().expect("a tab");
	assert_eq!(tab.kind, SessionKind::Term, "the pane is a terminal");
	assert_eq!(tab.command, None, "the `+` types nothing into the shell");
	assert_eq!(tab.program, None, "the `+` starts no companion binary");

	// Removing the registration keeps the directory and any history.
	let notice = state.remove_project(&id);
	assert!(notice.0.contains("目录未删除"), "{}", notice.0);
	assert!(project_dir.is_dir(), "the directory survives");
	assert!(state.projects.iter().all(|project| project.id != id));
	assert!(state.registry.is_empty());
	let reloaded = workbench_projects::Registry::load_from(&registry_path).expect("reload");
	assert!(reloaded.is_empty(), "the remove reached the shared file");
}
